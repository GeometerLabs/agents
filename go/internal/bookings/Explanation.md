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

## Reading a customer's message (slice 1 of the second part)

A customer's words are read cheapest first by the shared router (`understanding.Router`), as `src/adapters/understanding.ts` does, with Bookings' reading (`reading.go`) given to it:

* **The rules** (`parser.go`, rule-parser.ts `parseIntent`). The readers every template shares are in the shared packages: a date and a time of day (`language/dates.go`
  `FindDatePhrase`, `FindTimePhrase`, `BlankWrittenDate`), STOP, a trick, the language and a price (`understanding/rules.go`). Only Bookings' own part is here: a service by its
  names (the longest name wins), then reschedule, cancel, book, a short no or yes, a greeting, in the TypeScript's order. Every fixed pattern is the TypeScript's own: the shared
  ones in `language/patterns.json` (`go/scripts/gen_patterns.ts`), Bookings' cancel, reschedule and book in `reading.json` (`go/scripts/gen_bookings_reading.ts`). Only a
  service's names, which a shop gives at run time, are built here, with `language.WordRe`, whose sources are proved equal to dates.ts `wordRe`.
* **When the rules are sure** (`Sure`, reading.ts `rulesAreSure`) no model is asked: STOP, yes, no, cancel, a greeting, a trick, a booking with its service, day and time.
* **The decision model** is asked what the customer wants, which service, and (when the rules found no day and time) which of the next free times (`Reading.Slots`, from the
  calendar once it is wired). The questions and labels are reading.ts's, in the order its objects have them; the rules' values win over the model's.
* **The language model** gets the shop's prompt and answer schema (model-prompt.ts, rendered by the generator for a sentinel shop and filled here with the shop's services). Its
  answer is untrusted: `Shape` (toIntentShape) keeps only an Intent's own fields (a null period dropped, "18:00 pm" read as 18:00, `ask` never passed), and `CoerceIntent` checks
  every type by hand. The router asks a reading for its own `Shape` (`understanding.Shaper`); the owner's reading has none and keeps the generic one.

The matcher (`language/regex.go`) learned three shapes these patterns have and RE2 does not: a one-character look-ahead at the end of a word in the word list an alternative
ends with (marked as an `edge` group and cut back), a look-ahead in the middle or one longer than a character ("ends" mode: the part before it is matched, and its shorter ends
are tried longest first, as a backtracking engine does with a greedy repetition last), and a `\b` inside an alternative (matched with the character before in front, so the
`\b` sees it). Each is proved on JavaScript's own matches over the generator's corpus, which now has customers' phrases (times next to prices, glued words, STOP, tricks).
