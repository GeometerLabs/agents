# Deferred: what the Fees template leaves open

5 November 2026. Each item is left out on purpose, with the reason and what would make it worth doing. Nothing here is claimed as done anywhere else in this folder.

## Going live

| Left open | Why | Revisit when |
| --- | --- | --- |
| **A parent-requested refund above the limit goes straight to Guard's hold: there is no `q-` step first** | Decided, not forgotten. A refund within the limit is not owed on its own, so the owner is asked (`approve q-2`). Above the limit Guard is the one that holds it, and the approvals relay asks the owner (once, with a one-use code); a second question from the agent would ask the owner twice | Never, unless the relay is taken out |
| **A waiver above the limit is not held by Guard** | Guard's approval is on the refund operation. A waiver is a smaller payment link inside the range Guard allows, so Guard sees nothing to hold. The agent asks the owner itself ("approve q-2", applied only if the fee is still exactly as it was) and the relay says nothing about it. The end-to-end test shows the owner's `approve q-1` working through the inbox | Guard can hold a payment link above an amount for the owner |
| **No late fee for a parent who sent STOP** | Decided, not forgotten. After STOP the agent sends nothing, and a late fee added with no way to tell the parent is not fair to them. The fee is still owed and the owner is told once, so the owner speaks to that parent. A centre that wants the late fee anyway needs a decision about how the parent is told | An owner asks |
| **A monthly record certificate for Fees** | Bookings has two certificates: the go-live one (Fees has it now: `scripts/go-live-certificate.ts`, and the monthly report reads it back) and a monthly record certificate, a second signed paper beside the report. Fees' monthly report carries what it was told about the go-live checks, but there is no second paper | A centre or a partner asks for it; it would copy `templates/commerce/bookings/report/certificate.ts` for fees |
| **A Fees centre has no running-cost line, only the most messages its rules allow** | The panel's cost line is a model of a booking shop (bookings a month, replies per booking, the deposit's Razorpay fee), so a Fees centre's page shows no cost table. It shows a ceiling from the centre's own rules (students times the most reminders, plus a receipt each) beside the plan's allowance from the proposed price list, and says it is not a bill. Replies to parents' own messages are not in it | The price list has a fee centre's lines, and a model for them (reminders and receipts a student, Razorpay's fee on each payment) |
| **The phone setup for Fees will take six batches and 300 students** | The form is a few rows and one box, to be usable on a phone (`bundle/panel/fees.ts`). A bigger centre is set up with `geometer shop add --template fees --settings <file>`, which takes any number | A centre needs more, or the panel gets a file upload |
| **The Fees stand-ins borrow two functions from Bookings' stand-ins** | `standins/control.ts` imports the two functions that write a provider's webhook body from `templates/commerce/bookings/standins/control.ts`. They are test and dev support, not part of any runtime (`test/runtime-imports.test.ts` checks the runtime imports only the template and `modules/`). They belong in `modules/standins` | The shared stand-ins land in `modules/standins` (another piece of work is moving them) |
| **An exported Fees record has its students' names hashed, so its digest is of the exported notes** | A child's name must not leave the centre's data volume. The deploy bundle hashes the name on every fee and in the record's `open_fee` note before it writes the export the panel reads. The monthly report made from the export digests the exported record, not the centre's own; nothing compares the two | The agent stops writing a name into a note, and the export need not rewrite one |
| **A phone demo** | Bookings has a demo a partner shows on the owner's phone. For Fees the demo is `scripts/walkthrough.ts`, a printed conversation. It is the same agent on the same stand-ins, but the owner does not tap anything | A partner asks for it, or the pilot centres do |
| **Modules are not versioned on their own** | `modules/` is one folder for all templates, and now holds the runtime server, the inbox and the runtime config check as well. A Fees version kept beside the server (`<server>/pathways/fees@0.2.0`) finds the shared code at `<server>/modules`, which is the current one, not the one of that version's day; the runtime config it accepts is the shared reader's. The bundle copes (it refuses the optional runtime settings for a version whose config cannot be read) but cannot pin modules | A module changes in a way an old template version cannot take |

## Real services

