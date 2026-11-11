# Explanation: how the modules were cut

The plan said: when the second template arrives, move what the two share out of `templates/commerce/bookings` into `agents/modules/`, and report the size before and after (items B30 and B16). The second template is Fees. This file says how the cut was made, so the third template can do the same.

## The rule, and the test that keeps it

A module imports nothing from a template or the bundle. `test/boundary.test.ts` reads every file under `modules/` and fails on an import that leaves the folder. That rule decides every cut below: when a piece needed something only Bookings knew, the Bookings knowledge went back into Bookings and the module took a hook.

## What moved, and what each module hands back to the template

| Was in Bookings | Now | What stayed in Bookings, and the hook |
| --- | --- | --- |
| `src/time.ts`, `clock.ts`, `adapters/faults.ts`, `adapters/live/http.ts` | `core/` | nothing |
| `Language`, `LANGUAGES`, `LANGUAGE_NAMES` (were in `settings.ts`) | `language/languages.ts` | `settings.ts` imports them |
| `language/format.ts`, `dates.ts`, `words.ts` | `language/` | nothing (the word lists still hold a few Bookings words: see Deferred) |
| `language/check.ts` | `language/check.ts`, now over plain lists (`CheckFacts`: amounts, counts, moments, links, names) | `language/check.ts` turns a booking's facts into those lists; the checks and their wording are byte for byte the same |
| `language/interactive.ts` | Meta's limits, the message type, the two checks, yes/no/owner labels | the services and times lists, the ids, the labels for "Cancel booking" |
| `language/meta-templates.ts` | the `{slot}` to `{{n}}` mechanism, `createMetaCatalogue` | Bookings' templates and the record values they use |
| `adapters/model.ts` | the cost types and the parser types, `Reading` | the intents (`book`, `cancel`), `coerceIntent` |
| `adapters/model-llm.ts`, `understanding.ts` | `understanding/model-llm.ts`, `router.ts`: the three steps and the HTTP wires | `adapters/reading.ts`: its rules, prompt, schema and System One questions (a `Reading`) |
| `adapters/rule-parser.ts` | `understanding/rules.ts`: STOP, yes, no, greeting, the language of a message, "ignore your rules", a price in a message | the Bookings words and `parseIntent` |
| `adapters/system-one.ts`, `redact.ts`, `rates.ts`, `ai-state.ts` | `understanding/` | nothing |
| the reading code in `agent.ts` | `understanding/reader.ts` | the three owner notices |
| `adapters/payments.ts`, `guard-model.ts`, `live/razorpay.ts` | `payments/` | nothing |
| `guard-limits.ts` | `payments/guard-limits.ts`: the spec builder, and what a spec says about a refund or a link | `guard-limits.ts`: the Bookings settings turned into the numbers and the rule names |
| `ensureLink`, the refund code in `agent.ts` (about 290 lines) | `payments/links.ts`, `refunds.ts` | what to tell the customer, and where the cases are |
| `adapters/messaging.ts`, `live/whatsapp.ts`, `live/webhooks.ts` | `messaging/` | nothing |
| `say` in `agent.ts` | `messaging/say.ts` | its templates, facts, offers and two gates |
| `record.ts` | `record/record.ts`; `Action` and `RuleId` are open, so a template adds its own names | the names |
| `report/sign.ts`, `keys.ts`, `digest.ts`, the page and the small text helpers | `report/` | the report's numbers and words |
| the monthly job (B54): when it may go, the claim saved before the send and the ending after, the retries, the quiet month | `report/monthly-job.ts` (`createMonthlyJob`) | `make`: the template's report, its page and its message; a `MadeReport` |
| `monthRange`, the folder a report is written into | `report/months.ts` | nothing |
| the banned-words lists, the badge words, `periodLabel`, `Source`, the page's verification block, `UsageError` and `main` | `report/claims.ts`, `text.ts`, `page.ts`, `cli.ts` | nothing (each template's strings carry the words the block needs under `page`) |
| `approvals/` (the relay, its store, its server, its clients, the code) | `approvals/` | `approvals/relay.ts`: the owner's words and facts (a `RelayVoice`); `main.ts` |
| `limits.ts`: STOP, the refund limit, message-matches-record | `limits/limits.ts` | the other six rules, and the three wrappers that give the shared ones Bookings' words |
| the reminder schedule and "send one, the latest" | `reminders/reminders.ts` | the hours before a booking |
| the crash-test frame and what the hand check prints | `crash-test/` | the situations, and the words around the result |
| `standins/` (Razorpay, WhatsApp, System One, Guard, http) | `standins/` | `standins/server.ts` and `control.ts` (they put the calendar in too), and the rule-based decider |

Bookings kept what is about a booking: the calendar and its adapters, the booking's states (`booking.ts`), its settings, its templates, its nine rules (six of them its own), its situations, its report and certificates, its demo, its inbox and runtime server.

## Moved, not copied: the proof

The old template had to give the same answers after the move. It does:

- The hand check printed the same 333 lines before and after the move (`Held 37 of 37` for Glow Salon, 32 of 32 for the equipment rental), compared by diff. That diff was taken before the monthly report (B54) was merged. After the merge, with B54's new situation carried into the moved code, the counts are Held 38 of 38 for Glow Salon, 33 of 33 for the rental and 35 of 35 for a shop with no cancellation window, as on main.
- The record's fingerprints and the Razorpay limits spec's bytes are unchanged: the entry shape, `canonicalJson` and the spec builder were moved, not edited.
- The Bookings tests that were green are green (the numbers are in the template's `Explanation.md` build log), the bundle's and the panel's too.
- The browser demo builds from the same files: the build now follows the imports into `modules/` and writes them under `modules/` in its output, so `dist/index.js` and the Bookings paths in it are as they were.

Two tests changed because the code they pin changed on purpose, and nothing else: the live adapter reads Razorpay's `partially_paid` as itself (it was read as `paid`, because Bookings never took part payments), and one test that lowers the deposit after a booking paid it now says that Guard's new rules arrived after the link was made (`guardLinks: false`).

## What the cut cost

Measured on 5 November 2026, before (main with the monthly report, B54, merged) and after (this branch, with Fees):

| | Before | After |
| --- | --- | --- |
| `templates/commerce/bookings`, code (lines) | 17,610 | 12,050 (-5,560) |
| `modules/`, code | 0 | 6,456 |
| Bookings and modules together | 17,610 | 18,506 (+896) |
| `templates/education/fees`, code | 0 | 4,457 |
| tests: `templates/commerce/bookings` / `modules/` / `templates/education/fees` | 11,657 / 0 / 0 | 11,390 / 449 / 1,406 |
| `bundle`, code | 9,932 | 9,946 (+14, the line that mounts the modules, and its tests) |

`modules/` by area, in lines of code: payments 1,266; understanding 967; language 831; approvals 815; report 663; messaging 609; standins 531; core 454; record 129; crash-test 112; limits 47; reminders 32.

The shared code is about 900 lines longer than the code it replaced: the hooks (a `Reading`, a `RelayVoice`, a `RefundCase`, a `CheckFacts`, a `MadeReport`), the thin wrappers that give Bookings its old names, the comments that say what is shared, and the spec builder taking the rule names as arguments. That is what it costs to let a second template in. The Fees template then reused about 5,500 lines instead of writing them again: its own code is 4,457 lines: the agent and what it needs (2,228), the crash test (843), the report (922) and the scripts (464).

## How the rest of the repository finds the modules

- **Imports** are relative, as everywhere in this repository (`../../../modules/...` from a template).
- **The browser build** (`templates/commerce/bookings/scripts/build-web-demo.ts`) follows `modules/` and stops with a clear message if a module imports a template. The demo asks no model, so it carries none of the router, the price table (`understanding/rates.ts` and its JSON) or the HTTP code; a template's reading takes `chosenProbability` from `understanding/model.ts` for that reason (the router still exports it, for Fees).
- **The one table of model prices** is `understanding/rates/<date>.json`. It is data a module owns and three others read: the runtime (to price each message), the evaluation script (its cost column) and the bundle's tests (every model price in a bundle price list must say what it says). `rates-check.ts` checks a file and `modules/test/rates.test.ts` pins each file's bytes, so a changed price is a new file with a new date.
- **The runtime container** mounts `agents/modules` as `/modules` beside the template at `/pathway` (`bundle/generate/compose.ts`). The template's relative import (`../../../../modules/...`) runs out at the container's root, which is where `/modules` is; the old layout's shorter chain ends there too.
- **A kept checkout of an older template** (`<server>/templates/commerce/bookings@0.1.0`, laid out like this repository) imports the modules three folders up, so the server holds a `modules/` folder beside its `templates/`. A checkout from before the templates were grouped by domain (`<server>/pathways/bookings@0.1.0`) has them two folders up, in the same `<server>/modules`; `modulesOf` in `bundle/generate/compose.ts` knows both. Modules are not versioned on their own yet (see Deferred).

## The second cut: the server (B16, Fees live)

Fees needed to run as a server, and Bookings' server was the only one. The same rule applied (moved, not copied; a module imports no template), in the two commits above: first the move with no change in behaviour, then Fees on top.

| Was in `templates/commerce/bookings` | Now | What stayed, and the hook |
| --- | --- | --- |
| `server/events.ts`, `store.ts`, `tasks.ts`, `ticker.ts`, `server.ts` | `runtime/events.ts`, `store.ts`, `tasks.ts`, `ticker.ts`, `http.ts` | nothing; `http.ts` asks a runtime only for `submit`, `kick`, `status`, `refundContext` and `ready` |
| `server/snapshot.ts` | `runtime/snapshot.ts`: a codec that writes the fields it is given, in order | the list of fields of the template's store. **Every field a restart must keep has to be in it**: Fees' `startedAtMs` is one, and a test saves a store with every field set |
| `server/runtime.ts` | `runtime/core.ts`: the step, the save in one transaction, the monthly job on the tick, the status, refund counts | a `RuntimeKit`: the template's store, its agent, how it counts its cases (`casesName` names them in the status), and how a held refund is found from its receipt |
| `server/config.ts` | `runtime/config.ts`: every setting of `runtime.json` (`parser`, `decision`, `ai`, `model`, `allowance`, `pauseMinutes`, `report`), the pin, the folder, the live readers (`ai` and `model` read again when the file changes) | a `ServiceShape`: Bookings has payments, calendar, messaging; Fees payments and messaging |
| `server/services.ts`, `start.ts`, `main.ts` | `runtime/services.ts`, `start.ts`, `main.ts` | which fakes and which live adapters; how messages are read (its `Reading`); its report setup |
| `inbox/server.ts`, `inbox/main.ts` | `inbox/server.ts`, `inbox/main.ts` | nothing (the events are the shared ones) |
| `approvals/main.ts` | `approvals/main.ts` (`runRelayMain(createRelay)`) | the template's relay |
| `report/go-live.ts` and the readers in `report/cli.ts` | `report/go-live.ts`, `report/cli.ts` | the digests of the template's settings, and its word for a client ("shop", "centre") |

Size, 5 November 2026: Bookings' `server/`, `inbox/` and `approvals/main.ts` went from 1,941 lines to 328 (they keep their names, so Bookings' 698 tests and the bundle import what they always did); `modules/` took 1,978 lines (the moved code, and the hooks: a kit, a service shape, a snapshot codec); Fees' own files for the same are 352. Bookings' 698 tests gave the same answers before and after (696 pass; the one that fails, `npm run stack`, fails the same way before the move when the machine is throttled by the heat lock, and passes when run alone); the 38 of 38 hand check is unchanged.

Three things a later cut should know:
- **The relay's context was Bookings-shaped** (`serviceName`, `slotMs` required). It now has the fields every template has (`booking`, the case's own id, the customer, the payment, the amount) and optional ones for each (Bookings' service and slot; Fees' student, batch and month). A template's voice says so if a field it needs is missing.
- **A test that read the code it was about** (`bundle/test/backup.test.ts` reads the store file) was pointed at the new file; and one that simulated an older version by editing Bookings' `server/config.ts` now edits the copy of `modules/runtime/config.ts` beside the server.
- **The Fees runtime imports nothing outside `templates/education/fees` and `modules/`**: the runtime container mounts those two folders and no others, so an import of Bookings or the bundle would pass every test and fail at start. `templates/education/fees/test/runtime-imports.test.ts` walks the imports to check.

## Guard changed on 8 November 2026: "already done", and approval by several named people (B37)

Guard's ADR-0060 and ADR-0061 (monorepo main `e99d5d47`) changed two things this folder reads. The contract the relay follows is the monorepo's Deferred D82, word for word where it gives words.

**A settled repeat is done.** After a person at the server resolves an uncertain call as `happened`, the identical call again is a 409 `conflict` with `guard.reason_code: "already_done"`, and `detail.confirmed_by` names them (`operator:<admin id>`). There is no reply of the service's to replay.
- `core/http.ts` reads `reason_code` (it dropped it before) and makes that answer a `GuardAlreadyDoneError`, which is a `GuardConflictError`: code that does not know it still never sends it again. Every other 409 is the plain conflict, as before.
- `payments/refunds.ts` checks for it first (before the plain conflict, which means "nothing was refunded"). In `requestRefund` and in `releaseHeld` the refund is recorded `confirmed` with `refs.confirmedBy` and `refs.intent`, and a note that it is done by that person's word, not by the service's own list. The payment goes on `stoppedRefunds`, so Guard is never asked about it again. It is not a refund issue: nobody needs to look at it. The owner is told in plain words (`ids.settled`, `owner_refund_settled` in each template, in four languages, with a Meta template), and the customer gets the "done" message, never "failed".
- In `releaseHeld` (the owner had approved), Guard did not release the held call, so the owner's approval is not recorded as used (`owner_decision confirmed` is not written).
- The stand-ins follow it: `payments/guard-model.ts` keeps the call of an uncertain refund and can `resolve` it (`happened` or `did_not_happen`); a settled payment's identical call is `already_done`, another call on it the plain conflict, in the words Guard's doc gives. `standins/guard.ts` serves it with the same body, and the payments fake throws it.

