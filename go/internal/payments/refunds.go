package payments

// Refunds, the careful way, for every template (modules/payments/refunds.ts): look first, send once, never send again what may have gone out.
//
// A refund above the owner's limit is not decided here. It is sent like any other; Guard holds it (HTTP 202) and the approvals relay asks the owner, once. The agent keeps the approval id
// and the EXACT bytes of the held call, and sends those same bytes again only when the relay says the owner approved: Guard releases a call only if it is the identical call. Between the
// hold and the answer the agent does nothing: no timer sends a held refund again. A refund that may have gone out is never sent again. A 409 is "nothing was refunded", except
// `already_done` (a person at the server settled it as made: DONE, never sent again). A 403 is "refused", and `denied_by_approver` is the owner's own no. A refund whose outcome is not
// known is settled only by the payments service's own list.
//
// The record words (the notes) are copied from the TypeScript and pinned by the scenario vectors (testdata/refunds-vectors.json); the case a refund belongs to is an interface, whose
// pending list, issues, stopped payments and untold refunds are changed in place, and pending entries are removed by identity, so they are pointers. Unknown members of a pending entry
// that TypeScript's templates keep there are the template's (OtherPending carries them raw).
//
// Where Go and TypeScript differ: UntoldRefund.amountInr is paise/100 in TypeScript (a float); here it stays paise and is written as the exact decimal (an exact "12.5", never 12.499999).
// The accounting package of the books stream is not imported: the narrow Accounting interface below is what refunds needs of it.

import (
	"context"
	"encoding/json"
	"regexp"
	"strconv"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/guard"
	"github.com/GeometerLabs/agents/go/internal/language"
)

// RetryMinutes: after a refund could not be sent at all, or an approved one could not be sent again: minutes before each next try, then the builder is told.
var RetryMinutes = []int64{1, 2, 5, 15, 30, 60}

// TellRetryMinutes: minutes after a try that sent nothing before the next one, then every 6 hours for as long as it takes.
var TellRetryMinutes = []int64{0, 5, 15, 60, 180, 360}

const minuteMs = 60_000

// Issue kinds: why a refund needs the builder, not the owner.
const (
	IssueUnknown     = "unknown"
	IssueUncertain   = "uncertain"
	IssueRefused     = "refused"
	IssueFailed      = "failed"
	IssueUnconfirmed = "unconfirmed"
	IssueExpired     = "expired"
	IssueUnheld      = "unheld"
	IssueLateUPI     = "late_upi"
)

// SettleableIssues are the kinds the payments service's own list can settle: the refund may have gone.
var SettleableIssues = []string{IssueUnknown, IssueUncertain, IssueUnconfirmed, IssueFailed}

func settleable(kind string) bool {
	for _, k := range SettleableIssues {
		if k == kind {
			return true
		}
	}
	return false
}

// RefundIssue: a refund the builder must look at. AmountPaise and RefundID are how the provider's list or its refund.done event is matched to THIS attempt.
type RefundIssue struct {
	PaymentID   string `json:"paymentId"`
	Kind        string `json:"kind"`
	Note        string `json:"note"`
	AtMs        int64  `json:"atMs"`
	AmountPaise *int64 `json:"amountPaise,omitempty"`
	RefundID    string `json:"refundId,omitempty"`
}

// UntoldRefund: a refund the provider's list settled whose customer has not been told yet. Last is not_sent, maybe or held_back.
type UntoldRefund struct {
	PaymentID   string
	RefundID    string
	AmountPaise int64
	SinceMs     int64
	Tries       int
	LastAtMs    int64
	Last        string
	RetryAtMs   *int64
}

type untoldJSON struct {
	PaymentID string          `json:"paymentId"`
	RefundID  string          `json:"refundId"`
	AmountInr json.RawMessage `json:"amountInr"`
	SinceMs   int64           `json:"sinceMs"`
	Tries     int             `json:"tries"`
	LastAtMs  int64           `json:"lastAtMs"`
	Last      string          `json:"last"`
	RetryAtMs *int64          `json:"retryAtMs,omitempty"`
}

// rupeesText is paise/100 as JavaScript writes the number (an exact decimal, shortest form).
func rupeesText(paise int64) string {
	whole, frac := paise/100, paise%100
	s := strconv.FormatInt(whole, 10)
	if paise < 0 && whole == 0 {
		s = "-0"
	}
	if frac != 0 {
		if frac < 0 {
			frac = -frac
		}
		f := strconv.FormatInt(frac+100, 10)[1:]
		s += "." + strings.TrimRight(f, "0")
	}
	return s
}

func (u UntoldRefund) MarshalJSON() ([]byte, error) {
	return json.Marshal(untoldJSON{u.PaymentID, u.RefundID, json.RawMessage(rupeesText(u.AmountPaise)), u.SinceMs, u.Tries, u.LastAtMs, u.Last, u.RetryAtMs})
}

func (u *UntoldRefund) UnmarshalJSON(b []byte) error {
	var j untoldJSON
	if err := json.Unmarshal(b, &j); err != nil {
		return err
	}
	// whole paise from the decimal text, never through a float
	text := string(j.AmountInr)
	whole, frac, _ := strings.Cut(text, ".")
	w, err := strconv.ParseInt(whole, 10, 64)
	if err != nil {
		return err
	}
	f := int64(0)
	if frac != "" {
		f, err = strconv.ParseInt((frac + "00")[:2], 10, 64)
		if err != nil {
			return err
		}
	}
	*u = UntoldRefund{j.PaymentID, j.RefundID, w*100 + f, j.SinceMs, j.Tries, j.LastAtMs, j.Last, j.RetryAtMs}
	return nil
}

// Pending is an entry of a case's pending list. The refund code adds and removes GuardHold and RefundRetry; any other entry is the template's.
type Pending interface{ PendingKind() string }

// GuardHold: a refund Guard is holding for the owner. It keeps the approval id and the EXACT bytes of the call that was held; they are sent again, once, after the relay says the owner
// approved. Never on a timer.
type GuardHold struct {
	Kind        string   `json:"kind"` // "guard_hold"
	AmountInr   int64    `json:"amountInr"`
	PaymentID   string   `json:"paymentId"`
	Receipt     string   `json:"receipt"`
	Approval    string   `json:"approval"`
	Body        string   `json:"body"`
	ExpiresAtMs *int64   `json:"expiresAtMs"` // null when Guard gave none
	HeldAtMs    int64    `json:"heldAtMs"`
	Approved    *bool    `json:"approved,omitempty"` // present and false after a hold Guard held again; absent before the owner answered
	Tries       int      `json:"tries,omitempty"`
	RetryAtMs   *int64   `json:"retryAtMs,omitempty"`
	RequestedBy []string `json:"requestedBy,omitempty"`
}

