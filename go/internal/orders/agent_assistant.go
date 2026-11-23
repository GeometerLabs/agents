package orders

// Orders as a skill of the shop's assistant (item 11e): the Go twin of templates/commerce/orders/src/assistant.ts `ordersSkill`, and agent.ts's part that hands the skill its
// acts and turns the assistant on (modules/assistant/wire.ts assistantForAgent, through runtime.StepContext.Assistant), filling the agent's `assistant` seam (agent_seams.go).
// The conversation itself, its cards and its words are the shared runtime's (internal/runtime assistant.go, assistantkit.go, assistantopen.go): there is one assistant, and this
// file is only what is Orders' own. Modelled on internal/bookings/agent_assistant.go, with Orders' own rules where assistant.ts differs from Bookings'.
//
// The reads (the open orders, what waits, the numbers for the owner's talk) are pure over the step's store. What waits is read from the owner page's own list (channel.go
// OwnerItems), so "what needs me", the morning line's count, the mood and the owner's page always show the same things. The acts are the agent's own paths: cancelling a paid
// order frees its stock (it is no longer confirmed) and refunds exactly the card's amount through the same refund path, limits and Guard as the owner's "approve o-5"; answering
// something waiting sends the very fixed reply the owner could type ("approve o-3", "deny o-3", or the UPI mark's button with its code). Nothing here decides a refund's size
// beyond what was paid.
//
// HOW EACH LINE IS WRITTEN: this file writes no words. The owner reads the shared runtime's packed words (internal/assistant/words, made by go/scripts/gen_words.ts from
// modules/assistant/words.ts), filled with what this skill hands it: a row's who, what and case and a card's who and what go into the key's literal slots, which the Writer notes
// as literals; an amount goes in as paise and is written in the {inr} slot, which the Writer reads back as an amount; a count goes in {n}. The open orders' list (open_list.*),
// the big order's card (card.answer.big_order), Orders' cancel and refund cards (card.*@orders: "advance", not "deposit") and its two refusals (refusal.*@orders) are new keys
// of that generator. The sources for the owner's talk (Facts, PublicContext) are data for the model, never shown as they are; the talk's reply is checked against them.

import (
	"encoding/json"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/GeometerLabs/agents/go/internal/assistant"
	"github.com/GeometerLabs/agents/go/internal/discounts"
	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/payments"
	"github.com/GeometerLabs/agents/go/internal/payments/ownermarked"
	"github.com/GeometerLabs/agents/go/internal/runtime"
	"github.com/GeometerLabs/agents/go/internal/voice"
	"github.com/GeometerLabs/agents/go/internal/zone"
)

func init() {
	assistantFor = func(a *Agent) *runtime.Assistant {
		as := a.c.Assistant(runtime.AssistantHooks{
			Skill: &ordersSkill{a: a, acts: true}, Orders: true, Messaging: a.msg,
			Log: func(caseID, phone, action, outcome string, inputs any, more messaging.LogMore) {
				m := logMore{refs: more.Refs, language: more.Language}
				if more.Notes != nil {
					m.notes = *more.Notes
				}
				for _, d := range more.Decisions {
					m.decisions = append(m.decisions, Decision(d))
				}
				a.log(a.store.Order(caseID), phone, action, outcome, inputs, m)
			},
			LanguageOf: func(phone string) string { return a.languageOf(phone, nil) },
			OptedOut:   func(phone string) bool { c := a.store.FindCustomer(phone); return c != nil && c.OptedOut },
			// a limit the owner tightened by a tap is in force for the rest of the same step (runtime-limits.ts applyInForce)
			InForce: func() { a.settings = a.inForce(a.settings) },
		})
		if as != nil && a.kit.Voice != nil {
			// the owner's voice notes (B29 with item 11e): the same shared listener as a customer's (voice allowed, the day's count, the month's spend), never leaving the owner out
			as.SetListen(func(msg messaging.InboundMessage, audio *runtime.PageAudio) *voice.Heard {
				return a.c.Listen(a.kit.Voice, msg, audio, false, false)
			})
		}
		return as
	}
}

// ordersSkill is assistant.ts ordersSkill over the step's agent. acts: the agent's own cancel and refund paths are handed in (false: a read-only skill, for the morning line and
// the owner's page, over the last saved state).
type ordersSkill struct {
	a    *Agent
	acts bool
}

