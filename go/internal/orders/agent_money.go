package orders

// Money and the clock: agent.ts's sections "refunds" (the shared internal/payments refunds: send once, never send again what may have gone out), "the advance: look, count,
// confirm" (reconcilePayments, afterAdvance, completeOrder, a second payment, an advance with no order to confirm), onPaymentEvent, "the licence" (no new orders in the wind-down,
// nothing more sent in the final stop), the stock count (reconcileStock), onTick and the panel's recovery. The owner-marked money of a UPI shop is agent_marks.go; each branch here
// asks what the module can do (a.ownerConfirms, a.ownerRefunds), as agent.ts does, never whether a gateway port is there. Also the two paths of the monthly plans that are the
// agent's own (askPlanPayment, refundPlanCredit, the plan's advance applied), which src/plans/flow.ts is handed (G3's seam calls them).

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/accounting"
	"github.com/GeometerLabs/agents/go/internal/assistant"
	"github.com/GeometerLabs/agents/go/internal/guard"
	"github.com/GeometerLabs/agents/go/internal/listings"
	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/payments"
	"github.com/GeometerLabs/agents/go/internal/runtime"
	"github.com/GeometerLabs/agents/go/internal/stock"
	"github.com/GeometerLabs/agents/go/internal/zone"
)

// rcase is an order as the refunds code sees it (payments.RefundCase): its lists are the order's own, changed in place.
type rcase struct{ o *Order }

func (c rcase) CaseID() string                    { return c.o.ID }
func (c rcase) Customer() string                  { return c.o.Customer }
func (c rcase) Pending() *[]payments.Pending      { return &c.o.Pending }
func (c rcase) Issues() *[]*payments.RefundIssue  { return &c.o.RefundIssues }
func (c rcase) Stopped() *[]string                { return &c.o.StoppedRefunds }
func (c rcase) Untold() *[]*payments.UntoldRefund { return &c.o.RefundsUntold }

// orderOfCase is the order of a refund case; nil for no case (refunds.ts logs an approval nobody waits for with `null`).
func orderOfCase(c payments.RefundCase) *Order {
	if r, ok := c.(rcase); ok {
		return r.o
	}
	return nil
}

func refundRupees(paise int64) *int64 {
	if paise < 0 {
		return nil
	}
	r := paise / 100
	return &r
}

func i64(n int64) string { return strconv.FormatInt(n, 10) }

func ptr[T any](v T) *T { return &v }

func mergeRefs(ms ...map[string]string) map[string]string {
	out := map[string]string{}
	for _, m := range ms {
		for k, v := range m {
			out[k] = v
		}
	}
	return out
}

// refundDeps is agent.ts createRefunds' deps.
func (a *Agent) refundDeps() payments.RefundDeps {
	return payments.RefundDeps{
		Payments: a.pay, Now: a.now, Owner: a.owner(),
		LimitInr: func() int64 { return a.settings.Refund.LimitInr },
		Log: func(c payments.RefundCase, phone, action, outcome string, in map[string]any, more payments.LogMore) {
			m := logMore{notes: more.Notes, refs: more.Refs}
			for _, d := range more.Decisions {
				if x, ok := d.(Decision); ok {
					m.decisions = append(m.decisions, x)
				}
			}
			a.log(orderOfCase(c), phone, action, outcome, in, m)
		},
		TellCustomer: func(c payments.RefundCase, phone string, templates []string, paise int64) bool {
			return a.tellCustomer(orderOfCase(c), phone, templates, sayOpts{refundInr: refundRupees(paise)})
		},
		// the confirmation after an unknown outcome is kept until WhatsApp accepts it, so the shared code needs to know how the send ended
		TellCustomerOutcome: func(c payments.RefundCase, phone, template string, paise int64) string {
			return a.sayOutcome(orderOfCase(c), phone, template, sayOpts{refundInr: refundRupees(paise)})
		},
		TellOwner: func(c payments.RefundCase, phone, template string, paise int64) bool {
			return a.tellOwner(orderOfCase(c), phone, template, sayOpts{refundInr: refundRupees(paise)})
		},
		Cases: func() []payments.RefundCase {
			out := make([]payments.RefundCase, 0, len(a.store.Orders))
			for _, o := range a.store.Orders {
				out = append(out, rcase{o})
			}
			return out
		},
		IDs:        payments.RefundIDs{Checking: "refund_checking", Denied: "refund_denied", Approved: "refund_approved", Expired: "refund_expired", Settled: "owner_refund_settled", Confirmed: "refund_confirmed"},
		Accounting: refundBooks{a},
	}
}

func decisionsAny(ds ...Decision) []any {
	out := make([]any, len(ds))
	for i, d := range ds {
		out[i] = d
	}
	return out
}

// bookEvent is a money event as agent.ts hands books.post (modules/accounting MoneyEvent), in the fields Orders uses.
type bookEvent struct {
	Kind, Case, PaymentID string
	AmountPaise           int64
	Method, Evidence, For string
	Service, Why          string
	Owed, RefundID        string
}

func (e bookEvent) money() accounting.MoneyEvent {
	m := accounting.MoneyEvent{Kind: accounting.MoneyKind(e.Kind), PaymentID: e.PaymentID, AmountPaise: e.AmountPaise, Method: accounting.Method(e.Method), Evidence: accounting.Evidence(e.Evidence),
		For: accounting.ReceivedFor(e.For), Service: e.Service, Why: e.Why}
	if e.Case != "" {
		m.Case = ptr(e.Case)
	}
	if e.Owed != "" {
		m.Owed = ptr(e.Owed)
	}
	if e.RefundID != "" {
		m.RefundID = ptr(e.RefundID)
	}
	return m
}