func (*GuardHold) PendingKind() string { return "guard_hold" }

// RefundThen is what to tell once a retried refund is done or held, as message ids of the template.
type RefundThen struct {
	Customer string `json:"customer"`
	Owner    string `json:"owner,omitempty"`
	Held     string `json:"held"`
}

// RefundRetry: a refund that could not be sent at all (nothing went out). The agent tries again by itself, a few times.
type RefundRetry struct {
	Kind        string     `json:"kind"` // "refund_retry"
	AmountInr   int64      `json:"amountInr"`
	PaymentID   string     `json:"paymentId"`
	Tries       int        `json:"tries"`
	RetryAtMs   int64      `json:"retryAtMs"`
	RequestedBy []string   `json:"requestedBy,omitempty"`
	Then        RefundThen `json:"then"`
}

func (*RefundRetry) PendingKind() string { return "refund_retry" }

// RefundCase is the thing a refund belongs to (a booking, a student's fee). The slices are returned by pointer so the refund code changes them in place.
type RefundCase interface {
	CaseID() string
	// Customer is the customer's number: the record is kept under it.
	Customer() string
	Pending() *[]Pending
	Issues() *[]*RefundIssue
	Stopped() *[]string
	Untold() *[]*UntoldRefund
}

// Result of asking for a refund: done, held, retry, stopped, denied.
const (
	ResultDone    = "done"
	ResultHeld    = "held"
	ResultRetry   = "retry"
	ResultStopped = "stopped"
	ResultDenied  = "denied"
)

// Said outcomes (messaging say.ts SaidOutcome).
const (
	SaidAccepted = "accepted"
	SaidMaybe    = "maybe"
	SaidNotSent  = "not_sent"
	SaidHeldBack = "held_back"
)

// MoneyEvent is the books' refund events (modules/accounting/post.ts), as far as refunds posts them.
type MoneyEvent struct {
	Kind        string // refund_owed, refund_made, refund_cancelled
	Case        string
	Owed        string
	PaymentID   string
	AmountPaise int64
	Method      string // refund_made: "gateway"
	Evidence    string // refund_made: provider or person_word
	RefundID    string
	Why         string // refund_cancelled: owner_said_no, expired, refused, failed
}

// Accounting is what refunds needs of the shop's books: post the event and write the template's own line with the money refs it returns.
type Accounting interface {
	Post(e MoneyEvent, write func(money map[string]string))
}

// LogMore is the optional part of a record line.
type LogMore struct {
	Decisions []any
	Notes     string
	Refs      map[string]string
}

// RefundIDs are the message ids refunds sends itself.
type RefundIDs struct{ Checking, Denied, Approved, Expired, Settled, Confirmed string }

// RefundDeps is what a template gives refunds: how to write to the record and tell people, and where to find the case again. RefundInr arguments are whole rupees, or paise for a
// settled refund's telling (RefundPaise), -1 for none.
type RefundDeps struct {
	Payments Payments
	Now      func() int64
	// Owner is the owner's number, for the record entries about the owner's decision.
	Owner string
	// LimitInr is the refund limit in whole rupees.
	LimitInr func() int64
	// Log writes to the record; c is nil when no case is waits on what was said.
	Log func(c RefundCase, phone, action, outcome string, inputs map[string]any, more LogMore)
	// TellCustomer and TellOwner return whether the message went. refundPaise is -1 when none.
	TellCustomer        func(c RefundCase, phone string, templates []string, refundPaise int64) bool
	TellCustomerOutcome func(c RefundCase, phone, template string, refundPaise int64) string
	TellOwner           func(c RefundCase, phone, template string, refundPaise int64) bool
	Cases               func() []RefundCase
	IDs                 RefundIDs
	Accounting          Accounting
}

// Refunds is createRefunds' result.
type Refunds struct{ d RefundDeps }

// NewRefunds is createRefunds.
func NewRefunds(d RefundDeps) *Refunds { return &Refunds{d: d} }

// RecheckLine is the record's line for a look: how many of the refunds looked at the list now shows, how many of those customers were told, how many stay on the to-do list.
func RecheckLine(settled, looked, told int) string {
	untold := settled - told
	var tail string
	switch {
	case settled == 0:
	case untold == 0:
		tail = ", and the customer was told of each one that does"
	default:
		word := "stay"
		if untold == 1 {
			word = "stays"
		}
		tail = "; the customer was told of " + strconv.Itoa(told) + ", and " + strconv.Itoa(untold) + " " + word + " on the to-do list as \"refund made, customer not yet told\""
	}
	return strconv.Itoa(settled) + " of " + strconv.Itoa(looked) + " refunds now show on the payments service's list" + tail + "; none was sent again"
}

func merge(ms ...map[string]string) map[string]string {
	out := map[string]string{}
	for _, m := range ms {
		for k, v := range m {
			out[k] = v
		}
	}
	return out
}

func itoa(n int64) string { return strconv.FormatInt(n, 10) }

func (r *Refunds) post(e MoneyEvent, write func(map[string]string)) {
	if r.d.Accounting != nil {
		r.d.Accounting.Post(e, write)
	} else {
		write(map[string]string{})
	}
}

func owedKey(b RefundCase, paymentID string) string { return b.CaseID() + ":" + paymentID }

func (r *Refunds) madePost(b RefundCase, paymentID string, amountPaise int64, refundID string, write func(map[string]string)) {
	ev := MoneyEvent{Kind: "refund_made", Case: b.CaseID(), Owed: owedKey(b, paymentID), PaymentID: paymentID, AmountPaise: amountPaise, Method: "gateway", Evidence: "provider", RefundID: refundID}
	if refundID == "" {
		ev.Evidence = "person_word"
	}
	r.post(ev, write)
}

