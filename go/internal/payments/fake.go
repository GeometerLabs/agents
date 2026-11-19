package payments

// The in-memory stand-in gateway a "fakes" shop uses instead of the payments Guard (modules/payments/payments.ts createFakePayments, without its Guard model and fault plans, which
// only the TypeScript unit tests drive): the same ids (req_N, pmt_N, rfnd... as `rfd_N`, evt_N share one counter), the same pay links, the same part-payment rules, the same events.
// Its store is the record the agent reads back: "a deposit counts when the payment record shows it". Safe for one goroutine at a time per call (a mutex guards the store).

import (
	"context"
	"strconv"
	"sync"

	"github.com/GeometerLabs/agents/go/internal/guard"
)

// Fake is the stand-in Payments. Events is every event it has emitted, in order; the harness decides when (and how often) to deliver them.
type Fake struct {
	mu      sync.Mutex
	now     func() int64
	unique  bool
	seq     int
	links   map[string]*PaymentRequest
	order   []string
	refunds []Refund
	Events  []PaymentEvent
}

var _ Payments = (*Fake)(nil)

// NewFake is createFakePayments(clock) with the default of refusing a second link with the same reference_id, as a provider that dedupes would. now is the clock in milliseconds.
func NewFake(now func() int64) *Fake {
	return &Fake{now: now, unique: true, seq: 1, links: map[string]*PaymentRequest{}, Events: []PaymentEvent{}}
}

func (f *Fake) nextID(prefix string) string {
	id := prefix + "_" + strconv.Itoa(f.seq)
	f.seq++
	return id
}
func (f *Fake) seconds() int64 { return f.now() / 1000 }

func copyLink(l *PaymentRequest) PaymentRequest {
	c := *l
	c.Payments = append([]Payment{}, l.Payments...)
	if l.MinFirstPayment != nil {
		m := *l.MinFirstPayment
		c.MinFirstPayment = &m
	}
	return c
}

func (f *Fake) emit(event string, p EventPayload) {
	f.Events = append(f.Events, PaymentEvent{ID: f.nextID("evt"), Event: event, CreatedAt: f.seconds(), Payload: p})
}

func (f *Fake) findPayment(id string) *Payment {
	for _, k := range f.order {
		l := f.links[k]
		for i := range l.Payments {
			if l.Payments[i].ID == id {
				return &l.Payments[i]
			}
		}
	}
	return nil
}

func (f *Fake) CreateRequest(_ context.Context, r NewPaymentRequest) (PaymentRequest, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.unique {
		for _, k := range f.order {
			if f.links[k].ReferenceID == r.ReferenceID {
				return PaymentRequest{}, &guard.ApiError{Status: 400, Message: "A payment link with reference_id " + r.ReferenceID + " already exists."}
			}
		}
	}
	id := f.nextID("req")
	l := &PaymentRequest{ID: id, ReferenceID: r.ReferenceID, Amount: r.Amount, Currency: "INR", Description: r.Description, Status: "created", PayURL: "https://pay.example/" + id, Payments: []Payment{}, CreatedAt: f.seconds()}
	if r.PartPayments {
		min := int64(100)
		if r.MinFirstPayment != nil {
			min = *r.MinFirstPayment
		}
		l.PartPayments, l.MinFirstPayment = true, &min
	}
	f.links[id] = l
	f.order = append(f.order, id)
	return copyLink(l), nil
}

func (f *Fake) FetchRequest(_ context.Context, id string) (*PaymentRequest, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if l, ok := f.links[id]; ok {
		c := copyLink(l)
		return &c, nil
	}
	return nil, nil
}

func (f *Fake) ListRequests(_ context.Context, q ListQuery) ([]PaymentRequest, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := []PaymentRequest{}
	for _, k := range f.order {
		l := f.links[k]
		if q.ReferenceID != "" && l.ReferenceID != q.ReferenceID {
			continue
		}
		if q.PaymentID != "" {
			has := false
			for _, p := range l.Payments {
				has = has || p.ID == q.PaymentID
			}
			if !has {
				continue
			}
		}
		out = append(out, copyLink(l))
	}
	return out, nil
}

func (f *Fake) CancelRequest(_ context.Context, id string) (PaymentRequest, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	l, ok := f.links[id]
	if !ok {
		return PaymentRequest{}, &guard.ApiError{Status: 404, Message: "No such payment link."}
	}
	if l.Status == "created" {
		l.Status = "cancelled"
	}
	return copyLink(l), nil
}

func (f *Fake) FetchPayment(_ context.Context, id string) (*Payment, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if p := f.findPayment(id); p != nil {
		c := *p
		return &c, nil
	}
	return nil, nil
}