// post is books.post (accounting.ts ordersAccounting over the very record `log` appends to): the money event, and the line's own write with its money fields (the accounting reads
// the line back). With books that cannot be made, the line is written with no money fields, so the record is never short of the line itself.
func (a *Agent) post(e bookEvent, write func(money map[string]string)) {
	if a.acct == nil {
		a.acct, _ = OrdersAccounting(a.c.Rec, a.settings.Timezone, a.now)
	}
	if a.acct != nil {
		wrote := false
		if _, err := a.acct.Post(e.money(), func(refs map[string]string) error { wrote = true; write(refs); return nil }); err == nil || wrote {
			return
		}
	}
	write(map[string]string{})
}

// refundBooks is the step's books as the refunds code needs them (payments.Accounting).
type refundBooks struct{ a *Agent }

func (r refundBooks) Post(e payments.MoneyEvent, write func(map[string]string)) {
	r.a.post(bookEvent{Kind: e.Kind, Case: e.Case, PaymentID: e.PaymentID, AmountPaise: e.AmountPaise, Method: e.Method, Evidence: e.Evidence, Why: e.Why, Owed: e.Owed, RefundID: e.RefundID}, write)
}

// requestRefund and afterRefund are refunds.ts's, over this order.
func (a *Agent) requestRefund(o *Order, paymentID string, amountInr int64, decisions []Decision, expectHold bool, requestedBy []string) (string, error) {
	return a.refunds.RequestRefund(a.ctx, rcase{o}, paymentID, amountInr, decisionsAny(decisions...), expectHold, requestedBy)
}

func (a *Agent) afterRefund(o *Order, result string, r payments.RefundAfter) {
	a.refunds.AfterRefund(rcase{o}, result, r)
}

// linkClosed is `payments.cancelRequest(id).then(() => payments.fetchRequest(id)).then((x) => x?.status === "cancelled").catch(() => false)`.
func (a *Agent) linkClosed(id string) bool {
	if a.pay == nil {
		return false
	}
	if _, err := a.pay.CancelRequest(a.ctx, id); err != nil {
		return false
	}
	l, err := a.pay.FetchRequest(a.ctx, id)
	return err == nil && l != nil && l.Status == "cancelled"
}

// ---- the advance: look, count, confirm -------------------------------------------------------------------------------------------------------------------------------

// reconcilePayments is agent.ts reconcilePayments: the payments service's record of this order's link against what the agent has counted. On a UPI shop the owner's marks are that
// record (reconcileMarks; its outcome is the owner's own reply's). A link for the balance is read the same way first, and never counts as the advance.
func (a *Agent) reconcilePayments(o *Order) (markOutcome, error) {
	if a.ownerConfirms {
		return a.reconcileMarks(o)
	}
	if err := a.reconcileBalance(o); err != nil {
		return markNone, err
	}
	if o.LinkID == "" {
		return markNone, nil
	}
	if a.pay == nil {
		return markNone, runtime.Unported("a payment on a shop with no payments service")
	}
	link, err := a.pay.FetchRequest(a.ctx, o.LinkID)
	if err != nil {
		return markNone, err
	}
	if link == nil {
		a.log(o, o.Customer, "record_payment", "failed", map[string]any{"linkId": o.LinkID}, logMore{notes: "the payments service has no such link"})
		return markNone, nil
	}
	for _, p := range link.Payments {
		if contains(o.HandledPayments, p.ID) {
			continue
		}
		rule := a.checkOneAdvancePerOrder(o.ID, p.ID)
		o.HandledPayments = append(o.HandledPayments, p.ID)
		in := map[string]any{"linkId": link.ID, "amount": p.Amount}
		if !blocked(rule) {
			o.AdvancePaymentID = p.ID
			a.post(bookEvent{Kind: "received", Case: o.ID, PaymentID: p.ID, AmountPaise: p.Amount, Method: "gateway", Evidence: "provider", For: "advance"}, func(m map[string]string) {
				a.log(o, o.Customer, "record_payment", "confirmed", in, logMore{decisions: []Decision{rule}, refs: mergeRefs(map[string]string{"paymentId": p.ID, "linkId": link.ID, "amountPaise": i64(p.Amount)}, m)})
			})
			if err := a.afterAdvance(o); err != nil {
				return markNone, err
			}
			continue
		}
		a.post(bookEvent{Kind: "received", Case: o.ID, PaymentID: p.ID, AmountPaise: p.Amount, Method: "gateway", Evidence: "provider", For: "extra"}, func(m map[string]string) {
			a.log(o, o.Customer, "record_payment", "blocked", in, logMore{decisions: []Decision{rule}, refs: mergeRefs(map[string]string{"paymentId": p.ID, "amountPaise": i64(p.Amount)}, m)})
		})
		// payment.amount / 100 - payment.amount_refunded / 100, as JavaScript numbers; the refund is asked for in whole rupees (a gateway payment is whole rupees: the link was)
		left := int64(math.Round(float64(p.Amount)/100 - float64(p.AmountRefunded)/100))
		if err := a.handleExtraPayment(o, p.ID, left, rule); err != nil {
			return markNone, err
		}
	}
	return markNone, nil
}

