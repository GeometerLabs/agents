# internal/fees: the Fees and Classes centre on the shared Go runtime

Decision 61, wave 3: templates/education/fees in Go, beside the TypeScript, held to the same black-box contract (`templates/education/fees/contract/`). The package is a
`runtime.Kit` (fees.go): the queue, the one step saved whole or not at all, the record, the owner's sign-in, passkeys, phones, push, the limits page, the owner's file and the
HTTP face are the shared runtime's; this package is what is Fees' own. `cmd/fees` runs one centre with the TypeScript's command line, files and environment.

## The files, in agent.ts's order

| File | What | TypeScript |
| --- | --- | --- |
| settings.go | settings.json checked, every problem in the TypeScript's sentences and order; Classes' block | src/settings.ts, classes/settings.ts, joining.ts parseJoined |
| state.go | the store field for field (fees, customers, the counters, the day the agent first ran, the UPI ledger, the parents' link hashes, confirmation pages, Classes, the chat), unknown members kept raw | src/due.ts Store, server/snapshot.ts |
| words.go | every message, rendered from the generated packs (words/*.json.gz, `go/scripts/gen_fees_words.ts`); the outgoing check's facts; the WhatsApp template a closed window needs | src/language/templates.ts, check.ts, meta-templates.ts |
| reading.go | a parent's message read by the rules (the word lists generated into reading.json); a tapped button by its id | adapters/rule-parser.ts, language/interactive.ts |
| limits.go | the Fees limits as pure checks, word for word | src/limits.ts, modules/limits checkRefund |
| agent.go | the step: Handle, Tick, GiveUp, the watch's decision, the licence's line | src/agent.ts createAgent, handle, giveUp, noteLicence |
| agent_say.go | saying things over the shared say: facts, buttons, the gates (no reminder once paid, the cap, received only when recorded, the final stop) | agent.ts say, due.ts factsFor |
| agent_money.go | the sums in paise, the payment record (reconcile, settle, refundExcess), one link for what is owed (currentLink), the books, the shared refunds, a payment event | due.ts, agent.ts |
| agent_month.go | the beat: back dues and the month's fees opened at their first reminder moment, the late fee, the reminders (one message per family), the parent's private link | agent.ts openMonthlyFees, addLateFee, remind, linkFor, keepLink, onTick |
| agent_marks.go | a UPI centre's money: the owner's one-use codes, parts, refunds the owner owes | agent.ts's owner-marked section |
| agent_page.go | a parent's press on their page and the owner's presses on theirs (by digest), cash and bank marks | agent.ts onChannelFee, onOwnerAction, onOwnerCash |
| agent_talk.go | what a parent and the owner say, the panel's to-do list, the public chat | agent.ts onMessage, onOwnerMessage, onRecovery, onChatTurn |
| channel.go | what the centre's page, a parent's page, a confirmation page and the owner's page read; documents and the accountant's files | src/channel.ts |
| classes.go | Classes' state, and the reading material served to a parent's private link | classes/state.ts, view.ts materialView, server/materials.ts |

## How it keeps the TypeScript's behaviour

- **Words are data.** Each template is rendered with probe facts by the generator and the probes turned back into `{slot}`s; three values that are not plain text around a fact
  (where to pay, a family's lines, the next classes) are carried as patterns the generator checks against the real functions. `words-fresh` fails when a pack is stale.
- **The same files.** The saved state is the TypeScript codec's members in its order; a fee is written in newDue's order with every member this runtime does not model kept in
  place. `cross-restart.test.ts` runs both runtimes on one folder.
- **A student's name never leaves the centre as itself.** The names go only where the TypeScript sends them (the parent's and the owner's own messages, the relay's refund context,
  the receipts); the record keeps a parent's number only as the conversation, the inputs only as a keyed digest, a parent's link only as its hash; /status has counts only.
- **Shared code is opened, not copied** (Deferred.md lists the doors): the settings readers and one step's watch from internal/bookings, the chat outbox in internal/runtime, the
  books' Fees map in internal/accounting.
