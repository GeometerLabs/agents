# messaging: what was left, and why

* **No TypeScript was deleted.** The Orders, Fees and Stock-orders runtimes still run the TypeScript messaging until their waves.
* **`gupshup-selfserve.ts` is ported** (it is reachable from the Bookings runtime's import graph through `providers.ts`). Its callers in the
  deployer and panel (`bundle/panel/setup.ts`, `bundle/panel/checks.ts`, `bundle/generate/guards.ts`, `bundle/lib/wa-templates.ts`) read its
  exported constants and routes; those stay TypeScript (the deployer is not a shop's runtime), and the Go constants (`GupshupSelfServeUpstream`,
  the routes) are copies pinned only by the request vectors.
* **The inbox is not part of the shop runtime.** `webhooks.go` is here because the brief asked for it; the HTTP side (the inbox itself, the path
  token, the app-secret check around `VerifyMetaSignature`) is not ported.
* **The HTTP stand-in servers in `modules/standins`** are test infrastructure and stay TypeScript. Only the in-process `standInMessaging` is ported.
* **Hand-typed words.** The sentences of `statuses.go` (`notesFor`), `say.go` (`CheckOptOut`, `GuardLicenceDecision`) and the `ApiError` messages are English
  words for the record, typed in Go and pinned by vectors rather than generated; a change to the TypeScript wording fails `--check` and the vector test.
* **Not covered by a vector:** fractional webhook times (truncated here), a cut inside a surrogate pair, a time past 2^53 ms (unit tests say what Go does);
  the `Audio`/`OnHeard` members of an inbound chat message; an `Action` that is the empty string (`a.action ?? "send_message"` keeps `""`; here `""` means unset).
* **`limits.ts` and `licence/rules.ts` are not ported as packages.** `Decision`, `Strictest`, `CheckOptOut` and `GuardLicenceDecision` are the few lines
  `say.go` needs; the message-matches-record check and the template's gates come in through `SayDeps` from the template's own port. When the limits package lands,
  `Decision` should move there and this file import it.

## TypeScript findings

Fixed on both sides on 22 Nov 2026 (branch go-w2-tsfix-22nov, a test on each side):

1. `recordMessageStatus` threw a `RangeError` for a status whose timestamp is past the Date range (a forged webhook made the status step throw). Now the time is
   left out of the line (`reportedAt` absent) in `statuses.ts`, `RecordMessageStatus` (its error is always nil) and the runtime's own copy (`runtime/statuses.go`);
   the Bookings contract has the case on both runtimes.
2. `say.ts`'s buttons-to-text fallback sent the same words as text after ANY `ApiError` under 500: a Guard hold (202), refusal (403), conflict (409) and
   unauthenticated (401) included. Now any answer of the shop's Guard ends the send as the text path's errors do; only the provider's own 4xx falls back.
3. The fake's `receive` STOP used `toUpperCase`, so `"ﬆop"` opted a customer out (the agent's own reading never did). Now ASCII letters only (`/^stop$/i`, `isASCIIStop`).

Not changed:

4. `interactiveProblem` counts code points but the document limits (file name, caption) count UTF-16 units, so an emoji counts one in a button title and two in a
   caption. Deliberate (the comment says characters, so a Malayalam or Kannada label is counted as the reader sees it); what Meta counts is not documented; it differs
   only outside the Basic Multilingual Plane.
5. A webhook `timestamp` such as `"1.0001"` (seconds) gives a fractional millisecond in the TypeScript's `InboundMessage.timestamp`; Go truncates.
6. `describeMetaError` uses `??`, so a Meta refusal with an empty `details` or `message` becomes an `ApiError` with no words (`""`).