var (
	_ runtime.OwnerSkill     = (*ordersSkill)(nil)
	_ runtime.OpenSkill      = (*ordersSkill)(nil)
	_ runtime.TalkFactsSkill = (*ordersSkill)(nil)
	_ runtime.PublicSkill    = (*ordersSkill)(nil)
)

// readSkill is the read-only skill over a store with no step (server/runtime.ts skillOver): the owner's page, the page's character.
func (k *Kit) readSkill(st *Store) *ordersSkill {
	a := &Agent{kit: k, store: st, settings: k.Settings, can: k.Ports.Capabilities}
	a.ownerConfirms, a.ownerRefunds = !a.can.ConfirmsAutomatically, !a.can.RefundsAutomatically
	return &ordersSkill{a: a}
}

var orderRef = regexp.MustCompile(`^[og]-\d{1,6}$`)

// openStates is assistant.ts OPEN: the orders the owner thinks of as open.
var openStates = []string{AwaitingOwner, AwaitingAdvance, Confirmed}

func (*ordersSkill) Name() string         { return "orders" }
func (*ordersSkill) Owns(ref string) bool { return orderRef.MatchString(ref) }

// whoOf is how the owner knows a customer: the name typed on the shop's page, else the number (the typed one for a page order), a chat guest "Chat guest 3", never "chat:...".
func (k *ordersSkill) whoOf(o *Order) string {
	if o.Contact != nil {
		if o.Contact.Name != "" {
			return o.Contact.Name
		}
		return o.Contact.Phone
	}
	if runtime.IsChatConversation(o.Customer) {
		return k.a.store.guestLabel(o.Customer, k.a.settings.Owner.Language)
	}
	return o.Customer
}

// what is "2 × cake, 1 × bread" in the owner's language, or a plan's period as the owner's page names it.
func (k *ordersSkill) what(o *Order) string {
	s := k.a.settings
	if o.Plan != nil {
		return s.OrderWhat(o, s.Owner.Language)
	}
	return s.ItemsText(o.Lines, s.Owner.Language)
}

// Open is skill.ts `open`: the open orders, and (a shop with plans) tomorrow's meals for each slot, read from the plans' ledger.
func (k *ordersSkill) Open() []runtime.OpenRow {
	var rows []runtime.OpenRow
	for _, o := range k.a.store.Orders {
		if contains(openStates, o.State) {
			var total int64
			if o.TotalInr != nil {
				total = *o.TotalInr
			}
			rows = append(rows, runtime.OpenRow{Case: o.ID, Who: k.whoOf(o), What: k.what(o), AmountPaise: total * 100, State: o.State})
		}
	}
	if k.a.settings.Plans != nil {
		_, slots, counts := k.a.store.PlansState(false).mealsTomorrow(k.a.settings.Timezone, k.a.now())
		for i, slot := range slots {
			rows = append(rows, runtime.OpenRow{Case: "plan-" + slot, Who: "Monthly plans", What: strconv.Itoa(counts[i]) + " meals tomorrow, " + slot, State: "plan_meals"})
		}
	}
	return rows
}

// ---- what waits for the owner -------------------------------------------------------------------------------------------------------------------------------------------

// waiting is assistant.ts Waiting: an item as a card shows it, the page item's digest its card is bound to, and what a yes sends.
type waiting struct {
	runtime.WaitingItem
	digest string
	button string // a UPI mark's button id ("" : the owner's typed reply)
}

// answers is assistant.ts ANSWERS.
var answers = map[string][2]string{"big_order": {"approve", "deny"}, "late_refund": {"approve", "deny"}, "deposit": {"received", ""}, "late_deposit": {"received", ""}, "refund_owed": {"refunded", ""}}

