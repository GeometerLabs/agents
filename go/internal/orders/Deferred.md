# internal/orders: what is not here yet, and why

## Left to the next parts of wave W4

* **The agent** (`agent.go` is a stand-in: every event, beat and give-up is `runtime.Unported`). G2 ports src/agent.ts over this package's store, reads and settings. Until
  then every contract test that needs a message, a payment or a tick handled fails on Go.
* **The plans** (`src/plans/flow.ts`, `ledger.ts`): `Store.Plans` is raw JSON; only `PlanMealsInSlot` reads it (a read-only view of the parts a slot's count needs). G3 types it.
* **The assistant** (`src/assistant.ts`, the Orders skill): the page head's character (`Kit.OfferCharacter`) and the owner page's `app` view (`Kit.OwnerApp`) are hooks, nil
  until G3 fills them; the views are then a shop-without-assistant's.
* **The monthly report and the daily settlement read**: `internal/ordersreport` is ready; its wiring (runtime.json `report`, `NewMonthlyJob` over `Settings.Tree()`, the record and
  the orders) is G3's, as books.go says.
* **cmd/orders** wires the settings, store, payments, WhatsApp, push routing, the page base and the saved stock. The router (internal/orders/reading), the shop terms, voice and
  the report are added with the agent.

## Not in the shared runtime yet

* **The daily compaction** (core.ts calls `kit.compactStore`): the Go runtime has no hook for a template's store. `Kit.CompactStore` is written and tested (`TestCompactStore`);
  calling it once a day needs a small optional interface in internal/runtime (a shared change, left to the lead).

## To hoist into one shared package

`settings_check.go`'s readers of the payment block, `approvers`, `assistant` and its character, and the reader's small parts (`keyOrder`, `unknownKeys`, `whole`), are a copy of
internal/bookings' (this package may not import a template). Fees will need them too: one shared package (`internal/settingsread`) with Bookings and Orders both calling it is
the next clean-up, with both templates' settings vectors as its proof.

## Small differences kept on purpose

* `toLowerCase` of an item's name is Go's simple mapping (a dotted capital I or a final sigma could compare differently; no menu has one).
* `jsJSON` of an object inside a sentence lists its keys sorted (only a weekday or a language that is an object would show one).
* `itemsText` and `orderWhat` of an item that is no longer on the menu, and a plan type no longer in the settings, use the id; the TypeScript would throw (`!`) for the first and
  the last.
* `words.MessageFacts` leaves an empty `slotChoices` list out where the TypeScript writes `[]`; nothing reads the difference.
