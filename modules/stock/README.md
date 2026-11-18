# modules/stock: one stock count for a shop, shared by its page, its orders and its suppliers

## What it is for, and why

A small shop has the same thing in several places. A pet shop lists "two Persian kittens" on its page. A tiffin shop has a menu with a daily limit. A salon orders hair colour from a supplier. Each place used to know its own number, so the page could say "available" after the last one was sold, or a reorder could be forgotten.

This module keeps **one count per item** that the owner chooses to count. Every part of the shop reads the same count:

* the shop's page and the open feed show it as the **quantity**, and a counted listing **sells itself at 0**;
* **Orders** lowers it when an order is confirmed, puts it back when an order is cancelled, and will not take an order for more than is left;
* **Stock orders** raises it when the owner marks goods received (in full or in part), and starts **one** reorder when the count falls to the owner's low mark;
* the owner's **Stock page** in their app shows the counts, low items first, with big buttons to correct a count.

**Counting is optional for every item.** An item nobody counts has no stock line and behaves exactly as it did before: a listing is just available or sold, an Orders item is limited by its day's stock only, a Stock orders item has no count. Nothing in this module reads or changes an item that has no line.

It is a module, not a fifth template: it keeps no conversations, takes no orders and sends no messages. It is a small record and a few rules that the templates and the runtime use.

## Architecture

```
 owner's phone (the owner's app)          the shop's runtime (one per shop)                          the shop's agents
 ───────────────────────────────          ──────────────────────────────────                          ─────────────────
 Stock page ── POST owner-stock ──►  checkOwnerStock ─► kit.run (owner Authority) ─┐
 (set a count, "sold 1", low mark,                                                   │
  start / stop counting)                                                              ▼
                                                  assistant.stock  (plain JSON, saved with every step,
                                                  in the backup and the export)
                                                     ▲        ▲                ▲              │
        Orders agent ── reconcileSales (shopRecord) ─┘        │                │              │ low alert
        confirmed / completed order = sold, cancelled = back  │                │              ▼
        Stock orders agent ── reconcileDeliveries ────────────┘                │       Stock orders: settle() makes ONE order
        a delivery the owner marked received (cumulative)                      │       and its approval card (budget, cap,
                                                                               │       owner's yes: unchanged)
        listings kit / storefront / feed / talk sources ◄── read count ────────┘
        quantity = count, off the page at 0 (nothing written to the listing)
        morning line: "running low: 2"  (items with no supplier to ask)
```

Files:

| File | What it does | Touches disk or network? |
|---|---|---|
| `stock.ts` | The state, the id scheme, every rule: who may write, keyed effects, no double count, history and the horizons, low mark, reads | No (pure) |
| `kit.ts` | The owner's Stock page operations as events the runtime runs in a step, the pre-check, the owner's view | No (pure) |
| `words.ts` | Every line people read, in four languages, and the lines for the review sheets | No |
| `../channels/owner-stock-page.ts` | The owner's Stock page (plain forms, no script) | Served by the front |
| `../runtime/core.ts`, `http.ts`, `../channels/front.ts`, `backend.ts` | The route `/internal/channel/owner-stock`, the front's `/stock` and `/stock/op` | Run inside the shop's runtime |
| `../../templates/commerce/orders/src/order.ts` (`orderFacts`, `countedLeft`) and `agent.ts` (`reconcileStock`) | Orders reads its own orders as facts and keeps the count in line | No |
| `../../templates/commerce/stock-orders/src/agent.ts` (`syncDeliveries`, `lowStockTick`) | Stock orders adds deliveries and starts the reorder | No |

