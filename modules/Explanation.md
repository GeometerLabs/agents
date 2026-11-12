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
| The wait is over (15 minutes from when the message arrived) | It runs once more with waiting off, so the agent's own "could not" words go out. Then one record line (`guard_wait_over`), which the to-do list reads as `message_unanswered`. If that last try throws, the customer gets the template's `wait_over` words (Fees: `fee_wait_over`; below). |

What each error kind means is one table, at `waitsForGuard` in `core/faults.ts`, with one test row per kind. `provider_unreachable` does not wait: the Guard is up and the provider is away, so it keeps today's handling. Nor does the kill switch: a shop someone stopped on purpose is not an outage, and its messages must not sit for 15 minutes and then be filed as one. Guard says it only in its reason ("kill switch engaged: ..."), so that is what is read. Whether a provider's own outage should wait too is an open decision (Deferred.md).

**Order stays shop-wide.** While one task waits, the shop's later messages wait behind it, including ones that do not need that Guard. Letting them go past was considered and not done. A step that is thrown away has already taken the shop's next case number and may have made a calendar hold and a payment link under it. If the next conversation ran first it would take the same number, and its "look first" would find the first customer's hold and link. Keeping them apart needs reserved ids, and a place in line for payment events that name no conversation. A Guard that stays down past the bound therefore stops holding the shop up: the runtime has given up on it, later tasks take today's path at once, and it waits again only after that Guard has answered. The cost, at its worst, is the shop's silence for one bound per outage.

**When the wait ends without the Guard,** a step that threw on its last try gives the customer words of their own (11 Nov; Bookings and Orders `wait_over`, Fees `fee_wait_over`, in en, hi, ml and kn): "Sorry, I could not finish your request: the booking system is not answering just now. Your message is on the owner's to-do list. Please write again later, or contact <shop> directly." (Orders says "the ordering system", Fees "the fee system".) They say what happened, where the message is and what the customer can do, and nothing more, because nothing more happens: the code messages nobody and tries nothing again by itself. They do not say that nothing was held, because an earlier try may have left a tentative calendar hold (it ends by itself). Until 11 Nov these were `couldnt_tell_owner`'s words ("I couldn't reach the owner"), though nobody had tried the owner. They go in the language the customer wrote in: the step that would have noted a first-time customer's language was thrown away, so `giveUp` reads it again from the message by the rules alone (no model). The Hindi, Malayalam and Kannada lines are machine-written and on the review sheets (each template's Deferred.md).