// afterAdvance is agent.ts afterAdvance.
func (a *Agent) afterAdvance(o *Order) error {
	if o.Plan != nil && o.State != AwaitingAdvance {
		return a.refundUnbookable(o, "inactive") // a plan's period that no longer stands: the payment came too late and goes back
	}
	switch o.State {
	case AwaitingAdvance:
		return a.completeOrder(o)
	case Expired:
		// the hold ran out before the money came: if the cut-off has not passed and the stock and the day still allow it, take the order again; if not, give the money back
		av := a.availability(o)
		outcome := "confirmed"
		if av.blocked != "" {
			outcome = "blocked"
		}
		a.log(o, o.Customer, "check_order", outcome, map[string]any{"late": true}, logMore{decisions: av.decisions, notes: "the advance arrived after the hold ended: the order is taken again only if the cut-off, the stock and the day's limit still allow it"})
		if av.blocked == "" {
			_ = o.MoveTo(AwaitingAdvance)
			return a.completeOrder(o)
		}
		why := "stock"
		if av.blocked == "after_cutoff" {
			why = "cutoff"
		}
		return a.refundUnbookable(o, why)
	}
	return a.refundUnbookable(o, "inactive")
}

// completeOrder is agent.ts completeOrder: the advance is recorded; the order is confirmed, the customer is told, and so is the owner (what to prepare, and where it goes).
func (a *Agent) completeOrder(o *Order) error {
	if o.Plan != nil {
		// a plan's period: the payment record shows it, so its meals are owed (src/plans/flow.ts onPaid, G3's seam)
		p := a.plansOf()
		if p == nil {
			return runtime.Unported("the payment of a monthly plan's period (the plans are not in Go yet)")
		}
		return p.OnPaid(o)
	}
	o.HoldExpiresAt = nil
	_ = o.MoveTo(Confirmed)
	a.log(o, o.Customer, "confirm_order", "confirmed", inputs("lines", o.Lines, "date", o.Date, "slot", optS(o.SlotID), "mode", optS(o.Mode)), logMore{notes: "the payment record shows the whole advance"})
	// the reminder before the slot, only for a shop that asked for one (settings.reminder); past moments are never scheduled (modules/reminders)
	if a.settings.Reminder != nil && o.SlotStartMs != nil {
		o.setReminders(scheduleAround(*o.SlotStartMs, []int64{-a.settings.Reminder.HoursBefore * Hour}, a.now()))
	}
	confirmed := "order_confirmed"
	if a.ownerConfirms {
		confirmed = "upi_order_confirmed"
	}
	a.tellCustomer(o, o.Customer, []string{confirmed}, sayOpts{offer: cancelOrOwner})
	owner := "owner_order_confirmed"
	if o.Mode == Delivery {
		owner = "owner_delivery_confirmed"
	}
	a.tellOwner(o, o.Customer, owner, sayOpts{})
	return nil
}

// handleExtraPayment is agent.ts handleExtraPayment: a payment that is not the order's advance (a second payment on the same link) is refunded and the owner told.
func (a *Agent) handleExtraPayment(o *Order, paymentID string, leftInr int64, oneAdvance Decision) error {
	p, err := a.pay.FetchPayment(a.ctx, paymentID)
	if err != nil {
		return err
	}
	if p != nil && p.AmountRefunded >= p.Amount {
		return nil // already refunded by someone
	}
	limit := checkRefundLimit(refundAsk{amountInr: leftInr, limitInr: a.settings.Refund.LimitInr, paidInr: leftInr})
	if blocked(limit) {
		a.log(o, o.Customer, "refund", "blocked", map[string]any{"paymentId": paymentID, "amountInr": leftInr}, logMore{decisions: []Decision{oneAdvance, limit}, refs: map[string]string{"paymentId": paymentID, "amountPaise": i64(leftInr * 100)}})
		return nil
	}
	// above the limit the agent does not ask the owner: Guard holds the refund, and the approvals relay asks, once
	result, err := a.requestRefund(o, paymentID, leftInr, []Decision{oneAdvance, limit}, limit.Verdict != "allow", nil)
	if err != nil {
		return err
	}
	a.afterRefund(o, result, payments.RefundAfter{PaymentID: paymentID, AmountInr: leftInr, DoneCust: "duplicate_refund", DoneOwner: "owner_duplicate_payment", Held: "duplicate_refund_pending"})
	return nil
}

// refundUnbookable is agent.ts refundUnbookable: the advance arrived but there is no order it can confirm (the hold ended and the stock or the cut-off say no, or it was cancelled).
func (a *Agent) refundUnbookable(o *Order, why string) error {
	var amountInr int64
	if o.AdvanceInr != nil {
		amountInr = *o.AdvanceInr
	}
	limit := checkRefundLimit(refundAsk{amountInr: amountInr, limitInr: a.settings.Refund.LimitInr, paidInr: amountInr})
	result := payments.ResultStopped
	if !blocked(limit) {
		r, err := a.requestRefund(o, o.AdvancePaymentID, amountInr, []Decision{limit}, limit.Verdict != "allow", nil)
		if err != nil {
			return err
		}
		result = r
	}
	if o.State != Cancelled {
		_ = o.MoveTo(Cancelled)
	}
	done := "refund_unused"
	switch why {
	case "stock":
		done = "stock_gone_refund"
	case "cutoff":
		done = "cutoff_passed_refund"
	}
	a.afterRefund(o, result, payments.RefundAfter{PaymentID: o.AdvancePaymentID, AmountInr: amountInr, DoneCust: done, DoneOwner: "owner_payment_unused", Held: "cancelled_refund_pending"})
	return nil
}

