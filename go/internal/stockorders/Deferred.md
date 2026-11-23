# internal/stockorders: not done, and why

* **The monthly report and the go-live certificate** (`report/`: the data counted from the record and the orders, the page, the owner's lines in each language, the WhatsApp
  template with the report code and the check link, the go-live certificate). Not ported in this stream because it is large: the TypeScript is about 1,470 lines, and the pattern
  to follow (W4's `internal/ordersreport` over `internal/report`) is about 1,750 lines of Go plus a words generator and a vectors generator for the page and the four languages'
  lines. A Go shop with a `report` block makes none; the contract's "the monthly report" case fails on Go until it is (61 of 62). The template names are approved by the stand-in so
  a TypeScript-made report message still reads. The deletion stream must keep Stock orders' TypeScript `report/` until then.
* **The assistant block's own sentences**: a wrong `assistant` block is refused by the TypeScript with `readAssistantSettings`' words; here it is read by the shared runtime and not
  checked (the checker is `internal/bookings`' unexported reader; moving it to the runtime is a shared change for its own step).
* **Settings vectors**: the sentences are copied from `src/settings.ts`, not yet proved by vectors made from `validateSettings`.
* **The assistant's talk reads** (`facts`, `publicContext`), its open list and routing words, and the morning line over Stock orders: the skill here serves cards, the limits and
  the owner's page.
* **The owner's push** (a message to the owner also pushed to the phones that allowed alerts) and **waiting for a Guard that is down** inside a step (guard-wait.ts): the agent sends
  on WhatsApp directly; a Guard down during the step is a refusal of that one message.
