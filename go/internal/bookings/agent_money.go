package bookings

// Payments (look first, write, read back), refunds (the shared go/internal/payments refunds: send once, never send again what may have gone out), deposits, the licence's
// wind-down and final stop, the clock's beat and the panel's recovery: agent.ts's sections "payments", "refunds", "deposits", "the licence", onPaymentEvent, onTick and onRecovery.
//
// A UPI shop's money (the owner-marked ledger, modules/payments/owner-marked) is agent_marks.go: here each branch asks what the module can do (a.ownerConfirms, a.ownerRefunds),
// as agent.ts does, never whether a gateway port is there.

import (
	"encoding/json"
	"fmt"
	"strconv"

	"github.com/GeometerLabs/agents/go/internal/guard"
	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/payments"
	"github.com/GeometerLabs/agents/go/internal/runtime"
)

// rcase is a booking as the refunds code sees it (payments.RefundCase): its lists are the booking's own, changed in place.
type rcase struct{ b *Booking }

func (c rcase) CaseID() string                         { return c.b.ID }
func (c rcase) Customer() string                       { return c.b.Customer }
func (c rcase) Pending() *[]payments.Pending           { return &c.b.Pending }
func (c rcase) Issues() *[]*payments.RefundIssue       { return &c.b.RefundIssues }
func (c rcase) Stopped() *[]string                     { return &c.b.StoppedRefunds }
func (c rcase) Untold() *[]*payments.UntoldRefund      { return &c.b.RefundsUntold }
func bookingOfCase(c payments.RefundCase) *Booking     { return c.(rcase).b }
func refundPaise(p int64) *int64                       { if p < 0 { return nil }; return ptr(p / 100) }

// refundDeps is agent.ts createRefunds' deps.
func (a *Agent) refundDeps() payments.RefundDeps {
	return payments.RefundDeps{
		Payments: a.pay, Now: a.now, Owner: a.owner(),
		LimitInr: func() int64 { return a.settings.Cancellation.RefundLimitInr },
		Log: func(c payments.RefundCase, phone, action, outcome string, inputs map[string]any, more payments.LogMore) {
			m := logMore{notes: more.Notes, refs: more.Refs}
			for _, d := range more.Decisions {
				if x, ok := d.(Decision); ok {
					m.decisions = append(m.decisions, x)
				}
			}
			a.log(bookingOfCase(c), phone, action, outcome, inputs, m)
		},
		TellCustomer: func(c payments.RefundCase, phone string, templates []string, paise int64) bool {
			return a.tellCustomer(bookingOfCase(c), phone, templates, sayOpts{refundInr: refundPaise(paise)})
		},
		TellCustomerOutcome: func(c payments.RefundCase, phone, template string, paise int64) string {
			out, err := a.say.Outcome(a.ctx, a.sayArgs(bookingOfCase(c), phone, "customer", []string{template}, sayOpts{refundInr: refundPaise(paise)}))
			if err != nil {
				return messaging.NotSent
			}
			return out
		},
		TellOwner: func(c payments.RefundCase, phone, template string, paise int64) bool {
			return a.tellOwner(bookingOfCase(c), phone, template, sayOpts{refundInr: refundPaise(paise)})
		},
		Cases: func() []payments.RefundCase {
			out := make([]payments.RefundCase, 0, len(a.store.Bookings))
			for _, b := range a.store.Bookings {
				out = append(out, rcase{b})
			}
			return out
		},
		IDs:        payments.RefundIDs{Checking: "refund_checking", Denied: "refund_denied", Approved: "refund_approved", Expired: "refund_expired", Settled: "owner_refund_settled", Confirmed: "refund_confirmed"},
		Accounting: a.refundAccounting(),
	}
}

func (a *Agent) refundAccounting() payments.Accounting { return refundBooks{a} }

func decisionsAny(ds ...Decision) []any {
	out := make([]any, len(ds))
	for i, d := range ds {
		out[i] = d
	}
	return out
}

