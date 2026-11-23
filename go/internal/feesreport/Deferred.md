# Deferred in the Go Fees monthly report, and why

* **`papers.ts`, `certificate.ts`, `cli.ts` (except `readGoLive`), `review.ts`, `example-month.ts`** are the CLI's, the deployer's and the review's (the `client-report`, `report-example` and
  `go-live-certificate` scripts, the identity paper, the sample month): they stay TypeScript. `readGoLive`, which the server calls, is ported (`golive.go`). Only `cert.held` of the
  certificate's words is carried.
* **Fees has no monthly record certificate** in the TypeScript, so there is none here and the monthly job sends no certificate document.
* **The sample message and the Meta submission list** (`whatsapp.ts` `exampleValues`, `sampleMessage`, `reportSubmissions`): a review and command-line use, not the runtime's.
* **`validateSettings`** is `internal/fees/settings.go`; the report takes the tree `Settings.ReportTree` makes (students reduced to empty objects). A tree that is not the validated settings
  would digest differently; the vectors hold the digests of seven settings files.
* **A ref that is not a whole number.** Money sums are whole paise (int64): a `amountPaise` of `"12.5"` is cut to 12 here and would be 12.5 in the TypeScript. A class attendance count
  (`present`, `absent`) that is not a number counts as 0 here, where JavaScript's sum would be NaN (written as null); the runtime writes numbers. A vector holds "x" (counted 0 here).
* **A reminder written in a language the report does not list** is not counted in `byLanguage` here; the TypeScript would add a NaN member. The record carries the centre's languages only.
* **A rule id that is a member of `Object.prototype`** (`constructor`, ...): the TypeScript's `STOP_SITES[ruleId] ?? []` finds the inherited member and the report would not be made; Go
  treats it as an unknown rule (never counted).
* **An entry whose time does not parse** is left out of the month and of the counts (NaN comparisons are false in the TypeScript too); the ledger refuses such a record when the report is
  anchored (a vector holds it).
* **Settings with no payment block**: the TypeScript's `policyOf` keeps the whole payment and `capabilitiesOf(undefined)` reads the default provider; Go reads the same (a vector holds a
  tree with none).
* **`entryDigest`'s `notes` and `conversation`**: Fees leaves both out; Bookings' and Orders' leave only `conversation` out. `EntryDigest` here is Fees', not a reuse of
  `bookingsreport.EntryDigest`.
* **Fold `bookingsreport` and `ordersreport` onto `internal/report/reportkit.go` and `internal/reportwire`.** Both carry private copies of the tree helpers, the by-action table, the
  `{slot}` message mechanics (`metaBody`, `fillBody`, the settled-words and check-link choice), the random token, and (in `bookings` and `orders`) the messaging adapter, the `report`
  block reader and the options reader. About 400 lines can go. Not done in this stream: Stream OG works in `internal/orders` and Bookings' shared helpers, and the byte-exact vectors of
  both packages are the regression test for the fold.
* **Depends on `internal/bookingsreport`** for the record's ledger head, `GoLiveTree`, `Settings` and `ShopOf`/`ConfirmsAutomatically`. When those move to a shared package (they are
  generic), only the imports here change.
