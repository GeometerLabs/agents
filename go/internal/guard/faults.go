// Package guard is the shared core of every client that talks to a Guard (the Go twin of modules/core/faults.ts, http.ts and json.ts): the errors a call can end in, the one HTTP
// client that sends no key of its own, and the one place where a Guard's own decision (held, refused, outcome unknown, ...) is told apart from the service's reply. The payments,
// messaging and calendar clients are built on it, so every Bookings, Orders, Fees and Stock-orders runtime reads Guard's answers the same way.
//
// The TypeScript errors form a class tree (`instanceof`): every Guard error is an ApiError, a "settled by a person" conflict is also a conflict, a "denied by the approver" refusal is also a
// refusal. Go has no such tree, so this file keeps ONE GuardError with a Kind, and the predicates (IsRefused, IsConflict, ...) answer what `instanceof` answered. The code that sorts an
// error must test the specific kinds first, exactly as the TypeScript does (refunds.go sortRefundError).
package guard

import (
	"errors"
	"fmt"
	"regexp"
)

// TimeoutError: the call may or may not have happened, the reply never came back (faults.ts TimeoutError).
type TimeoutError struct{ What string }

func (e *TimeoutError) Error() string { return e.What + ": no reply (timed out)" }

// ApiError: the service answered with an error status (faults.ts ApiError).
type ApiError struct {
	Status  int
	Message string
}

func (e *ApiError) Error() string { return e.Message }

// NotSentError: the connection was refused or the host is unknown, nothing was sent (status 503). Code is Node's network error code (ECONNREFUSED, ENOTFOUND, EAI_AGAIN,
// EHOSTUNREACH, ENETUNREACH, ERR_INVALID_URL), which WaitsForGuard reads. A timeout or a cut connection is a TimeoutError, not this.
type NotSentError struct {
	Message string
	Code    string
}

func (e *NotSentError) Error() string { return e.Message }

// ConflictError: a normal answer (409) the agent handles, not a failure to retry (faults.ts ConflictError).
type ConflictError struct{ Message string }

func (e *ConflictError) Error() string { return e.Message }

// WindowClosedError: WhatsApp refuses free-form text once the customer's 24-hour window has closed (faults.ts WindowClosedError).
type WindowClosedError struct{}

func (e *WindowClosedError) Error() string {
	return "The customer's 24-hour window is closed: send an approved template instead."
}

// GuardInfo is the `guard` object of a Guard answer, as Guard sent it. Detail is whatever JSON Guard gave (nil and HasDetail false when the member was absent).
type GuardInfo struct {
	Decision   string // hold, deny, unknown
	Code       string // held_for_approval, refused_by_policy, conflict, unauthenticated, guard_unavailable, busy, provider_unreachable, outcome_unknown
	Sent       string // "no", or "unknown" for a lost answer
	Retry      string // after_approval, no, later, do_not_repeat
	ReasonCode string
	Reason     string
	HasReason  bool // `reason` was a string, even an empty one (TypeScript's `guard.reason ?? words`)
	Detail     any
	HasDetail  bool
}

// SentCall is the call as the adapter sent it. Body is the exact text that went out (HasBody false when there was none): a held call is sent again with these same bytes.
type SentCall struct {
	Method  string
	Path    string
	Body    string
	HasBody bool
}

// GuardKind says which of faults.ts's Guard error classes an error is.
type GuardKind int

const (
	KindGeneric         GuardKind = iota // GuardError itself: a decision this code does not know
	KindHeld                             // GuardHeldError (202)
	KindRefused                          // GuardRefusedError (403)
	KindDenied                           // GuardDeniedError: the owner said no (a refusal too)
	KindUnavailable                      // GuardUnavailableError
	KindOutcomeUnknown                   // GuardOutcomeUnknownError (504)
	KindUnauthenticated                  // GuardUnauthenticatedError
	KindConflict                         // GuardConflictError (409)
	KindAlreadyDone                      // GuardAlreadyDoneError: a person settled it (a conflict too)
	KindSuspended                        // GuardSuspendedError (402, the shop's licence)
)

// GuardError is every Guard error of faults.ts in one type. Only the fields of its Kind are set.
type GuardError struct {
	Kind    GuardKind
	Status  int
	Message string
	Guard   GuardInfo
	Call    SentCall

	// KindHeld: the approval id (nil when only a person at the server can resolve it) and when it ends.
	Approval    *string
	ExpiresAtMs *int64

	// KindRefused / KindDenied: "rule" or "limit", and the rule's or limit's id when the reason names one.
	RefusalKind string
	RuleID      string

	// KindDenied: the request that was denied, when it was denied, and when the identical call would be held and asked about again.
	DeniedApproval string
	DeniedAtMs     *int64
	UntilMs        *int64

	// KindUnavailable: Retry-After, in seconds.
	RetryAfterSeconds *float64

	// KindAlreadyDone: who settled it (`operator:<admin id>`) and Guard's record of the action.
	ConfirmedBy string
	Intent      string

	// KindSuspended: `wind_down` or `stopped`, and the operation held back.
	State     string
	Operation string
}

