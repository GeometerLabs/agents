# Deferred in the Go Bookings monthly report, and why

* **`validateSettings` is not ported.** The report digests the validated settings; the caller must hand them in as such (Explanation.md, "Settings"). The Bookings runtime's settings loader
  is the place for it; until then a settings file with a default left out gives a policy digest the TypeScript would not give.
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