func (r *Refunds) cancelPost(b RefundCase, paymentID, why string, write func(map[string]string)) {
	r.post(MoneyEvent{Kind: "refund_cancelled", Case: b.CaseID(), Owed: owedKey(b, paymentID), Why: why}, write)
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

// raise: the builder must look at this refund, not the owner. amountInr and refundID are what the attempt asked for and the id it was given, kept so the provider's list can settle this
// attempt and no other.
func (r *Refunds) raise(b RefundCase, paymentID, kind, note string, amountInr *int64, refundID string) {
	iss := &RefundIssue{PaymentID: paymentID, Kind: kind, Note: note, AtMs: r.d.Now(), RefundID: refundID}
	if amountInr != nil {
		p := *amountInr * 100
		iss.AmountPaise = &p
	}
	*b.Issues() = append(*b.Issues(), iss)
	if kind != IssueUnheld {
		*b.Stopped() = append(*b.Stopped(), paymentID) // asking Guard again could only ask the owner about the same money again
	}
}

func (r *Refunds) overLimit(amountInr int64) bool { return amountInr > r.d.LimitInr() }

// OverLimit: is this refund above the owner's limit (so Guard should hold it)?
func (r *Refunds) OverLimit(amountInr int64) bool { return r.overLimit(amountInr) }

type sorted struct {
	is  string
	err *guard.GuardError
	why string
}

// sortRefundError: what an error from a refund call means for the refund. Anything that is not one of the service errors is the agent's own bug, and is returned as the error.
func sortRefundError(e error) (sorted, error) {
	g, isGuard := guard.AsGuard(e)
	if isGuard {
		switch g.Kind {
		case guard.KindAlreadyDone: // first: it is a conflict too
			return sorted{is: "already_done", err: g}, nil
		case guard.KindHeld:
			return sorted{is: "held", err: g}, nil
		case guard.KindOutcomeUnknown:
			return sorted{is: "may_have_happened", why: "Guard says the outcome is unknown"}, nil
		case guard.KindDenied: // before refused: it is a refusal too
			return sorted{is: "owner_said_no", err: g}, nil
		case guard.KindRefused:
			return sorted{is: "refused", err: g}, nil
		case guard.KindUnavailable:
			return sorted{is: "not_sent", why: g.Message}, nil
		}
		return sorted{is: "no_good", why: g.Message}, nil // any other conflict or Guard decision
	}
	if guard.IsNotSent(e) {
		return sorted{is: "not_sent", why: e.Error()}, nil
	}
	if guard.IsTimeout(e) {
		return sorted{is: "lost", why: e.Error()}, nil
	}
	if st, ok := guard.IsAPI(e); ok {
		// the service's own answer, as it came through Guard: a 5xx may have happened (Guard will not repeat it either); a 4xx did not
		if st >= 500 {
			return sorted{is: "may_have_happened", why: "the payments service answered " + itoa(int64(st))}, nil
		}
		return sorted{is: "not_sent", why: e.Error()}, nil
	}
	return sorted{}, e
}

func (r *Refunds) findRefund(ctx context.Context, paymentID, receipt string) (*Refund, error) {
	list, err := r.d.Payments.ListRefunds(ctx, paymentID)
	if err != nil {
		return nil, err
	}
	for i := range list {
		if list[i].Receipt != nil && *list[i].Receipt == receipt {
			return &list[i], nil
		}
	}
	return nil, nil
}

// quietFind is `findRefund(...).catch(() => undefined)`.
func (r *Refunds) quietFind(ctx context.Context, paymentID, receipt string) *Refund {
	f, err := r.findRefund(ctx, paymentID, receipt)
	if err != nil {
		return nil
	}
	return f
}

func (r *Refunds) log(c RefundCase, phone, action, outcome string, inputs map[string]any, more LogMore) {
	r.d.Log(c, phone, action, outcome, inputs, more)
}

func pay(paymentID string, amountInr int64) map[string]any {
	return map[string]any{"paymentId": paymentID, "amountInr": amountInr}
}

// settledByPerson: Guard says a person at the server settled this refund as made (409 already_done): done, by that person's word, and never sent again.
func (r *Refunds) settledByPerson(ctx context.Context, b RefundCase, paymentID string, amountInr int64, refs map[string]string, e *guard.GuardError) {
	who := e.ConfirmedBy
	if who == "" {
		who = "a person at the server"
	}
	r.madePost(b, paymentID, amountInr*100, "", func(m map[string]string) {
		extra := map[string]string{"confirmedBy": who}
		if e.Intent != "" {
			extra["intent"] = e.Intent
		}
		r.log(b, b.Customer(), "refund", "confirmed", pay(paymentID, amountInr), LogMore{
			Refs:  merge(refs, extra, m),
			Notes: "Guard says " + who + " settled this refund as made (already_done): it is done by that person's word, not by the payments service's own list, which did not show it. It is not sent again",
		})
	})
	if !contains(*b.Stopped(), paymentID) {
		*b.Stopped() = append(*b.Stopped(), paymentID) // asking Guard again would only get the same answer
	}
	r.d.TellOwner(b, b.Customer(), r.d.IDs.Settled, amountInr*100)
}

// ownerSaidNo: Guard says a person already said no to this exact refund (403 denied_by_approver). The caller tells the customer.
func (r *Refunds) ownerSaidNo(b RefundCase, paymentID string, amountInr int64, refs map[string]string, e *guard.GuardError, approval string) {
	which := e.DeniedApproval
	if which == "" {
		which = approval
	}
	if which != "" {
		r.log(b, r.d.Owner, "owner_decision", "confirmed", map[string]any{"approval": which, "decision": "deny"}, LogMore{Refs: map[string]string{"command": "deny", "approval": which}, Notes: "Guard's record says the person asked denied this exact refund, so Guard refused it when it was sent again and asked nobody again"})
	}
	if !contains(*b.Stopped(), paymentID) {
		*b.Stopped() = append(*b.Stopped(), paymentID) // the identical call is refused for a day, and asking later would ask the owner again
	}
	r.cancelPost(b, paymentID, "owner_said_no", func(m map[string]string) {
		extra := map[string]string{}
		if which != "" {
			extra["approval"] = which
		}
		r.log(b, b.Customer(), "refund", "blocked", pay(paymentID, amountInr), LogMore{Refs: merge(refs, extra, m), Notes: "the owner declined the refund (Guard: denied_by_approver). Nothing was refunded"})
	})
}

func refusalWords(e *guard.GuardError) string {
	kind := "a rule"
	if e.RefusalKind == "limit" {
		kind = "a limit"
	}
	if e.RuleID != "" {
		kind += ": " + e.RuleID
	}
	return kind
}

func guardReason(e *guard.GuardError) string {
	if e.Guard.HasReason {
		return e.Guard.Reason
	}
	return e.Message
}

// RequestRefund asks for a refund of a payment, once. expectHold: the amount is above the owner's limit, so Guard should hold it. "done": the payments service's own list shows the
// refund. "held": Guard is holding it for the owner. "retry": nothing went out, it will be tried again by itself. "stopped": the builder has been told, and nothing more is done.
func (r *Refunds) RequestRefund(ctx context.Context, b RefundCase, paymentID string, amountInr int64, decisions []any, expectHold bool, requestedBy []string) (string, error) {
	receipt := b.CaseID() + ":" + paymentID // the case id travels in the receipt: the relay finds the case from it
	amountPaise := amountInr * 100
	refs := map[string]string{"paymentId": paymentID, "amountPaise": itoa(amountPaise)}
	if contains(*b.Stopped(), paymentID) {
		r.log(b, b.Customer(), "refund", "blocked", pay(paymentID, amountInr), LogMore{Refs: refs, Notes: "an earlier try at this refund ended with a no, an unclear outcome, a failure, or Guard's word that a person settled it as made, so Guard is not asked again"})
		return ResultStopped, nil
	}
	// the refund is owed from its first attempt (a repeat of the same attempt owes nothing new: post says so and the line is written as before)
	r.post(MoneyEvent{Kind: "refund_owed", Case: b.CaseID(), Owed: receipt, PaymentID: paymentID, AmountPaise: amountPaise}, func(m map[string]string) {
		r.log(b, b.Customer(), "refund", "attempted", pay(paymentID, amountInr), LogMore{Decisions: decisions, Refs: merge(refs, m)})
	})

	// maybeDone: the refund may have gone out and cannot be sent again: read the payments service's own list once, and stop.
	maybeDone := func(why string) string {
		if found := r.quietFind(ctx, paymentID, receipt); found != nil {
			r.madePost(b, paymentID, amountPaise, found.ID, func(m map[string]string) {
				r.log(b, b.Customer(), "refund", "confirmed", pay(paymentID, amountInr), LogMore{Refs: merge(refs, map[string]string{"refundId": found.ID}, m), Notes: why + "; the payments service's own list shows the refund, and it is not sent again"})
			})
			return ResultDone
		}
		note := why + ". The refund may or may not have been made. It was NOT sent again. Check the payment gateway's own records for payment " + paymentID + "; if Guard holds it as uncertain, tell Guard what happened (POST /admin/intents/resolve)."
		r.log(b, b.Customer(), "refund", "unconfirmed", pay(paymentID, amountInr), LogMore{Refs: refs, Notes: note})
		r.raise(b, paymentID, IssueUnknown, note, &amountInr, "")
		return ResultStopped
	}

	// readBack: the service took the refund (2xx): read it back once. Never send again, whatever the list shows.
	readBack := func(refundID, note string) string {
		if found := r.quietFind(ctx, paymentID, receipt); found != nil {
			r.madePost(b, paymentID, amountPaise, found.ID, func(m map[string]string) {
				more := LogMore{Refs: merge(refs, map[string]string{"refundId": found.ID}, m)}
				if note != "" {
					more.Notes = note
				}
				r.log(b, b.Customer(), "refund", "confirmed", pay(paymentID, amountInr), more)
			})
			if expectHold {
				why := "A refund of " + language.FormatInr(float64(amountInr)) + " is above the " + language.FormatInr(float64(r.d.LimitInr())) + " limit but Guard sent it without holding it for the owner. Guard's threshold does not match these settings: check the gateway's limits spec."
				r.log(b, b.Customer(), "refund", "unconfirmed", pay(paymentID, amountInr), LogMore{Refs: refs, Notes: why})
				r.raise(b, paymentID, IssueUnheld, why, nil, "")
			}
			return ResultDone
		}
		why := "the payments service accepted the refund, but its own list does not show it yet. It is NOT sent again"
		extra := map[string]string{}
		if refundID != "" {
			extra["refundId"] = refundID
		}
		r.log(b, b.Customer(), "refund", "unconfirmed", pay(paymentID, amountInr), LogMore{Refs: merge(refs, extra), Notes: why})
		r.raise(b, paymentID, IssueUnconfirmed, why, &amountInr, refundID)
		return ResultStopped
	}

	var errText string
	hasErr := false
	for attempt := 0; attempt < Attempts; attempt++ {
		done, err := r.findRefund(ctx, paymentID, receipt) // look first: an earlier try, or a lost reply, may have landed
		if err != nil {
			if _, api := guard.IsAPI(err); !guard.IsTimeout(err) && !api {
				return "", err
			}
			errText, hasErr = "could not look at the existing refunds first ("+err.Error()+"), so nothing was sent", true
			break // what cannot be looked at is not sent blind
		}
		if done != nil {
			r.madePost(b, paymentID, amountPaise, done.ID, func(m map[string]string) {
				r.log(b, b.Customer(), "refund", "confirmed", pay(paymentID, amountInr), LogMore{Refs: merge(refs, map[string]string{"refundId": done.ID}, m)})
			})
			return ResultDone, nil
		}
		req := RefundRequest{Amount: amountPaise, Receipt: receipt, HasReceipt: true}
		if len(requestedBy) > 0 {
			req.RequestedBy = requestedBy
		}
		sent, err := r.d.Payments.Refund(ctx, paymentID, req)
		if err == nil {
			note := ""
			if sent.Replayed {
				note = "Guard answered from its record; nothing was sent again"
			}
			return readBack(sent.ID, note), nil
		}
		s, rethrow := sortRefundError(err)
		if rethrow != nil {
			return "", rethrow
		}
		switch s.is {
		case "already_done":
			r.settledByPerson(ctx, b, paymentID, amountInr, refs, s.err)
			return ResultDone, nil
		case "held":
			if s.err.Approval == nil || !s.err.Call.HasBody {
				note := "Guard is holding this refund with no approval to give: an earlier attempt has an unknown outcome, and only a person at the server can settle it, not the owner on WhatsApp. It was NOT sent again. Check the payment gateway's own records for payment " + paymentID + ", then tell Guard (POST /admin/intents/resolve)."
				r.log(b, b.Customer(), "refund", "unconfirmed", pay(paymentID, amountInr), LogMore{Refs: refs, Notes: note})
				r.raise(b, paymentID, IssueUncertain, note, &amountInr, "")
				return ResultStopped, nil
			}
			h := &GuardHold{Kind: "guard_hold", AmountInr: amountInr, PaymentID: paymentID, Receipt: receipt, Approval: *s.err.Approval, Body: s.err.Call.Body, ExpiresAtMs: s.err.ExpiresAtMs, HeldAtMs: r.d.Now()}
			if len(requestedBy) > 0 {
				h.RequestedBy = requestedBy
			}
			*b.Pending() = append(*b.Pending(), h)
			r.log(b, b.Customer(), "refund", "held_for_owner", pay(paymentID, amountInr), LogMore{Decisions: decisions, Refs: merge(refs, map[string]string{"approval": *s.err.Approval}), Notes: "Guard is holding this refund for the owner. The approvals relay asks the owner, once; the agent does not."})
			return ResultHeld, nil
		case "may_have_happened":
			return maybeDone(s.why), nil
		case "owner_said_no":
			r.ownerSaidNo(b, paymentID, amountInr, refs, s.err, "")
			return ResultDenied, nil
		case "refused":
			note := "Guard refused the refund (" + refusalWords(s.err) + "): " + guardReason(s.err) + ". Nothing was refunded."
			r.cancelPost(b, paymentID, "refused", func(m map[string]string) {
				r.log(b, b.Customer(), "refund", "blocked", pay(paymentID, amountInr), LogMore{Refs: merge(refs, m), Notes: note})
			})
			r.raise(b, paymentID, IssueRefused, note, nil, "")
			return ResultStopped, nil
		case "no_good":
			note := "Guard did not take the refund and will not on a retry: " + s.why + ". Nothing was refunded."
			r.cancelPost(b, paymentID, "failed", func(m map[string]string) {
				r.log(b, b.Customer(), "refund", "failed", pay(paymentID, amountInr), LogMore{Refs: merge(refs, m), Notes: note})
			})
			r.raise(b, paymentID, IssueFailed, note, &amountInr, "")
			return ResultStopped, nil
		case "lost", "not_sent":
			errText, hasErr = s.why, true // look again, and try once more
		}
	}
	outcome := "unconfirmed"
	words := "the refund could not be sent"
	if hasErr {
		outcome, words = "failed", errText
	}
	r.log(b, b.Customer(), "refund", outcome, pay(paymentID, amountInr), LogMore{Refs: refs, Notes: words + "; it will be tried again"})
	return ResultRetry, nil
}

// RefundAfter is what afterRefund needs: the payment, the amount, what to tell when done, and the held message id.
type RefundAfter struct {
	PaymentID   string
	AmountInr   int64
	DoneCust    string
	DoneOwner   string
	Held        string
	RequestedBy []string
}

// AfterRefund: what the customer is told after a refund was asked for, and what is kept to try again.
func (r *Refunds) AfterRefund(b RefundCase, result string, a RefundAfter) {
	switch result {
	case ResultDone:
		r.d.TellCustomer(b, b.Customer(), []string{a.DoneCust}, a.AmountInr*100)
		if a.DoneOwner != "" {
			r.d.TellOwner(b, b.Customer(), a.DoneOwner, a.AmountInr*100)
		}
		return
	case ResultHeld:
		r.d.TellCustomer(b, b.Customer(), []string{a.Held}, a.AmountInr*100)
		return
	case ResultDenied:
		r.d.TellCustomer(b, b.Customer(), []string{r.d.IDs.Denied}, -1) // the owner's no, as the relay's deny tells it
		return
	case ResultRetry:
		rt := &RefundRetry{Kind: "refund_retry", AmountInr: a.AmountInr, PaymentID: a.PaymentID, Tries: 0, RetryAtMs: r.d.Now() + RetryMinutes[0]*minuteMs, Then: RefundThen{Customer: a.DoneCust, Owner: a.DoneOwner, Held: a.Held}}
		if len(a.RequestedBy) > 0 {
			rt.RequestedBy = a.RequestedBy
		}
		*b.Pending() = append(*b.Pending(), rt)
	}
	r.d.TellCustomer(b, b.Customer(), []string{r.d.IDs.Checking}, a.AmountInr*100)
}

func (r *Refunds) dropHold(b RefundCase, h *GuardHold) { removePending(b, h) }

func removePending(b RefundCase, p Pending) {
	list := *b.Pending()
	out := make([]Pending, 0, len(list))
	for _, x := range list {
		if x != p {
			out = append(out, x)
		}
	}
	*b.Pending() = out
}

// RetryRefund: a refund that could not be sent at all is tried again by the clock, a few times; then the builder is told.
func (r *Refunds) RetryRefund(ctx context.Context, b RefundCase, p *RefundRetry) error {
	removePending(b, p)
	result, err := r.RequestRefund(ctx, b, p.PaymentID, p.AmountInr, []any{}, r.overLimit(p.AmountInr), p.RequestedBy)
	if err != nil {
		return err
	}
	switch result {
	case ResultRetry:
		tries := p.Tries + 1
		if tries >= len(RetryMinutes) {
			note := "The refund of " + language.FormatInr(float64(p.AmountInr)) + " for payment " + p.PaymentID + " could not be sent after " + strconv.Itoa(tries+1) + " tries. Nothing was refunded."
			r.cancelPost(b, p.PaymentID, "failed", func(m map[string]string) {
				r.log(b, b.Customer(), "refund", "failed", pay(p.PaymentID, p.AmountInr), LogMore{Notes: note, Refs: merge(map[string]string{"paymentId": p.PaymentID}, m)})
			})
			r.raise(b, p.PaymentID, IssueFailed, note, &p.AmountInr, "")
			return nil
		}
		next := *p
		next.Tries, next.RetryAtMs = tries, r.d.Now()+RetryMinutes[tries]*minuteMs
		*b.Pending() = append(*b.Pending(), &next)
	case ResultDone:
		r.d.TellCustomer(b, b.Customer(), []string{p.Then.Customer}, p.AmountInr*100)
		if p.Then.Owner != "" {
			r.d.TellOwner(b, b.Customer(), p.Then.Owner, p.AmountInr*100)
		}
	case ResultHeld:
		r.d.TellCustomer(b, b.Customer(), []string{p.Then.Held}, p.AmountInr*100)
	case ResultDenied:
		r.d.TellCustomer(b, b.Customer(), []string{r.d.IDs.Denied}, -1)
	}
	return nil
}

// isTheRefund: is this refund, as the list shows it, the one this open issue is about? By the refund id the attempt was given; otherwise by our receipt; otherwise by the payment and the
// exact amount the attempt asked for. A refund of the same payment for another amount is never taken for it.
func isTheRefund(b RefundCase, issue *RefundIssue, rf Refund) bool {
	if rf.PaymentID != issue.PaymentID {
		return false
	}
	if issue.RefundID != "" {
		return rf.ID == issue.RefundID
	}
	if rf.Receipt != nil && *rf.Receipt == b.CaseID()+":"+issue.PaymentID {
		return true
	}
	return issue.AmountPaise != nil && rf.Amount == *issue.AmountPaise
}

// OpenIssueFor: the open issue on this case that a listed refund settles, if any (only the kinds the list can answer).
func (r *Refunds) OpenIssueFor(b RefundCase, rf Refund) *RefundIssue {
	for _, i := range *b.Issues() {
		if settleable(i.Kind) && isTheRefund(b, i, rf) {
			return i
		}
	}
	return nil
}

// tellConfirmed tells the customer their refund is confirmed, for a settled refund kept in Untold. An accepted message ends it, and it is never sent again.
func (r *Refunds) tellConfirmed(b RefundCase, u *UntoldRefund) bool {
	outcome := r.d.TellCustomerOutcome(b, b.Customer(), r.d.IDs.Confirmed, u.AmountPaise)
	if outcome == SaidAccepted {
		out := []*UntoldRefund{}
		for _, x := range *b.Untold() {
			if x != u {
				out = append(out, x)
			}
		}
		*b.Untold() = out
		return true
	}
	u.Tries++
	u.LastAtMs = r.d.Now()
	u.Last = outcome
	if outcome == SaidNotSent {
		i := u.Tries - 1
		if i > len(TellRetryMinutes)-1 {
			i = len(TellRetryMinutes) - 1
		}
		t := r.d.Now() + TellRetryMinutes[i]*minuteMs
		u.RetryAtMs = &t
	} else {
		u.RetryAtMs = nil // it may have reached them, or it would be held back again: never sent again by itself
	}
	return false
}

// SettledThrough: who settled an open refund from the provider's list: a person's look ("recheck"), or the provider's own refund.done event (its id).
type SettledThrough struct {
	Via     string // recheck or refund.done
	EventID string
}

func (r *Refunds) settleIssue(b RefundCase, issue *RefundIssue, rf Refund, through SettledThrough) bool {
	out := []*RefundIssue{}
	for _, x := range *b.Issues() {
		if x != issue {
			out = append(out, x)
		}
	}
	*b.Issues() = out
	inputs := map[string]any{"paymentId": issue.PaymentID, "recheck": true}
	if through.Via != "recheck" {
		inputs = map[string]any{"paymentId": issue.PaymentID, "event": through.EventID}
	}
	r.madePost(b, issue.PaymentID, rf.Amount, rf.ID, func(m map[string]string) {
		refs := map[string]string{"paymentId": issue.PaymentID, "amountPaise": itoa(rf.Amount), "refundId": rf.ID}
		notes := "looked again: the payments service's own list now shows the refund. It was not sent again"
		if through.Via == "refund.done" {
			refs["eventId"] = through.EventID
			notes = "the payments service's own refund.done event names this refund, and its own list shows it: the attempt whose outcome was unknown is settled by the provider. It was not sent again"
		}
		r.log(b, b.Customer(), "refund", "confirmed", inputs, LogMore{Refs: merge(refs, m), Notes: notes})
	})
	now := r.d.Now()
	u := &UntoldRefund{PaymentID: issue.PaymentID, RefundID: rf.ID, AmountPaise: rf.Amount, SinceMs: now, Tries: 0, LastAtMs: now, Last: SaidNotSent}
	*b.Untold() = append(*b.Untold(), u) // kept before the message goes, so it is listed until a message is accepted
	return r.tellConfirmed(b, u)
}

// Recheck looks once more, read-only, at the payments service's own list of refunds for each payment whose refund may have gone. Nothing is ever SENT. Returns how many it settled, how
// many it looked at, and of those settled how many customers were told.
func (r *Refunds) Recheck(ctx context.Context, b RefundCase) (settled, looked, told int, err error) {
	for _, issue := range append([]*RefundIssue(nil), *b.Issues()...) {
		if !settleable(issue.Kind) {
			continue
		}
		looked++
		refs := map[string]string{"paymentId": issue.PaymentID}
		list, lerr := r.d.Payments.ListRefunds(ctx, issue.PaymentID)
		if lerr != nil {
			if _, api := guard.IsAPI(lerr); !guard.IsTimeout(lerr) && !api {
				return settled, looked, told, lerr
			}
			r.log(b, b.Customer(), "refund", "unconfirmed", map[string]any{"paymentId": issue.PaymentID, "recheck": true}, LogMore{Refs: refs, Notes: "looked again, but the payments service's list could not be read (" + lerr.Error() + "). Nothing was sent"})
			continue
		}
		var found *Refund
		for i := range list {
			if isTheRefund(b, issue, list[i]) {
				found = &list[i]
				break
			}
		}
		if found != nil {
			if r.settleIssue(b, issue, *found, SettledThrough{Via: "recheck"}) {
				told++
			}
			settled++
		} else {
			r.log(b, b.Customer(), "refund", "unconfirmed", map[string]any{"paymentId": issue.PaymentID, "recheck": true}, LogMore{Refs: refs, Notes: "looked again: the payments service's own list still does not show the refund. It was not sent again; check the payment gateway's own records"})
		}
	}
	return
}

// SettleFromEvent: the provider's own refund.done event, already checked against the payments service's list. When it is the refund an open issue is about, that attempt is settled.
func (r *Refunds) SettleFromEvent(b RefundCase, listed Refund, eventID string) bool {
	issue := r.OpenIssueFor(b, listed)
	if issue == nil {
		return false
	}
	r.settleIssue(b, issue, listed, SettledThrough{Via: "refund.done", EventID: eventID})
	return true
}

func (r *Refunds) holdFor(approval string) (RefundCase, *GuardHold) {
	for _, b := range r.d.Cases() {
		for _, p := range *b.Pending() {
			if h, ok := p.(*GuardHold); ok && h.Approval == approval {
				return b, h
			}
		}
	}
	return nil, nil
}

// OnApprovalDecision: the relay says the owner decided (decision is "approve" or "deny").
func (r *Refunds) OnApprovalDecision(ctx context.Context, approval, decision string) error {
	b, hold := r.holdFor(approval)
	if b == nil {
		r.log(nil, r.d.Owner, "owner_decision", "blocked", map[string]any{"approval": approval, "decision": decision}, LogMore{Notes: "no refund is waiting on this approval, so nothing is done (it may be answered already, expired, or not ours)", Refs: map[string]string{"approval": approval}})
		return nil
	}
	r.log(b, r.d.Owner, "owner_decision", "attempted", map[string]any{"approval": hold.Approval, "decision": decision}, LogMore{Refs: map[string]string{"command": decision, "approval": hold.Approval}, Notes: "the approvals relay says the owner decided"})
	if decision == "deny" {
		// A deny cannot be checked from here. It is the safe direction for the money, and it is final.
		r.log(b, r.d.Owner, "owner_decision", "confirmed", map[string]any{"approval": hold.Approval, "decision": decision}, LogMore{Refs: map[string]string{"command": decision, "approval": hold.Approval}, Notes: "the approvals relay reported that the owner denied the refund"})
		r.dropHold(b, hold)
		*b.Stopped() = append(*b.Stopped(), hold.PaymentID) // Guard would hold the same call again under a new approval: the agent must not ask again
		r.cancelPost(b, hold.PaymentID, "owner_said_no", func(m map[string]string) {
			r.log(b, b.Customer(), "refund", "blocked", pay(hold.PaymentID, hold.AmountInr), LogMore{Refs: merge(map[string]string{"paymentId": hold.PaymentID, "approval": hold.Approval}, m), Notes: "the owner declined the refund"})
		})
		r.d.TellCustomer(b, b.Customer(), []string{r.d.IDs.Denied}, -1)
		return nil
	}
	yes := true
	hold.Approved = &yes
	return r.ReleaseHeld(ctx, b, hold)
}

// ReleaseHeld sends the held call again, with the very bytes it was held with. Only after the relay said the owner approved.
func (r *Refunds) ReleaseHeld(ctx context.Context, b RefundCase, hold *GuardHold) error {
	paymentID, amountInr := hold.PaymentID, hold.AmountInr
	refs := map[string]string{"paymentId": paymentID, "amountPaise": itoa(amountInr * 100), "approval": hold.Approval}
	later := func(why string) {
		hold.Tries++
		if hold.Tries >= len(RetryMinutes) {
			r.dropHold(b, hold)
			note := "The owner approved the refund, but it could not be sent after " + strconv.Itoa(hold.Tries) + " tries (" + why + "). Nothing was refunded."
			r.cancelPost(b, paymentID, "failed", func(m map[string]string) {
				r.log(b, b.Customer(), "refund", "failed", pay(paymentID, amountInr), LogMore{Refs: merge(refs, m), Notes: note})
			})
			r.raise(b, paymentID, IssueFailed, note, &amountInr, "")
			r.d.TellCustomer(b, b.Customer(), []string{r.d.IDs.Checking}, amountInr*100)
			return
		}
		t := r.d.Now() + RetryMinutes[hold.Tries-1]*minuteMs
		hold.RetryAtMs = &t
		r.log(b, b.Customer(), "refund", "failed", pay(paymentID, amountInr), LogMore{Refs: refs, Notes: "the approved refund could not be sent yet (" + why + "); it is tried again"})
	}
	// released: Guard let the held call go, which it does only for an approved one: now the owner's approval is a fact the report may count.
	released := func() {
		r.log(b, r.d.Owner, "owner_decision", "confirmed", map[string]any{"approval": hold.Approval, "decision": "approve"}, LogMore{Refs: map[string]string{"command": "approve", "approval": hold.Approval}, Notes: "Guard released the held refund, so the owner's approval is on Guard's record"})
	}
	finish := func(refundID, note string) {
		r.dropHold(b, hold)
		r.madePost(b, paymentID, amountInr*100, refundID, func(m map[string]string) {
			more := LogMore{Refs: merge(refs, map[string]string{"refundId": refundID}, m)}
			if note != "" {
				more.Notes = note
			}
			r.log(b, b.Customer(), "refund", "confirmed", pay(paymentID, amountInr), more)
		})
		r.d.TellCustomer(b, b.Customer(), []string{r.d.IDs.Approved}, amountInr*100)
	}
	stop := func(kind, note, outcome, refundID string) {
		r.dropHold(b, hold)
		// only a no that is final cancels the refund; one that may have gone out (unknown, uncertain, unconfirmed) stays owed
		line := func(m map[string]string) {
			extra := map[string]string{}
			if refundID != "" {
				extra["refundId"] = refundID
			}
			r.log(b, b.Customer(), "refund", outcome, pay(paymentID, amountInr), LogMore{Refs: merge(refs, extra, m), Notes: note})
		}
		if kind == IssueRefused || kind == IssueFailed {
			r.cancelPost(b, paymentID, kind, line)
		} else {
			line(map[string]string{})
		}
		r.raise(b, paymentID, kind, note, &amountInr, refundID)
		r.d.TellCustomer(b, b.Customer(), []string{r.d.IDs.Checking}, amountInr*100)
	}

	// look before retrying: the refund may exist already
	listed, err := r.findRefund(ctx, paymentID, hold.Receipt)
	if err != nil {
		if _, api := guard.IsAPI(err); !guard.IsTimeout(err) && !api {
			return err
		}
		later("could not look at the existing refunds first: " + err.Error())
		return nil
	}
	if listed != nil {
		finish(listed.ID, "the refund was already on the payments service's own list, so it was not sent again")
		return nil
	}

	resentID := "" // the id the service gave the approved refund, kept if its list does not show it yet
	resent, err := r.d.Payments.ResendRefund(ctx, paymentID, hold.Body, hold.RequestedBy)
	if err != nil {
		s, rethrow := sortRefundError(err)
		if rethrow != nil {
			return rethrow
		}
		switch s.is {
		case "already_done":
			// a person at the server settled it as made while it waited for the owner: Guard did not use the owner's approval, and nothing was sent
			r.dropHold(b, hold)
			r.settledByPerson(ctx, b, paymentID, amountInr, refs, s.err)
			r.d.TellCustomer(b, b.Customer(), []string{r.d.IDs.Approved}, amountInr*100)
		case "held":
			if s.err.Approval == nil {
				stop(IssueUncertain, "After the owner approved, Guard holds the refund with no approval to give (an earlier attempt has an unknown outcome). It was NOT sent again. Check the payment gateway's own records for payment "+paymentID+", then tell Guard (POST /admin/intents/resolve).", "unconfirmed", "")
				return nil
			}
			no := false
			hold.Approved = &no
			if *s.err.Approval == hold.Approval { // Guard has no approval on record for this call: the owner's answer was not recorded there, and the owner was already asked
				r.log(b, b.Customer(), "refund", "held_for_owner", pay(paymentID, amountInr), LogMore{Refs: refs, Notes: "Guard still holds the refund: its record does not show the owner's approval. It waits; the owner is not asked again"})
				return nil
			}
			hold.Approval = *s.err.Approval
			hold.ExpiresAtMs = s.err.ExpiresAtMs
			r.log(b, b.Customer(), "refund", "held_for_owner", pay(paymentID, amountInr), LogMore{Refs: merge(refs, map[string]string{"approval": *s.err.Approval}), Notes: "Guard held the call again under a new approval (the first was used up or no longer valid). The relay will ask the owner about the new one"})
		case "owner_said_no":
			// the relay said approve, but Guard's record says a person denied this exact refund: Guard is the record, so it is the owner's no
			r.dropHold(b, hold)
			r.ownerSaidNo(b, paymentID, amountInr, refs, s.err, hold.Approval)
			r.d.TellCustomer(b, b.Customer(), []string{r.d.IDs.Denied}, -1)
		case "refused":
			reason := guardReason(s.err)
			if expireWord.MatchString(reason) {
				return r.ExpireGuardHold(ctx, b, hold, reason)
			}
			stop(IssueRefused, "Guard refused the approved refund ("+refusalWords(s.err)+"): "+reason+". Nothing was refunded.", "blocked", "")
		case "no_good":
			stop(IssueFailed, "Guard did not take the approved refund and will not on a retry: "+s.why+". Nothing was refunded.", "failed", "")
		case "may_have_happened", "lost":
			released() // the call went out: Guard does not send an unapproved one
			if found := r.quietFind(ctx, paymentID, hold.Receipt); found != nil {
				finish(found.ID, s.why+"; the payments service's own list shows the refund, and it is not sent again")
				return nil
			}
			stop(IssueUnknown, s.why+". The approved refund may or may not have been made. It was NOT sent again. Check the payment gateway's own records for payment "+paymentID+"; if Guard holds it as uncertain, tell Guard what happened (POST /admin/intents/resolve).", "unconfirmed", "")
		case "not_sent":
			later(s.why)
		}
		return nil
	}
	resentID = resent.ID
	// the service took it: read back once; whatever the list shows, it is not sent again
	released()
	if after := r.quietFind(ctx, paymentID, hold.Receipt); after != nil {
		finish(after.ID, "")
		return nil
	}
	stop(IssueUnconfirmed, "the payments service accepted the approved refund, but its own list does not show it yet. It is NOT sent again", "unconfirmed", resentID)
	return nil
}

// /expire/iu: `\b` is not used, so the plain case-insensitive match is the same.
var expireWord = mustCI("expire")

// ExpireGuardHold: Guard's approval ran out before the owner answered (or before the approved call could be used). Nothing was refunded; the customer is told. But look first: a hold
// put back from a snapshot may have been approved and sent after that snapshot, and then the payments service's own list shows the refund. why "" is the default words.
func (r *Refunds) ExpireGuardHold(ctx context.Context, b RefundCase, hold *GuardHold, why string) error {
	if why == "" {
		why = "the owner did not answer before Guard's approval ran out"
	}
	if made := r.quietFind(ctx, hold.PaymentID, hold.Receipt); made != nil {
		r.dropHold(b, hold)
		r.madePost(b, hold.PaymentID, hold.AmountInr*100, made.ID, func(m map[string]string) {
			r.log(b, b.Customer(), "refund", "confirmed", pay(hold.PaymentID, hold.AmountInr), LogMore{Refs: merge(map[string]string{"paymentId": hold.PaymentID, "approval": hold.Approval, "refundId": made.ID}, m), Notes: "the hold's time ran out here, but the payments service's own list shows the refund: it was made. It is not sent again"})
		})
		r.d.TellCustomer(b, b.Customer(), []string{r.d.IDs.Approved}, hold.AmountInr*100)
		return nil
	}
	r.dropHold(b, hold)
	note := why + ". Nothing was refunded. A new request for payment " + hold.PaymentID + " has to be made by the builder."
	r.cancelPost(b, hold.PaymentID, "expired", func(m map[string]string) {
		r.log(b, b.Customer(), "refund", "failed", pay(hold.PaymentID, hold.AmountInr), LogMore{Refs: merge(map[string]string{"paymentId": hold.PaymentID, "approval": hold.Approval}, m), Notes: note})
	})
	r.raise(b, hold.PaymentID, IssueExpired, note, nil, "")
	r.d.TellCustomer(b, b.Customer(), []string{r.d.IDs.Expired}, hold.AmountInr*100)
	return nil
}

// Sweep is the clock's share of the work, refunds first, whatever state their case is in. A hold whose approval ran out is over; one the owner approved and that could not be sent yet is
// sent again; a refund that could not be sent at all is tried again. A hold nobody answered is NOT sent again: it just waits.
func (r *Refunds) Sweep(ctx context.Context, now int64) error {
	for _, b := range append([]RefundCase(nil), r.d.Cases()...) {
		for _, u := range append([]*UntoldRefund(nil), *b.Untold()...) {
			if u.RetryAtMs != nil && *u.RetryAtMs <= now {
				r.tellConfirmed(b, u)
			}
		}
		for _, p := range append([]Pending(nil), *b.Pending()...) {
			switch h := p.(type) {
			case *GuardHold:
				if h.ExpiresAtMs != nil && *h.ExpiresAtMs <= now {
					if err := r.ExpireGuardHold(ctx, b, h, ""); err != nil {
						return err
					}
				} else if h.Approved != nil && *h.Approved && h.RetryAtMs != nil && *h.RetryAtMs <= now {
					if err := r.ReleaseHeld(ctx, b, h); err != nil {
						return err
					}
				}
			case *RefundRetry:
				if h.RetryAtMs <= now {
					if err := r.RetryRefund(ctx, b, h); err != nil {
						return err
					}
				}
			}
		}
	}
	return nil
}

func mustCI(word string) *regexp.Regexp { return regexp.MustCompile("(?i)" + word) }

// OtherPending is a pending entry the refund code does not own (a template's own kinds): carried as it is, so a shop that goes back to the TypeScript runtime loses nothing.
type OtherPending struct {
	Kind string
	Raw  json.RawMessage
}

func (o *OtherPending) PendingKind() string          { return o.Kind }
func (o *OtherPending) MarshalJSON() ([]byte, error) { return o.Raw, nil }

// DecodePending reads a pending entry: a guard_hold and a refund_retry are modelled, anything else is kept raw.
func DecodePending(raw json.RawMessage) (Pending, error) {
	var k struct {
		Kind string `json:"kind"`
	}
	if err := json.Unmarshal(raw, &k); err != nil {
		return nil, err
	}
	switch k.Kind {
	case "guard_hold":
		h := &GuardHold{}
		return h, json.Unmarshal(raw, h)
	case "refund_retry":
		h := &RefundRetry{}
		return h, json.Unmarshal(raw, h)
	}
	return &OtherPending{Kind: k.Kind, Raw: append(json.RawMessage(nil), raw...)}, nil
}