func (e *GuardError) Error() string { return e.Message }

// IsRefused is `instanceof GuardRefusedError` (a denial by the approver is one too).
func (e *GuardError) IsRefused() bool { return e.Kind == KindRefused || e.Kind == KindDenied }

// IsConflict is `instanceof GuardConflictError` (an "already done" is one too).
func (e *GuardError) IsConflict() bool { return e.Kind == KindConflict || e.Kind == KindAlreadyDone }

// DeniedRepeatMs is how long Guard refuses the identical call after a person denied it (faults.ts DENIED_REPEAT_MS): 24 hours.
const DeniedRepeatMs = 24 * 3_600_000

// AsGuard returns the GuardError in err's chain, if any.
func AsGuard(err error) (*GuardError, bool) {
	var g *GuardError
	if errors.As(err, &g) {
		return g, true
	}
	return nil, false
}

// IsTimeout is `instanceof TimeoutError`.
func IsTimeout(err error) bool { var t *TimeoutError; return errors.As(err, &t) }

// IsNotSent is `instanceof NotSentError`.
func IsNotSent(err error) bool { var t *NotSentError; return errors.As(err, &t) }

// IsAPI is `instanceof ApiError`: every ApiError, NotSentError, ConflictError, WindowClosedError and GuardError is one. It reports the status the TypeScript error carries.
func IsAPI(err error) (status int, ok bool) {
	var a *ApiError
	var n *NotSentError
	var c *ConflictError
	var w *WindowClosedError
	var g *GuardError
	switch {
	case errors.As(err, &a):
		return a.Status, true
	case errors.As(err, &n):
		return 503, true
	case errors.As(err, &c):
		return 409, true
	case errors.As(err, &w):
		return 400, true
	case errors.As(err, &g):
		return g.Status, true
	}
	return 0, false
}

// Name is the TypeScript error's `name` (what the vectors compare), or "Error" for anything else.
func Name(err error) string {
	var a *ApiError
	var n *NotSentError
	var c *ConflictError
	var w *WindowClosedError
	var g *GuardError
	var t *TimeoutError
	switch {
	case errors.As(err, &t):
		return "TimeoutError"
	case errors.As(err, &n):
		return "NotSentError"
	case errors.As(err, &c):
		return "ConflictError"
	case errors.As(err, &w):
		return "WindowClosedError"
	case errors.As(err, &g):
		switch g.Kind {
		case KindHeld:
			return "GuardHeldError"
		case KindRefused:
			return "GuardRefusedError"
		case KindDenied:
			return "GuardDeniedError"
		case KindUnavailable:
			return "GuardUnavailableError"
		case KindOutcomeUnknown:
			return "GuardOutcomeUnknownError"
		case KindUnauthenticated:
			return "GuardUnauthenticatedError"
		case KindConflict:
			return "GuardConflictError"
		case KindAlreadyDone:
			return "GuardAlreadyDoneError"
		case KindSuspended:
			return "GuardSuspendedError"
		}
		return "GuardError"
	case errors.As(err, &a):
		return "ApiError"
	}
	return "Error"
}

// Apif is an ApiError with a formatted message.
func Apif(status int, format string, args ...any) *ApiError {
	return &ApiError{Status: status, Message: fmt.Sprintf(format, args...)}
}

// MayHaveHappened: the call may have gone through, no reply came back or Guard said the outcome is unknown (faults.ts mayHaveHappened).
func MayHaveHappened(err error) bool {
	if IsTimeout(err) {
		return true
	}
	g, ok := AsGuard(err)
	return ok && g.Kind == KindOutcomeUnknown
}

// killSwitch: Guard's reason when its kill switch is on. `\b` is ASCII in JavaScript and in RE2, so the same.
var killSwitch = regexp.MustCompile(`(?i)^kill switch engaged\b`)

// WaitsForGuard: does this failure keep a saved task waiting for its Guard instead of ending now? Only "the Guard could not be reached or is not ready, and nothing was sent" does.
// The table is faults.ts waitsForGuard's: a NotSentError waits unless its address was wrong (ERR_INVALID_URL); a GuardUnavailableError waits unless the provider is what is away
// (provider_unreachable) or a person stopped the shop on purpose (the kill switch); everything else never waits.
func WaitsForGuard(err error) bool {
	var n *NotSentError
	if errors.As(err, &n) {
		return n.Code != "ERR_INVALID_URL"
	}
	if g, ok := AsGuard(err); ok && g.Kind == KindUnavailable {
		return g.Guard.Code != "provider_unreachable" && !killSwitch.MatchString(g.Guard.Reason)
	}
	return false
}
