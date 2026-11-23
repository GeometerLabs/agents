# The discount authority (E1, decision 64, 24 Nov 2026)

One package for every template that sells at a list price. Bookings and Orders use it now; the Service desk's estimates and Quotes are meant to use it later. No template keeps a copy.

## What the owner sets

```json
"discounts": { "capPercent": 10, "capInr": 100, "floors": { "haircut": 350 } }
```

- `floors`: per item or service, the lowest price the agent may ever agree. An item not named keeps its list price as its floor (no discount).
- `capPercent` and `capInr`: what the agent may take off **alone**. The lower of the two wins. The percentage is of the line's list total, rounded down to a whole rupee. The rupee cap applies to one ask (the whole discount on that line, quantity included), not per unit.
- Left out, the authority is **off**. No `*Settings` exists, `Decide` is never called, and the templates' `price-at-or-above-list` / `price-at-or-above-menu` rule runs exactly as before. Every older contract case passes unchanged.

The settings check is `modules/limits/discounts.ts` `readDiscounts` (the panel and the deployer validate with it) and `Read` here, with the same sentences in the same order. Vectors come from running the TypeScript (`go/scripts/gen_bookings_settings.ts`, `gen_orders_settings.ts`). A Bookings floor is never below the deposit: Guard holds the deposit link to exactly the deposit (`deposit-amount`), so the deposit must always be part of an agreed price.

## The decision (`Decide`)

| The ask | Kind | Verdict | What happens |
| --- | --- | --- | --- |
| at or above the list | `at_list` | allow | as before |
| item with no floor | `no_floor` | block | as before (the old rule and the old words) |
| below the floor | `below_floor` | block | refused; the list price is stated once (`price_floor`); a `discount` record line `blocked`, `by: rule` |
| within the cap | `within_cap` | allow | the agent agrees (`discount_agreed`); `discount` line `confirmed`, `by: agent` |
| beyond the cap, at or above the floor | `ask_owner` | hold_for_owner | the owner gets a card; the customer hears `discount_asked`; nothing is held; `discount` line `held_for_owner` |

The cap used is the one **in force**: the file's own value, or a tighter value the owner tapped on the limit card that the deployer has not yet written to the file.

## The card and its binding (B74)

The case keeps its `discount` member (`Deal`): the item, quantity, list price, offered price, discount, total, state and the card's `Code`. `CodeOf` is six letters of sha256 over the case and every one of those fields.

- The owner answers `approve b-3 K7M2QX` or `deny o-3 K7M2QX`, giving the case **and** the code. The template acts only when that case's card waits with exactly that code, and the case recomputed now still gives that code. Otherwise nothing is done and the owner is told (`owner_discount_stale`).
- Any change to the item, quantity, price or total gives another code. The old card's yes then names a code nothing waits for. Orders decides again on a changed order and sends a new card. Bookings does the same on a new price.
- The same ask again gives the same code: no second card and no second record line. The customer hears `discount_asked` again.
- A plain `approve b-3` while a card waits is answered with the exact words to send (`owner_discount_use_code`), and nothing is done.
- **The money comes from the deal, never from the model's words.** In Orders, `proceed` sets the order's total from `Deal.TotalInr`, and the advance, the balance and the payment link follow it. Bookings' link stays the deposit, and the agreed price is the booking's own, in the record and the words.
- The card is a WhatsApp template in four languages (`owner_discount_ask`), because it goes out on its own, usually outside the owner's 24-hour window.

## Record and report

- Each decision is one `discount` line. The record keeps only a digest of the inputs, so the amounts go in refs: `rule`, `item`, `qty`, `listInr`, `offeredInr`, `discountInr`, `totalInr`, `code`, `by`.
- `Count` turns the lines into the monthly report's `discounts` block: given (count, paise), asked, refused. `discountsOfMonth` in TypeScript does the same.
- The block is left out when the month has no discount line. Every report of a shop without the authority keeps its bytes, digest and code.
- The page shows three rows, and the owner's text adds one line.

## The limit card and the owner's assistant

- `LimitDecls` declares the two caps (`discount_cap_percent`, a count shown with `%`; `discount_cap_inr`, rupees) only for a shop with the block.
- They are tightened by a tap on the assistant's limit card and loosened only behind the passkey page, as every limit is.
- The deployer finds them in `DISCOUNT_CHAT_LIMITS` (`bundle/lib/kinds.ts`). They are kept out of the templates' `CHAT_LIMITS`, so the public demos show the limits they always did.
- `TalkFact` gives the owner's talk a source, "Discounts this month: …", read from the record, so "discounts this month" is answered from what was recorded.

## Before the pilot (24 Nov 2026, `e1-finish-24nov`)

**The panel's boxes** (`bundle/panel/discounts.ts`). The Bookings deposit step and the Orders rules step have a switch (off by default), the two caps and a floor box for each service or menu item. The boxes are checked by `readDiscounts` itself, against the items as typed (named by what the Operator wrote, since a new shop has no ids yet), so the Operator reads its sentences. A Bookings floor is checked against the deposit typed on the same step. The draft keeps each floor under the item's name, so moving or adding a line in step 1 does not hand a floor to another item. At the save, the floors move onto the ids the items got. The panel now owns the `discounts` key (`keep.ts`): switched off, the block is deleted. A saved floor of a service the form does not show is kept, and so is a draft saved before the boxes existed. The words are in four languages and on the review sheets (`discounts.*`).

**The card on the owner's page.** A waiting card is an owner item of kind `discount` (Bookings `ownerItems`, Orders `OwnerItems`), with its item's name, the quantity, the list price, the price asked and the total, never its code. Its digest is over the card's code, which is over every field the card shows. A press is turned by the runtime into the owner's own `approve b-3 <code>` or `deny b-3 <code>` (`onOwnerAction`), so `onDiscountAnswer` is the only place that decides:
- A press made before the ask changed finds no item with its digest and does nothing.
- So does a press made after the card was answered, on WhatsApp or on the page, so one card counts once.

The assistant's "what needs me" lists the card (`card.answer.discount`, four languages). Its yes sends the same command, with the code taken from the item the card's digest is bound to.

**"Any discount?" without a number.** The rules read it into the intent's `askDiscount` (`modules/understanding/rules.ts` `DISCOUNT_ASK_RE`: en, hi, ml, kn and Latin letters). They set it only when no price is named, because a named price wins. The model reading carries it too (schema, prompt, shape and the decision read), within the shop's budget as every reading. It changes no intent kind, so a shop without the block answers exactly as before.

With the block, the agent offers `CapPrice`: the list price less the most the cap in force allows on the line, spread over the quantity and rounded down so the line never passes the cap, never below the floor. That price goes through `decideOffer` like a named one. **It is recorded as agreed at once** (`confirmed`, `by: agent`), because the agent has said the price and the customer may go on at it; the report counts it as given.
- No item or service in the conversation: the customer is asked which one (`discount_which`), and nothing is recorded.
- A card waiting for the owner is not voided: the customer hears `discount_asked` again.
- A lower price already agreed or approved stands and is said again.
- When nothing may be given alone (no floor, a cap of 0, or a floor at the list price), the list price is stated once (`price_floor`).

**The order's page** (Orders `OrderView`). A line of the deal's item is shown at the agreed price of one, with the menu price beside it as `listInr` (struck through on the page). The deal is on one item, so the customer and the owner read the agreed price where the item is, and the lines add up to the total the link charges. A separate "discount" line would leave the item at a price nobody pays. Only a live deal changes a line.

The receipts and the owner's page show no price per line: what the order is for, and the amounts paid or asked, which already follow the agreed total.
