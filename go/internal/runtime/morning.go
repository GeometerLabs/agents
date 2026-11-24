package runtime

// The owner's morning line and the licence's final stop (modules/assistant/morning.ts createMorningJob, modules/licence/rules.ts licenceNow, modules/runtime/config.ts
// licenceReader): one short message a day to the owner, in their language, on the clock's beat after the beat's own step, as modules/runtime/core.ts runs its `daily` job. A
// listings-only shop has it only when push is on (templates/commerce/listings/server/runtime.ts), and never in the licence's final stop ("stopped"), where the shop sends nothing
// more.
//
// WHEN: from the owner's morning hour (`assistant.morning.at`, off when the settings turn it off) for four hours. SILENT on a closed day and on a day with nothing to say: for this
// shop "something" is only an item the owner counts that is running low (no bookings, fees or orders), money recorded yesterday (none: it takes no payment) and what waits for
// the owner (the open cards).
//
// ONCE, EVEN IF THE PROCESS DIES (send-once): the claim (`send_message` attempted, refs.morning = the day) is saved before the push goes; the ending (confirmed: the push was queued
// for a phone; failed: nothing went, tried again after an hour, three times at most) after. A claim with no ending is never sent again: it is marked unconfirmed.
//
// The words are the personality's morning template filled in (go/scripts/gen_words.ts renders it from templates.ts), as the push-only messaging sends free text: a push carries the
// words, not a template. The record names the template, the mood and its picture, as TypeScript's does.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/GeometerLabs/agents/go/internal/assistant"
	"github.com/GeometerLabs/agents/go/internal/guard"
	"github.com/GeometerLabs/agents/go/internal/language"
	"github.com/GeometerLabs/agents/go/internal/listings"
	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/store"
)

// ---- the licence (rules.ts) ---------------------------------------------------------------------------------------------------------------------------------

type leaseShop struct {
	State       string `json:"state"`
	Expires     int64  `json:"expires"`
	PaidThrough int64  `json:"paid_through"`
}

type licenceFile struct {
	shop           *leaseShop
	newestIssuedAt int64
	extensionUntil int64
	partner        string // the Operator who set the shop up, trimmed (rules.ts `partner.trim()`): the licence notice names them
}

var leaseStates = []string{"active", "reminder", "warning", "wind_down", "stopped"}

// parseLicence is rules.ts `parseLicenceFile` (schema 1, whole non-negative times, a partner of at most 120 characters, the shop's entry with its nine fields or null); nil when
// it does not fit, and the last good reading then stands.
func parseLicence(b []byte) *licenceFile {
	var o map[string]any
	if json.Unmarshal(b, &o) != nil {
		return nil
	}
	isTime := func(v any) bool {
		f, ok := v.(float64)
		return ok && f >= 0 && f == float64(int64(f)) && f <= 9007199254740991
	}
	p, pok := o["partner"].(string)
	if o["schema"] != float64(1) || !isTime(o["newest_issued_at"]) || !isTime(o["extension_until"]) || !pok || len([]rune(p)) > 120 {
		return nil
	}
	f := &licenceFile{newestIssuedAt: int64(o["newest_issued_at"].(float64)), extensionUntil: int64(o["extension_until"].(float64)), partner: language.TrimJS(p)}
	if o["shop"] == nil {
		return f
	}
	s, ok := o["shop"].(map[string]any)
	if !ok || len(s) != 9 || !isTime(s["paid_through"]) || !isTime(s["grace_days"]) || !isTime(s["expires"]) {
		return nil
	}
	state, _ := s["state"].(string)
	if !has(leaseStates, state) {
		return nil
	}
	f.shop = &leaseShop{State: state, Expires: int64(s["expires"].(float64)), PaidThrough: int64(s["paid_through"].(float64))}
	return f
}