// post is books.post: the money event, and the line's own write with its money fields (the accounting reads the line back). With no books, or books that cannot be read, the line
// is written with no money fields, so the record is never short of the line itself.
func (a *Agent) post(e BookEvent, write func(money map[string]string)) {
	if a.kit.Ports.Books != nil && a.c != nil {
		if a.acct == nil {
			a.acct, _ = a.kit.Ports.Books.Accounting(a.c.Rec, a.settings.Timezone, a.now)
		}
		if a.acct != nil {
			wrote := false
			if _, err := a.acct.Post(e.money(), func(refs map[string]string) error { wrote = true; write(refs); return nil }); err == nil || wrote {
				return
			}
		}
	}
	write(map[string]string{})
}

func mergeRefs(ms ...map[string]string) map[string]string {
	out := map[string]string{}
	for _, m := range ms {
		for k, v := range m {
			out[k] = v
		}
	}
	return out
}

func i64(n int64) string { return strconv.FormatInt(n, 10) }

// requestRefund and afterRefund are refunds.ts's, over this booking.
func (a *Agent) requestRefund(b *Booking, paymentID string, amountInr int64, decisions []Decision, expectHold bool, requestedBy []string) (string, error) {
	return a.refunds.RequestRefund(a.ctx, rcase{b}, paymentID, amountInr, decisionsAny(decisions...), expectHold, requestedBy)
}

func (a *Agent) afterRefund(b *Booking, result string, r payments.RefundAfter) { a.refunds.AfterRefund(rcase{b}, result, r) }

// ---- payments: look first, write, read back ---------------------------------------------------------------------------------------------------------------------------

func (a *Agent) depositPaise() int64 { return a.settings.Deposit.AmountInr * 100 }

// ensureLink is agent.ts ensureLink.
func (a *Agent) ensureLink(b *Booking) (payments.LinkResult, error) {
	return payments.EnsureLink(a.ctx, a.pay, payments.LinkRequest{Reference: b.ID, AmountPaise: a.depositPaise(), Description: a.settings.Name + " deposit"})
}

// closeLink is agent.ts closeLink.
func (a *Agent) closeLink(b *Booking, why string) {
	if b.LinkID == "" || a.pay == nil {
		return
	}
	closed := a.linkClosed(b.LinkID)
	outcome, notes := "unconfirmed", "the link could not be closed: it may still be open or already paid"
	if closed {
		outcome, notes = "confirmed", why
	}
	a.log(b, b.Customer, "cancel_deposit_link", outcome, map[string]any{"linkId": b.LinkID}, logMore{notes: notes})
	if a.ownerConfirms && closed {
		a.log(b, b.Customer, ActionClosed, "confirmed", map[string]any{"requestId": b.LinkID}, logMore{refs: map[string]string{"requestId": b.LinkID},
			notes: why + "; a mark by the owner that comes later is still recorded, and never books by itself"})
	}
}

// linkClosed is `payments.cancelRequest(id).then(() => payments.fetchRequest(id)).then((x) => x?.status === "cancelled").catch(() => false)`.
func (a *Agent) linkClosed(id string) bool {
	if _, err := a.pay.CancelRequest(a.ctx, id); err != nil {
		return false
	}
	l, err := a.pay.FetchRequest(a.ctx, id)
	return err == nil && l != nil && l.Status == "cancelled"
}

// ---- deposits ---------------------------------------------------------------------------------------------------------------------------------------------------------

// checkOneDepositPerBooking is limits.ts checkOneDepositPerBooking over the record.
func (a *Agent) checkOneDepositPerBooking(booking, paymentID string) Decision {
	recorded := a.confirmedRefs(booking, "record_deposit", "paymentId")
	if len(recorded) == 0 {
		return allow("one-deposit-per-booking", "No deposit is recorded for this booking yet, so this payment is its deposit.")
	}
	if contains(recorded, paymentID) {
		return allow("one-deposit-per-booking", "This payment is the booking's recorded deposit.")
	}
	return block("one-deposit-per-booking", "This booking already has its deposit, so this second payment is not counted. It is refunded and the owner is told.")
}

