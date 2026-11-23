# internal/orders: what is not here yet, and why

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

* **A chat guest's hold-to-talk**: `onMessage` takes a chat recording when `runtime.ChatTurn` hands one in, but the Orders Kit does not offer `runtime.ChatVoiceKit` yet (Bookings
  does not either), so the chat's voice button is off on Go.
* **The owner's once-a-day notice that customers' talk stopped** (conversation.ts capNotice, `CustomerTalkResult.NoticeDay`) is not sent, as in internal/bookings.
* **The tick's memory of one-time calls** (guard-wait.ts sendMemory) is not ported, as in internal/bookings (agent_watch.go says why).
* **The monthly report goes through the shop's WhatsApp as it is** (`ports.WhatsApp`), not through the owner's route (push.ts pushMessaging, as the TypeScript's runtime messaging
  is): an owner on push alone gets no report. This is internal/bookings' choice, kept the same here.
* **The settlement read in fakes mode**: the tick reads yesterday's settlements only from a gateway port that implements `payments.SettlementReader` (the Razorpay client);
  `payments.Fake` does not, so a stand-in shop's tick reads none where the TypeScript's stand-in reads an empty day. Nothing in the record differs for a day with no rows.
* **Amounts in rupees in the owner-marked words** are whole rupees (paise / 100 cut toward zero); the TypeScript passes a JavaScript number, so only a mark typed with paise reads
  differently (as in internal/bookings).

## Copies to hoist into shared packages

The owner's route (push.ts pushMessaging) and a page's outbox (outbox.ts channelMessaging) in `agent_say.go`, the watched services (`agent_watch.go`), the AI mode's lines
(`agent_mode.go`), the terms' adapters (`agent_owner.go`) and the `report` block's reader with the report's messaging adapters (`agent_after.go`) are internal/bookings' code,
copied because a template may not import another. Each is template-free and belongs in internal/runtime (or internal/report); both templates would then call the one copy.

## Left by the plans and the assistant (G3), and why

* **No vectors for the Orders skill's talk sources** (`Facts`, the owner's talk's numbers): Bookings proves its own against the TypeScript (gen_talk_facts_vectors.ts); Orders'
  are ported word for word but not yet proved by a generated file. They are data for the model, never shown as they are, and the talk's reply is checked against them.
* **The skill's routing words for customers** (assistant.ts `routing.words`, `buttonPrefixes`, `liveCaseOf`): the shared Go runtime has no routing of a customer's message to a
  skill (internal/bookings has none either); only `refs` (`Owns`) is used.
* **The plans' record lines' inputs** are Go maps, so their members are written sorted where TypeScript writes them in the literal's order (as every line G2 writes).
* **A plan type or a plan's slot no longer in the settings**: flow.ts throws (`planTypeOf(...)!`, `slotOf(...)!`); Go names the plan by its type id and leaves the plan alone
  (no renewal, no slot window). The settings check refuses such a file, so only a hand-edited store can show it.
* **The page head's character** (`Kit.OfferCharacter`) has no contract test; it is publicCharacter's two members (the name when given, the public face) over the same reads as
  the owner's mood.