func (k *ordersSkill) waitingNow() []waiting {
	a := k.a
	items, _ := a.settings.OwnerItems(a.store, a.now())
	var out []waiting
	for _, it := range items {
		o := a.store.Order(it.Case)
		ans := answers[it.Kind]
		w := waiting{WaitingItem: runtime.WaitingItem{Case: it.Case, Kind: it.Kind, AmountPaise: it.AmountPaise, Money: true, Yes: ans[0], No: ans[1]}, digest: it.Digest}
		if it.Kind == "late_deposit" {
			w.Kind = "deposit" // the "time ran out" advance is asked as the advance is: the same mark, the same button
		}
		if o != nil {
			w.Who, w.What = k.whoOf(o), k.what(o)
		} else {
			var c struct{ Phone, Name string }
			_ = json.Unmarshal(it.Customer, &c)
			w.Who, w.What = c.Phone, it.What
			if c.Name != "" {
				w.Who = c.Name
			}
		}
		if it.Code != "" && (it.Kind == "deposit" || it.Kind == "late_deposit" || it.Kind == "refund_owed") {
			kind := ownermarked.ReplyReceived
			if it.Kind == "refund_owed" {
				kind = ownermarked.ReplyRefunded
			}
			w.button = ownermarked.MarkButtonID(kind, it.Code)
		}
		out = append(out, w)
	}
	return out
}

func (k *ordersSkill) waitingOn(o *Order, kind string) *waiting {
	for _, w := range k.waitingNow() {
		if w.Case == o.ID && w.Kind == kind {
			return &w
		}
	}
	return nil
}

func (k *ordersSkill) Waiting() []runtime.WaitingItem {
	var out []runtime.WaitingItem
	for _, w := range k.waitingNow() {
		out = append(out, w.WaitingItem)
	}
	return out
}

func (k *ordersSkill) Problems() int {
	n := 0
	for _, o := range k.a.store.Orders {
		n += len(o.RefundIssues)
	}
	return n
}

// ---- cancel and refund from the chat --------------------------------------------------------------------------------------------------------------------------------------

// alreadyBack is money already going back on a payment: refunds the record confirmed (none for a read-only skill, which has no record), and UPI refunds owed or marked sent.
func (k *ordersSkill) alreadyBack(paymentID string) int64 {
	var paise int64
	if k.a.c != nil {
		for _, e := range k.a.c.Rec.Entries() {
			if e.Action == "refund" && e.Refs["paymentId"] == paymentID && e.Outcome == "confirmed" {
				n, _ := strconv.ParseFloat(e.Refs["amountPaise"], 64) // `Number(...) || 0`
				paise += int64(n)
			}
		}
	}
	if l := k.a.store.Ledger(false); l != nil {
		for _, r := range l.Refunds {
			if r.PaymentID == paymentID && r.State != ownermarked.RefundKept {
				paise += r.AmountPaise
			}
		}
	}
	return paise
}

// busy: a refund Guard holds or one being sent again, or a refund issue: nothing more is offered on the order until that settles.
func busy(o *Order) bool {
	for _, p := range o.Pending {
		if kind := p.PendingKind(); kind == "guard_hold" || kind == "refund_retry" {
			return true
		}
	}
	return len(o.RefundIssues) > 0
}

// aboveLimit is assistant.ts aboveLimit: `!deps.acts?.ownerRefunds && paise > limit` (a read-only skill has no acts, so it is never the owner's to send).
func (k *ordersSkill) aboveLimit(paise int64) bool {
	return !(k.acts && k.a.ownerRefunds) && paise > k.a.settings.Refund.LimitInr*100
}

func (k *ordersSkill) action(kind string, o *Order, fields assistant.Raw) assistant.Action {
	f := assistant.Raw{"who": jsonOf(k.whoOf(o))}
	for key, v := range fields {
		f[key] = v
	}
	return assistant.Action{Kind: kind, Skill: "orders", Case: o.ID, Fields: f}
}

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

func jnum(n int64) json.RawMessage { return json.RawMessage(strconv.FormatInt(n, 10)) }

