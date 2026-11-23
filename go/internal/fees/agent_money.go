package fees

// The money of a fee: the Go twin of due.ts's sums (owed, paid, balance, in paise so nothing is a fraction) and agent.ts's payment record (reconcile, settle, refundExcess), the
// link for what is still owed (currentLink), closing what is no longer wanted, the books (feesAccounting: every money line goes through Post), the shared refunds
// (modules/payments/refunds.ts) and a payment event.

import (
	"fmt"
	"sort"

	"github.com/GeometerLabs/agents/go/internal/accounting"
	"github.com/GeometerLabs/agents/go/internal/guard"
	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/payments"
	"github.com/GeometerLabs/agents/go/internal/payments/ownermarked"
)

// owedPaise is due.ts owedPaise: the fee and the late fee, less what was waived.
func owedPaise(d *Due) int64 { return (d.FeeInr + d.LateFeeInr - d.WaivedInr) * 100 }

// paidPaise is what the payment record shows paid on the fee's links, as counted.
func paidPaise(d *Due) int64 {
	var n int64
	for _, p := range d.Payments {
		n += p.AmountPaise
	}
	return n
}

func balancePaise(d *Due) int64 { return owedPaise(d) - paidPaise(d) }

// balanceInr is due.ts balanceInr: never below 0, whole rupees (a balance is whole rupees: every amount is).
func balanceInr(d *Due) int64 { return max(0, balancePaise(d)) / 100 }

// moveTo is due.ts moveTo: open goes to paid or closed, and both are final.
func moveTo(d *Due, to string) error {
	if d.State == to || (d.State == Open && (to == Paid || to == Closed)) {
		d.State = to
		return nil
	}
	return fmt.Errorf("A fee cannot go from %s to %s.", d.State, to)
}

// duesOf is due.ts duesOf: the fees of a parent's number, newest first.
func (s *Store) duesOf(phone string) []*Due {
	var out []*Due
	for i := len(s.Dues) - 1; i >= 0; i-- {
		if s.Dues[i].Customer == phone {
			out = append(out, s.Dues[i])
		}
	}
	return out
}

// openDues is due.ts openDues: the parent's open fees, oldest due date first (a stable sort, as Array#sort is).
func (s *Store) openDues(phone string) []*Due {
	var out []*Due
	for _, d := range s.duesOf(phone) {
		if d.State == Open {
			out = append(out, d)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].DueMs < out[j].DueMs })
	return out
}

func (d *Due) linkOf() *LinkRecord {
	for i := range d.Links {
		if d.Links[i].ID == d.CurrentLinkID {
			return &d.Links[i]
		}
	}
	return nil
}

func (d *Due) paidOnLink(linkID string) int64 {
	var n int64
	for _, p := range d.Payments {
		if p.LinkID == linkID {
			n += p.AmountPaise
		}
	}
	return n
}

func (d *Due) counted(id string) bool {
	for _, p := range d.Payments {
		if p.ID == id {
			return true
		}
	}
	return false
}

// ---- the books ----

func (a *Agent) accounts() accounting.Accounting {
	if a.acct == nil {
		acct, err := accounting.FeesAccounting(a.c.Rec, a.settings.Timezone, clock(a.now))
		if err != nil {
			panic(err) // the shop's own legacy map: a programming fault
		}
		a.acct = acct
	}
	return a.acct
}

type clock func() int64

func (c clock) Now() int64 { return c() }

// post is books.post: the money event is posted and the template's own line is written with the money refs (modules/accounting/post.ts). A post that refuses (a repeat) still
// writes the line with no money refs, as the TypeScript's write runs.
func (a *Agent) post(e accounting.MoneyEvent, write func(money map[string]string)) {
	wrote := false
	_, err := a.accounts().Post(e, func(m map[string]string) error { wrote = true; write(m); return nil })
	if err != nil && !wrote {
		write(map[string]string{})
	}
}

func strp(s string) *string { return &s }

func merge(ms ...map[string]string) map[string]string {
	out := map[string]string{}
	for _, m := range ms {
		for k, v := range m {
			out[k] = v
		}
	}
	return out
}

