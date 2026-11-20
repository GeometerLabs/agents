package runtime

// What the owner's assistant does at once, in passing, and can undo (conversation.ts closeDay, reopenDay, move, undoLast), and the limits as one more skill
// (modules/assistant/limits-card.ts: "Limits, tightened by a tap"). Only a template's shop with the skill for it gets these: the listings-only shop has no day to close, no
// booking to move and declares no limit, and answers as before.
//
// A closed day is done at once and said in passing: the date goes into the assistant's closed days (which the template's free times and its within-hours limit read), the
// customers booked that day are asked to pick another day by the assistant's approved template, nothing is cancelled or refunded, and "undo" opens it again. A move goes through
// the template's own reschedule (the calendar and the customer's "rescheduled" message), and "undo" moves it back.
//
// A limit is read by rule: WHICH declared limit and WHAT value from the owner's words (a model may only name the limit); only a value STRICTLY tighter than the limit in force now
// becomes a card, and only the owner's tap makes a Pending change, which the runtime obeys at once while the deployer reports back (limits.go settles it). Loosening is never done
// here: the owner is told it is theirs, in their own app behind their passkey.

import (
	"encoding/json"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/GeometerLabs/agents/go/internal/assistant"
	"github.com/GeometerLabs/agents/go/internal/language"
)

// ---- closed days ----------------------------------------------------------------------------------------------------------------------------------------

// isClosedDay is conversation.ts isClosedDay: is this date one the owner closed?
func (c *conv) isClosedDay(d LocalDate) bool {
	for _, x := range c.a.ClosedDays {
		if x == d.Iso() {
			return true
		}
	}
	return false
}

// IsClosedDay is the same read for a template (its free times and its within-hours limit leave a closed date out).
func IsClosedDay(s *Snap, d LocalDate) bool {
	if s == nil || s.A == nil {
		return false
	}
	for _, x := range s.A.ClosedDays {
		if x == d.Iso() {
			return true
		}
	}
	return false
}

func (c *conv) closeDaySkill() CloseDaySkill {
	for _, s := range c.skills {
		if cd, ok := s.(CloseDaySkill); ok {
			return cd
		}
	}
	return nil
}

func (c *conv) dateText(d LocalDate) string { return c.pack.DateText(d.Year, d.Month, d.Day) }

func hoursOpen(h HoursSkill, d LocalDate) bool { _, _, ok := h.Hours(d); return ok }

// closeDay is conversation.ts closeDay.
func (c *conv) closeDay(d LocalDate) {
	skill := c.closeDaySkill()
	if skill == nil {
		c.say("not_offered")
		return
	}
	date := c.dateText(d)
	if d.Iso() < c.today().Iso() {
		c.say("past_day", "date", date)
		return
	}
	if h, ok := skill.(HoursSkill); ok && !hoursOpen(h, d) {
		c.say("weekday_closed", "date", date)
		return
	}
	if c.isClosedDay(d) {
		c.say("already_closed", "date", date)
		return
	}
	// close first, so the free times stop offering the date in this same step, then ask the customers booked that day to pick another one
	c.a.ClosedDays = append(c.a.ClosedDays, d.Iso())
	sort.Strings(c.a.ClosedDays)
	booked, told := skill.CloseDay(d, func(caseID, phone string, startMs int64) bool { return c.tellCustomer("day_closed", caseID, phone, d, startMs) })
	if told == nil {
		told = []string{}
	}
	name := skill.(OwnerSkill).Name()
	undo := c.a.NextID("u")
	c.a.Undo = append(c.a.Undo, assistant.Undo{ID: undo, Kind: "close_day", Skill: name, Date: d.Iso(), Asked: told, AtMs: c.now, UntilMs: c.now + assistant.UndoForMs})
	c.logLine("close_day", "confirmed", map[string]any{"date": d.Iso()}, map[string]string{"skill": name, "date": d.Iso(), "booked": strconv.Itoa(len(booked)), "asked": strconv.Itoa(len(told)), "undo": undo},
		"the owner closed this date: it is no longer offered, and the customers booked that day were asked to pick another day (those not reached are named to the owner); nothing was cancelled or refunded")
	// the owner hears how many were booked, and by name the ones the message could not reach (STOP, or no approved template outside their window), to call them
	var missed []string
	for _, b := range booked {
		reached := false
		for _, t := range told {
			reached = reached || t == b.Case
		}
		if !reached {
			missed = append(missed, b.Case+" ("+b.Who+")") // words.ts: `${case} (${who})`, joined with ", " in every language
		}
	}
	switch {
	case len(booked) == 0:
		c.say("closed.zero", "date", date)
	case len(missed) == 0:
		c.say("closed.n", "date", date, "n", strconv.Itoa(len(booked)))
	default:
		c.say("closed.n.missed", "date", date, "n", strconv.Itoa(len(booked)), "missed", strings.Join(missed, ", "))
	}
}

