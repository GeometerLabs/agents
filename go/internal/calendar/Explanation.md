# calendar (Go twin of the Bookings calendar adapters)

What it is: the shop calendar the Bookings runtime calls (decision 61, wave 2). One `Calendar` interface (`Insert`, `Get`, `List`, `Update`, `Delete`, `FreeBusy`, `Conflicts`, all with a context) and three things behind it:

- `google.go`, the live client over Google Calendar API v3 behind a Guard (`live/google-calendar.ts`). Built on `guard.Http`, so the agent token, the timeout, and every Guard answer (held, refused, outcome unknown, busy, replayed ...) come out of `guard.Classify` exactly as for payments.
- `fake.go`, the in-memory fake a `fakes` shop runs on, with the same fault injection (`silentFailure`, `lostReply`, `conflict`, `error`, with `times` and `after`).
- `own.go`, the shop's own booking list (`calendar.module: own`), kept inside the bookings store as `OwnState` (`{"events": {...}, "next": n}`), the same JSON the TypeScript saves, so a shop can move between runtimes.

Times are epoch milliseconds (`int64`). `jsdate.go` holds the JavaScript behaviours the client leans on (`Date.parse` of Google's RFC 3339, `toISOString`, `Number(string)`, `String(value)`, `Date.UTC`, and `zonedToMs` for all-day events), each documented with what it copies and where it differs on purpose.

## What is proved, and how

`go/scripts/vectors/calendar.ts` runs the REAL TypeScript client against a recording server (226 cases: every operation, every Guard answer, escaping of calendar and event ids, paging, 404/410, cancelled and transparent events, all-day events in 10 zones across DST days, odd free/busy rows, timeouts, cut connections) and writes the requests (method, request target, headers, body bytes) and the outcome. The Go test replays each script from a Go server and must send the same bytes and reach the same outcome. The fake and the own list are driven through scripted and seeded-random sequences (16 fake and 13 own scenarios, up to 70 steps each) in TypeScript and Go; results, final state, call log and event order are compared. `Date.parse`, `toISOString`, `Number`, `String` and `toEvent` are compared on inputs Node answered. The vectors are made with `TZ=UTC` so they are the same on every machine (see below).

## Decisions

- `Events` is an insertion-ordered set (JavaScript object order), because `list` answers in that order and the order is saved. A deleted and re-added id goes last, as a JS key does.
- `Patch.HoldSet` is TypeScript's `"holdExpiresAt" in patch`: the key present with no value clears the hold (Google is told `null`); the key absent keeps the event's own. No other patch member can be "present and undefined" in Go (nil means not given); no caller does that.
- `NewOwn` starts a never-written state at `next: 1` (the TypeScript's `??=`), so a read-only first touch cannot save `next: 0` and mint `own_0` later.
- Time zones come from Go's `time/tzdata` (embedded, so a bare container needs no zoneinfo; about 450 KB in the binary). `zonedMidnight` copies `zonedToMs` (two passes, clock read to the minute, `Date.UTC`'s 0-99 means 1900-1999 oddity, fallback to UTC for a zone Intl rejects). After the merge with the books stream it may use `go/internal/zone` instead; the books branch has its own zone helpers.

## Differences from the TypeScript (all in inputs Google does not send)

- A date and time with no offset is UTC in Go; in JavaScript it is the computer's local time. V8's free-form fallback dates ("Nov 10 2026") are not read: NaN, so such an event is unusable.
- A hold end (`holdExpiresAt`) that is a fraction or beyond 2^53 reads as no hold; the TypeScript keeps the fraction. Times are whole milliseconds.
- `RangeError` from `toISOString` (a time beyond a Date's range) is a plain error with the same words ("Invalid time value").
- Zone names: ICU matches case-insensitively and knows aliases Go may not; Go's tzdata version can differ from Node's ICU for future rules.
