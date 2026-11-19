package bookings

// The services a Bookings step calls. They are NOT defined here: they are the shared packages, on this branch since the merge of main (19 Nov): go/internal/calendar `Calendar`,
// go/internal/payments `Payments` (and its stand-in `NewFake`), go/internal/messaging `Messaging` (and `NewStandIn`), and the books (go/internal/accounting, report,
// bookingsreport). An interface typed here would be a second copy of theirs ("no duplicates", decision 61). What is missing is the WIRING (TRIAL.md, "What is left of wave 2"):
// Ports gains one field per service typed with their interfaces, cmd/bookings hands in the live client or the stand-in by runtime.json's mode, a nil field stays "this shop has no
// such service" (no WhatsApp: `services: {}`; no Google Calendar: `calendar.module` "own"; a UPI shop: no payments Guard), and agent.ts's steps are ported over them. Until then
// every step that would call one ends its task with runtime.Unported and its sentence (agent.go, Deferred.md).

// Ports are the services of one shop (empty until they are wired; see above).
type Ports struct{}
