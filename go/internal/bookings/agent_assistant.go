package bookings

// Bookings as a skill of the shop's assistant (item 11e): the Go twin of templates/commerce/bookings/src/assistant.ts `bookingsSkill`, and agent.ts's part that hands the skill
// its acts and turns the assistant on (wire.ts assistantForAgent, through runtime.StepContext.Assistant). The conversation itself, its cards and its words are the shared
// runtime's (internal/runtime assistant.go, assistantkit.go, assistantacts.go): there is one assistant, and this file is only what is Bookings' own.
//
// The reads (a day's list, what waits) are pure over the step's store. The acts are the agent's own paths, the same functions the fixed phrases run: cancelling releases the slot
// and refunds the deposit through the same refund path, limits and Guard as the owner's "approve b-3"; answering something waiting sends the very fixed reply the owner could type
// ("approve b-3", "retry b-3", or the UPI mark's button with its code); a move is the customer's own reschedule. Nothing here decides a refund's size beyond what was paid.
//
// A closed day: the date is in the assistant's closed days, which the free times and the within-hours limit read (agent_offer.go closedDays), and each customer booked that day
// is told through the assistant's template and stays booked. Nothing is cancelled or refunded by closing a day.
//
// A message to a chat guest ("g-3", wire.ts prepareGuestMessage) goes through the one shared runtime.PrepareGuestMessage.

import (
	"encoding/json"
	"regexp"
	"strconv"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/assistant"
	"github.com/GeometerLabs/agents/go/internal/language"
	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/payments"
	"github.com/GeometerLabs/agents/go/internal/payments/ownermarked"
	"github.com/GeometerLabs/agents/go/internal/runtime"
	speech "github.com/GeometerLabs/agents/go/internal/voice" // named speech: the package has its own type voice (agent_say.go)
	"github.com/GeometerLabs/agents/go/internal/zone"
)

// assistantOf is agent.ts `assistant`: the shop's assistant for this step, made on first use; nil when the settings have no "assistant" block.
func (a *Agent) assistantOf() *runtime.Assistant {
	if a.asst == nil && a.c != nil {
		a.asst = a.c.Assistant(runtime.AssistantHooks{
			Skill: &bookingsSkill{a}, Bookings: true, Messaging: a.msg,
			Log: func(caseID, phone, action, outcome string, inputs any, more messaging.LogMore) {
				m := logMore{refs: more.Refs, language: more.Language}
				if more.Notes != nil {
					m.notes = *more.Notes
				}
				for _, d := range more.Decisions {
					m.decisions = append(m.decisions, Decision(d))
				}
				a.log(a.store.Booking(caseID), phone, action, outcome, inputs, m)
			},
			LanguageOf: func(phone string) string { return a.languageOf(phone, nil) },
			OptedOut:   func(phone string) bool { c := a.store.FindCustomer(phone); return c != nil && c.OptedOut },
			InForce:    a.applyInForce,
		})
		if a.asst != nil && a.kit.Voice != nil {
			// the owner's voice notes (B29 with item 11e): the same shared listener as a customer's (voice allowed, the day's count, the month's spend), never leaving the owner out
			a.asst.SetListen(func(msg messaging.InboundMessage, audio *runtime.PageAudio) *speech.Heard {
				return a.c.Listen(a.kit.Voice, msg, audio, false, false)
			})
		}
	}
	return a.asst
}

// bookingsSkill is assistant.ts bookingsSkill over the step's agent.
type bookingsSkill struct{ a *Agent }

var bookingRef = regexp.MustCompile(`^[bg]-\d{1,6}$`)

// coming are the states whose customer expects to come: told when their day is closed, and again if it opens (assistant.ts COMING).
var coming = map[string]bool{Confirmed: true, NeedsOwner: true, AwaitingDeposit: true}

func (*bookingsSkill) Name() string         { return "bookings" }
func (*bookingsSkill) Owns(ref string) bool { return bookingRef.MatchString(ref) }

// whoOf is how the owner knows a customer: a name when a channel gave one (item 11d), else the number.
func (k *bookingsSkill) whoOf(b *Booking) string {
	if b.Contact != nil && b.Contact.Name != "" {
		return b.Contact.Name
	}
	if isChatConversation(b.Customer) {
		return runtime.GuestLabel(k.a.store.chanState(), b.Customer, k.a.settings.Owner.Language) // "Chat guest 3", never "chat:..."
	}
	return b.Customer
}

