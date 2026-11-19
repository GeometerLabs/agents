# Go Bookings monthly report (`internal/bookingsreport`)

The Bookings-specific half of the shop's monthly report in Go: `templates/commerce/bookings/report/*` as the Bookings runtime imports it, ported to give the same bytes (decision 61,
wave 2). It is Bookings-specific (not part of `internal/report`) because it reads Bookings' Settings, its bookings and the crash test's "not tested" list. The Bookings runtime, written
later by someone else, calls this package; what is here are exact, tested blocks, not a runtime. Everything generic is reused from `internal/report` (seal, summaries, page,
`MonthlyJob`, `SettledByWordOf`, the go-live reading) and `internal/accounting` (the journal, figures, summary, `render.MoneyBlock`); nothing of them is copied.

## What each file is

| file | the TypeScript it ports |
| --- | --- |
| `data.go`, `tree.go` | `data.ts`: `BuildMonthlyReport`, `workOf`, `EntryDigest`, every count rule; `MonthlyReport.Tree()` is the object that is sealed, key for key |
| `settings.go` | `policyOf`, `policyDigest`, `checkedPolicyDigest`, `notTestedOf`, `notTestedForReport`, `capabilitiesOf(...).confirmsAutomatically` |
| `ledger.go` | `modules/record/ledger.ts` `headOf` (with `tenantOf`, `ledgerBody`, `entryHash`): the report's `anchor` |
| `html.go` | `html.ts`: `ReportPage`, `ReportSection`, `WorkBlock`, `GoLiveBlock` |
| `text.go` | `text.ts`: `OwnerText`, `OwnerTexts`, `NotCheckedList`, `GoLiveLines` |
| `whatsapp.go` | `whatsapp.ts`: `MonthlyReportMessage` (text and template), `ReportTemplateNames` |
| `certificate.go` | `certificate.ts`, the MONTHLY certificate only: `BuildMonthlyCertificate`, `MonthlyCertificateText`, `MonthlyCertificatePage` |
| `summary.go` | `summary.ts`: `ReportSummaryFields`, `CertificateSummaryFields` |
| `run.go` | `run.ts` `writeClientReport` (the file names, the owner texts, the codes, the check link) |
| `golive.go` | `go-live.ts` and `cli.ts` `readGoLive` (the part `server/start.ts` imports) |
| `monthlyjob.go` | `monthly-job.ts` `createMonthlyReport`: the folder named by a random token, wired into `report.MonthlyJob` |
| `words.go`, `words/words.json.gz` | `strings.ts` (four languages) and the lists and constants data.ts takes from elsewhere, made by `scripts/gen_bookings_report_words.ts` |

## The API the Bookings runtime calls

```go
// the month's files and what the job needs (run.go)
func WriteClientReport(run Run) (Written, error)
// the job, one per shop (monthlyjob.go): Setup.Shop is read each time a report is made
func NewMonthlyJob(setup Setup) *report.MonthlyJob
// reading the go-live certificate for server/start.ts (golive.go)
func ReadGoLive(path string, s Settings) report.GoLiveReading
// the pieces, if the runtime wants them one by one
func BuildMonthlyReport(in Input) (*MonthlyReport, error)
func SealReport(r *MonthlyReport, key ed25519.PrivateKey) SealedReport
func ReportPage(sr SealedReport, lang, check string) (string, error)
func OwnerText(r *MonthlyReport, lang string) string
func MonthlyReportMessage(sr SealedReport, lang, link, check string) (ReportMessage, error)
func BuildMonthlyCertificate(sr SealedReport, issuedAt int64) *MonthlyCertificate
func HeadOf(entries []accounting.Entry, tenant string) (*LedgerHead, error)
func PolicyDigest(s Settings) string
func ReportTemplateNames() []string   // for the services' approved-templates list (server/services.ts)
```

What the runtime hands in: `Settings` is `map[string]any` (settings.json decoded, numbers float64) and must be the **validated** settings (see below); `Entries` are `accounting.Entry`
(`store.Entry`, the same JSON the TypeScript record writes); `Booking` is `{ID, State, Pending int}`, the three things data.ts reads of `src/booking.ts` Booking (`state === "needs_owner"`,
`pending.length`, `id`); keys are `ed25519.PrivateKey` (or nil: the papers are not signed). The job also needs the shop's record as an `accounting.Record` and the messaging as a
`report.Messaging` (the adapters are `internal/bookings/books.go`; `internal/report/Explanation.md`).

## How the signed bytes are kept equal

* **The tree.** `MonthlyReport.Tree()` writes the TypeScript's key set. Optional keys are spreads in the TypeScript and are absent in the tree (`innovator`, `paidBy`, `accounting`,
  `money.settledByWord`, `money.booksOnly`, a refund row's `settledByWord`); the nulls are explicit (`preparedBy`, `period.month`, `anchor`, a job's `why`, the work's cost fields). Go has
  no `undefined`, so there is never a key for `report.CanonicalJSON` to write as null by accident; each field was checked against the TypeScript.
* **Order.** JavaScript Maps and Sets keep insertion order; here the jobs list is first-seen order, then stable-sorted by `Number(id without its leading non-digits) || 0`
  (`accounting.JSNumber`, so `b-1e2` is 100 and `b-0x10` is 16; the vectors hold both). The by-action table sorts with UTF-16 order (`report.LessUTF16`), as `sort()` does.