// reopenDay is conversation.ts reopenDay.
func (c *conv) reopenDay(d LocalDate) {
	date := c.dateText(d)
	if !c.isClosedDay(d) {
		c.say("not_closed", "date", date)
		return
	}
	var record *assistant.Undo
	for i := len(c.a.Undo) - 1; i >= 0; i-- {
		u := &c.a.Undo[i]
		if u.Kind == "close_day" && u.Date == d.Iso() && !u.Done {
			record = u
			break
		}
	}
	var skill CloseDaySkill
	if record != nil {
		if s, ok := c.skillNamed(record.Skill).(CloseDaySkill); ok {
			skill = s
		}
	}
	if skill == nil {
		skill = c.closeDaySkill()
	}
	kept := c.a.ClosedDays[:0]
	for _, x := range c.a.ClosedDays {
		if x != d.Iso() {
			kept = append(kept, x)
		}
	}
	c.a.ClosedDays = kept
	var told []string
	if skill != nil {
		asked := []string{}
		if record != nil {
			asked = record.Asked
		}
		told = skill.ReopenDay(d, asked, func(caseID, phone string, startMs int64) bool { return c.tellCustomer("day_open", caseID, phone, d, startMs) })
	}
	if record != nil {
		record.Done, record.HasDone = true, true
	}
	refs := map[string]string{"date": d.Iso(), "told": strconv.Itoa(len(told))}
	if skill != nil {
		refs["skill"] = skill.(OwnerSkill).Name()
	}
	if record != nil {
		refs["undo"] = record.ID
	}
	c.logLine("reopen_day", "confirmed", map[string]any{"date": d.Iso()}, refs, "the owner opened this date again; the customers asked to move who are still booked that day were told their booking stands")
	if len(told) > 0 {
		c.say("reopened.n", "date", date, "n", strconv.Itoa(len(told)))
	} else {
		c.say("reopened.zero", "date", date)
	}
}

// ---- a booking moved by the owner (not money: done at once, said in passing, undoable) -----------------------------------------------------------------------

// moveFailed is words.ts move_failed: why a move did not happen, with the time asked for when there was one.
func (c *conv) moveFailed(ref, why string, toMs *int64) {
	if toMs != nil {
		c.sayAbout(ref, "move_failed."+why+".to", "ref", ref, "slot", c.slotText(*toMs))
		return
	}
	c.sayAbout(ref, "move_failed."+why, "ref", ref)
}

// move is conversation.ts move.
func (c *conv) move(in assistant.Intent) {
	if in.Ref == "" {
		c.needRef("move", in)
		return
	}
	skill := c.skillOf(in.Ref)
	if skill == nil {
		c.say("refusal.no_case", "ref", in.Ref)
		return
	}
	ms, ok := skill.(MoveSkill)
	if !ok {
		c.say("not_offered")
		return
	}
	if in.Date == nil && in.Time == nil {
		c.say("need_when", "ref", in.Ref)
		return
	}
	start, why := ms.MoveTarget(in.Ref, c.dateOf(in), in.Time)
	if why != "" {
		c.moveFailed(in.Ref, why, nil)
		return
	}
	from, to, why := ms.Move(in.Ref, start)
	if why != "" {
		c.moveFailed(in.Ref, why, &start)
		return
	}
	undo := c.a.NextID("u")
	c.a.Undo = append(c.a.Undo, assistant.Undo{ID: undo, Kind: "move", Skill: skill.Name(), Date: dateIn(from, c.r.loc).Iso(), Asked: []string{}, Case: in.Ref, HasCase: true, FromMs: &from, ToMs: &to, AtMs: c.now, UntilMs: c.now + assistant.UndoForMs})
	c.logCase(in.Ref, "move_booking", "confirmed", map[string]any{"from": from, "to": to}, map[string]string{"skill": skill.Name(), "from": isoMs(from), "to": isoMs(to), "undo": undo},
		"the owner moved this booking; the customer was told by the agent's own reschedule message")
	c.sayAbout(in.Ref, "moved", "ref", in.Ref, "slot", c.slotText(to))
}

