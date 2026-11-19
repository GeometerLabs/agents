// The adapter from the books (internal/accounting) to the narrow Accounting poster that refunds uses, so a shop's refunds post their money facts to the same journal the
// owner's page, the accountant's files and the monthly report read. It lives here (payments depends on the books, never the other way round).
//
// post.ts THROWS when a line cannot be counted (a line not written as one entry, an amount that is not whole paise, a refused service id); the TypeScript step then saves nothing.
// The Accounting interface here has no error result, so the adapter does the same by panicking with a BooksError: the runtime's step runner recovers a panic in a step and
// saves nothing of it, exactly as it does for a thrown error.
package payments

import "github.com/GeometerLabs/agents/go/internal/accounting"

// BooksError is what a failed post panics with: the books' own sentence.
type BooksError struct{ Err error }

func (e BooksError) Error() string { return e.Err.Error() }
func (e BooksError) Unwrap() error { return e.Err }

// Books posts refunds' events to the shop's books.
type Books struct{ A accounting.Accounting }

// Post is Accounting.Post over accounting.Accounting.Post: the event is translated field for field, and `write` receives the money refs (empty for a repeat).
func (b Books) Post(e MoneyEvent, write func(money map[string]string)) {
	c := e.Case
	ev := accounting.MoneyEvent{Kind: accounting.MoneyKind(e.Kind), Case: &c, PaymentID: e.PaymentID, AmountPaise: e.AmountPaise, Method: accounting.Method(e.Method), Evidence: accounting.Evidence(e.Evidence), Why: e.Why}
	if e.Owed != "" {
		o := e.Owed
		ev.Owed = &o
	}
	if e.RefundID != "" {
		r := e.RefundID
		ev.RefundID = &r
	}
	if _, err := b.A.Post(ev, func(refs map[string]string) error { write(refs); return nil }); err != nil {
		panic(BooksError{err})
	}
}