| Left open | Why | Revisit when |
| --- | --- | --- |
| **Any run against real Razorpay, WhatsApp or Guard** | Everything ran on stand-ins shaped like the real services (Razorpay's field names and paise, partial payments with `accept_partial` and `partially_paid`, Meta's webhook shapes). A real account may differ | Test-mode accounts exist |
| **UPI (plan item B33)** | `payment.module` accepts only `razorpay`. A centre whose parents pay by UPI, with no Razorpay account, is not a fit yet. The sell guide says so | B33 is built |
| **Fees paid in cash or by bank transfer** | The agent reads only Razorpay's record. A parent who says they paid another way goes down the "I already paid" path: it says it cannot see a payment, tells the owner, and marks nothing paid. The fee stays open and reminders can continue until the owner sorts it out with the parent. There is no way for the owner to mark a fee paid by hand | An owner asks for it. It would need a record entry that says a person confirmed it, and a rule for who may |
| **Submitting the templates to Meta** | `whatsapp-templates.json` (68 entries: 15 fee and owner templates and 2 report templates, each in four languages) is the form to submit, not submitted. Meta decides the category and may ask for changes; the usual risk is a long template with many values being filed as marketing, which costs more per message. Several messages that answer a parent have no template and go as plain text inside the 24-hour window | The templates are submitted |
| **Webhook signatures and real message delivery** | The shared inbox verifies Razorpay's and Meta's signatures, and the end-to-end test sends bad and missing ones against it (`test/full-chain.test.ts`). It has been run against the stand-ins' signed webhooks, not against real providers. A message counts when the provider's outbox holds it | Test-mode accounts exist |
| **Guard stand-ins** | The in-memory Guard model checks both a link's amount range and a refund. The stub Guard of the local stack (`modules/standins/guard.ts`) holds a refund above the threshold and does not check a link's amount. The real `geo-guard` test checks the link range, the refund bound and the hold against the real binary, but not Guard's daily caps (the in-memory model does not count a day's refunds or an hour's links either) | The stub Guard checks links, or the real binary joins the end-to-end chain |
| **Guard's link bound is a range** | Guard's rule for an exact value reads text, not a number, so it cannot be given each fee. It bounds a link to ₹1 up to the dearest fee with its late fee. The exact amount is the agent's check (`fee-link-matches-record`) | Guard can bound a number to a list |
| **A partially paid link cannot be closed** | Razorpay does not let a link with a part payment on it be cancelled. It stays open; the agent makes a new link for what is left; anything the old one collects beyond what is owed is refunded once, within the refund limit, and the owner is told. A parent who pays the old link twice gets a refund, not a surprise | Razorpay changes this |

## What the agent does not do

| Left open | Why | Revisit when |
| --- | --- | --- |
| **One message about two children** | A message that could be about either child answers the oldest open fee; the parent is not asked "which one?". It is listed as not tested | A centre with many siblings complains |
| **A new student in the middle of a month** | Not chased until the next month: the month's first reminder day is past. The owner can send the link by hand | The pilot centres need it |
| **A fee that was due before the agent started** | Not chased (a fresh install does not send "three days before" for a month that is gone). Older dues are the owner's | An owner asks for a back-dues run |
| **Several centres, fee plans, siblings' discounts, scholarships** | The settings have one fee per batch and a waiver limit. Anything else is a conversation with the owner | A pilot centre needs it |
| **Annual or per-term fees, instalment plans** | The state machine is one student for one month | A pilot centre needs it |
| **Receipts as a file** | The receipt is a message with a receipt number (the fee's reference). A PDF needs a font engine for Hindi, Malayalam and Kannada, which is a dependency | The bundle carries a renderer, with the owner's yes |
| **"Still to collect" in an old report** | It is read from the fees as they stand when the report is made, so a report made late for an old month shows today's balances. The report says when it was made | A saved fee history exists |

## Words and review

| Left open | Why | Revisit when |
| --- | --- | --- |
| **Native review of the Malayalam and Kannada wording** | Every message, button label, word the agent understands and word of the report is machine-written. [REVIEW-ml.md](REVIEW-ml.md) and [REVIEW-kn.md](REVIEW-kn.md) list them all, with the English meaning, for a native speaker. Hindi has no sheet | A native reader is found |
| **Native review of the sell guide and one-pager in Hindi, Malayalam and Kannada** | `sell/guide.hi.md`, `guide.ml.md`, `guide.kn.md` and `sell/one-pager.hi.html`, `.ml.html`, `.kn.html` carry the machine-written banner with the date. The banner and this row go when a native speaker has reviewed the file | A native reader is found |
| **The price in the sell guide** | It follows the Business plan in `docs/product/economics-and-pricing.md` (₹299 a live centre a month, ₹179 for the first 100 innovators), which is marked as proposed for the owner's yes. Bookings' guide still says ₹199 (the older figure). If the plan changes, change both guides and the test | The owner decides the plans |
| **Tamil, Telugu and other languages** | One language is one set of templates, words and a review sheet. Four are done | A centre needs one |
| **A crash or restart in the middle of a step, two parents at the exact same instant, faults beyond the listed ones** | The hand check's situations try the faults they list, and its not-tested list still names a restart in the middle of a step. The runtime's own tests do try a restart between steps and a step cut off before it is saved (`test/runtime.test.ts`, `test/full-chain.test.ts`), on the stand-ins. The rest are the engine's crash test (plan items B1 to B5) | The engine's crash test runs these |
| **On a UPI centre the Razorpay situations do not run** | Twenty-six are named as not run; seven UPI situations run instead (`crash-test/upi.ts`) | A UPI centre goes live: make "the parent pays" mean "the owner marks it" in the world, so every situation runs either way |
| **The owner gets one "UPI payment to check" per request** | The code ties a mark to a fee, and the owner needs it before the money comes | A centre with many students: a daily digest with one code per open request |
| **No QR picture with a reminder outside the window** | A template with an image header is a different kind of Meta template | Meta approves a reminder template with an image header |

## The papers (B28, B35, B36)

- The new Hindi, Malayalam and Kannada words in `report/papers.ts` (action words, limit labels) are machine-written and wait for a native reader, before a parent gets a statement in them.
- A parent with two children sees two fees by month and batch, not by child (the child's name is never on a paper). See `modules/papers/Deferred.md`.
- Turning part payments on (from off) is a looser rule too, but only the least part payment's amount is compared today.