// onPaymentEvent is agent.ts onPaymentEvent: the event only says to look; the payments service's own record decides.
func (a *Agent) onPaymentEvent(ev payments.PaymentEvent) error {
	if contains(a.store.SeenEvents, ev.ID) {
		a.log(nil, a.owner(), "receive_payment_event", "blocked", map[string]any{"id": ev.ID, "event": ev.Event}, logMore{notes: fmt.Sprintf("event %s was delivered again, so it is ignored", ev.ID)})
		return nil
	}
	if a.pay == nil {
		return runtime.Unported("a payment event on a shop with no payments service")
	}
	if ev.Event == payments.EventRefundDone && ev.Payload.Refund != nil {
		paymentID, refundID := ev.Payload.Refund.PaymentID, ev.Payload.Refund.ID
		var o *Order
		for _, x := range a.store.Orders {
			if contains(x.HandledPayments, paymentID) || x.AdvancePaymentID == paymentID {
				o = x
				break
			}
		}
		// the event only says to look: the payments service's own list must show the refund; when it is the refund an unknown outcome is open on (B75), that ORIGINAL attempt is
		// settled as the provider's confirmation; no refund is ever asked for again
		list, err := a.pay.ListRefunds(a.ctx, paymentID)
		if err != nil {
			return err
		}
		var listed *payments.Refund
		for i := range list {
			if list[i].ID == refundID {
				listed = &list[i]
				break
			}
		}
		settles := o != nil && listed != nil && a.refunds.OpenIssueFor(rcase{o}, *listed) != nil
		phone := a.owner()
		if o != nil {
			phone = o.Customer
		}
		outcome, notes := "unconfirmed", "the payments service's own list does not show this refund, so nothing is settled by it"
		if listed != nil {
			outcome, notes = "confirmed", "the refund is on the payments service's own list"
			if settles {
				notes = "the refund is on the payments service's own list, and it is the one whose outcome was unknown: settled below"
			}
		}
		a.log(o, phone, "receive_payment_event", outcome, map[string]any{"id": ev.ID, "event": ev.Event}, logMore{refs: map[string]string{"refundId": refundID, "paymentId": paymentID}, notes: notes})
		if settles {
			a.refunds.SettleFromEvent(rcase{o}, *listed, ev.ID)
		}
		a.store.SeenEvents = append(a.store.SeenEvents, ev.ID)
		return nil
	}
	// a payment.received may name the payment and not its request (a provider's body can carry its order only): ask the payments service which request it paid
	linkID := ""
	if ev.Payload.Request != nil {
		linkID = ev.Payload.Request.ID
	}
	if linkID == "" && ev.Payload.Payment != nil {
		linkID = ev.Payload.Payment.RequestID
	}
	if linkID == "" && ev.Payload.Payment != nil && ev.Payload.Payment.ID != "" {
		l, err := a.pay.ListRequests(a.ctx, payments.ListQuery{PaymentID: ev.Payload.Payment.ID})
		if err != nil {
			return err
		}
		if len(l) > 0 {
			linkID = l[0].ID
		}
	}
	var o *Order
	if linkID != "" {
		for _, x := range a.store.Orders {
			if x.LinkID == linkID || (x.balance() != nil && x.balance().LinkID == linkID) {
				o = x
				break
			}
		}
	}
	if o == nil {
		a.log(nil, a.owner(), "receive_payment_event", "blocked", map[string]any{"id": ev.ID, "event": ev.Event}, logMore{notes: "no order has this payment link, so the event is ignored"})
		a.store.SeenEvents = append(a.store.SeenEvents, ev.ID)
		return nil
	}
	a.log(o, o.Customer, "receive_payment_event", "confirmed", map[string]any{"id": ev.ID, "event": ev.Event}, logMore{refs: map[string]string{"eventId": ev.ID}})
	if _, err := a.reconcilePayments(o); err != nil { // the record decides; the event only said to look
		return err
	}
	a.store.SeenEvents = append(a.store.SeenEvents, ev.ID) // only after it worked: a failed step can be run again with the same event
	return nil
}

// ---- the licence: no new orders in the wind-down, nothing more sent in the final stop --------------------------------------------------------------------------------

// takesNewWork is rules.ts takesNewWork: only a shop in order takes new orders.
func (a *Agent) takesNewWork() bool { return a.c.Licence() == "" }

// licenceState is the record's word for the licence now (active, wind_down, stopped).
func (a *Agent) licenceState() string {
	switch a.c.Licence() {
	case "paused":
		return "wind_down"
	case "stopped":
		return "stopped"
	}
	return "active"
}

// pausedReply is agent.ts pausedReply: a request for new work while online ordering is paused, said in the record and answered "please contact the shop"; nothing is kept for later.
func (a *Agent) pausedReply(phone, asked string, byGuard *Decision) {
	var d Decision
	if byGuard != nil {
		d = *byGuard
	} else {
		where := "wind-down"
		if a.c.Licence() == "stopped" {
			where = "final stop"
		}
		d = block("subscription_suspended", "online ordering is paused: the shop's licence is in its "+where+", so no order, hold or advance link is made, and nothing is kept to do later (the runtime's own check of the lease)")
	}
	a.log(nil, phone, "new_work", "blocked", map[string]any{"asked": asked}, logMore{decisions: []Decision{d}, notes: "the customer is told online ordering is paused and to contact the shop"})
	a.tellCustomer(nil, phone, []string{"orders_paused"}, sayOpts{})
}