// what is "haircut, Wed 25 Nov, 11:00 am": the service and the slot, in the owner's language.
func (k *bookingsSkill) what(b *Booking) string {
	s := k.a.settings
	var parts []string
	if sv := s.ServiceByID(b.ServiceID); sv != nil {
		parts = append(parts, ServiceName(sv, s.Owner.Language))
	}
	if b.StartMs != nil {
		parts = append(parts, language.Formats(s.Owner.Language).Slot(*b.StartMs, s.Loc))
	}
	return strings.Join(parts, ", ")
}

func (k *bookingsSkill) onDate(b *Booking, d runtime.LocalDate) bool {
	if b.StartMs == nil {
		return false
	}
	tz := k.a.settings.Timezone
	from := zone.ZonedToMs(zone.Date{Year: d.Year, Month: d.Month, Day: d.Day}, 0, 0, tz)
	next := d.AddDays(1)
	to := zone.ZonedToMs(zone.Date{Year: next.Year, Month: next.Month, Day: next.Day}, 0, 0, tz)
	return *b.StartMs >= from && *b.StartMs < to
}

// alreadyBack is money already going back on a payment: refunds the record confirmed, and UPI refunds owed or marked sent.
func (k *bookingsSkill) alreadyBack(paymentID string) int64 {
	var paise int64
	for _, e := range k.a.c.Rec.Entries() {
		if e.Action == "refund" && e.Refs["paymentId"] == paymentID && e.Outcome == "confirmed" {
			n, _ := strconv.ParseFloat(e.Refs["amountPaise"], 64) // `Number(...) || 0`
			paise += int64(n)
		}
	}
	if l := k.a.store.ledger(false); l != nil {
		for _, r := range l.Refunds {
			if r.PaymentID == paymentID && r.State != ownermarked.RefundKept {
				paise += r.AmountPaise
			}
		}
	}
	return paise
}

// busy: a refund Guard holds or one being sent again, or a refund issue, makes the booking busy (nothing more is offered on it until that settles).
func busy(b *Booking) bool {
	for _, p := range b.Pending {
		if k := p.PendingKind(); k == "guard_hold" || k == "refund_retry" {
			return true
		}
	}
	return len(b.RefundIssues) > 0
}

func (k *bookingsSkill) aboveLimit(paise int64) bool {
	return !k.a.ownerRefunds && paise > k.a.settings.Cancellation.RefundLimitInr*100
}

// waiting is assistant.ts waitingNow: what waits for the owner, read from the owner page's own list (channel.go ownerItems), so "what needs me", the morning line's count and the
// page always show the same things. The card's fields carry the page item's digest, so a part marked since the card was made voids it on its tap.
type waiting struct {
	runtime.WaitingItem
	digest string
	reply  string // the owner's typed reply ("approve"), or a UPI mark's button id
	button bool
	code   string // E1: a price card's code, which the typed reply must carry ("approve b-3 K7M2QX")
}

// answers is assistant.ts ANSWERS.
var answers = map[string][2]string{"late_refund": {"approve", "deny"}, "calendar": {"retry", ""}, "deposit": {"received", ""}, "late_deposit": {"received", ""}, "refund_owed": {"refunded", ""},
	"discount": {"approve", "deny"}} // E1: a price card, answered with its code

func (k *bookingsSkill) waitingNow() []waiting {
	var out []waiting
	for _, it := range ownerItems(k.a.store, k.a.settings, k.a.now()) {
		b := k.a.store.Booking(it.Case)
		ans := answers[it.Kind]
		w := waiting{WaitingItem: runtime.WaitingItem{Case: it.Case, Kind: it.Kind, AmountPaise: it.AmountPaise, Money: true, Yes: ans[0], No: ans[1]}, digest: it.Digest, reply: ans[0]}
		if it.Kind == "late_deposit" {
			w.Kind = "deposit"
		}
		if b != nil {
			w.Who, w.What = k.whoOf(b), k.what(b)
		} else {
			var c struct{ Phone, Name string }
			_ = json.Unmarshal(it.Customer, &c)
			w.Who = c.Phone
			if c.Name != "" {
				w.Who = c.Name
			}
		}
		if it.Code != "" && (it.Kind == "deposit" || it.Kind == "late_deposit" || it.Kind == "refund_owed") {
			kind := ownermarked.ReplyReceived
			if it.Kind == "refund_owed" {
				kind = ownermarked.ReplyRefunded
			}
			w.reply, w.button = ownermarked.MarkButtonID(kind, it.Code), true
		}
		if it.Deal != nil {
			w.code = it.Deal.Code
		}
		out = append(out, w)
	}
	return out
}