// Prepare is assistant.ts prepare: the EXACT action from the store, or why it cannot be done.
func (k *ordersSkill) Prepare(p assistant.Raw) (runtime.Prepared, string) {
	a := k.a
	kind, cs := rawStr(p["kind"]), rawStr(p["case"])
	// a chat guest ("g-3") has no order: only a message to them (the one shared runtime.PrepareGuestMessage)
	optedOut := func(phone string) bool { c := a.store.FindCustomer(phone); return c != nil && c.OptedOut }
	if prep, why, ok := runtime.PrepareGuestMessage(a.store.channelRead(), "orders", kind, cs, rawStr(p["words"]), a.settings.Owner.Language, optedOut); ok {
		return prep, why
	}
	o := a.store.Order(cs)
	if o == nil {
		return runtime.Prepared{}, "no_case"
	}
	if kind == "answer" {
		item := k.waitingOn(o, rawStr(p["itemKind"]))
		if item == nil {
			return runtime.Prepared{}, "nothing_waiting"
		}
		// a mark has no "no": the owner who has not had the money simply does not press
		if rawStr(p["answer"]) == "no" && item.No == "" {
			return runtime.Prepared{}, "nothing_waiting"
		}
		act := k.action("answer", o, assistant.Raw{"itemKind": jsonOf(item.Kind), "answer": p["answer"], "pageDigest": jsonOf(item.digest), "amountPaise": jnum(item.AmountPaise)})
		return runtime.Prepared{Action: act, Shown: runtime.Shown{Who: item.Who, What: item.What, AmountPaise: item.AmountPaise}}, ""
	}
	if kind == "message" {
		// the owner's words go as typed; an amount in them must be this order's total or its advance: money back is a refund, with its own card (wire.ts checkWords)
		words := rawStr(p["words"])
		if c := a.store.FindCustomer(o.Customer); c != nil && c.OptedOut {
			return runtime.Prepared{}, "opted_out"
		}
		if amount := assistant.AmountOf(words); amount > 0 {
			ok := (o.TotalInr != nil && amount == *o.TotalInr*100) || (o.AdvanceInr != nil && amount == *o.AdvanceInr*100)
			if !ok {
				return runtime.Prepared{}, "amount_not_on_record"
			}
		}
		act := k.action("message", o, assistant.Raw{"phone": jsonOf(o.Customer), "words": jsonOf(words)})
		return runtime.Prepared{Action: act, Shown: runtime.Shown{Who: k.whoOf(o), What: k.what(o), Words: words, HasWords: true}}, ""
	}
	if busy(o) {
		return runtime.Prepared{}, "busy"
	}
	start := int64(0)
	if o.SlotStartMs != nil {
		start = *o.SlotStartMs
	}
	if kind == "cancel" {
		// an order nothing was paid on (waiting for its advance, or for the owner's yes to a big one): the hold and the link end
		if o.State == AwaitingAdvance || o.State == AwaitingOwner {
			act := k.action("cancel", o, assistant.Raw{"state": jsonOf(o.State), "startMs": jnum(start), "amountPaise": jnum(0)})
			return runtime.Prepared{Action: act, Shown: runtime.Shown{Who: k.whoOf(o), What: k.what(o)}}, ""
		}
		if o.State != Confirmed {
			if o.State == Enquiry {
				return runtime.Prepared{}, "not_booked"
			}
			return runtime.Prepared{}, "not_live"
		}
		var back int64
		if o.AdvancePaymentID != "" && o.AdvanceInr != nil {
			back = max(0, *o.AdvanceInr*100-k.alreadyBack(o.AdvancePaymentID))
		}
		if back == 0 {
			return runtime.Prepared{}, "already_back"
		}
		act := k.action("cancel", o, assistant.Raw{"state": jsonOf(o.State), "startMs": jnum(start), "paymentId": jsonOf(o.AdvancePaymentID), "amountPaise": jnum(back)})
		return runtime.Prepared{Action: act, Shown: runtime.Shown{Who: k.whoOf(o), What: k.what(o), AmountPaise: back}, AboveLimit: k.aboveLimit(back)}, ""
	}
	// a refund: of what was paid as the advance, less what is already going back; only once the order no longer stands (an order that stands is cancelled, with its own card)
	if o.State == Confirmed {
		return runtime.Prepared{}, "cancel_first"
	}
	if o.AdvancePaymentID == "" || o.AdvanceInr == nil {
		return runtime.Prepared{}, "nothing_paid"
	}
	available := max(0, *o.AdvanceInr*100-k.alreadyBack(o.AdvancePaymentID))
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
	act := k.action("refund", o, assistant.Raw{"paymentId": jsonOf(o.AdvancePaymentID), "amountPaise": jnum(amount), "availablePaise": jnum(available)})
	return runtime.Prepared{Action: act, Shown: runtime.Shown{Who: k.whoOf(o), What: k.what(o), AmountPaise: amount}, AboveLimit: k.aboveLimit(amount)}, ""
}