// reconcilePayments is agent.ts reconcilePayments: the payments service's record of this booking's link against what the agent has counted. On a UPI shop the owner's marks are
// that record (reconcileMarks; its outcome is the owner's own reply's, onOwnerMark).
func (a *Agent) reconcilePayments(b *Booking) error {
	if a.ownerConfirms {
		_, err := a.reconcileMarks(b)
		return err
	}
	if a.pay == nil {
		return runtime.Unported("a payment on a shop with no payments service")
	}
	if b.LinkID == "" {
		return nil
	}
	link, err := a.pay.FetchRequest(a.ctx, b.LinkID)
	if err != nil {
		return err
	}
	if link == nil {
		a.log(b, b.Customer, "record_deposit", "failed", map[string]any{"linkId": b.LinkID}, logMore{notes: "the payments service has no such link"})
		return nil
	}
	for _, p := range link.Payments {
		if contains(b.HandledPayments, p.ID) {
			continue
		}
		rule := a.checkOneDepositPerBooking(b.ID, p.ID)
		b.HandledPayments = append(b.HandledPayments, p.ID)
		inputs := map[string]any{"linkId": link.ID, "amount": p.Amount}
		if !rule.Blocked() {
			b.DepositPaymentID = p.ID
			b.DepositInr = ptr(p.Amount / 100)
			a.post(BookEvent{Kind: "received", Case: b.ID, PaymentID: p.ID, AmountPaise: p.Amount, Method: "gateway", Evidence: "provider", For: "advance"}, func(m map[string]string) {
				a.log(b, b.Customer, "record_deposit", "confirmed", inputs, logMore{decisions: []Decision{rule}, refs: mergeRefs(map[string]string{"paymentId": p.ID, "linkId": link.ID, "amountPaise": i64(p.Amount)}, m)})
			})
			if err := a.afterDeposit(b); err != nil {
				return err
			}
		} else {
			a.post(BookEvent{Kind: "received", Case: b.ID, PaymentID: p.ID, AmountPaise: p.Amount, Method: "gateway", Evidence: "provider", For: "extra"}, func(m map[string]string) {
				a.log(b, b.Customer, "record_deposit", "blocked", inputs, logMore{decisions: []Decision{rule}, refs: mergeRefs(map[string]string{"paymentId": p.ID, "amountPaise": i64(p.Amount)}, m)})
			})
			if err := a.handleExtraPayment(b, p.ID, p.Amount/100-p.AmountRefunded/100, rule); err != nil {
				return err
			}
		}
	}
	return nil
}

// afterDeposit is agent.ts afterDeposit.
func (a *Agent) afterDeposit(b *Booking) error {
	switch b.State {
	case AwaitingDeposit, NeedsOwner:
		return a.completeBooking(b)
	case Expired:
		// the hold ran out before the money came: take the slot again if it is still free; if not, give the money back
		held, err := a.tryHold(b)
		if err != nil {
			return err
		}
		if held.ok {
			_ = b.MoveTo(AwaitingDeposit)
			return a.completeBooking(b)
		}
		return a.refundUnbookable(b, "slot_gone")
	}
	return a.refundUnbookable(b, "inactive")
}

