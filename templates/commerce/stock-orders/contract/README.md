# The Stock orders runtime contract

A suite that says what a Stock orders shop's runtime does **as the outside sees it**, so the TypeScript runtime and the Go runtime (decision 61, wave 2) are held to the same tests.
Every test writes the shop's folder in a temp directory as the deployer does, starts the shop as a **separate process** on a free port, and talks to it **only over HTTP and the
files it writes** (agent.db). It follows the Bookings contract (`templates/commerce/bookings/contract/README.md`); the generic pieces (the process tracker, the test-clock file, the
process starter, the HTTP caller) are shared from `modules/test/contract/`.

```
STOCK_ORDERS_IMPL=ts node --test --test-concurrency=1 templates/commerce/stock-orders/contract/        # the TypeScript runtime (the default)
STOCK_ORDERS_IMPL=go STOCK_ORDERS_GO_BIN=go/bin/stock-orders node --test --test-concurrency=1 templates/commerce/stock-orders/contract/
```

On `go` without the binary every test is skipped with "no Go Stock orders runtime yet (wave 2)". `cross-restart.test.ts` needs both runtimes and is skipped without the Go binary.
Nothing here is TypeScript only.

## The two kinds of shop

* **`mode: "guards"`** (the default): runtime.json `live`, WhatsApp is the fake Guard of `guards.ts` (a recording proxy in front of the shared WhatsApp stand-in,
  `modules/standins/whatsapp.ts`, with this template's approved templates), on the real clock. What went to whom is read from the stand-in's outbox: the approval card and its
  one-use code, the buttons, the supplier's order. Faults are plans on the recorder: a captured Guard refusal (`refused_rule`, 403: nothing was sent), a lost reply (the stand-in
  took the message, the shop never heard), a delay (to kill the process while the order is on the wire).
* **`mode: "fakes"`**: the runtime's own in-memory WhatsApp, on the TEST clock (`GEOMETER_TEST=1`, `GEOMETER_TEST_CLOCK_FILE`; `server/main.ts` takes the same seam Bookings' has),
  put at Mon 9 Nov 2026 10:00 in India. Nothing sent can be read from outside, so these tests read agent.db (the orders, the send-once intents, the record) and the owner's page,
  and answer cards from the page by case and digest.

## What the files hold the runtime to

| File | Group | Shop | What |
|------|-------|------|------|
| `smoke.contract.test.ts` | S | guards | /healthz /readyz /status (orders by state, no words), every token refusal, the routes a Stock orders shop must not have (404), the public offer (the shop's name only), /internal/events' checks, a folder refused (no WhatsApp, another version, bad settings), the data across a restart |
| `flow.contract.test.ts` | F | guards | request, card (buttons when the owner wrote), the typed code and the tap, one order message in the supplier's language as the approved template, a card used twice, a redelivered request, the list of lines, how many, low-stock reorder quantity, not in the catalogue, status, change before the yes, no change or cancel after it, the supplier's OK / no / STOP, a stranger's OK, a bare OK with two waiting, receipt in part and in full, wrong item, paid as a note |
| `limits.contract.test.ts` | L | guards | approved-supplier-only, order-quantity, per-order-cap, monthly-budget (with release), two cards racing for the budget, approval-matches-order (the price moved), reply-from-supplier, the decisions in the record |
| `sendonce.contract.test.ts` | R | guards | a refusal shown at once with Try now, three tries then not sent and the owner's "send", Cancel order; a lost reply: never sent again, They got it, Send it again (two, never three), the supplier's OK settles it; the process killed while the order is on the wire |
| `time.contract.test.ts` | T | fakes | a card running out, the supplier asked again at 4 and 24 hours about the same order (send once), the owner told once, ask again from the page; a question running out; the monthly report once on the first morning |
| `owner.contract.test.ts` | O | guards | the owner's page items and digests (a stale press does nothing, a press twice once), received from the page, the coming list, the talk box needs the assistant, the app view; the Stock page: candidates, deliveries added once by what was marked, a unit refused, a low mark starting one reorder |
| `record.contract.test.ts` | D | guards | agent.db's format and the append-only record, the saved state member for member, the owner's words only as a keyed digest, a restore moving the counter on by 100000 |
| `cross-restart.test.ts` | | guards | the TypeScript and Go runtimes in turn on one folder, both ways |

## What the harness imports, and a deletion wave must keep

`src/language/meta-templates.ts` and `report/whatsapp.ts` (the templates the stand-in approves), `settings/glow-salon.example.json`, `package.json` (the version), the Bookings
fixture `test/fixtures/guard-responses.json` (Guard's captured answers), `modules/standins/{whatsapp,http}.ts`, `modules/messaging/messaging.ts` (the fake),
`modules/channels/{owner-link,owner-grants}.ts`, `modules/runtime/test-clock.ts`, `modules/core/time.ts` and `modules/test/contract/`.

## What the TypeScript does that the suite pins (nothing was changed)

* A message to the owner outside their 24-hour window that has no WhatsApp template of its own (for example "the supplier asked for no more messages") goes as the generic
  `stock_owner_notice` with no parameters; a provider that knows only the real templates refuses it, so the owner is not told. The tests open the owner's window first.
* A request delivered twice with the same message id is a duplicate at the queue (`/internal/events` answers `duplicates: 1`); the agent never sees it, so its own "delivered twice"
  line is for a provider that redelivers under a new task.
* A press on the owner's page for a card that was replaced keeps its own digest, so it is judged (and answered "already answered or replaced"), not refused as stale; only a digest
  that is not the card's is refused.
