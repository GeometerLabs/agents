package orders

// A UPI shop's money: agent.ts's section "owner-marked: paid when the owner marks it" and "UPI: the owner's marks, refunds owed, claims" (B33; modules/payments/owner-marked), over the
// shared ledger (internal/payments/ownermarked).
//
// The customer pays the shop's own UPI ID. The agent cannot see that payment; the owner can, in their UPI app. So the advance counts only when the owner marks it received, from
// their own number (or their page), with the one-use code the agent sent only to them. A screenshot, a "paid" button or the words "I paid" ask the owner to look, and mark nothing.
// A refund is never sent by the agent: the owner owes it, is reminded, and the customer hears "sent" only after the owner marks it so.
//
// Where Go differs: the amounts the words show (markedInr, leftInr, refundInr) are whole rupees (paise / 100, cut toward zero), where the TypeScript passes paise / 100 as a JavaScript
// number; they differ only for a mark the owner typed with paise ("received K7M2QX 150.50"), as in internal/bookings.

import (
	"math"
	"strconv"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/assistant"
	"github.com/GeometerLabs/agents/go/internal/language"
	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/orders/words"
	"github.com/GeometerLabs/agents/go/internal/payments"
	"github.com/GeometerLabs/agents/go/internal/payments/ownermarked"
)

// The record's actions for the owner-marked money (modules/payments/owner-marked/obligations.ts MARK_ACTIONS).
const (
	ActionRequest        = "upi_request"
	ActionClaim          = "upi_paid_claim"
	ActionMarked         = "owner_marked_paid"
	ActionClosed         = "upi_request_closed"
	ActionRefundOwed     = "upi_refund_owed"
	ActionRefundDone     = "upi_refund_marked_done"
	ActionRefundKept     = "upi_refund_kept"
	ActionRefundReminder = "upi_refund_reminder"
)

// markOutcome is agent.ts MarkOutcome: what the owner's marks on an order's request came to (confirmed in full, a part, after the hold, beyond the advance, or nothing new).
type markOutcome string

const (
	markConfirmed markOutcome = "confirmed"
	markPart      markOutcome = "part"
	markLate      markOutcome = "late"
	markExtra     markOutcome = "extra"
	markNone      markOutcome = "none"
)

// jsNumber is JavaScript's Number(s) for a ref the record keeps as text: "" is 0, anything that is not a number is NaN.
func jsNumber(s string) float64 {
	t := strings.TrimSpace(s)
	if t == "" {
		return 0
	}
	f, err := strconv.ParseFloat(t, 64)
	if err != nil {
		return math.NaN()
	}
	return f
}

func rupeesOf(paise int64) *int64 { return ptr(paise / 100) }

// inrPaise is formatInr(paise / 100) as the record's notes write it.
func inrPaise(paise int64) string { return language.FormatInr(float64(paise) / 100) }

func codeOf(c *string) string {
	if c == nil {
		return ""
	}
	return *c
}

// requestOf is agent.ts requestOf: the order's request in the ledger, by its link id.
func (a *Agent) requestOf(o *Order) *ownermarked.MarkedRequest {
	if a.marks == nil || o.LinkID == "" {
		return nil
	}
	for _, r := range a.marks.Requests {
		if r.ID == o.LinkID {
			return r
		}
	}
	return nil
}

func markedPaise(r *ownermarked.MarkedRequest) int64 {
	var n int64
	for _, m := range r.Marks {
		n += m.AmountPaise
	}
	return n
}

// receivedButtons and refundButtons are agent.ts's: the owner's buttons, each carrying the one-use code (none when the request or refund has no live code).
func (a *Agent) receivedButtons(r *ownermarked.MarkedRequest, amountPaise int64) *offer {
	if r.Code == nil {
		return nil
	}
	return &offer{kind: "owner_upi", choices: words.OwnerMarkButtons(a.settings.Owner.Language, words.MarkAsk{Kind: "received", Code: *r.Code, AmountInr: float64(amountPaise) / 100})}
}

func (a *Agent) refundButtons(r *ownermarked.OwedRefund) *offer {
	if r.Code == nil {
		return nil
	}
	return &offer{kind: "owner_upi", choices: words.OwnerMarkButtons(a.settings.Owner.Language, words.MarkAsk{Kind: "refund", Code: *r.Code, KeepAllowed: r.KeepAllowed})}
}