// completeBooking is agent.ts completeBooking: the deposit is recorded; now the calendar must show the booking too. Only then does the customer hear "booked".
func (a *Agent) completeBooking(b *Booking) error {
	want := wanted{*b.StartMs, *b.EndMs, "confirmed"}
	a.log(b, b.Customer, "confirm_booking", "attempted", want)
	found, err := a.ensureEvent(b, want)
	if err != nil {
		return err
	}
	if found.event != nil {
		b.EventID, b.HoldExpiresAt = found.event.ID, nil
		keep := b.Pending[:0]
		for _, p := range b.Pending {
			if p.PendingKind() != "calendar" {
				keep = append(keep, p)
			}
		}
		b.Pending = keep
		b.setReminders(ReminderSchedule(a.settings, *b.StartMs, a.now()))
		m := logMore{refs: map[string]string{"eventId": found.event.ID}}
		if a.ownList {
			m.notes = "read back from the shop's own booking list (this shop has no Google Calendar); the deposit is recorded too"
		}
		a.log(b, b.Customer, "confirm_booking", "confirmed", want, m)
		_ = b.MoveTo(Confirmed)
		// batch 5: a WhatsApp booking's own page link goes in the booked message too, when the shop has a page. Only while the customer's 24-hour window is open: outside it the
		// message must go as ONE approved template, and "booked" with a link is two (no template carries it), so the customer would not hear "booked" at all
		var page *pageLink
		if open, err := a.msg.IsWindowOpen(a.ctx, b.Customer); err == nil && open {
			page = a.pageLinkFor(b)
		}
		booked := "booked"
		if a.ownerConfirms {
			booked = "upi_booked"
		}
		templates, o := []string{booked}, sayOpts{offer: cancelOrOwner}
		if page != nil {
			templates, o.pageLink = append(templates, "booked_page_link"), page.url
		}
		if sent := a.tellCustomer(b, b.Customer, templates, o); sent && page != nil {
			a.keepPageLink(b, page.hash)
		}
		return nil
	}
	outcome, notes := "unconfirmed", "the calendar does not show the booking"
	if found.err != "" {
		outcome, notes = "failed", found.err
	}
	a.log(b, b.Customer, "confirm_booking", outcome, want, logMore{notes: notes})
	has := false
	for _, p := range b.Pending {
		has = has || p.PendingKind() == "calendar"
	}
	if !has {
		b.Pending = append(b.Pending, rawPending(map[string]string{"kind": "calendar"}))
	}
	if b.State != NeedsOwner {
		_ = b.MoveTo(NeedsOwner)
	}
	a.tellCustomer(b, b.Customer, []string{"couldnt_confirm"}, sayOpts{})
	a.tellOwner(b, b.Customer, "owner_cant_confirm", sayOpts{})
	return nil
}

// handleExtraPayment is agent.ts handleExtraPayment: a payment that is not the booking's deposit is refunded and the owner told.
func (a *Agent) handleExtraPayment(b *Booking, paymentID string, leftInr int64, oneDeposit Decision) error {
	p, err := a.pay.FetchPayment(a.ctx, paymentID)
	if err != nil {
		return err
	}
	if p != nil && p.AmountRefunded >= p.Amount {
		return nil // already refunded by someone
	}
	limit := CheckRefundLimit(leftInr, a.settings.Cancellation.RefundLimitInr, leftInr, false, true)
	if limit.Blocked() {
		a.log(b, b.Customer, "refund", "blocked", map[string]any{"paymentId": paymentID, "amountInr": leftInr}, logMore{decisions: []Decision{oneDeposit, limit}, refs: map[string]string{"paymentId": paymentID, "amountPaise": i64(leftInr * 100)}})
		return nil
	}
	// above the limit the agent does not ask the owner: Guard holds the refund, and the approvals relay asks, once
	result, err := a.requestRefund(b, paymentID, leftInr, []Decision{oneDeposit, limit}, limit.Verdict != "allow", nil)
	if err != nil {
		return err
	}
	a.afterRefund(b, result, payments.RefundAfter{PaymentID: paymentID, AmountInr: leftInr, DoneCust: "duplicate_refund", DoneOwner: "owner_duplicate_payment", Held: "duplicate_refund_pending"})
	return nil
}

// refundUnbookable is agent.ts refundUnbookable: the deposit arrived but there is no booking it can confirm.
func (a *Agent) refundUnbookable(b *Booking, why string) error {
	amountInr := *b.DepositInr
	limit := CheckRefundLimit(amountInr, a.settings.Cancellation.RefundLimitInr, amountInr, false, true)
	result := payments.ResultStopped
	if !limit.Blocked() {
		r, err := a.requestRefund(b, b.DepositPaymentID, amountInr, []Decision{limit}, limit.Verdict != "allow", nil)
		if err != nil {
			return err
		}
		result = r
	}
	if b.State != Cancelled {
		_ = b.MoveTo(Cancelled)
	}
	done := "refund_unbooked"
	if why == "slot_gone" {
		done = "slot_gone_refund"
	}
	a.afterRefund(b, result, payments.RefundAfter{PaymentID: b.DepositPaymentID, AmountInr: amountInr, DoneCust: done, DoneOwner: "owner_payment_unused", Held: "cancelled_refund_pending"})
	return nil
}

