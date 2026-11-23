# internal/feesreport: the Fees monthly report on Go

The Go twin of `templates/education/fees/report/` (data, strings, html, text, whatsapp, summary, go-live, monthly-job, run). It is made the way `internal/ordersreport` and
`internal/bookingsreport` are, over the shared `internal/report` (sign, digest, canonical JSON, the page frame, the summary links, the monthly job and its send-once) and
`internal/accounting` (the books read from the record, `FeesLegacy`, `OldDueMonths`). The parts every template's report shares are NOT copied here: they are in
`internal/report/reportkit.go` (the tree helpers, the month's slice of the record, the period, the by-action table, the WhatsApp message mechanics and the random folder name).

## What each file is

| Go file | TypeScript |
|---|---|
| `data.go`, `tree.go` | `report/data.ts` (`buildFeesReport`, `entryDigest`) and the object it builds, key for key, as the tree that is sealed |
| `settings.go` | `policyOf`, `policyDigest`, `notTestedOf`, `notTestedForReport` |
| `words.go` | `report/strings.ts`, `STOP_SITES`, the reminder and receipt template names, the four WhatsApp templates, as DATA (`words/words.json.gz`) |
| `html.go` | `report/html.ts` (the page, the Classes rows, the go-live block, the "Money this month" block with `toCome`) |
| `text.go` | `report/text.ts` (the owner's five lines, six with Classes; `goLiveLines`; `notCheckedList`) |
| `whatsapp.go` | `report/whatsapp.ts` (the owner's message and its template; the old dues inside the collected value) |
| `summary.go` | `report/summary.ts` (layout 4, or 7 when old dues were paid) |
| `golive.go` | `report/go-live.ts` and `readGoLive` of `report/cli.ts` |
| `run.go` | `report/run.ts` `writeFeesReport` |
| `monthlyjob.go` | `report/monthly-job.ts` `createMonthlyReport` |

The wiring into the centre is `internal/fees/report.go` (the settings tree, the name-free fees, the job on the beat) over `internal/reportwire` (the `report` block of runtime.json, the
messaging adapter, running a job on a beat, the failure told once an hour).

## Students' names never leave the centre as themselves

1. The report is never given a name. `fees.DuesOf` hands it each fee as `feesreport.Due{Month, State, Payments, BalancePaise}`; `fees.Settings.ReportTree` reduces each student to an empty
   object (the policy digest takes only how many there are). The page, the owner's text and the message are built from the report's own numbers.
2. The record's entries are digested without `conversation` (the parent's number) and without `notes` (a note can name a child: the harness writes "the fee for Rohan Mehta is open", and a
   digest of it could be tested by guessing the name). This is Fees' `entryDigest`, which is stricter than Bookings' and Orders'; `EntryDigest` here copies it, and a test holds it.
3. The vector: every case's settings and record name students. `names_test.go` scans the signed report file, the summary link, the page in all five language choices, the owner's text, the
   WhatsApp message and its template parameters, and the files written to disk, for each student's name (and each word of it) and each parent's number. It first proves it is not blind
   (the notes do hold the names; the scan finds one when it is put in).
4. The contract (both runtimes): `owner.contract.test.ts` "the monthly report" now also reads every file of the report folder for the five students' names.

## Where the data comes from (nothing is retyped)

* `go/scripts/gen_fees_report_words.ts` writes `words/words.json.gz` by running the TypeScript. `UPI_NOT_COUNTED` and `STOP_SITES` are exported from `data.ts` for it (an `export` only).
* `go/scripts/gen_fees_report_vectors.ts` writes `testdata/vectors.json.gz` by RUNNING the report on 36 cases (the busy month of `example-month.ts`, a UPI centre, a gateway centre that
  exercises every rule of the counting with old dues and Classes, a Classes centre, a financial year end, a wind-down month, a quiet and an empty month, other time zones, long names that
  force each of the three check links, escapes, a record that is not a chain), the files `writeFeesReport` writes, the go-live certificates the report reads (made by the TypeScript's own
  builder) and `createMonthlyReport` over a scripted messaging. The settings files go in as TEXT, so `internal/fees/report_test.go` proves `ReadSettings` + `ReportTree` digest as the
  TypeScript's `validateSettings` + `policyDigest`.
* `templates/commerce/listings/contract/words-fresh.test.ts` fails when either file is stale.

## What is compared, byte for byte

The sealed report file (tree, digest, code, signature), the page, the owner's text and the message (text and template parameters) in every language the case asks for, the signed summary
link and what the TypeScript's checker reads in it, the files the run writes and their hashes, and the job's claim and ending lines, saves, logs and folder.