The module imports only `modules/memory` (for the owner's authority). No template is imported by a module, and no file here reads disk or imports `node:sqlite`, so the browser demo built from the agents can import it.

## The data

Everything lives in the shop's assistant state, `assistant.stock` (plain JSON, saved in the same transaction as every other change). The state is left out until the owner first counts something, so a shop that counts nothing saves exactly the bytes it saved before.

```ts
StockState {
  lines: StockLine[];
  alerts: LowAlert[];            // "this item is low", one per crossing, waiting to be shown (at most 50)
}
StockLine {
  id: "listing:l-3" | "menu:thali" | "supply:rice25";   // which kind of item it is, and its id there
  name?: string;                  // what the owner sees
  unit?: string;                  // the unit counted ("bag"); a delivery in another unit is refused, never converted
  count: number;                  // whole number, 0 to 1,000,000; never below 0
  low?: number;                   // the owner's low mark
  lowFlag: boolean;               // true while at or under the mark and the owner has been told for this crossing
  crossings: number;              // how many times the count has fallen to the mark (names a crossing)
  aliases?: string[];             // more ids that read and write this same line (a listing and a Stock orders item for the same rice)
  applied: { [key: string]: { qty: number; took: number; atMs: number } };   // what each key has already done
  moves: Movement[];              // the last 30 changes, for the owner's history
  startedMs: number;
}
Movement { kind: "started" | "sold" | "returned" | "received" | "corrected"; delta: number; after: number; atMs: number; by: "owner" | "operator" | "builder" | "shop"; short?: number }
LowAlert { line: string; crossing: number; count: number; atMs: number }
```

**The id scheme.** `listing:<listing id>` for a listing, `menu:<menu item id>` for an Orders menu item, `supply:<item id>` for a Stock orders item. The prefix names which kind it is, so a line is never confused between the three. A line may carry `aliases` when the owner links two items to one count.

**The export.** `stock.json` is in the owner's file (`bundle/backup/export.ts`, packaged as `stock/stock.json` by `bundle/export/build.ts`), and `assistant.stock` is in the nightly backup with the rest of the shop's state. A shop that counts nothing gets neither file.

**The record.** Every change the owner makes in their app, and every time the agents bring the count in line with their orders or deliveries, leaves a line with the action `stock`: the item's id, its kind, what changed and who. No customer, supplier or phone number is ever in it.

## Who may change a count, and who may not

* The owner's own acts (start counting, set a count, "sold 2", set the low mark, stop counting) need an **`Authority`** from `modules/memory` (`ownerAuthority`, or `panelAuthority` for the Operator and the builder). It is checked when the function runs: a copied object that merely says `{ by: "owner" }` is refused.
* A **sale** or a **delivery** is written only through a **`ShopRecord`**, made by `shopRecord()`. Only the two agents' own reconcile step makes one, from typed facts read from their own order state (an order's state and lines; a purchase order's received quantity). A test reads every source file and fails if anything else calls `shopRecord()`, or if code that reads a customer's, a guest's or a supplier's words imports this module.
* Nothing here takes text. A customer saying "I bought two" or a supplier saying "delivered" has no path to a count; they only matter when they move an order's state, and an order's state moves only through the payment record and the owner's own marks, as it did before.

## The events that move a count, and why each is safe against double counting

Every effect has a **key**, and the line remembers what each key has already done (`applied`). The functions take a **target**, not an amount to add: "this key stands for N". Asking again for the same key and the same target changes nothing.

| Event | Key | What it does | Why a repeat is safe |
|---|---|---|---|
| An Orders order is **confirmed or completed** | `sale:<order>:<item>` | target = the quantity ordered; the count falls by the difference from what the key already took | The same order and quantity again is the same target: nothing more is taken. Completing an order that was already booked is the same target. A restart reloads `applied` with the count. |
| An Orders order is **cancelled** | the same key | target = 0; the count rises by exactly what that key really took | Cancelling twice, or cancelling an order that never took anything, finds nothing to give back. |
| A Stock orders **delivery** is marked received | `delivery:<purchase order>` | target = the **total received so far** on that order; only the difference is added | "Received 4" then "received 6 more" adds 4 then 6. The same mark again adds nothing. A smaller total never takes goods away. A wrong item adds nothing. |
| The owner's **"sold 2"** | the page's request id | the same keyed sale | The form carries one request id, so a double tap or a re-sent form counts once. |
| The owner's **correction** | the page's request id, and the count the owner was looking at | sets the count | A retry is the same request. If the count moved while the owner looked (a sale came in), the correction is refused as stale instead of overwriting it. |

A count never goes below 0. A sale bigger than the count takes what is there and records the shortfall (`short`); a cancel gives back only what was taken.

### History: a count must not replay what happened before it began

Orders and Stock orders keep their old orders, and pass them to the count on every step, so the count has three rules about time:

1. **What came before counting began is already in the owner's count.** The owner counts what is on the shelf now. An Orders order whose slot ended at or before the line's start is *history*: it never moves the count and never counts as a hold. A delivery last marked received at or before the line's start is remembered (so a later mark adds only the difference) and moves nothing. Stopping a count and starting it again makes a new line, so the same rules apply again.
2. **A confirmed order whose slot has not ended is booked**, even if it was confirmed before counting began: its goods are promised, so the count falls by it. So count what is on the shelf *including* goods set aside for confirmed orders.
3. **A key outlives every fact that can name it.** The agents stop passing an order or a delivery 30 days after it finished (`FACT_HORIZON_MS`). A line keeps a key at least 45 days (`SAFE_KEEP_MS`, the only age the soft cap of 5,000 keys may evict) and drops it after 120 days (`APPLIED_KEPT_MS`). So a key is never forgotten while an order could still be passed, and an order too old to be passed cannot be booked again after its key is forgotten.

One edge is not solved (see `modules/Deferred.md`): a purchase order part-received before counting began and finished after is counted in full, because the purchase order keeps only its total, not when each piece came. The owner corrects it with one tap.

## How Orders uses it (and why Orders stays the source for what an order holds)

Orders works out what an order **holds** from the orders themselves: a confirmed order, or one waiting for its advance whose hold has not run out (`templates/commerce/orders/src/order.ts`, `holdsStock`). There is no counter to drift. This module does not change that.

The stock count is the **shelf**, not the holds. It falls only for an order that **stands** (confirmed or completed), and returns what a cancelled order took. To keep one truth:

1. An order that is only **holding** (waiting for its advance) lowers nothing. Instead, `countedLeft` takes what such orders hold off what is left, so two customers cannot both hold the last unit.
2. An order that stands is **booked** in the count. From then on it is not also counted as a hold (a hold is counted only while its key is not yet in `applied`), so it is never counted twice, in the gap between confirmation and the next reconcile either.
3. Orders brings the count in line at the start of every step and tick, and again before an availability check, so what the check reads is current.
4. The shelf check is a **second limit** with the same rule id as the day's stock (`within-stock`), so the table of what was stopped in a report is unchanged. An item with no line adds no decision and no record line: it is checked exactly as before.

The day's own stock (`dailyStock`) still applies. The shop's page shows the smaller of the day's stock and the shelf count.

## How Stock orders uses it

* **Deliveries.** When the owner marks goods received, the purchase order's total received so far is booked under `delivery:<po>`. The unit must match the count's unit; a delivery in another unit is not added, the owner is told once in their app, and nothing is converted.
* **Low stock.** When a counted item falls to its low mark, one alert is queued per crossing. Stock orders takes it off the queue first, then starts its existing reorder flow with the request id `low:<item>#<crossing>`: the same `settle` the owner's own "low rice" uses. That makes the order and **its approval card** (the budget, the cap, the approved supplier and the owner's yes are all unchanged); this module never approves or sends anything. One crossing makes at most one order, even if the owner cancels it. The question "Rice 5 kg is low (3 left). Order from Ravi Traders?" goes to the owner's app beside the card.
* An item with several approved suppliers asks which one, as the owner's own request does.
* If the owner is in the middle of another question, the reorder waits (its alert stays queued); it never overwrites that question. If the owner does not answer the reorder's own question it is asked up to three times (each runs out after 6 hours) and then left alone; the Stock page still shows the item as low.