// noteRequest puts a UPI request in the record once (`if (!record.confirmedRefs(o.id, MARK_ACTIONS.request, "requestId").includes(request.id)) log(...)`).
func (a *Agent) noteRequest(o *Order, r *ownermarked.MarkedRequest, notes string) {
	if contains(a.confirmedRefs(o.ID, ActionRequest, "requestId"), r.ID) {
		return
	}
	a.log(o, o.Customer, ActionRequest, "confirmed", map[string]any{"amountPaise": r.AmountPaise}, logMore{refs: map[string]string{"requestId": r.ID, "reference": o.ID, "amountPaise": i64(r.AmountPaise)}, notes: notes})
}

// qrOf is agent.ts qrOf: the QR picture of the request's link, made once (best effort: without it the words carry the link, the UPI ID and the amount).
func (a *Agent) qrOf(r *ownermarked.MarkedRequest) *messaging.SayImage {
	if r.ImageLink == "" && a.kit.QRImage != nil {
		r.ImageLink = a.kit.QRImage(r.Link)
	}
	if r.ImageLink == "" {
		return nil
	}
	return &messaging.SayImage{Link: r.ImageLink, Caption: []string{"upi_qr_caption"}}
}

// reconcileMarks is agent.ts reconcileMarks: the owner's marks on this order's request, not counted yet. Each is recorded as "marked paid by owner". The advance counts once the marks
// add up to all of it; less, and the order stays held and the owner is asked for the rest; more, and the extra is owed back. A mark after the hold ended (or the order was cancelled)
// never confirms by itself.
func (a *Agent) reconcileMarks(o *Order) (markOutcome, error) {
	r := a.requestOf(o)
	if r == nil {
		return markNone, nil
	}
	var fresh []ownermarked.OwnerMark
	for _, m := range r.Marks {
		if !contains(o.HandledPayments, m.ID) {
			fresh = append(fresh, m)
		}
	}
	if len(fresh) == 0 {
		return markNone, nil
	}
	for _, m := range fresh {
		o.HandledPayments = append(o.HandledPayments, m.ID)
		notes := "marked paid by owner: from the owner's own number, with a one-use code"
		if m.AfterClose {
			notes = "marked received by the owner after the request was closed: it does not confirm by itself"
		}
		a.post(bookEvent{Kind: "received", Case: o.ID, PaymentID: m.ID, AmountPaise: m.AmountPaise, Method: "upi", Evidence: "owner_mark", For: "advance"}, func(money map[string]string) {
			a.log(o, o.Customer, ActionMarked, "confirmed", map[string]any{"requestId": r.ID, "amountPaise": m.AmountPaise}, logMore{
				refs: mergeRefs(map[string]string{"paymentId": m.ID, "requestId": r.ID, "amountPaise": i64(m.AmountPaise), "markedBy": "owner"}, money), notes: notes})
		})
	}
	var freshPaise int64
	for _, m := range fresh {
		freshPaise += m.AmountPaise
	}
	last := fresh[len(fresh)-1]
	if o.AdvancePaymentID != "" { // the advance was already whole: this is money beyond it
		a.oweBack(o, last.ID, freshPaise, "marked received beyond the advance", oweOpts{customer: "upi_extra_refund_owed"})
		return markExtra, nil
	}
	if o.State != AwaitingAdvance {
		a.lateMark(o, last, freshPaise)
		return markLate, nil
	}
	total, advance := markedPaise(r), advancePaise(o)
	if total < advance {
		// not the whole advance: not confirmed, the hold stays, and the owner is asked for the rest (a new code; the used one counts nothing again)
		a.log(o, o.Customer, "upi_advance_part", "held_for_owner", map[string]any{"requestId": r.ID, "markedPaise": total}, logMore{refs: map[string]string{"requestId": r.ID, "amountPaise": i64(total)},
			notes: "the owner marked " + inrPaise(total) + " of the " + inrPaise(advance) + " advance: not confirmed; the order stays held until the hold ends"})
		a.tellOwner(o, o.Customer, "owner_upi_part", sayOpts{markedInr: rupeesOf(total), leftInr: rupeesOf(advance - total), upiCode: codeOf(r.Code), offer: a.receivedButtons(r, advance-total)})
		return markPart, nil
	}
	o.AdvancePaymentID = last.ID
	if total > advance {
		a.oweBack(o, last.ID, total-advance, "marked received beyond the advance", oweOpts{customer: "upi_extra_refund_owed"})
	}
	if err := a.completeOrder(o); err != nil {
		return markNone, err
	}
	if total > advance {
		return markExtra, nil
	}
	return markConfirmed, nil
}

