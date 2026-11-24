# The Orders runtime contract

A suite that describes what an Orders shop's runtime does **as the outside sees it**, so the TypeScript runtime and the Go runtime (decision 61) are held to the same tests. Every
test makes the shop's folder in a temp directory exactly as the deployer does, starts the shop as a **separate process** on a free port, and talks to it **only over HTTP and the
files the deployer writes**. It is the Bookings contract's method (read `templates/commerce/bookings/contract/README.md` first: its sections 1 to 5, the routes, the files, the
Guards, the timed work and the state, are the shared runtime's and hold here too, with the differences below). The recording Guard proxy and its captured answers are the
Bookings contract's (`guards.ts` imports its `recorder` and `fixture`); the process tracker, fake model, test-clock file, process starter and HTTP caller are `modules/test/contract/`.

```
(cd go && go build -o bin/orders ./cmd/orders)
node --test --test-concurrency=1 templates/commerce/orders/contract/        # the Go program go/bin/orders (or ORDERS_GO_BIN)
```

Since 24 Nov 2026 the shop runs on the Go program only: the TypeScript runtime this contract was written against was deleted (decision 61; go/TRIAL.md, "The switch"),
so `ORDERS_IMPL=ts` is gone (`ORDERS_IMPL` may still say go; anything else stops the run). Without the binary every test is skipped and says why. Nothing here is
TypeScript only. `cross-restart.test.ts` is a Go-to-Go restart on one folder (it ran the two runtimes in turn until then), and `differential.test.ts` holds the
public demo's TypeScript world (src/harness.ts) to the Go shop on the demo's own paths.

## How Orders differs from Bookings, as the outside sees it

* `/status` counts `orders` by state (`enquiry, awaiting_owner, awaiting_advance, confirmed, expired, cancelled, completed`); ids are `o-N` (`o-100002` after a restore).
* Two Guards: payments (the advance link for exactly the advance, `reference_id` the order's id; the balance's link `o-N.b`; refunds with receipt `o-N:<payment>`) and WhatsApp. No calendar.
* The page's request is `channel_request` op `order` (exact `lines`, `date` YYYY-MM-DD, `mode`, `slotId`, `address` for a delivery, `name`, `phone`, `language`); refusals are
  `unknown_item, too_many_items, bad_date, no_delivery, bad_slot, outside_area, paused, phone_busy, phone_day, shop_busy`. The view's `status` is `not_held` (a limit said no),
  `checking` (a big order waiting for the owner), `held`, `confirmed`, `expired`, `cancelled`, `done` or `refused`.