* **Presence against truthiness.** `x ?? y` and `=== undefined` are two-value map lookups; `if (x)` is "not empty". `refs.paymentId === refs.paymentId` with both missing is equal; with
  one empty and one missing it is not (vectors hold that, and `refundId` the same way). `booking &&` is truthiness (an id of `""` is no booking), `booking !== null` is not.
* **Money** is `int64` paise; the cost per completed job is `Math.ceil(micro / completed)` as a float division. Dates and times use `internal/zone` (the shop's zone) and
  `accounting.ParseISO` (`Date.parse`).
* **Words.** `strings.ts` is generated, never retyped: a word that is a function (`more`, `cert.held`, `goLive.own` ...) is a template with `{0}` slots, checked on other values by
  `lib_words.ts`; the Innovator badge, the check-link label, the two "settled by" lines and the "Money this month" words are the ones `internal/report` and `internal/accounting` already
  load (the generator asserts they are the same values). The four WhatsApp templates (name, badge, upi, wording per language) are data made by running `wording()`, not ported code.
* **Constants made by the generator, with a freshness check:** the digest of Glow Salon's settings (`checkedPolicyDigest`: Go does not port `harness.ts`), the package version
  (`PATHWAY.version` of `templates/commerce/bookings/package.json`), `MESSAGE_STATUS_ENTRY`, the rule ids, `NOT_COUNTED`, `SOURCES`, the hand check's lists, and which payment modules
  confirm by themselves (and that a module that is none of them, or no payment block, is read as the default, UPI).

## The vectors

`scripts/gen_bookings_report_vectors.ts` makes `testdata/vectors.json.gz` (a tenth of its text) by RUNNING the TypeScript; the vectors name Node's version (`process.version`) and the
freshness check ignores that member. The shop records are the busy month of the Bookings example (`report/example-month.ts`, the harness with stand-in services; a gateway shop) and records
built with the real `createRecord` and `createAccounting.post`: a UPI shop (the owner's marks by UPI, cash and bank, a refund owed and marked sent, kept, or still owed, a claim never
marked), a gateway shop with every counting rule (limits at their stop sites and not elsewhere, owner answers including an unknown one, messages in four languages, a refund asked for
twice, steps settled later, refunds settled by a person's word with names of every shape, a payment made twice, odd booking ids, a restore, a licence line), a financial-year end
(lines either side of 31 March 18:30 UTC), a wind-down month, a quiet month, an empty record. Cases: signed and not; en, hi, ml, kn and both; with and without Innovator, cost, tenant
(anchor), preparer; each go-live finding; a period that is not a month; three time zones; a long shop name that pushes the message past WhatsApp's 1024 characters so the check link is the
summary, then the `#sha256` link, then the `#code` link (the generator fails if one kind is missing); a record that is not a chain, with an unreadable time, a tenant that is no id.
Per case: the sealed report and certificate files, both signed summary links and what the TypeScript's `checkSummaryLink` reads in them, the report and certificate pages, the owner texts,
the certificate text, and the WhatsApp text and template in all four languages. Beside the cases: `writeClientReport`'s files (names and the sha256 of each), the policy digest and "not
tested" lists of six settings, 38 ledger heads, 16 go-live certificate files and `readGoLive`, and `createMonthlyReport` over a scripted messaging in four modes (template, text +
document, a document the provider refuses, a month with nothing in it): the messages sent, the claim and ending entries, the saves, the log lines and every file in the folder.

Run `node go/scripts/gen_bookings_report_words.ts` and `node go/scripts/gen_bookings_report_vectors.ts` (each has `--check`) after a change to `templates/commerce/bookings/report/`,
`strings.ts`, `crash-test/not-tested.ts`, `modules/record/ledger.ts` or the accounting modules; `words-fresh.test.ts` fails when one was not run. The Go tests are
`go test ./internal/bookingsreport/`.

## Settings: the caller's duty (the one known way Go and TypeScript can disagree)

`policyDigest` is the digest of the settings AS `validateSettings` returns them (it fills the time zone, `bufferMinutes`, `languages`, trims the name, reads every service and the payment
block). `validateSettings` is not ported, and the file on disk is not always the validated tree: `geometer deploy` (`bundle/geometer.ts`) validates the settings file and then ships its
text as the owner wrote it; the TypeScript runtime validates on load. So the tree handed in must be what `validateSettings` returns, as JSON. A raw file that leaves a default out or pads
the name gives another digest, the report's `policyDigest` differs from the TypeScript's, and a go-live certificate of the same settings (the CLI makes it from the validated settings)
would be read as "different" instead of "own". The Bookings runtime reads settings through `bookings.CheckSettingsFile` / `(*Settings).Tree` (settings_check.go), which gives the validated tree. The vectors hold
both digests (`policies.raw`: a padded name and a missing `bufferMinutes`) and the generator fails if the validated settings' digest changes when they go through JSON.

## What the TypeScript does that Go does not need

`report/papers.ts`, `review.ts`, `example-month.ts`, `sample-shop.ts` and the rest of `cli.ts` are not imported by the runtime (checked with grep over `server/*.ts` and `src/*.ts`: only
`whatsapp.ts` (`REPORT_TEMPLATE_NAMES`), `monthly-job.ts` and `cli.ts` `readGoLive`), so they were not ported. The go-live certificate's builder and pages (`buildGoLiveCertificate`,
`goLivePage`, `goLiveText`, `summariseRun`, `notTestedFor`, `writeGoLiveCertificate`) are used by the CLI and the deployer only; they stay TypeScript. `exampleValues`, `sampleMessage` and
`reportSubmissions` (the list submitted to Meta) likewise.