// lateMark is agent.ts lateMark: a mark after the hold ended (or after the order was cancelled), recorded as received, never confirmed again by itself. The owner and the builder are
// told.
func (a *Agent) lateMark(o *Order, mark ownermarked.OwnerMark, amountPaise int64) {
	expired := o.State == Expired
	what, orHand := "cancellation", ""
	if expired {
		what, orHand = "hold had ended", " or takes the order by hand"
	}
	o.RefundIssues = append(o.RefundIssues, &payments.RefundIssue{PaymentID: mark.ID, Kind: "late_upi", AtMs: a.now(),
		Note: "The owner marked " + inrPaise(amountPaise) + " received for " + o.ID + " after its " + what + ". It was not confirmed again by itself; the owner owes it back" + orHand + "."})
	if !expired {
		a.oweBack(o, mark.ID, amountPaise, "marked received after the order was cancelled", oweOpts{customer: "upi_refund_owed"})
		return
	}
	a.oweBack(o, mark.ID, amountPaise, "marked received after the hold had ended: not confirmed again by itself", oweOpts{customer: "upi_late_received", ownerTemplate: "owner_upi_late", keepAllowed: true, markedInr: rupeesOf(amountPaise)})
}

// oweOpts is oweBack's `x`.
type oweOpts struct {
	customer      string
	ownerTemplate string
	keepAllowed   bool
	markedInr     *int64
	decisions     []Decision
}

// oweBack is agent.ts oweBack: a refund the owner owes, recorded; the customer told it will come from the owner; the owner told what to send, with the code. The agent never sends it.
func (a *Agent) oweBack(o *Order, paymentID string, amountPaise int64, why string, x oweOpts) *ownermarked.OwedRefund {
	r := ownermarked.OweRefund(a.marks, ownermarked.NewRefund{CaseID: o.ID, Customer: o.Customer, PaymentID: paymentID, AmountPaise: amountPaise, Why: why, KeepAllowed: x.keepAllowed}, a.now(), assistant.NewCode)
	a.post(bookEvent{Kind: "refund_owed", Case: o.ID, Owed: r.ID, PaymentID: paymentID, AmountPaise: amountPaise}, func(m map[string]string) {
		a.log(o, o.Customer, ActionRefundOwed, "held_for_owner", map[string]any{"paymentId": paymentID, "amountPaise": amountPaise}, logMore{decisions: x.decisions,
			refs:  mergeRefs(map[string]string{"refundId": r.ID, "paymentId": paymentID, "amountPaise": i64(amountPaise)}, m),
			notes: "owed back by the owner, who sends it from their own UPI app (" + why + "); the agent never sends it and tracks it until the owner marks it done"})
	})
	refund := rupeesOf(amountPaise)
	a.tellCustomer(o, o.Customer, []string{x.customer}, sayOpts{refundInr: refund, markedInr: x.markedInr})
	t := x.ownerTemplate
	if t == "" {
		t = "owner_upi_refund_owed"
	}
	a.tellOwner(o, o.Customer, t, sayOpts{refundInr: refund, upiCode: codeOf(r.Code), markedInr: x.markedInr, offer: a.refundButtons(r)})
	return r
}

// onPaidClaim is agent.ts onPaidClaim: "I have paid", the words, or a screenshot: thanks, the owner will confirm, a screenshot is not proof. The owner is asked to look, at most once
// an hour per order. It never marks anything paid.
func (a *Agent) onPaidClaim(phone, via, upiRef string) error {
	o := a.store.LatestOrder(phone, []string{AwaitingAdvance})
	if o == nil {
		if p := a.plansOf(); p != nil {
			o = p.AwaitingOrderOf(phone) // a plan's period waiting for its payment is theirs too
		}
	}
	var r *ownermarked.MarkedRequest
	if o != nil {
		r = a.requestOf(o)
	}
	if o == nil || r == nil {
		a.log(nil, phone, ActionClaim, "blocked", map[string]any{"claim": "paid", "via": via}, logMore{notes: "the customer says they paid, and no UPI advance is waiting for them; nothing is marked paid", refs: map[string]string{"to": "owner", "via": via}})
		a.tellCustomer(nil, phone, []string{"upi_nothing_waiting"}, sayOpts{offer: &offer{kind: "buttons", buttons: []string{"owner"}}})
		return nil
	}
	a.tellCustomer(o, phone, []string{"upi_paid_claim"}, sayOpts{})
	now := a.now()
	// money clarity: kept so the owner's page lists it first, with the reference; it counts as nothing paid
	o.ClaimAtMs = ptr(now)
	if upiRef != "" {
		o.ClaimRef = upiRef
	}
	recently := o.ClaimTellAtMs != nil && now-*o.ClaimTellAtMs < Hour
	told := recently
	if !recently && r.Code != nil {
		told = a.tellOwner(o, phone, "owner_upi_claim", sayOpts{upiCode: *r.Code, offer: a.receivedButtons(r, advancePaise(o)-markedPaise(r))})
		if told {
			o.ClaimTellAtMs = ptr(now)
		}
	}
	how := "in words"
	switch via {
	case "screenshot":
		how = "a screenshot, which is not proof"
	case "button":
		how = "the I have paid button"
	}
	notes := "the customer says they paid (" + how + "); nothing is marked paid until the owner marks it"
	if recently {
		notes += "; the owner was already asked in the last hour"
	}
	outcome := "failed"
	if told {
		outcome = "confirmed"
	}
	a.log(o, phone, ActionClaim, outcome, map[string]any{"claim": "paid", "via": via}, logMore{refs: map[string]string{"to": "owner", "via": via, "requestId": r.ID}, notes: notes})
	return nil
}