// guardLicenceDecision is rules.ts guardLicenceDecision (the shared words in messaging).
func guardLicenceDecision(g *guard.GuardError) Decision {
	return messaging.GuardLicenceDecision(g.Guard.Reason, g.Guard.HasReason)
}

func (a *Agent) paidThrough() *int64 {
	if a.c.PaidThrough == nil {
		return nil
	}
	return a.c.PaidThrough()
}

// noteLicence is agent.ts noteLicence: one record line each time the licence restricts the shop, or stops restricting it.
func (a *Agent) noteLicence() {
	now := a.licenceState()
	was := "active"
	entries := a.c.Rec.Entries()
	for i := len(entries) - 1; i >= 0; i-- {
		if entries[i].Action == "licence" {
			if s, ok := entries[i].Refs["state"]; ok {
				was = s
			}
			break
		}
	}
	if now == was {
		return
	}
	notes := "The shop's licence is in order again: new orders are taken from now on. Nothing asked during the wind-down is done now; a customer who still wants it asks again."
	switch now {
	case "wind_down":
		notes = "The shop's licence is in its wind-down (the lease fleet signed, read on this server): no new order or advance link is made, and nothing is kept to do later. Refunds owed, cancellations, existing orders and payments from links sent earlier go on."
	case "stopped":
		notes = "The shop's licence has reached its final stop: open advance links are closed and nothing more is sent from here, except the owner's one notice. Payments already made are still recorded and refunds still go through. Nothing is deleted."
	}
	refs := map[string]string{"state": now}
	if p := a.paidThrough(); p != nil {
		refs["paidThrough"] = i64(*p)
	}
	a.log(nil, a.owner(), "licence", "confirmed", map[string]any{"state": now}, logMore{refs: refs, notes: notes})
}

// closeLinksAtStop is agent.ts closeLinksAtStop: the final stop, once for each paid_through, closes every open advance link at the gateway, so no new payment comes in. A module
// that cannot cancel a request (UPI) has none to close.
func (a *Agent) closeLinksAtStop() {
	if a.c.Licence() != "stopped" || !a.can.Cancels {
		return
	}
	var paid int64
	if p := a.paidThrough(); p != nil {
		paid = *p
	}
	key := "stop:" + i64(paid)
	for _, o := range append([]*Order(nil), a.store.Orders...) {
		if o.State != AwaitingAdvance || o.LinkID == "" {
			continue
		}
		done := false
		for _, e := range a.c.Rec.Entries() {
			if e.Booking != nil && *e.Booking == o.ID && e.Action == "cancel_advance_link" && e.Refs["licence"] == key {
				done = true
				break
			}
		}
		if done {
			continue
		}
		closed := a.linkClosed(o.LinkID)
		outcome, notes := "unconfirmed", "the final stop of the shop's licence: the link could not be closed (it may be paid already, or the gateway did not answer); the owner can close it in the gateway's own dashboard"
		if closed {
			outcome, notes = "confirmed", "the final stop of the shop's licence: the open advance link is closed, so no new payment comes in; a payment already made is still recorded"
		}
		a.log(o, o.Customer, "cancel_advance_link", outcome, map[string]any{"linkId": o.LinkID}, logMore{refs: map[string]string{"linkId": o.LinkID, "licence": key}, notes: notes})
	}
}

// ---- the shop's stock count (modules/stock) --------------------------------------------------------------------------------------------------------------------------

// stockCount is `store.assistant?.stock`: the shop's one stock count in this step's state (nil: nothing is counted).
func (a *Agent) stockCount() *listings.Stock {
	if a.c == nil || a.c.Snap == nil {
		return nil
	}
	return a.c.Snap.Stock
}

// reconcileStock is agent.ts reconcileStock: for each menu item the owner counts, an order that stands is booked once under `sale:<order>:<item>`, and a cancelled order gives back
// exactly what it took. Run at the start of every step and tick and again before an availability check; asking twice changes nothing. A shop that counts nothing returns at once,
// writing nothing and logging nothing. An item that fell to its low mark gets the owner one line in their app now (once per crossing); Orders has no supplier to ask.
func (a *Agent) reconcileStock() {
	st := a.stockCount()
	if st == nil || len(st.Lines) == 0 {
		return
	}
	now := a.now()
	countsOf := func() string {
		parts := make([]string, len(st.Lines))
		for i, l := range st.Lines {
			parts[i] = i64(l.Count)
		}
		return strings.Join(parts, ",")
	}
	before := countsOf()
	if changed := stock.ReconcileSales(st, stock.ShopRecord("orders"), a.store.OrderFacts(now), now); changed > 0 && countsOf() != before {
		a.log(nil, a.owner(), stock.Action, "confirmed", map[string]any{"changed": changed}, logMore{refs: stock.StockRefs("menu:*", "booked_sale", "shop"),
			notes: "the shop's stock count was brought in line with the orders that stand and the ones cancelled (each order is booked once)"})
	}
	for _, al := range stock.PendingAlerts(st, "") {
		if stock.KindOf(al.Line) == stock.KindSupply {
			continue // a supply item belongs to Stock orders, which turns its alert into a reorder
		}
		stock.AckAlert(st, al.Line, al.Crossing)
		// `item ? itemName(item, ownerLanguage) : st.lines.find((l) => l.id === a.line)?.name ?? a.line`
		name := al.Line
		var item *MenuItem
		if strings.HasPrefix(al.Line, "menu:") {
			item = a.settings.ItemOf(strings.TrimPrefix(al.Line, "menu:"))
		}
		if item != nil {
			name = ItemName(item, a.settings.Owner.Language)
		} else {
			for _, l := range st.Lines {
				if l.ID == al.Line {
					if l.Name != "" {
						name = l.Name
					}
					break
				}
			}
		}
		if a.c.Snap.A != nil {
			a.c.Snap.A.Talk = append(a.c.Snap.A.Talk, assistant.TalkLine{AtMs: now, From: "assistant", Text: stock.Words(a.settings.Owner.Language).RunningLow(name, al.Count)})
		}
		a.log(nil, a.owner(), stock.Action, "confirmed", map[string]any{"item": al.Line, "count": al.Count, "crossing": al.Crossing}, logMore{refs: stock.StockRefs(al.Line, "low", "shop"),
			notes: "a counted item fell to its low mark; the owner was told once for this crossing"})
	}
}

