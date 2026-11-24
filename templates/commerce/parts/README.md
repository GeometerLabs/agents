# A shop of several parts

Decision 65 (owner, 24 Nov 2026): one shop can run several template parts behind its one WhatsApp number and its one assistant, for example the credit book, Stock orders
and the pickup hold. The higher price slabs pay for it. Which slab allows how many parts is set in economics, not here: the limit is one setting, `plan.<plan>.parts` in the
price list in force, and with no such setting there is no limit.

The owner never chooses a part. The shop reads each message and hands it to the part it belongs to. When two parts could take a message, the shop asks one short question
instead of guessing about money.

## What a shop of parts is

- **The settings** (`settings.json`). The shop's own keys sit at the top: `name`, `address`, `timezone`, `languages`, `owner` and `assistant`. Each part's own keys sit in
  `parts.<template>`, in the shop's order. A part is one of `fees` (the credit book is its `creditBook` block), `orders` (the pickup hold is `"advance": {"mode": "none"}`)
  and `stock-orders`. Each part is checked by its own template on the top keys plus its block, so a part's settings mean what they mean in a single-part shop.
  An object at both the top and a part joins member by member. The usual one is the owner: `{"whatsapp", "language"}` at the top and Orders' `approveOverInr` in its block.
  `carried` names the template the shop was before it took a second part. The example is
  [settings/ganesh-electricals-starter.example.json](settings/ganesh-electricals-starter.example.json).
- **The program.** `go/cmd/parts` with `go/internal/parts` runs the shop. It is the parts' own Go code, unchanged, inside one program, with one store, one record, one
  stock count, one owner's sign-in and one assistant. The pin is `parts@<version>`.
- **The router.** Each part says, by its rules alone, how sure it is that a message is its own: its command with its own case (`approve o-3`, `po-4`, a mark code in its
  ledger), its own words (`Ramesh owes 2,400`), an open conversation, or "a new customer, and I take new customers". The highest claim takes the message. A tie means the
  shop asks the person who wrote one short question (the words are in [src/words.ts](src/words.ts)), keeps the message, and hands it to the part the answer names. A STOP
  reaches every part that knows the number.
- **The owner's page** is one page: every part's items, the credit book's rows, the one assistant, and the Money section summed over the parts.
- **The record** is one record. A part's lines carry `refs.part`, and each part reads back only its own lines. Document numbers are the shop's, worked out over the whole
  record.
- **The WhatsApp templates** of the number are the union of its parts' templates (and the assistant's), each once, in [src/whatsapp.ts](src/whatsapp.ts).

## In the panel

A shop page has **Parts of this shop** (`/shops/<id>/parts`). A live single-template shop takes a second part there and becomes a parts shop, with its old template first
and carried. A part is taken out only when nothing of it is open, and never the carried part or the last one. The rules are in `bundle/panel/parts.ts`.

## Checked by

- `contract/parts.contract.test.ts`: the shop's own six situations on the starter shop (the owner's words, the customers, a question, a redelivery, one owner's page, one
  stock count).
- `contract/live.contract.test.ts`: a live hold shop takes two parts and lets one go.
- `contract/settings.test.ts` and `contract/words-fresh.test.ts`.
- Each part's own contract suite runs through this program with `CONTRACT_PARTS=first` or `CONTRACT_PARTS=last` ([contract/via-parts.ts](contract/via-parts.ts)).

The go-live hand check runs the shop's situations and then every part's own situations, all on this program
([crash-test/hand-check.ts](crash-test/hand-check.ts)). What is not built yet is in `bundle/Deferred.md` under decision 65.

## Modules it uses

<!-- modules it uses: made by modules/module-map.ts from the imports; run `node modules/module-map.ts --write` -->

The shared modules Parts uses, from its code's own imports: [`assistant/`](../../../modules/README.md#what-is-here), [`channels/`](../../../modules/README.md#what-is-here), [`core/`](../../../modules/README.md#what-is-here), [`crash-test/`](../../../modules/README.md#what-is-here), [`language/`](../../../modules/README.md#what-is-here), [`limits/`](../../../modules/README.md#what-is-here), [`report/`](../../../modules/README.md#what-is-here), [`runtime/`](../../../modules/README.md#what-is-here), [`standins/`](../../../modules/README.md#what-is-here).

What each one does and what a template hands it: the table in [modules/README.md](../../../modules/README.md#what-is-here). A new template uses the same modules the same way.

<!-- end of modules it uses -->