// ---- the payment record ----

// reconcile is agent.ts reconcile: read every payment on the fee's links and count the ones not counted yet. ok is false if any link could not be read just now.
func (a *Agent) reconcile(d *Due) (ok bool, fresh []CountedPayment, err error) {
	ok = true
	for _, link := range d.Links {
		found, ferr := a.pay.FetchRequest(a.ctx, link.ID)
		if ferr != nil {
			if !isServiceError(ferr) {
				return false, nil, ferr
			}
			ok = false
			a.log(d, d.Customer, "record_payment", "failed", map[string]any{"linkId": link.ID}, logMore{notes: "the payments service could not be read just now (" + ferr.Error() + ")", refs: map[string]string{"linkId": link.ID}})
			continue
		}
		if found == nil {
			ok = false
			a.log(d, d.Customer, "record_payment", "failed", map[string]any{"linkId": link.ID}, logMore{notes: "the payments service has no such link", refs: map[string]string{"linkId": link.ID}})
			continue
		}
		for _, p := range found.Payments {
			if d.counted(p.ID) {
				continue
			}
			c := CountedPayment{ID: p.ID, AmountPaise: p.Amount, LinkID: link.ID}
			d.Payments = append(d.Payments, c)
			fresh = append(fresh, c)
			lid, pid, amount := link.ID, p.ID, p.Amount
			if a.ownerConfirms {
				notes := "marked paid by owner: from the owner's own number, with a one-use code"
				if found.Status == "cancelled" {
					notes = "marked received by the owner on a request the agent had replaced (the amount changed): it counts toward the fee"
				}
				a.post(accounting.MoneyEvent{Kind: "received", Case: strp(d.ID), PaymentID: pid, AmountPaise: amount, Method: "upi", Evidence: "owner_mark", For: "fee"}, func(m map[string]string) {
					a.log(d, d.Customer, ActMarked, "confirmed", map[string]any{"requestId": lid, "amount": amount}, logMore{notes: notes, refs: merge(map[string]string{"paymentId": pid, "linkId": lid, "requestId": lid, "amountPaise": itoa(amount), "markedBy": "owner"}, m)})
				})
			} else {
				a.post(accounting.MoneyEvent{Kind: "received", Case: strp(d.ID), PaymentID: pid, AmountPaise: amount, Method: "gateway", Evidence: "provider", For: "fee"}, func(m map[string]string) {
					a.log(d, d.Customer, "record_payment", "confirmed", map[string]any{"linkId": lid, "amount": amount}, logMore{refs: merge(map[string]string{"paymentId": pid, "linkId": lid, "amountPaise": itoa(amount)}, m)})
				})
			}
		}
	}
	return ok, fresh, nil
}

// isServiceError is agent.ts's `e instanceof TimeoutError || e instanceof ApiError`: an answer of the service, which is written down; anything else is thrown.
func isServiceError(err error) bool {
	if _, ok := guard.IsAPI(err); ok {
		return true
	}
	return guard.MayHaveHappened(err) || guard.IsNotSent(err) || guard.WaitsForGuard(err) || isGuardErr(err)
}

func isGuardErr(err error) bool { _, ok := guard.AsGuard(err); return ok }

