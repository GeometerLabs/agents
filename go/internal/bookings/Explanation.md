# internal/bookings: how the Go Bookings runtime is built

## One runtime, a template part

The listings shop was the first runtime in Go (wave 1). Its package, `internal/runtime`, already did what every shop shares: the queue saved before the 200, the
one-at-a-time step saved whole or not at all, the record, the owner's sign-in, passkeys, phones, push, the limits page and the owner's file. Wave 2 did not copy any of
it. `internal/runtime/template.go` is the seam, the Go twin of `modules/runtime/core.ts` `RuntimeKit` and `ChannelKit`: a template says how its store is read and written, gives
the agent for one step, counts its cases and refunds, finds a held refund, and answers its channel's reads. A runtime made with no `Kit` is the listings shop exactly as before
(the listings contract on Go passed 201 of 201 before and after the seam). `internal/runtime` never imports a template; this package imports it.

What the shared runtime gained for a template (each copied from the TypeScript, and none used by the listings shop):

* `events.go`: the inbox's events (`message`, `message_status`, `payment_event`, `approval_decision`), the panel's recovery and the front's channel events, checked whole with the
  TypeScript's sentences, and the task keys (`message:<id>`, `channel_book:<hash>`, `chat_message:<hash>:<id>` ...), so a task saved by one runtime is a duplicate for the other.
* `statuses.go`: WhatsApp's delivery reports written against the line that sent the message (`modules/messaging/statuses.ts`); the agent never sees one.
* `kit.go`: the step for a template, a task parked while its Guard is down and run once more when the wait is over (`tasks.ts`, `guard-wait.ts`), a task that ends failed
  with its to-do line (`core.ts endTask`, keeping the id counters of the thrown-away step), the status with the template's cases and refunds, and events saved with the 24-hour
  WhatsApp window (`store.ts saveEvents`).
* `kitserver.go`: the routes a template adds (`/internal/events`, `/internal/recover`, `/internal/refund-context`, the channel's events, offer, request, owner, documents,
  accounting), in http.ts's order of checks; the listings and Fees routes answer 404.
* `store`: parked tasks (`waiting_on`, `retry_at`), a task ended failed with its line, the window table, a task's state by key: the columns were always in the file.

## The store, field for field

`state.go` reads the snapshot's members in the codec's order (`server/snapshot.ts`): `bookings` and `customers` as [key, value] pairs, the two seen-sets, the counter, then the
optional blocks. A booking and a customer are typed for what this runtime reads, and every other member is kept raw in its place (`Extra`), so a field the TypeScript writes and
the Go runtime does not model goes back exactly as it came. The blocks not modelled yet (`upi`, `ownCalendar`, `calendarState`, `channel`) are kept whole. `nextBooking` moves on
by 100000 after a restore and is kept where a thrown-away step left it, so a booking id is never given out twice.

## The ports

The services a step calls (calendar, payments, messaging, books) are the other streams' packages, typed with the TypeScript's method sets there; this package does not
define a second copy of their interfaces (`ports.go` says how they will be handed in). Until they land, a step that needs one ends with `runtime.Unported` and its sentence.
See Deferred.md.
