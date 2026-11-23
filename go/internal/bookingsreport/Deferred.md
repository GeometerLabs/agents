# Deferred in the Go Bookings monthly report, and why

* **`validateSettings`**: ported in `internal/bookings` (settings_check.go: `CheckSettingsFile` and `(*Settings).Tree`, the checked tree this package digests; its policy digest equals the
  TypeScript's on `bookings/testdata/settings-tree-vectors.json`). A caller must hand in that tree, never the raw file (Explanation.md, "Settings").
* **The go-live certificate's builder and pages** (`buildGoLiveCertificate`, `goLivePage`, `goLiveText`, `limitLines`, `summariseRun`, `summariseHandCheck`, `notTestedFor`,
  `writeGoLiveCertificate`) are the CLI's and the deployer's, which stay TypeScript; the runtime only reads a certificate (`ReadGoLive`, ported).
* **The Meta submission list and the example message** (`exampleValues`, `sampleMessage`, `reportSubmissions`, `report/review.ts`, `sample-shop.ts`, `example-month.ts`, `papers.ts`): not
  imported by the runtime.
* **The ledger's key log, checkpoint and evidence pack** (`genesisEvent`, `checkpointOf`, `anchorOf`, `evidencePack`, `ledgerFile`): only the head is needed by a report; the pack is the
  deployer's export and the CLI's.
* **An entry whose language is none of the four.** The TypeScript's `byLanguage[e.language]++` would add a key whose value is NaN (written as null); Go ignores such a message in the
  by-language counts (the total still counts it). A record entry's language is always one of the four.
* **Text that is not valid UTF-8 in the ledger body.** The TypeScript refuses a lone surrogate with a sentence naming the first bad path in insertion order of `refs`; Go refuses invalid
  UTF-8 with the same sentence, naming the path in the order seq, time, booking, action, outcome, inputsDigest, decisions, language, then refs in sorted key order.
* **`go/README.md` and `go/TRIAL.md` were not updated** (this stream was told not to touch them); the package map line is: `internal/bookingsreport/  the Bookings monthly report
  (templates/commerce/bookings/report/*): data, page, owner texts, certificate, WhatsApp message, signed summaries, ledger head, go-live reading, the monthly job's wiring`.
* **Not tested at the exact limit.** No vector lands exactly on 1024 UTF-16 units for the settled-words fit or the check link (the cases sit either side: 982 to 997 characters with the
  summary or #digest link, and 1007 and more with the #code link); `<=` against `<` at the boundary is therefore held only by reading the code (`report.MessageCheckLink` and the
  `fits` closure in `whatsapp.go` both use `<=`, as the TypeScript does).
* **Fixed on both sides on 22 Nov 2026 (go-w2-tsfix-22nov):** `workOf` cleared a refund held for the owner only when an `owner_decision` was written after it, so a hold
  settled by a person's word (Guard's already_done) or by the payments service's list, or ended by a refusal, left its booking "unresolved: refund-waiting-for-owner" in that
  month and every month after. A later `refund` line of the same payment that is confirmed, blocked or failed now ends it too (data.ts `holdEnded`, data.go). And a rule id
  that is a member of `Object.prototype` (`constructor`, `toString`) is an unknown rule in `STOP_SITES` (it threw, so no report was made; Go never threw); Orders' copy too.
* **"The UPI go-live certificate is read as the example"** (reported to stream B, 22 Nov): not found. A certificate made on the UPI example's settings and read by that shop is
  `own`, and Glow Salon's is `example` (report-go-live.test.ts); the hand check, the CLI and the runtime digest the same validated settings.