// settle is agent.ts settle: what the record now shows, and what to do about it. receipt says whether the parent was sent a receipt in this step.
func (a *Agent) settle(d *Due, fresh []CountedPayment) (receipt bool, err error) {
	if len(fresh) == 0 && !(d.State == Open && balancePaise(d) <= 0 && len(d.Payments) > 0) {
		return false, nil
	}
	owed, paid := owedPaise(d), paidPaise(d)
	var freshPaise int64
	for _, p := range fresh {
		freshPaise += p.AmountPaise
	}
	before := paid - freshPaise
	excess := max(0, paid-max(owed, before))
	useful := freshPaise - excess
	if d.State == Open && paid >= owed && len(d.Payments) > 0 {
		if err := moveTo(d, Paid); err != nil {
			return false, err
		}
		a.log(d, d.Customer, "settle_fee", "confirmed", map[string]any{"paidPaise": paid, "owedPaise": owed}, logMore{refs: map[string]string{"amountPaise": itoa(paid)}})
	}
	if useful > 0 {
		got := N(useful / 100)
		if paid >= owed {
			receipt = a.tellCustomer(d, d.Customer, []string{"fee_received"}, sayOpts{receivedInr: got})
		} else {
			if !a.can.TakesPartPayments {
				if _, err := a.currentLink(d); err != nil {
					return false, err
				}
			}
			receipt = a.tellCustomer(d, d.Customer, []string{"fee_part_received"}, sayOpts{receivedInr: got, offer: feeButtons(d, "pay", "owner")})
		}
	}
	if excess > 0 {
		if err := a.refundExcess(d, fresh, excess); err != nil {
			return receipt, err
		}
	}
	return receipt, nil
}

// look is reconcile then settle, as most callers do.
func (a *Agent) look(d *Due) (ok, receipt bool, err error) {
	ok, fresh, err := a.reconcile(d)
	if err != nil {
		return false, false, err
	}
	receipt, err = a.settle(d, fresh)
	return ok, receipt, err
}

// refundExcess is agent.ts refundExcess: more was paid than is owed: the extra goes back, newest payment first, within the refund limit.
func (a *Agent) refundExcess(d *Due, fresh []CountedPayment, excessPaise int64) error {
	left := excessPaise
	for i := len(fresh) - 1; i >= 0 && left > 0; i-- {
		c := fresh[i]
		var refunded int64
		if p, err := a.pay.FetchPayment(a.ctx, c.ID); err == nil && p != nil {
			refunded = p.AmountRefunded
		}
		give := min(left, c.AmountPaise-refunded)
		if give < 100 {
			continue
		}
		amountInr := give / 100
		left -= amountInr * 100
		once := checkOneRefundPerPayment(c.ID, refunded)
		limit := checkRefundLimit(amountInr, a.settings.RefundLimitInr, float64(c.AmountPaise)/100, false)
		if once.Verdict == "block" || limit.Verdict == "block" {
			a.log(d, d.Customer, "refund", "blocked", map[string]any{"paymentId": c.ID, "amountInr": amountInr}, logMore{decisions: []Decision{once, limit}, refs: map[string]string{"paymentId": c.ID, "amountPaise": itoa(amountInr * 100)}})
			continue
		}
		if a.ownerRefunds {
			a.oweBack(d, c.ID, amountInr*100, "paid more than was owed", []Decision{once, limit})
			continue
		}
		result, err := a.refunds.RequestRefund(a.ctx, refundCase{d}, c.ID, amountInr, []any{once, limit}, limit.Verdict != "allow", nil)
		if err != nil {
			return err
		}
		a.refunds.AfterRefund(refundCase{d}, result, payments.RefundAfter{PaymentID: c.ID, AmountInr: amountInr, DoneCust: "fee_refund_done", DoneOwner: "owner_overpayment", Held: "fee_refund_pending"})
	}
	return nil
}

// linkResult is currentLink's answer: ok, or why not, and whether it was the licence (paused).
type linkResult struct {
	ok     bool
	why    string
	paused bool
}

