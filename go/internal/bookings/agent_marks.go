package bookings

// A UPI shop's money: agent.ts's section "owner-marked: paid when the owner marks it" (B33; modules/payments/owner-marked), over the shared ledger (internal/payments/ownermarked).
//
// The customer pays the shop's own UPI ID. The agent cannot see that payment; the owner can, in their UPI app. So the deposit counts only when the owner marks it received, from
// their own number (or their private page), with the one-use code the agent sent only to them. A screenshot, a "paid" button or the words "I paid" ask the owner to look, and
// mark nothing. A refund is never sent by the agent: the owner owes it, is reminded, and the customer hears "sent" only after the owner marks it so.
//
// Where Go differs: the amounts the words show (markedInr, leftInr, refundInr) are whole rupees (paise / 100, cut toward zero), where the TypeScript passes paise / 100 as a
// JavaScript number; they differ only for a mark the owner typed with paise ("received K7M2QX 150.50"), whose words then show ₹150 here. The QR picture (agent.ts qrOf) goes
// before the words when the shop has a picture maker (Kit.QRImage: a UPI shop with a `report` block); without one the words carry the link, the UPI ID and the amount.

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"math"
	"strconv"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/assistant"
	"github.com/GeometerLabs/agents/go/internal/language"
	"github.com/GeometerLabs/agents/go/internal/messaging"
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

// markOutcome is agent.ts MarkOutcome: what the owner's marks on a booking's request came to.
type markOutcome string