// onPaymentEvent is agent.ts onPaymentEvent: the event only says to look; the payments service's own record decides.
func (a *Agent) onPaymentEvent(ev payments.PaymentEvent) error {
	if a.pay == nil {
		return runtime.Unported("a payment event on a shop with no payments service")
	}
	if contains(a.store.SeenEvents, ev.ID) {
		a.log(nil, a.owner(), "receive_payment_event", "blocked", map[string]any{"id": ev.ID, "event": ev.Event}, logMore{notes: fmt.Sprintf("event %s was delivered again, so it is ignored", ev.ID)})
		return nil
	}
	if ev.Event == payments.EventRefundDone && ev.Payload.Refund != nil {
		paymentID, refundID := ev.Payload.Refund.PaymentID, ev.Payload.Refund.ID
		var b *Booking
		for _, x := range a.store.Bookings {
			if contains(x.HandledPayments, paymentID) || x.DepositPaymentID == paymentID {
				b = x
				break
			}
		}
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
		settles := b != nil && listed != nil && a.refunds.OpenIssueFor(rcase{b}, *listed) != nil
		phone := a.owner()
		if b != nil {
			phone = b.Customer
		}
		outcome, notes := "unconfirmed", "the payments service's own list does not show this refund, so nothing is settled by it"
		if listed != nil {
			outcome, notes = "confirmed", "the refund is on the payments service's own list"
			if settles {
				notes = "the refund is on the payments service's own list, and it is the one whose outcome was unknown: settled below"
			}
		}
		a.log(b, phone, "receive_payment_event", outcome, map[string]any{"id": ev.ID, "event": ev.Event}, logMore{refs: map[string]string{"refundId": refundID, "paymentId": paymentID}, notes: notes})
		if settles {
			a.refunds.SettleFromEvent(rcase{b}, *listed, ev.ID)
		}
		a.store.SeenEvents = append(a.store.SeenEvents, ev.ID)
		return nil
	}
	// a payment.received may name the payment and not its request: ask the payments service which request it paid
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
	var b *Booking
	if linkID != "" {
		for _, x := range a.store.Bookings {
			if x.LinkID == linkID {
				b = x
				break
			}
		}
	}
	if b == nil {
		a.log(nil, a.owner(), "receive_payment_event", "blocked", map[string]any{"id": ev.ID, "event": ev.Event}, logMore{notes: "no booking has this payment link, so the event is ignored"})
		a.store.SeenEvents = append(a.store.SeenEvents, ev.ID)
		return nil
	}
	a.log(b, b.Customer, "receive_payment_event", "confirmed", map[string]any{"id": ev.ID, "event": ev.Event}, logMore{refs: map[string]string{"eventId": ev.ID}})
	if err := a.reconcilePayments(b); err != nil { // the record decides; the event only said to look
		return err
	}
	a.store.SeenEvents = append(a.store.SeenEvents, ev.ID) // only after it worked: a failed step can be run again with the same event
	return nil
}

// ---- the licence: no new work in the wind-down, nothing more sent in the final stop --------------------------------------------------------------------------------

// takesNewWork is rules.ts takesNewWork: only a shop in order takes new bookings.
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

