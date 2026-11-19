package bookings

// The services a Bookings step calls, as the small interfaces the domain code is written against (the brief of wave 2: the Guard wires, the in-memory stand-ins and the books are
// written by other streams, at the same time). Each mirrors, method for method, the TypeScript interface agent.ts calls, and the names the guards stream gives its Go packages
// (go/internal/calendar Calendar, go/internal/payments Payments, both on branch go-guards-19nov when this was written), so wiring them is a type alias and a constructor, not a
// rewrite: when a package lands on main, its port here becomes `type X = pkg.X` and its stand-in is handed in by cmd/bookings.
//
// Nothing here talks to a network or holds a key. A nil port is a service the shop does not have (no WhatsApp: `services: {}`; no Google Calendar: `calendar.module` "own"; a
// UPI shop: no payments Guard) or one not wired yet; the agent then answers runtime.Unported for the step that needs it, never a silent "done".

import "context"

// Ports are the services of one shop.
type Ports struct {
	Calendar  Calendar
	Payments  Payments
	Messaging Messaging
	Books     Books
}

// CalendarEvent is src/adapters/calendar.ts CalendarEvent (go/internal/calendar Event).
type CalendarEvent struct {
	ID            string
	Summary       string
	Start, End    int64
	Status        string // "tentative" (a hold) or "confirmed"
	BookingRef    string
	HoldExpiresAt *int64
}

// Calendar is src/adapters/calendar.ts Calendar.
type Calendar interface {
	Insert(ctx context.Context, e CalendarEvent) (CalendarEvent, error)
	Get(ctx context.Context, id string) (*CalendarEvent, error)
	List(ctx context.Context, from, to *int64, bookingRef *string) ([]CalendarEvent, error)
	Delete(ctx context.Context, id string) error
	Conflicts(ctx context.Context, start, end int64) ([]CalendarEvent, error)
}

// PaymentRequest is modules/payments/payments.ts PaymentRequest (a payment link).
type PaymentRequest struct {
	ID, ShortURL, ReferenceID, Status string
	AmountPaise, AmountPaidPaise      int64
	Payments                          []string
}

// Payments is modules/payments/payments.ts Payments, the calls agent.ts makes.
type Payments interface {
	CreateRequest(ctx context.Context, amountPaise int64, referenceID, description string) (PaymentRequest, error)
	FetchRequest(ctx context.Context, id string) (*PaymentRequest, error)
	ListRequests(ctx context.Context, referenceID string) ([]PaymentRequest, error)
	CancelRequest(ctx context.Context, id string) (PaymentRequest, error)
}

// Outgoing is one message as modules/messaging/messaging.ts sends it: text, a template, or interactive buttons or a list.
type Outgoing struct {
	To           string
	Text         string
	Template     string
	TemplateLang string
	Params       []string
	Interactive  any
}

// Messaging is modules/messaging/messaging.ts Messaging: send, and read a sent message back (the agent's "accepted" is that read-back).
type Messaging interface {
	Send(ctx context.Context, m Outgoing) (id string, err error)
	IsWindowOpen(ctx context.Context, phone string) (bool, error)
}

// Books is the shop's accounting as the agent posts to it (modules/accounting/post.ts): a money line's own fields, read back from the record.
type Books interface {
	Post(kind string, caseID string, amountPaise int64) error
}