const (
	markBooked markOutcome = "booked"
	markPart   markOutcome = "part"
	markLate   markOutcome = "late"
	markExtra  markOutcome = "extra"
	markNone   markOutcome = "none"
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

// requestOf is agent.ts requestOf: the booking's request in the ledger, by its link id.
func (a *Agent) requestOf(b *Booking) *ownermarked.MarkedRequest {
	if a.marks == nil || b.LinkID == "" {
		return nil
	}
	for _, r := range a.marks.Requests {
		if r.ID == b.LinkID {
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
	return &offer{kind: "owner_upi", choices: OwnerMarkButtons(a.settings.Owner.Language, OwnerMarkAsk{Kind: "received", Code: *r.Code, AmountInr: float64(amountPaise) / 100})}
}

func (a *Agent) refundButtons(r *ownermarked.OwedRefund) *offer {
	if r.Code == nil {
		return nil
	}
	return &offer{kind: "owner_upi", choices: OwnerMarkButtons(a.settings.Owner.Language, OwnerMarkAsk{Kind: "refund", Code: *r.Code, KeepAllowed: r.KeepAllowed})}
}

func codeOf(c *string) string {
	if c == nil {
		return ""
	}
	return *c
}

// sendMarkedRequest is agent.ts sendMarkedRequest: the request is made; put it in the record, send the customer the words (and the booking's own page link, item 11h), and tell
// the owner what to look for, with the code and the button.
func (a *Agent) sendMarkedRequest(b *Booking, prefix []string, shown []Decision) {
	r := a.requestOf(b)
	if !contains(a.confirmedRefs(b.ID, ActionRequest, "requestId"), r.ID) {
		a.log(b, b.Customer, ActionRequest, "confirmed", map[string]any{"amountPaise": r.AmountPaise}, logMore{refs: map[string]string{"requestId": r.ID, "reference": b.ID, "amountPaise": i64(r.AmountPaise)},
			notes: "a UPI request to the shop's own UPI ID; it counts as paid only when the owner marks it received"})
	}
	page := a.pageLinkFor(b)
	quote := "upi_quote_and_link"
	if contains(prefix, "price_floor") {
		quote = "upi_slot_and_link"
	}
	templates := append(append([]string{}, prefix...), quote)
	o := sayOpts{shown: shown, offer: paidCancelOrOwner}
	if page != nil {
		templates = append(templates, "upi_page_link")
		o.pageLink = page.url
	}
	if b.Channel == "" {
		o.image = a.qrOf(r) // a booking page draws its own QR
	}
	if sent := a.tellCustomer(b, b.Customer, templates, o); sent && page != nil {
		a.keepPageLink(b, page.hash)
	}
	a.tellOwner(b, b.Customer, "owner_upi_expected", sayOpts{upiCode: codeOf(r.Code), offer: a.receivedButtons(r, r.AmountPaise)})
}

// tellAlreadyWaiting is agent.ts tellAlreadyWaiting: a repeat of the same request gets the same request, not a second hold.
func (a *Agent) tellAlreadyWaiting(w *Booking) {
	var r *ownermarked.MarkedRequest
	if a.ownerConfirms {
		r = a.requestOf(w)
	}
	if r == nil {
		a.tellCustomer(w, w.Customer, []string{"already_waiting"}, sayOpts{offer: cancelOrOwner})
		return
	}
	page := a.pageLinkFor(w)
	templates := []string{"upi_already_waiting"}
	o := sayOpts{offer: paidCancelOrOwner}
	if page != nil {
		templates = append(templates, "upi_page_link")
		o.pageLink = page.url
	}
	if w.Channel == "" {
		o.image = a.qrOf(r)
	}
	if sent := a.tellCustomer(w, w.Customer, templates, o); sent && page != nil {
		a.keepPageLink(w, page.hash)
	}
}

// qrOf is agent.ts qrOf: the QR picture of the request's link, made once and kept on the request (best effort: without it the words carry the link, the UPI ID and the amount).
func (a *Agent) qrOf(r *ownermarked.MarkedRequest) *messaging.SayImage {
	if r.ImageLink == "" && a.kit.QRImage != nil {
		r.ImageLink = a.kit.QRImage(r.Link)
	}
	if r.ImageLink == "" {
		return nil
	}
	return &messaging.SayImage{Link: r.ImageLink, Caption: []string{"upi_qr_caption"}}
}

// reconcileMarks is agent.ts reconcileMarks: the owner's marks on this booking's request not counted yet. The deposit counts once the marks add up to all of it; less, and the
// slot stays held and the owner is asked for the rest; more, and the extra is owed back. A mark after the hold ended (or the booking was cancelled) never books by itself.
func (a *Agent) reconcileMarks(b *Booking) (markOutcome, error) {
	r := a.requestOf(b)
	if r == nil {
		return markNone, nil
	}
	var fresh []ownermarked.OwnerMark
	for _, m := range r.Marks {
		if !contains(b.HandledPayments, m.ID) {
			fresh = append(fresh, m)
		}
	}
	if len(fresh) == 0 {
		return markNone, nil
	}
	for _, m := range fresh {
		b.HandledPayments = append(b.HandledPayments, m.ID)
		notes := "marked paid by owner: from the owner's own number, with a one-use code"
		if m.AfterClose {
			notes = "marked received by the owner after the request was closed: it does not book by itself"
		}
		a.post(BookEvent{Kind: "received", Case: b.ID, PaymentID: m.ID, AmountPaise: m.AmountPaise, Method: "upi", Evidence: "owner_mark", For: "advance"}, func(money map[string]string) {
			a.log(b, b.Customer, ActionMarked, "confirmed", map[string]any{"requestId": r.ID, "amountPaise": m.AmountPaise}, logMore{
				refs: mergeRefs(map[string]string{"paymentId": m.ID, "requestId": r.ID, "amountPaise": i64(m.AmountPaise), "markedBy": "owner"}, money), notes: notes})
		})
	}
	var freshPaise int64
	for _, m := range fresh {
		freshPaise += m.AmountPaise
	}
	last := fresh[len(fresh)-1]
	if b.DepositPaymentID != "" { // the deposit was already whole: this is money beyond it
		a.oweBack(b, last.ID, freshPaise, "marked received beyond the deposit", oweOpts{customer: "upi_extra_refund_owed"})
		return markExtra, nil
	}
	if b.State != AwaitingDeposit && b.State != NeedsOwner {
		a.lateMark(b, last, freshPaise)
		return markLate, nil
	}
	total, deposit := markedPaise(r), a.depositPaise()
	if total < deposit {
		// not the whole deposit: not booked, the hold stays, and the owner is asked for the rest (a new code; the used one counts nothing again)
		a.log(b, b.Customer, "upi_deposit_part", "held_for_owner", map[string]any{"requestId": r.ID, "markedPaise": total}, logMore{refs: map[string]string{"requestId": r.ID, "amountPaise": i64(total)},
			notes: "the owner marked " + inrPaise(total) + " of the " + inrPaise(deposit) + " deposit: not booked; the hold stays until it ends"})
		a.tellOwner(b, b.Customer, "owner_upi_part", sayOpts{markedInr: rupeesOf(total), leftInr: rupeesOf(deposit - total), upiCode: codeOf(r.Code), offer: a.receivedButtons(r, deposit-total)})
		return markPart, nil
	}
	b.DepositPaymentID = last.ID
	b.DepositInr = ptr(a.settings.Deposit.AmountInr)
	if total > deposit {
		a.oweBack(b, last.ID, total-deposit, "marked received beyond the deposit", oweOpts{customer: "upi_extra_refund_owed"})
	}
	if err := a.completeBooking(b); err != nil {
		return markNone, err
	}
	if total > deposit {
		return markExtra, nil
	}
	return markBooked, nil
}

// inrPaise is formatInr(paise / 100) as the record's notes write it (language.FormatInr over the JavaScript number).
func inrPaise(paise int64) string { return language.FormatInr(float64(paise) / 100) }

// lateMark is agent.ts lateMark: a mark after the hold ended (or after the booking was cancelled), recorded as received, never booked again by itself.
func (a *Agent) lateMark(b *Booking, mark ownermarked.OwnerMark, amountPaise int64) {
	expired := b.State == Expired
	what, orHand := "cancellation", ""
	if expired {
		what, orHand = "hold had ended", " or books the customer by hand"
	}
	b.RefundIssues = append(b.RefundIssues, &payments.RefundIssue{PaymentID: mark.ID, Kind: "late_upi", AtMs: a.now(),
		Note: "The owner marked " + inrPaise(amountPaise) + " received for " + b.ID + " after its " + what + ". It was not booked again by itself; the owner owes it back" + orHand + "."})
	if !expired {
		a.oweBack(b, mark.ID, amountPaise, "marked received after the booking was cancelled", oweOpts{customer: "upi_refund_owed"})
		return
	}
	a.oweBack(b, mark.ID, amountPaise, "marked received after the hold had ended: not booked again by itself", oweOpts{customer: "upi_late_received", ownerTemplate: "owner_upi_late", keepAllowed: true, markedInr: rupeesOf(amountPaise)})
}

// oweOpts is oweBack's `o`.
type oweOpts struct {
	customer      string
	ownerTemplate string
	keepAllowed   bool
	markedInr     *int64
	decisions     []Decision
}

// oweBack is agent.ts oweBack: a refund the owner owes, recorded; the customer told it will come from the owner; the owner told what to send, with the code. The agent never sends it.
func (a *Agent) oweBack(b *Booking, paymentID string, amountPaise int64, why string, o oweOpts) *ownermarked.OwedRefund {
	r := ownermarked.OweRefund(a.marks, ownermarked.NewRefund{CaseID: b.ID, Customer: b.Customer, PaymentID: paymentID, AmountPaise: amountPaise, Why: why, KeepAllowed: o.keepAllowed}, a.now(), assistant.NewCode)
	a.post(BookEvent{Kind: "refund_owed", Case: b.ID, Owed: r.ID, PaymentID: paymentID, AmountPaise: amountPaise}, func(m map[string]string) {
		a.log(b, b.Customer, ActionRefundOwed, "held_for_owner", map[string]any{"paymentId": paymentID, "amountPaise": amountPaise}, logMore{decisions: o.decisions,
			refs:  mergeRefs(map[string]string{"refundId": r.ID, "paymentId": paymentID, "amountPaise": i64(amountPaise)}, m),
			notes: "owed back by the owner, who sends it from their own UPI app (" + why + "); the agent never sends it and tracks it until the owner marks it done"})
	})
	refund := rupeesOf(amountPaise)
	a.tellCustomer(b, b.Customer, []string{o.customer}, sayOpts{refundInr: refund, markedInr: o.markedInr})
	t := o.ownerTemplate
	if t == "" {
		t = "owner_upi_refund_owed"
	}
	a.tellOwner(b, b.Customer, t, sayOpts{refundInr: refund, upiCode: codeOf(r.Code), markedInr: o.markedInr, offer: a.refundButtons(r)})
	return r
}

// onPaidClaim is agent.ts onPaidClaim: "I have paid", the words, or a screenshot: thanks, the owner will confirm; a screenshot is not proof. The owner is asked to look, at most
// once an hour per booking.
func (a *Agent) onPaidClaim(phone, via, upiRef string) {
	b := a.store.Latest(phone, []string{AwaitingDeposit})
	var r *ownermarked.MarkedRequest
	if b != nil {
		r = a.requestOf(b)
	}
	if b == nil || r == nil {
		a.log(nil, phone, ActionClaim, "blocked", map[string]any{"claim": "paid", "via": via}, logMore{notes: "the customer says they paid, and no UPI deposit is waiting for them; nothing is marked paid", refs: map[string]string{"to": "owner", "via": via}})
		a.tellCustomer(nil, phone, []string{"upi_nothing_waiting"}, sayOpts{offer: &offer{kind: "buttons", buttons: []string{"owner"}}})
		return
	}
	a.tellCustomer(b, phone, []string{"upi_paid_claim"}, sayOpts{})
	now := a.now()
	a.noteClaim(b, now, upiRef)
	tellAt, hasTell := b.claimTellAt()
	recently := hasTell && now-tellAt < Hour
	told := recently
	if !recently && r.Code != nil {
		told = a.tellOwner(b, phone, "owner_upi_claim", sayOpts{upiCode: *r.Code, offer: a.receivedButtons(r, a.depositPaise()-markedPaise(r))})
		if told {
			b.setExtra("claimTellAtMs", now)
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
	a.log(b, phone, ActionClaim, outcome, map[string]any{"claim": "paid", "via": via}, logMore{refs: map[string]string{"to": "owner", "via": via, "requestId": r.ID}, notes: notes})
}

// claimTellAt is the booking's claimTellAtMs (when the owner was last asked to look), if any.
func (b *Booking) claimTellAt() (int64, bool) {
	var v float64
	if b.extra("claimTellAtMs", &v) {
		return int64(v), true
	}
	return 0, false
}

// noteClaim is agent.ts noteClaim: remember that the customer says they paid (and the UPI reference they typed), so the owner's page can list it first. It counts as nothing paid.
func (a *Agent) noteClaim(b *Booking, now int64, upiRef string) {
	b.setExtra("claimAtMs", now)
	if upiRef != "" {
		b.setExtra("claimRef", upiRef)
	}
}

// onLateClaim is agent.ts onLateClaim: "I have paid" from the booking's own page AFTER the hold ended. Nothing is marked and nothing is booked: the claim is kept, the owner is
// asked to look (the same message as any claim, with the same one-use code, which stays live after the request was closed). Said at most once an hour; the customer is told on
// their page, not on WhatsApp.
func (a *Agent) onLateClaim(b *Booking, upiRef string) {
	r := a.requestOf(b)
	if r == nil || len(r.Marks) > 0 || r.Code == nil {
		a.log(b, b.Customer, ActionClaim, "blocked", map[string]any{"claim": "paid", "late": true}, logMore{notes: "a late 'I have paid' for a booking with no UPI request still open to a mark: nothing was done"})
		return
	}
	now := a.now()
	a.noteClaim(b, now, upiRef)
	tellAt, hasTell := b.claimTellAt()
	recently := hasTell && now-tellAt < Hour
	told := recently
	if !recently {
		told = a.tellOwner(b, b.Customer, "owner_upi_claim", sayOpts{upiCode: *r.Code, offer: a.receivedButtons(r, r.AmountPaise)})
		if told {
			b.setExtra("claimTellAtMs", now)
		}
	}
	notes := "the customer says they paid after the hold ended (the booking's page); nothing is marked or booked: the owner is asked to look, and a mark then is owed back or kept"
	if recently {
		notes += "; the owner was already asked in the last hour"
	}
	outcome := "failed"
	if told {
		outcome = "confirmed"
	}
	a.log(b, b.Customer, ActionClaim, outcome, map[string]any{"claim": "paid", "late": true}, logMore{refs: map[string]string{"to": "owner", "via": "button", "requestId": r.ID}, notes: notes})
}

// onPicture is agent.ts onPicture: a picture from a customer is never looked at or kept. On a UPI shop it is read as "I paid" (a screenshot is not proof); a shop whose gateway
// confirms by itself answers nothing.
func (a *Agent) onPicture(msg messaging.InboundMessage) {
	phone := msg.From
	a.log(nil, phone, "receive_message", "confirmed", map[string]any{"image": true, "id": msg.ID}, logMore{notes: "a picture: it is not looked at and nothing of it is kept; a picture is never proof of a payment", refs: map[string]string{"messageId": msg.ID}})
	if !a.ownerConfirms || a.store.Customer(phone).OptedOut {
		return
	}
	a.onPaidClaim(phone, "screenshot", "")
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
		a.sayOwner([]string{t}, sayExtra{}, "")
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
		b := a.store.Booking(res.Request.Reference)
		if b == nil {
			quietly(false, "no booking has this request")
			return nil
		}
		out, err := a.reconcileMarks(b) // the same flow a gateway's webhook takes
		if err != nil {
			return err
		}
		if out == markBooked || out == markExtra {
			a.tellOwner(b, b.Customer, "owner_upi_marked", sayOpts{markedInr: rupeesOf(res.Mark.AmountPaise)})
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
	b := a.store.Booking(r.CaseID)
	refs := map[string]string{"refundId": r.ID, "paymentId": r.PaymentID, "amountPaise": i64(r.AmountPaise)}
	if res.Kind == ownermarked.RefundKept {
		a.post(BookEvent{Kind: "kept", Case: r.CaseID, Owed: r.ID, Why: "late_mark_kept"}, func(m map[string]string) {
			a.log(b, r.Customer, ActionRefundKept, "confirmed", map[string]any{"refundId": r.ID}, logMore{refs: mergeRefs(refs, m), notes: "the owner keeps this money for a booking they make by hand: nothing is owed back"})
		})
		a.tellOwner(b, r.Customer, "owner_upi_refund_kept", sayOpts{refundInr: rupeesOf(r.AmountPaise)})
		return nil
	}
	a.post(BookEvent{Kind: "refund_made", Case: r.CaseID, Owed: r.ID, PaymentID: r.PaymentID, AmountPaise: r.AmountPaise, Method: "upi", Evidence: "owner_mark", RefundID: r.ID}, func(m map[string]string) {
		a.log(b, r.Customer, ActionRefundDone, "confirmed", map[string]any{"refundId": r.ID}, logMore{refs: mergeRefs(refs, m), notes: "the owner marked the refund sent from their UPI app; only now is the customer told it was sent"})
	})
	a.tellCustomer(b, r.Customer, []string{"upi_refund_sent"}, sayOpts{refundInr: rupeesOf(r.AmountPaise)})
	a.tellOwner(b, r.Customer, "owner_upi_refund_marked", sayOpts{refundInr: rupeesOf(r.AmountPaise)})
	return nil
}

// markAskAgain is agent.ts markAskAgain: the unfinished-work list asks the owner again about a UPI booking: each refund still owed, and a deposit the owner has not finished
// confirming. False when there is nothing UPI to ask about, so the usual asks are tried.
func (a *Agent) markAskAgain(b *Booking, note func(outcome, notes string)) bool {
	var owed []*ownermarked.OwedRefund
	for _, r := range a.marks.Refunds {
		if r.CaseID == b.ID && r.State == ownermarked.RefundOwed && r.Code != nil {
			owed = append(owed, r)
		}
	}
	var open *ownermarked.MarkedRequest
	if r := a.requestOf(b); r != nil && r.Code != nil && (r.Status == ownermarked.StatusCreated || r.Status == ownermarked.StatusPartiallyPaid) && b.State == AwaitingDeposit {
		open = r
	}
	if len(owed) == 0 && open == nil {
		return false
	}
	note("attempted", "telling the owner again about a UPI payment or refund")
	told := true
	for _, r := range owed {
		told = a.tellOwner(b, b.Customer, "owner_upi_refund_reminder", sayOpts{refundInr: rupeesOf(r.AmountPaise), upiCode: *r.Code, offer: a.refundButtons(r)}) && told
	}
	if open != nil {
		marked := markedPaise(open)
		left := a.depositPaise() - marked
		if marked > 0 {
			told = a.tellOwner(b, b.Customer, "owner_upi_part", sayOpts{markedInr: rupeesOf(marked), leftInr: rupeesOf(left), upiCode: *open.Code, offer: a.receivedButtons(open, left)}) && told
		} else {
			told = a.tellOwner(b, b.Customer, "owner_upi_claim", sayOpts{upiCode: *open.Code, offer: a.receivedButtons(open, left)}) && told
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
		b := a.store.Booking(r.CaseID)
		ownermarked.Reminded(r, now)
		told := a.tellOwner(b, r.Customer, "owner_upi_refund_reminder", sayOpts{refundInr: rupeesOf(r.AmountPaise), upiCode: codeOf(r.Code), offer: a.refundButtons(r)})
		outcome := "failed"
		if told {
			outcome = "confirmed"
		}
		a.log(b, r.Customer, ActionRefundReminder, outcome, map[string]any{"refundId": r.ID}, logMore{refs: map[string]string{"refundId": r.ID, "amountPaise": i64(r.AmountPaise)},
			notes: "reminder " + strconv.FormatInt(r.Reminders, 10) + " of a refund the owner still owes"})
	}
}

// ---- the booking's own page link (item 11h) ------------------------------------------------------------------------------------------------------------------------

// pageLink is a fresh link to a WhatsApp booking's own page: the whole https address (sent once, in the message) and its hash (all that is kept).
type pageLink struct{ url, hash string }

// pageLinkFor is agent.ts pageLinkFor: only for a booking made on WhatsApp (a page's own booking has its handle already), and only when the shop has a page (runtime.ts pageLink).
func (a *Agent) pageLinkFor(b *Booking) *pageLink {
	if b.Channel != "" || a.kit.PageBase == nil {
		return nil
	}
	base := a.kit.PageBase()
	if base == "" {
		return nil
	}
	h := newHandle()
	return &pageLink{url: base + "/b/" + h, hash: handleHash(h)}
}

// keepPageLink is agent.ts keepPageLink: a link that was sent becomes the booking's latest, and the three before it stay good (the booked message must not kill the page the
// quote's link has open).
func (a *Agent) keepPageLink(b *Booking, hash string) {
	if b.PageLink != "" && b.PageLink != hash {
		before := append(b.extraList("pageLinksBefore"), b.PageLink)
		if len(before) > 3 {
			before = before[len(before)-3:]
		}
		b.setExtra("pageLinksBefore", before)
	}
	b.PageLink = hash
}

// newHandle is handle.ts newHandle: 24 random bytes in base64url (32 characters), the bearer string a page link carries.
func newHandle() string {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		panic(err) // the system's random source failed: nothing safe to do
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

// handleHash is handle.ts handleHash: the hash the runtime keeps and looks a booking up by (64 hex digits), with its own prefix.
func handleHash(h string) string {
	sum := sha256.Sum256([]byte("booking-handle:" + h))
	return hex.EncodeToString(sum[:])
}