// pausedReply is agent.ts pausedReply: a request for new work while online booking is paused, said in the record and answered "please contact the shop"; nothing is kept for later.
func (a *Agent) pausedReply(phone, asked string, byGuard *Decision) {
	var d Decision
	if byGuard != nil {
		d = *byGuard
	} else {
		where := "wind-down"
		if a.c.Licence() == "stopped" {
			where = "final stop"
		}
		d = block("subscription_suspended", "online booking is paused: the shop's licence is in its "+where+", so no booking, hold or deposit link is made, and nothing is kept to do later (the runtime's own check of the lease)")
	}
	a.log(nil, phone, "new_work", "blocked", map[string]any{"asked": asked}, logMore{decisions: []Decision{d}, notes: "the customer is told online booking is paused and to contact the shop"})
	a.tellCustomer(nil, phone, []string{"booking_paused"}, sayOpts{})
}

// guardLicenceDecision is rules.ts guardLicenceDecision (the shared words in messaging).
func guardLicenceDecision(g *guard.GuardError) Decision {
	return Decision(messaging.GuardLicenceDecision(g.Guard.Reason, g.Guard.HasReason))
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
	notes := "The shop's licence is in order again: new bookings are taken from now on. Nothing asked during the wind-down is done now; a customer who still wants it asks again."
	switch now {
	case "wind_down":
		notes = "The shop's licence is in its wind-down (the lease fleet signed, read on this server): no new booking or deposit link is made, and nothing is kept to do later. Refunds owed, cancellations, existing bookings and payments from links sent earlier go on."
	case "stopped":
		notes = "The shop's licence has reached its final stop: open deposit links are closed and nothing more is sent from here, except the owner's one notice. Payments already made are still recorded and refunds still go through. Nothing is deleted."
	}
	refs := map[string]string{"state": now}
	if a.c.PaidThrough != nil {
		if p := a.c.PaidThrough(); p != nil {
			refs["paidThrough"] = i64(*p)
		}
	}
	a.log(nil, a.owner(), "licence", "confirmed", map[string]any{"state": now}, logMore{refs: refs, notes: notes})
}

// closeLinksAtStop is agent.ts closeLinksAtStop: the final stop, once for each paid_through, closes every open deposit link at the gateway, so no new payment comes in.
func (a *Agent) closeLinksAtStop() {
	if a.c.Licence() != "stopped" || !a.can.Cancels || a.pay == nil {
		return
	}
	var paid int64
	if a.c.PaidThrough != nil {
		if p := a.c.PaidThrough(); p != nil {
			paid = *p
		}
	}
	key := "stop:" + i64(paid)
	for _, b := range append([]*Booking(nil), a.store.Bookings...) {
		if b.State != AwaitingDeposit || b.LinkID == "" {
			continue
		}
		done := false
		for _, e := range a.c.Rec.Entries() {
			if e.Booking != nil && *e.Booking == b.ID && e.Action == "cancel_deposit_link" && e.Refs["licence"] == key {
				done = true
				break
			}
		}
		if done {
			continue
		}
		closed := a.linkClosed(b.LinkID)
		outcome, notes := "unconfirmed", "the final stop of the shop's licence: the link could not be closed (it may be paid already, or the gateway did not answer); the owner can close it in the gateway's own dashboard"
		if closed {
			outcome, notes = "confirmed", "the final stop of the shop's licence: the open deposit link is closed, so no new payment comes in; a payment already made is still recorded"
		}
		a.log(b, b.Customer, "cancel_deposit_link", outcome, map[string]any{"linkId": b.LinkID}, logMore{refs: map[string]string{"linkId": b.LinkID, "licence": key}, notes: notes})
	}
}

// ---- the clock's beat ----------------------------------------------------------------------------------------------------------------------------------------------

// expireHold is agent.ts expireHold: before giving the slot up, look at the payments record (the event may have been lost).
func (a *Agent) expireHold(b *Booking) error {
	if err := a.reconcilePayments(b); err != nil {
		return err
	}
	if b.State != AwaitingDeposit {
		return nil
	}
	slot := b.StartMs
	a.releaseSlot(b, "the hold ran out before a deposit was recorded")
	a.closeLink(b, "the hold ran out")
	_ = b.MoveTo(Expired)
	expired := "hold_expired"
	if a.ownerConfirms {
		expired = "upi_hold_expired"
	}
	a.tellCustomer(b, b.Customer, []string{expired}, sayOpts{slotMs: slot})
	if a.ownerConfirms {
		// part of the deposit was marked, and the hold ran out: that part is the customer's, and the owner owes it back
		if r := a.requestOf(b); r != nil && len(r.Marks) > 0 {
			if part := markedPaise(r); part > 0 {
				a.oweBack(b, r.Marks[len(r.Marks)-1].ID, part, "part of the deposit was marked received, and the hold ran out", oweOpts{customer: "upi_refund_owed"})
			}
		}
	}
	return nil
}

