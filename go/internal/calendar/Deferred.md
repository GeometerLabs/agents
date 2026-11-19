# calendar: what was left, and why

- The wiring of `live/index.ts` (which services a shop has: payments gateway or none, Google Calendar or the own list, messaging) belongs to the Bookings runtime wave. Only the calendar part is here: `calendar.New(Config{...})` when `services.calendar` is set, `calendar.NewOwn(&store.OwnCalendar, now)` otherwise. The payments part is `go/internal/payments`, the messaging part the messaging stream.
- The agent-side behaviour that uses the calendar (`tryHold`, backfill of the own list into Google, reading back before saying "booked") is in the agent, not in this package.
- Free-form dates (V8's legacy parser) are not read. Google never sends them. If a stand-in ever did, the event is dropped, not guessed.
- A fractional `holdExpiresAt` reads as no hold (see Explanation.md).
- Time zone names are Go's; a case-insensitive or aliased name Intl accepts but Go rejects falls back to UTC midnight for an all-day event, the same fallback the TypeScript uses for a zone it rejects.
- No contract test of its own: the HTTP contract suite for Bookings (templates/commerce/bookings/contract) is what proves the runtime end to end once the Go runtime uses this package.