// ---- the reminder before the slot (modules/reminders) ----------------------------------------------------------------------------------------------------------------

// reminder is reminders.ts Reminder.
type reminder struct {
	AtMs int64 `json:"atMs"`
	Sent bool  `json:"sent"`
}

// scheduleAround is reminders.ts scheduleAround: reminders at these offsets from a moment, in the order given, leaving out any already past.
func scheduleAround(anchorMs int64, offsets []int64, nowMs int64) []reminder {
	out := []reminder{}
	for _, off := range offsets {
		if at := anchorMs + off; at > nowMs {
			out = append(out, reminder{AtMs: at})
		}
	}
	return out
}

// takeDue is reminders.ts takeDue: every reminder that fell due is marked sent, and the answer is whether ONE message should go, however many fell due.
func takeDue(rs []reminder, nowMs int64) bool {
	due := false
	for i := range rs {
		if !rs[i].Sent && rs[i].AtMs <= nowMs {
			rs[i].Sent, due = true, true
		}
	}
	return due
}

// reminders is the order's reminders, typed; nil when it has none (the member is left out, or it is not a list this version reads).
func (o *Order) reminders() []reminder {
	if o.Reminders == nil {
		return nil
	}
	var rs []reminder
	if json.Unmarshal(o.Reminders, &rs) != nil {
		return nil
	}
	return rs
}

// setReminders writes the reminders back; nil takes the member away (`o.reminders = undefined`).
func (o *Order) setReminders(rs []reminder) {
	if rs == nil {
		o.Reminders = nil
		return
	}
	o.Reminders = jsonOf(rs)
}

// ---- the clock's beat ------------------------------------------------------------------------------------------------------------------------------------------------

// expireHold is agent.ts expireHold: the hold ran out; before giving the stock up, look at the payments record (the event may have been lost).
func (a *Agent) expireHold(o *Order) error {
	if _, err := a.reconcilePayments(o); err != nil {
		return err
	}
	if o.State != AwaitingAdvance {
		return nil
	}
	a.closeLink(o, "the hold ran out")
	_ = o.MoveTo(Expired)
	a.log(o, o.Customer, "release_stock", "confirmed", inputs("until", o.HoldExpiresAt), logMore{notes: "the hold ran out before an advance was recorded, so the order's stock and its place in the day's count are free again"})
	a.tellCustomer(o, o.Customer, []string{"hold_expired"}, sayOpts{})
	if a.ownerConfirms {
		// part of the advance was marked, and the hold ran out: that part is the customer's, and the owner owes it back
		if r := a.requestOf(o); r != nil && len(r.Marks) > 0 {
			if part := markedPaise(r); part > 0 {
				a.oweBack(o, r.Marks[len(r.Marks)-1].ID, part, "part of the advance was marked received, and the hold ran out", oweOpts{customer: "upi_refund_owed"})
			}
		}
	}
	return nil
}

// onTick is agent.ts onTick.
func (a *Agent) onTick() error {
	if as := a.assistantOf(); as != nil {
		as.OnTick() // item 11e: cards past their time close; the morning line is the runtime's own job (AfterTick, G3's)
	}
	now := a.now()
	a.announceButtonMode() // the outside switch can change between messages; the owner hears of it on the next beat
	if a.pay != nil {
		if err := a.refunds.Sweep(a.ctx, now); err != nil { // refunds first, whatever state their order is in
			return err
		}
	}
	if a.marks != nil {
		a.remindOwedRefunds(now)
	}
	a.closeLinksAtStop()
	if a.can.ReadsSettlements {
		a.readSettlements(now) // yesterday's settlement rows, once a day (modules/accounting/settlements.ts)
	}
	for _, o := range append([]*Order(nil), a.store.Orders...) {
		if o.Plan != nil {
			continue // a plan's period is watched by the plan (hold, renewal reminder, lapse): src/plans/flow.ts
		}
		if o.State == AwaitingAdvance && o.HoldExpiresAt != nil && *o.HoldExpiresAt <= now {
			if err := a.expireHold(o); err != nil {
				return err
			}
		}
		// the reminder: one message, however many moments fell due while the agent was not running, and never for an order that no longer stands or whose slot has begun
		if o.Reminders != nil {
			if o.State != Confirmed {
				o.setReminders(nil)
			} else if rs := o.reminders(); o.SlotStartMs != nil && *o.SlotStartMs > now && rs != nil {
				if takeDue(rs, now) {
					o.setReminders(rs)
					a.tellCustomer(o, o.Customer, []string{"order_reminder"}, sayOpts{})
				}
			}
		}
		if o.State == Confirmed && o.SlotEndMs != nil && *o.SlotEndMs <= now {
			_ = o.MoveTo(Completed)
			o.setReminders(nil)
			// the advance is applied to the order when it is done; an order with no advance posts nothing
			own := func(money map[string]string) {
				m := logMore{}
				if len(money) > 0 {
					m.refs = money
				}
				a.log(o, o.Customer, "complete_order", "confirmed", map[string]any{"endMs": *o.SlotEndMs}, m)
			}
			if o.AdvancePaymentID != "" && advancePaise(o) > 0 {
				a.post(bookEvent{Kind: "applied", Case: o.ID, AmountPaise: advancePaise(o), Service: "orders"}, own)
			} else {
				own(map[string]string{})
			}
		}
	}
	if p := a.plansOf(); p != nil {
		if err := p.OnTick(); err != nil { // monthly plans: meals delivered, renewals asked, unpaid ones lapsed
			return err
		}
	}
	return a.stepErr
}

