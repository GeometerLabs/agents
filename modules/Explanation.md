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

**The QR code is written here, not vendored** (`qr.ts`, `png.ts`): byte mode, level M, versions 1 to 40, the standard's mask penalty, and a one-bit PNG with
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

## Adding to a module later

Move a feature here when a second template needs it, in two commits: first move the file and fix its imports (the hand check and tests must be unchanged), then cut the template's knowledge out of it. The files in this folder that began as Bookings files (`check.ts`, `interactive.ts`, `meta-templates.ts`, `router.ts`) show how.