// isoMs is `new Date(ms).toISOString()`.
func isoMs(ms int64) string { return time.UnixMilli(ms).UTC().Format("2006-01-02T15:04:05.000Z") }

// undoLast is conversation.ts `undoLast`: the newest undo record still in time.
func (c *conv) undoLast() {
	var last *assistant.Undo
	for i := len(c.a.Undo) - 1; i >= 0; i-- {
		if u := &c.a.Undo[i]; !u.Done && u.UntilMs > c.now {
			last = u
			break
		}
	}
	if last == nil {
		c.say("undo_none")
		return
	}
	switch last.Kind {
	case "remember":
		last.Done, last.HasDone = true, true
		c.undoRemember(last.Case)
	case "move":
		ms, _ := c.skillNamed(last.Skill).(MoveSkill)
		var from, to int64
		why := "failed"
		if ms != nil && last.FromMs != nil {
			from, to, why = ms.Move(last.Case, *last.FromMs)
		}
		if why != "" {
			c.moveFailed(last.Case, why, last.FromMs)
			return
		}
		last.Done, last.HasDone = true, true
		c.logCase(last.Case, "move_booking", "confirmed", map[string]any{"from": from, "to": to}, map[string]string{"skill": last.Skill, "undo": last.ID}, "the owner undid their move: the booking is back at its old time")
		c.sayAbout(last.Case, "moved_back", "ref", last.Case, "slot", c.slotText(to))
	default:
		t, err := time.Parse("2006-01-02", last.Date)
		if err != nil {
			c.say("undo_none")
			return
		}
		c.reopenDay(LocalDate{t.Year(), int(t.Month()), t.Day()})
	}
}

// ---- limits (limits-card.ts) ----------------------------------------------------------------------------------------------------------------------------

// LimitView is limits-card.ts LimitView: what a card and a message need of one limit, in every language.
type LimitView struct {
	ID, Unit  string
	ZeroIsOff bool
	Name      map[string]string
	Rule      map[string]string
}

// LimitCardView is the card's data: the rule with the proposed value, and the value now.
type LimitCardView struct {
	LimitView
	Now, To int64
}

func (l *LimitDecl) view() LimitView {
	limitWordsOnce.Do(func() { _ = json.Unmarshal(limitWordsJSON, &limitWords) })
	w := limitWords[l.Kind]
	return LimitView{ID: l.ID, Unit: l.Unit, ZeroIsOff: l.ZeroIsOff, Name: w.Name, Rule: w.Rule}
}

// valueText is limits-card.ts valueText: rupees for an amount, the number for a count, "never" for an off value.
func (c *conv) valueText(v LimitView, value int64) string {
	if v.ZeroIsOff && value == 0 {
		return c.pack.Say("limit.never")
	}
	if v.Unit == "inr" {
		return assistant.INR(value * 100)
	}
	return strconv.FormatInt(value, 10)
}

// ruleText is limits-card.ts ruleText: the rule with its value put in.
func (c *conv) ruleText(v LimitView, value int64) string {
	return strings.Replace(v.Rule[c.lang], "{v}", c.valueText(v, value), 1)
}

func (c *conv) declaredLimit(id string) *LimitDecl {
	decl := c.r.declared()
	for i := range decl {
		if decl[i].ID == id {
			return &decl[i]
		}
	}
	return nil
}

// sayLimit is words.ts limitLine for pending, active and failed (value is the proposed, or for "failed" the one in force now).
func (c *conv) sayLimit(what string, v LimitView, value, _ int64) {
	c.say("limit."+what, "rule", c.ruleText(v, value))
}

// limitsSkill is limits-card.ts createLimits's skill; nil when the template declares none (a listings-only shop: limits stay the Operator's).
func (c *conv) limitsSkill() *limitsSkill {
	if c.hooks == nil || len(c.r.declared()) == 0 {
		return nil
	}
	return &limitsSkill{c}
}

