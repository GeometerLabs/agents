# internal/fees: what is not ported yet, and why

The Go Fees runtime (wave 3, branch `go-w3-fees-22nov`) was built in one stream after the contract suite; these are the parts of templates/education/fees it does not do yet.
Each one that a step would meet either answers `runtime.Unported` (the task ends failed with the sentence, never a silent "done") or does what the TypeScript does for a
centre without the feature, and says so in the record. The contract tests that wait on each are named.

| Not ported | What a centre sees on Go | Contract tests waiting |
| --- | --- | --- |
| Classes' state beyond what it models (classes_run.go ClassesState): a member a later version adds to `classes` is not carried through raw | lost if a later TypeScript writes one | none |
| The monthly report (report/, monthly-job.ts): a package of its own as internal/bookingsreport is for Bookings (the data counted from the record with the old dues apart, the page, the owner's lines, the WhatsApp text and templates, the signed data), with a words generator | no report is made or sent | `owner.contract.test.ts` "the monthly report" |
| The owner's voice to the shop's assistant (a WhatsApp voice note, a recording from the owner's page): the assistant is ported (23 Nov 2026, agent_assistant.go) but has no listener for Fees, as voice notes are not heard on Go for Fees (below) | the owner is asked to type it, as with voice off; the owner's page shows no record button (`app.listen` false) | none |
| The model steps of reading (the decision model and the language model through the shared router, src/adapters/reading.ts: about 120 lines of Fees reading over `understanding.Router`, as internal/bookings reading.go has it) | every message is read by the rules (reading.go) | none (no contract test gives Fees a model for reading; go-fees-gaps-23nov left it: the router, the budget and its record lines need a step of their own and a fake model case) |
| Voice notes heard by the speech service (B29) | a voice note gets the one line asking to type, as with voice off | none |
| The button-mode notices (reader.ts announceButtonMode: the AI allowance used up, the outside switch, a model fault) | the owner is not told; Fees reads by the rules on Go anyway | none (they tell the owner the model steps stopped: they wait for the model steps above) |
| The retention of confirmation pages and of the chat (runtime.ts compactStore: a settled fee's page kept 90 days after its press, the chat threads with the conversations) | confirmation pages and chat threads are kept | none (the shared Go runtime has no daily compaction hook for a template yet: core.ts calls kit.compactStore once a day; internal/orders CompactStore waits for the same hook) |
| A chat guest's label in the owner's message (chat-guest.ts guestLabel) | the owner reads the chat's conversation id; not ported for any template yet | none |
| The parents' web push of the centre's messages (push.ts alsoPushTo), a customer's push of a page's message | not sent | none |

## Shared code opened, not rewritten (to be joined when the TypeScript is deleted)

- `internal/bookings/reader_shared.go` opens Bookings' settings readers (payment, approvers, assistant, the key order) to another template; `internal/bookings/agent_shared.go`
  opens one step's watch over its Guards and the owner's route. Both belong in a package of their own (internal/settingsread, internal/agentkit) once the TypeScript templates are gone.
- `internal/runtime/chanmessaging.go` is outbox.ts channelMessaging over any store; Bookings has its own copy over its store (agent_channel.go chanMsg) and can move onto it.
- The approvals relay's reply patterns (agent_talk.go relayCode, relayButton) are the same two expressions as internal/bookings agent_flow.go.
- The approvers' numbers and `askedByOwner` (agent_approvers.go, 23 Nov 2026) are internal/orders agent_owner.go's two small functions over the same block; both can move to
  internal/runtime with the relay patterns above.
- The settlement read's watched call (agent_settlements.go watchedSettlements) is internal/orders' settlementPayments with the same `Do`; the read itself is Bookings' shared
  books adapter (bookings.NewBooks).
