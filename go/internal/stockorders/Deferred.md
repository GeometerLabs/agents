# internal/stockorders: not done, and why

* **The monthly report and the go-live certificate** (`report/`: the data counted from the record, the page, the certificate, the owner's lines, the WhatsApp template). Not ported
  in this stream: the report is the largest piece after the agent and Bookings' took its own stream (`internal/bookingsreport`). A Go shop with a `report` block makes none; the
  contract's "the monthly report" case fails on Go until it is. The template names are approved by the stand-in so a TypeScript-made report message still reads.
* **The assistant block's own sentences**: a wrong `assistant` block is refused by the TypeScript with `readAssistantSettings`' words; here it is read by the shared runtime and not
  checked (the checker is `internal/bookings`' unexported reader; moving it to the runtime is a shared change for its own step).
* **Settings vectors**: the sentences are copied from `src/settings.ts`, not yet proved by vectors made from `validateSettings`.
* **The assistant's talk reads** (`facts`, `publicContext`), its open list and routing words, and the morning line over Stock orders: the skill here serves cards, the limits and
  the owner's page.
* **The owner's push** (a message to the owner also pushed to the phones that allowed alerts) and **waiting for a Guard that is down** inside a step (guard-wait.ts): the agent sends
  on WhatsApp directly; a Guard down during the step is a refusal of that one message.
