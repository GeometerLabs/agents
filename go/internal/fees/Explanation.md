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
| agent_push.go | the parents' web push (24 Nov 2026): every message to a number also goes to that parent's private page as a push, keyed by the parent's stable ref, its words with every address taken out, queued before the send and never failing it | push/push.ts alsoPushTo, server/runtime.ts withoutAddresses |
| agent_assistant.go | Fees as a skill of the shop's assistant (23 Nov 2026): who owes, what waits (from the owner page's own list), cancel (the owner's waiver of the whole balance) and refund (the same refund as "approve q-4") by card, a message to a parent, the talk's numbers, the morning line, the app view and the page head's character | src/assistant.ts feesSkill, agent.ts feesActs and its assistant, server/runtime.ts skillOver |
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

## The shop's assistant (23 Nov 2026, `go-fees-assistant-23nov`)

There is one assistant (internal/runtime assistant.go): Fees hands it a skill, as Bookings and Orders do, through `StepContext.Assistant` with `AssistantHooks.Fees`, and the
conversation, the cards, the binding and every word are the runtime's. What the owner reads is generated from modules/assistant/words.ts by `go/scripts/gen_words.ts feesWords`
(the help and "didn't get that" lines for a Fees centre's kinds, `owes_list.*`, the waiver and refund-request cards, the Fees skill's own cancel and refund cards and two refusals,
`morning.owes`) and written through the Writer, so the outgoing check finds every value noted. The runtime's part that is new for Fees is `assistantowes.go` (the "owes" kind and
list, OweSkill, which the morning line also counts) and `PrepareGuestMessage` (a message to a chat guest, once for any skill).

- **Answering what waits is the owner's own reply.** A card's yes on a waiver is "approve q-1" handed to onOwnerMessage (which lets "approve/deny q-N" pass the assistant), a
  UPI mark's yes is the mark's button with its one-use code; a no is "deny q-1". Nothing else decides.
- **Cancel and refund are the agent's own paths.** A cancel reads the payment record again and waives exactly the balance the card showed (checkWaiver with the owner's yes,
  applyWaiver, the links closed); a refund is checked as "approve q-4" is (one refund for a payment, the limit with the owner's yes) and sent by sendOwnerRefund (now returning
  its result: Guard holds it above the limit, a UPI owner owes it). The card is bound to the fee's state, balance, payments counted, waiver and late fee.
- **Read-only where there is no step.** The morning line, the owner's app view and the page head's character use the skill with no acts over the last saved state
  (`Kit.readSkill`); cancel and refund are then "not_here".

Proved by `templates/education/fees/contract/assistant.contract.test.ts` (both runtimes) and owner.contract.test.ts's two cases.

## The gaps before the deletion (23 Nov 2026, `go-fees-gaps-23nov`)

- **What the owner is told about money is what moved.** A cancel card shows the balance it waives ("... and waive the ₹1,800 balance? No money moves."); the cancel's action
  carries that balance only as `balancePaise`, never as `amountPaise`, so the done line is "Cancelled f-2." and not a refund. A refund above the payment names the payment: the
  refusal carries `Prepared.RefusedPaidPaise` (skill.ts `paidPaise`), which `runtime.refusalPaid` says. Fixed the same way in the TypeScript.
- **A parent's language** (agent.go languageOf): the fee's, else the one they last wrote in, else their students' in the settings, else the centre's first.
- **Other approvers (B37)**, agent_approvers.go: the owner's own refund names the owner in Geo-Requested-By; another approver's reply to the relay is the relay's.
- **The daily settlement read**, agent_settlements.go: a Razorpay centre reads each settled day once through Bookings' books adapter, the gateway's call watched as the step's.
- **The handover code and the shop terms**, agent_handover.go over internal/runtime ownerwords.go (Bookings and Orders read through the same file now).
- **The month's schedule as pure rules** (agent_month.go dueMsOf, reminderMomentsOf, lateFeeFrom, backDueReminderAt; due.ts's twins, taken out of agent.ts unchanged).
- **Vectors made by the TypeScript** (rules_test.go over testdata/rules-vectors.json.gz from go/scripts/gen_fees_vectors.ts): the month's fee under every joining rule, the
  schedule (with a daylight-saving change), the limits' verdicts and words, the class-access rule, and the settings' sentences for wrong files and checked values for good ones.
- **A parent's own chat (W2)**, agent_parentchat.go: the thread opened from a parent's private page is that parent's (parentOfChat, by the chat conversation of
  parentChatHash(parentRef(parent))); it reads only their open fees, sends nothing to WhatsApp and makes no payment request. The public chat lets the shop's talk answer
  when the assistant is on, as agent.ts onChatTurn does.