## How listings use it

* A counted listing shows its **count** as `items[].quantity` in the open feed ([shop-feed/1](../../specs/shop-feed.md)) and as its quantity on the page. An uncounted listing shows the owner's own quantity if they gave one, as before.
* At 0 the listing is off the page, the feed and the shop's talk by itself. **Nothing is written to the listing** (its words, price and the digest its card was bound to are untouched); the count is the only thing that changed. The owner's list shows it as sold out.
* "Still have it? Yes" on a listing that sold itself at 0 sets the count to the number the owner first said (or 1) and the listing shows again. The morning card's Yes and the **Confirm** button on the owner's listings page do the same thing (both call `restoreAfterYes`), so the two doors agree. "Sold" marks it sold as before. The owner's listings page marks a counted listing at 0 as sold out.

## The low mark and the morning line

The count falling to the owner's low mark sets `lowFlag` and queues one alert; it clears only when the count rises above the mark again, so the next fall is a new crossing. For an item with no supplier to ask (a listing, an Orders menu item), the owner gets one line in their app, and the morning line says "running low: 2" (all four languages, in the existing morning template's `{today}` text, so no WhatsApp template changes). For a Stock orders item the reorder card replaces the morning line.

## Formats and protocols

No new protocol. The count appears in the open feed as `items[].quantity`, which [shop-feed/1](../../specs/shop-feed.md) already defines ("how many the shop has, when the owner counts them"), so the spec is unchanged. The owner's page talks to the shop's runtime on `/internal/channel/owner-stock` (GET the view, POST an op), with the owner's own credential checked there; the ops are `start`, `correct`, `sold`, `low` and `stop`. The runtime accepts these events only from its own HTTP layer, never from the inbox or the public channel.

