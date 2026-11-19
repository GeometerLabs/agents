// What every job that sends once shares: modules/messaging/send-once.ts's RETRY_AFTER_MS, MAX_TRIES and `nothingWasSent`, and the faults they read (modules/core/faults.ts ApiError,
// NotSentError, WindowClosedError, GuardUnavailableError). The intent queue in that file (Stock orders' purchase orders) is not part of this package: only the report job and the
// owner's morning line use the three shared numbers and the test, and the queue belongs to the Stock orders wave.
//
// The messaging stream's real error types do not exist yet, so the faults are small types here, and an adapter (the Bookings wave writes one) turns its provider's errors into
// them. An error counts as a refusal through the interface `HTTPStatus() int` too, so a type of its own with a status (a 4xx) needs no conversion.
package report

import "errors"

// RetryAfterMs is RETRY_AFTER_MS: after a refusal, an hour before the next try; MaxTries is MAX_TRIES: three tries in all.
const (
	RetryAfterMs int64 = 3_600_000
	MaxTries           = 3
)

// APIError is ApiError: the service answered with an error status.
type APIError struct {
	Status int
	Msg    string
}

func (e *APIError) Error() string   { return e.Msg }
func (e *APIError) HTTPStatus() int { return e.Status }

// NotSentError is NotSentError: nothing was sent (the connection was refused or the host is unknown). A timeout or a cut connection is NOT this: that call may have happened.
type NotSentError struct{ Msg string }

func (e *NotSentError) Error() string   { return e.Msg }
func (e *NotSentError) HTTPStatus() int { return 503 }

// WindowClosedError is WindowClosedError: WhatsApp refuses free-form text once the person's 24-hour window has closed (a 400).
type WindowClosedError struct{}

func (e *WindowClosedError) Error() string {
	return "The customer's 24-hour window is closed: send an approved template instead."
}
func (e *WindowClosedError) HTTPStatus() int { return 400 }

// GuardUnavailableError is GuardUnavailableError: Guard cannot decide, is busy, or cannot reach the service: nothing was sent.
type GuardUnavailableError struct {
	Status int
	Msg    string
}

func (e *GuardUnavailableError) Error() string   { return e.Msg }
func (e *GuardUnavailableError) HTTPStatus() int { return e.Status }

type statusFault interface{ HTTPStatus() int }

// NothingWasSent is nothingWasSent: did WhatsApp (or Guard in front of it) say no before anything was sent? Only then may the same message be sent again. A 5xx or a reply that is not
// understood can come after the message was taken, so those are never "nothing was sent".
func NothingWasSent(err error) bool {
	var notSent *NotSentError
	var unavailable *GuardUnavailableError
	if errors.As(err, &notSent) || errors.As(err, &unavailable) {
		return true
	}
	var s statusFault
	return errors.As(err, &s) && s.HTTPStatus() >= 400 && s.HTTPStatus() < 500
}
