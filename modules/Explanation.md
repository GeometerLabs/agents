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
| `server/config.ts` | `runtime/config.ts`: every setting of `runtime.json` (`parser`, `decision`, `ai`, `allowance`, `pauseMinutes`, `report`), the pin, the folder, the two live readers | a `ServiceShape`: Bookings has payments, calendar, messaging; Fees payments and messaging |
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

## Adding to a module later

Move a feature here when a second template needs it, in two commits: first move the file and fix its imports (the hand check and tests must be unchanged), then cut the template's knowledge out of it. The files in this folder that began as Bookings files (`check.ts`, `interactive.ts`, `meta-templates.ts`, `router.ts`) show how.