// readSettlements is agent.ts's `readSettlementsOnce({payments, accounting: books, record, conversation: owner, language: languages[0], nowMs, timeZone})` over the gateway's
// settlement read (payments.SettlementReader, the Razorpay recon read); a provider without one reads none. A failed read is in the record; the next beat tries again.
func (a *Agent) readSettlements(now int64) {
	sr, ok := a.kit.Ports.Payments.(payments.SettlementReader)
	if !ok {
		return
	}
	if a.acct == nil {
		a.acct, _ = OrdersAccounting(a.c.Rec, a.settings.Timezone, a.now)
	}
	if a.acct == nil {
		return
	}
	accounting.ReadSettlementsOnce(accounting.SettlementsInput{Payments: settlementPayments{a, sr}, Accounting: a.acct, Record: Record(a.c.Rec), Conversation: a.owner(),
		Language: a.settings.Languages[0], NowMs: now, TimeZone: a.settings.Timezone})
}

// settlementPayments is accounting.Payments over the gateway's settlement read, each call watched as the agent's own (internal/bookings/books.go's adapter).
type settlementPayments struct {
	a *Agent
	r payments.SettlementReader
}

func (settlementPayments) ReadsSettlements() bool { return true }

func (s settlementPayments) ReadSettlements(day zone.Date) ([]accounting.SettlementRow, error) {
	var rows []payments.SettlementRow
	err := s.a.watch.do("payments", "listRequests", func() error {
		var err error
		rows, err = s.r.ReadSettlements(s.a.ctx, payments.Day{Year: day.Year, Month: day.Month, Day: day.Day}, 0)
		return err
	})
	if err != nil {
		return nil, err
	}
	out := make([]accounting.SettlementRow, len(rows))
	for i, r := range rows {
		out[i] = accounting.SettlementRow(r)
	}
	return out, nil
}

// ---- recovery: the panel's to-do list asks the agent to look again, or ask again -----------------------------------------------------------------------------------

// onRecovery is agent.ts onRecovery. It carries no authority: every call is one the agent already makes, and Guard decides each as it does every day.
func (a *Agent) onRecovery(ev map[string]any) error {
	id, _ := ev["id"].(string)
	cs, _ := ev["case"].(string)
	action, _ := ev["action"].(string)
	o := a.store.Order(cs)
	refs := map[string]string{"action": action, "recovery": id}
	note := func(outcome, notes string) {
		a.log(o, a.owner(), RecoveryEntry, outcome, map[string]any{"action": action, "case": cs}, logMore{notes: notes, refs: refs})
	}
	if o == nil {
		note("blocked", "no order has this id, so nothing was done")
		return nil
	}
	switch action {
	case "recheck_payment":
		if o.LinkID == "" {
			note("blocked", "this order has no payment link to look at")
			return nil
		}
		note("attempted", "looking again at the payments service's list for this order's link")
		if _, err := a.reconcilePayments(o); err != nil {
			return err
		}
		note("confirmed", "the payments service's list was read; any payment not yet counted was recorded above")
		return nil
	case "ask_owner_again":
		if a.marks != nil && a.markAskAgain(o, note) {
			return nil
		}
		var big *BigOrder
		var refund *OwnerRefund
		var bigAt, refundAt int
		for i, p := range o.Pending {
			if b := BigOrderOf(p); b != nil && big == nil {
				big, bigAt = b, i
			}
			if r := OwnerRefundOf(p); r != nil && refund == nil {
				refund, refundAt = r, i
			}
		}
		if big == nil && refund == nil {
			note("blocked", "nothing the agent asked the owner is waiting (a refund Guard holds is asked by the approvals relay)")
			return nil
		}
		note("attempted", "telling the owner again")
		var told bool
		if big != nil {
			told = a.tellOwner(o, o.Customer, "owner_big_order", sayOpts{})
		} else {
			told = a.tellOwner(o, o.Customer, "owner_late_cancellation", sayOpts{})
		}
		at := a.now()
		if big != nil {
			big.AskedAtMs = at
			o.Pending[bigAt] = NewBigOrder(*big)
		}
		if refund != nil {
			refund.AskedAtMs = &at
			o.Pending[refundAt] = NewOwnerRefund(*refund)
		}
		if told {
			note("confirmed", "the owner was told again")
		} else {
			note("failed", "the owner could not be told (the limits or the provider said no)")
		}
		return nil
	case "recheck_refund":
		open := false
		for _, i := range o.RefundIssues {
			if contains([]string{"unknown", "uncertain", "unconfirmed", "failed"}, i.Kind) {
				open = true
			}
		}
		if !open {
			note("blocked", "no refund here is waiting on an unclear outcome")
			return nil
		}
		if a.pay == nil {
			return runtime.Unported("recheck_refund on a shop with no payments service")
		}
		note("attempted", "looking again, read-only, for a refund that may have gone")
		settled, looked, told, err := a.refunds.Recheck(a.ctx, rcase{o})
		if err != nil {
			return err
		}
		note("confirmed", payments.RecheckLine(settled, looked, told)) // says how many customers were told: one whose message was not accepted stays on the to-do list
		return nil
	}
	note("blocked", `the agent has no recovery called "`+action+`"`)
	return nil
}