type limitsSkill struct{ c *conv }

var limitCaseRe = regexp.MustCompile(`^limit:[a-z_]+$`)

func (*limitsSkill) Name() string           { return "limits" }
func (*limitsSkill) Owns(ref string) bool   { return limitCaseRe.MatchString(ref) }
func (*limitsSkill) Waiting() []WaitingItem { return nil }
func (*limitsSkill) Problems() int          { return 0 }

func (k *limitsSkill) changes() []limitChange { return changesOf(k.c.snap.assistant["limitChanges"]) }

// Prepare is limits-card.ts prepare: the limit in force NOW, so a card made before another change landed has another digest on its tap.
func (k *limitsSkill) Prepare(p assistant.Raw) (Prepared, string) {
	if rawString(p["kind"]) != "limit" {
		return Prepared{}, "not_here"
	}
	l := k.c.declaredLimit(strings.TrimPrefix(rawString(p["case"]), "limit:"))
	if l == nil {
		return Prepared{}, "no_case"
	}
	to := rawInt(p["to"])
	ok, _, from := l.judge(k.changes(), to, "tighten")
	if !ok {
		return Prepared{}, "limit_not_tighter"
	}
	act := assistant.Action{Kind: "limit", Skill: "limits", Case: rawString(p["case"]), Fields: assistant.Raw{"limit": jstring(l.ID), "path": jstring(l.Path), "now": jnum(from), "to": jnum(to)}}
	var amount int64
	if l.Unit == "inr" {
		amount = to * 100
	}
	return Prepared{Action: act, Shown: Shown{What: l.ID, AmountPaise: amount, Limit: &LimitCardView{LimitView: l.view(), Now: from, To: to}}}, ""
}

// Execute is limits-card.ts execute: checked again as it is now (the one place a change is made), then a Pending change the runtime obeys at once.
func (k *limitsSkill) Execute(act assistant.Action) Executed {
	c := k.c
	l := c.declaredLimit(rawString(act.Fields["limit"]))
	if l == nil {
		return Executed{false, "failed"}
	}
	to := rawInt(act.Fields["to"])
	ok, _, from := l.judge(k.changes(), to, "tighten")
	if !ok {
		return Executed{false, "failed"}
	}
	id, err := c.r.pushLimitChange(c.snap, l, from, to, "tighten", "owner_chat")
	if err != nil {
		return Executed{false, "failed"}
	}
	c.logLine("limit_change", "unconfirmed", map[string]any{"limit": l.ID}, map[string]string{"limit": l.ID, "path": l.Path, "change": id, "from": strconv.FormatInt(from, 10), "to": strconv.FormatInt(to, 10), "direction": "tighten", "by": "owner_chat", "state": "pending"},
		"the owner tapped yes; the runtime obeys the tighter value now and the deployer is asked to put it in the settings Guard's spec is made from")
	return Executed{true, "done"}
}

// named is limits-card.ts named: each declared limit the text names, with how many of its words are in it, most first.
func (c *conv) namedLimits(t string) []*LimitDecl {
	type hit struct {
		l     *LimitDecl
		score int
	}
	limitWordsOnce.Do(func() { _ = json.Unmarshal(limitWordsJSON, &limitWords) })
	decl := c.r.declared()
	var hits []hit
	for i := range decl {
		n := 0
		for _, w := range limitWords[decl[i].Kind].Words {
			if language.WordRe([]string{w}, "iu", true).Test(t) {
				n++
			}
		}
		if n > 0 {
			hits = append(hits, hit{&decl[i], n})
		}
	}
	sort.SliceStable(hits, func(i, j int) bool { return hits[i].score > hits[j].score })
	out := make([]*LimitDecl, len(hits))
	for i, h := range hits {
		out[i] = h.l
	}
	if len(hits) > 1 && hits[0].score == hits[1].score {
		return out[:0:0] // two limits named as much as each other: which one is not clear (readLimitRequest: "which")
	}
	return out
}

var (
	digit        = regexp.MustCompile(`\d`) // JavaScript's /\d/u: ASCII digits only, as RE2's
	phrasingOnce sync.Once
	phrasing     *language.Regex
)

