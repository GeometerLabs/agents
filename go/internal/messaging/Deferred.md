# messaging: what was left, and why

* **No TypeScript was deleted.** The Orders, Fees and Stock-orders runtimes still run the TypeScript messaging until their waves.
* **`gupshup-selfserve.ts` is ported** (it is reachable from the Bookings runtime's import graph through `providers.ts`). Its callers in the
  deployer and panel (`bundle/panel/setup.ts`, `bundle/panel/checks.ts`, `bundle/generate/guards.ts`, `bundle/lib/gupshup-templates.ts`) read its
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

## TypeScript findings (nothing was changed)

1. `recordMessageStatus` throws a `RangeError` ("Invalid time value") for a failed status whose timestamp is past the Date range (`statusTime` lets anything
   >= 1e10 through as milliseconds, then `new Date(ts).toISOString()` throws). A forged webhook with a huge time makes the runtime's status step throw. The Go
   twin returns `ErrInvalidTime`, as the vector says; the runtime should treat it as "report ignored".
2. `say.ts`'s buttons-to-text fallback sends the same words as text after ANY `ApiError` under 500 except a window closed or a licence stop: that includes a
   Guard HELD answer (202, so the buttons may be waiting for an approval and the text then goes too), a Guard refusal (403), a conflict (409) and an
   unauthenticated (401). Copied, not fixed; vectors "buttons refused with a Guard hold / refusal / conflict" show it.
3. `interactiveProblem` counts code points but the other limits (file name, caption) count UTF-16 units, so an emoji counts one in a button title and two in a caption.
4. `messaging.ts` `receive` and the `STOP` check use `toUpperCase`, so `"ﬆop"` and `"ſtop"` (a ligature and a long s) opt a customer out; probably harmless, and copied.
5. A webhook `timestamp` such as `"1.0001"` (seconds) gives a fractional millisecond in the TypeScript's `InboundMessage.timestamp`; Go truncates.
6. `describeMetaError` uses `??`, so a Meta refusal with an empty `details` or `message` becomes an `ApiError` with no words (`""`).
