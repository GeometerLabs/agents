package fees

// Owner-marked money (B33; modules/payments/owner-marked): agent.ts's UPI section. The parent pays the centre's own UPI ID; a payment counts ONLY when the owner marks it received
// with the one-use code the agent sent only to them. A screenshot, the "I have paid" button or the words ask the owner to look and mark nothing. A refund is owed by the owner,
// reminded, and "sent" is said only after the owner marks it. The ledger is the store's `upi` member (ownermarked.State), read through the same Payments shape (ownermarked.View),
// so the owner's marks are counted by the same reconcile a gateway's payments are.

import (
	"strings"

	"github.com/GeometerLabs/agents/go/internal/accounting"
	"github.com/GeometerLabs/agents/go/internal/assistant"
	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/payments/ownermarked"
)

func (a *Agent) requestByID(id string) *ownermarked.MarkedRequest {
	if a.marks == nil || id == "" {
		return nil
	}
	for _, r := range a.marks.Requests {
		if r.ID == id {
			return r
		}
	}
	return nil
}

func codeOf(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func liveRequest(r *ownermarked.MarkedRequest) bool {
	return r != nil && (r.Status == ownermarked.StatusCreated || r.Status == ownermarked.StatusPartiallyPaid)
}

// receivedButtons is agent.ts receivedButtons: "Received ₹1,500" carrying the request's code.
func (a *Agent) receivedButtons(r *ownermarked.MarkedRequest, amountPaise int64) *offer {
	if r == nil || codeOf(r.Code) == "" || amountPaise <= 0 {
		return nil
	}
	return &offer{choices: markChoices(a.settings.Owner.Language, "received", *r.Code, float64(amountPaise)/100)}
}

func (a *Agent) refundButtons(r *ownermarked.OwedRefund) *offer {
	if codeOf(r.Code) == "" {
		return nil
	}
	return &offer{choices: markChoices(a.settings.Owner.Language, "refund", *r.Code, 0)}
}

// qrOf is agent.ts qrOf: the QR picture of the fee's current request, made once (best effort).
func (a *Agent) qrOf(d *Due) *messaging.SayImage {
	if !a.ownerConfirms {
		return nil
	}
	r := a.requestByID(d.CurrentLinkID)
	if r == nil {
		return nil
	}
	if r.ImageLink == "" && a.kit.Ports.QR != nil {
		r.ImageLink = a.kit.Ports.QR(r.Link)
	}
	if r.ImageLink == "" {
		return nil
	}
	caption := "fee_upi_qr_caption"
	if isCredit(d) {
		caption = "credit_upi_qr_caption" // the credit book: the caption names no student
	}
	return &messaging.SayImage{Link: r.ImageLink, Caption: []string{caption}}
}

// markedRequestMade is agent.ts markedRequestMade: in the record, and the owner told what to look for with the code and the Received button.
func (a *Agent) markedRequestMade(d *Due, requestID string, rest bool) {
	r := a.requestByID(requestID)
	if r == nil {
		return
	}
	a.log(d, d.Customer, ActRequest, "confirmed", map[string]any{"amountPaise": r.AmountPaise}, logMore{refs: map[string]string{"requestId": requestID, "reference": r.Reference, "amountPaise": itoa(r.AmountPaise)}, notes: "a UPI request to the centre's own UPI ID; it counts as paid only when the owner marks it received"})
	if rest {
		return
	}
	a.tellOwner(d, d.Customer, "owner_fee_upi_expected", sayOpts{upiCode: codeOf(r.Code), offer: a.receivedButtons(r, r.AmountPaise)})
}

// markClaim is agent.ts markClaim: "I have paid" with the fee still open: thanks, the owner will confirm; the owner is asked, once an hour.
func (a *Agent) markClaim(d *Due, phone, via string, linkOK bool) {
	r := a.requestByID(d.CurrentLinkID)
	if via != "page" {
		o := sayOpts{}
		if linkOK {
			o.offer = feeButtons(d, "pay", "owner")
		}
		a.tellCustomer(d, phone, []string{"fee_upi_claim"}, o)
	}
	now := a.now()
	d.ClaimAtMs = N(now)
	recently := d.ClaimTellAtMs != nil && now-*d.ClaimTellAtMs < hourly
	told := recently
	if !recently && r != nil && codeOf(r.Code) != "" {
		told = a.tellOwner(d, phone, "owner_fee_upi_claim", sayOpts{upiCode: *r.Code, offer: a.receivedButtons(r, balancePaise(d))})
		if told {
			d.ClaimTellAtMs = N(now)
		}
	}
	refs := map[string]string{"to": "owner", "via": via}
	if r != nil {
		refs["requestId"] = r.ID
	}
	how := map[string]string{"screenshot": "a screenshot, which is not proof", "button": "the I have paid button", "page": "the I have paid button on their private page"}[via]
	if how == "" {
		how = "in words"
	}
	notes := "the parent says the fee is paid (" + how + "); nothing is marked paid until the owner marks it"
	if recently {
		notes += "; the owner was already asked in the last hour"
	}
	outcome := "failed"
	if told {
		outcome = "confirmed"
	}
	a.log(d, phone, ActClaim, outcome, map[string]any{"claim": "paid", "via": via}, logMore{refs: refs, notes: notes})
}

// onPicture is agent.ts onPicture: never looked at or kept; on a UPI centre it is read as "I paid".
func (a *Agent) onPicture(m messaging.InboundMessage) error {
	a.log(nil, m.From, "receive_message", "confirmed", map[string]any{"image": true, "id": m.ID}, logMore{notes: "a picture: it is not looked at and nothing of it is kept; a picture is never proof of a payment", refs: map[string]string{"messageId": m.ID}})
	if !a.ownerConfirms || a.store.Customer(m.From).OptedOut {
		return nil
	}
	return a.onPaidClaim(m.From, intent{Kind: "paid"}, "screenshot")
}

// oweBack is agent.ts oweBack: a refund the owner owes, recorded; the parent told it will come from the owner; the owner told what to send, with the code.
func (a *Agent) oweBack(d *Due, paymentID string, amountPaise int64, why string, decisions []Decision) *ownermarked.OwedRefund {
	r := ownermarked.OweRefund(a.marks, ownermarked.NewRefund{CaseID: d.ID, Customer: d.Customer, PaymentID: paymentID, AmountPaise: amountPaise, Why: why}, a.now(), assistant.NewCode)
	a.post(accounting.MoneyEvent{Kind: "refund_owed", Case: strp(d.ID), Owed: strp(r.ID), PaymentID: paymentID, AmountPaise: amountPaise}, func(m map[string]string) {
		a.log(d, d.Customer, ActRefundOwed, "held_for_owner", map[string]any{"paymentId": paymentID, "amountPaise": amountPaise}, logMore{decisions: decisions,
			refs:  merge(map[string]string{"refundId": r.ID, "paymentId": paymentID, "amountPaise": itoa(amountPaise)}, m),
			notes: "owed back by the owner, who sends it from their own UPI app (" + why + "); the agent never sends it and tracks it until the owner marks it done"})
	})
	a.tellCustomer(d, d.Customer, []string{"fee_upi_refund_owed"}, sayOpts{refundInr: N(amountPaise / 100)})
	a.tellOwner(d, d.Customer, "owner_fee_upi_refund_owed", sayOpts{refundInr: N(amountPaise / 100), upiCode: codeOf(r.Code), offer: a.refundButtons(r)})
	return r
}

// onOwnerMark is agent.ts onOwnerMark: money received on a request, or a refund marked sent. A code is used once.
func (a *Agent) onOwnerMark(reply *ownermarked.MarkReply, m messaging.InboundMessage) error {
	now := a.now()
	owner := a.owner()
	quietly := func(already bool, notes string) {
		a.log(nil, owner, "upi_owner_reply", "blocked", map[string]any{"kind": reply.Kind, "id": m.ID}, logMore{notes: notes, refs: map[string]string{"command": reply.Kind}})
		t := "owner_fee_upi_unknown"
		if already {
			t = "owner_fee_upi_already"
		}
		a.sayOwner(t, sayOpts{})
	}
	if reply.Kind == ownermarked.ReplyReceived {
		res := ownermarked.MarkReceived(a.marks, reply.Code, reply.AmountPaise, now, assistant.NewCode)
		switch res.Kind {
		case ownermarked.Already, ownermarked.AlreadyRefund:
			quietly(true, "a code that was already used: the payment is counted once")
			return nil
		case ownermarked.Marked:
		default:
			why := "a code the agent never issued"
			if res.Kind == ownermarked.BadAmount {
				why = "an amount that cannot be right for this payment"
			}
			quietly(false, why)
			return nil
		}
		d := a.store.Due(strings.Split(res.Request.Reference, ".")[0])
		if d == nil {
			quietly(false, "no fee has this request")
			return nil
		}
		if _, _, err := a.look(d); err != nil {
			return err
		}
		if d.State != Open {
			a.closeOpenRequests(d)
		}
		cur := a.requestByID(d.CurrentLinkID)
		got := N(res.Mark.AmountPaise / 100)
		if d.State == Open && balancePaise(d) > 0 {
			a.tellOwner(d, d.Customer, "owner_fee_upi_part", sayOpts{receivedInr: got, upiCode: codeOfReq(cur), offer: a.receivedButtons(cur, balancePaise(d))})
		} else {
			a.tellOwner(d, d.Customer, "owner_fee_upi_marked", sayOpts{receivedInr: got})
		}
		return nil
	}
	how := "done"
	if reply.Kind == ownermarked.ReplyKept {
		how = "kept"
	}
	res := ownermarked.MarkRefund(a.marks, reply.Code, how, now)
	if res.Kind == ownermarked.Already {
		quietly(true, "a refund code that was already used")
		return nil
	}
	if res.Kind != "done" {
		why := "a code the agent never issued"
		if res.Kind == ownermarked.NotAllowed {
			why = "keeping this money was not offered"
		}
		quietly(false, why)
		return nil
	}
	r := res.Refund
	d := a.store.Due(r.CaseID)
	a.post(accounting.MoneyEvent{Kind: "refund_made", Case: strp(r.CaseID), Owed: strp(r.ID), PaymentID: r.PaymentID, AmountPaise: r.AmountPaise, Method: "upi", Evidence: "owner_mark", RefundID: strp(r.ID)}, func(m map[string]string) {
		a.log(d, r.Customer, ActRefundDone, "confirmed", map[string]any{"refundId": r.ID}, logMore{refs: merge(map[string]string{"refundId": r.ID, "paymentId": r.PaymentID, "amountPaise": itoa(r.AmountPaise)}, m), notes: "the owner marked the refund sent from their UPI app; only now is the parent told it was sent"})
	})
	a.tellCustomer(d, r.Customer, []string{"fee_upi_refund_sent"}, sayOpts{refundInr: N(r.AmountPaise / 100)})
	a.tellOwner(d, r.Customer, "owner_fee_upi_refund_marked", sayOpts{refundInr: N(r.AmountPaise / 100)})
	return nil
}

func codeOfReq(r *ownermarked.MarkedRequest) string {
	if r == nil {
		return ""
	}
	return codeOf(r.Code)
}

// closeOpenRequests is agent.ts closeOpenRequests: a settled fee has nothing more to ask for.
func (a *Agent) closeOpenRequests(d *Due) {
	for _, l := range d.Links {
		r := a.requestByID(l.ID)
		if !liveRequest(r) {
			continue
		}
		_, _ = a.pay.CancelRequest(a.ctx, l.ID)
		a.log(d, d.Customer, ActClosed, "confirmed", map[string]any{"requestId": l.ID}, logMore{refs: map[string]string{"requestId": l.ID}, notes: "the fee is settled, so nothing more is asked on this request"})
	}
}

// remindOwedRefunds is agent.ts remindOwedRefunds: once a day, at most three times.
func (a *Agent) remindOwedRefunds(now int64) {
	for _, r := range ownermarked.RemindersDue(a.marks, now) {
		d := a.store.Due(r.CaseID)
		ownermarked.Reminded(r, now)
		told := a.tellOwner(d, r.Customer, "owner_fee_upi_refund_reminder", sayOpts{refundInr: N(r.AmountPaise / 100), upiCode: codeOf(r.Code), offer: a.refundButtons(r)})
		outcome := "failed"
		if told {
			outcome = "confirmed"
		}
		a.log(d, r.Customer, ActReminder, outcome, map[string]any{"refundId": r.ID}, logMore{refs: map[string]string{"refundId": r.ID, "amountPaise": itoa(r.AmountPaise)}, notes: "reminder " + itoa(r.Reminders) + " of a refund the owner still owes"})
	}
}

// markAskAgain is agent.ts markAskAgain: the to-do list asks the owner again about each refund owed and an open request; false when there is nothing UPI to ask.
func (a *Agent) markAskAgain(d *Due, note func(outcome, notes string)) bool {
	var owed []*ownermarked.OwedRefund
	for _, r := range a.marks.Refunds {
		if r.CaseID == d.ID && r.State == ownermarked.RefundOwed && codeOf(r.Code) != "" {
			owed = append(owed, r)
		}
	}
	var open *ownermarked.MarkedRequest
	if d.State == Open {
		if r := a.requestByID(d.CurrentLinkID); r != nil && codeOf(r.Code) != "" && liveRequest(r) {
			open = r
		}
	}
	if len(owed) == 0 && open == nil {
		return false
	}
	note("attempted", "telling the owner again about a UPI payment or refund")
	told := true
	for _, r := range owed {
		told = a.tellOwner(d, r.Customer, "owner_fee_upi_refund_reminder", sayOpts{refundInr: N(r.AmountPaise / 100), upiCode: *r.Code, offer: a.refundButtons(r)}) && told
	}
	if open != nil {
		told = a.tellOwner(d, d.Customer, "owner_fee_upi_claim", sayOpts{upiCode: *open.Code, offer: a.receivedButtons(open, balancePaise(d))}) && told
	}
	if told {
		note("confirmed", "the owner was told again")
	} else {
		note("failed", "the owner could not be told (the limits or the provider said no)")
	}
	return true
}
