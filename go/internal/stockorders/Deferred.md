# internal/stockorders: not done, and why

* **The monthly report** is ported (23 Nov, `go-so-report-23nov`): `internal/stockordersreport` (Explanation.md there), wired by `report.go` and `settingstree.go` here. **The go-live
  certificate's builder** (`report/certificate.ts`, run by the CLI and the deployer over the hand check) is NOT ported: the Go runtime reads a certificate, it does not make one (reason and what
  the deletion step must keep: `internal/stockordersreport/Deferred.md`). The template names are approved by the stand-in so a TypeScript-made report message still reads.
* **The assistant block's own sentences**: a wrong `assistant` block is refused by the TypeScript with `readAssistantSettings`' words; here it is read by the shared runtime and not
  checked (the checker is `internal/bookings`' unexported reader; moving it to the runtime is a shared change for its own step).
* **Settings vectors**: the sentences are copied from `src/settings.ts`, not yet proved by vectors made from `validateSettings`.
* **The assistant's talk reads** (`facts`, `publicContext`) and its open list and routing words: not ported; the skill serves cards, the limits and the owner's page. (**The morning line** over
  Stock orders is done, 23 Nov: `report.go` runs it after the monthly report from `Agent.AfterTick`, over the skill's `Waiting` and `Problems`, read-only, as `core.ts` `daily` does.)
  The talk reads and the open list are a new set of words and facts for the model, a piece of work of its own (the assistant is Stream FA's ground this round).
* **The owner's push** (a message to the owner also pushed to the phones that allowed alerts) and **waiting for a Guard that is down** inside a step (guard-wait.ts): the agent sends
  on WhatsApp directly; a Guard down during the step is a refusal of that one message.