// licenceState is rules.ts `licenceNow(...).state`: not in a lease (or no file) is active; a stated wind-down or stop holds; otherwise the shop winds down once its expiry (pushed
// out by an extension) passes, judged at the later of the clock and the newest issue time.
func (r *Runtime) licenceState(nowMs int64) string {
	file := filepath.Join(r.o.Client.Folder, "licence.json")
	if st, err := os.Stat(file); err == nil && st.ModTime().UnixNano() != r.licenceSeen {
		if b, err := os.ReadFile(file); err == nil {
			if f := parseLicence(b); f != nil {
				r.licence = f
			}
			r.licenceSeen = st.ModTime().UnixNano()
		}
	}
	f := r.licence
	if f == nil || f.shop == nil {
		return "active"
	}
	if f.shop.State == "wind_down" || f.shop.State == "stopped" {
		return f.shop.State
	}
	now := nowMs / 1000
	if f.newestIssuedAt > now {
		now = f.newestIssuedAt
	}
	until := f.shop.Expires
	if f.extensionUntil > until {
		until = f.extensionUntil
	}
	if now >= until {
		return "wind_down"
	}
	return f.shop.State
}

// LicencePaidThrough is rules.ts `licenceNow(...).paidThrough`: the lease's paid_through (seconds), nil with no lease (read as licenceState last read the file).
func (r *Runtime) LicencePaidThrough() *int64 {
	if f := r.licence; f != nil && f.shop != nil {
		p := f.shop.PaidThrough
		return &p
	}
	return nil
}

// LicencePartner is rules.ts licenceNow's `partner`: the Operator the lease names ("" with no lease file).
func (r *Runtime) LicencePartner() string {
	if f := r.licence; f != nil {
		return f.partner
	}
	return ""
}

// ---- the morning line -----------------------------------------------------------------------------------------------------------------------------------

const (
	morningWindowMs = 4 * 3_600_000
	morningTries    = 3         // send-once.ts MAX_TRIES
	morningRetryMs  = 3_600_000 // send-once.ts RETRY_AFTER_MS
)

// morning is the listings-only shop's daily job, run after the beat's step: the line goes to the owner's phones as a push (push.ts pushMessaging), so only when push is on.
func (r *Runtime) morning() error {
	if p := r.Push(); p == nil || !p.On {
		return nil
	}
	r.mu.RLock()
	text := r.snapshot
	entries := append(r.entries[:0:0], r.entries...)
	r.mu.RUnlock()
	snap, err := ParseSnap(text)
	if err != nil {
		return err
	}
	number, lang := r.owner()
	return r.runMorning(morningRun{
		snap: snap, entries: entries,
		commit: func(outcome string, inputs any, refs map[string]string, notes string) error {
			rec := r.recorder()
			rec.append(NewLine{Conversation: number, Action: "send_message", Outcome: outcome, Inputs: inputs, Language: lang, Refs: refs, Notes: notes})
			return r.save(snap, rec, "")
		},
		send: func(plan morningPlan) (id, via, outcome, note string) {
			ids, perr := r.PushOwner(plan.text, "")
			if perr == nil && len(ids) > 0 {
				return "push-" + ids[0], "text", "confirmed", ""
			}
			if perr != nil {
				return "", "", "failed", perr.Error()
			}
			return "", "", "failed", "This shop has no WhatsApp number, and the owner has no phone with alerts on, so nothing was sent; the owner's app shows what waits for them."
		},
	})
}

// MorningContext is morning.ts MorningContext for a template's shop: the step's record, its save, the shop's messaging (its owner route), and the template's skill (read-only).
type MorningContext struct {
	Skill     OwnerSkill
	Messaging messaging.Messaging
	Save      func() error
}

