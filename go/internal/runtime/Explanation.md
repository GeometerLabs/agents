# internal/runtime: the chat and a customer's talk (wave 2, Bookings slices 2 and 3; 19 Nov 2026)

What this package is, overall, is in `go/README.md` and `go/TRIAL.md`. This file says what the chat added, and why it looks as it does.

## The chat (`modules/channels/chat.ts`, `state.ts`, `outbox.ts`, `chat-guest.ts`, `http.ts`)

| TypeScript | Go |
|---|---|
| `ChannelState` (`seq`, `outbox`, `requests`, `chat`, `guests`) | `chatstate.go` `ChannelState`: typed once for every template; members and keys come out in the order the TypeScript makes them, a key this version does not know is carried through raw, no HTML escaping. `requests` is the template's own and stays raw. |
| `channelMessaging`'s `keep`, `markMoment`, `compactChannel`, `chatConversationOf` | `ChannelState.Keep`, `MarkMoment`, `Compact`, `ChatConversationOf` |
| `chatTurn`, `forgetChat`, `CHAT_LIMITS`, `guestTurnsPerDay` (decision 62; the old 20 only when `budget.guestTurnsPerDay` is missing), `chatMayPing`, `chatPingGate`, `chatThread`, `createRate` | `chat.go` `ChatTurn`, `ForgetChat`, the `Chat...` constants, `GuestTurnsPerDay`, `ChatMayPing`, `ChatPingBlock`, `ReadChatThread`, `Rate` |
| the quick taps and the rate and voice words | `chatwords/words.json`, written by `go/scripts/gen_chat_words.ts` from `words-chat.ts` / `words-chat-more.ts` |
| `GET /internal/channel/chat`, the 429 at the events door, `chat-voice` | `chatroutes.go`, `kitserver.go` |
| `POST /internal/channel/chat-id` | `chatidroute.go` over `internal/chatid` |

A chat send runs the TEMPLATE's message step: `ChatTurn` takes it as a function (`ChatTurnDeps.Run`), exactly as `chatTurn` takes `run: onMessage`. This package never imports a template. What the
agent core has to give it is in `TRIAL.md` ("Wave 2: the chat and the customer's talk").

The state is read by `GET /chat` from the last SAVED state, through the kit's optional `ChannelStater` (cheap) or, without it, from `KitState.Members()`. Nothing is saved by a read.

## A customer's talk (`modules/assistant/talk-customer.ts`, `talk-run.ts`, `conversation.ts` `talkToCustomer`)

`StepContext.CustomerTalk` (`talkcustomer.go`) is `talkToCustomer`'s first half: the gates (shop's switch, no model, button mode, the AI cap, the month budget, the day's cap, an override attempt),
the model call counted in the month (the same `askMetered` the owner's talk uses), the answer read by hand (`assistant.ReadCustomerAnswer`), the five checks (`assistant.CheckTalk`, the customer's
role: one checker for both roles, as `talk-check.ts` has one) and the `talk` line of the record, which for a customer names only the check that failed. What it returns is the text and the facts the
OUTGOING check reads; the template says it through its own say (which runs that check again) and adds its menu's words to the facts. The prompt is `customerPrompt` rendered by the TypeScript
(`go/scripts/gen_customer_talk.ts`, `internal/assistant/customerwords/words.json`).

Where it differs from the brief: the customer's talk is in `internal/assistant` (the pure part) and here (the run), not `internal/understanding`, because the sources and the checks are the assistant's and
`understanding` is below it (`assistant` imports it).

## Tests

`chat_test.go` is `channels/test/chat.test.ts`'s own cases over a fake template step, plus the saved state's round trip. `assistant/talkcustomer_test.go` runs 97 checks, 20 model answers and 25 prompts the
TypeScript made (`go/scripts/gen_customer_talk_vectors.ts`). `internal/chatid` has its own tests with a software passkey.

## Work after a beat that saves for itself, and the licence notice (20 Nov 2026)

core.ts step runs the licence notice, the monthly report and the morning line after the agent's own beat, each given `save: () => save(store, record)` so its claim is on disk
before it sends and its ending after. Here that is the optional `AfterTicker` (template.go) on a template's Agent, run by `kitStep` on a tick only; its `save` is `saveMid`
(kit.go): `save` with no task, then the step's recorder takes the saved lines as its base, so the beat's own save at the end writes only what came after. The work never
changes the template's state (only the record), so the saved state the channels read is not changed under them. `RunLicenceNotice` (notice.go) is modules/licence/notice.ts for
every template; the lease's Operator (`partner`) is read from licence.json with the rest (morning.go) and handed to a step as `StepContext.Partner`.

`AccountantFiler` (template.go) is the channel kit's optional `accountantFiles`: without it `/internal/channel/accounting` answers 404 after the session check, as http.ts does.

The queue (runtime.go drain) once lost every failed step's error to a shadowed `err`; a failed step now reaches the decision (park for a Guard, end, retry), so a template step
that fails is retried with the delays, and a listings shop's failing step is too (it used to spin until "too many interrupted tries").

## The owner's assistant over skills (wave 2, step 5, 20 Nov 2026)

There is one assistant (`assistant.go`, conversation.ts) and it serves every shop over `OwnerSkill`s (`assistantkit.go`, skill.ts). A skill has two halves kept apart: its reads (a
day's list, what waits) are pure over the step's store, its acts (`Prepare`, `Execute`) go through the template's own paths. A card is made from `Prepare`; on the tap `Prepare`
runs again and must give the same digest before `Execute` (assistant.JudgeCard). The optional halves are interfaces a skill may implement: `DaySkill`, `HoursSkill`,
`CloseDaySkill`, `MoveSkill`. The listings-only shop has one built-in skill (`listingskill.go`) and talks on its page only, exactly as before; a template's agent turns the
assistant on with `StepContext.Assistant(AssistantHooks{...})` and gets wire.ts's skills in its order: its own, the declared limits (`assistantacts.go`, limits-card.ts), the
listings. On WhatsApp the assistant speaks through the shared `messaging.Say` with its own voice (each line `assistant_<id>`, a card with its buttons and its code, a customer's
closed or reopened day as the approved template); on the page while the owner acts from there (`onPage`). The words are packed (`gen_words.ts`) and filled with the shop's
saved values. The morning line (`morning.go`) is the same job for every shop; the listings shop sends it as a push, a template's shop as text in the owner's window, else the
template. Voice (`voice.go`, internal/voice) is the listener every template shares and the owner's page recordings held in memory.