// currentLink is agent.ts currentLink: the link a parent should pay now, made for exactly what is still owed.
func (a *Agent) currentLink(d *Due) (linkResult, error) {
	balance := balancePaise(d)
	if balance <= 0 {
		return linkResult{why: "nothing is owed"}, nil
	}
	old := d.linkOf()
	if old != nil {
		same := old.AmountPaise-d.paidOnLink(old.ID) == balance
		if !a.can.TakesPartPayments {
			same = old.AmountPaise == balance && d.paidOnLink(old.ID) == 0
		}
		if same {
			return linkResult{ok: true}, nil
		}
	}
	if !a.takesNewWork() {
		a.log(d, d.Customer, "create_fee_link", "blocked", map[string]any{"amountPaise": balance}, logMore{decisions: []Decision{a.pausedDecision()}})
		return linkResult{why: "online fee payment is paused (the centre's licence)", paused: true}, nil
	}
	if balance%100 != 0 {
		return linkResult{why: "the balance is not a whole number of rupees"}, nil
	}
	decision := checkFeeLink(balance/100, balance/100, a.settings.HighestDueInr())
	if decision.Verdict == "block" {
		a.log(d, d.Customer, "create_fee_link", "blocked", map[string]any{"amountPaise": balance}, logMore{decisions: []Decision{decision}})
		return linkResult{why: decision.Reason}, nil
	}
	seq := d.LinkSeq + 1
	reference := fmt.Sprintf("%s.%d", d.ID, seq)
	a.log(d, d.Customer, "create_fee_link", "attempted", map[string]any{"amountPaise": balance, "reference": reference}, logMore{decisions: []Decision{decision}})
	minPart := min(a.settings.PartPayments.MinInr*100, balance)
	desc := fmt.Sprintf("%s: %s, %s, %s", a.settings.Name, d.StudentName, d.BatchID, d.Month)
	res, err := payments.EnsureLink(a.ctx, a.pay, payments.LinkRequest{Reference: reference, AmountPaise: balance, Description: desc, AcceptPartial: a.settings.PartPayments.Allowed, MinPartialPaise: &minPart})
	if err != nil {
		return linkResult{}, err
	}
	if res.Link == nil && res.Suspended != nil {
		reason, has := res.Suspended.Guard.Reason, res.Suspended.Guard.HasReason
		a.log(d, d.Customer, "create_fee_link", "blocked", map[string]any{"amountPaise": balance, "reference": reference}, logMore{decisions: []Decision{messaging.GuardLicenceDecision(reason, has)}, notes: res.Suspended.Error(), refs: map[string]string{"reference": reference}})
		return linkResult{why: "online fee payment is paused (the centre's licence)", paused: true}, nil
	}
	if res.Link == nil {
		outcome, notes := "unconfirmed", "the payments service does not show the link"
		if res.Error != "" {
			outcome, notes = "failed", res.Error
		}
		a.log(d, d.Customer, "create_fee_link", outcome, map[string]any{"amountPaise": balance, "reference": reference}, logMore{notes: notes, refs: map[string]string{"reference": reference}})
		return linkResult{why: notes}, nil
	}
	link := res.Link
	d.LinkSeq = seq
	d.Links = append(d.Links, LinkRecord{ID: link.ID, URL: link.PayURL, Reference: reference, AmountPaise: link.Amount})
	d.CurrentLinkID = link.ID
	a.log(d, d.Customer, "create_fee_link", "confirmed", map[string]any{"amountPaise": balance, "reference": reference}, logMore{refs: map[string]string{"linkId": link.ID, "reference": reference, "amountPaise": itoa(balance)}})
	if a.ownerConfirms {
		a.markedRequestMade(d, link.ID, paidPaise(d) > 0)
	}
	if old != nil {
		closed := a.cancelAndConfirm(old.ID)
		outcome, notes := "unconfirmed", "the old link could not be closed (it has a part payment on it, or the payments service did not answer): it stays open, and anything it collects beyond what is owed is given back"
		if closed {
			outcome, notes = "confirmed", "the amount owed changed, so the old link was closed"
		}
		a.log(d, d.Customer, "cancel_fee_link", outcome, map[string]any{"linkId": old.ID}, logMore{refs: map[string]string{"linkId": old.ID}, notes: notes})
		if a.ownerConfirms && closed {
			a.log(d, d.Customer, ActClosed, "confirmed", map[string]any{"requestId": old.ID}, logMore{refs: map[string]string{"requestId": old.ID}, notes: "the amount owed changed, so a new request was made; a mark the owner makes on this one later still counts toward the fee"})
		}
	}
	return linkResult{ok: true}, nil
}

// cancelAndConfirm is `payments.cancelRequest(id).then(() => payments.fetchRequest(id)).then((l) => l?.status === "cancelled").catch(() => false)`.
func (a *Agent) cancelAndConfirm(id string) bool {
	if _, err := a.pay.CancelRequest(a.ctx, id); err != nil {
		return false
	}
	l, err := a.pay.FetchRequest(a.ctx, id)
	return err == nil && l != nil && l.Status == "cancelled"
}

