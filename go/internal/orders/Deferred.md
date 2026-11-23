# internal/orders: what is not here yet, and why

## Left to the next parts of wave W4

* **The plans** (`src/plans/flow.ts`, `ledger.ts`): `Store.Plans` is raw JSON; only `PlanMealsInSlot` reads it (a read-only view of the parts a slot's count needs). G3 types it.
* **The assistant** (`src/assistant.ts`, the Orders skill): the page head's character (`Kit.OfferCharacter`) and the owner page's `app` view (`Kit.OwnerApp`) are hooks, nil
  until G3 fills them; the views are then a shop-without-assistant's.
* **The monthly report and the daily settlement read**: `internal/ordersreport` is ready; its wiring (runtime.json `report`, `NewMonthlyJob` over `Settings.Tree()`, the record and
  the orders) is G3's, as books.go says.

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

## Left by the agent (G2), and why

* **The plans and the assistant** run through two seams (`agent_seams.go`: `newPlans`, `assistantFor`), nil until G3 fills them. Until then a plan's period payment that is
  recorded ends `runtime.Unported` (it is never confirmed as an ordinary order), messages about a plan are read as ordinary words, and a shop with an `assistant` block answers its
  owner with the fixed commands only (its talk box and cards are said as "a shop without the assistant"). The owner's morning line goes at the end of `AfterTick` (G3's).
* **A chat guest's hold-to-talk**: `onMessage` takes a chat recording when `runtime.ChatTurn` hands one in, but the Orders Kit does not offer `runtime.ChatVoiceKit` yet (Bookings
  does not either), so the chat's voice button is off on Go.
* **The owner's once-a-day notice that customers' talk stopped** (conversation.ts capNotice, `CustomerTalkResult.NoticeDay`) is not sent, as in internal/bookings.
* **The tick's memory of one-time calls** (guard-wait.ts sendMemory) is not ported, as in internal/bookings (agent_watch.go says why).
* **Amounts in rupees in the owner-marked words** are whole rupees (paise / 100 cut toward zero); the TypeScript passes a JavaScript number, so only a mark typed with paise reads
  differently (as in internal/bookings).

## Copies to hoist into shared packages

The owner's route (push.ts pushMessaging) and a page's outbox (outbox.ts channelMessaging) in `agent_say.go`, the watched services (`agent_watch.go`), the AI mode's lines
(`agent_mode.go`), the terms' adapters (`agent_owner.go`) and the `report` block's reader with the report's messaging adapters (`agent_after.go`) are internal/bookings' code,
copied because a template may not import another. Each is template-free and belongs in internal/runtime (or internal/report); both templates would then call the one copy.
