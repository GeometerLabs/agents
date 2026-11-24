// The owner-marked ledger's rules: modules/payments/owner-marked/ledger.ts. For every payment module that cannot confirm a payment by itself (UPI today) the customer pays the shop
// directly, and "paid" is the OWNER'S word: a reply from the owner's own number carrying a fresh one-use code that was sent only to them. A mark is for the amount the owner says;
// a mark that leaves some still to pay uses its code up and makes a new code for the rest; a request closed by the agent keeps its code, so a later mark is still recorded (as
// received, after the close); a refund is never sent by the agent: the owner pays it from their own app and marks it done (or kept).
//
// Codes: ledger.ts calls approvals/code.ts newCode; here the caller hands the generator in (`Codes`), so this package imports no other (the Bookings runtime passes
// assistant.NewCode, the same alphabet and length) and a test can replay the TypeScript's draws. The loop that avoids a code already held (live or used) draws at most 51 times, as
// the TypeScript does (`for (i = 0; taken.has(code) && i < 50; i++)`).
package ownermarked

import (
	"fmt"
	"math"
)

// Codes draws one random one-use code (approvals/code.ts newCode).
type Codes func() string

// PayLink is the provider's link for one request: the exact amount and the reference as its note (providers/index.ts ownerMarkedOf). Never the owner's code. An error is a field a UPI app
// would not take, in plain words (the TypeScript throws it).
type PayLink func(amountPaise int64, note string) (string, error)

// The reminders: how long after a refund became owed the owner is first reminded and between reminders, and how many at most (then it stays in the unfinished work).
const (
	RefundReminderEveryMs = 24 * 60 * 60 * 1000
	RefundRemindersMax    = 3
)

// NewRequest is what a request is made from (payments.ts NewPaymentRequest, as the ledger reads it).
type NewRequest struct {
	AmountPaise  int64
	Reference    string
	Description  string
	PartPayments bool
}

func paidOf(r *MarkedRequest) int64 {
	var n int64
	for _, m := range r.Marks {
		n += m.AmountPaise
	}
	return n
}

// LeftOn is leftOn: what is still asked on a request, in paise (0 once paid in full or more).
func LeftOn(r *MarkedRequest) int64 { return max(0, r.AmountPaise-paidOf(r)) }

// freshCode is a code no request or refund holds, live or used.
func freshCode(s *State, codes Codes) *string {
	taken := map[string]bool{}
	for _, r := range s.Requests {
		if r.Code != nil {
			taken[*r.Code] = true
		}
		for _, c := range r.UsedCodes {
			taken[c] = true
		}
	}
	for _, r := range s.Refunds {
		if r.Code != nil {
			taken[*r.Code] = true
		}
		for _, c := range r.UsedCodes {
			taken[c] = true
		}
	}
	code := codes()
	for i := 0; taken[code] && i < 50; i++ {
		code = codes()
	}
	return &code
}

// OpenRequest is openRequest: make a request. The note in the link is the reference, so the owner sees it beside the money in their payment app. A link that cannot be made is the
// error, and nothing is written (the TypeScript throws before it pushes, but after it has counted: the counter moves first, so the next id skips one, as here).
func OpenRequest(s *State, payLink PayLink, r NewRequest, nowMs int64, codes Codes) (*MarkedRequest, error) {
	s.Seq++
	link, err := payLink(r.AmountPaise, r.Reference)
	if err != nil {
		return nil, err
	}
	req := &MarkedRequest{ID: fmt.Sprintf("upi-%d", s.Seq), Reference: r.Reference, AmountPaise: r.AmountPaise, Description: r.Description, Link: link,
		Code: freshCode(s, codes), UsedCodes: []string{}, Status: StatusCreated, CreatedAtMs: nowMs, Marks: []OwnerMark{}, AcceptPartial: r.PartPayments}
	s.Requests = append(s.Requests, req)
	return req, nil
}

// Result kinds of MarkReceived.
const (
	Marked        = "marked"
	Already       = "already"
	AlreadyRefund = "already_refund"
	Unknown       = "unknown"
	BadAmount     = "bad_amount"
)

