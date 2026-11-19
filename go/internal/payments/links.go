package payments

// Making a payment link, the careful way: look first, write, read back (modules/payments/links.ts), for every template. A link is "made" only when the payments service's own list shows
// it. If the reply to a create was lost, the next try looks first, so a retry cannot make a second link. What a template decides is the reference (the booking, the student's fee)
// and the amount; the care is the same.

import (
	"context"

	"github.com/GeometerLabs/agents/go/internal/guard"
)

// Attempts is links.ts ATTEMPTS: look, try, read back; and once more if that did not settle it.
const Attempts = 2

// LinkRequest is what a template asks for. AmountPaise is the only amount this link may be for. MinPartialPaise nil is the default of 100.
type LinkRequest struct {
	Reference       string
	AmountPaise     int64
	Description     string
	AcceptPartial   bool
	MinPartialPaise *int64
}

// LinkResult: Link is nil when none could be made, with Error the last error's words. Suspended is set when Guard refused the link for the shop's licence (402): nothing was sent and it
// is not tried again.
type LinkResult struct {
	Link      *PaymentRequest
	Error     string
	Suspended *guard.GuardError
}

// open is a link for this reference and amount that is still open: the payments service's own list is what counts.
func open(amountPaise int64, links []PaymentRequest) *PaymentRequest {
	for i := range links {
		if links[i].Status != "cancelled" && links[i].Amount == amountPaise {
			return &links[i]
		}
	}
	return nil
}

// EnsureLink is ensureLink. An error that is neither a timeout nor an ApiError (a bug) is returned as the second value, as the TypeScript rethrows it.
func EnsureLink(ctx context.Context, p Payments, r LinkRequest) (LinkResult, error) {
	var lastErr string
	hasErr := false
	for attempt := 0; attempt < Attempts; attempt++ {
		err := func() error {
			list, err := p.ListRequests(ctx, ListQuery{ReferenceID: r.Reference}) // look first: a lost reply may have created it
			if err != nil {
				return err
			}
			if existing := open(r.AmountPaise, list); existing != nil {
				return &found{existing}
			}
			n := NewPaymentRequest{Amount: r.AmountPaise, ReferenceID: r.Reference, Description: r.Description}
			if r.AcceptPartial {
				min := int64(100)
				if r.MinPartialPaise != nil {
					min = *r.MinPartialPaise
				}
				n.PartPayments, n.MinFirstPayment = true, &min
			}
			if _, err := p.CreateRequest(ctx, n); err != nil {
				return err
			}
			after, err := p.ListRequests(ctx, ListQuery{ReferenceID: r.Reference}) // read back from the payments service's own list
			if err != nil {
				return err
			}
			if l := open(r.AmountPaise, after); l != nil {
				return &found{l}
			}
			return nil
		}()
		if f, ok := err.(*found); ok {
			return LinkResult{Link: f.link}, nil
		}
		if err != nil {
			if g, ok := guard.AsGuard(err); ok && g.Kind == guard.KindSuspended {
				return LinkResult{Error: g.Message, Suspended: g}, nil // never tried again: it stays refused until a newer lease
			}
			if _, api := guard.IsAPI(err); !api && !guard.IsTimeout(err) {
				return LinkResult{}, err
			}
			lastErr, hasErr = err.Error(), true
		}
	}
	list, err := p.ListRequests(ctx, ListQuery{ReferenceID: r.Reference})
	if err == nil {
		if l := open(r.AmountPaise, list); l != nil {
			return LinkResult{Link: l}, nil
		}
	}
	res := LinkResult{}
	if hasErr {
		res.Error = lastErr
	}
	return res, nil
}

type found struct{ link *PaymentRequest }

func (*found) Error() string { return "found" }