// closeOpenLinks is agent.ts closeOpenLinks: a settled fee asks for nothing more.
func (a *Agent) closeOpenLinks(d *Due) {
	if a.ownerConfirms {
		a.closeOpenRequests(d)
		return
	}
	for _, l := range d.Links {
		if d.paidOnLink(l.ID) > 0 || hasPaymentOn(d, l.ID) {
			continue
		}
		_, err := a.pay.CancelRequest(a.ctx, l.ID)
		outcome, notes := "confirmed", "the fee was marked paid by hand, so its payment link is closed"
		if err != nil {
			outcome, notes = "unconfirmed", "the fee was marked paid by hand and the link could not be closed; a payment that still comes on it is given back"
		}
		a.log(d, d.Customer, "cancel_fee_link", outcome, map[string]any{"linkId": l.ID}, logMore{refs: map[string]string{"linkId": l.ID}, notes: notes})
	}
}

func hasPaymentOn(d *Due, linkID string) bool {
	for _, p := range d.Payments {
		if p.LinkID == linkID {
			return true
		}
	}
	return false
}

// ---- refunds, shared with every template ----

// CaseID is the fee's id, as the refunds code names a case.
func (d *Due) CaseID() string { return d.ID }

// refundCase adapts a fee to payments.RefundCase (its Customer and Pending are fields of Due, so the methods are on this wrapper).
type refundCase struct{ *Due }

func (r refundCase) Customer() string                  { return r.Due.Customer }
func (r refundCase) Pending() *[]payments.Pending      { return &r.Due.Pending }
func (r refundCase) Issues() *[]*payments.RefundIssue  { return &r.Due.RefundIssues }
func (r refundCase) Stopped() *[]string                { return &r.Due.StoppedRefunds }
func (r refundCase) Untold() *[]*payments.UntoldRefund { return &r.Due.RefundsUntold }

func caseOf(c payments.RefundCase) *Due {
	switch x := c.(type) {
	case refundCase:
		return x.Due
	case *refundCase:
		return x.Due
	}
	return nil
}

func (a *Agent) refundDeps() payments.RefundDeps {
	paise := func(p int64) sayOpts {
		if p < 0 {
			return sayOpts{}
		}
		return sayOpts{refundInr: N(p / 100)}
	}
	return payments.RefundDeps{
		Payments: a.pay, Now: a.now, Owner: a.owner(),
		LimitInr: func() int64 { return a.settings.RefundLimitInr },
		Log: func(c payments.RefundCase, phone, action, outcome string, inputs map[string]any, more payments.LogMore) {
			var ds []Decision
			for _, x := range more.Decisions {
				if d, ok := x.(Decision); ok {
					ds = append(ds, d)
				}
			}
			var d *Due
			if c != nil {
				d = caseOf(c)
			}
			a.log(d, phone, action, outcome, inputs, logMore{decisions: ds, notes: more.Notes, refs: more.Refs})
		},
		TellCustomer: func(c payments.RefundCase, phone string, templates []string, refundPaise int64) bool {
			return a.tellCustomer(caseOf(c), phone, templates, paise(refundPaise))
		},
		TellCustomerOutcome: func(c payments.RefundCase, phone, template string, refundPaise int64) string {
			return a.tellCustomerOutcome(caseOf(c), phone, template, paise(refundPaise))
		},
		TellOwner: func(c payments.RefundCase, phone, template string, refundPaise int64) bool {
			return a.tellOwner(caseOf(c), phone, template, paise(refundPaise))
		},
		Cases: func() []payments.RefundCase {
			out := make([]payments.RefundCase, len(a.store.Dues))
			for i, d := range a.store.Dues {
				out[i] = refundCase{d}
			}
			return out
		},
		IDs:        payments.RefundIDs{Checking: "fee_refund_checking", Denied: "fee_refund_denied", Approved: "fee_refund_approved", Expired: "fee_refund_expired", Settled: "owner_refund_settled", Confirmed: "fee_refund_confirmed"},
		Accounting: refundBooks{a},
	}
}