* The offer is `kind: "orders"`: the menu at the shop's prices and each day to `orders.daysAhead` with its slots (`open` while the cut-off has not passed and the slot is not
  full), what is `left` of each item (the smaller of the day's stock and the shelf count, less what is held) and whether the day is `full`.
* The owner's page lists `deposit`, `late_deposit`, `refund_owed`, `late_refund` and `big_order` items and the coming orders; `owner-stock` is served when the shop has the
  assistant (the shop's one stock count, `modules/stock`); the declared limits are the big-order line, the refund limit and the day's count (`src/chat-limits.ts`).
* The owner's fixed commands on WhatsApp: `approve o-N` / `deny o-N` (a big order, a late cancellation's refund), `balance o-N cash|upi|link`, the UPI marks with their code.
* The monthly report writes three files (the page, the owner's lines, the data); Orders has no monthly record certificate.

## The files

| File | Group | Shop | What |
|------|-------|------|------|
| `smoke.contract.test.ts` | S | fakes, guards | health, status, every credential, 405 and 404, the routes Orders must not have, recovery and status reports checked, data across a restart, folder refusals, the test clock refused live, the offer |
| `flow.contract.test.ts` | F | fakes (UPI, test clock) | a page order held and marked; every refusal; the offer counting holds; a slot's own limit; the per-number limit; "I have paid"; cancel; the big order; WhatsApp orders, read-back, way, slot and address, the limits, STOP, a voice note; the beat: a hold expiring with a late mark, the reminder and completion |
| `money.contract.test.ts` | M | guards (Razorpay) | the advance link's wire, the webhook as a reason to look, a repeat and a forged one, a second payment refunded, the WhatsApp quote and confirmation, a bakery's full payment, refunds in the window, held above the limit (refund-context, the approval), a late cancellation approved or denied, the balance by link |
| `recovery.contract.test.ts` | R | guards | the payments Guard down (waits), stopped (no wait), WhatsApp down at the payment, a kill while the link is made, a lost reply, a restart, `recheck_payment`, refused recoveries, a restore |
| `record-licence.contract.test.ts` | D | guards, fakes | agent.db's format and the order in `state_rows`, a newer schema refused, no number or name in the record, the licence's wind-down, final stop and notices, the monthly report once |
| `owner.contract.test.ts` | O | guards, fakes | the owner's commands without the assistant, the declared limits, the assistant's Orders skill (open orders, a card for a big order, the owner's cancel with its refund card, the app view and talk box), the Stock page and the shelf count |
| `chat.contract.test.ts` | C | fakes | a chat guest's order through the same flow, "Chat guest 1" to the owner, a send made again, Hindi, a model's answer checked and fallen back from |
| `plans.contract.test.ts` | P | fakes, guards on the test clock (plans, UPI; Razorpay for the credit going back) | a monthly plan asked, quoted and started by the owner's mark; skip before and after the cut-off; plan meals holding slot places (a second plan refused on a full slot, a skipped day giving its place back); the renewal with the credit carried, asked once; its reminder and its lapse with the credit owed back; a cancel mid-month with the unused days owed back; a cancel while the renewal waits; a pause and a resume credited at the renewal; a shop without plans; and (25 Nov 2026) the four plan messages that go out unasked in a closed window (the lapse, the hold that ran out, the credit going back and its wait for the owner) as their own templates, name and values (the `onClock` option: the shop runs as the hand check does, on the test clock, with the fake Guards over HTTP) |
| `push.contract.test.ts` | C | fakes | a customer's web push from a shop with no WhatsApp: an order page's next message pushed once through the push Guard in the page's words, an MCP order's alerts, a phone that stopped alerts, a 410 drops the phone |
| `gaps.contract.test.ts` | G | fakes, guards | money, limit, approval and licence behaviour only a unit test held before 23 Nov 2026: the same order again (one link), a changed order (old link closed, stock freed), a UPI mark of part of the advance, the balance marked once, a full-advance order with no balance, the late advance's 48-hour and 14-day windows, a slot's place given back, Guard's licence refusal (402), and the owner's cancel and refund from the chat (above the refund limit, a waiting order, a big order, a kept advance, a UPI shop) |
| `hold.contract.test.ts` | H | fakes (the hold shop, test clock) | "keep one for me", the no-advance pickup hold (24 Nov 2026): asked in words and accepted by the shop, the owner's no, the last unit asked for on another day (one active hold), a retry (one card, the same hold and time), a slot already over, a photo and a model number answered by the owner's pick (WhatsApp and the page's one card), STOP while the enquiry waits, collected (once; the page's button and the shared count lowered once), the end of the pickup time (released once, a late collection), the customer's cancel, the report's numbers, the order page and API refused; no link, payment or books line anywhere |
| `cross-restart.test.ts` | X | guards | a Go-to-Go restart on one folder (the TypeScript and Go runtimes in turn until 24 Nov 2026) |
| `differential.test.ts` | | guards | the public demo's TypeScript world and the Go shop on the demo's own paths, every WhatsApp message compared whole |

## The 36 unit-test files of `templates/commerce/orders/test/`, and where each ends up

**a** contract (the file above), **b** unit (a pure function: Go vectors made from the TypeScript), **c** demo (stays TypeScript), **d** other component (stays with it).

| Test file | Class | Where |
|-----------|-------|-------|
| accounting-figures | b | the report's money from the books (go/internal/ordersreport vectors) |
| accounting-pages | a | documents and the accountant's files: M, D |
| agent | a+b | F, M, G (flow and money; the same order again, a UPI part mark); the rule parser's phrases: go/internal/orders/reading vectors |
| approvals-guard-binary | d | the real Guard binary |
| approvers | a+d | the relay's replies are not the agent's: O; the relay's words: d |
| assistant, assistant-acts | a | O, G (the owner's cancel above the limit, of a waiting order, of a big order, a kept advance's refund, a UPI shop) |
| channels | a | F (the page through the runtime); the front's HTML is d |
| chat | a | C |
| full-chain | d | the local stack; its refund and restart cases are in M and R |
| guard-outage | a | R |
| language | b | go/internal/orders/words vectors |
| last-item | a | F (two customers for the last ones) |
| late-advance-card | a | F (the late mark after a hold ends), G (the 48-hour and 14-day windows) |
| licence | a+b | D, G (Guard's 402); the words: words vectors |
| limits | b | the pure limits (each also seen in F and M) |
| money-clarity | a | F, M |
| ondc | b | the ONDC mapping (pure; mapping only) |
| papers, review-sheet, walkthrough, sell-guide, situations | d | scripts, sell texts, crash-test situations |
| plans | a+b | P; the ledger's periods and the plan reading: vectors |
| reminder-balance | a | F (reminder, completion), M (balance by link), G (balance marked once, none to mark) |
| report, report-accounting, report-go-live, report-summary | b | ordersreport vectors; the monthly job: D |
| runtime, runtime-imports | a+d | R, D (restart, store round trip, refund context: M) |
| settings, slot-capacity | a+b | the settings' refusals (S, vectors), the slot limit: F, its place given back: G |
| stock | a+b | O (the shelf count over HTTP), go/internal/stock vectors |
| talk | a | C |
| voice-notes | a | F (a voice note on a shop without voice) |