// Morning is morning.ts createMorningJob's `run` for a template's shop, on the clock's beat after the monthly report (core.ts `daily`): the owner's morning line, as text in their
// open window, else the approved template that carries the same words. Never in the licence's final stop, and off for a shop without the assistant.
func (c *StepContext) Morning(m MorningContext) error {
	r := c.rt
	if r == nil || !c.Settings.HasAssistant || c.Licence() == "stopped" {
		return nil
	}
	// decision 65: in a shop of several parts the morning line is the shop's, said once by its first part, over every part's skill and the whole record (parts.go)
	if c.Rec.SharedBeatOff() {
		return nil
	}
	var more []OwnerSkill
	for _, f := range c.coParts {
		if hh, ok := f(); ok && hh.Skill != nil {
			more = append(more, hh.Skill)
		}
	}
	number, lang := c.Owner()
	return r.runMorning(morningRun{
		snap: c.Snap, entries: c.Rec.ShopEntries(), skill: m.Skill, more: more,
		commit: func(outcome string, inputs any, refs map[string]string, notes string) error {
			c.Rec.append(NewLine{Conversation: number, Action: "send_message", Outcome: outcome, Inputs: inputs, Language: lang, Refs: refs, Notes: notes})
			return m.Save()
		},
		send: func(plan morningPlan) (id, via, outcome, note string) {
			ctx := context.Background()
			var sent *messaging.OutboundMessage
			via = "template"
			var err error
			if open, oerr := m.Messaging.IsWindowOpen(ctx, number); oerr == nil && open {
				if s, serr := m.Messaging.SendText(ctx, number, plan.text); serr == nil {
					sent, via = &s, "text"
				} else {
					var w *guard.WindowClosedError
					if !errors.As(serr, &w) {
						err = serr
					}
				}
			}
			if sent == nil && err == nil {
				var s messaging.OutboundMessage
				tm := messaging.TemplateMessage{Name: plan.template, Language: lang, Text: plan.text, Parameters: plan.params}
				// item 11i (morning.ts): the morning templates were made with an image header, the shop's mood picture; WhatsApp refuses one sent without it (132012), so the
				// picture goes whenever the shop's pictures are drawn (pages.json `character`). Found by the hand check on Go, 24 Nov 2026: the port had left it out
				if p := r.pages(); p != nil && p.CharacterVersion != "" {
					u := p.Base + "/character/" + plan.refs["face"] + ".png?v=" + p.CharacterVersion
					tm.HeaderImage = &u
				}
				if s, err = m.Messaging.SendTemplate(ctx, number, tm); err == nil {
					sent = &s
				}
			}
			if err == nil {
				var seen *messaging.OutboundMessage
				if seen, err = m.Messaging.GetMessage(ctx, sent.ID); err == nil {
					if seen != nil {
						return sent.ID, via, "confirmed", ""
					}
					return sent.ID, via, "unconfirmed", ""
				}
			}
			outcome = "unconfirmed"
			if sent == nil && messaging.NothingWasSent(err) {
				outcome = "failed"
			}
			if sent != nil {
				id = sent.ID
			}
			return id, via, outcome, err.Error()
		},
	})
}

// morningPlan is what today's line says: the words, the record's refs, and the approved template with its values in Meta's order.
type morningPlan struct {
	text     string
	facts    language.Facts // what its writer noted, for the outgoing check (templates.ts morningFacts.check)
	refs     map[string]string
	template string
	params   []string
}

// morningRun is one shop's run of the job: its saved state, its record, how a line is written and saved, and how the words go out.
type morningRun struct {
	snap    *Snap
	entries []store.Entry
	skill   OwnerSkill   // the template's own, read-only (nil: the listings-only shop)
	more    []OwnerSkill // decision 65: the shop's other parts' skills, read-only (none in a single-part shop)
	commit  func(outcome string, inputs any, refs map[string]string, notes string) error
	// send gives the message's id and how it went (via "text" or "template"), its outcome (confirmed, unconfirmed or failed) and why when it did not go
	send func(plan morningPlan) (id, via, outcome, note string)
}

