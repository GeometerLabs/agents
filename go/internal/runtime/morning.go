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
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/GeometerLabs/agents/go/internal/assistant"
	"github.com/GeometerLabs/agents/go/internal/listings"
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
	f := &licenceFile{newestIssuedAt: int64(o["newest_issued_at"].(float64)), extensionUntil: int64(o["extension_until"].(float64))}
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

// ---- the morning line -----------------------------------------------------------------------------------------------------------------------------------

const (
	morningWindowMs = 4 * 3_600_000
	morningTries    = 3         // send-once.ts MAX_TRIES
	morningRetryMs  = 3_600_000 // send-once.ts RETRY_AFTER_MS
)

// morning is the daily job, run after the beat's step.
func (r *Runtime) morning() error {
	if p := r.Push(); p == nil || !p.On {
		return nil
	}
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
	number, lang := r.owner()
	r.mu.RLock()
	var mine []morningEntry
	for _, e := range r.entries {
		if e.Action == "send_message" && e.Refs["morning"] == key {
			mine = append(mine, morningEntry{e.Outcome, e.Time})
		}
	}
	text := r.snapshot
	r.mu.RUnlock()
	snap, err := ParseSnap(text)
	if err != nil {
		return err
	}
	inputs := map[string]any{"to": "owner", "morning": key}
	line := func(rec *recorder, outcome string, refs map[string]string, notes string) {
		rec.append(NewLine{Conversation: number, Action: "send_message", Outcome: outcome, Inputs: inputs, Language: lang, Refs: refs, Notes: notes})
	}
	if n := len(mine); n > 0 && mine[n-1].outcome == "attempted" {
		rec := r.recorder()
		line(rec, "unconfirmed", map[string]string{"to": "owner", "morning": key}, "The process stopped while the morning line was being sent, so it may or may not have reached the owner. It is not sent again.")
		r.morningDone = key
		return r.save(snap, rec, "")
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
	// silent on a closed day, and on a day with nothing to say
	open := 0
	if snap.A != nil {
		for _, day := range snap.A.ClosedDays {
			if day == key {
				r.morningDone = key
				return nil
			}
		}
		open = len(snap.A.OpenCards(now))
	}
	low := 0
	if snap.Stock != nil {
		for _, l := range snap.Stock.Lines {
			if l.LowFlag && listings.KindOf(l.ID) != "supply" {
				low++
			}
		}
	}
	if low == 0 && open == 0 {
		r.morningDone = key
		return nil
	}
	pack := assistant.Words(lang)
	today := pack.Say("morning.nothing")
	if low > 0 {
		today = pack.Say("morning.low", "n", strconv.Itoa(low))
	}
	waiting := pack.Say("morning.nothing")
	if open > 0 {
		waiting = strconv.Itoa(open)
	}
	p := set.Assistant.Personality
	words := pack.Say("morning."+p, "shop", set.Name, "date", pack.DateText(y, int(mo), d), "today", today, "money", pack.Say("morning.nothing"), "waiting", waiting)
	mood, face := "quiet", "well" // mood.ts for this shop: waiting for the owner beats closed (a closed day is silent above) beats quiet
	if open > 0 {
		mood, face = "waiting_for_owner", "needs"
	}
	refs := map[string]string{"to": "owner", "morning": key, "templates": pack.Say("morning." + p + ".name"), "mood": mood, "face": face}
	// 1. claim the day, saved before anything goes out
	rec := r.recorder()
	line(rec, "attempted", refs, "")
	if err := r.save(snap, rec, ""); err != nil {
		return err
	}
	// 2. send it: the push-only messaging takes free text to the owner's phones (push.ts pushMessaging: the window is "open" for a push)
	ids, perr := r.PushOwner(words, "")
	rec = r.recorder()
	ending := map[string]string{}
	for k, v := range refs {
		ending[k] = v
	}
	switch {
	case perr == nil && len(ids) > 0:
		ending["messageId"], ending["via"] = "push-"+ids[0], "text"
		line(rec, "confirmed", ending, "")
		r.morningDone = key
	default:
		note := "This shop has no WhatsApp number, and the owner has no phone with alerts on, so nothing was sent; the owner's app shows what waits for them."
		if perr != nil {
			note = perr.Error()
		}
		line(rec, "failed", ending, note)
		next := "It is tried again in an hour."
		if failed+1 >= morningTries {
			next = "That was the last try for today."
		}
		r.o.Log(fmt.Sprintf("The morning line could not be sent to the owner (%s). %s", note, next))
	}
	return r.save(snap, rec, "")
}

type morningEntry struct{ outcome, time string }