// backfillCalendar is agent.ts backfillCalendar: a shop that was on its own booking list and now has Google Calendar gets its coming bookings written there once.
func (a *Agent) backfillCalendar(now int64) error {
	kind := ""
	var cs struct {
		Kind string `json:"kind"`
	}
	if a.store.CalendarState != nil {
		_ = json.Unmarshal(a.store.CalendarState, &cs)
		kind = cs.Kind
	}
	if a.ownList {
		if kind != "own" {
			a.store.CalendarState = []byte(`{"kind":"own"}`)
		}
		return nil
	}
	if kind != "own" {
		return nil
	}
	allIn := true
	for _, b := range append([]*Booking(nil), a.store.Bookings...) {
		if b.StartMs == nil || b.EndMs == nil || *b.EndMs <= now {
			continue
		}
		status := ""
		switch {
		case b.State == Confirmed || b.State == NeedsOwner:
			status = "confirmed"
		case b.State == AwaitingDeposit && b.HoldExpiresAt != nil && *b.HoldExpiresAt > now:
			status = "tentative"
		}
		if status == "" {
			continue
		}
		found, err := a.ensureEvent(b, wanted{*b.StartMs, *b.EndMs, status})
		if err != nil {
			return err
		}
		if found.event != nil {
			b.EventID = found.event.ID
			continue
		}
		allIn = false
		outcome := "unconfirmed"
		if found.err != "" || found.conflict {
			outcome = "failed"
		}
		why := found.err
		if why == "" {
			why = "the calendar does not show it"
		}
		a.log(b, b.Customer, "calendar_backfill", outcome, map[string]any{"start": *b.StartMs}, logMore{notes: "this booking is in the shop's booking list but could not be written to the new Google Calendar yet (" + why + "); it stays booked and is tried again"})
	}
	if allIn {
		a.store.CalendarState = []byte(`{"kind":"google"}`)
		a.log(nil, a.owner(), "calendar_backfill", "confirmed", map[string]any{"kind": "google"}, logMore{notes: "every coming booking from the shop's own list is now in the Google Calendar"})
	}
	return nil
}

// onTick is agent.ts onTick. Not ported here yet (Deferred.md): the button-mode announcement, yesterday's settlement rows for the books, the assistant's cards.
func (a *Agent) onTick() error {
	now := a.now()
	if err := a.backfillCalendar(now); err != nil {
		return err
	}
	if a.pay != nil {
		if err := a.refunds.Sweep(a.ctx, now); err != nil { // refunds first, whatever state their booking is in
			return err
		}
	}
	if a.marks != nil {
		a.remindOwedRefunds(now)
	}
	a.closeLinksAtStop()
	for _, b := range append([]*Booking(nil), a.store.Bookings...) {
		if b.State == AwaitingDeposit && b.HoldExpiresAt != nil && *b.HoldExpiresAt <= now {
			if err := a.expireHold(b); err != nil {
				return err
			}
		}
		if b.State != Confirmed || b.StartMs == nil || b.EndMs == nil {
			continue
		}
		// reminders: if several fell due while nothing was running, send one, the latest; whether it may go is the limits' call
		rs := b.reminders()
		if due, _ := TakeDue(rs, now); due {
			b.setReminders(rs)
			if *b.StartMs > now {
				a.tellCustomer(b, b.Customer, []string{"reminder"}, sayOpts{reminder: true})
			}
		}
		if *b.EndMs <= now {
			_ = b.MoveTo(Completed)
			b.setReminders([]Reminder{})
			own := func(money map[string]string) {
				m := logMore{}
				if len(money) > 0 {
					m.refs = money
				}
				a.log(b, b.Customer, "complete_booking", "confirmed", map[string]any{"endMs": *b.EndMs}, m)
			}
			if b.DepositInr != nil && *b.DepositInr > 0 {
				service := b.ServiceID
				if service == "" {
					service = "bookings"
				}
				a.post(BookEvent{Kind: "applied", Case: b.ID, AmountPaise: *b.DepositInr * 100, Service: service}, own)
			} else {
				own(map[string]string{})
			}
		}
	}
	return nil
}