func (k *bookingsSkill) Waiting() []runtime.WaitingItem {
	var out []runtime.WaitingItem
	for _, w := range k.waitingNow() {
		out = append(out, w.WaitingItem)
	}
	return out
}

func (k *bookingsSkill) Problems() int {
	n := 0
	for _, b := range k.a.store.Bookings {
		n += len(b.RefundIssues)
	}
	return n
}

func (k *bookingsSkill) action(kind string, b *Booking, fields assistant.Raw) assistant.Action {
	f := assistant.Raw{"who": jsonString(k.whoOf(b))}
	for key, v := range fields {
		f[key] = v
	}
	return assistant.Action{Kind: kind, Skill: "bookings", Case: b.ID, Fields: f}
}

// jsonString is a JSON string as TypeScript writes it (no HTML escaping of <, > and &).
func jsonString(s string) json.RawMessage {
	var b strings.Builder
	enc := json.NewEncoder(&b)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(s)
	return json.RawMessage(strings.TrimRight(b.String(), "\n"))
}
func jsonNum(n int64) json.RawMessage { return json.RawMessage(strconv.FormatInt(n, 10)) }

func rawStr(v json.RawMessage) string {
	var s string
	if json.Unmarshal(v, &s) == nil {
		return s
	}
	return strings.TrimSpace(string(v))
}

func rawNum(v json.RawMessage) int64 {
	var f float64
	_ = json.Unmarshal(v, &f)
	return int64(f)
}