// Execute is assistant.ts execute: the card's saved action, through the agent's own paths.
func (k *ordersSkill) Execute(act assistant.Action) runtime.Executed {
	a := k.a
	o := a.store.Order(act.Case)
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
	if k.acts && o != nil && (act.Kind == "cancel" || act.Kind == "refund") {
		if act.Kind == "refund" {
			return ofRefund(a.ownerCancelRefund(o, rawNum(act.Fields["amountPaise"])/100, "refunded by the owner through the shop's assistant", "upi_refund_owed", "refund_approved"))
		}
		why := "cancelled by the owner through the shop's assistant"
		if o.State == AwaitingAdvance || o.State == AwaitingOwner {
			if err := a.ownerCancelWaiting(o, why); err != nil {
				a.stepErr = err
			}
			a.tellCustomer(o, o.Customer, []string{"cancelled_no_advance"}, sayOpts{})
			return runtime.Executed{OK: true, Note: "done"}
		}
		return ofRefund(a.ownerCancelPaid(o, rawNum(act.Fields["amountPaise"])/100, why))
	}
	if !k.acts || o == nil || act.Kind != "answer" {
		return runtime.Executed{OK: false, Note: "failed"}
	}
	item := k.waitingOn(o, rawStr(act.Fields["itemKind"]))
	if item == nil {
		return runtime.Executed{OK: false, Note: "failed"}
	}
	// the very reply the owner could give on WhatsApp (wire.ts ownerReply): the mark's button (with its code), or "approve o-3" / "deny o-3"
	now := a.now()
	msg := messaging.InboundMessage{ID: "assistant:" + o.ID + ":" + strconv.FormatInt(now, 10), From: a.owner(), Timestamp: now}
	no := rawStr(act.Fields["answer"]) == "no"
	if item.button != "" && !no {
		msg.Reply = &messaging.Reply{ID: item.button, Kind: "button"}
	} else {
		reply := item.Yes
		if no {
			reply = item.No
		}
		msg.Text = reply + " " + o.ID
	}
	if err := a.onOwnerMessage(msg); err != nil {
		a.stepErr = err
	}
	return runtime.Executed{OK: true, Note: "done"}
}

// ownerCancelPaid is agent.ts acts.cancelPaid: a confirmed order the owner cancels: its stock is free at once (it is no longer confirmed), then exactly `back` of the advance goes
// back. Never asks the owner again: the owner is the one asking.
func (a *Agent) ownerCancelPaid(o *Order, back int64, why string) (string, error) {
	o.Pending = []payments.Pending{}
	o.setReminders(nil)
	if err := o.MoveTo(Cancelled); err != nil {
		return "", err
	}
	a.log(o, o.Customer, "cancel_order", "confirmed", map[string]any{"by": "owner"}, logMore{refs: map[string]string{"by": "owner", "via": "assistant"}, notes: why})
	a.closeBalanceLink(o)
	return a.ownerCancelRefund(o, back, why, "upi_cancelled_refund_owed", "cancelled_refund")
}

// ownerCancelWaiting is agent.ts acts.cancelWaiting: an order waiting for the owner's yes is cancelled where it is; one waiting for its advance goes through the agent's cancelWaiting.
func (a *Agent) ownerCancelWaiting(o *Order, why string) error {
	if o.State == AwaitingOwner {
		if err := o.MoveTo(Cancelled); err != nil {
			return err
		}
		o.Pending = []payments.Pending{}
		a.log(o, o.Customer, "cancel_order", "confirmed", map[string]any{"state": AwaitingOwner, "by": "owner"}, logMore{refs: map[string]string{"by": "owner", "via": "assistant"}, notes: why})
		return nil
	}
	return a.cancelWaiting(o, why)
}