// ---- recovery: the panel's to-do list asks the agent to look again, or ask again -----------------------------------------------------------------------------------

// onRecovery is agent.ts onRecovery. It carries no authority: every call is one the agent already makes, and Guard decides each as it does every day.
func (a *Agent) onRecovery(ev map[string]any) error {
	id, _ := ev["id"].(string)
	cs, _ := ev["case"].(string)
	action, _ := ev["action"].(string)
	b := a.store.Booking(cs)
	refs := map[string]string{"action": action, "recovery": id}
	say := func(outcome, notes string) {
		a.log(b, a.owner(), RecoveryEntry, outcome, map[string]any{"action": action, "case": cs}, logMore{notes: notes, refs: refs})
	}
	if b == nil {
		say("blocked", "no booking has this id, so nothing was done")
		return nil
	}
	switch action {
	case "recheck_payment":
		if b.LinkID == "" {
			say("blocked", "this booking has no payment link to look at")
			return nil
		}
		say("attempted", "looking again at the payments service's list for this booking's link")
		if err := a.reconcilePayments(b); err != nil {
			return err
		}
		say("confirmed", "the payments service's list was read; any payment not yet counted was recorded above")
		return nil
	case "retry_booking":
		if b.DepositPaymentID == "" || (b.State != NeedsOwner && b.State != AwaitingDeposit) {
			say("blocked", "this booking has no deposit waiting on the calendar, so there is nothing to confirm again")
			return nil
		}
		say("attempted", "asking the calendar again to confirm the booking the deposit paid for")
		return a.completeBooking(b) // sends "booked" only if the calendar now shows it
	case "ask_owner_again":
		if a.marks != nil && a.markAskAgain(b, say) {
			return nil
		}
		var cal bool
		var refund *OwnerRefund
		for _, p := range b.Pending {
			if p.PendingKind() == "calendar" {
				cal = true
			}
			if r := OwnerRefundOf(p); r != nil && refund == nil {
				refund = r
			}
		}
		if !cal && refund == nil {
			say("blocked", "nothing the agent asked the owner is waiting (a refund Guard holds is asked by the approvals relay)")
			return nil
		}
		say("attempted", "telling the owner again")
		var told bool
		if cal {
			told = a.tellOwner(b, b.Customer, "owner_cant_confirm", sayOpts{})
		} else {
			told = a.tellOwner(b, b.Customer, "owner_late_cancellation", sayOpts{refundInr: ptr(refund.AmountInr)})
		}
		if told {
			say("confirmed", "the owner was told again")
		} else {
			say("failed", "the owner could not be told (the limits or the provider said no)")
		}
		return nil
	case "recheck_refund":
		open := false
		for _, i := range b.RefundIssues {
			if contains(payments.SettleableIssues, i.Kind) {
				open = true
			}
		}
		if !open {
			say("blocked", "no refund here is waiting on an unclear outcome")
			return nil
		}
		if a.pay == nil {
			return runtime.Unported("recheck_refund on a shop with no payments service")
		}
		say("attempted", "looking again, read-only, for a refund that may have gone")
		settled, looked, told, err := a.refunds.Recheck(a.ctx, rcase{b})
		if err != nil {
			return err
		}
		say("confirmed", payments.RecheckLine(settled, looked, told))
		return nil
	}
	say("blocked", `the agent has no recovery called "`+action+`"`)
	return nil
}
