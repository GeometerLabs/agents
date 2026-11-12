# Orders template (pre-orders with an advance)

Market: Commerce (food shops that take orders for a day and a slot).

A WhatsApp agent for tiffin services, bakeries, caterers and the like. A customer writes what they want ("2 veg thali tomorrow lunch pickup"); the agent holds the order for a short time, asks for an **advance** (all of the order, or a part of it), and **confirms the order only when the payment record shows the advance**. The advance is paid to the shop's own UPI ID and **marked received by the owner** (the default, `payment.module: "upi"`), or paid through the shop's own Razorpay account (`"razorpay"`), where the agent reads the payments service's own list. The agent works inside limits the owner sets and that are held **outside the AI**.

**What this folder is, and is not.** It is the Orders template, built and checked against **stand-in services** (a stand-in WhatsApp, a stand-in Razorpay, a model of Guard, and the owner's UPI marks). It runs as a server the way Bookings and Fees do (one SQLite file per shop, a signed-webhook inbox, an approvals relay), and `geometer shop add --template orders` starts a shop on a Geometer server. It has been run against no real WhatsApp, Razorpay or UPI account and **no shop is live on it**. Nothing here is a claim about real services. It has no dependencies; most of the code is in [`agents/modules/`](../../../modules/README.md).

## Run it

```sh
node --test templates/commerce/orders/test/                          # the tests
node templates/commerce/orders/scripts/hand-check.ts                 # the hand check on Annapurna Tiffins (UPI); add --details, or --settings shop.json
node templates/commerce/orders/scripts/hand-check.ts --settings templates/commerce/orders/settings/annapurna-tiffins-razorpay.example.json
node templates/commerce/orders/scripts/walkthrough.ts                # the conversation the sell guide quotes (--lang hi|ml|kn)
node templates/commerce/orders/scripts/report-example.ts             # an example month's report
node templates/commerce/orders/scripts/guard-spec.ts --settings templates/commerce/orders/settings/annapurna-tiffins-razorpay.example.json --tenant annapurna --reviewed-by builder-arjun
node templates/commerce/orders/scripts/go-live-certificate.ts --settings shop.json --lang hi --out ./out
node templates/commerce/orders/scripts/client-report.ts --settings shop.json --record entries.json --orders orders.json --month 2026-11 --lang hi --out ./out
node templates/commerce/orders/scripts/whatsapp-templates.ts         # rewrites whatsapp-templates.json, the list to submit to Meta
node templates/commerce/orders/scripts/review-sheet.ts hi            # the review sheet (also ml, kn)
```

The hand check prints `Held N of M. K failed. J not tested.`, a line for each situation and the list of what was not tested. Annapurna Tiffins on UPI: **Held 17 of 17** (82 checks), 2 situations not run (they need Razorpay). The same shop on Razorpay: **Held 18 of 18** (89 checks), 1 not run (a UPI screenshot). Sweet Crumbs Bakery (pickup only, full advance, no approval line): **Held 16 of 16**, 3 not run. Every situation is judged from the stand-ins' own records, never from what the agent said; the count is a count of those situations, not a verdict on the agent.

## What the customer sees

- **An order from one sentence.** Items with quantities ("2 veg thali", "veg thali x 2", "two" or "teen" in words, one to ten), a day ("tomorrow", "11 nov", a weekday that is read back), a slot (its name "lunch", its time "12 pm", or a tap on the list), pickup or delivery (buttons), and for a delivery an address.
- **The quote.** The items, the day and the window, the total, the advance and the link (UPI: the UPI ID, a QR picture, and "the owner confirms"). The order is held for `advance.holdMinutes` and **never past the cut-off**.
- **Confirmed** only when the payment record shows the whole advance. "I have paid" in words, a button or a screenshot confirms nothing; on a UPI shop it asks the owner to look.
- **Cancel.** Inside the window the advance goes back (Razorpay: through Guard; above the refund limit Guard holds it for the owner; UPI: the owner owes it and the customer hears "sent" only after the owner marks it). Outside the window the owner decides.
- **STOP** ends every message.

## What the owner sees

A message for each thing that needs them: a new order (what to prepare, for when, the total, what to collect, the address), an order above their approval line ("approve o-3"), a cancellation, a late cancellation to decide, a UPI payment to look for (with a code and a Received button), a refund to send, a customer who asked to talk. The monthly report, on WhatsApp on the 1st, and a page behind a link.

## The shop's assistant (item 11e)

With an `"assistant": {}` block in the settings, the owner can also write in their own words, in four languages, and the assistant answers in text: "open orders", "what needs me" (a big order or a late refund comes as a card), "message o-5 Your cake is ready".
Anything that moves money, and a message to a customer, comes back as a card with the exact change, done only by a tap; a card's yes on something waiting is the owner's
own fixed reply (`approve`/`deny`), which keeps working as before. Cancelling or refunding from the chat is not in the first release. A short morning line goes to the owner
from 08:00. How it works: [modules/Explanation.md](../../../modules/Explanation.md#the-shops-assistant-item-11e-decision-43-12-nov-2026).

## The rules held outside the AI

| Rule | Where |
| --- | --- |
| Never below the menu price (the price is also the floor) | `price-at-or-above-menu` |
| At most so many items in one order (Guard bounds a link by the same number) | `order-size` |
| Never more of an item than the day's stock, counting what other orders hold | `within-stock` |
| Never more orders for a day than the shop takes | `within-day-cap` |
| No order after the cut-off for its day and slot | `before-cutoff` |
| A delivery address must name a place on the shop's list | `within-delivery-area` |
| "Confirmed" only when the payment record (or the owner's UPI mark) shows the advance | `confirm-only-when-recorded` |
| A second payment on an order is not another advance | `one-advance-per-order` |
| A refund is never more than was paid; above the limit it goes to the owner | `refund-limit` |
| STOP ends messages; every amount, day, slot and item count matches the record | `opt-out`, `message-matches-record` |

They are pure functions (`src/limits.ts`). Stock and the day's count are **worked out from the orders** (confirmed ones, and ones whose hold has not run out), never kept as counters, so an expiry, a cancellation or a restart cannot leave a number that disagrees. A payment that arrives after the hold is taken again only if the cut-off, the stock and the day still allow it (Razorpay), and is refunded if not; on UPI a mark after the hold never confirms an order by itself.

## Settings

A shop is a JSON file ([annapurna-tiffins.example.json](settings/annapurna-tiffins.example.json), [annapurna-tiffins-razorpay.example.json](settings/annapurna-tiffins-razorpay.example.json), [sweet-crumbs.example.json](settings/sweet-crumbs.example.json)); the agent says in plain words what is wrong with it.

| Setting | What it is |
| --- | --- |
| `name`, `address`, `timezone`, `languages` | The shop's name, where it is, the time zone, the languages customers are written in |
| `menu` | Items: an id, names per language, `priceInr` (also the floor) and `dailyStock` |
| `orders` | `maxPerDay` (orders), `maxItemsPerOrder` (bounds a payment link), `daysAhead` |
| `cutoff`, and a slot's own `cutoff` | `daysBefore` and `time` ("20:00"): when orders for a day close |
| `pickup.slots`, `delivery.slots` | Windows ("12:00" to "13:00") with an id and names ("lunch") |
| `delivery.area` | A plain list of places; an address naming none of them is not delivered to |
| `advance` | `mode` full or part, `percent`, `holdMinutes` |
| `cancellation.windowHours` | Cancel at least this long before the slot and the advance goes back |
| `refund.limitInr` | The refund the agent may ask for alone; above it Guard holds it for the owner (Guard's threshold is made from the same number) |
| `payment` | `{"module": "upi", "upi": {"id", "payee"}}` (the default) or `{"module": "razorpay"}` |
| `owner` | WhatsApp number, language, `approveOverInr` (an order above it waits for the owner; 0 is never) |

## Languages

Hindi, English, Malayalam and Kannada, and the Hindi, Malayalam and Kannada people type in Latin letters. All messages are fixed templates; every item, quantity, amount, day, time, place and link is filled in from the record, and the outgoing check reads the final text against the record before it is sent. The Hindi, Malayalam and Kannada wording is **machine-written and waits for a native speaker**: [REVIEW-hi.md](REVIEW-hi.md), [REVIEW-ml.md](REVIEW-ml.md) and [REVIEW-kn.md](REVIEW-kn.md) list every line (made from the code; a test fails if a sheet falls behind).

## Guard

`scripts/guard-spec.ts` writes the Razorpay limits spec with the shared generator (`modules/payments/guard-limits.ts`): links from ₹1 to the dearest order the shop can take (`order-amount`), refunds at most that (`refund-at-most-order`), the owner's threshold the same number as the refund limit, one refund per payment, no payouts. The amounts in a Razorpay call are JSON numbers, so the spec declares no text encoding. A UPI shop has no Razorpay Guard.

## Sell it

[`sell/guide.en.md`](sell/guide.en.md) (and `.hi`, `.ml`, `.kn`) teaches a local partner or a builder to pitch it, and `sell/one-pager.*.html` is the sheet the owner keeps. The only claim about money is: "No order confirmed without the payment record (or your confirmation for UPI); every refund tracked."

## What is in the folder

| Path | What |
| --- | --- |
| `src/agent.ts`, `src/order.ts` | The agent (one event in, done, back) and the order as a state machine with the stock worked out from the orders |
| `src/limits.ts`, `src/guard-limits.ts`, `src/settings.ts` | The pure limits, the Guard spec numbers, the settings and their checks |
| `src/language/` | The messages in four languages, the buttons and lists, the Meta template list, the outgoing check's facts |
| `src/adapters/` | The rule parser (items, quantities, day, slot, way), the intents, the reading steps |
| `crash-test/`, `scripts/hand-check.ts` | The situations, the plan that picks them from any shop's settings, the not-tested list |
| `report/`, `server/`, `inbox/`, `approvals/` | The monthly report, certificate and papers; the runtime; the entry points and the relay's voice |
| `sell/`, `whatsapp-templates.json`, `REVIEW-*.md` | The sell guide, the list to submit to Meta, the review sheets |

## What is not done yet

See [Deferred.md](Deferred.md).
