# internal/stockorders: not done, and why

* **The monthly report** is ported (23 Nov, `go-so-report-23nov`): `internal/stockordersreport` (Explanation.md there), wired by `report.go` and `settingstree.go` here. **The go-live
  certificate's builder** (`report/certificate.ts`, run by the CLI and the deployer over the hand check) is NOT ported: the Go runtime reads a certificate, it does not make one (reason and what
  the deletion step must keep: `internal/stockordersreport/Deferred.md`). The template names are approved by the stand-in so a TypeScript-made report message still reads.
* **The assistant's routing words** (`routing.words`/`buttonPrefixes` of `stockSkill`: "supplier", "stock", "reorder" and their Hindi, Malayalam and Kannada forms): not used. The Go
  router recognises a case by its reference (`Owns`, `po-N`), as the Orders skill does; the words only help the model-less router guess a skill from a bare word, which no
  contract case or vector reaches.
* **Send-once timings on the real clock**: a refused order message tried again "an hour later" and a reminder left claimed are shared code (`internal/messaging` send once, with its
  own tests); the Stock orders contract holds the refusals, the lost reply and the kill, but not the hour (a fakes shop has no Guard to refuse on the test clock).
