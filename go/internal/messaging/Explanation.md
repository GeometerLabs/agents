# messaging: what was built (19 Nov 2026, wave 2 of decision 61)

`go/internal/messaging` is the shared WhatsApp package every shop runtime in Go calls: the Go twin of `modules/messaging`
(`messaging.ts`, `whatsapp.ts`, `gupshup.ts`, `gupshup-selfserve.ts`, `providers.ts`, `say.ts`, `send-once.ts`, `statuses.ts`,
`webhooks.ts`) and of the stand-in a "fakes" shop runs on (`standInMessaging` in `modules/runtime/services.ts`, with the fake under it).
No key and no WhatsApp `Authorization` header is held or sent: every client takes a `guard.Http` pointing at a Guard.

| File | TypeScript it copies | What it holds |
| --- | --- | --- |
| `messaging.go` | `messaging.ts`, `language/interactive.ts` | the message types, `Messaging` and the optional capability interfaces, `DocumentProblem`, `ImageProblem`, `StickerProblem`, `InteractiveProblem`, `InteractiveText` |
| `cloudapi.go` | `whatsapp.ts`, `gupshup.ts` | Meta direct and Gupshup's partner pass-through: the wire bodies (struct fields in the TypeScript literal's order), the 24-hour window, the reply reading, the error words |
| `selfserve.go` | `gupshup-selfserve.ts` | Gupshup's own customer API: forms, `message` JSON strings, Gupshup's template ids, the 30-second refresh gap, `msgid` |
| `providers.go` | `providers.ts` | `ConfigProblem` (the words), `LiveConfig`, `NewLive` |
| `fake.go` | `createFakeMessaging`, `standInMessaging` | the in-memory fake (ids, window, STOP, approved templates, faults) and the stand-in over it |
| `webhooks.go`, `jsnum.go` | `webhooks.ts` | Meta signature, `ParseWhatsAppWebhook`, `ParseWhatsAppStatuses` (Meta, Gupshup v3, self-serve), `ToE164`, `MediaOf`; JavaScript's `Number(x)` and `toISOString` |
| `sendonce.go` | `send-once.ts` | the state functions and `RunSendOnce` over a `SendOnceDeps` the runtime supplies |
| `say.go` | `say.ts` | `Say`/`Outcome` over `SayDeps`, `Decision`, `CheckOptOut`, `Strictest`, `GuardLicenceDecision` |
| `statuses.go` | `statuses.ts` | `RecordMessageStatus` over a `Record` interface |

## How it is proved

`go/scripts/vectors/messaging.ts` (run by `node go/scripts/gen_guard_vectors.ts`) writes `testdata/*.json` by running the REAL
TypeScript: the live clients against a recording HTTP server (method, request target, the headers that matter, the body bytes, and the
outcome of every step of a script), and the pure parts (webhook readers, the fake, send-once, say, statuses) by calling the TypeScript
functions on scripted inputs. The Go tests read only `testdata` and must produce the same bytes and the same outcomes. `--check` says when
the TypeScript has moved. The tests are `live_test.go`, `misc_test.go`, `fake_test.go`, `webhooks_test.go`, `sendonce_test.go`,
`say_test.go`, `status_test.go`.

## Decisions

* **Optional methods stay optional.** `say.ts` asks `typeof messaging.sendImage === "function"`. Go: a four-method `Messaging` and the
  small interfaces `Interactive`, `Documents`, `Images`, `Stickers`, `Pinger`, found by a type assertion. Gupshup's partner client is a
  type WITHOUT `SendSticker` (`StickerCloudAPI` is the Meta one); the stand-in has only the four core methods, as the TypeScript object has.
* **State is an interface the runtime supplies.** `WindowStore` (when each customer last wrote), `Record` (statuses), `SayDeps` (the
  record's `Log`, `HeldBack`, `MarkMoment`, the template's `Voice`), `SendOnceDeps` (clock, claim, ending, deliver, settle, notify, save).
  `SendOnceState` holds `[]*SendIntent` so a pass that queues another intent does not lose it; the intent keeps unknown members raw and
  `values` raw, and `lastTryMs` is a pointer because `retryNow` deletes it (absent is not 0).
* **Request bytes are the TypeScript's.** Bodies are structs with json tags in the literal's order, written by `guard.JSText`; a member
  the TypeScript leaves out (`undefined`) is `omitempty` or a pointer. `acceptedAs`, a caption, a description and a template's
  `headerImage` are pointers where `""` and "absent" differ in the TypeScript.
* **Ordered maps where JavaScript's `Map` order matters**: self-serve's template list (first key starting `name:lang_` wins, a repeated key
  keeps its first place) and the 1000-message sent copy (the oldest is dropped).
* **Words.** The error and record words (`ApiError` messages, the notes in `statuses.go`, the decisions in `say.go`) are typed in Go and
  pinned to the TypeScript's by the vectors (the Razorpay precedent). No customer-facing WhatsApp text lives here: templates are rendered by
  the template's own `Voice` (generated words), never by this package.

## Where Go differs from JavaScript, and what is copied

* `.length` is UTF-16 (`language.UTF16Len`) for the file name (240), captions (1024), media url (2048), mime (80) and the status title cut (200);
  `interactiveProblem` counts CODE POINTS (`[...s].length`), as the TypeScript does. `\s` is `language.JSSpace` everywhere (`cleanParameter`,
  `[^\s]` in every link check, `;\s*` in the mime pattern, the status title). `.trim()` is `language.TrimJS`.
* `toUpperCase`/`toLowerCase` are full case mappings (`golang.org/x/text/cases`): a template status `"straße"` upper-cases to `STRASSE`. The fake's STOP is
  ASCII letters only (`isASCIIStop`, the TypeScript's `/^stop$/i` since 22 Nov), so `"ﬆop"` is not STOP.
* `Number(x)` is `numberOf` (`jsnum.go`): `""` is 0, `" 12 "` is 12, `"0x10"` is 16, `"1e3"` is 1000, `"1_0"`, `"12px"` and `"inf"` are NaN, `null` is 0, `[]` is 0, `[7]` is 7, an object is NaN.
* `new Date(ms).toISOString()` is `isoString` (and `ISOString` for the runtime): years past 9999 are written `+010000-...`; a time past ±8.64e15 ms has none,
  and a status line then leaves `reportedAt` out, as `statuses.ts` does since 22 Nov (it threw a `RangeError` before).
* Numbers from a reply: money and times are integers. A webhook timestamp is whole milliseconds as an `int64`: a fractional millisecond
  (`"1.0001"` seconds) is truncated, and a value past 2^53 is held at 2^53 (either way the record's Date is invalid or unchanged).
  A reply's error `code` is read with `guard.Int`: a fractional code reads as absent (the TypeScript would carry 131047.5, which is never 131047 either).
* A cut inside a surrogate pair: JavaScript's `slice(0, 200)` leaves a lone surrogate, which a Go string cannot hold; `UTF16Slice` drops the half character.
* `InboundMessage.audio` and `onHeard` (the chat page's recording and callback) belong to the chat channel, not the WhatsApp wire, and are not here.
