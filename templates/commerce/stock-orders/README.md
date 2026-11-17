# Stock orders template (reordering from approved suppliers)

Market: Commerce (a salon, a small retailer or an input dealer that reorders from a few known suppliers).

A WhatsApp agent for the owner. The owner writes "order 10 boxes of hair colour from Ravi Traders" (or marks an item low). The agent works out the **exact order** from the owner's approved supplier list and catalogue (supplier, item, unit, last price; the total is worked out in code), shows it as a **card the owner approves**, **reserves the month's budget with that approval**, sends the order to the supplier's WhatsApp number as a template message, records the supplier's OK, asks a silent supplier again about **the same order**, and records the delivery when the owner marks it received (all, part, or the wrong item). **The supplier's OK is not receipt of goods, and receipt is not payment.** Paying the supplier is not built: the owner pays as today and may note "paid po-3".

**What this folder is, and is not.** Built and **checked against stand-in services only** (a stand-in WhatsApp). **No shop is live on it**, no real supplier has been messaged, and no real Meta template has been approved. It is deployable like Bookings, Orders and Fees: a runtime server with a saved store (`server/`), the owner's page, the shop's assistant, the panel's phone setup, a Guard list of the numbers a message may go to, a monthly report and go-live certificate, and sell guides and one-pagers in four languages. The tests were written and have not all been run together yet (see Explanation.md). Paying the supplier, a real WhatsApp test and the rest are in [Deferred.md](Deferred.md). It has no dependencies; most of the care is in [`agents/modules/`](../../../modules/README.md).

**A restart cannot send the order twice (send once, 17 Nov).** A step is saved when it ends, so the step does not send the order message: it records it, and the runtime sends it after the step is saved, with a claim saved before the send and an ending saved after (`modules/messaging/send-once.ts`). If the process dies anywhere in between, the order is marked "may or may not have reached the supplier", is never sent again by itself, and the owner's page asks: "They got it" or "Send it again" (the owner's own choice, and the supplier may then see it twice). A refusal that says nothing went out is tried again an hour later, three tries at most. Not tested on a real provider.

## Run it

```sh
node --test templates/commerce/stock-orders/test/                      # the tests (not run in the stream that wrote them: see Explanation.md)
node templates/commerce/stock-orders/scripts/hand-check.ts             # the hand check on Glow Unisex Salon; add --details, or --settings shop.json
node templates/commerce/stock-orders/scripts/whatsapp-templates.ts     # rewrites whatsapp-templates.json, the list to submit to Meta
node templates/commerce/stock-orders/scripts/review-sheet.ts hi        # the review sheet (also ml, kn)
```

The hand check prints `Held N of M. K failed. J not tested.`, a line for each situation and the list of what was not tested. Every situation is judged from the stand-ins' own records (the WhatsApp outbox, the orders, the action record), never from what the agent said. No count is quoted here: the count is whatever the lead's last run printed.

## The limits held outside the AI

| Rule | Rule id | What it means |
| --- | --- | --- |
| An order goes only to an approved supplier on the owner's list | `approved-supplier-only` | An unknown or paused supplier gets nothing |
| A whole quantity, at most a set number | `order-quantity` | "1000" for "10" is a typing slip, not an order |
| One order is never worth more than the cap | `per-order-cap` | A hard stop: the owner's yes cannot raise it (the Operator changes the setting) |
| The month's approved orders never add up to more than the budget | `monthly-budget` | Reserved with the approval; worked out from the orders, never a counter |
| One request makes at most one order | `one-order-per-request` | Even when the supplier's reply is lost; a redelivered message does nothing |
| An approval counts only for the exact fields shown | `approval-matches-order` | A changed quantity, price or month voids it |
| Only the supplier's own number answers for the supplier | `reply-from-supplier` | A stranger's "ok" counts for nothing |
| The order message is sent only for an approved order | `send-only-when-approved` | Every send, reminder and retry passes this gate |
| STOP ends messages; every amount and number matches the record | `opt-out`, `message-matches-record` | The shared two |

They are pure functions ([src/limits.ts](src/limits.ts)).

## Settings

A shop is a JSON file ([glow-salon.example.json](settings/glow-salon.example.json)); the agent says in plain words what is wrong with it.

| Setting | What it is |
| --- | --- |
| `name`, `address`, `timezone`, `languages` | The shop, where, the time zone, the languages |
| `owner` | WhatsApp number and language |
| `items`, `units` | What can be ordered and the packs ("box", "piece", "bottle"), with names per language |
| `suppliers` | An id, name, aliases, WhatsApp number, language and `approved` (false: paused) |
| `catalogue` | One line per item, supplier and unit with the last price; `reorderQty` is what a low-stock mark orders |
| `limits` | `maxPerOrderInr`, `monthlyBudgetInr`, `maxQuantity` |
| `followUpHours` | When a silent supplier is asked again, e.g. `[4, 24]`; the last tells the owner |