// runMorning is morning.ts `run`: when, once even if the process dies, silent on a closed or quiet day, then the claim, the send and the ending.
func (r *Runtime) runMorning(m morningRun) error {
	now := r.o.Now()
	if r.licenceState(now) == "stopped" {
		return nil
	}
	set := r.o.Client.Settings
	if set.Assistant.MorningOff {
		return nil
	}
	t := time.UnixMilli(now).In(r.loc)
	y, mo, d := t.Date()
	key := t.Format("2006-01-02")
	if r.morningDone == key {
		return nil
	}
	from := time.Date(y, mo, d, set.Assistant.MorningHour, set.Assistant.MorningMinute, 0, 0, r.loc).UnixMilli()
	if now < from {
		return nil
	}
	var mine []morningEntry
	for _, e := range m.entries {
		if e.Action == "send_message" && e.Refs["morning"] == key {
			mine = append(mine, morningEntry{e.Outcome, e.Time})
		}
	}
	inputs := map[string]any{"to": "owner", "morning": key}
	if n := len(mine); n > 0 && mine[n-1].outcome == "attempted" {
		r.morningDone = key
		return m.commit("unconfirmed", inputs, map[string]string{"to": "owner", "morning": key}, "The process stopped while the morning line was being sent, so it may or may not have reached the owner. It is not sent again.")
	}
	failed := 0
	for _, e := range mine {
		switch e.outcome {
		case "confirmed", "unconfirmed", "blocked":
			r.morningDone = key
			return nil
		case "failed":
			failed++
		}
	}
	if failed >= morningTries {
		r.morningDone = key
		return nil
	}
	if n := len(mine); n > 0 {
		if at, ok := parseTime(mine[n-1].time); ok && at.UnixMilli()+morningRetryMs > now {
			return nil
		}
	}
	if failed == 0 && now >= from+morningWindowMs {
		r.morningDone = key
		return nil
	}
	plan, silent := r.morningWords(m.snap, m.skill, m.entries, now, m.more...)
	if silent {
		r.morningDone = key
		return nil
	}
	plan.refs["morning"] = key
	// the words against their own values (morning.ts: checkText over morningFacts.check); a line that fails is recorded as blocked, and today has no other try
	if problems := language.CheckText(plan.text, plan.facts); len(problems) > 0 {
		r.morningDone = key
		return m.commit("blocked", inputs, plan.refs, "The morning line did not match its record, so it was not sent: "+strings.Join(problems, " "))
	}
	// 1. claim the day, saved before anything goes out
	if err := m.commit("attempted", inputs, plan.refs, ""); err != nil {
		return err
	}
	// 2. send it, 3. the ending
	id, via, outcome, note := m.send(plan)
	ending := map[string]string{}
	for k, v := range plan.refs {
		ending[k] = v
	}
	if id != "" {
		ending["messageId"], ending["via"] = id, via
	}
	if outcome == "failed" {
		next := "It is tried again in an hour."
		if failed+1 >= morningTries {
			next = "That was the last try for today."
		}
		r.o.Log(fmt.Sprintf("The morning line could not be sent to the owner (%s). %s", note, next))
	} else {
		r.morningDone = key
	}
	return m.commit(outcome, inputs, ending, note)
}

