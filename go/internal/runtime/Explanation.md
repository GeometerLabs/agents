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
