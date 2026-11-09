# Orders: why it is built this way

Plan item B55: pre-orders with an advance payment, a pickup or delivery slot, "paid" judged from the payment record, stock and per-day limits, and refunds that ask the owner. This note is the reasoning; the facts are in [README.md](README.md).

## Which template it copies

Orders is **Bookings with the calendar taken out**. A customer starts the conversation, the agent holds something for a short time, asks for money, and confirms when the money is on record, as Bookings does. What Bookings keeps in a calendar (is this time free) Orders keeps in the orders themselves (is there stock left, is the day full). So the agent's flow follows Bookings; the packaging (the server with two Guards, the report, the certificate, the papers) follows Fees, which is the template that has no calendar. Nothing was moved into `modules/` for it, apart from three small edits listed below; it imports the modules and no template, and `test/runtime-imports.test.ts` plus `modules/test/boundary.test.ts` keep it so.

## Stock and the day's count are derived, not counted

The first design question was where "12 thalis left" lives. A counter goes wrong the first time a hold expires without the agent running, a cancellation is replayed, or the store is restored from a snapshot. So there is no counter. `takenOf` and `ordersOn` (src/order.ts) add up the orders that hold stock *right now*: confirmed ones, and ones waiting for their advance whose hold has not run out. An expiry is therefore not an event that has to be run correctly; it is a clock passing. The runtime test restores a snapshot and checks the stock again.

Two rules follow from that, and both are tried by the hand check:

- **A hold never outlives the cut-off.** The hold is the lesser of the shop's hold time and the time left to the cut-off. After the cut-off the stock is back, whatever the customer was told.
- **A late payment is taken again only if the world still allows it.** On Razorpay, when the advance arrives after the hold ended, the agent runs the same checks as for a new order (cut-off, stock, the day's limit) and confirms if they pass; otherwise the advance is refunded and the customer and the owner are told. On UPI the owner's mark after the hold never confirms an order by itself: the owner owes the money back, or keeps it for an order they take by hand (the same rule as Bookings).

## What the AI does not decide

The reading steps (rules, then the decision model, then the small language model, plus buttons) only turn a message into an intent: items, a day, a slot, pickup or delivery, a price named. They never decide. The menu price is a floor (`price-at-or-above-menu`), the quote is always the menu price, stock and cut-off are pure functions of the settings and the orders, and a delivery address is accepted only if it names a place on the shop's list. The model's answer is reduced to a kind, a language and a price, so a fooled model changes nothing. Items, the day and the slot come from the rules alone; a message that needs the model to find them is asked again with the menu list.

## The money rules

- **Confirmed only when recorded.** The advance is counted from the payments service's own list (Razorpay) or from the owner's UPI marks, and the "Confirmed" message passes a gate that reads the record (`confirm-only-when-recorded`). A part payment (the owner marks less) keeps the order held and asks the owner for the rest.
- **Part or full advance.** `advance.mode` full asks for the whole total; part asks `percent` of it, rounded up to a whole rupee. The balance is paid at pickup or delivery and is not tracked (listed under not tested).
- **Refunds.** Never more than was paid. Inside the cancellation window the advance goes back, above `refund.limitInr` through Guard's hold and the approvals relay. Outside it the owner decides, once, in the ordinary conversation ("approve o-3"). Guard's threshold and the agent's limit are one number.
- **An order above the owner's line** (`owner.approveOverInr`) waits for the owner before any payment is asked: nothing is held and no link is made until they say yes, and the checks run again when they do, because the world may have moved.
- **A dearest-order bound.** Guard bounds a link to a range, not a list, so the settings carry `orders.maxItemsPerOrder` and the link's upper bound is that many of the dearest item. The settings refuse an order bigger than the day's refund cap, in plain words, so the failure is at setup and not at the till.

## The address

A delivery address is the customer's, written for the owner. It is kept in the order, is in the one message to the owner when the order is confirmed (a template of its own), and goes to the customer's chat never (they are told the *place*). The export (for the panel, and the builder's or partner's copy) removes it. The record does not keep it either: it notes the place that matched.

## Choices worth knowing

- **Two confirmations, two owner messages.** A UPI shop's "the owner has confirmed" and a Razorpay shop's "we have received" are two messages, and a delivery order's owner notice (with the address) is its own message. A WhatsApp template is the wording of exactly one message, so a message whose wording changes with the order would not fill back into its template. Each variant that reaches the owner is its own template; customer confirmations in other variants go as plain text inside the 24-hour window (they are replies), listed in Deferred.
- **Panel and report.** The panel's setup, the go-live certificate, the monthly report, the unfinished-work list and the papers are one more row in tables the panel already had for Bookings and Fees (`bundle/lib/kinds.ts`, `bundle/panel/setups.ts`).
- **No stand-in server, no local stack.** Bookings and Fees carry HTTP stand-ins and an end-to-end stack. Orders does not (Deferred): the runtime, the inbox and the relay are the shared ones, and the runtime test and the panel's flow tests cover its own parts.

## Edits outside the template

1. `modules/unfinished/builtin.ts`: `payment_unrecorded` also applies to Orders (an order waiting for its advance), and a `big_order` waiting for the owner counts as an answer the owner owes.
2. `bundle/lib/kinds.ts`, `bundle/backup/export.ts`, `bundle/export/build.ts`, `bundle/services/{relay,heartbeat}.ts`: Orders is one more kind; the export writes `orders.json` with the customer hashed and the address removed.
3. `bundle/panel/`: see `bundle/panel/Explanation.md`.

## Size

Measured 9 November 2026. `templates/commerce/orders` code (src, server, inbox, approvals, report, crash-test, scripts): 6,591 lines; tests: 1,820 lines (plus the panel's 13 and the bundle's); the four-language messages and report words (`src/language/templates.ts`, `report/strings.ts`) are 954 long lines and over half the bytes. Panel and bundle: a per-template table (`bundle/panel/setups.ts`) replaced the two-way Fees branches rather than adding a third, and Fees' pages are byte-identical. Nothing was copied from another template's source file that a module already holds: the agent, limits, words, report counting and settings are Orders' own; the server, inbox, relay, payments, refunds, UPI, the record, the reports' signing, the papers and the reading steps are the shared modules.