// Prepare is assistant.ts prepare: the EXACT action from the store, or why it cannot be done.
func (k *bookingsSkill) Prepare(p assistant.Raw) (runtime.Prepared, string) {
	a := k.a
	kind, cs := rawStr(p["kind"]), rawStr(p["case"])
	// a chat guest ("g-3") has no booking: only a message to them (the one shared runtime.PrepareGuestMessage)
	optedOut := func(phone string) bool { c := a.store.FindCustomer(phone); return c != nil && c.OptedOut }
	if prep, why, ok := runtime.PrepareGuestMessage(a.store.chanState(), "bookings", kind, cs, rawStr(p["words"]), a.settings.Owner.Language, optedOut); ok {
		return prep, why
	}
	b := a.store.Booking(cs)
	if b == nil {
		return runtime.Prepared{}, "no_case"
	}
	if kind == "answer" {
		itemKind := rawStr(p["itemKind"])
		for _, w := range k.waitingNow() {
			if w.Case == b.ID && w.Kind == itemKind {
				act := k.action("answer", b, assistant.Raw{"itemKind": jsonString(w.Kind), "answer": p["answer"], "pageDigest": jsonString(w.digest), "amountPaise": jsonNum(w.AmountPaise)})
				return runtime.Prepared{Action: act, Shown: runtime.Shown{Who: w.Who, What: w.What, AmountPaise: w.AmountPaise}}, ""
			}
		}
		return runtime.Prepared{}, "nothing_waiting"
	}
	if kind == "message" {
		// the owner's words go as typed; an amount in them must be one this booking has (its deposit or its service's price): money back is a refund, with its own card
		words := rawStr(p["words"])
		if c := a.store.FindCustomer(b.Customer); c != nil && c.OptedOut {
			return runtime.Prepared{}, "opted_out"
		}
		if amount := assistant.AmountOf(words); amount > 0 {
			ok := amount == a.settings.Deposit.AmountInr*100
			if b.DepositInr != nil {
				ok = ok || amount == *b.DepositInr*100
			}
			if sv := a.settings.ServiceByID(b.ServiceID); sv != nil {
				ok = ok || amount == sv.PriceInr*100
			}
			if price, has := a.agreedPriceInr(b); has {
				ok = ok || amount == price*100 // E1: a price the agent or the owner agreed is this booking's own
			}
			if !ok {
				return runtime.Prepared{}, "amount_not_on_record"
			}
		}
		act := k.action("message", b, assistant.Raw{"phone": jsonString(b.Customer), "words": jsonString(words)})
		return runtime.Prepared{Action: act, Shown: runtime.Shown{Who: k.whoOf(b), What: k.what(b), Words: words, HasWords: true}}, ""
	}
	if busy(b) {
		return runtime.Prepared{}, "busy"
	}
	start := int64(0)
	if b.StartMs != nil {
		start = *b.StartMs
	}
	if kind == "cancel" {
		if b.State == AwaitingDeposit {
			act := k.action("cancel", b, assistant.Raw{"state": jsonString(b.State), "startMs": jsonNum(start), "amountPaise": jsonNum(0)})
			return runtime.Prepared{Action: act, Shown: runtime.Shown{Who: k.whoOf(b), What: k.what(b)}}, ""
		}
		if b.State != Confirmed && b.State != NeedsOwner {
			if b.State == Enquiry || b.State == ConfirmingDetails {
				return runtime.Prepared{}, "not_booked"
			}
			return runtime.Prepared{}, "not_live"
		}
		var back int64
		if b.DepositPaymentID != "" && b.DepositInr != nil {
			back = max(0, *b.DepositInr*100-k.alreadyBack(b.DepositPaymentID))
		}
		if back == 0 {
			return runtime.Prepared{}, "already_back"
		}
		act := k.action("cancel", b, assistant.Raw{"state": jsonString(b.State), "startMs": jsonNum(start), "paymentId": jsonString(b.DepositPaymentID), "amountPaise": jsonNum(back)})
		return runtime.Prepared{Action: act, Shown: runtime.Shown{Who: k.whoOf(b), What: k.what(b), AmountPaise: back}, AboveLimit: k.aboveLimit(back)}, ""
	}
	// a refund: of what was paid on this booking's deposit, less what is already going back; only once the booking no longer stands
	if b.State == Confirmed || b.State == NeedsOwner {
		return runtime.Prepared{}, "cancel_first"
	}
	if b.DepositPaymentID == "" || b.DepositInr == nil {
		return runtime.Prepared{}, "nothing_paid"
	}
	available := max(0, *b.DepositInr*100-k.alreadyBack(b.DepositPaymentID))
	if available == 0 {
		return runtime.Prepared{}, "nothing_paid"
	}
	amount := available
	if v, ok := p["amountPaise"]; ok {
		amount = rawNum(v)
	}
	if amount > available || amount%100 != 0 { // refunds go in whole rupees, as the shop's settings are
		return runtime.Prepared{}, "too_much"
	}
	act := k.action("refund", b, assistant.Raw{"paymentId": jsonString(b.DepositPaymentID), "amountPaise": jsonNum(amount), "availablePaise": jsonNum(available)})
	return runtime.Prepared{Action: act, Shown: runtime.Shown{Who: k.whoOf(b), What: k.what(b), AmountPaise: amount}, AboveLimit: k.aboveLimit(amount)}, ""
}

