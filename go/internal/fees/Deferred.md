# internal/fees: what is not ported yet, and why

The Go Fees runtime (wave 3, branch `go-w3-fees-22nov`) was built in one stream after the contract suite; these are the parts of templates/education/fees it does not do yet.
Each one that a step would meet either answers `runtime.Unported` (the task ends failed with the sentence, never a silent "done") or does what the TypeScript does for a
centre without the feature, and says so in the record. The contract tests that wait on each are named.

| Not ported | What a centre sees on Go | Contract tests waiting |
| --- | --- | --- |
| Classes' state beyond what it models (classes_run.go ClassesState): a member a later version adds to `classes` is not carried through raw | lost if a later TypeScript writes one | none |
| The monthly report (report/, monthly-job.ts) | no report is made or sent | `owner.contract.test.ts` "the monthly report" |
| The shop's assistant over the Fees skill (src/assistant.ts, modules/assistant): "who owes fees", what waits as cards, cancel and refund cards, the morning line, the app view, the talk box | the owner's free words get "I did not understand"; the talk box and a card's answer are refused in the record, as for a centre without the assistant | `owner.contract.test.ts` "the shop's assistant" (2) |
| The shop's talk to a parent (block M: talkToCustomer with "your child") | an unreadable message gets the "did not understand" menu | `record.contract.test.ts` "the shop's talk" |
| The model steps of reading (the decision model and the language model through the shared router, reading.ts) | every message is read by the rules (reading.go) | none (no contract test gives Fees a model for reading) |
| Voice notes heard by the speech service (B29), and the owner's voice to the assistant | a voice note gets the one line asking to type, as with voice off | none |
| The shop terms on WhatsApp (B72), the handover code ("move K7M2QX") | the owner's "terms" or "move" words get "I did not understand" | none |
| A parent's own chat on their private page (W2) | a parent's thread gets the public chat line | none |
| Other approvers (B37): their relay replies are not told apart from a parent's, and a refund the owner asks for is sent without `Geo-Requested-By` | with an `approvers` block, an approver's "approve K7M2QX" is read as words, and Guard may ask the owner to approve their own refund | none |
| The daily settlement read for a Razorpay centre (accounting/settlements.ts readSettlementsOnce) | yesterday's settlement rows are not posted to the books | none |
| The button-mode notices (reader.ts announceButtonMode: the AI allowance used up, the outside switch, a model fault) | the owner is not told; Fees reads by the rules on Go anyway | none |
| The retention of confirmation pages and of the chat (runtime.ts compactStore: a settled fee's page kept 90 days after its press, the chat threads with the conversations) | confirmation pages and chat threads are kept | none |
| A chat guest's label in the owner's message (chat-guest.ts guestLabel) | the owner reads the chat's conversation id; not ported for any template yet | none |
| The parents' web push of the centre's messages (push.ts alsoPushTo), a customer's push of a page's message | not sent | none |
| The settings' refusal sentences proved on vectors | written from settings.ts by hand, one contract test pins one sentence | none |

## Shared code opened, not rewritten (to be joined when the TypeScript is deleted)

- `internal/bookings/reader_shared.go` opens Bookings' settings readers (payment, approvers, assistant, the key order) to another template; `internal/bookings/agent_shared.go`
  opens one step's watch over its Guards and the owner's route. Both belong in a package of their own (internal/settingsread, internal/agentkit) once the TypeScript templates are gone.
- `internal/runtime/chanmessaging.go` is outbox.ts channelMessaging over any store; Bookings has its own copy over its store (agent_channel.go chanMsg) and can move onto it.
- The approvals relay's reply patterns (agent_talk.go relayCode, relayButton) are the same two expressions as internal/bookings agent_flow.go.
