# Deferred in the Go Stock orders monthly report, and why

* **The go-live certificate's builder, page and text** (`report/certificate.ts`: `buildGoLiveCertificate`, `summariseRun`, `summariseHandCheck`, `goLivePage`, `goLiveText`,
  `writeGoLiveCertificate` in `run.ts`) and the command line (`cli.ts` except `readGoLive`, `review.ts`, `papers`-style options). The certificate is MADE by the CLI and the deployer, which run the
  hand check (`crash-test/situations.ts`, TypeScript) and stay TypeScript until the deployer's own switch; the Go runtime only READS one (`golive.go`), as Orders' does. Of the certificate's
  words only `cert.held` is carried (the monthly report's go-live lines use it); the rest belong to the certificate's page. The deletion step must keep this TypeScript (or port the hand check
  and the builder) until the deployer no longer calls it.
* **The sample month, the review sheets and the Meta submission list** (`review.ts`, `whatsapp.ts` `sampleFor`, `sampleMessage`, `exampleValues`, `reportSubmissions`): a review and
  command-line use, not the runtime's.
* **Stock orders has no monthly record certificate** in the TypeScript, so there is none here and the monthly job sends no certificate document.
* **A rule id that is a member of `Object.prototype`**: `RULE_IDS.includes("constructor")` is false in the TypeScript and in Go alike, so it is counted under "other" in both (a vector holds it).
* **An entry whose time does not parse** is left out of the month and of the counts (NaN comparisons are false in the TypeScript too); the ledger refuses such a record when the report is
  anchored (a vector holds it).
* **The `assistant` block of the digest is built for a valid block only** (`stockorders/settingstree.go assistantTree`): this package does not yet check the block (stockorders/Deferred.md),
  so a block the TypeScript would refuse gives some tree here and no error. The shared reader of that block is Orders' unexported one; move it to the runtime and use it here.
* **Not tested at the exact limit.** No vector lands exactly on 1024 UTF-16 units for the check link; `<=` is held by reading the code.
* **Depends on `internal/bookingsreport`** for the record's ledger head, `GoLiveTree`, `Settings`, `ShopOf` and `Pathway` (generic). When those move to a shared package, only the
  imports here change.
