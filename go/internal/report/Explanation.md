# internal/report and internal/qr: what was built

The generic half of the shop's monthly report in Go (decision 61, wave 2): `internal/qr` is `modules/qr`, `internal/report` is `modules/report` without anything that knows
Bookings, Fees or Orders. Each template's own report is written beside it and calls these building blocks. Every Go file starts with the TypeScript file it copies and where the two
languages differ; the tests compare with what the TypeScript produced on Node (vectors made by `go/scripts/gen_*`), byte for byte.

## Map to the TypeScript

| TypeScript | Go |
| --- | --- |
| `qr/qr.ts` `encodeQr` | `qr.Encode`, `qr.EncodeWith` (qr.go) |
| `qr/svg.ts` `qrSvg`, `textQrSvg` | `qr.Svg`, `qr.TextSvg` (svg.go) |
| `qr/png.ts` `qrPng`, `textQrPng` | `qr.Png`, `qr.TextPng` (svg.go): the Bookings and Orders runtimes use it (`payments/owner-marked/qr-image.ts` hosts the WhatsApp picture). The pixels are the same; the compressed bytes are Go's deflate, not zlib's |
| `record/record.ts` `canonicalJson` | `CanonicalJSON`, `JSNumber`, `JSONString`, `LessUTF16` (canonical.go) |
| `report/digest.ts` | `SHA256`, `DigestOf`, `VerificationCode` (digest.go) |
| `report/sign.ts` | `Seal`, `Envelope`, `EnvelopeFile`, `PublicKeyHex`, `KeyIDOf`, `LoadPrivateKey`, `VerifyEnvelopeText` (sign.go) |
| `report/summary.ts` | `EncodeSummary`, `DecodeSummary`, `ReadSummaryLink`, `FitText`, `TextBytes`, `IsPeriod`, `LabelledFigures`, `Layouts` ... (summary.go), `Graphemes` (graphemes.go) |
| `report/summary-sign.ts` | `SummaryOf`, `SignSummary`, `SummaryFor`, `SummaryLinkFor`, `PeriodOf`, `DayOf`, `GoLiveSummaryFields`, `MessageCheckLink`, `CheckSummaryLink`, `SignerClaim` (summarysign.go) |
| `report/verify-link.ts` | `VerifyLink`, `VerifyCodeLink`, `VerifyCodePath`, `VerifyQrSvg` (verifylink.go) |
| `report/page.ts` | `Page`, `Table`, `List`, `SealBlock`, `Esc`, `Fig` (page.go); the style sheet is the TypeScript's own text |
| `report/what-this-checks.ts` | `WhatThisChecksBlock` (whatthischecks.go) |
| `report/text.ts` | `LanguagesOf`, `Rupees`, `OneLine`, `BadgeText`, `PeriodLabel`, `SettledByWord`, `SettledWho`, `SettledByWordWords`, `CheckGenuine`, `ScanSummary` (text.go) |
| `report/settled-by-word.ts` | `IsSettledByWord`, `SettledByWordOf` (settledbyword.go) |
| `report/months.ts` | `MonthRange`, `OutFolder`, `Writer` (months.go) |
| `report/claims.ts` | `BannedIn` (claims.go), as data for tests |
| `report/go-live.ts` | `ReadGoLiveText`, `NoGoLive`, `UntrustedGoLive` (golive.go) |
| `report/monthly-job.ts` | `MonthlyJob.Run`, `LastMonth`, `SendFrom` (monthlyjob.go) |
| `messaging/send-once.ts` `RETRY_AFTER_MS`, `MAX_TRIES`, `nothingWasSent` | sendonce.go, with the fault kinds it reads |

## Words and tables made from the TypeScript

`go/scripts/gen_report_words.ts` writes `words/words.json.gz` (INNOVATOR, SETTLED_BY_*, CHECK_GENUINE, SCAN_SUMMARY, WHAT_THIS_CHECKS, LAYOUTS, the page's CSS, BANNED as pattern
source and flags, the sample summary link) and `graphemes_gen.go` (the Unicode properties Go's `unicode` package lacks, found by asking Node's `Intl.Segmenter` about every code
point). `go/scripts/gen_report_vectors.ts` and `go/scripts/gen_qr_vectors.ts` write the test vectors. All three have `--check`, and `words-fresh.test.ts` fails when the committed
files are stale. The one change to TypeScript is the word `export` on `const CSS` in `modules/report/page.ts` (no behaviour change).

## Decisions worth knowing

* The signed summary and the sealed envelope are compared byte for byte with the TypeScript, signatures included (deterministic Ed25519 from a fixed test seed).
* `CanonicalJSON` is record.ts `canonicalJson`, not RFC 8785: UTF-16 key order, JavaScript's number text, `JSON.stringify`'s escapes. A key whose value is undefined is written as
  "null" by the TypeScript; Go has no undefined, so the caller builds trees without absent keys.
* Grapheme clusters are UAX #29 with the Indic conjunct rule, written here because no segmenter is approved; the Go test checks every code point after and before "a" against Node.
* The monthly job asks the Bookings wave for three small things only: `Messaging` (the four calls it makes), the optional `DocumentSender`, and the shop's `accounting.Record` with
  a `Save` callback. Errors that mean "nothing was sent" are `NotSentError`, `GuardUnavailableError` and any error with `HTTPStatus()` 400 to 499.