func (f *Fake) refundCall(body RefundRequest, paymentID string) (Refund, error) {
	p := f.findPayment(paymentID)
	if p == nil {
		return Refund{}, &guard.ApiError{Status: 404, Message: "No such payment."}
	}
	if body.Amount <= 0 {
		return Refund{}, &guard.ApiError{Status: 400, Message: "The refund amount must be a positive whole number of paise."}
	}
	if body.Amount > p.Amount-p.AmountRefunded {
		return Refund{}, &guard.ApiError{Status: 400, Message: "The refund is more than what is left on the payment."}
	}
	p.AmountRefunded += body.Amount
	r := Refund{ID: f.nextID("rfd"), PaymentID: paymentID, Amount: body.Amount, Status: "processed", CreatedAt: f.seconds()}
	if body.HasReceipt {
		rc := body.Receipt
		r.Receipt = &rc
	}
	f.refunds = append(f.refunds, r)
	f.emit(EventRefundDone, EventPayload{Refund: &EventRefund{ID: r.ID, PaymentID: paymentID}})
	return r, nil
}

func (f *Fake) Refund(_ context.Context, paymentID string, r RefundRequest) (Refund, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.refundCall(r, paymentID)
}

// ResendRefund reads the bytes it is given the way the service would: {"amount": n, "receipt": s}.
func (f *Fake) ResendRefund(_ context.Context, paymentID, body string, _ []string) (Refund, error) {
	v, err := guard.Decode(body)
	if err != nil {
		return Refund{}, err
	}
	o, _ := guard.IsObject(v)
	amount, _ := guard.Int(o["amount"])
	r := RefundRequest{Amount: amount}
	if s, ok := guard.Str(o["receipt"]); ok {
		r.Receipt, r.HasReceipt = s, true
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.refundCall(r, paymentID)
}

func (f *Fake) ListRefunds(_ context.Context, paymentID string) ([]Refund, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := []Refund{}
	for _, r := range f.refunds {
		if r.PaymentID == paymentID {
			out = append(out, r)
		}
	}
	return out, nil
}

// CustomerPays is the customer paying the link (they can do it twice, from two phones). amount 0 is the whole of what is left (or the whole link). Emits events.
func (f *Fake) CustomerPays(linkID string, amount int64) (Payment, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	l, ok := f.links[linkID]
	if !ok {
		return Payment{}, &guard.ApiError{Status: 404, Message: "No such payment link."}
	}
	if l.Status == "cancelled" {
		return Payment{}, &guard.ApiError{Status: 400, Message: "This payment link is cancelled."}
	}
	if l.PartPayments {
		left := l.Amount - l.AmountPaid
		a := amount
		if a == 0 {
			a = left
		}
		if left <= 0 {
			return Payment{}, &guard.ApiError{Status: 400, Message: "This payment link is already paid."}
		}
		floor := *l.MinFirstPayment
		if left < floor {
			floor = left
		}
		if a < floor || a > left {
			return Payment{}, &guard.ApiError{Status: 400, Message: "The amount is not allowed for this payment link."}
		}
	}
	paid := amount
	if paid == 0 {
		paid = l.Amount
		if l.PartPayments {
			paid = l.Amount - l.AmountPaid
		}
	}
	p := Payment{ID: f.nextID("pmt"), RequestID: linkID, Amount: paid, Currency: "INR", Status: "received", CreatedAt: f.seconds()}
	l.Payments = append(l.Payments, p)
	l.AmountPaid += p.Amount
	f.emit(EventPaymentReceived, EventPayload{Payment: &EventPayment{ID: p.ID, RequestID: linkID}})
	if l.PartPayments {
		was := l.Status
		if l.AmountPaid >= l.Amount {
			l.Status = "paid"
		} else {
			l.Status = "partially_paid"
		}
		if l.Status == "paid" && was != "paid" {
			f.emit(EventRequestPaid, EventPayload{Request: &EventRequest{ID: l.ID, ReferenceID: l.ReferenceID}, Payment: &EventPayment{ID: p.ID, RequestID: linkID}})
		}
	} else if l.Status == "created" {
		l.Status = "paid" // the link counts as paid on the first payment; a second payment still lands (two phones)
		f.emit(EventRequestPaid, EventPayload{Request: &EventRequest{ID: l.ID, ReferenceID: l.ReferenceID}, Payment: &EventPayment{ID: p.ID, RequestID: linkID}})
	}
	return p, nil
}

// Links is every link, in the order made.
func (f *Fake) Links() []PaymentRequest {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := []PaymentRequest{}
	for _, k := range f.order {
		out = append(out, copyLink(f.links[k]))
	}
	return out
}

// AllRefunds is every refund made.
func (f *Fake) AllRefunds() []Refund {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]Refund{}, f.refunds...)
}