// Execute is assistant.ts execute: the card's saved action, through the agent's own paths.
func (k *bookingsSkill) Execute(act assistant.Action) runtime.Executed {
	a := k.a
	b := a.store.Booking(act.Case)
	if b == nil {
		return runtime.Executed{OK: false, Note: "failed"}
	}
	ofRefund := func(r string, err error) runtime.Executed {
		switch {
		case err != nil:
			a.stepErr = err
			return runtime.Executed{OK: false, Note: "failed"}
		case r == "owed":
			return runtime.Executed{OK: true, Note: "owed_by_owner"}
		case r == "done":
			return runtime.Executed{OK: true, Note: "done"}
		case r == "held":
			return runtime.Executed{OK: true, Note: "held_by_guard"}
		}
		return runtime.Executed{OK: false, Note: "failed"}
	}
	switch act.Kind {
	case "answer":
		var item *waiting
		for _, w := range k.waitingNow() {
			if w.Case == b.ID && w.Kind == rawStr(act.Fields["itemKind"]) {
				item = &w
				break
			}
		}
		if item == nil {
			return runtime.Executed{OK: false, Note: "failed"}
		}
		// the same reply the owner could give: typed for the agent's own asks, the mark's button (with its code) for a UPI mark (wire.ts ownerReply)
		now := a.now()
		msg := messaging.InboundMessage{ID: "assistant:" + b.ID + ":" + strconv.FormatInt(now, 10), From: a.owner(), Timestamp: now}
		if item.button {
			msg.Reply = &messaging.Reply{ID: item.reply, Kind: "button"}
		} else {
			reply := item.reply
			if rawStr(act.Fields["answer"]) == "no" && item.No != "" {
				reply = item.No
			}
			msg.Text = reply + " " + b.ID
			if item.code != "" {
				msg.Text += " " + item.code // the card's action carried the item's digest, which is over this code: a changed ask made the card "changed" before here
			}
		}
		if err := a.onOwnerMessage(msg); err != nil {
			a.stepErr = err
		}
		return runtime.Executed{OK: true, Note: "done"}
	case "cancel":
		why := "cancelled by the owner through the shop's assistant"
		if b.State == AwaitingDeposit {
			if err := a.cancelWaiting(b, why); err != nil {
				a.stepErr = err
			}
			a.tellCustomer(b, b.Customer, []string{"cancelled_no_deposit"}, sayOpts{})
			return runtime.Executed{OK: true, Note: "done"}
		}
		// the same steps as the owner's "approve b-3" on a booking the calendar could not confirm, then the deposit back
		b.Pending = []payments.Pending{}
		a.releaseSlot(b, why)
		b.setReminders([]Reminder{})
		_ = b.MoveTo(Cancelled)
		a.log(b, b.Customer, "cancel_booking", "confirmed", map[string]any{"by": "owner"}, logMore{refs: map[string]string{"by": "owner", "via": "assistant"}})
		return ofRefund(a.ownerCancelRefund(b, rawNum(act.Fields["amountPaise"])/100, why, "upi_cancelled_refund_owed", "cancelled_refund"))
	case "refund":
		return ofRefund(a.ownerCancelRefund(b, rawNum(act.Fields["amountPaise"])/100, "refunded by the owner through the shop's assistant", "upi_refund_owed", "refund_approved"))
	}
	return runtime.Executed{OK: false, Note: "failed"}
}

// ownerCancelRefund is agent.ts ownerCancelRefund: the refund the owner asked for, with its limit; a UPI shop's owner owes it.
func (a *Agent) ownerCancelRefund(b *Booking, amountInr int64, why, upi, done string) (string, error) {
	paid := amountInr
	if b.DepositInr != nil {
		paid = *b.DepositInr
	}
	limit := CheckRefundLimit(amountInr, a.settings.Cancellation.RefundLimitInr, paid, true, true)
	if a.ownerRefunds {
		a.oweBack(b, b.DepositPaymentID, amountInr*100, why, oweOpts{customer: upi, decisions: []Decision{limit}})
		return "owed", nil
	}
	result, err := a.requestRefund(b, b.DepositPaymentID, amountInr, []Decision{limit}, a.refunds.OverLimit(amountInr), nil)
	if err != nil {
		return "", err
	}
	a.afterRefund(b, result, payments.RefundAfter{PaymentID: b.DepositPaymentID, AmountInr: amountInr, DoneCust: done, Held: "cancelled_refund_pending"})
	return result, nil
}

// Day is assistant.ts `day`: the confirmed and waiting-for-the-owner bookings of a date, by time.
func (k *bookingsSkill) Day(d runtime.LocalDate) []runtime.DayRow {
	s := k.a.settings
	var rows []runtime.DayRow
	for _, b := range k.a.store.Bookings {
		if (b.State != Confirmed && b.State != NeedsOwner) || !k.onDate(b, d) {
			continue
		}
		what := ""
		if sv := s.ServiceByID(b.ServiceID); sv != nil {
			what = ServiceName(sv, s.Owner.Language)
		}
		rows = append(rows, runtime.DayRow{Case: b.ID, StartMs: *b.StartMs, What: what, Who: k.whoOf(b), State: b.State})
	}
	sortRows(rows)
	return rows
}

func sortRows(rows []runtime.DayRow) {
	for i := 1; i < len(rows); i++ { // a stable insertion sort by start, as Array.prototype.sort is stable
		for j := i; j > 0 && rows[j].StartMs < rows[j-1].StartMs; j-- {
			rows[j], rows[j-1] = rows[j-1], rows[j]
		}
	}
}

