# Deferred in the Go Bookings monthly report, and why

* **`validateSettings` is not ported, and this matters.** The report digests the validated settings; the file on disk can be raw (`geometer deploy` ships the owner's text), so a Go runtime
  that hands in the file as read gives a policy digest the TypeScript would not give, and a go-live certificate then reads as "different" (Explanation.md, "Settings"). The Bookings
  runtime's settings loader must port it (or the runtime must read settings through a validator); it is the one known way for the two runtimes to disagree.
* **The go-live certificate's builder and pages** (`buildGoLiveCertificate`, `goLivePage`, `goLiveText`, `limitLines`, `summariseRun`, `summariseHandCheck`, `notTestedFor`,
  `writeGoLiveCertificate`) are the CLI's and the deployer's, which stay TypeScript; the runtime only reads a certificate (`ReadGoLive`, ported).
* **The Meta submission list and the example message** (`exampleValues`, `sampleMessage`, `reportSubmissions`, `report/review.ts`, `sample-shop.ts`, `example-month.ts`, `papers.ts`): not
  imported by the runtime.
* **The ledger's key log, checkpoint and evidence pack** (`genesisEvent`, `checkpointOf`, `anchorOf`, `evidencePack`, `ledgerFile`): only the head is needed by a report; the pack is the
  deployer's export and the CLI's.
* **An entry whose language is none of the four.** The TypeScript's `byLanguage[e.language]++` would add a key whose value is NaN (written as null); Go ignores such a message in the
  by-language counts (the total still counts it). A record entry's language is always one of the four.
* **A rule id that is a member of `Object.prototype`** (`constructor`, `toString`, `__proto__` ...): `STOP_SITES[d.ruleId] ?? []` finds the inherited member in the TypeScript and
  `.includes` is then not a function (a TypeError, so the report would not be made); Go treats it as an unknown rule (never counted). Rule ids are fixed names.
* **Text that is not valid UTF-8 in the ledger body.** The TypeScript refuses a lone surrogate with a sentence naming the first bad path in insertion order of `refs`; Go refuses invalid
  UTF-8 with the same sentence, naming the path in the order seq, time, booking, action, outcome, inputsDigest, decisions, language, then refs in sorted key order.
* **`go/README.md` and `go/TRIAL.md` were not updated** (this stream was told not to touch them); the package map line is: `internal/bookingsreport/  the Bookings monthly report
  (templates/commerce/bookings/report/*): data, page, owner texts, certificate, WhatsApp message, signed summaries, ledger head, go-live reading, the monthly job's wiring`.
* **Not tested at the exact limit.** No vector lands exactly on 1024 UTF-16 units for the settled-words fit or the check link (the cases sit either side: 982 to 997 characters with the
  summary or #digest link, and 1007 and more with the #code link); `<=` against `<` at the boundary is therefore held only by reading the code (`report.MessageCheckLink` and the
  `fits` closure in `whatsapp.go` both use `<=`, as the TypeScript does).
* **TypeScript behaviour that may be a bug (copied, not changed):** `workOf` clears a refund held for the owner only when an `owner_decision` is written after it. A held refund that a person
  settled by their word (Guard's already_done, no owner decision) or that the payments service later confirmed with no owner answer leaves its booking "unresolved:
  refund-waiting-for-owner" for that month and every month after, though the refund is settled (the vectors' b-6 and b-7, `rules-gateway`, show it). Whether the real flow always writes
  an `owner_decision` was not checked.
