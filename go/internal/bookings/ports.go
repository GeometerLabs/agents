package bookings

// The services a Bookings step calls. They are NOT defined here: the guards stream (branch go-guards-19nov) writes them as Go packages with the TypeScript's method sets and wire
// structs (go/internal/calendar `Calendar`, go/internal/payments `Payments`; messaging and the in-memory stand-ins are still to come there), and the books stream writes the books
// (go/internal/accounting, go-books-19nov). An interface typed here first would be a second copy of theirs ("no duplicates", decision 61), so no domain code of this package calls
// a service yet: every step that would ends its task with runtime.Unported and its sentence (agent.go, Deferred.md).
//
// When those packages are on main, Ports gains one field per service, typed with THEIR interfaces (calendar.Calendar, payments.Payments, the messaging package's Messaging, the
// books' poster), cmd/bookings hands in the live client or the stand-in by runtime.json's mode, and a nil field stays "this shop has no such service" (no WhatsApp: `services: {}`;
// no Google Calendar: `calendar.module` "own"; a UPI shop: no payments Guard).

// Ports are the services of one shop (empty until the service packages are on main; see above).
type Ports struct{}