// onPicture is agent.ts onPicture: a picture from a customer is never looked at or kept. On a UPI shop it is read as "I paid" (a screenshot is not proof); a shop whose gateway
// confirms by itself answers nothing.
func (a *Agent) onPicture(msg messaging.InboundMessage) error {
	phone := msg.From
	a.log(nil, phone, "receive_message", "confirmed", map[string]any{"image": true, "id": msg.ID}, logMore{notes: "a picture: it is not looked at and nothing of it is kept; a picture is never proof of a payment", refs: map[string]string{"messageId": msg.ID}})
	if !a.ownerConfirms || a.store.Customer(phone).OptedOut {
		return nil
	}
	return a.onPaidClaim(phone, "screenshot", "")
}

// onOwnerMark is agent.ts onOwnerMark: the owner's UPI reply, a mark of money received, or a refund marked sent (or kept). A code is used once; the same reply again counts nothing.
func (a *Agent) onOwnerMark(reply *ownermarked.MarkReply, msg messaging.InboundMessage) error {
	now := a.now()
	quietly := func(already bool, notes string) {
		a.log(nil, a.owner(), "upi_owner_reply", "blocked", map[string]any{"kind": reply.Kind, "id": msg.ID}, logMore{notes: notes, refs: map[string]string{"command": reply.Kind}})
		t := "owner_upi_unknown"
		if already {
			t = "owner_upi_already"
		}
		a.tellOwner(nil, a.owner(), t, sayOpts{})
	}
	if reply.Kind == ownermarked.ReplyReceived {
		res := ownermarked.MarkReceived(a.marks, reply.Code, reply.AmountPaise, now, assistant.NewCode)
		switch res.Kind {
		case ownermarked.Already, ownermarked.AlreadyRefund:
			quietly(true, "a code that was already used: the payment is counted once")
			return nil
		case ownermarked.Marked:
		case ownermarked.BadAmount:
			quietly(false, "an amount that cannot be right for this payment")
			return nil
		default:
			quietly(false, "a code the agent never issued")
			return nil
		}
		o := a.store.Order(res.Request.Reference)
		if o == nil {
			quietly(false, "no order has this request")
			return nil
		}
		out, err := a.reconcilePayments(o) // the same flow a gateway's webhook takes
		if err != nil {
			return err
		}
		if out == markConfirmed || out == markExtra {
			a.tellOwner(o, o.Customer, "owner_upi_marked", sayOpts{markedInr: rupeesOf(res.Mark.AmountPaise)})
		}
		return nil
	}
	how := ownermarked.RefundDone
	if reply.Kind == ownermarked.ReplyKept {
		how = ownermarked.RefundKept
	}
	res := ownermarked.MarkRefund(a.marks, reply.Code, how, now)
	switch res.Kind {
	case ownermarked.Already:
		quietly(true, "a refund code that was already used")
		return nil
	case ownermarked.RefundDone, ownermarked.RefundKept:
	case ownermarked.NotAllowed:
		quietly(false, "keeping this money was not offered")
		return nil
	default:
		quietly(false, "a code the agent never issued")
		return nil
	}
	r := res.Refund
	o := a.store.Order(r.CaseID)
	refs := map[string]string{"refundId": r.ID, "paymentId": r.PaymentID, "amountPaise": i64(r.AmountPaise)}
	if res.Kind == ownermarked.RefundKept {
		a.post(bookEvent{Kind: "kept", Case: r.CaseID, Owed: r.ID, Why: "late_mark_kept"}, func(m map[string]string) {
			a.log(o, r.Customer, ActionRefundKept, "confirmed", map[string]any{"refundId": r.ID}, logMore{refs: mergeRefs(refs, m), notes: "the owner keeps this money for an order they take by hand: nothing is owed back"})
		})
		a.tellOwner(o, r.Customer, "owner_upi_refund_kept", sayOpts{refundInr: rupeesOf(r.AmountPaise)})
		return nil
	}
	a.post(bookEvent{Kind: "refund_made", Case: r.CaseID, Owed: r.ID, PaymentID: r.PaymentID, AmountPaise: r.AmountPaise, Method: "upi", Evidence: "owner_mark", RefundID: r.ID}, func(m map[string]string) {
		a.log(o, r.Customer, ActionRefundDone, "confirmed", map[string]any{"refundId": r.ID}, logMore{refs: mergeRefs(refs, m), notes: "the owner marked the refund sent from their UPI app; only now is the customer told it was sent"})
	})
	a.tellCustomer(o, r.Customer, []string{"upi_refund_sent"}, sayOpts{refundInr: rupeesOf(r.AmountPaise)})
	a.tellOwner(o, r.Customer, "owner_upi_refund_marked", sayOpts{refundInr: rupeesOf(r.AmountPaise)})
	return nil
}