// MarkResult is ledger.ts MarkResult: Kind says which of the five, and the members that kind has are set.
type MarkResult struct {
	Kind    string
	Request *MarkedRequest // marked, already, bad_amount
	Mark    *OwnerMark     // marked
	Refund  *OwedRefund    // already_refund
	// Full: paid in full with this mark. AfterClose: the request had been closed (a hold that ran out). Both for "marked".
	Full, AfterClose bool
}

func findRequest(list []*MarkedRequest, code string) (live, used *MarkedRequest) {
	for _, x := range list {
		if live == nil && x.Code != nil && *x.Code == code {
			live = x
		}
		if used == nil && contains(x.UsedCodes, code) {
			used = x
		}
	}
	return
}

func findRefund(list []*OwedRefund, code string) (live, used *OwedRefund) {
	for _, x := range list {
		if live == nil && x.Code != nil && *x.Code == code {
			live = x
		}
		if used == nil && contains(x.UsedCodes, code) {
			used = x
		}
	}
	return
}

func contains(l []string, s string) bool {
	for _, x := range l {
		if x == s {
			return true
		}
	}
	return false
}

// MarkReceived is markReceived: the owner says they received money for the request with this code: `amountPaise` (nil: exactly what is still asked). The code is used up. If the request
// is still not paid in full (and not closed), a new code is made for the rest, so the owner can mark it again when the rest comes.
func MarkReceived(s *State, code string, amountPaise *int64, nowMs int64, codes Codes) MarkResult {
	live, used := findRequest(s.Requests, code)
	if live == nil {
		if used != nil {
			return MarkResult{Kind: Already, Request: used}
		}
		rl, ru := findRefund(s.Refunds, code)
		if rl != nil {
			return MarkResult{Kind: AlreadyRefund, Refund: rl}
		}
		if ru != nil {
			return MarkResult{Kind: AlreadyRefund, Refund: ru}
		}
		return MarkResult{Kind: Unknown}
	}
	var amount int64
	switch {
	case amountPaise != nil:
		amount = *amountPaise
	case LeftOn(live) > 0:
		amount = LeftOn(live)
	default:
		amount = live.AmountPaise
	}
	// `amount > 10 * live.amountPaise`: a float comparison in JavaScript, so a huge amount cannot overflow here
	if amount <= 0 || float64(amount) > 10*float64(live.AmountPaise) {
		return MarkResult{Kind: BadAmount, Request: live}
	}
	afterClose := live.Status == StatusCancelled
	s.Seq++
	mark := OwnerMark{ID: fmt.Sprintf("upi-pay-%d", s.Seq), AmountPaise: amount, AtMs: nowMs, AfterClose: afterClose}
	live.Marks = append(live.Marks, mark)
	live.UsedCodes = append(live.UsedCodes, code)
	full := paidOf(live) >= live.AmountPaise
	if !afterClose {
		if full {
			live.Status = StatusPaid
		} else {
			live.Status = StatusPartiallyPaid
		}
	}
	if full || afterClose {
		live.Code = nil
	} else {
		live.Code = freshCode(s, codes)
	}
	return MarkResult{Kind: Marked, Request: live, Mark: &live.Marks[len(live.Marks)-1], Full: full, AfterClose: afterClose}
}

// CloseRequest is closeRequest: the agent closes a request it no longer wants paid (the hold ran out, the amount changed). Its code stays live: a mark that comes later is still recorded.
func CloseRequest(r *MarkedRequest, nowMs int64) {
	if r.Status == StatusCreated || r.Status == StatusPartiallyPaid {
		r.Status = StatusCancelled
		r.ClosedAtMs = &nowMs
	}
}

// NewRefund is what OweRefund is given.
type NewRefund struct {
	CaseID, Customer, PaymentID string
	AmountPaise                 int64
	Why                         string
	KeepAllowed                 bool
}