## Security and privacy

* Only the owner's authority or the shop's own record of an order or a delivery changes a count (above). A test reads the sources to keep it so.
* The count is the shop's own business figure. No customer name, number or text is stored here or in its record lines. Order keys name the order's id and the item, not the person.
* The Stock page is the owner's: it checks their link or session at the runtime, sets `noindex`, and its content policy allows no script and no image.
* Nothing is sent to a supplier, a customer or a model by this module.

## Run it and test it

No build step. From `agents/`:

```
node --test modules/stock/test templates/commerce/orders/test/stock.test.ts templates/commerce/stock-orders/test/stock.test.ts
```

The tests use no network and no model: they use plain objects, the in-memory fakes of each template and a fake clock. Syntax of one file without running it: the repo's checker, or `node modules/module-map.ts` for the module's row.

## Extend it

* **A new kind of item** (say, a rental's equipment): add its prefix to `STOCK_KINDS` and `ID` in `stock.ts`, a `<kind>StockId` helper, and the template's own reconcile step that passes typed facts through `shopRecord()`. Add the kind to the words (`kinds`) and to `templateItems` in `runtime/core.ts` if the owner should be able to start counting it from the page.
* **A new language:** add it to `STOCK_LINE_WORDS` in `words.ts`, give every line, and put the lines on the review sheets.
* **Another reader of the count:** call `countOf`, `leftFor` or `quantityOfListing` on `assistant.stock`; never write to a line outside the functions in `stock.ts`.

## What is not built, and why

See `modules/Deferred.md`. In short: importing an item list or counts from a billing app; barcode scanning; saying "sold 2" in the owner's talk (the page has it); a WhatsApp template sentence for the low card (the card the owner taps is the existing order card, and the sentence goes to the owner's app, because a new WhatsApp template needs Meta's approval); a count per day or per place; the "Shop with stock" first-question preset (a preset adds no setting, and counting is chosen per item in the app); counting a Bookings or Fees shop's items (they have none).
