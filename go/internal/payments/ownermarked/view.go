// The ledger as a payments.Payments: modules/payments/owner-marked/ledger.ts `markedPayments` and `noGateway`. It shows the requests and the owner's marks in the neutral shape
// (internal/payments), so a template's "look first, write, read back" and "a payment counts when the payment record shows it" work unchanged. `Refund` and `ResendRefund` fail with
// OwnerPaysError: the owner pays refunds (OweRefund), and a template routes refunds there when the module cannot refund by itself; reaching them is a bug, so it is loud.
//
// Where Go differs: the TypeScript's methods are async and throw; these take a context (unused: nothing here waits) and return an error. The TypeScript names the method in a
// NoGateway error (`"createRequest" cannot be called`): the Go method names are mapped back to the TypeScript's camelCase so the words are the same.
package ownermarked

import (
	"context"
	"fmt"

	"github.com/GeometerLabs/agents/go/internal/payments"
)

// OwnerPaysError is ledger.ts OwnerPaysError: what an owner-marked module cannot do, said in plain words.
type OwnerPaysError struct{ Msg string }

func (e *OwnerPaysError) Error() string { return e.Msg }

// View is markedPayments(state, payLink, clock): the Payments over a ledger. Now is the clock (epoch milliseconds); Codes draws the owner's codes.
type View struct {
	State   *State
	PayLink PayLink
	Now     func() int64
	Codes   Codes
}

var _ payments.Payments = View{}

func asPayment(s *State, r *MarkedRequest, m OwnerMark) payments.Payment {
	return payments.Payment{ID: m.ID, RequestID: r.ID, Amount: m.AmountPaise, Currency: "INR", Status: "received", AmountRefunded: OwedOn(s, m.ID), CreatedAt: floorSeconds(m.AtMs)}
}

func asLink(s *State, r *MarkedRequest) payments.PaymentRequest {
	pays := make([]payments.Payment, len(r.Marks))
	for i, m := range r.Marks {
		pays[i] = asPayment(s, r, m)
	}
	out := payments.PaymentRequest{ID: r.ID, ReferenceID: r.Reference, Amount: r.AmountPaise, Currency: "INR", Description: r.Description, Status: r.Status, PayURL: r.Link,
		AmountPaid: paidOf(r), Payments: pays, CreatedAt: floorSeconds(r.CreatedAtMs)}
	if r.AcceptPartial {
		min := int64(100)
		out.PartPayments, out.MinFirstPayment = true, &min
	}
	return out
}

func (v View) CreateRequest(_ context.Context, r payments.NewPaymentRequest) (payments.PaymentRequest, error) {
	req, err := OpenRequest(v.State, v.PayLink, NewRequest{AmountPaise: r.Amount, Reference: r.ReferenceID, Description: r.Description, PartPayments: r.PartPayments}, v.Now(), v.Codes)
	if err != nil {
		return payments.PaymentRequest{}, err
	}
	return asLink(v.State, req), nil
}

func (v View) find(id string) *MarkedRequest {
	for _, r := range v.State.Requests {
		if r.ID == id {
			return r
		}
	}
	return nil
}

func (v View) FetchRequest(_ context.Context, id string) (*payments.PaymentRequest, error) {
	r := v.find(id)
	if r == nil {
		return nil, nil
	}
	l := asLink(v.State, r)
	return &l, nil
}

func (v View) ListRequests(_ context.Context, q payments.ListQuery) ([]payments.PaymentRequest, error) {
	out := []payments.PaymentRequest{}
	for _, r := range v.State.Requests {
		if q.ReferenceID != "" && r.Reference != q.ReferenceID {
			continue
		}
		if q.PaymentID != "" {
			hit := false
			for _, m := range r.Marks {
				hit = hit || m.ID == q.PaymentID
			}
			if !hit {
				continue
			}
		}
		out = append(out, asLink(v.State, r))
	}
	return out, nil
}

func (v View) CancelRequest(_ context.Context, id string) (payments.PaymentRequest, error) {
	r := v.find(id)
	if r == nil {
		return payments.PaymentRequest{}, &OwnerPaysError{fmt.Sprintf("No request %s.", id)}
	}
	CloseRequest(r, v.Now())
	return asLink(v.State, r), nil
}

func (v View) FetchPayment(_ context.Context, id string) (*payments.Payment, error) {
	r := RequestOfMark(v.State, id)
	if r == nil {
		return nil, nil
	}
	for _, m := range r.Marks {
		if m.ID == id {
			p := asPayment(v.State, r, m)
			return &p, nil
		}
	}
	return nil, nil
}

func (v View) Refund(context.Context, string, payments.RefundRequest) (payments.Refund, error) {
	return payments.Refund{}, &OwnerPaysError{"Here the agent never sends a refund: the owner pays it from their own payment app, and the agent tracks it (oweRefund)."}
}

func (v View) ResendRefund(context.Context, string, string, []string) (payments.Refund, error) {
	return payments.Refund{}, &OwnerPaysError{"There is no held refund to send again: the owner pays refunds."}
}

func (v View) ListRefunds(_ context.Context, paymentID string) ([]payments.Refund, error) {
	out := []payments.Refund{}
	for _, r := range v.State.Refunds {
		if r.PaymentID != paymentID || r.State == RefundKept {
			continue
		}
		status := "pending"
		if r.State == RefundDone {
			status = "processed"
		}
		receipt := r.CaseID + ":" + r.PaymentID
		out = append(out, payments.Refund{ID: r.ID, PaymentID: r.PaymentID, Amount: r.AmountPaise, Status: status, Receipt: &receipt, CreatedAt: floorSeconds(r.OwedAtMs)})
	}
	return out, nil
}

// NoGateway is `noGateway`: the Payments an owner-marked shop's agent is handed from outside. Any call is a bug (a gateway path reached on a shop with no gateway), and it says so.
var NoGateway payments.Payments = noGateway{}

type noGateway struct{}

func (noGateway) no(name string) error {
	return &OwnerPaysError{fmt.Sprintf("This shop's payments are marked paid by the owner: it has no gateway account, so %q cannot be called.", name)}
}
func (n noGateway) CreateRequest(context.Context, payments.NewPaymentRequest) (payments.PaymentRequest, error) {
	return payments.PaymentRequest{}, n.no("createRequest")
}
func (n noGateway) FetchRequest(context.Context, string) (*payments.PaymentRequest, error) {
	return nil, n.no("fetchRequest")
}
func (n noGateway) ListRequests(context.Context, payments.ListQuery) ([]payments.PaymentRequest, error) {
	return nil, n.no("listRequests")
}
func (n noGateway) CancelRequest(context.Context, string) (payments.PaymentRequest, error) {
	return payments.PaymentRequest{}, n.no("cancelRequest")
}
func (n noGateway) FetchPayment(context.Context, string) (*payments.Payment, error) {
	return nil, n.no("fetchPayment")
}
func (n noGateway) Refund(context.Context, string, payments.RefundRequest) (payments.Refund, error) {
	return payments.Refund{}, n.no("refund")
}
func (n noGateway) ResendRefund(context.Context, string, string, []string) (payments.Refund, error) {
	return payments.Refund{}, n.no("resendRefund")
}
func (n noGateway) ListRefunds(context.Context, string) ([]payments.Refund, error) {
	return nil, n.no("listRefunds")
}
