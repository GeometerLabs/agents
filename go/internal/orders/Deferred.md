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

Since 23 Nov 2026 the watched services, the owner's route and a page's outbox are no longer copied here: Orders uses `bookings.Watch`, `bookings.OwnerMessaging` and
`runtime.ChannelMessaging`, as Fees does. Still copies of internal/bookings' code: the AI mode's lines (`agent_mode.go`), the terms' adapters (`agent_owner.go`), the `report`
block's reader with the report's messaging adapters (`agent_after.go`), and the settings readers (above). The readers were not folded in stream OG because the two Go copies differ
in small ways. For `"payment": null`, Bookings' Go reader (which Fees uses too) says "Add how customers pay". The TypeScript's one `readPaymentSettings` and Orders' Go copy say
"must look like". That is a sentence of Bookings' Go that differs from its TypeScript, reported in go/TRIAL.md. Orders also checks a module against the capabilities list.
Folding needs a settings vector of each such case, so that the one shared reader is the TypeScript's.

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
* **Paths a contract case runs since 23 Nov 2026** (both runtimes): a renewal with its credit carried and asked once, its reminder and its lapse with the credit owed back, a
  cancel mid-month with the unused days owed back, a cancel while the renewal waits, a pause and a resume credited at the renewal. Still not run by any test on Go: a delivery
  plan's address, a renewal paid twice on a gateway shop (a renewal needs the test clock, a gateway payment needs the guards mode, and a shop has only one of the two; the
  second-payment path is the same one money.contract runs for an order), the morning line's Orders part, the page head's character and the owner's talk's sources (`Facts`).

## TypeScript findings

Fixed on 23 Nov 2026 in both runtimes, with a test on both sides (go/TRIAL.md, section go-orders-gaps-23nov): a plan's waiting payment cancelled by the owner now gives the
plan up. Two are left for stream FA, which owns `modules/assistant` and `gen_words.ts`. The help lines still give Bookings' examples ("cancel b-14"), and the late-refund card
still says "deposit".

A new one, not fixed: a customer with no running plan who writes "cancel my plan" (or "my plan") is read as asking to subscribe (`readPlanIntent`: a message that names a plan,
from a customer with none, is a subscription when the shop has plan types). They are quoted a new plan, or asked which one, instead of being told they have none. Go reads it the
same way.

## The pickup hold (24 Nov 2026, stream PH): what is left, and why

* **The photo itself is not forwarded.** The inbox keeps only that a message was a picture (`InboundMessage.Image`), never its media id, and the WhatsApp Guard has no
  send-by-media-id route. The owner's card says to see the photo in their chat with the customer (the shop's own WhatsApp app, coexistence). Forwarding it needs the inbox to
  keep the media id and a Guard route: a change to Guard, which needs the owner's yes.
* **Only the owner's number (and the owner's page) marks "collected".** Staff on their own numbers would be the approvers list or a staff list: not built.
* **A price other than the listed one.** The owner picks the listed item, so its listed price is the price; a different price is changed in the listing (or by E1's discounts).
* **The shop's assistant** does not list the hold's cards in "what needs me" (its card words are not written); the owner's page and WhatsApp do.
* **The order page, the API and MCP** take no hold (`whatsapp_only`).
* **The demo engine's hand check** runs no situation on a hold shop (the TypeScript demo has no hold); the go-live certificate says every situation was not run, with why.
* **E4, a credit limit per customer, is not built (not approved).** Where it would fit if approved: a hold shop has no money owed, so E4 belongs to the credit book.
* **One customer, one live hold.** A second item while one is held or asked is answered with the first; several items at once are one order with several lines.