// looksLikeRule is limits-card.ts looksLikeLimitRule: a digit, the phrasing of a limit and a declared limit's own word.
func (k *limitsSkill) looksLikeRule(text string) bool {
	t := language.Canon(text)
	phrasingOnce.Do(func() { phrasing = language.WordRe(assistant.Rules().LimitPhrasing, "iu", true) })
	if !digit.MatchString(t) || !phrasing.Test(t) {
		return false
	}
	limitWordsOnce.Do(func() { _ = json.Unmarshal(limitWordsJSON, &limitWords) })
	for _, l := range k.c.r.declared() {
		for _, w := range limitWords[l.Kind].Words {
			if language.WordRe([]string{w}, "iu", true).Test(t) {
				return true
			}
		}
	}
	return false
}

// onLimit is conversation.ts onLimit: the owner's words about a limit. `forced` is the limit a talk model named by id (it may only choose among the declared ones, never write a
// value). What cannot become a card is answered in words (which one, how much, not tighter); a value that tightens becomes a card.
func (c *conv) onLimit(text, forced string) {
	decl := c.r.declared()
	if c.hooks == nil || len(decl) == 0 {
		if c.hooks == nil {
			c.say("limit_which") // a listings-only shop declares no limit, so "which limit?" lists none (TypeScript's own line, empty list and all)
			return
		}
		c.say("limit_no")
		return
	}
	t := language.Canon(text)
	var l *LimitDecl
	if forced != "" {
		l = c.declaredLimit(forced)
	} else if hits := c.namedLimits(t); len(hits) > 0 {
		l = hits[0]
	}
	if l == nil {
		var names []string
		for i := range decl {
			names = append(names, decl[i].view().Name[c.lang])
		}
		c.say("limit.which.some", "names", strings.Join(names, ", "))
		return
	}
	v := l.view()
	needValue := func() {
		key := "limit.need_value.count"
		if l.Unit == "inr" {
			key = "limit.need_value.inr"
		}
		c.say(key, "name", v.Name[c.lang])
	}
	var to int64
	if l.Unit == "inr" {
		paise := assistant.AmountOf(t)
		if paise == 0 || paise%100 != 0 {
			needValue()
			return
		}
		to = paise / 100
	} else {
		m := language.P("limits.count").Find(language.P("limits.amount_words").Replace(t, " "))
		if m == nil {
			needValue()
			return
		}
		to, _ = strconv.ParseInt(m.Group(1), 10, 64)
	}
	ok, why, from := l.judge(changesOf(c.snap.assistant["limitChanges"]), to, "tighten")
	if !ok {
		if why == "not_tighter" {
			c.say("limit.not_tighter", "name", v.Name[c.lang], "now", c.valueText(v, from), "to", c.valueText(v, to))
		} else {
			needValue()
		}
		return
	}
	c.propose(assistant.Raw{"kind": jstring("limit"), "case": jstring("limit:" + l.ID), "to": jnum(to)})
}

// announceLimits is conversation.ts onTick's limits part (limits-card.ts unannounced): each change that settled since the owner was last told is marked told first (a failed send,
// such as outside the owner's 24-hour window, is not tried again every beat; the owner's app shows the state either way), then said: Active, or failed with the limit in force now.
func (c *conv) announceLimits() {
	type settled struct {
		limit, state string
		to           int64
	}
	var says []settled
	if c.hooks != nil {
		var raw []struct {
			Limit string `json:"limit"`
			State string `json:"state"`
			To    int64  `json:"to"`
			Told  any    `json:"told"`
		}
		_ = json.Unmarshal(c.snap.assistant["limitChanges"], &raw)
		for _, x := range raw {
			if x.State == "pending" || truthyJS(x.Told) {
				continue
			}
			says = append(says, settled{x.Limit, x.State, x.To})
		}
	}
	c.a.MarkChangesTold()
	for _, s := range says {
		l := c.declaredLimit(s.limit)
		if l == nil {
			continue
		}
		if s.state == "active" {
			c.sayLimit("active", l.view(), s.to, 0)
		} else {
			c.sayLimit("failed", l.view(), l.inForce(changesOf(c.snap.assistant["limitChanges"])), 0)
		}
	}
}

// truthyJS is JavaScript's truthiness of a decoded JSON value.
func truthyJS(v any) bool {
	switch x := v.(type) {
	case nil:
		return false
	case bool:
		return x
	case float64:
		return x != 0
	case string:
		return x != ""
	}
	return true
}