// ownerCancelRefund is agent.ts ownerCancelRefund: the refund the owner asked for, with its limit (the owner approved it); a UPI shop's owner owes it. Above the limit Guard holds it
// as it holds the owner's "approve o-5", naming the owner as asking when there are other approvers.
func (a *Agent) ownerCancelRefund(o *Order, amountInr int64, why, upi, done string) (string, error) {
	paid := amountInr
	if o.AdvanceInr != nil {
		paid = *o.AdvanceInr
	}
	limit := checkRefundLimit(refundAsk{amountInr: amountInr, limitInr: a.settings.Refund.LimitInr, paidInr: paid, ownerApproved: true})
	if a.ownerRefunds {
		a.oweBack(o, o.AdvancePaymentID, amountInr*100, why, oweOpts{customer: upi, decisions: []Decision{limit}})
		return "owed", nil
	}
	asked := a.askedByOwner()
	result, err := a.requestRefund(o, o.AdvancePaymentID, amountInr, []Decision{limit}, a.refunds.OverLimit(amountInr), asked)
	if err != nil {
		return "", err
	}
	a.afterRefund(o, result, payments.RefundAfter{PaymentID: o.AdvancePaymentID, AmountInr: amountInr, DoneCust: done, Held: "cancelled_refund_pending", RequestedBy: asked})
	return result, nil
}

// ---- the reads the owner's talk rests on (assistant.ts talkReads) ---------------------------------------------------------------------------------------------------------

// PublicContext is skill.ts `publicContext`: what a customer may be told (agent_talk.go publicContext), which the owner's talk reads with no customer.
func (k *ordersSkill) PublicContext(phone string, _ int64) []assistant.TalkSource {
	return k.a.publicContext(phone)
}

// weekdayEn is assistant.ts WEEKDAY_EN.
var weekdayEn = []string{"Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"}

// Facts is skill.ts `facts` for Orders (talkReads): the owner's numbers, counts and money only, never a customer's name or number; word for word TypeScript's English (data for
// the model, never shown as they are). A day is a fixed 24 hours (assistant.ts DAY_MS: India keeps no summer time).
func (k *ordersSkill) Facts(nowMs int64) []assistant.TalkSource {
	s, st := k.a.settings, k.a.store
	tz := s.Timezone
	start := zone.ZonedToMs(zone.LocalParts(nowMs, tz).Date, 0, 0, tz)
	day := zone.Day
	counted := func(o *Order) bool { return o.State == Confirmed || o.State == Completed }
	at := func(o *Order) int64 {
		if o.SlotStartMs != nil {
			return *o.SlotStartMs
		}
		return 0
	}
	pick := func(from, to int64) []*Order {
		var out []*Order
		for _, o := range st.Orders {
			if counted(o) && at(o) >= from && at(o) < to {
				out = append(out, o)
			}
		}
		return out
	}
	money := func(list []*Order) int64 {
		var n int64
		for _, o := range list {
			if o.TotalInr != nil {
				n += *o.TotalInr
			}
		}
		return n
	}
	today, last7, next7 := pick(start, start+day), pick(start-7*day, start), pick(start, start+7*day)
	out := []assistant.TalkSource{
		{ID: "r:today", Kind: "record", Text: "Orders for today: " + strconv.Itoa(len(today)) + ", worth " + inr(money(today)) + ".", AmountsInr: []float64{float64(money(today))}},
		{ID: "r:week", Kind: "record", Text: "Orders in the last 7 days: " + strconv.Itoa(len(last7)) + ", worth " + inr(money(last7)) + ". Orders for the next 7 days: " + strconv.Itoa(len(next7)) + ", worth " + inr(money(next7)) + ".",
			AmountsInr: []float64{float64(money(last7)), float64(money(next7))}},
	}
	by, byMoney := make([]int64, 7), make([]int64, 7)
	for _, o := range st.Orders {
		if counted(o) && at(o) >= start-28*day && at(o) < start {
			d := zone.WeekdayOf(zone.LocalParts(at(o), tz).Date)
			by[d]++
			if o.TotalInr != nil {
				byMoney[d] += *o.TotalInr
			}
		}
	}
	parts := make([]string, 7)
	amounts := make([]float64, 7)
	for i, d := range weekdayEn {
		parts[i] = d + " " + strconv.FormatInt(by[i], 10) + " (" + inr(byMoney[i]) + ")"
		amounts[i] = float64(byMoney[i])
	}
	out = append(out, assistant.TalkSource{ID: "r:weekdays", Kind: "record", Text: "Orders by weekday over the last 28 days: " + strings.Join(parts, ", ") + ".", AmountsInr: amounts})
	// the top three items over 28 days (a Map in first-seen order, sorted by count with ties kept in that order, as Array.prototype.sort is stable)
	var ids []string
	qty := map[string]int64{}
	for _, o := range st.Orders {
		if counted(o) && at(o) >= start-28*day {
			for _, l := range o.Lines {
				if _, ok := qty[l.ItemID]; !ok {
					ids = append(ids, l.ItemID)
				}
				qty[l.ItemID] += l.Qty
			}
		}
	}
	sort.SliceStable(ids, func(i, j int) bool { return qty[ids[i]] > qty[ids[j]] })
	if len(ids) > 3 {
		ids = ids[:3]
	}
	top := "No orders in the last 28 days."
	lits := []string{}
	if len(ids) > 0 {
		var named []string
		for _, id := range ids {
			name := id // itemName of `{ id, names: {} }`: an item no longer on the menu is named by its id
			if it := s.ItemOf(id); it != nil {
				name = ItemName(it, s.Owner.Language)
			}
			named = append(named, name+" "+strconv.FormatInt(qty[id], 10))
			lits = append(lits, name)
		}
		top = "Top items over the last 28 days: " + strings.Join(named, ", ") + "."
	}
	out = append(out, assistant.TalkSource{ID: "r:top", Kind: "record", Text: top, Literals: lits})
	open, cancelled := 0, 0
	for _, o := range st.Orders {
		if contains(openStates, o.State) {
			open++
		}
		if o.State == Cancelled && at(o) >= start-28*day {
			cancelled++
		}
	}
	out = append(out, assistant.TalkSource{ID: "r:open", Kind: "record", Text: "Open orders now: " + strconv.Itoa(open) + ". Cancelled over the last 28 days: " + strconv.Itoa(cancelled) + "."})
	if s.Discounts != nil { // E1: "discounts this month", from the record (internal/discounts TalkFact)
		first := zone.LocalParts(nowMs, tz).Date
		first.Day = 1
		out = append(out, discounts.TalkFact(k.a.c.Rec.Entries(), time.UnixMilli(zone.ZonedToMs(first, 0, 0, tz)).UTC().Format("2006-01-02T15:04:05.000Z")))
	}
	return out
}

