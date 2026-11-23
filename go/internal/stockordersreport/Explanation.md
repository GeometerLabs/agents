# internal/stockordersreport: the Stock orders monthly report on Go

The Go twin of `templates/commerce/stock-orders/report/` (data, strings, html, text, whatsapp, summary, go-live, monthly-job, run). It is made the way the Orders port
(`internal/ordersreport`) is, over the shared `internal/report` (sign, digest, canonical JSON, the page frame, the summary links, the monthly job and its send-once).

## What each file is

| Go file | TypeScript |
|---|---|
| `data.go`, `tree.go` | `report/data.ts` (`buildStockReport`, `stopsIn`) and the object it builds, key for key, as the tree that is sealed |
| `settings.go` | `policyOf`, `policyDigest`, `notTestedForReport` (the settings are a JSON tree) |
| `words.go` | `report/strings.ts` and the two WhatsApp templates, as DATA (`words/words.json.gz`) |
| `html.go` | `report/html.ts` (the page) |
| `text.go` | `report/text.ts` (the owner's six lines, `goLiveLines`, `notCheckedList`, `budgetValue`) |
| `whatsapp.go` | `report/whatsapp.ts` (the owner's message and its template, the check-link choice) |
| `summary.go` | `report/summary.ts` (layout 6 of the signed summary) |
| `golive.go` | `report/go-live.ts` and `readGoLive` of `report/cli.ts` |
| `run.go` | `report/run.ts` `writeStockReport` |
| `monthlyjob.go` | `report/monthly-job.ts` `createMonthlyReport` |

The wiring is in `internal/stockorders/report.go` (`NewMonthlyReport`, `Agent.AfterTick`, `OrdersOf`) and `internal/stockorders/settingstree.go` (the validated settings as the JSON tree the
digest is of); the `report` block of runtime.json and the shop's messaging are read by `internal/runtime/reportwiring.go` (`ReadReportConfig`, `ReportMessagingOf`, `ReportRecordOf`),
written once for this template so that it is not a third copy (Orders and Bookings keep their own, see Deferred.md).

## Where the data comes from (nothing is retyped)

* `go/scripts/gen_stockorders_report_words.ts` writes `words/words.json.gz` by running the TypeScript: the four languages of `strings.ts` (a word that is a function of its arguments
  becomes a template with `{0}`, `{1}` slots after the generator has checked it does nothing but put its arguments in), the rule ids, the "not counted" ids, the hand check's "not tested"
  ids, the pathway name and version, the example salon's policy digest and the two WhatsApp templates. `--check` exits 1 and names the file when it is stale.
* `go/scripts/gen_stockorders_report_vectors.ts` writes `testdata/vectors.json.gz` by RUNNING the report on 31 cases (a busy month made by a real agent on the harness, the same month
  without the owner's "paid" note, a record that exercises every rule of the counting and every state of an order, a financial year end, a quiet and an empty month, other time zones,
  long names that force each of the three check-link kinds, escapes, ledger errors, a backwards period), the policy digests, the settings files as owners write them and the tree
  `validateSettings` makes of each, the go-live certificates (made by the TypeScript's own `buildGoLiveCertificate`, every status and every way to be untrusted), `writeStockReport`'s
  files, and `createMonthlyReport` over a scripted messaging.
* `vectors_test.go` compares every one of them byte for byte: the sealed report file (tree, digest, code, signature), the page in the languages each case asked for, the owner's text in all
  four, the signed summary link and what the TypeScript's checker reads back from it, the WhatsApp text and template in all four, the written files' hashes, and the job's sent messages,
  record lines, saves, logs and files. It also checks that no file of any report carries a phone number of the owner's or of a supplier (the numbers are in the vectors).
  `internal/stockorders/settingstree_test.go` proves `Settings.Tree` against the tree `validateSettings` makes.
* The TypeScript is given the REAL purchase orders; Go is given only `stockordersreport.Order` (a projection the generator makes and stores in each case), so the test shows the projection
  carries everything the report reads of an order.

## How it differs from the Orders port

* No money from the books, no plans, no UPI variant, no go-live of a payment: the figures are counts of orders and the budget the approved orders hold. The one money figure is the budget;
  the summary is not "owner marked".
* An order is "placed" in the month the owner approved it; what the supplier answered and what arrived are read from the orders as they are when the report is made.
* The by-rule stops are counted per blocked entry once under each rule that blocked it, with `other` for a rule the list does not know (Orders counts at named stop sites).
* The policy digest also drops each supplier's number; there is no payment block.