**Several named people (B37).** A shop may now name other people who approve refunds (`approvals/people.ts`, the settings' `approvers`). Nothing changes for a shop without them: every test of a single owner is unchanged, and so is every file the bundle writes for one.
- **Who asked.** `ownerAsked(settings.approvers)` is `["owner"]` in a shop with other approvers, and nothing otherwise. The templates pass it to `requestRefund` on the owner's own refund commands; the live adapter sends it as `Geo-Requested-By` (and again on the resend, which does no harm: Guard keeps the header out of the call's digest, and if it holds the call anew the new hold must not be asked of the owner either). The hold remembers it, and the refund context tells the relay. With the owner alone the header is never sent: the owner would then be someone who asked, and could not approve.
- **Reading.** `approvals/clients.ts` reads the B37 keys of a review item all together or not at all (a partial set is "not in the form Guard writes", for the builder). It reads Guard's two answers to a vote, which spell a vote differently: the 200 is the request itself (`state`, `approvals_needed`, and `votes[].approve` as a boolean), the queue has `votes[].decision` as a word. `readAlready` reads the 409: "is already approved by asha: each approver decides once (1 of 2 approvals so far)" is that person's own earlier vote on a request still pending; "is already approved" with no "by" is the decision. Today's `/already (\w+)/` alone would have read the first as "approved" and told the runtime to send a refund that still waited for a second person.
- **Asking.** `approvals/relay.ts` keeps the owner's single ask exactly as it was (an ask with `approver` ""), and adds a group path beside it for an item with the B37 keys. The group path skips `you_may_decide` (D82: it describes only the reading credential) and asks exactly the ids in `may_still_decide` that it has a number for, never one the runtime or Guard names as having asked. The relay's own reading credential (`relay-<shop>`) can be in that list, and is never asked, because it has no number. Each ask has its own fresh code, and a code is accepted only from the number of the person it went to (another approver's phone, the owner's, a stranger's: ignored without a word, counted). Each answer is signed with that person's own secret (`secretOf` on the Guard client; the owner's, as before, when it is the owner's ask).
- **Answers.** `pending` is a vote: the person is told how many more ("Approvals still needed from the others: 1"), and the runtime is not told. `approved` or `denied` is the decision: it is saved once (`outcomes`), the runtime hears it once, the person who answered is told what happens next, and every other ask of it is closed. A person whose vote is in hears how it ended; one who had not answered hears "approved by the others" or "refused"; on a no, the person who asked gets the refusal too (an ask row is made for them, already closed). A crash between Guard's answer and the save is recovered from on the next pass: Guard's 409 says which happened. A 403 "asked for this call" is a fault in the relay, and is an alert.
- **Store.** Migration 2 rebuilds `asks` with the key (approval, approver); every row written before is the owner's single ask (approver ""), and goes on where it was (a test opens a version-1 file with an ask in `asked` and carries it on). It adds `approvals_left` and the `outcomes` table. The WhatsApp window is kept per number (`owner_last_inbound` for the owner, as before; `last_inbound:<digits>` for the others).
- **The inbox** forwards the other approvers' messages to the relay too (`approverWhatsapps`), and the templates' runtimes drop a code reply from those numbers without a word, as they do the owner's.
- The Guard model and the HTTP stand-in take a directory (`ModelApprovers`: the owner, the people, the two-person amount, the reading credential) and answer in Guard's own words, copied from `store/mod.rs` and `review.rs`: the 403 for someone who asked, the 409 for a second answer, any one no refusing, `may_still_decide` sorted. Without a directory they are what they were.

## The to-do list: obligation kinds and recovery steps (B31, 7 Nov)

`unfinished/` is the registry behind the panel's "Unfinished work" page. It is not a store and not a CRM: nothing in it is saved, and a list is worked out again from a shop's exported record and its cases (the bookings, or the fees) each time it is asked for, so it cannot disagree with the record.

**The shape.** An `ObligationKind` is `{ id, templates, detect(input) }`. `id` is lower_snake_case (it is also the key of the kind's sentence in the panel's words, and the key counts are sent by). `templates` is a list of template names or `"all"`. `detect` takes `{ template, entries, cases, nowMs, options }` and returns `Obligation`s: `{ kind, caseId, sinceMs, facts, actions }`. `facts` hold ids, amounts and whole numbers only (never a name, a phone number or a word a customer wrote: a test plants a name in a refund note and checks it does not come out). `actions` are names of recovery actions that fit this one item. `createObligationRegistry()` has `register` (a repeated or badly named id throws, at load time), `detect` (oldest first; a kind that throws is reported in `failed` and does not hide the others) and `countsByKind` (all that a heartbeat may carry). `index.ts` makes the shared registry with `BUILT_IN`.

**The six built-in kinds** (`builtin.ts`): `deposit_no_booking` (Bookings: a deposit is in and the booking is not confirmed), `payment_unrecorded` (Fees: a payment came and the fee's balance was not brought up to date), `approval_waiting_long` (an answer from the owner has waited longer than the panel's setting, default 12 hours: `PANEL_APPROVAL_WAIT_HOURS`), `refund_waiting` (a refund is with the owner or being sent again), `refund_unknown` (a refund that may or may not have gone) and `refund_failed` (one that did not go). A case shows once for one cause: an overdue answer is listed as that and not also as a refund on its way. The wait limit is a panel setting, not a field of the shop's settings, because the settings feed the policy digest the certificates cite.

**Adding a kind (the UPI module's two).** Write an `ObligationKind` and either add it to `BUILT_IN` or call `obligations.register(kind)` when your module loads; then add its sentence to `inbox.kinds` in the four panel word files (`bundle/panel/words*.ts`) and a sample line to `SAMPLE_ARGS`. A kind with no words is still listed, under a plain fallback sentence, so a missing translation never hides an obligation. "UPI payment not yet confirmed by the owner" and "refund owed by the owner, not yet marked done" are each a detector over the UPI module's own pending items and the record, with `actions: ["ask_owner_again"]` for the first.

**Recovery actions are only names.** `RECOVERY_ACTIONS` lists `recheck_payment`, `retry_booking`, `ask_owner_again` and `recheck_refund`. What a name does is decided by the shop's own agent, which receives a `recovery` event (the panel files a request, the deployer carries it to the runtime's `POST /internal/recover`, the runtime saves it like any event) and does the same thing it does every day: `recheck_payment` reads the payments service's own list for the booking's link (or the fee's links) and records any payment it has not counted, by the normal path and its rules; `retry_booking` asks the calendar again (`completeBooking`: the customer is told "booked" only if the calendar now shows the booking); `ask_owner_again` sends the owner the same notice again (a calendar problem, a late cancellation's refund, a waiver or a refund request); `recheck_refund` (`payments/refunds.ts`, `recheck`) looks, read-only, for a refund that may have gone, and **never sends one**. An action that does not fit the case, or a case that is not there, is written to the record as `recovery` / `blocked` and changes nothing. A recovery cannot widen a limit: it adds no call that the agent does not already make, and Guard decides each as it always does. The record has a `recovery` entry for each (`attempted`, then `confirmed` or `failed` when the look read the service's own store), and the follow-on entries are the usual ones.

**The runtime's door.** `POST /internal/recover` takes `{id, case, action}` with the runtime's bearer token and nothing else; `checkRecovery` (`runtime/events.ts`) is strict about all three, and `/internal/events` (the inbox's door) refuses a `recovery` event, so the inbox cannot send one. The request id makes a double press one request.

## The owner's agreement to a handover (B38, 7 Nov)

`approvals/handover.ts` is the owner's side of moving a shop to another partner or builder. The panel makes a one-use code (the approvals' own alphabet and length), shows it once and keeps its hash (a different hash from an approval code's: a code made for a move can never answer an approval). The owner sends `move CODE` from their own number to the shop's WhatsApp number; both agents (`onOwnerMessage`) write one `handover_agreed` / `confirmed` entry from the owner's number with `refs.handover` the code's hash, say nothing back, and change nothing else. It is its own action, not an `owner_decision`, so a monthly report never counts it as an approval or a refusal. The panel moves the shop only when it finds that entry in the shop's exported record, from the owner's number, after the request and before the 72 hours ran out.

## UPI, marked paid by the owner (B33, 7 Nov)

Partners sell to small shops that have no payment-gateway account and should not need one. So a shop picks a payment module (settings `"payment"`): **UPI**, the default
the panel offers partner shops (the shop's own UPI ID; no gateway account, no gateway fee), or **Razorpay**, for a shop with its own account. Geometer never onboards a
shop onto a payment provider and never holds shop or customer money. `payments/upi/` is the UPI module; both templates use it.

**What "paid" means.** Nothing the agent can reach sees a UPI payment: the customer pays the shop's own UPI ID from their own app, and the owner sees it in theirs. So
"paid" is the owner's word, given the way an approval is given: a reply from the owner's own number, through the inbox, carrying a fresh one-use code (the approvals'
alphabet: `approvals/code.ts`) that was sent only to the owner, as a "Received ₹200" button or typed "received K7M2QX" (another amount: "received K7M2QX 150"). It is
recorded as `owner_marked_paid` with `markedBy: "owner"`, and every total built from it is labelled "marked paid by owner". A customer's screenshot, the "I have paid"
button or the words "I paid" ask the owner to look (`upi_paid_claim`) and mark nothing; the outgoing gates that say "booked" or "received" accept only the owner's mark.

**Why the agent, not the approvals relay, reads the owner's marks.** The relay exists to hold the approver secret for a refund Guard is holding, so that the runtime
can never release money. A UPI mark releases no money: it records that money the owner already has arrived, and the worst a forged mark could do is book a slot. The
same three protections as an approval apply (only the owner's number counts, the code was never shown to a customer and is never in the record or the link, and a
code is used once), so the runtime reads them itself. A UPI shop has no relay at all (bundle).

**The ledger is the agent's own store, seen through the Payments seam.** `ledger.ts` keeps the requests, the owner's marks and the refunds the owner owes in
`store.upi` (plain JSON, saved by each template's snapshot codec as `optional-object`, in the same transaction as the step). `upiPayments` shows it in Razorpay's shape:
a request is a "link" whose `short_url` is the `upi://pay` link, and each mark is a "payment" on it. So the templates' care, "look first, write, read back" and "a
payment counts when the payment record shows it", holds unchanged, with the owner's marks as the payment record. The seam's `refund` throws: with UPI the agent never
sends money, it calls `oweRefund`. A UPI shop's agent is never given a Razorpay adapter (`noRazorpay` throws, loudly, if a Razorpay path is ever reached).

**What the marks cover.** The button means exactly what is still asked; another amount leaves the rest with a new code (Bookings: not booked, the hold stays, the owner
is asked for the rest; Fees: a part payment, and the rest gets a request of its own, because a UPI app cannot change the amount of a `upi://` request). The same code
twice counts once. A request the agent closed (a hold that ran out, a fee whose amount changed) keeps its code, so a later mark is still recorded: Bookings never books
again by itself (the owner and the builder are told: a `late_upi` count in the status, and the money is owed back unless the owner keeps it for a booking made by hand);
Fees counts it toward the fee. A refund is owed by the owner (`upi_refund_owed`), reminded once a day three times at most, and the customer hears "sent" only after
the owner marks it so ("refunded K7M2QX" or the Refund sent button).

**The link** (`link.ts`) follows NPCI's UPI Linking Specifications 1.6 (November 2017): `pa`, `pn`, `am` in decimals with no `mam` (so the amount cannot be changed), a
short `tn` with the booking or fee reference, `cu=INR`, RFC 3986 percent-encoding (a space is `%20`). `tr`, `mc`, `mode`, `orgid` and `sign` are left out on purpose:
they belong to a merchant's signed request, and a partner shop's UPI ID is often a personal one, which payment apps may refuse or flag as a merchant request (Deferred).

**The QR code is written here, not vendored** (`modules/qr/qr.ts`, `png.ts`; moved from `payments/upi/` on 8 Nov when the signed papers became its second user): byte mode, level M, versions 1 to 40, the standard's mask penalty, and a one-bit PNG with
`node:zlib` (deflate and CRC-32, both in Node). About 250 lines, tested against vectors that do not come from it: the Reed-Solomon worked example (HELLO WORLD at 1-M),
the standard's format and version bit tables, the alignment positions, and two whole symbols from the qrcode npm package (MIT, 1.5.3), which it matched on 72 of 72
symbols when written. macOS CoreImage decoded its PNGs. The PNG module uses `node:zlib`, so an agent is handed a `qrImage` maker (`qr-image.ts`) instead of importing it
(the browser demo has no `node:zlib`).

**The picture goes by its address.** WhatsApp does not make a `upi://` link tappable, so the customer gets the QR as an image message plus the link, the UPI ID and the
amount as words (`messaging/`: `sendImage` by https link, as a document is sent; the stand-in knows it; `say.ts` sends a checked caption before the words, inside the
window only). The live runtime writes each picture under a random name into the folder the monthly report's pages are served from. An uploaded media id would have
needed a second WhatsApp route through Guard and a multipart body (Deferred). The outgoing check reads a `upi://` link whole, before the names are masked out: it must
be the record's own request, exactly.

**Pictures coming in** (`messaging/webhooks.ts`) are now a message with `image: true` and nothing of the picture or its caption, like a voice note. Before B33 they
were left out, so a screenshot got no answer. A Razorpay shop still answers nothing to one.

**The unfinished work** (`obligations.ts`): `upiObligations(entries)` folds the record alone into "UPI payment not yet confirmed by the owner" and "refund owed by the
owner, not yet marked done", and `UPI_OBLIGATION_KINDS` puts them in the registry (`unfinished/builtin.ts`) with `ask_owner_again` as their recovery (each agent sends the
owner the notice again, with the code and the button). An unpaid fee nobody claims is not listed: a request is the owner's to look at once the customer says they paid
or the owner marked part of it.

## Records anyone can check, and the papers (B28, B35, B36; 8 November 2026)

Not a cut: new shared code that both templates use from the start. `record/ledger.ts` and `record/publish.ts` turn any template's record into geometer-verify's ledger and publish its daily fingerprint (`record/Explanation.md`); `papers/` makes the three signed papers from any template's record (`papers/Explanation.md`). Each template hands in a `report/papers.ts` of about 70 lines (its money actions, its action words, its cases, its limits). The monthly reports' `anchor` slot, reserved since the reports were written, is filled from the ledger. Size (8 November 2026, against main at 2ef04b6): `record/` +342 lines, `papers/` 954 (of which the words in four languages are 249), the templates' `report/papers.ts`, `scripts/papers.ts` and the Bookings example script 239, the bundle's fingerprint job, paper command, panel papers and papers page 308; new tests 840. Nothing was superseded: the reports' `anchor` slot was reserved for this, and the bundle's export job gained the ledger beside the record it already wrote.
## The QR code, shared (`qr/`, B12, 8 Nov)

The encoder, its PNG writer and its tests were in `payments/upi/`; the signed papers (go-live certificate, monthly record certificate, monthly report) are the second user, so
they moved to `modules/qr/` with `git mv` (history kept) and UPI imports them (`qr-image.ts` stays in UPI: it names the file `upi-qr.png` and hosts it for WhatsApp). One
source. Size of the encoder and PNG (`qr.ts` + `png.ts`): 18,083 bytes before (15,064 + 3,019) in `payments/upi/`, 20,786 after in `modules/qr/`: `png.ts` the same, `qr.ts`
+641 (`functionModules`, `dataModuleOrder`: the data placement is now one function that both writing and the tests' reader use), and one file added, `svg.ts` (2,062: the same
matrix as an inline SVG with no `node:` import, so the browser demo could use it too). The paper side added `modules/report/verify-link.ts`; nothing was copied.

**The link on a paper** is `modules/report/verify-link.ts`: `https://geometer.dev/verify/#<digest>` (the website's contract, public-web `docs/Deferred.md` P22). The
digest, not the 8-character code, goes in the QR: it names one file, where the code (40 bits) only finds one. Everything after `#` stays in the reader's browser. The paper
prints the code, the full link under the QR, and (for text lines such as the certificate's one-line summary) `/verify/#<code>`. `sealBlock` in `report/page.ts` draws all of
it, so every paper in every template gets the same block; `scanToCheck` in each template's `page` words is the sentence beside it.

**No `&key=` in the link.** The key id printed on a paper is the one inside the file: whoever changed a paper and signed it again with their own key would have changed it
too. A key in the QR would show on the website as "from the link", and a QR is printed on the same paper. So the link carries none, and the sentence beside the QR says to compare
the key shown on the paper with one the partner or Geometer's team gave the reader. `verifyLink(envelope, key)` accepts a key for a caller that holds one the reader was given
another way (nothing does today).

**The page cannot change the signed file.** The signed document holds numbers and digests, never the HTML; the page is made from the envelope, and the QR, the link and the
words are only on the page. Tests: the envelope's bytes (`envelopeFile`) are the same before and after the page is drawn, they hold no `<svg` and no `verify/`, and a one-byte
change is still refused. The printed link is checked against the digest the verifier computes from the file, and the SVG's modules against the encoder's matrix for that link,
which `modules/qr/test/read.ts` reads back (layout undone, mask taken off, error-correction codewords re-derived) to exactly the link.

## The licence lease and wind-down (B13, 8 Nov)

`licence/` is fleet's lease format and rule, ported (monorepo `apps/fleet/src/lease.ts`, ADR-0059), and the owner's one notice. It is a module because both templates act
on it and the bundle checks it:

- `rules.ts`: `newerThan`, `serverNow`, `effectiveState`, `takesNewWork`, `allowsRecovery`, the version-1 shape, and what the runtime is handed (`LicenceFile`,
  `licenceNow`). **No crypto**: the agents import it, and the browser demo has no `node:crypto`. The state is worked out with the caller's clock at every call.
- `token.ts`: `checkToken` with `node:crypto` Ed25519, the same checks in the same order as fleet's; the keys come from the caller (the bundle's pinned keys), never
  from a token. Only the bundle imports it.
- `notice.ts`: the owner's notice at the wind-down and at the final stop, once for each `paid_through`, kept in the record the way the monthly report keeps its month
  (a claim, a save, the send, the ending). The runtime core runs it on the clock's beat; the template gives the words.

`runtime/config.ts` reads `client/licence.json` (`licenceReader`, by modified time, like the `ai` switch), and `runtime/core.ts` runs the notice and holds the monthly
report back in the final stop. What each state does to a template's work is the template's: both agents gate where new work starts (a request to book or pay, a new
link) and leave everything that finishes money owed. The decision they record is `subscription_suspended`, so it reads like Guard's will.

**Guard's own check (8 Nov, monorepo ADR-0062; the bundle writes the block, D83).** A per-shop Guard now reads the same lease and refuses new work with a 402 whose
`guard.code` and `guard.reason_code` are both `subscription_suspended`. The runtime meets it when its own file says the shop is in order and Guard's lease says it is not
(a builder edited `licence.json`, or the runtime has not read the newer lease yet). It is the runtime's own licence refusal, made outside it:

- `core/http.ts` `classify` makes it a `GuardSuspendedError` (`faults.ts`; `state` and `operation` from Guard's `detail`). It is a `GuardError`, so code that does not
  know it still never reads it as a success; it is not a `GuardRefusedError` (not a rule of the shop's) and not a `GuardUnavailableError` (not "try later").
- **Never tried again.** `payments/links.ts` stops at once and returns it as `suspended` (no second try, no read-back); `messaging/say.ts` does not send the same words as
  plain text after Guard held back the buttons; `runtime/tasks.ts` marks a step that threw it as failed on the first try, where anything else gets its retries.
- **Recorded once, plainly**: `blocked`, with `guardLicenceDecision` (`licence/rules.ts`): the rule `subscription_suspended` and Guard's own reason. The monthly report
  leaves it out of "what the limits stopped", as it leaves out the runtime's own.
- **The templates treat it as their pause**: Bookings, when Guard refuses the hold or the deposit link, lets the slot go and answers "Online booking is paused ... contact
  the shop" (no "could not book" to the owner: nothing failed); Fees, when Guard refuses a fee link, answers the parent the same way and passes the reminder over
  instead of trying again at the next beat; Orders, when Guard refuses the advance link, lets the order go back to an enquiry and answers "Online ordering is
  paused ... contact the shop", with no "link failed" to the owner.

## UPI by default, any other provider through one seam (B71, 10 Nov)

The owner, 10 Nov: agents use UPI by default and add Razorpay or another provider only if needed, because paperwork stops partners onboarding shops; and "I don't
like the idea of having our agents limited to razorpay". What changed in `payments/`, and why each part is as it is:

- **The interface is neutral** (`payments.ts`). A payment request, the payments on it, refunds, and three events: `request.paid`, `payment.received`,
  `refund.done`. Field names that were Razorpay's are not (`pay_url`, `request_id`, `part_payments`, `min_first_payment`; a payment is `received`), and the
  stand-in gateway's ids are `req_`/`pmt_`/`rfd_`. `reference_id` and the paise amounts stay: they are no one provider's. Razorpay's own names live only where
  its wire format is read or written (its folder), and its webhook samples in tests keep them.
- **A module says what it can do** (`PaymentCapabilities`): confirms automatically, refunds automatically, takes part payments, cancels, can be read back. The
  three templates ask these, never a provider's name. UPI says no to all five (the owner marks money and pays refunds; a request is for one exact amount; one
  already sent can still be paid; the agent's own store is the only record); Razorpay says yes to all five. The owner's mark and a gateway's webhook enter the same
  `reconcilePayments` (Bookings, Orders) or `count` (Fees): one flow, with the owner's marks as the payment record.
- **A provider is one folder**, `payments/providers/<name>/`: `index.ts` declares it as plain data (capabilities, how its settings block reads, its Guard routes
  and operations, its keys' shape, its words in four languages, its fee's price-list ids, its sign-up notes in `SIGNUP.md`); a gateway's wire code (adapter,
  webhook reader, stand-in, the payment read the own-agent relay uses) is its `runtime.ts`, listed in `providers/runtime.ts`. The split is not tidiness: the
  agent asks the capabilities, the browser demo runs the agent's import graph, and that graph may only reach `node:fs` and `node:crypto`. `providers/index.ts`
  is the only list of providers and the only settings reader.
- **Owner-marked payments are their own module** (`payments/owner-marked/`: the ledger, the owner's replies and buttons, the obligations, the QR picture, and the
  desk an agent someone else wrote calls). They were `payments/upi/`; they serve any module that cannot confirm by itself, and UPI's own folder keeps only what is
  UPI's (the `upi://pay` link and the UPI ID's checks). Persisted names keep their values: record actions (`upi_request`, `owner_marked_paid`, ...),
  obligation kinds, button ids (`upi-received:CODE`), the store's `upi` key and message template ids, because records, reports and messages already sent use them.
- **The Guard spec is neutral rules plus each gateway's routes** (`guard-limits.ts` `paymentLimitsSpecFrom(rules, gateway)`). Guard already takes a spec per
  upstream, so no engine change was needed. A Razorpay shop's spec, plan, guard.toml and compose file are byte-identical to before the split: the bundle pins them
  (`test/payment-guard-golden.test.ts`, made from the code before any of this).
- **One contract every provider must pass** (`providers/test/contract.test.ts`): lost reply, duplicate and late events, never refunding more than was paid, a held
  refund, a refund that fails, and B33's situations. A row that cannot apply to a provider is its own test, named "does not apply", that asserts the capability
  making it so. `providers/test/names.test.ts` holds the places made neutral to it: they name no gateway and import a provider only through the registry.
- **An agent's own gateway API is not a provider** (`OWN_API`, `"own-api"`). `readPaymentSettings(v, errors, {ownApi: true})` accepts
  `{"module": "own-api"}` only when an agent folder reads its settings (bundle/agent/folder.ts); a template's shop can never choose it, because no template
  code knows such an API. It has no capabilities, words or stand-in here: its Guard spec is the one the builder reviewed with the companies kit, and the bundle
  says what it cannot check (bundle/Deferred.md).

## B71 part 2 and B74: the desk on servers, holds on an own API, one checked action (11 Nov)

**The owner-marked desk behind a Guard** (`payments/owner-marked/desk-guard.ts`). On a server an agent someone else wrote reaches the desk the way it reaches
everything else: through a Guard of its own, `g-<agent>-upi`, whose upstream is the desk. So the agent's one credential, the kill switch, the licence's wind-down
(a new request is `create_link`, which the wind-down refuses; a refund owed never is), the record of every call and the limits hold for UPI as for a gateway. The
limits are the gateway's neutral numbers from the same settings (the deposit is the only amount a request may be for, a refund owed is 1 paisa to one deposit,
refunds and requests per day and hour, and claims per hour so an agent cannot fill the owner's phone). Two of the gateway's rules are left out on purpose: no hold
above a refund limit (the owner sends every UPI refund from their own app, so they already decide each one) and no once-only rule (the desk never owes more than
the owner marked on a payment). The desk's request and refund views now carry when and by whom each mark was made (`marked_by: "owner"`), which the own agent's
record job reads through the same Guard. A mark made after the agent closed a request is now owed back with its own code (or kept), as a template does; the desk
used to send the owner a message with no code, which could not be worded on a server.

**Holds on an agent's own API** (`approvals/held-call.ts`, `approvals/own-api-voice.ts`). The relay takes a reader (`RelayOptions.readHeld`): left out it reads
a gateway's held refund as before; for an own API it reads the calls the reviewed spec holds (`call_bound_approval`: the operation, the amount field and its unit).
What the owner is shown is Guard's held call and nothing else: the operation by its name in the spec, the amount typed (an amount sent as text is a different call
and is never shown), in the API's own unit (rupees only when the unit is paise), and at most three of the call's other plain fields, each an id-like token (letters, digits, `_`, `-`;
prose, a link, an address, a line break or the words "approve"/"deny" leave the field out rather than being cleaned). A request that names several approvers is the builder's: an own
API's Guard has the owner alone. The words are their own (a template's voice talks about a booking's refund; this call may be a payout): ask, done, denied, expired,
failed, in four languages, each checked so that no number is in the text that the held call does not have. **After the owner's yes** nothing is sent by the relay:
it gives Guard the owner's signed answer for that approval id, and Guard lets the call through when the agent sends the identical call again, which is what a
template's held refund does today. A changed amount is a new call, held again under an approval the owner has not given (tested against the real Guard).

**B74: what the code already binds (the inventory).**

| Path | What the owner reads is written from | What executes after the yes | What a change after the yes does |
|---|---|---|---|
| A refund Guard holds (all templates, own agents on a gateway; `approvals/relay.ts`) | Guard's held call (amount and payment, typed) plus the runtime's case, which must show the same payment, amount and approval id or nobody is asked; the out-of-window template is the same facts and must fill back to the checked text | The runtime re-sends the saved bytes of the held call (`payments/refunds.ts`, `resendRefund`); nothing is rebuilt | Guard binds the approval to the call's digest: another amount, payment or receipt is held again under a new approval (pinned against the real Guard). A refund body has no currency or fee field |
| B37, several people | The same, each in their own language, with their own code and secret | The same re-send, only once Guard says "approved" | The same; votes and the count are Guard's |
| Fees waiver above the limit (runtime command `approve q-N`) | The saved request (amount) and the live fee | The saved amount, applied only if the fee is open and its balance is the one the owner was asked at | A changed balance is refused and the owner told (`owner_request_stale`; crash-test situation `waiver-balance-changed`) |
| Fees, Bookings, Orders refund the owner decides (`approve f-/b-/o-N`) | The case's saved refund (Bookings shows the booking's deposit, which is the amount saved; `approve b-N` takes the booking's first pending item, and a cancellation empties the list before the refund is added, so it is the only one) | The saved payment and amount, through the same limits again and, above the limit, through Guard's hold | The saved amount goes through the limits again (Fees also reads the payment again, and one refund per payment); nothing compares it to what was shown, but both come from the same saved refund |
| Orders big order (`approve o-N`) | The order's total | The advance link for the order as it stands | A different request from the customer cancels the waiting order with its ask (`cancelWaiting` empties `pending`) and starts a new order, which asks the owner again if it is big; the total itself is not compared again (Deferred.md) |
| UPI marks (`owner-marked/ledger.ts`, desk) | The request's own amount and code | Nothing is sent: the owner's mark is recorded | A code belongs to one request or refund; a changed amount is a new request with a new code |

Cross-checked but not bound: the customer's number, the service, the slot and the student shown beside a held refund come from the runtime's case and are checked
only by payment, amount and approval id. The tests added (B74): the real-Guard test in `templates/commerce/bookings/test/approvals-guard-binary.test.ts`, the
three voices in four languages in `bundle/test/approval-binding.test.ts`, and the own API's in `bundle/test/agent-own-api.test.ts`.

**B74: a UPI mark is the owner's statement.** Every writer records it as `owner_marked_paid` with `markedBy: "owner"` (the templates, the desk, and now the own
agent's record, which never writes `record_deposit` for UPI money). The readers: the papers put it in the owner's column ("marked paid by owner", with what that does
not show); each template's report labels the money "marked paid by owner" (`paidBy: "owner-marked"`) and lists automatic payment checking as not checked; the
unfinished-work list reads it as the owner's mark. `bundle/test/desk-served.test.ts` pins it for the own agent's record and report; `papers.test.ts` and the
templates' report tests pin the rest. A UPI shop's report, certificate and papers now name no gateway in any language (three lines still did; they have UPI words).

## A Guard that is down: the message waits (B14, 10 Nov)

`runtime/guard-wait.ts`, `runtime/tasks.ts`, `core/faults.ts`.

**Why the retries were not enough.** The agents' own failure handling cannot tell "the provider said no" from "the Guard is down". `say`, `ensureLink`, `ensureEvent` and the `.catch(() => false)` beside many reads catch the error and go on: the customer is sent "sorry", or nothing, and the step is saved as done. Only an uncaught read reached the task runner's 1, 5 and 30 s retries. A longer retry would have fixed that one path.

**What happens now.** Each task's step runs over watched services (`watchStep`), which is why the wrapper goes through `kit.createAgent` and not into the HTTP client: the in-memory fakes make the same decisions as the live adapters. Whether the step is kept is decided after the agent returns, whatever it caught.

| The step | What happens |
|---|---|
| A call finds its Guard unreachable or not ready, and nothing that cannot be repeated has gone yet | The step stops. No later call of that step leaves, so the agent's "sorry" never goes out. Nothing is saved and the task waits, at the head of the queue, with the time to look again saved on it. |
| A WhatsApp send, a refund, a held call or a write of unknown outcome has already gone | It cannot run again, so it does not wait. If it finishes, it is saved as it is. If it throws, it ends there, once, and the to-do list has it. |
| The wait is over (15 minutes from when the message arrived) | It runs once more with waiting off, so the agent's own "could not" words go out. Then one record line (`guard_wait_over`), which the to-do list reads as `message_unanswered`. If that last try throws, the customer gets `couldnt_tell_owner`. |

What each error kind means is one table, at `waitsForGuard` in `core/faults.ts`, with one test row per kind. `provider_unreachable` does not wait: the Guard is up and the provider is away, so it keeps today's handling. Nor does the kill switch: a shop someone stopped on purpose is not an outage, and its messages must not sit for 15 minutes and then be filed as one. Guard says it only in its reason ("kill switch engaged: ..."), so that is what is read. Whether a provider's own outage should wait too is an open decision (Deferred.md).

**Order stays shop-wide.** While one task waits, the shop's later messages wait behind it, including ones that do not need that Guard. Letting them go past was considered and not done. A step that is thrown away has already taken the shop's next case number and may have made a calendar hold and a payment link under it. If the next conversation ran first it would take the same number, and its "look first" would find the first customer's hold and link. Keeping them apart needs reserved ids, and a place in line for payment events that name no conversation. A Guard that stays down past the bound therefore stops holding the shop up: the runtime has given up on it, later tasks take today's path at once, and it waits again only after that Guard has answered. The cost, at its worst, is the shop's silence for one bound per outage.

**When the wait ends without the Guard,** a step that threw on its last try gives the customer `couldnt_tell_owner` (Fees: `fee_couldnt_tell_owner`): "Sorry, I couldn't reach the owner just now. Please try again in a few minutes." Those are the words the templates already have for "this could not be done just now", but nobody tried the owner on WhatsApp: the owner hears through the to-do list. Words of its own, in four languages, are the owner's call (Deferred.md).

**The bound is 15 minutes,** from when the message arrived, so a customer's second message cannot add a second wait. It is the whole shop's silence at its worst, so it stays short of a customer giving up; it covers a Guard restart, a redeploy and a server reboot; a Guard still down after that needs a person; and it is the deposit hold's default length.

**Fixed cost while waiting.** The queue sleeps until the time saved on the task, then asks the Guard one plain read (`guardAnswers`), backing off to every 30 s. A step, and so a model call, runs again only when the Guard has answered. One outage costs about one extra model call in all, for the message at the head of the queue, which read the message before it found the Guard down; a Guard that keeps flapping costs one more each time it comes back and goes again. That extra read is paid to the provider and is not in the month's meter, because the first try's counts were thrown away with the step. No WhatsApp message and no bucket request is made by waiting.

**Ticks are not tasks.** A tick cannot wait and keeps today's rules: if it throws, the next one tries. But the next tick starts from the same saved state, so a reminder it had already sent would go out again, once a tick, for as long as the outage lasts. `sendMemory` keeps what a thrown-away tick's one-time calls answered, in memory until a tick is saved, so the next tick gets the answers instead of repeating the calls.

**Two things a rerun leaves as they are.** A relative date ("tomorrow") is read when the step runs, so a message that waits across midnight means the next day; the customer sees the date in the quote. A UPI request's one-use code is made again by the rerun, so if the owner was told before the Guard went down they would get a second code; that needs a send, so such a step does not wait in the first place.

## WhatsApp through Gupshup, and what WhatsApp says afterwards (item 11b, 11 Nov)

`messaging/gupshup.ts`, `providers.ts`, `statuses.ts`, `webhooks.ts`; `inbox/server.ts`; `runtime/events.ts`, `core.ts`; `unfinished/builtin.ts`; the WhatsApp Guard in `bundle/generate/guards.ts`. Nothing here has been run against a real Gupshup app (Deferred.md).

**Which Gupshup API, and why.** Gupshup has three ways to send. I read each on 11 Nov 2026:

| API | What it takes | Chosen? |
|---|---|---|
| Partner API v3 "pass-through", `POST https://partner.gupshup.io/partner/app/{appId}/v3/message`, header `Authorization: <partner app token>` | **Meta's own Cloud API body**, as JSON. It answers with Meta's own reply shape, whose id is Gupshup's message id. Its callbacks ("v3 subscription") are Meta's webhook body with `gs_app_id` added, and each status carries `gs_id`. ([pass-through](https://partner-docs.gupshup.io/docs/whatsapp-passthrough-apis-for-partners), updated 21 Jul 2026; [text](https://partner-docs.gupshup.io/reference/post_partner-app-appid-v3-text-message), [template](https://partner-docs.gupshup.io/reference/post_partner-app-appid-v3-message-14) (14 Oct 2026), [interactive](https://partner-docs.gupshup.io/reference/post_partner-app-appid-v3-interactive-message), [image](https://partner-docs.gupshup.io/reference/post_partner-app-appid-v3-image-message), [document](https://partner-docs.gupshup.io/reference/senddocumentmessage), [events](https://partner-docs.gupshup.io/docs/events), updated 30 Oct 2026) | **Yes** |
| Self-serve v1, `POST https://api.gupshup.io/wa/api/v1/msg` (and `/template/msg`), form-encoded, header `apikey` | Gupshup's own `message` object. A template is named by Gupshup's template id, not by its name and language. Callbacks use Gupshup's own v2 shape (`{app, type: "message" \| "message-event", payload}`). ([send messages](https://docs.gupshup.io/docs/session-messages), [inbound](https://docs.gupshup.io/docs/what-is-an-inbound-message)) | No: it is the fallback (Deferred.md) |
| Self-serve v3, `api.gupshup.io/wa/app/{appId}/v3/msg` with `apikey` | Meta's body, but documented only for **group** text messages ([group message](https://docs.gupshup.io/docs/send-whatsapp-group-message-api)) and for marketing messages (MM Lite, `/v3/marketing/msg`) | No: not documented for one-to-one messages |

The pass-through matters because whatsapp.ts already builds Meta's bodies (text, template, reply buttons, list, document, image) and reads Meta's reply. With it, one seam in whatsapp.ts (`CloudApiWire`: the send path, the path of the cheap read and the error reader) is the whole adapter, and `gupshup.ts` is about forty lines. Gupshup's template page takes `{name, language: {code}, components}`, which is exactly `templateBody`. Its older pass-through example also had `namespace` and `language.policy`, but the newer page does not need them. Every message type the templates send has a v3 page that takes a `link` for media, which is how whatsapp.ts sends a document and an image.

**What Gupshup lacks, or does differently.**
- **Gupshup's send is taken first and sent afterwards (an inference for the partner API).** Gupshup's self-serve page says its send "is processed asynchronously" and reports enqueued, failed, sent, delivered and read by callback. The partner v3 pages do not say so, but their events include Gupshup's own "Failed (internal)", sent after the call was answered. So its answer is read as *Gupshup* taking the message: Meta's refusals, including 131047 (the 24-hour window had closed), arrive later as a `failed` status. So the window check in this runtime (`windowOpen`) matters more here than with Meta, and the failed report is how the shop learns. The adapter still treats a Meta-shaped 131047 in a reply as `WindowClosedError`, in case Gupshup passes one through.
- **Its callbacks are not signed.** The inbox's path-token mode is the only check, with Gupshup's documented source addresses as an optional allowlist ([IP allowlisting](https://partner-docs.gupshup.io/docs/gupshup-ip-allowlisting)). A v3 subscription can also carry custom headers ("meta", for example a shared secret header). That is still a shared secret and not a body signature, and it is not used yet.
- **Its errors have their own shape:** `{status: "error", message}`. Three are documented: 401 "Authentication Failed", 400 "Callback Billing must be enabled for this API" (an app setting the partner must turn on) and 400 "Invalid App Details". They are read in plain words.
- **The cheap read guard-wait.ts asks a Guard that is down is `GET /partner/app/{appId}/health`.** Gupshup allows only 10 of these a minute; the waiting backs off to every 30 s.
- **Gupshup has no read that names the number.** The panel's WhatsApp connection check reads Meta's number API and does not work for a Gupshup shop yet (Deferred.md).
- **Its credentials are changing.** Gupshup's September 2026 auth guide puts the long-lived partner app token under "phasing out". The newer universal token lasts 24 hours to 60 days, and the per-app token 1 to 24 hours ([auth guide](https://partner-docs.gupshup.io/docs/partner-authentication-guide-universal-tokens-ut-overview)). A refresher like the calendar's would be needed for those (Deferred.md).

**The partner route this assumes.** Each shop signs up for its own WhatsApp account through Gupshup's self-serve Embedded Signup, as the onboarding research recommends (`research/2026-11-11-whatsapp-onboarding-facts.md` in the docs repository). Its app is then linked to Geometer's Gupshup partner account (Gupshup's "SS app link token" flow), so the partner API can send for it. **This assumes Gupshup accepts Geometer as a partner.** Whether that needs Meta's Tech Provider route and a joint Solution ID first is still open with Gupshup, and so is the pass-through's billing (the doc says prepaid partners must ask for postpaid).

**Where the key is.** Nowhere in this code. The runtime's `services.messaging.baseUrl` is the shop's WhatsApp Guard. The Guard's `[upstream_headers]` sends `Authorization` from its own file, `whatsapp_authorization`, to `partner.gupshup.io`. The partner hands the value in as `gupshup_authorization`, written as Gupshup expects it. The partner app token is the bare token with no `Bearer`. The deployer moves it into that one container's folder. Guard's header map takes any name and any `${file:...}` value, so **the Guard needed no change**. Its spec lists two routes, `/partner/app/{app_id}/v3/message` as `send` and `/partner/app/{app_id}/health` as `read_number`, and allows exactly the shop's own app id on both. The operation stays `send` and the recipient field stays `to`, so the hourly cap, the licence's final stop and its exception for the owner's number read a Gupshup shop the same way as a Meta one. The only `Authorization` an adapter ever sends is the agent's own credential for its Guard, which Guard removes.

**What WhatsApp says afterwards: delivered, read, failed.** Before this item, a status webhook was answered 200 and dropped. Now:
1. The inbox reads statuses with `parseWhatsAppStatuses` (Meta's, and Gupshup's v3, which adds `gs_id`) and forwards each `delivered`, `read` and `failed` as a `message_status` event. `sent`, Gupshup's `enqueued`, Meta's `played` and Gupshup's `set-callback` check are answered 200 and dropped: they say no more than the send's own answer.
2. The runtime saves the event as a task, like any other. Its key is the ids plus the status, so a redelivery is one event, while delivered and read are two. The runtime records it without handing it to the agent (`statuses.ts recordMessageStatus`), so a report cannot change a booking, a fee or an order, and nothing is ever sent because of one.
3. The record line has action `message_status` and outcome `confirmed` (delivered or read, WhatsApp's word that it arrived) or `failed`. Its words keep the two meanings apart. The send line's "confirmed" means WhatsApp *accepted* the message. The status line says "delivered to the person's phone; when it was sent, WhatsApp had only accepted it", or "failed: it never reached the person's phone, although it was accepted when it was sent. Nothing is sent again by itself."
4. **Which send it belongs to.** The line copies the case, the conversation and the language from the line that sent the message. That line is found by message id, in the form the record keeps it (a fingerprint under the shop's key, B69). Gupshup's examples disagree about which status field repeats the send's id: `gs_id` with a wamid in `id` on the events page, two UUIDs on the pass-through page. So every id the report gives is tried. The same report twice writes one line.
5. **A failure the shop counted on is a to-do item.** That means a failure about a case (a booking's confirmation, a payment link), or a failure to the owner or an approver (an approval request, the report). The owner's to-do list (B31) gets a `message_not_delivered` item that leaves after 7 days, like `message_unanswered`. The approvals relay sends its own messages to the owner, and those ids are not in the runtime's record. So a failure with no matching send line is still kept, and it is classed by the number it names against the owner's and the approvers'. **There is no automatic retry.** A second send could reach the person twice if the report was wrong. A closed window would refuse plain text anyway. A person decides.
6. The reports leave a failed delivery report out of the "open" payment and booking counts, as they leave out a failed send. Each status is one more runtime step and one more record line: up to two per message sent (delivered, then read). This is true for Meta shops too, and like a message, a report the runtime cannot take (it is down) is answered 503 so that the provider sends it again.
7. **Older template versions.** The inbox runs the server's current modules, but a shop pinned to an older template version runs that version's runtime, which refuses a `message_status` event as a kind it does not know (a 400 for the whole request). So reports are sent after everything else, in requests of their own, and a 400 for them is logged and dropped rather than retried for ever, and a webhook's messages are never held up by its reports. A Gupshup shop pinned to a version whose runtime does not know `provider` is refused at deploy (`whatsapp-provider-pinned`): its runtime would not start, and Meta's paths with Gupshup's token are no fallback.

**One inbox, one parser.** Gupshup's v3 callbacks are Meta's body, so `parseWhatsAppWebhook` reads its messages unchanged. The tests show this with Gupshup's own examples for text, a voice note and a picture. Gupshup documents no v3 example of a tapped button or list row, so the tests wrap Meta's examples in Gupshup's envelope (Deferred.md). A callback whose `gs_app_id` names another app is dropped, as one naming another number already was. A callback with no `gs_app_id` passes, because Gupshup's own early failures have none.

## Adding to a module later

Move a feature here when a second template needs it, in two commits: first move the file and fix its imports (the hand check and tests must be unchanged), then cut the template's knowledge out of it. The files in this folder that began as Bookings files (`check.ts`, `interactive.ts`, `meta-templates.ts`, `router.ts`) show how.