// ---- the views over the last saved state (server/runtime.ts channel.offer and channel.owner) --------------------------------------------------------------------------------

// PublicCharacter is app/view.ts publicCharacter over the Orders skill, read-only: the character's name when the Operator gave one, and the face the PUBLIC sees now. nil for a
// shop without the assistant. cmd/orders hands it in as Kit.OfferCharacter, with the last saved state's assistant part (the cards and the closed days).
func (k *Kit) PublicCharacter(st *Store, sn *runtime.Snap) json.RawMessage {
	if k.Settings == nil || k.Settings.Assistant == nil || k.shared == nil || sn == nil {
		return nil
	}
	face := runtime.PublicFace(sn, k.readSkill(st), k.now(), zoneLoc(k.Settings.Timezone))
	kv := []any{}
	if n := k.shared.Assistant.Name; n != "" {
		kv = append(kv, "name", n)
	}
	kv = append(kv, "face", face)
	return ordered(kv...)
}

// AppView is app/view.ts ownerAppView over the Orders skill, read-only, with `listen` (the page may record a voice note: the shop has a voice service). cmd/orders hands it in as
// Kit.OwnerApp.
func (k *Kit) AppView(st *Store, sn *runtime.Snap) json.RawMessage {
	if k.Settings == nil || k.Settings.Assistant == nil || k.shared == nil || sn == nil {
		return nil
	}
	return jsonOf(runtime.OwnerAppView(sn, k.shared, k.readSkill(st), k.now(), zoneLoc(k.Settings.Timezone), k.OwnerVoiceOn()))
}

// OwnerVoiceOn: the owner's page may send a recording to the shop's assistant (server/runtime.ts pageAudio: only with a voice service and the assistant).
func (k *Kit) OwnerVoiceOn() bool {
	return k.Voice != nil && k.Settings != nil && k.Settings.Assistant != nil
}

var _ runtime.OwnerVoiceKit = (*Kit)(nil)

// zoneLoc is the shop's zone as a location (the settings check refused a zone Go cannot load, so UTC is only a guard).
func zoneLoc(tz string) *time.Location {
	loc, err := time.LoadLocation(tz)
	if err != nil {
		return time.UTC
	}
	return loc
}