// morningWords is morning.ts's middle: silent on a closed day (the owner closed it, or the weekday has no hours) and on a day with nothing to say; otherwise the personality's
// template filled in with today's parts (a Bookings shop's day, a Fees centre's fees not paid, an Orders shop's open orders; the running-low count), the money recorded yesterday
// and what waits.
//
// Decision 65: `more` are a shop's other parts' skills. Each kind of part (a day's list, fees owed, open orders) is said from the first skill that has it, and what waits is
// counted over all of them; with none (every single-part shop) this is exactly the one skill's line.
func (r *Runtime) morningWords(snap *Snap, skill OwnerSkill, entries []store.Entry, now int64, more ...OwnerSkill) (morningPlan, bool) {
	all := append([]OwnerSkill{skill}, more...)
	set := r.o.Client.Settings
	number, lang := r.owner()
	_ = number
	d := dateIn(now, r.loc)
	if IsClosedDay(snap, d) {
		return morningPlan{}, true
	}
	if hs, ok := firstSkillOf[HoursSkill](all); ok && !hoursOpen(hs, d) {
		return morningPlan{}, true
	}
	pack := assistant.Words(lang)
	w := pack.Writer() // templates.ts morningFacts: every value through the Writer
	var parts []string
	something := false
	if ds, ok := firstSkillOf[DaySkill](all); ok {
		rows := ds.Day(d)
		if len(rows) > 0 {
			first := rows[0].StartMs
			for _, x := range rows {
				first = min(first, x.StartMs)
			}
			ft := time.UnixMilli(first).In(r.loc)
			parts = append(parts, w.Say("morning.bookings", "n", strconv.Itoa(len(rows)), "time", pack.TimeOfDay(ft.Hour(), ft.Minute())))
			something = true
		} else {
			parts = append(parts, w.Say("morning.no_bookings"))
		}
	}
	if ow, ok := firstSkillOf[OweSkill](all); ok { // a Fees centre's fees not paid (morning.ts `s.owes`): "fees not paid: N (₹X)", or the "nothing" word
		if rows := ow.Owes(); len(rows) > 0 {
			var owed int64
			for _, r := range rows {
				owed += r.AmountPaise
			}
			parts = append(parts, w.Say("morning.owes", "n", strconv.Itoa(len(rows)), "inr", assistant.INR(owed)))
			something = true
		} else {
			parts = append(parts, pack.Say("morning.nothing"))
		}
	}
	if os, ok := firstSkillOf[OpenSkill](all); ok { // an Orders shop's open orders (morning.ts `s.open`): "open orders: N", or the "nothing" word
		if n := len(os.Open()); n > 0 {
			parts = append(parts, w.Say("morning.open", "n", strconv.Itoa(n)))
			something = true
		} else {
			parts = append(parts, pack.Say("morning.nothing"))
		}
	}
	low := 0
	if snap.Stock != nil {
		for _, l := range snap.Stock.Lines {
			if l.LowFlag && listings.KindOf(l.ID) != "supply" {
				low++
			}
		}
	}
	if low > 0 {
		parts = append(parts, w.Say("morning.low", "n", strconv.Itoa(low)))
		something = true
	}
	waiting := 0
	for _, sk := range all {
		if sk != nil {
			waiting += len(sk.Waiting())
		}
	}
	if snap.A != nil {
		waiting += len(snap.A.OpenCards(now))
	}
	// money recorded yesterday (conversation.ts moneyOn over the record)
	yd := d.AddDays(-1)
	var money int64
	fromMs := time.Date(yd.Year, time.Month(yd.Month), yd.Day, 0, 0, 0, 0, r.loc).UnixMilli()
	toMs := time.Date(d.Year, time.Month(d.Month), d.Day, 0, 0, 0, 0, r.loc).UnixMilli()
	for _, e := range entries {
		if e.Outcome != "confirmed" || (e.Action != "record_deposit" && e.Action != "record_payment" && e.Action != "owner_marked_paid") {
			continue
		}
		at, err := time.Parse(time.RFC3339Nano, e.Time)
		amount, aerr := strconv.ParseInt(e.Refs["amountPaise"], 10, 64)
		if err == nil && aerr == nil && at.UnixMilli() >= fromMs && at.UnixMilli() < toMs && amount > 0 {
			money += amount
		}
	}
	if !something && money == 0 && waiting == 0 {
		return morningPlan{}, true
	}
	nothing := pack.Say("morning.nothing")
	vals := map[string]string{"shop": set.Name, "date": pack.DateText(d.Year, d.Month, d.Day), "today": nothing, "money": nothing, "waiting": nothing}
	if len(parts) > 0 {
		vals["today"] = strings.Join(parts, ", ")
	}
	if money > 0 {
		vals["money"] = w.INR(money)
	}
	if waiting > 0 {
		vals["waiting"] = w.N(int64(waiting))
	}
	p := set.Assistant.Personality
	text := w.Say("morning."+p, "shop", vals["shop"], "date", vals["date"], "today", vals["today"], "money", vals["money"], "waiting", vals["waiting"])
	var params []string
	for _, k := range strings.Split(pack.Say("morning."+p+".order"), ",") {
		params = append(params, vals[k])
	}
	mood, face := shopMood(snap, skill, now, r.loc, more...)
	name := pack.Say("morning." + p + ".name")
	return morningPlan{text: text, facts: w.Facts(), template: name, params: params, refs: map[string]string{"to": "owner", "templates": name, "mood": mood, "face": face}}, false
}

// firstSkillOf is the first skill of a shop's that has the kind K (decision 65: a shop of several parts; with one skill, that skill when it has it). A nil skill has none.
func firstSkillOf[K any](skills []OwnerSkill) (K, bool) {
	for _, s := range skills {
		if s == nil {
			continue
		}
		if k, ok := s.(K); ok {
			return k, true
		}
	}
	var zero K
	return zero, false
}

type morningEntry struct{ outcome, time string }