**The ids a thrown-away step took are kept (11 Nov, B75).** When a task ends without running again (`endTask`: the last try threw, or a step that had already sent something threw), the store is rebuilt from the saved state, so nothing of the failed step is kept, except its id counters (`keepCounters`, the codec's own). The step, or an earlier try of it that waited, may have made a calendar hold or a payment link under the case id it took (`b-7`). Before this, the next customer got `b-7` again, and their "look first" found the first customer's hold (whose title names the first customer) and link and took them as their own. `templates/commerce/bookings/test/unknown-outcome.test.ts` asserts that the next customer gets a new number (written 11 Nov, not yet run). Not covered: a task the runner marks failed after its ordinary retries (an error that is not a Guard's) or after too many interrupted tries (`tasks.ts`, `failTask`) saves nothing, so its id is given out again in the same way (Deferred.md).

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
- **Gupshup has no read that names the number.** The panel's WhatsApp check for a Gupshup shop is the app's health read through its Guard (12 Nov, `bundle/panel/checks.ts` `checkGupshup`): it says Gupshup answered for the app, and names the number as not checked (Deferred.md).
- **Its credentials are changing.** Gupshup's auth guide (updated 13 Oct 2026, read 12 Nov) puts the long-lived partner app token under "phasing out". The newer universal token (UT) lasts 24 hours to 60 days and acts for the whole partner; the per-app token (UAT) lasts 1 to 24 hours and is minted with the UT ([auth guide](https://partner-docs.gupshup.io/docs/partner-authentication-guide-universal-tokens-ut-overview), [UAT mint](https://partner-docs.gupshup.io/reference/mintuniversalapptoken)). Since 12 Nov the token refresher renews a UAT for each Gupshup shop that hands in no static token, from a UT the server holds, and writes it where only that shop's WhatsApp Guard reads it (`bundle/services/gupshup-tokens.ts`; the UT never leaves the refresher's folder). A failure shows on the panel's unfinished-work list within a minute, while the token in use still has at least 8 hours. Not run against Gupshup, and the header form a UAT takes is not documented (Deferred.md).

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
## The saved state in pieces (layout 3, 11 Nov)

`runtime/store.ts`; the test is `runtime/test/store-pieces.test.ts`.

**Why.** Until layout 2 the agent's whole snapshot was one row, written again by every step, and a snapshot only grows: every booking, order or fee, every customer and every message and payment event id ever seen stays in it (about 0.8 KiB a booking in the proof of 10 Nov). A step wrote it twice (into SQLite's write-ahead log, then into the file), so a shop's disk writes grew with its age: about 11 MiB a step for a salon a year old, about 1 GiB on a busy day.

**What a step writes now.** Each list in the snapshot is kept one element to a row (`state_rows`, keyed by the list and the place): every top-level list (a template's bookings, customers, seen message ids, seen payment event ids) and every list one level inside a top-level object (a UPI shop's `upi.requests` and `upi.refunds`, which grow with the shop too). What is left, the counters and the month's AI counts, is one small row (`state_shape`) with null where each list was. A step compares the new snapshot with the stored pieces by place and writes the shape row, the elements that changed and the ones that are new. A template's lists only grow at the end or change in place (snapshot.ts writes Maps and Sets in their own order, and no template deletes from them), so that is a few rows. A list that did shrink or move is written again from the first place that differs, and is still right. What a step writes then grows only with the depth of SQLite's B-tree, about a page more each time the state grows a hundredfold: a run on 11 Nov wrote 4 pages to the log for a step with 10 past bookings behind it and 10 pages with 2,000 (a UPI ledger included), against a snapshot of about 1.7 MB. The test (`store-pieces.test.ts`, not yet run in its final form) asserts that a step behind 1,000 and one behind 3,000 past bookings write within 4 pages of each other, at most 16, and that the snapshot is more than 20 times the step.

**What did not change.** The interface: a step still hands in the whole snapshot, `loadState` still gives it back, and the pieces are written in the same transaction as the record entries and the task's done mark, so a crash still leaves a step whole or absent. The text read back is the text saved, byte for byte. `splitSnapshot` only splits text that its own parse gives back exactly (what `JSON.stringify` writes, which is what every codec writes); anything else is kept whole, as the shape with no lists. Each handle keeps the pieces it last read or wrote, to compare a step with, but only while the stored version (moved by every save) is the one it took them at; another handle on the same file, which the tests open, makes it read them again, inside the save's transaction.

**Moving a shop to layout 3.** The schema goes from 2 to 3: opening a file of layout 2 moves its one row into pieces and drops the old `state` table, in one transaction, so a reader that still asks for the old table gets "no such table" rather than a stale snapshot. A runtime of layout 2 cannot read the new file, and the deployer already refuses to move a shop back across a layout change (bundle/handcheck.ts, `savedDataLayout`; update.ts says so in plain words). The bundle's export reads either layout through `readSnapshot`, because a shop held back on an older version keeps its own older modules and the one-row table. The proof's `snapshotBytes` reads either too.

**Not measured yet:** the Docker proof's disk-write figures. The 10 Nov figures are from layout 2, and the Guards' own evidence was the larger share at 25 shops (bundle/Deferred.md).

## Unknown outcomes: what is saved (B75, 11 Nov)

The plan asks that "we're checking, don't do it again yet" comes from saved state, tied to the original operation and its reservation; that it survives a restart; that a fresh attempt cannot replace it; that a customer who stops replying does not clear it; and that a person's resolution is recorded apart from a provider's confirmation. What the three templates do, operation by operation:

| Operation, and how its outcome can be unknown | Saved where, and does it survive a restart | A fresh attempt | The customer goes quiet | Settled by |
|---|---|---|---|---|
| **A refund** (`payments/refunds.ts`, every template): the reply is lost, Guard answers 504 "outcome unknown", the provider answers 5xx, or Guard holds it with no approval | On the case: `refundIssues` (`unknown`, `uncertain`, `unconfirmed`) with the payment id, and the payment in `stoppedRefunds`; the record's `refund` `unconfirmed` line. In the snapshot, so a restart keeps it | Refused: the payment is in `stoppedRefunds`, so the agent never asks Guard again (record: `refund` `blocked`). Guard's own record would also hold an identical call | Nothing clears it: no tick, hold expiry or cancel touches `refundIssues`. The to-do list shows `refund_unknown` until it is settled | Only the payments service's own list: read by the to-do list's `recheck_refund` (read-only), or, since 12 Nov, after the provider's own `refund.done` event names a refund the list shows. Either way `refunds.ts settleIssue` settles the original attempt (matched by the refund id its reply gave, our receipt, or the payment and the exact amount it asked for), writes one `confirmed` line with the provider's refund id and the amount its list shows (an event's line also has `refs.eventId`), and tells the customer once (`refund_confirmed`), as `refund_checking` promised. "Told" is a fact only once WhatsApp accepts that message (12 Nov, the combined run's finding): until then the case keeps the settled refund in `refundsUntold`, the to-do list shows `refund_made_not_told` ("refund made, customer not yet told"), the recovery line counts who was told (`recheckLine`), and the clock tries again while nothing went out (the next beat, then less often, up to every 6 hours: `TELL_RETRY_MINUTES`); a try that may have gone out or that a gate held back is left for a person (`say.outcome`, modules/messaging/say.ts). Pinned end to end, with a restart and three days of silence, by `templates/commerce/bookings/test/unknown-outcome.test.ts` (written 11 Nov, the event and the message added 12 Nov, not yet run) |
| **A person's resolution** of a refund | Guard's `already_done` (a person at the server settled it): the `refund` line is `confirmed` with `refs.confirmedBy` (the person) and notes saying it is by that person's word, not the provider's list; no refund id. Apart from a provider's confirmation in the record (`refund-held.test.ts`, "409 already_done") | | | The monthly report's data tells them apart since 12 Nov: a person's settlement is not a refund made, and is listed in `money.settledByWord` with who said so (`modules/report/settled-by-word.ts`); the documents show it since 12 Nov ("Settled by <who>, by their word on the documents", below) |
| **A deposit or advance link** (`payments/links.ts`): the create's reply is lost | Not as an unknown: "look first" by the case id finds a link that landed. If both tries fail, the case goes back to `enquiry` with its id kept in the store; a link that did land has a URL nobody was given | Bookings takes the same booking up again at the customer's next request (`onBook` reuses the one in `enquiry`), and its look finds that link: the original, not a new one | Nothing to clear | The provider's list |
| **A calendar hold** (Bookings): the insert's reply is lost | Not as an unknown: "look first" by the booking id. A hold that landed after all is tentative and ends by itself | Found again by the booking id | The hold ends by itself | The calendar's list |
| **The deposit itself** when a hold runs out (Bookings, Orders): did the customer pay? | The hold's expiry reads the payments service first (`reconcilePayments`, uncaught in both). If that read fails the tick throws whole and nothing is saved: the case stays waiting for its payment, and is not marked expired, until the payment can be read. But the time or the stock counts as free for other customers once the hold's end has passed (it is worked out from the hold's end), as it always has: the hold's length is the promise | | The case is not given up while its payment cannot be read; its time or stock is, at the hold's end | The payments service's record; a payment found later is taken again only if the time or stock is still free, and refunded otherwise |
| **A message whose wait for a Guard ended** (B14) | The record's `guard_wait_over` line; the task is `failed` and keeps the message for a person. The to-do list's `message_unanswered` | The case ids the step took are kept (above, built 11 Nov), so a later customer cannot take its hold or link | The to-do item leaves after 7 days; the record line stays | A person |
| **A WhatsApp send** whose reply was lost | The record (`unconfirmed`). Never sent again (`guard-wait.ts`, one-time calls) | | | WhatsApp has no read-back |

**Built on 11 Nov:** the case ids of a step the runtime ends after a wait (`endTask`) are kept, so a fresh attempt cannot take over the original operation's hold and link there, and a test pins the refund's unknown state through the runtime (restart, a fresh attempt, three days of silence, then the provider's list; written, not yet run). A task the runner fails after its ordinary retries still gives its id out again (Deferred.md). **Found and left** (Deferred.md has each, with its trigger): the provider's own `refund.done` webhook is recorded but does not settle an unknown refund, only a person's look does (settled since 12 Nov: above); `refund_checking` tells the customer "I will message you as soon as it is confirmed", but the look that settles it messages nobody (kept since 12 Nov); the monthly report counts a refund a person settled as a refund made (its data apart since 12 Nov); a step that throws after a one-time call loses the case's saved unknown state with the rest of the step (Guard's record still refuses a second identical refund; no path in the three templates throws there today); and a payment on a link no booking has is recorded and ignored, with no refund and no to-do item.

## A signed summary in the link: /verify for shop owners (item 17b, decision 40; 11 Nov)

A shop owner could not check a paper on a phone: the QR opened /verify with the paper's digest, and the page then needed the paper's `.json` file. Now a
**signed** report or certificate carries a compact signed summary of itself in its QR and link, and the page (part 2, public-web) checks it with no file.
`report/summary.ts` is the format (no `node:` imports, so the website can use the same file); `report/summary-sign.ts` signs it, checks it the way the page
will, and makes the claim a server sends Geometer's fleet. The templates' `report/summary.ts` say which figures each paper carries.

**The link.** `https://geometer.dev/verify/#s1.<payload>.<signature>`, both parts base64url without padding. `s1` is the format's version: a later format is
`s2`, and the page reads every version it knows. Everything is after the `#`, which a browser never sends, so nothing about the paper reaches Geometer. The older
`#sha256:<digest>` and `#<code>` links still work and are still printed on every paper that is not signed and on the other papers (`papers/`).

**What is signed.** Ed25519 over `geo-summary/1\n` followed by the payload bytes exactly as they sit in the link. The prefix keeps a summary's signature apart
from a document's (`geo-document/1\n`), the fleet claim's (`geo-paper-signer/1\n`) and anything else the same key signs. A checker verifies the bytes it decoded
from the link before it reads them, and never re-encodes first. A summary is made only for a signed paper and only with the key in that paper's own signature
(`summaryFor` refuses another key), so the summary and the paper always have the same signer.

**The payload,** in order: the layout (one byte: which paper, which figures), the source (live, test mode, stand-in services: so a sample never reads as real
money), a flag for money the owner marked (a UPI shop, `paidBy: "owner-marked"`), the period (`2026-11`, a go-live certificate's day `2026-11-03`, or a range
`2026-11-01..2026-11-15`), the agent's name, the shop's name (up to 64 bytes), who set it up as the paper says it (up to 64: on Geometer's partner server it is the only place the
page names the partner, so it gets the same room), the figures (unsigned LEB128,
money in paise), the first 8 bytes of the signer's key id (a hint: which listed key to try), and the full paper's sha256 (so a file, when someone has it, can be
matched to the summary). Layouts: 1 Bookings' monthly report, 2 Bookings' monthly record certificate, 3 any template's go-live certificate, 4 Fees' monthly
report, 5 Orders' monthly report (Fees and Orders have no monthly record certificate yet). Each carries the figures the printed page and the owner's WhatsApp
message lead with. A layout number is never reused or changed; a new set of figures gets the next number, and a page that does not know a layout says the
paper is genuine and shows no figures rather than guessing.

**One spelling only.** The parser refuses anything the encoder would not write byte for byte: base64url with stray bits or padding, a number in more bytes
than it needs, an unknown flag or source, a figure count that does not match a known layout, bytes after the end, text with control or direction-changing
characters. A name in Hindi, Malayalam or Kannada takes three bytes a letter in UTF-8 and two in UTF-16, so a text travels as UTF-16 when (and only when) that
is strictly shorter; the high bit of its length byte says which. A name too long is cut at a whole letter and ends with "…", so the page shows it was cut.

**Size, measured 11 Nov** (level M, as every QR here): Glow Salon with a Latin "set up by" is 262 characters, version 12 (65 modules); names in Hindi 326
characters, version 13; Malayalam and Kannada 347 to 359 characters, version 14 (73 modules). The most any summary can reach (both names at their caps, a range,
nine figures near ₹1 crore) is 449 characters, version 16; names longer than the caps (64 bytes: 64 Latin letters, or 32 in an Indian script) are cut. The QR beside a summary link is drawn at 12rem (about 51 mm printed), so each module of a version
14 code is about 0.63 mm; the older digest QR stays at 9.5rem.

**On the paper and in WhatsApp.** `sealBlock` (`report/page.ts`) takes the summary link: it draws its QR, prints it as a link a phone can tap (opened with no
referrer, and the page now sends none: the report page's own address holds the secret folder it is served from), and uses `scanSummary` (no file needed,
nothing sent, and it does not show the numbers are true) instead of `scanToCheck`. A certificate's short text ends with "Check it is genuine: <link>". The
owner's monthly WhatsApp message gets one line, "Check it is genuine: {check}", before "Set up by": the longest link that lets the whole filled message stay
within 1,024 characters (`messageCheckLink`), chosen once so the plain text and the template agree: the summary link, else the paper's `#sha256:` link, else
its `#<code>` link (38 characters; used even when nothing fits, so a message that fitted before this line still fits). Measured on 11 Nov over all 48
template variants (3 templates, 4 variants, 4 languages): with the sample names every Bookings message carries the summary, Fees in Malayalam and Orders in
Malayalam and Kannada take the digest link; with long names in the shop's own script (about 50 letters for the shop and 40 for the partner), 8 of Bookings' 16
take the summary and the rest the digest link, Fees' and Orders' take the digest link, and 5 (Orders in Malayalam, Fees' UPI-and-Innovator message in
Malayalam) need the code link; the longest is 1,013 characters. The new
words are in `report/text.ts` (`CHECK_GENUINE`, `SCAN_SUMMARY`), taken into each template's strings so the review sheets list them; Hindi, Malayalam and
Kannada are machine-written.

**Who signs, and who the page names.** A server's panel holds one key (`secrets/panel/signing_key`) and signs every paper it makes. On a builder's server that
is the builder's key; on Geometer's partner server it is Geometer's, for every partner's shop. Fleet's public list (monorepo `apps/fleet/src/paper-signers.ts`)
names each key: Geometer for its partner server, never the partner, since the partner does not hold that key; a builder's key by the account that owned the
server when the key was listed, by default by name, or as "a Geometer builder" if they asked. The partner who set a shop up is still named on the page, from
the summary's `by`: the line the paper itself prints, shown as what the paper says, apart from who signed. The key hint in the link only says which entry to
try; what counts is that the signature verifies under the public key the list gives.

**How a key gets on the list.** `signerClaim(key, deploymentId)` makes `{public_key, proof}`: a signature by the key over `geo-paper-signer/1\n`, the deployment
id, `\n` and the public key in hex. The server sends it to fleet's `POST /v1/paper-signers` with its deployment key. Fleet lists a key only with that proof,
so nobody lists someone else's key under their own name, and a claim made for one server cannot be replayed for another.

**Tests** (written 11 Nov, not run: the owner runs every suite once, together): `test/report-summary.test.ts` (the format, the signature, every
one-character change, forged and re-signed summaries, the list as the trust, the committed vectors in `test/summary-vectors.json`, the QR size, the page block,
the WhatsApp rule, the claim) and each template's `test/report-summary.test.ts` (signed papers' summaries genuine and saying what the paper says, unsigned
papers unchanged, every message variant and language with long names in the shop's script within 1,024 characters).

## The owner's no, from Guard's record (12 Nov 2026, the owner's decision; monorepo ADR-0061 addendum)

Guard now refuses the identical call for 24 hours after a person denied it: a 403 with `code: refused_by_policy`, `retry: no` and `reason_code: "denied_by_approver"`,
whose `detail` names the denied request (`approval`, `denied_at_ms`, `until_ms`). No new request is opened, so nobody is asked again. This folder reads it as the owner's no:

- **`core/`.** `http.ts` makes that answer a `GuardDeniedError` (`faults.ts`), which is a `GuardRefusedError`: code that does not know it still never retries it, and
  `waitsForGuard` never waits on it. `DENIED_REPEAT_MS` (24 hours) is Guard's number, for the stand-in and the relay.
- **`payments/refunds.ts`.** It is checked before any other refusal (which means "a rule or a limit said no", for the builder). In `requestRefund` the result is
  `"denied"`. In `releaseHeld`, the relay said approve but Guard's record says no (one of several people said no, or the relay's word was wrong), and Guard is the
  record. Either way `ownerSaidNo` counts the owner's decision (`owner_decision` confirmed, deny, with the request), stops the payment, raises nothing for the builder,
  and the customer gets the template's "denied" message, never "we are checking".
- **`approvals/relay.ts`.** With the new Guard there is no request to ask about. A Guard from before the change still opens one; the relay sets aside a request for a
  refund with the same receipt, payment and amount (all it sees of a refund) as one the owner said no to in the last 24 hours (`store.deniedCall`) and tells the
  builder (`denied_repeat`), instead of asking the owner again. With the new Guard that can only be a call the agent changed in another field, and it is set aside
  too: the owner said no to that money. An own API's held call has its approval id as its receipt, so it is never matched. The owner's single ask counts from when
  the owner was asked, because the relay keeps no time of the answer.
- **The stand-ins.** `payments/guard-model.ts` refuses the identical refund for 24 hours after a no (`denied_repeat`, Guard's words and `detail`); `olderGuard: true`
  is the behaviour before, for the relay's test. `standins/guard.ts` serves it as Guard's 403 and the payments fake throws `GuardDeniedError`.
- **Tests** (written, not run): `payments/test/refund-denied.test.ts`, the classification in `templates/commerce/bookings/test/guard-responses.test.ts` (with the doc's
  body as a fixture), a row in `runtime/test/guard-wait.test.ts`, one in `refund-held.test.ts` (Guard's no wins over the relay's approve), two in
  `approvals-relay.test.ts` (no new request with Guard as it is; with an older Guard the relay does not ask again).

## Settled by <who>, by their word on the documents (B75, 12 Nov 2026)

The report data has kept a person's settlement apart since follow-up 5 (`money.settledByWord`, Bookings' `rows[].settledByWord`). The documents now say it.

- **The words, once** (`report/text.ts`). `SETTLED_BY_WORD` ("Settled by asha, by their word") and `SETTLED_BY_SOMEONE` (the same without a name), in four languages.
  Each template's `report/strings.ts` takes them in (`settledByWord`, `settledBySomeone`), so the review sheets list them with the rest. Hindi, Malayalam and Kannada
  are machine-written. `settledWho` shows who as a person reads it: Guard's `operator:` prefix goes, one line, at most 40 characters. The signed data keeps the whole name.
- **The report pages.** One money row per person, with the count and the amount, after the refunds the payments service confirmed. This is Bookings' row
  as before, now in the shared words, so Bookings' own label (`work.refundsByPerson`) went. Fees and Orders have the same row.
  Bookings' unconfirmed row a person settled says "Settled by ravi, by their word" instead of "Settled by a later step".
- **The owner's WhatsApp message.** A Meta template has no optional line, and its approved bodies should not change for a rare month. So the words go inside an
  existing value: after Bookings' not-confirmed count, and after Fees' and Orders' given-back amount ("Given back: ₹50 · Settled by ravi, by their word: 1 (₹200)").
  No template body changed, and the three `whatsapp-templates.json` are the same.
  `settledByWordWords` picks the longest form that keeps the message within WhatsApp's 1,024 characters with the shortest check link:
  - each person named (two, then "and N more");
  - no names, with the totals;
  - the count alone;
  - none, for a message that was already at the limit. A message that fitted before still fits, and the full report names them.

  It is chosen before the check link, so a long month gives up the longer link before it gives up who settled what.
- **Measured** (12 Nov, a scratch script; not a test run):
  - Bookings' worst message (120-character builder, 60-character shop, five-digit counts): 963 characters with nobody (Malayalam, #digest link), 1,010 with one
    person named (Malayalam, #digest link), 994 with three (Hindi, #code link, names given way).
  - In the long-name months of the three `report-summary.test.ts`, every form stays within 1,024. In Orders' Malayalam badge month there is no room for any form,
    so the message is as before.
- **The sample report** (`scripts/sample-report.ts`, a UPI salon) has no such refund, and regenerated byte-identical.
- **Tests** (written, not run): `modules/test/settled-by-word.test.ts` (`settledWho`, the four forms), Bookings `test/report-settled-by-word.test.ts` (the page,
  the unconfirmed row, every language and template of the message), Orders' and Fees' `test/report.test.ts` (the row and the message). The worst case in Bookings
  `test/report-whatsapp.test.ts` and the long-name months in the three `report-summary.test.ts` now include people who settled by their word.

## Not only WhatsApp: the booking page, its API, MCP and the owner's page (item 11d, decision 42; 12 Nov 2026)

`channels/` lets a customer book without WhatsApp, an AI assistant book through MCP, and the owner answer without WhatsApp. Bookings is the first template that has it
(`templates/commerce/bookings/src/channel.ts`); the runtime pieces are shared (`runtime/core.ts` `ChannelKit`, `runtime/http.ts`).

**Where things are.** Each shop of a server has, under its domain (Caddy sends `/s/*` to the inbox process, which runs `channels/front.ts`):

| Address | What |
| --- | --- |
| `/s/<shop>/` | the booking page: services and prices, then a week of days and every free start, then name and number. Plain HTML, no script, four languages (`?lang=`) |
| `/s/<shop>/b/<handle>` | a booking's own page: where it stands, how to pay (the `upi://pay` link as a button and its QR code, or the gateway's link), "I have paid", cancel, the shop's messages |
| `/s/<shop>/qr.svg` | the booking page's QR code for the counter (the panel shows the same) |
| `/s/<shop>/api/v1/...` | the booking API (`api.ts`): services, slots, bookings, a booking, its payment, cancel |
| `/s/<shop>/mcp` | the same six operations as MCP tools (`mcp.ts`), streamable HTTP with JSON answers |
| `/s/<shop>/o/<token>` | the owner's private page; `/answer` (a form), `/api/v1/state` and `/api/v1/answer` (JSON) behind the same link |

**One booking engine.** Nothing on the front decides anything. A booking from the page, the API or an assistant is a `channel_request` event, saved as a task and run as
one step of the shop's runtime like a WhatsApp message (`runtime/core.ts`: whole or not at all). The agent takes the same path as a WhatsApp booking from the hold on:
the opening-hours and double-booking limits against the calendar and the shop's own holds, the hold in the shop's own list (and the calendar, through its Guard), the
deposit request (through the gateway's Guard, or the owner-marked ledger), "booked" only when the record holds both. Only the way in differs: the request names an exact
service and start, so no words are read and no model is asked, and the start must be on the shop's grid, far enough ahead to pay in the hold's time, and within 30 days.
The record names the channel (`channel_booking`, `refs.channel` = `web` or `mcp`), and the panel and reports read the booking like any other. Free times come from the
agent's own `freeOnDay`, which WhatsApp's list uses too; a time shown is checked again when it is booked, so two customers for the last slot get one hold (the steps run
one at a time and the second finds the first's hold in the shop's own list).

**A typed number is never trusted.** The number on a form is not verified (no SMS: Deferred.md). So a channel booking lives in its own conversation (`web:` or `mcp:` and
16 hex digits of its handle's hash), never under the number: nothing typed on the page can find, change or cancel a WhatsApp customer's booking (the agent finds a
customer's bookings by conversation). And nothing is ever sent to the typed number: the agent's messaging (`channels/outbox.ts`) keeps a channel conversation's messages in
the step's own store, where its page shows them, so a fake booking cannot make the shop message a stranger at the shop's cost. The words still go through the one `say`
(`messaging/say.ts`), with its checks (message matches record, "booked" only when recorded), and are marked `refs.channel`, so the cost meter never prices them as
WhatsApp messages (`bundle/lib/usage.ts`). The owner hears about a page booking on WhatsApp as about any other, with the number the customer typed.

**Handles.** A booking is reached only by its handle: 24 random bytes, which the front gives the customer (in the page's address) or the assistant (in the tool's answer).
The runtime keeps its SHA-256 and never the handle. A form's handle is made from the form's own random nonce and what it asks for (`handle.ts handleFromNonce`), so a
second tap on "Hold this time" is the same task and lands on the same booking.

**Tokens.** The front reaches the runtime with the shop's CHANNEL token (`/internal/channel/*`), which can save only a `channel_request` or an `owner_action` and read the
offer, a booking by its handle's hash, and (with the owner's link) the owner's list. It cannot send a WhatsApp message, a payment event or an approval: only the inbox's
internal token can. The front runs in the inbox process, so today the isolation is per token, not per process: a fault in that process could reach both tokens. A front
container of its own is in Deferred.md.

**The owner's page.** The partner makes the link in the panel (shown once; only its hash is kept in `shops/<shop>/owner-link.json`). The deployer copies the hash to the
runtime's client folder and the relay's secret folder on every pass of its loop (every 10 s), and removes both when the panel switches the link off; the runtime and the
relay read their copy on every request. So the link is checked at the authority, not only at the front, and a revoked link stops within one pass, without a restart.
The page lists, from the saved state and never from messages: a deposit to mark received (UPI), a refund the owner owes and marks sent, a late cancellation's refund the
agent asked about, a paid booking the calendar would not confirm, and, for a gateway shop, the refunds Guard holds (from the relay). Each answer carries the digest of
exactly what was shown (kind, case, ids, amount and how far it has got). The authority compares it with what waits now and does nothing when they differ:
- the runtime turns a matching press into the owner's own WhatsApp reply (the one-use code's button for a UPI mark, so the amount marked is exactly what is still asked;
  `approve b-3` and the like for its own asks) and handles it by the same code;
- the relay answers a refund Guard holds inside its one-at-a-time chain with the same `finishDecision` a WhatsApp code takes (the owner's signed answer to Guard, then the
  runtime, then the owner told), so a WhatsApp reply and a press can never both count. A changed amount is a new held call, a new approval and a new digest, so it needs
  a new yes; a no is final for that call (Guard refuses the identical call since 12 Nov, and the page's answer is the ask's one use). The page shows only the owner's own
  asks, never another approver's (B37).
For a shop on WhatsApp the page is one more way to answer, never a replacement. The JSON pair is the same state and the same answer, for the owner's app another job builds.
The link widens who can answer: on WhatsApp only the owner's phone can, while anyone who has seen the link can answer as the owner, the partner who made it included.
So the panel shows it once, the page says not to share it, a shop that moves to another partner loses it (the new partner makes a new one), and the partner can switch
it off at any time. An answer the page could not see done within a few seconds (the step waits for a Guard) is shown as "sent", never as "done".

**Abuse, without a CAPTCHA.** At the front, per address (Caddy's view of the visitor): 6 booking starts and 20 cancels or claims per 10 minutes, 120 reads a minute, 10
unknown handles or links an hour; and 60 starts per 10 minutes per shop from every address together. In the step, from saved state: 2 unpaid holds per number at once, 5
starts per number per 24 hours, 6 unpaid holds from the page and the API per shop at once, 30 days ahead at most. Every hold ends by itself after the shop's hold time.
Refused requests and finished ones are dropped with the shop's retention (30 days), so a flood of refusals does not grow the store for ever.

**What a fake booking can and cannot do.** It can hold one free time until the hold ends (the shop's hold time, an hour in the example) and make the owner one "payment
to check" notice. It can use up the number it typed: that number's two holds and five starts a day, which may be a real customer's number. One address typing three
numbers, or many addresses, can keep the shop's cap of six unpaid page holds full for as long as they keep starting new ones; while it is full, real page customers are
told to try later, and WhatsApp customers cannot have those six times either (they are held). The per-address and per-shop start limits slow this, and every hold ends by
itself; a verified number (Deferred.md, SMS) is what would stop it. It cannot confirm a booking (only the deposit, which on a UPI shop only the owner marks), mark a payment,
approve a refund, see or touch another booking, or send anything to anyone but the owner.

**MCP.** The engine's conventions (`monorepo/apps/cli/src/mcp.rs`): the four protocol versions, the newest when a client asks for another, tools with JSON Schema and
`readOnlyHint`, a refusal as a tool result with `isError` so the assistant can read it. POST only (no event stream, GET is 405), a notification is 202, no session. An
Origin header from another site is refused. "Behind Guard" means what it means for a WhatsApp booking: each change is a runtime step, and each outside effect of that step
goes through the shop's Guard for it. The endpoint is not a Guard itself, and a UPI shop on its own booking list can make a booking that touches no Guard at all: the
hold, the limits and the owner's mark are then the runtime's.

## Orders and Fees on the page (item 11h, decision 45; 13 Nov 2026)

Item 11d built Bookings' page only. Item 11h gives Orders and Fees their parts of the same page, with the same pattern: nothing on the front decides anything,
every change is an event the template's own agent runs as a step, and the owner answers from the same private page. The front picks a shop's customer side by its
template (`front.ts` `FrontShop.kind`, written by the bundle from the shop's pathway): `front-orders.ts` for Orders, `front-fees.ts` for Fees. The owner's page and
the QR code are every shop's.

| Address | What |
| --- | --- |
| `/s/<shop>/` (Orders) | the menu: a day, the items at the shop's own prices with what is left that day, pickup or delivery and the slot, then name and number. Plain HTML, no script |
| `/s/<shop>/order/<handle>` | an order's own page: where it stands, its lines and total, how to pay the advance (UPI button and QR, or the gateway's link), "I have paid", cancel, the shop's messages |
| `/s/<shop>/api/v1/...`, `/s/<shop>/mcp` (Orders) | the ordering API and the same five operations as MCP tools (`order-ops.ts`): list the items, start an order, payment instructions, order status, cancel |
| `/s/<shop>/` (Fees) | the centre's page: who it is, and that fees are paid from each parent's private link. No form: a number typed here opens nothing |
| `/s/<shop>/f/<link>` | a parent's private page: their students and their fees, how to pay each, "I have paid" |
| `/s/<shop>/fee/<handle>` | a payment's confirmation page, made by "I have paid" |

**Orders: an exact order through `proceed`.** The page, the API and an assistant send item ids with quantities, a day, the way and a slot, and for a delivery the
address as typed. No price, total or advance is read from a request: the event has no field for one, and the agent prices every line from the settings. Before
`proceed`, the agent checks each value against the settings (an item the menu has, the shop's item limit, a day from today to the shop's last day, a slot of that
way, an address naming a place on the delivery list), because `proceed` would otherwise ask for what is missing and a page cannot answer a question. A request that
fails is refused with a reason the page words, and nothing is held. Then it is the WhatsApp order's own path: the cut-off, the stock of every item and the day's
count (worked out from the orders themselves, so two customers for the last one get one hold: the steps run one at a time and the second finds the first's hold),
the big-order line (the order waits for the owner, nothing held), then the hold and the advance through the gateway's Guard or the owner-marked ledger.
"Confirmed" comes only when the record holds the whole advance. The order lives in its own conversation (`web:` or `mcp:` and 16 hex digits of its handle's
hash), its messages are kept for its page (`outbox.ts`), and the owner's messages name the number the customer typed. The limits are Bookings': two unpaid orders
per number, five starts per number a day, six unpaid page orders per shop (an order waiting for the owner counts too, since each one asks the owner), and the
front's per-address and per-shop start limits. The delivery address as typed goes to the owner only; the page and the API show its place on the list.

**Fees: a typed number never opens a student's fees.** The parent is known from the centre's settings, so the authority is a private link per parent, not a
form:
- **The link.** 24 random bytes (`handle.ts`), the same shape as a handle. The runtime keeps only its SHA-256, with a prefix of its own (`parentLinkHash`, so a
  handle can never open a parent's page or the other way round), in the saved state by the parent's number (`due.ts` `parentLinks`). One per parent: a new link
  replaces the old, which then opens nothing. Because it is in the saved state, it survives a restart and a handover (the state moves with the shop; the owner's
  panel-made link, which lives in the client folder, does not).
- **How a parent gets it.** In the fee reminder: when the centre has a page (its pages file), the three reminders become `fee_reminder_page`, `fee_overdue_page` and
  `fee_overdue_late_page`, the same words with one more line, "see your children's fees on your private page: <link>. Please do not share it." Each is a WhatsApp
  template of its own (Meta's are not submitted yet, so the wording costs nothing to change). And by the owner's "Send a new link" on their page, which sends
  `fee_page_link`. A link is saved as the parent's only when the message carrying it was accepted, so a reminder that did not go keeps the old link working.
- **Not a new link with every reminder.** The runtime remembers, in its process memory only, the links it made (`linkMemory`), and a reminder sends the same link
  while its hash is still the saved one. A parent with two children gets one link in both reminders (made once in the step). After a restart the next reminder makes
  a new link (Deferred.md says why, and what would change it).
- **Checked at the runtime, twice.** The front sends only the link's hash. The runtime answers a page for the parent whose saved hash it is now, and a press on the
  page carries the hash again, which the agent checks in the step: a link replaced or switched off since the page was drawn does nothing, and the fee must be that
  parent's own. Wrong links count as guesses at the front.
- **What a press does.** "Show how to pay" makes the request for what is owed (the same `currentLink` a reminder uses; the owner is told what to look for, with the
  code). "I have paid" is the WhatsApp claim: the owner is asked to look (at most once an hour), nothing is marked paid. Neither sends the parent a WhatsApp message:
  the page is the answer. The receipt still goes on WhatsApp when the owner's mark settles the fee, as it always did.
- **The confirmation page.** "I have paid" makes a handle (from the page's nonce, so a double tap is one press) whose hash is saved with the fee and the parent. Its
  page says "confirmed" only when the record shows the fee paid (the payments service's own list, or the owner's mark on a UPI centre); "waiting" before, "part" when
  some is recorded. It survives a new link (it is the parent's own record of that payment); switching the link off removes the confirmation pages made through it.
- **No API or MCP for fees.** An assistant has no way to be given a parent's link, and nothing else may find fees.

**What a leaked parent link can do.** Whoever holds it sees that parent's children's fees, can ask for the payment details, and can say "I have paid", which only
asks the owner to look. It cannot mark anything paid, change an amount, see another parent's children, or reach a booking or an order. The owner switches it off from
their page, and a new one replaces it.

**The owner's page and "what needs me" are one list.** Each template's `channel.ts ownerItems` is what the owner's page shows, what the owner's press is checked
against (by its digest), and what the assistant's skill reads for "what needs me", the morning line's count and the mood, as Bookings' was in the integration of items
11d and 11e. Orders: an advance to mark received (UPI), a refund the owner owes, a big order to accept or refuse, a late cancellation's refund. Fees: a payment a
parent says they made (a UPI centre, from the claim until the owner marks it or the fee is settled), a refund the owner owes, a waiver or a refund a parent asked
for; and the parents with their links. An open fee nobody has claimed is not on the list: it waits for the parent, and a centre of forty students would otherwise
have forty items every month. A press does exactly what the owner's reply on WhatsApp does: the UPI mark's button with its one-use code, or "approve o-3" / "approve
q-3" and the like.

**The bundle.** Every pathway's shop now has a page (`generate/configs.ts` writes `channel` with its `kind` for Bookings, Orders and Fees; every runtime already had
a channel token). The pages domain's `robots.txt` also keeps parents' pages, payments' and orders' pages out of search.

## The shop's assistant (item 11e, decision 43; 12 Nov 2026)

Decision 43: a shop gets **one assistant, not a set of agent templates**. Bookings, Fees and Orders become its skills; the owner talks to the assistant by text or voice note
(it listens to voice notes and always answers in text: the owner's decision of 12 Nov);
anything touching money or a limit comes back as a card showing the exact change, done only by a tap. This section says where the assistant sits and why. The code is
`assistant/`; what waits is in [Deferred.md](Deferred.md#the-shops-assistant-item-11e).

### What there is today

A shop is one template. Its `pathway.lock` names one pathway (`bookings@0.1.0`), and the bundle runs one runtime for it (`rt-<shop>`, `bundle/generate/compose.ts`). The runtime sits
on its own network with its own Guards (payments or the UPI desk, WhatsApp, calendar) and the model Guard, and can reach nothing else. Every webhook comes through the inbox
(`/c/<shop>/...`), and the owner's messages are copied to the approvals relay. A business that wanted Bookings and Fees would be two shops today, with two WhatsApp numbers.

Inside the runtime, one step (`runtime/core.ts`) builds a fresh store and record from the last saved state, lets the agent handle one event, and saves the new state,
the record lines and the task's done mark in one transaction. The owner already talks to the agent with fixed phrases: `today`/`tomorrow`, `approve|deny|retry b-14`
(Fees `q-N`, Orders `o-N`), the UPI marks `received K7M2QX` (and their buttons), `move <code>` for a handover, `terms` and `I agree`. The relay's `approve K7M2QX` is the
relay's, and every agent drops it without a word. Anything else gets `owner_unknown_command`.

### The choice: a module inside the runtime, with a shared router

The assistant is **not a new process in front**. It is a module (`assistant/`) the runtime runs as the first thing in a step, for the owner's messages and the clock's
tick, and a small pure router that says which skill a message is for. Why:

1. **A card or an undo must be saved with the case it changes.** "Closed Sunday; I've asked the two customers to pick another day" changes the shop's closed days,
   two bookings' messages and the record. Inside the runtime these go in the step's one transaction, so a crash leaves the day closed and the customers asked, or
   nothing. A front process would have its own store, its own WhatsApp principal and a save split across two stores for every card. That makes the exactly-once rule
   (B75) harder for no gain.
2. **The record shows which skill acted, by construction.** The act runs in the skill's own agent and lands in that skill's record (`owner_assistant` lines for the
   conversation, the skill's usual lines for what it did). A front process would have to copy that back.
3. **No new authority and no new network path.** The runtime keeps reaching only its own Guards. The assistant holds no approver secret and no provider key. A refund above
   the limit is still held by Guard and asked about by the relay. The assistant cannot do anything the owner's own fixed phrases cannot do today.
4. **The first release has one skill per shop.** The pilot's shops are single-skill (a salon: Bookings; a tuition centre: Fees), and the bundle deploys one pathway per
   shop. For them the router's answer is always "the one skill", and nothing in the bundle changes.

**A shop with two skills** is the router's real job, and its home is the same: one runtime that hosts several skills' agents over one store (a composite kit, one
`skills.<name>` part per skill plus the assistant's part), with the router as the first step. One WhatsApp number per shop, one record (each line tagged with its skill),
one morning line, one character. The bundle cannot express that yet: a shop folder has one `pathway.lock`, one template mounted at `/pathway`, and Guard specs made
from one template's limits. So the composite runtime and its deploy wait (Deferred, with its trigger). The router is built and tested now as a pure function
(`assistant/route.ts`), so the decision is made in code, not only on paper.

**What was weighed against it.** A small runtime in front would have left each template's deployment untouched and made cross-skill reads simple (HTTP reads of each skill's
owner view). But it adds a trusted process that reaches every skill's door and the WhatsApp Guard, splits every act across two saves, and needs the record copied
back. The composite runtime keeps the sandbox and the one transaction. Its cost is in the bundle (several pathways per shop, one Guard spec from several skills' limits),
and that cost is paid once, when the first two-skill shop needs it.

### How a message is read

**The router** (`route.ts`, pure), in order, cheapest first, and never a model for a customer:

1. a tapped button's id says whose it is: the assistant's own card buttons, the relay's card buttons, or a skill's (each skill names the id prefixes it issues);
2. a case reference in the text (`b-14`, `f-3`/`q-2`, `o-5`) names the skill that owns it;
3. the words, by the skills' own few keywords in four languages ("book", "fees", "order" ...), when they name exactly one skill;
4. the customer's open case: the skill whose case for this number is still live (a booking waiting for its deposit, an open fee);
5. a shop of one skill: that skill. Otherwise a menu of the skills as buttons, which costs nothing and asks the customer in their language.

**The owner's words** (`intents.ts`) go through the same three steps as a customer's, through the shared router (`understanding/router.ts`) and reader (`reader.ts`), so they
count in the same month's AI spend and fall back to rules in button mode. The steps are rules, then the decision model, then the small language model. The rules come
first and catch most messages. The models only pick **what kind** of thing the owner wants (a day's list, who owes, close a day ...). **Every value comes from the words by
rule, or from the record:** the day ("Sunday", "16 Nov", "kal", "ഞായർ" through `language/dates.ts`), the case reference, the amount's digits, and for a message to a
customer the owner's own words after the reference, sent as written. A model never writes a value into an act. When a reference is missing or names nothing, the
assistant asks, listing the candidates it found on the record. It does not guess.

**The fixed phrases keep working exactly as before.** The assistant is called only where the agent used to answer `owner_unknown_command`, after every fixed phrase has had
its turn, and a shop without the assistant (`settings.assistant` left out) behaves as before. The relay's new card buttons (below) are dropped by every agent without a word,
the same as the typed `approve K7M2QX`.

### Ask and act

- **Ask** (no change to anything): tomorrow's bookings, today's list, any date's list, who owes fees, open orders, what needs me, money in today. Each skill answers from its
  own saved state (`skill.ts`: pure reads over the store), so the owner's app and the morning line read the same functions.
- **Act, not money** (close a day, reopen it, move a booking): done at once, said in passing, and **undoable** ("undo", for 24 hours; a move goes back only if the old
  time is still free). Closing a day takes the
  date out of the free times. The booking page and the WhatsApp offer read the same list. Each booking that day stays as it is, and its customer is asked to pick another
  day. The owner is told how many were booked that day and, by reference and number, any customer the message could not reach (STOP, or outside their window before
  the template is approved), to call them. Nothing is cancelled or refunded by closing a day: a customer who cancels goes through the shop's usual rule. **Undo** reopens the day, and each customer who was
  asked and has not moved or cancelled is told their booking stands.
- **Act, money or a limit:** cancelling a paid booking, a refund, approving or refusing what waits (a late refund, a waiver, a big order, a deposit to mark). These come back as a **card**.
- **A message to a customer** is not money, but it cannot be taken back, so it also comes as a card (a preview). The owner's words go to the customer as typed, under the
  shop's name, through the outgoing check and the customer's 24-hour window. STOP is STOP. When the window is closed, the card says so: WhatsApp lets a shop start a
  conversation only with an approved template, and a free text is not one.
- **Loosening a limit** (a bigger refund limit, a lower deposit, more holds) is not possible from the owner's chat in the first release. The assistant says so, in the
  owner's language, and names the partner's panel.

### What the owner can say, per skill (first release)

The words are read in English, Hindi (also typed in Latin letters), Malayalam and Kannada (`intents.ts`; the tests hold examples in each language). The answers are written
in the owner's language (`owner.language`).

| | Bookings | Fees | Orders |
| --- | --- | --- | --- |
| **Ask** | a day's list ("tomorrow", "bookings on Sunday", "कल की बुकिंग"), money in, what needs me | who owes, money in, what needs me | open orders, money in, what needs me |
| **Act, said in passing, undoable** | close a day, reopen it; move a booking ("move b-14 to 5pm", "shift b-14 to Friday"), through the agent's own reschedule with both slot rules checked first and the customer told; undo | – | – |
| **Act, as a card** | cancel a booking (with its deposit back), refund a cancelled booking's deposit (all or part), answer what waits (a late refund, a calendar retry, a UPI deposit to mark, a refund sent), message a customer | answer what waits (a waiver, a refund request), message a parent | answer what waits (a big order, a late refund), message a customer |
| **Not from the chat** | loosening a limit (the partner's panel) | loosening a limit, cancelling or refunding a fee (Deferred) | loosening a limit, cancelling or refunding an order (Deferred) |

The owner's fixed phrases come first and are unchanged: `today`, `tomorrow`, `approve|deny|retry b-14` (Fees `q-N`, Orders `o-N`), `received K7M2QX` and its button,
`move <code>`, `terms`, `I agree`, and the relay's `approve K7M2QX`. A card's yes on something waiting **is** the owner's fixed reply (`wire.ts ownerReply`): the agent handles it
exactly as if the owner had typed it, so a card adds no new way to act.

**A message to a customer** is read first: when the message command ("message", "tell", "bolo", "പറയ", "ಹೇಳಿ") is the first command word and a customer is named, the
rest is the owner's words, whatever they say ("message b-1 sorry, we are closed tomorrow" never closes tomorrow; "tell b-1 we can move you to 5pm" never moves the
booking). It goes as the owner typed it, prefixed with the shop's name. It is the owner's speech, not the agent's, so the outgoing check reads the words as the
owner's own (their dates and times are theirs to state), with one exception that keeps money on its own path: an amount in rupees must be one the case has (the deposit, the
price, the fee, the order's total). "We'll give you ₹500 back" is refused with "to give money back, say: refund b-14".

### The card binding

There are **two issuers of cards, never mixed**:

1. **A refund Guard holds** (a gateway shop, above the limit): the **relay's** card, because only the relay holds the owner's approver secret. Its words are the relay's ask
   as today, written from Guard's held call. When the owner's window is open it now goes with two buttons whose ids carry the ask's one-use code (`appr-approve:K7M2QX`,
   `appr-deny:K7M2QX`). The relay reads a tap exactly as the typed `approve K7M2QX`: the same code, the same one use, the same wrong-guess count, the same Guard answer.
   A changed amount is a new held call, so a new approval and a new card. A no is final: Guard refuses the identical call for 24 hours (`denied_by_approver`).
2. **What the runtime itself decides** (a refund within the limit, a cancellation, a late refund, a waiver, a big order, a message): the **runtime's** card
   (`cards.ts`). A card is a saved, immutable action: the skill, the case and the exact fields (amount in paise, payment id, recipient's number and name, the message's words).
   It carries a digest of those fields, a fresh one-use code (the approvals alphabet; only its hash is kept), and words written from those same fields. The buttons carry
   the code (`card-yes:K7M2QX`, `card-no:K7M2QX`). The typed form is `yes K7M2QX` / `no K7M2QX` (typed, only when a card has that code; "no thanks" is just words). It is a different verb from the relay's on purpose: the relay counts every
   code it never issued towards its lockout, so the two must never be confused.

   On a tap, the skill re-reads the action from the store **as it is now** and compares its digest with the card's. They match: the skill does exactly the saved action,
   in this step, and the card is closed. They differ (the amount, the payment or the customer changed): **nothing is done**, the card is void, and a new card is sent with
   the new fields. A second tap on a closed card does nothing. **A no is final for that action:** the card is closed as refused, and the same action (the same digest) proposed
   again within 24 hours gets "You said no to this at 10:02" instead of a new card. On something already waiting (a late refund, a waiver, a big order), Refuse **is**
   the owner's own `deny`: it is sent to the skill while the item is still the one the card showed, so the item stops waiting and the customer hears the answer. Free text never executes: a typed "yes", "haan" or "ok" is a new message to read,
   not a tap. Nothing changes before the tap, including the cancel half of "cancel and refund".

   Above Guard's limit, the runtime's tap is not the authority: the skill asks Guard, Guard holds it, and the relay's card follows (issuer 1). The runtime's card
   then says so before the tap ("Above your ₹1,000 limit: Guard will ask you to approve it once more").

**Where the owner sees cards:** on WhatsApp (interactive buttons while the owner's window is open; outside it, the text with the typed form) and in the owner's app
on the shop's page, with the same question and buttons, answered by the card's id and digest (never its code). Both doors go through one verdict (`cards.ts judgeCard`),
so a card answered at one is closed at the other.

### The morning line

One short message a day to the owner (`morning.ts`): what today holds for each skill (Bookings: how many bookings and the first time; Fees: the fees not paid and how
much; Orders: the open orders), money recorded yesterday (every confirmed payment line, the owner's UPI marks included as the owner's statement), and how many things wait for them. It goes
in the owner's language, from 08:00 in the shop's time zone (`settings.assistant.morning.at`, or `false` for none). It uses the same **once, even if the process dies**
protocol as the monthly report (`report/monthly-job.ts`): a claim saved before the send, then the ending. A claim with no ending is never sent again. It goes as the
utility template `owner_morning` outside the owner's 24-hour window and as plain text inside it, the template's body filled in either way. It says nothing on a closed day (the weekday
is closed in the opening hours, or the owner closed the date) and nothing on a day with nothing to say (nothing today, nothing recorded yesterday, nothing waiting), and it is
not sent more than four hours after its time. A month of morning lines is not activity for the monthly report (`report/monthly-job.ts` leaves them out, as its own lines).

### The character's hooks (the drawings are a separate exploration)

`character.ts`: one character per shop, in the shop's settings (`assistant.character`): a name and a look as a small JSON of options from a fixed list (base, colour,
accessory for the trade). Nothing is drawn here. There is no voice (the owner's decision, 12 Nov: "listen in voice, reply in text"): the assistant understands the
owner's voice notes through the voice notes job's speech to text, and every reply, card and morning line is text, with the mood's sticker where one is planned. `mood.ts`: **a mood computed only from the shop's real state**, never stored and
never earned. In order: `something_wrong` (a refund needs the builder, a message failed, a task gave up on a Guard), `waiting_for_owner` (a card or a waiting item),
`closed` (outside today's hours, or a closed day), `busy` (a booking within the hour, or a full day), `quiet`. The owner's app shows it, and the morning line names the
sticker for it (`stickerFor`), so the look can follow the shop. There are no points, chores or streaks. The character always says it is the shop's assistant.

### The owner's app, wired (items 11d, 11e and 11f together; 13 Nov)

The app is the owner's private approvals page (item 11d, `channels/owner-page.ts`) grown into an installable web app. Plain HTML first and a little progressive JavaScript,
phone-first, in the owner's language. It answers wherever the owner's view does, behind the owner's credential, checked at the runtime: the signed-in view `<base>/owner`
(item 11f: the one-use link from WhatsApp, a cookie scoped to that path, a form token on every POST) and the panel-made link `/s/<shop>/o/<token>` (item 11d). Below,
`<owner>` is either. Only a shop whose settings have the `assistant` block has the app; without it the page is item 11d's, as before.

| Route | What it is |
| --- | --- |
| `GET  <owner>/` (and without the slash) | the page: the character's line and the mood, what needs you (the runtime's items, the relay's asks and the assistant's open cards, each with its buttons), the coming bookings, the talk box (`app/view.ts`, `app/talk.ts`) |
| `GET  <owner>/manifest.webmanifest` | the PWA manifest (`app/pwa.ts`); `start_url` and `scope` are `<owner>/`, so an installed app opens this shop's page only (a service worker controls only pages inside its scope, hence the slash). The page links it with `crossorigin="use-credentials"`, since on the signed-in view it is behind the cookie |
| `GET  <owner>/sw.js` | the service worker: keeps the last page for **reading** offline, marked offline. A tap or a message is never kept or queued: it needs the live page's digest. Its own policy lets it fetch the page and nothing else |
| `POST <owner>/answer` | a waiting item's button, as item 11d's page posts it (source, action, case, digest); an assistant card's as `card_yes` / `card_no` with the card's id (`c-3`) and digest. The front refuses a card the page did not show; the runtime checks the credential, then the card's binding decides |
| `POST <owner>/talk` | the talk box: an `owner_message` channel event (only the words) read by the same assistant as a WhatsApp message; the owner's line and the answer are kept in `state.talk` and shown on the page, never sent to WhatsApp as well |
| `POST <owner>/voice` | a hold-to-record recording (Ogg Opus, at most 256 KB); see below |

**Its one script.** The pages origin is shared by every shop on the pages domain, and nothing there runs script but Geometer's own (bundle/Explanation.md, "One origin
for every shop"). The app's page carries a policy of its own (`channels/front.ts appPolicy`): item 11d's no-script policy plus `script-src 'nonce-…'` (fresh for every
response, on the page's one inline script), and `worker-src`, `connect-src` and `manifest-src` naming the app's own three addresses under `<owner>`, never `'self'`.
Every other page keeps item 11d's policy. The door passes our front's policy through and still replaces a builder's with no script.

**Talk on the page.** The talk box reads the assistant's words only: the fixed phrases ("today", "approve b-3", "received K7M2QX") are WhatsApp's, and their buttons
are already on the page. While the owner acts from the page (the talk box, a card's button there), the assistant's answers go to the page's talk instead of WhatsApp;
a new card is not written there, it shows in the page's list with its buttons (and its question without the code, `words.ts cardQuestion`). The answers pass the same
outgoing check as a WhatsApp message. Lines to customers (a closed day, a message card's words) still go to them the usual way.

**A recording.** The page posts it to the front, which passes it to the runtime's own route (`/internal/channel/owner-voice`, the owner's credential checked there).
The runtime holds the audio **in memory only** (`channels/owner-audio.ts`, five minutes at most) and saves an `owner_message` that carries only its reference; the
front can never set that reference (the event check drops it). The step hears it through the same listener as a WhatsApp note (`voice/turn.ts createListener`, with
`voice.ts hearAudio`): the same switches (voice on, not button mode, allowance left), the same day's limit and month's spend, the cost on an `owner_assistant` line, then
read as the talk box's words. A restart forgets a recording that was waiting: the owner is asked to type it. The record button shows only when the shop has a voice
service and the phone can record Ogg Opus (Deferred.md: most Android phones record WebM).

**The owner's WhatsApp voice notes.** The agents hand the assistant `hearing`: the shop's voice service through that same shared listener, with the owner not left
out. The cost goes on an `owner_assistant` line when the note is heard (so a spoken fixed phrase is counted too), and the words then go through the fixed phrases
first and the assistant after, as typed words do. Voice off, the assistant off, or button mode: the owner gets the "please type" line, as before.

**One list.** Bookings' "what needs me", the morning line's count and the mood read the owner page's own list (`templates/commerce/bookings/src/channel.ts
ownerItems`), so the chat and the page never disagree. A card's fields carry the page item's digest, so a part marked after the card was shown voids it on its tap,
as a press on the page would be refused. One consequence: on a UPI shop a deposit waits for the owner from the hold on, as on the page.

**A closed day.** The skip for a date the owner closed lives in Bookings' one per-day function (`freeOnDay`), so WhatsApp's list, the booking page, the API and MCP
leave it out together; a booking asked for on it from the page or the API is refused as outside the hours before anything is held.

### Tests

Written and run one file at a time (12 Nov): `assistant/test/cards.test.ts` (the binding), `intents.test.ts` (four languages; the models choose only the kind),
`words.test.ts` (every message and template in every language against the outgoing check), `morning.test.ts` (once, silent days, the claim before the send),
`character-mood.test.ts`, `route.test.ts`, `app.test.ts`, and Bookings `test/assistant.test.ts` end to end on the fakes (the fixed phrases kept, a card's tap refunding
exactly the amount shown, a changed amount voiding the card, a final no, free text never executing, a closed day and its undo, a move and its undo, the UPI marks and
the handover phrase untouched, the morning line from the same store), Bookings `test/approvals-card.test.ts` (the relay's card: a tap is the typed code, once; a wrong
code is a wrong guess), Fees and Orders `test/assistant.test.ts` (off without the block; who owes and open orders; a waiver's Approve and Refuse are the owner's
own approve and deny; a big order's Refuse is their deny) and `bundle/test/assistant-usage.test.ts` (the owner's model spend is metered, never as a customer
message). One existing test changed meaning and was updated: Bookings `test/approvals-relay.test.ts` asserted the relay's ask inside the owner's window was plain text;
it is now a card with the same words.
Wired on 13 Nov (the integration of items 11d, 11e, 11f and B29), with tests: Bookings `test/channels.test.ts` (a closed day offered nowhere and a POST for it
refused; a card answered through the owner's JSON pair; the app at `<base>/owner` after sign-in: the nonce, the manifest, the worker, the talk box answered on the
page), `test/assistant.test.ts` (one list with the page; a card answered on the page is closed on WhatsApp and the reverse; a changed amount and a final no on the
page), `test/voice-notes.test.ts` (the owner's spoken "close tomorrow", the cost in the month's spend and the cost meter, a spoken fixed phrase, the "please type"
cases, a page recording heard from memory), `channels/test/channels.test.ts` (the new events), `assistant/test/app.test.ts` (the talk box's nonce and form token) and
`bundle/test/door.test.ts` (our nonce policy passes, a builder's never; only the local recording is bigger).
The templates' existing suites were not run by the 12 Nov job (a combined run was using the machine). The agents' changes are additive and off without an `assistant` block,
except two that apply to every shop: every agent now also drops a tapped relay button (`isRelayReply`), and Bookings' within-hours limit takes the closed days (none
without the assistant).

## Adding to a module later

Move a feature here when a second template needs it, in two commits: first move the file and fix its imports (the hand check and tests must be unchanged), then cut the template's knowledge out of it. The files in this folder that began as Bookings files (`check.ts`, `interactive.ts`, `meta-templates.ts`, `router.ts`) show how.

## WhatsApp through Gupshup's self-serve API, for a shop's own account (item 11c, 12 Nov)

`messaging/gupshup-selfserve.ts`, `providers.ts`, `webhooks.ts` (the version 2 callbacks), `core/http.ts` (a form body); `inbox/server.ts` (the app-name check); `bundle/generate/guards.ts`, `bundle/panel/checks.ts`, `setup.ts`, `cost.ts`, `bundle/services/heartbeat.ts`.

**Why this exists.** Decision 42: the pilot goes through Gupshup, but Gupshup's partner API (item 11b) needs Geometer to be a Meta Tech Provider, which needs a registered company, which comes after the pilot. So each pilot shop is Gupshup's own self-serve customer with its own app and API key, and the agent speaks the self-serve API. 11b's partner file stays for the day Geometer is a partner; Meta direct stays the default.

**Which API, and why (read 12 Nov 2026).** I looked for a Meta-format (v3) send for self-serve apps first, as asked. Gupshup's own index (https://docs.gupshup.io/llms.txt) lists one v3 page, "Send MM Lite Messages (v3)": `POST https://api.gupshup.io/wa/app/{appId}/v3/marketing/msg`, "only supports marketing template" ([page](https://docs.gupshup.io/reference/send-mm-lite-messages-v3.md)); the earlier look found v3 for group text as well. Nothing covers one-to-one text, utility templates, buttons, lists, documents or images, so every type is mapped to the v1 self-serve API:

| Our message | Gupshup self-serve | Source |
|---|---|---|
| text | `POST /wa/api/v1/msg`, form fields `channel=whatsapp`, `source`, `destination`, `src.name`, `message={"type":"text","text":...}` | [text](https://docs.gupshup.io/reference/session-text-message.md), [session messages](https://docs.gupshup.io/docs/session-messages) |
| reply buttons (1 to 3) | `message={"type":"quick_reply","content":{"type":"text","text":...},"options":[{"title","postbackText"}]}` | [quick replies](https://docs.gupshup.io/reference/quick-replies.md) |
| list | `message={"type":"list","title","body","msgid","globalButtons":[...],"items":[{"options":[{"type":"text","title","description","postbackText"}]}]}` | [list](https://docs.gupshup.io/reference/post_wa-api-v1-msg-1.md) |
| document | `message={"type":"file","url","filename","caption"}` | [document](https://docs.gupshup.io/reference/post_wa-api-v1-msg-5.md) |
| image | `message={"type":"image","originalUrl","previewUrl","caption"}` | [image](https://docs.gupshup.io/reference/post_wa-api-v1-msg-3.md) |
| template | `POST /wa/api/v1/template/msg`, `template={"id":<Gupshup id>,"params":[...]}` | [template messages](https://docs.gupshup.io/docs/template-messages.md) |
| template list | `GET /sm/api/v1/template/list/{appname}` or `GET /wa/app/{app_id}/template` | [by name](https://docs.gupshup.io/reference/getalltemplatesforanapp), [by id](https://docs.gupshup.io/reference/get-all-templates-for-an-app.md) |

Every send answers `{ "status": "submitted", "messageId" }` and "is processed asynchronously", so the id is kept as "accepted" and the later message-event is what says delivered, read or failed. A session message after the 24-hour window is refused by the adapter itself, because Gupshup would take it and fail it afterwards.

**What does not map one to one.**
- **Template names.** We have Meta template names in four languages (`whatsapp-templates.json`); Gupshup sends by its own template id. The adapter fetches the app's list through the Guard, keeps it, and refreshes it (at most every 30 seconds) when a send names a template it does not know or one that was not approved. A template missing from the app, or not approved there yet, is refused with the app's name and the status Gupshup shows, before anything is sent. The list's language codes are matched as `hi`, `ml`, `kn`, `en` or `xx_YY`.
- **Button and row ids.** Gupshup's quick-reply and list options have a title and a `postbackText`, no id. Our ids travel as `postbackText`. The callback pages (read as raw pages with curl on 12 Nov): a tapped list row carries `postbackText` (plus `id`, the list's own message id); a tapped quick-reply button on the interactive page carries only `title`, `id` (the message's `msgid`, the same for every button) and `reply` (title and index), and no `postbackText`; the postback page shows `postbackText` on a quick-reply callback only for a template's buttons. So a tapped session reply button may come back without our id. The parser takes our id from `postbackText` when it is a plain id and otherwise reads the title as ordinary words (what the agent does with any typed answer); Gupshup's own `id` ('list1', 'qr1') is never taken for ours. Buttons whose titles the agent cannot read as an answer would then need the list form: Deferred.md.
- **The list's header.** Gupshup requires a `title` and a `description` on every row; we have neither, so the title is the list's button label and a row without a description repeats its title. Gupshup also wants a `msgid`; the adapter makes one.
- **The Meta phone number id.** A self-serve shop has none, so its number (digits) stands in as `phoneNumberId` in runtime.json and the inbox's config.
- **The recipient field.** The licence's final stop reads the recipient from the call; Gupshup's field is `destination`, not `to`, so that Guard's `[licence]` says `recipient_field = "destination"`.
- **Callbacks** are Gupshup's version 2 shape (`{app, timestamp, version: 2, type: "message" | "message-event", payload}`), not Meta's. The same two parsers read both (`isGupshupSelfServe`), so the inbox has one path. They are not signed: the inbox's path token is the check, plus the app name each callback names (`app`).

**Where the key is.** Nowhere in this code. The adapter's base URL is the shop's WhatsApp Guard; the Guard's `[upstream_headers]` adds `apikey = ${file:/run/secrets/whatsapp_authorization}` (the shop's API key, handed in as `gupshup_apikey`). The Guard lists three routes (both sends are one operation, `send`, so the hourly cap and the final stop hold templates too, and the template list is `read_number`) and allows only the shop's own number (`source`) on a send and the app on the read. Guard cannot pin `src.name`, the app name in the form (its compiler refuses an exact rule on a dotted field name, which the real-Guard test found), so a send is pinned by the number and by the API key being the app's own.

**The panel and the money.** The phone step offers "Gupshup (the shop's own account)": two links, a short checklist (add the partner as admin; add and approve our templates in the app), the app name and two write-only boxes (the API key and the secret word of the callback address). The connection check reads the app's template list and says only what that shows: the key and the app name go together, and how many of the listed templates are approved; it does not name the number or send. The shop's own Gupshup wallet pays Meta's charges and Gupshup's fee, so for such a shop the cost lines say "an estimate, paid from the shop's own Gupshup wallet, not from Geometer's balance", the builder's running-cost list shows no WhatsApp cost for it, and the heartbeat sends zero WhatsApp counts (the baseline still follows the real count), so fleet's Meta pass-through (counted from `service`, `utility`, `marketing`) bills nothing for it. **Fleet does need a change, though.** `apps/fleet/src/meter.ts` `whatsappCost` also adds, on the Gupshup route, the provider's fee for `messagesIn + service + utility + marketing`, where `messagesIn` is the heartbeat's `messages` count, which is also the plan's allowance counter and so cannot be zeroed; and `billing.ts` `settleWhatsApp` debits the partner's balance with the total. So until fleet learns that a shop pays its own WhatsApp, a self-serve shop's Gupshup fee is still debited from the partner on that route. The change is small: fleet's heartbeat schema (`schema.ts` `checkUsage`) accepts an optional `whatsapp_paid_by: "shop"` in `usage`, the registry keeps it per shop, `settleWhatsApp` skips such a shop and the meter's WhatsApp line becomes "not_ours" with the reason. The agents side then sends the flag instead of zeros.

## Voice notes (B29, 12 Nov 2026)

`modules/voice/` listens to a customer's voice note; the agent replies in text (the owner's decision: listen in voice, reply in text). The bundle's Explanation.md ("Voice notes") has the reasoning. The seams in the shared modules: `InboundMessage.media` (where the audio is, only when voice is on; `webhooks.ts` `mediaOf`, `runtime/events.ts`), `ai-state.ts` `addSpeech`/`speechNotesToday` and `reader.ts` `voiceAllowed` (voice stops with the rest of the model spend, and the day's limit is in the saved state), and `voice/turn.ts` (what every template's agent does with a note, once).
