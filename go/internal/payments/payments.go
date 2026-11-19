// Package payments is the Go twin of modules/payments (B71): a payment request (a link), the payments made on it, refunds and three events, the same for every provider. A provider's
// package (payments/razorpay) maps its own API onto this, and says what it can do (Capabilities), so a runtime asks that instead of branching on a provider's name. The Bookings, Orders,
// Fees and Stock-orders runtimes all call these interfaces and can fake them.
//
// Amounts are integer paise (int64, never a float) and times epoch seconds, snake_case JSON as on the wire; nothing here is any one provider's word. The structs marshal to exactly the
// JSON the TypeScript objects have (a member the TypeScript leaves out is omitted), so the vectors compare them as they are.
package payments

import "context"

// Capabilities is what a provider's module can do (payments.ts PaymentCapabilities): a runtime asks these, never the provider's name.
type Capabilities struct {
	ConfirmsAutomatically bool // the provider says a payment happened (a signed webhook, read back); false: a person marks it (UPI: the owner)
	RefundsAutomatically  bool // a refund is sent through the provider behind Guard; false: the owner pays back by hand
	TakesPartPayments     bool
	Cancels               bool
	ReadsBack             bool // the provider's own record can be read
	ReadsSettlements      bool
}

// Payment is money that arrived (a payment only started, or failed, is never listed).
type Payment struct {
	ID             string `json:"id"`
	RequestID      string `json:"request_id"`
	Amount         int64  `json:"amount"` // paise
	Currency       string `json:"currency"`
	Status         string `json:"status"` // "received"
	AmountRefunded int64  `json:"amount_refunded"`
	CreatedAt      int64  `json:"created_at"`
}

// PaymentRequest is a payment link. Status is created, partially_paid, paid or cancelled.
type PaymentRequest struct {
	ID          string    `json:"id"`
	ReferenceID string    `json:"reference_id"` // ours: the booking id
	Amount      int64     `json:"amount"`
	Currency    string    `json:"currency"`
	Description string    `json:"description"`
	Status      string    `json:"status"`
	PayURL      string    `json:"pay_url"`
	AmountPaid  int64     `json:"amount_paid"`
	Payments    []Payment `json:"payments"`
	CreatedAt   int64     `json:"created_at"`
	// PartPayments is set on a request that takes part payments, with the least the first may be (MinFirstPayment, which can be 0). Both are left out on any other request.
	PartPayments    bool   `json:"part_payments,omitempty"`
	MinFirstPayment *int64 `json:"min_first_payment,omitempty"`
}

// Refund: "pending" (accepted, not yet paid out), "processed" (paid out). A failed one is only ever a reply and is never listed.
type Refund struct {
	ID        string  `json:"id"`
	PaymentID string  `json:"payment_id"`
	Amount    int64   `json:"amount"`
	Status    string  `json:"status"`
	Receipt   *string `json:"receipt,omitempty"`
	CreatedAt int64   `json:"created_at"`
	// Replayed: Guard answered from its record; this is the first reply to the same refund and nothing was sent again.
	Replayed bool `json:"replayed,omitempty"`
}

// Payment event names (payments.ts PaymentEventName).
const (
	EventRequestPaid     = "request.paid"
	EventPaymentReceived = "payment.received"
	EventRefundDone      = "refund.done"
)

// EventRequest, EventPayment and EventRefund are the three members of an event's payload.
type EventRequest struct {
	ID          string `json:"id"`
	ReferenceID string `json:"reference_id"`
}
type EventPayment struct {
	ID        string `json:"id"`
	RequestID string `json:"request_id,omitempty"` // may be missing on a payment.received: the request is then found by the payment id
}
type EventRefund struct {
	ID        string `json:"id"`
	PaymentID string `json:"payment_id"`
}

// EventPayload holds what an event names.
type EventPayload struct {
	Request *EventRequest `json:"request,omitempty"`
	Payment *EventPayment `json:"payment,omitempty"`
	Refund  *EventRefund  `json:"refund,omitempty"`
}

// PaymentEvent is a webhook read into the neutral shape. The body is a snapshot: the agent re-fetches before it trusts it.
type PaymentEvent struct {
	ID        string       `json:"id"`
	Event     string       `json:"event"`
	CreatedAt int64        `json:"created_at"`
	Payload   EventPayload `json:"payload"`
}

// SettlementRow is one row of a provider's settlement report. `Fee` and `Tax` are exactly what the provider's row says; whether Fee already holds Tax is for the books to check.
type SettlementRow struct {
	EntityID     string  `json:"entityId"`
	Type         string  `json:"type"` // payment, refund, transfer, adjustment, other
	PaymentID    *string `json:"paymentId"`
	Amount       int64   `json:"amount"`
	Fee          int64   `json:"fee"`
	Tax          int64   `json:"tax"`
	Debit        int64   `json:"debit"`
	Credit       int64   `json:"credit"`
	OnHold       bool    `json:"onHold"`
	Settled      bool    `json:"settled"`
	SettlementID *string `json:"settlementId"`
	UTR          *string `json:"utr"`
	SettledAt    *int64  `json:"settledAt"`
}

// NewPaymentRequest is what a link is made from. PartPayments with MinFirstPayment (nil: the default of 100 paise).
type NewPaymentRequest struct {
	Amount          int64
	ReferenceID     string
	Description     string
	PartPayments    bool
	MinFirstPayment *int64
}

// ListQuery is the filter of ListRequests; an empty string is "not given" (TypeScript's undefined).
type ListQuery struct{ ReferenceID, PaymentID string }

// RefundRequest asks for part or all of a payment. Receipt "" with HasReceipt false is TypeScript's undefined (left out of the body). RequestedBy are Guard's approver ids, sent in
// Geo-Requested-By so the relay never asks them to approve their own request (B37).
type RefundRequest struct {
	Amount      int64
	Receipt     string
	HasReceipt  bool
	RequestedBy []string
}

// Payments is what every runtime calls. A refund through a Guard above the owner's limit is not done: it returns a *guard.GuardError of KindHeld (HTTP 202), carrying the exact bytes it
// was sent with in Call.Body. Methods that look something up return a nil pointer when the provider has no such thing.
type Payments interface {
	CreateRequest(ctx context.Context, r NewPaymentRequest) (PaymentRequest, error)
	FetchRequest(ctx context.Context, id string) (*PaymentRequest, error)
	ListRequests(ctx context.Context, q ListQuery) ([]PaymentRequest, error)
	CancelRequest(ctx context.Context, id string) (PaymentRequest, error)
	FetchPayment(ctx context.Context, id string) (*Payment, error)
	Refund(ctx context.Context, paymentID string, r RefundRequest) (Refund, error)
	// ResendRefund sends a refund Guard held again with those exact bytes (Call.Body of the held error). Only after the owner approved it.
	ResendRefund(ctx context.Context, paymentID, body string, requestedBy []string) (Refund, error)
	ListRefunds(ctx context.Context, paymentID string) ([]Refund, error)
}

// Day is a calendar day for the settlement read.
type Day struct{ Year, Month, Day int }

// SettlementReader is the optional part of a provider whose Capabilities say ReadsSettlements: every row the provider settled on one day, however many pages it took. PageSize 0 is the
// provider's own default.
type SettlementReader interface {
	ReadSettlements(ctx context.Context, day Day, pageSize int) ([]SettlementRow, error)
}
