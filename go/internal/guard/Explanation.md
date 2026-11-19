# internal/guard: the shared core of every Guard client

The Go twin of `modules/core/faults.ts`, `http.ts` and `json.ts`, plus `webhooks.ts`'s `hmacHex` and `sameHex`. Every client (payments, messaging, calendar) is built on `guard.Http`.

- **faults.go**: the errors a call can end in. TypeScript has a class tree (`instanceof`); Go has one `GuardError` with a `Kind` and predicates (`IsRefused`, `IsConflict`), because an
  already-done is also a conflict and a denial is also a refusal. `Name` gives the TypeScript error's `name`; `WaitsForGuard` is the one table of what each failure means.
- **http.go**: the one HTTP client. No Authorization unless an agent token is given. `Classify` tells Guard's own decision from the service's reply in one place. Only dial-phase failures
  are `NotSentError` (with Node's code); an unreadable 2xx is a timeout; an unreadable non-2xx is `{raw: first 200 UTF-16 units}`. Keep-alive is off, because net/http would quietly send a
  GET again on a cut connection.
- **json.go**: bytes that JavaScript writes and Go does not by default: `JSText` (no HTML escaping, U+2028/9 raw), `EncodeURIComponent`, `QueryString` (URLSearchParams, insertion order),
  `Decode` with `json.Number`. Money and times read with `Int`: a fraction reads as absent (TypeScript's `num` would pass it). This is the one recorded difference.
- **reemit.go**: `JSON.stringify(JSON.parse(x))`, for the webhook's fallback event id. Limit: a number with an exponent or over 17 digits uses Go's shortest form.
- **guardtest/**: the vector harness (script replay server, request recorder, outcome comparison) every client's test uses.

Proved by `testdata/core-vectors.json` (every answer in Guard's fixture file plus 18 odd shapes, transport failures, request bytes) and `byte-vectors.json`, both written by running the
TypeScript (`go/scripts/gen_guard_vectors.ts`).