type refundBooks struct{ a *Agent }

func (r refundBooks) Post(e payments.MoneyEvent, write func(map[string]string)) {
	m := accounting.MoneyEvent{Kind: accounting.MoneyKind(e.Kind), Case: strp(e.Case), PaymentID: e.PaymentID, AmountPaise: e.AmountPaise, Method: accounting.Method(e.Method), Evidence: accounting.Evidence(e.Evidence), Why: e.Why}
	if e.Owed != "" {
		m.Owed = strp(e.Owed)
	}
	if e.RefundID != "" {
		m.RefundID = strp(e.RefundID)
	}
	r.a.post(m, write)
}

// onPaymentEvent is agent.ts onPaymentEvent: the event only says to look; the payments service's own list decides.
func (a *Agent) onPaymentEvent(e payments.PaymentEvent) error {
	if contains(a.store.SeenEvents, e.ID) {
		a.log(nil, a.owner(), "receive_payment_event", "blocked", map[string]any{"id": e.ID, "event": e.Event}, logMore{notes: "event " + e.ID + " was delivered again, so it is ignored"})
		return nil
	}
	if e.Event == "refund.done" && e.Payload.Refund != nil {
		paymentID, refundID := e.Payload.Refund.PaymentID, e.Payload.Refund.ID
		var d *Due
		for _, x := range a.store.Dues {
			if x.counted(paymentID) {
				d = x
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
			}
		}
		settles := d != nil && listed != nil && a.refunds.OpenIssueFor(refundCase{d}, *listed) != nil
		phone := a.owner()
		if d != nil {
			phone = d.Customer
		}
		outcome, notes := "unconfirmed", "the payments service's own list does not show this refund, so nothing is settled by it"
		if listed != nil {
			outcome, notes = "confirmed", "the refund is on the payments service's own list"
			if settles {
				notes = "the refund is on the payments service's own list, and it is the one whose outcome was unknown: settled below"
			}
		}
		a.log(d, phone, "receive_payment_event", outcome, map[string]any{"id": e.ID, "event": e.Event}, logMore{refs: map[string]string{"refundId": refundID, "paymentId": paymentID}, notes: notes})
		if settles {
			a.refunds.SettleFromEvent(refundCase{d}, *listed, e.ID)
		}
		a.store.SeenEvents = append(a.store.SeenEvents, e.ID)
		return nil
	}
	var linkID, paymentID string
	if e.Payload.Payment != nil {
		paymentID = e.Payload.Payment.ID
	}
	if e.Payload.Request != nil {
		linkID = e.Payload.Request.ID
	} else if e.Payload.Payment != nil && e.Payload.Payment.RequestID != "" {
		linkID = e.Payload.Payment.RequestID
	} else if paymentID != "" {
		list, err := a.pay.ListRequests(a.ctx, payments.ListQuery{PaymentID: paymentID})
		if err != nil {
			return err
		}
		if len(list) > 0 {
			linkID = list[0].ID
		}
	}
	var d *Due
	if linkID != "" {
		for _, x := range a.store.Dues {
			for _, l := range x.Links {
				if l.ID == linkID && d == nil {
					d = x
				}
			}
		}
	}
	if d == nil {
		a.log(nil, a.owner(), "receive_payment_event", "blocked", map[string]any{"id": e.ID, "event": e.Event}, logMore{notes: "no fee has this payment link, so the event is ignored"})
		a.store.SeenEvents = append(a.store.SeenEvents, e.ID)
		return nil
	}
	a.log(d, d.Customer, "receive_payment_event", "confirmed", map[string]any{"id": e.ID, "event": e.Event}, logMore{refs: map[string]string{"eventId": e.ID}})
	if _, _, err := a.look(d); err != nil {
		return err
	}
	a.store.SeenEvents = append(a.store.SeenEvents, e.ID)
	return nil
}

var _ = ownermarked.Empty