// Hours is assistant.ts `hours`: the opening hours on that date's weekday (ok false: always closed that weekday).
func (k *bookingsSkill) Hours(d runtime.LocalDate) (open, close int, ok bool) {
	h := k.a.settings.OpeningHours[zone.WeekdayOf(zone.Date{Year: d.Year, Month: d.Month, Day: d.Day})]
	if h == nil {
		return 0, 0, false
	}
	return h.Open, h.Close, true
}

// CloseDay is assistant.ts closeDay: every booking that day, told or not (the owner calls the ones the message could not reach); a customer who sent STOP is not told.
func (k *bookingsSkill) CloseDay(d runtime.LocalDate, notify runtime.DayNotice) (booked []runtime.Booked, told []string) {
	for _, b := range k.a.store.Bookings {
		if !coming[b.State] || !k.onDate(b, d) {
			continue
		}
		booked = append(booked, runtime.Booked{Case: b.ID, Who: k.whoOf(b)})
		if c := k.a.store.FindCustomer(b.Customer); (c == nil || !c.OptedOut) && notify(b.ID, b.Customer, *b.StartMs) {
			told = append(told, b.ID)
		}
	}
	return booked, told
}

// ReopenDay is assistant.ts reopenDay: only those still on that day and still coming are told (one who moved or cancelled has their own news already).
func (k *bookingsSkill) ReopenDay(d runtime.LocalDate, asked []string, notify runtime.DayNotice) (told []string) {
	for _, id := range asked {
		b := k.a.store.Booking(id)
		if b == nil || !coming[b.State] || !k.onDate(b, d) {
			continue
		}
		if c := k.a.store.FindCustomer(b.Customer); c != nil && c.OptedOut {
			continue
		}
		if notify(b.ID, b.Customer, *b.StartMs) {
			told = append(told, b.ID)
		}
	}
	return told
}

// MoveTarget is assistant.ts moveTarget: the new start from the date and time the owner named (the old ones where they named none).
func (k *bookingsSkill) MoveTarget(caseID string, date *runtime.LocalDate, tm *language.TimePhrase) (int64, string) {
	b := k.a.store.Booking(caseID)
	if b == nil {
		return 0, "no_case"
	}
	if b.State != Confirmed || b.StartMs == nil {
		return 0, "not_live"
	}
	s := k.a.settings
	was := zone.LocalParts(*b.StartMs, s.Timezone)
	d := was.Date
	if date != nil {
		d = zone.Date{Year: date.Year, Month: date.Month, Day: date.Day}
	}
	hour, minute := was.Hour, was.Minute
	if tm != nil {
		t, _ := resolveTime(TimePhrase{tm.Hour, tm.Minute, tm.Period}, s.OpeningHours[zone.WeekdayOf(d)])
		hour, minute = t.Hour, t.Minute
	}
	return zone.ZonedToMs(d, hour, minute, s.Timezone), ""
}

// Move is assistant.ts move: checked first without a word to anyone (so a time that cannot be had never reaches the customer as "that time is not free"), then the agent's own
// reschedule, as the customer's own yes applies it.
func (k *bookingsSkill) Move(caseID string, startMs int64) (fromMs, toMs int64, why string) {
	a := k.a
	b := a.store.Booking(caseID)
	if b == nil {
		return 0, 0, "no_case"
	}
	if b.State != Confirmed || b.StartMs == nil || b.EndMs == nil {
		return 0, 0, "not_live"
	}
	fromMs = *b.StartMs
	endMs := startMs + (*b.EndMs - *b.StartMs)
	if startMs <= a.now() {
		return 0, 0, "past"
	}
	hours, clash, err := a.slotRules(b, startMs, endMs)
	if err != nil {
		a.stepErr = err
		return 0, 0, "failed"
	}
	if hours.Blocked() {
		return 0, 0, "outside_hours"
	}
	if clash.Blocked() {
		return 0, 0, "taken"
	}
	p := zone.LocalParts(startMs, a.settings.Timezone)
	h := p.Hour % 12
	if h == 0 {
		h = 12
	}
	period := "pm"
	if p.Hour < 12 {
		period = "am"
	}
	b.setReschedule(&move{Date: p.Date, TimePhrase: TimePhrase{h, p.Minute, period}, StartMs: startMs, EndMs: endMs})
	if err := a.applyReschedule(b); err != nil {
		a.stepErr = err
		return 0, 0, "failed"
	}
	if b.StartMs == nil || *b.StartMs != startMs {
		return 0, 0, "failed"
	}
	return fromMs, startMs, ""
}