## What the owner writes

"order 10 boxes of hair colour from Ravi Traders" · "shampoo from ravi is low" · "yes CODE" / "no CODE" (or the card's buttons) · "change po-3 12" (before approval) · "received po-3", "received po-3 6", "wrong po-3" · "paid po-3" (the owner's note) · "cancel po-3" · "send po-3" (only after WhatsApp refused it) · "status".

## Languages

English, Hindi, Malayalam and Kannada. All messages are fixed templates; every item, unit, quantity, amount, supplier and order number is filled in from the record, and the outgoing check reads the final text against the record before it is sent. The Hindi, Malayalam and Kannada wording is **machine-written and waits for a native speaker**: [REVIEW-hi.md](REVIEW-hi.md), [REVIEW-ml.md](REVIEW-ml.md), [REVIEW-kn.md](REVIEW-kn.md).

## Sell it

[`sell/guide.en.md`](sell/guide.en.md) (English, Hindi, Malayalam and Kannada; the last three are machine-written and wait for a native reader; the one-pagers and the ask cards are in the same four). The one claim about money-adjacent behaviour: "No order goes to a supplier without your yes, and it is always the exact order you saw."

## What is in the folder

| Path | What |
| --- | --- |
| `src/agent.ts`, `src/order.ts` | The agent (one event in, done, back) and the order, its states and the budget worked out from the orders |
| `src/limits.ts`, `src/settings.ts`, `src/reading.ts` | The pure limits, the settings and their checks, the rule reader |
| `src/assistant.ts`, `src/channel.ts`, `src/chat-limits.ts`, `src/guard-limits.ts` | The shop's assistant skill (open orders, what waits, the talk's reads; its acts are the agent's own approve, decline and cancel), the owner's page items, the two limits the owner may tighten by a tap, the numbers Guard lets a message go to |
| `server/` | The runtime: start, config, services, the saved store and its snapshot, on `modules/runtime` |
| `report/` | The monthly report (orders placed, answered, received, part or wrong, budget used; "paid" only when the owner marked it) and the go-live certificate |
| `clients/glow-salon.example/` | An example shop folder to start the server on (`node server/main.ts --client ...`) |
| `src/language/` | The messages in four languages, the button labels, the Meta template list, the outgoing check's facts |
| `src/harness.ts` | The agent on the in-memory fakes, with a clock you move |
| `crash-test/`, `scripts/` | The situations, the plan that picks them from any shop's settings, the not-tested list, the hand check, the generators |
| `sell/`, `whatsapp-templates.json`, `REVIEW-*.md` | The sell guide, the list to submit to Meta, the review sheets |

## Deploying it

`geometer shop add --template stock-orders` finds it from `template.json` (the panel's phone form has two steps: the shop with its suppliers and catalogue lines, then the cap and the budget). A shop's WhatsApp is required: runtime.json must name `messaging`, and there is no payment service. The Guard in front of WhatsApp is given the owner's number and the approved suppliers' numbers only (`approved-recipients-only`, from `src/guard-limits.ts`); the per-order cap and the month's budget are held by the agent and the approval card, not by Guard (a WhatsApp message carries no amount Guard can read). The owner's page lists orders waiting for their yes, orders no supplier has answered, and deliveries to mark; there is no public page for this template.

## What is not done yet

See [Deferred.md](Deferred.md).

## Modules it uses

Modules it imports: `assistant/` (the approval card, cards.ts, state.ts), `core/`, `crash-test/`, `language/`, `limits/`, `messaging/`, `record/`, `reminders/`, `understanding/` (the shared yes, no and STOP words). Other modules' places are listed in [modules/README.md](../../../modules/README.md).

## Modules it uses

<!-- modules it uses: made by modules/module-map.ts from the imports; run `node modules/module-map.ts --write` -->

The shared modules Stock orders uses, from its code's own imports: [`assistant/`](../../../modules/README.md#what-is-here), [`channels/`](../../../modules/README.md#what-is-here), [`core/`](../../../modules/README.md#what-is-here), [`crash-test/`](../../../modules/README.md#what-is-here), [`language/`](../../../modules/README.md#what-is-here), [`licence/`](../../../modules/README.md#what-is-here), [`limits/`](../../../modules/README.md#what-is-here), [`messaging/`](../../../modules/README.md#what-is-here), [`push/`](../../../modules/README.md#what-is-here), [`record/`](../../../modules/README.md#what-is-here), [`reminders/`](../../../modules/README.md#what-is-here), [`report/`](../../../modules/README.md#what-is-here), [`runtime/`](../../../modules/README.md#what-is-here), [`understanding/`](../../../modules/README.md#what-is-here).

What each one does and what a template hands it: the table in [modules/README.md](../../../modules/README.md#what-is-here). A new template uses the same modules the same way.

<!-- end of modules it uses -->