// ---- the monthly plans' payment paths (agent.ts askPlanPayment, refundPlanCredit, `applied`), which src/plans/flow.ts is handed --------------------------------------

// askPlanPayment is agent.ts askPlanPayment: the period's payment link (and a UPI shop's request and the owner's note), the same steps as an order's advance link, for the period's
// amount. "ok", "failed" or "paused".
func (a *Agent) askPlanPayment(o *Order) (string, error) {
	phone := o.Customer
	paise := advancePaise(o)
	if a.pay == nil {
		return "", runtime.Unported("a plan's payment link on a shop with no payments service")
	}
	a.log(o, phone, "create_advance_link", "attempted", map[string]any{"amountPaise": paise})
	res, err := payments.EnsureLink(a.ctx, a.pay, payments.LinkRequest{Reference: o.ID, AmountPaise: paise, Description: a.settings.Name + " monthly plan"})
	if err != nil {
		return "", err
	}
	if res.Link == nil && res.Suspended != nil {
		a.log(o, phone, "create_advance_link", "blocked", map[string]any{"amountPaise": paise}, logMore{decisions: []Decision{guardLicenceDecision(res.Suspended)}, notes: res.Suspended.Message})
		return "paused", nil
	}
	if res.Link == nil {
		outcome, notes := "unconfirmed", "the payments service does not show the link"
		if res.Error != "" {
			outcome, notes = "failed", res.Error
		}
		a.log(o, phone, "create_advance_link", outcome, map[string]any{"amountPaise": paise}, logMore{notes: notes})
		a.tellOwner(o, phone, "owner_link_failed", sayOpts{})
		return "failed", nil
	}
	o.LinkID, o.LinkURL = res.Link.ID, res.Link.PayURL
	a.log(o, phone, "create_advance_link", "confirmed", map[string]any{"amountPaise": paise}, logMore{refs: map[string]string{"linkId": res.Link.ID}})
	if a.ownerConfirms {
		if r := a.requestOf(o); r != nil {
			a.noteRequest(o, r, "a UPI request to the shop's own UPI ID for a plan's period; it counts as paid only when the owner marks it received")
			a.tellOwner(o, phone, "owner_upi_expected", sayOpts{upiCode: codeOf(r.Code), offer: a.receivedButtons(r, r.AmountPaise)})
		}
	}
	return "ok", nil
}

// refundPlanCredit is agent.ts refundPlanCredit: give back part of a period's payment (days not taken, or what is unused when a plan ends), never more than the payment. The result is
// "nothing", "stopped", "owed" or the refund's result.
func (a *Agent) refundPlanCredit(o *Order, amountInr int64, why string) (string, error) {
	if o.AdvancePaymentID == "" || o.AdvanceInr == nil || *o.AdvanceInr == 0 || amountInr <= 0 {
		return "nothing", nil
	}
	amount := min(amountInr, *o.AdvanceInr)
	limit := checkRefundLimit(refundAsk{amountInr: amount, limitInr: a.settings.Refund.LimitInr, paidInr: *o.AdvanceInr})
	if blocked(limit) {
		a.log(o, o.Customer, "refund", "blocked", map[string]any{"paymentId": o.AdvancePaymentID, "amountInr": amount}, logMore{decisions: []Decision{limit}, refs: map[string]string{"paymentId": o.AdvancePaymentID, "amountPaise": i64(amount * 100)}})
		return "stopped", nil
	}
	if a.ownerRefunds {
		a.oweBack(o, o.AdvancePaymentID, amount*100, why, oweOpts{customer: "upi_refund_owed", decisions: []Decision{limit}})
		return "owed", nil
	}
	result, err := a.requestRefund(o, o.AdvancePaymentID, amount, []Decision{limit}, limit.Verdict != "allow", nil)
	if err != nil {
		return "", err
	}
	a.afterRefund(o, result, payments.RefundAfter{PaymentID: o.AdvancePaymentID, AmountInr: amount, DoneCust: "plan_credit_refund", Held: "plan_credit_refund_pending"})
	return result, nil
}

// planApplied is agent.ts plans' `applied`: a delivered part of a period's payment is applied in the books (plan_applied).
func (a *Agent) planApplied(o *Order, amountInr int64) {
	if o.AdvancePaymentID == "" || amountInr <= 0 {
		return
	}
	a.post(bookEvent{Kind: "applied", Case: o.ID, AmountPaise: amountInr * 100, Service: "orders"}, func(money map[string]string) {
		a.log(o, o.Customer, "plan_applied", "confirmed", map[string]any{"amountInr": amountInr}, logMore{refs: money})
	})
}