// markAskAgain is agent.ts markAskAgain: the unfinished-work list (B31) asks the owner again about a UPI order: each refund still owed (the reminder, with its code and button), and an
// advance the owner has not finished confirming. False when there is nothing UPI to ask about, so the usual asks are tried.
func (a *Agent) markAskAgain(o *Order, note func(outcome, notes string)) bool {
	var owed []*ownermarked.OwedRefund
	for _, r := range a.marks.Refunds {
		if r.CaseID == o.ID && r.State == ownermarked.RefundOwed && r.Code != nil {
			owed = append(owed, r)
		}
	}
	var open *ownermarked.MarkedRequest
	if r := a.requestOf(o); r != nil && r.Code != nil && (r.Status == ownermarked.StatusCreated || r.Status == ownermarked.StatusPartiallyPaid) && o.State == AwaitingAdvance {
		open = r
	}
	if len(owed) == 0 && open == nil {
		return false
	}
	note("attempted", "telling the owner again about a UPI payment or refund")
	told := true
	for _, r := range owed {
		told = a.tellOwner(o, o.Customer, "owner_upi_refund_reminder", sayOpts{refundInr: rupeesOf(r.AmountPaise), upiCode: *r.Code, offer: a.refundButtons(r)}) && told
	}
	if open != nil {
		marked := markedPaise(open)
		left := advancePaise(o) - marked
		if marked > 0 {
			told = a.tellOwner(o, o.Customer, "owner_upi_part", sayOpts{markedInr: rupeesOf(marked), leftInr: rupeesOf(left), upiCode: *open.Code, offer: a.receivedButtons(open, left)}) && told
		} else {
			told = a.tellOwner(o, o.Customer, "owner_upi_claim", sayOpts{upiCode: *open.Code, offer: a.receivedButtons(open, left)}) && told
		}
	}
	if told {
		note("confirmed", "the owner was told again")
	} else {
		note("failed", "the owner could not be told (the limits or the provider said no)")
	}
	return true
}

// remindOwedRefunds is agent.ts remindOwedRefunds: refunds still owed, the owner reminded once a day, at most three times; after that they stay in the record's unfinished work.
func (a *Agent) remindOwedRefunds(now int64) {
	for _, r := range ownermarked.RemindersDue(a.marks, now) {
		o := a.store.Order(r.CaseID)
		ownermarked.Reminded(r, now)
		told := a.tellOwner(o, r.Customer, "owner_upi_refund_reminder", sayOpts{refundInr: rupeesOf(r.AmountPaise), upiCode: codeOf(r.Code), offer: a.refundButtons(r)})
		outcome := "failed"
		if told {
			outcome = "confirmed"
		}
		a.log(o, r.Customer, ActionRefundReminder, outcome, map[string]any{"refundId": r.ID}, logMore{refs: map[string]string{"refundId": r.ID, "amountPaise": i64(r.AmountPaise)},
			notes: "reminder " + strconv.FormatInt(r.Reminders, 10) + " of a refund the owner still owes"})
	}
}