// OweRefund is oweRefund: a refund the owner owes. The agent never sends it; the owner pays it from their own payment app and marks it done.
func OweRefund(s *State, r NewRefund, nowMs int64, codes Codes) *OwedRefund {
	s.Seq++
	refund := &OwedRefund{ID: fmt.Sprintf("upr-%d", s.Seq), CaseID: r.CaseID, Customer: r.Customer, PaymentID: r.PaymentID, AmountPaise: r.AmountPaise, Why: r.Why, State: RefundOwed,
		Code: freshCode(s, codes), UsedCodes: []string{}, OwedAtMs: nowMs, NextReminderAtMs: nowMs + RefundReminderEveryMs, KeepAllowed: r.KeepAllowed}
	s.Refunds = append(s.Refunds, refund)
	return refund
}

// Result kinds of MarkRefund besides Already and Unknown: the two outcomes are RefundDone and RefundKept.
const NotAllowed = "not_allowed"

// RefundMarkResult is ledger.ts RefundMarkResult: Kind is "done", "kept", "already", "not_allowed" or "unknown".
type RefundMarkResult struct {
	Kind   string
	Refund *OwedRefund
}

// MarkRefund is markRefund: the owner says the refund with this code is paid ("done"), or, where that is allowed, that they keep the money for something they will give another way
// ("kept").
func MarkRefund(s *State, code, how string, nowMs int64) RefundMarkResult {
	live, used := findRefund(s.Refunds, code)
	if live == nil {
		if used != nil {
			return RefundMarkResult{Kind: Already, Refund: used}
		}
		return RefundMarkResult{Kind: Unknown}
	}
	if how == RefundKept && !live.KeepAllowed {
		return RefundMarkResult{Kind: NotAllowed, Refund: live}
	}
	live.State = how
	live.DoneAtMs = &nowMs
	live.UsedCodes = append(live.UsedCodes, code)
	live.Code = nil
	return RefundMarkResult{Kind: how, Refund: live}
}

// RemindersDue is remindersDue: refunds still owed whose next reminder to the owner is due. The caller sends it and calls Reminded.
func RemindersDue(s *State, nowMs int64) []*OwedRefund {
	var out []*OwedRefund
	for _, r := range s.Refunds {
		if r.State == RefundOwed && r.Reminders < RefundRemindersMax && r.NextReminderAtMs <= nowMs {
			out = append(out, r)
		}
	}
	return out
}

// Reminded is reminded: mutates in place and schedules the next nudge, so the caller sends a reminder and then records it.
func Reminded(r *OwedRefund, nowMs int64) {
	r.Reminders++
	r.NextReminderAtMs = nowMs + RefundReminderEveryMs
}

// OwedOn is owedOn: what is owed back on one mark (owed or done), so a second refund is never owed for the same money.
func OwedOn(s *State, paymentID string) int64 {
	var n int64
	for _, r := range s.Refunds {
		if r.PaymentID == paymentID && r.State != RefundKept {
			n += r.AmountPaise
		}
	}
	return n
}

// RequestOfMark is requestOfMark: the request a mark was made on, or nil.
func RequestOfMark(s *State, paymentID string) *MarkedRequest {
	for _, r := range s.Requests {
		for _, m := range r.Marks {
			if m.ID == paymentID {
				return r
			}
		}
	}
	return nil
}

// RefundSource is ledger.ts refundSource (25 Nov 2026): the payment a refund the owner owes gives back, the way the owner finds it in their UPI app: the note its link carried
// (the request's reference), and the owner's mark of it (the amount and when). ok is false when the ledger holds no such mark, which a refund it owes never is.
func RefundSource(s *State, r *OwedRefund) (note string, paidPaise, paidAtMs int64, ok bool) {
	req := RequestOfMark(s, r.PaymentID)
	if req == nil {
		return "", 0, 0, false
	}
	for _, m := range req.Marks {
		if m.ID == r.PaymentID {
			return req.Reference, m.AmountPaise, m.AtMs, true
		}
	}
	return "", 0, 0, false
}

// floorSeconds is Math.floor(ms / 1000).
func floorSeconds(ms int64) int64 { return int64(math.Floor(float64(ms) / 1000)) }
