# Deferred in the Go Orders monthly report, and why

* **`papers.ts` and `cli.ts` (except `readGoLive`)** are command-line only (the `client-report`, `report-example` and `go-live-certificate` scripts): the frame, the option readers,
  `readSettings`, `readOrders`. They stay TypeScript. `readGoLive`, which the server calls, is ported (`golive.go`).
* **The go-live certificate's builder, page and text** (`buildGoLiveCertificate`, `goLivePage`, `goLiveText`, `goLiveSection`, `limitsOf`, `limitLines`, `summariseRun`,
  `summariseHandCheck`, `notTestedFor`, `writeGoLiveCertificate`) are the CLI's and the deployer's, which stay TypeScript; the runtime only reads a certificate. Only `cert.held` of the
  certificate's words is carried (the monthly report's go-live lines use it); the rest branch on numbers and booleans (`cert.cutoff`, `cert.advance`) and belong to the certificate's page.
* **Orders has no monthly record certificate** in the TypeScript, so there is none here and the monthly job sends no certificate document.
* **The sample month and the Meta submission list** (`review.ts` `sampleReport`, `sampleMessage`, `reportStringRows`, `whatsapp.ts` `sampleFor`, `exampleValues`, `reportSubmissions`): a
  review and command-line use, not the runtime's. `example-month.ts` is used by the generator only.
* **`validateSettings`** (Orders'): not here. The caller hands in the validated tree (`settings.go`): the policy digest is of the validated settings, and a raw file gives another digest.
  The vectors hold both digests.
* **A refund line or balance whose amount is not a whole number.** `figures` and `balancePaise` are summed in whole paise (int64); the runtime writes whole numbers. A `balancePaise`
  such as `"12.5"` is cut to 12 here and would be 12.5 in the TypeScript. A `days` or `amountPaise` ref in a plan credit that is not a number counts as 0 here, where JavaScript would make
  the sum NaN (written as null). A non-numeric `balancePaise` is held by a vector (counted, adds nothing); the others are not.
* **A rule id that is a member of `Object.prototype`** (`constructor`, `toString`, ...): the TypeScript's `STOP_SITES[ruleId] ?? []` finds the inherited member and `.includes` is then
  not a function (the report would not be made); Go treats it as an unknown rule (never counted). Rule ids are fixed names.
* **An entry whose time does not parse** is left out of the month and of the counts (NaN comparisons are false in the TypeScript too); the ledger refuses such a record when the report is
  anchored (a vector holds it).
* **Settings with no payment block**: the TypeScript's `policyOf` throws (`payment.module` of undefined) where Go writes a null module. A validated tree always has the block.
* **`go/README.md` and `go/TRIAL.md` were not updated** (this stream was told not to touch them); the package map line is: `internal/ordersreport/  the Orders monthly report
  (templates/commerce/orders/report/*, src/plans/report.ts): data, page, owner text, WhatsApp message, signed summary, go-live reading, the monthly job's wiring`.
* **Not tested at the exact limit.** No vector lands exactly on 1024 UTF-16 units for the settled-words fit or the check link (see Bookings' Deferred.md); `<=` is held by reading the code.
* **Depends on `internal/bookingsreport`** for the record's ledger head, `EntryDigest`, `GoLiveTree`, `Settings` and `ShopOf`/`ConfirmsAutomatically`. When those move to a shared package
  (they are generic), only the imports here change.
