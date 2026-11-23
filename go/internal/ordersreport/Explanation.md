# internal/ordersreport: the Orders monthly report on Go

The Go twin of `templates/commerce/orders/report/` (data, strings, html, text, whatsapp, summary, go-live, monthly-job, run) and of the plans' part of the report,
`templates/commerce/orders/src/plans/report.ts`. It is made the way the Bookings port (`internal/bookingsreport`) is, over the shared `internal/report` (sign, digest, canonical JSON,
the page frame, the summary links, the monthly job and its send-once) and `internal/accounting` (the books read from the record).

## What each file is

| Go file | TypeScript |
|---|---|
| `data.go`, `tree.go` | `report/data.ts` (`buildOrdersReport`, `stopsIn`) and the object it builds, key for key, as the tree that is sealed |
| `plans.go` | `src/plans/report.ts` (`plansReportOf`) |
| `settings.go` | `policyOf`, `policyDigest`, `notTestedOf`, `notTestedForReport`, `itemName` |
| `words.go` | `report/strings.ts`, `PLAN_REPORT_WORDS`, `ORDERS_LEGACY`, the four WhatsApp templates, as DATA (`words/words.json.gz`) |
| `html.go` | `report/html.ts` (the page, the plans block, the go-live block) |
| `text.go` | `report/text.ts` (the owner's five lines, `goLiveLines`, `notCheckedList`) |
| `whatsapp.go` | `report/whatsapp.ts` (the owner's message and its template, the check-link choice) |
| `summary.go` | `report/summary.ts` (layout 5 of the signed summary) |
| `golive.go` | `report/go-live.ts` and `readGoLive` of `report/cli.ts` |
| `run.go` | `report/run.ts` `writeOrdersReport` |
| `monthlyjob.go` | `report/monthly-job.ts` `createMonthlyReport` |

## Where the data comes from (nothing is retyped)

* `go/scripts/gen_orders_report_words.ts` writes `words/words.json.gz` by running the TypeScript: the four languages of `strings.ts` (a word that is a function of its arguments becomes a
  template with `{0}`, `{1}` slots after the generator has checked it does nothing but put its arguments in), the plans' words, the rule ids, "not counted" and a UPI shop's swap
  (`UPI_NOT_COUNTED`, exported for the generator), the hand check's "not tested" lists, the pathway name and version, the example shop's policy digest, `ORDERS_LEGACY` and the four
  WhatsApp templates. `--check` exits 1 and names the file when it is stale.
* `go/scripts/gen_orders_report_vectors.ts` writes `testdata/vectors.json.gz` by RUNNING the report on 38 cases (the busy month of `example-month.ts`, a UPI world, a gateway world that
  exercises every rule of the counting, a plans world, a financial year end, a wind-down month, a quiet and an empty month, other time zones, an odd menu, long names that force each of the
  three check-link kinds, escapes, ledger errors, a backwards period), the policy digests, the go-live certificates (made by the TypeScript's own `buildGoLiveCertificate`, every status and
  every way to be untrusted), `writeOrdersReport`'s files, and `createMonthlyReport` over a scripted messaging.
* `vectors_test.go` compares every one of them byte for byte: the sealed report file (tree, digest, code, signature), the page in the languages each case asked for, the owner's text
  in all four, the signed summary link and what the TypeScript's checker reads back from it, the WhatsApp text and template in all four, the written files' hashes, and the job's sent
  messages, record lines, saves, logs and files.
* The TypeScript is given the REAL `Order` values; Go is given only `ordersreport.Order` (a projection the generator makes and stores in each case), so the test shows the projection
  carries everything the report reads of an order.

## How it differs from the Bookings port

* No jobs list, no record rows, no monthly record certificate (Orders has none; `report/certificate.ts` is the go-live certificate). The report's `record.digest` is over the WHOLE record up
  to the month's end, as in the TypeScript, and a month is each entry's own time.
* What was sold, pickup against delivery and what is still to collect come from the orders (`Order`), for the confirmed or completed orders whose day falls in the month.
* The check-and-message pair is one stop (`stopsIn`), the balance collected at pickup (`record_balance`) is its own figure, plans are counted for a shop whose settings have plans.
* Figures are read with `RefundAmountFromPayment: true`; the "not tested" list drops two ids for a UPI shop (Bookings drops three); the policy digest keeps the owner's `approveOverInr`
  and reduces the payment to its module.
* What it reuses from `internal/bookingsreport` (generic, nothing Bookings-specific in them): `Settings`, `ShopOf` / `ShopView`, `ConfirmsAutomatically` (the payment providers'
  capabilities, one list for every template), `LedgerHead` / `HeadOf` (the record's hash chain: one place, not two), `EntryDigest` and `GoLiveTree`.

## Wiring (for internal/orders)

`NewMonthlyJob(Setup)` returns the `*report.MonthlyJob`; wire it into the Orders kit's `AfterTick` as `internal/bookings/books.go` wires Bookings'. `Setup.Shop` is read each time a report
is made and returns the settings tree (what Orders' `validateSettings` returns, as JSON: see `settings.go`), the whole record and the store's orders as `[]ordersreport.Order`.
`Legacy()` is `ORDERS_LEGACY` for the books (`accounting.CreateAccounting(..., ordersreport.Legacy(), ...)`).
