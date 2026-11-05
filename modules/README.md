# Modules: what every agent template shares

A template (Bookings, Fees) is a set of settings, a few rules and the words it says. Everything else is the same work: sending a WhatsApp message, making a payment link, asking for a refund through Guard, keeping the record, reading a customer's message. That work lives here once. **Templates import it. It is moved, not copied.**

**One rule:** a module imports nothing from a template or from the bundle. A test (`test/boundary.test.ts`) fails if one does. When a module needs something a template knows (its words, its facts, what a booking is), the template hands it in. Those hand-in points are listed under each module.

No dependencies. Plain Node, run with `node`. Tests: `cd modules && npm test`.

## What is here

| Module | What it holds | What a template hands in | Who imports it |
| --- | --- | --- | --- |
| `core/` | time zones and dates (`time.ts`), the clock and a clock you can move (`clock.ts`), the errors a service can give (`faults.ts`), the small HTTP helper the live adapters use (`http.ts`) | nothing | everything |
| `language/` | Hindi, English, Malayalam and Kannada: the language list, dates and times read and written, amounts as rupees, the outgoing check (`check.ts`), buttons and lists (`interactive.ts`), WhatsApp template bodies (`meta-templates.ts`), the word lists | the template's own words and facts; for the check, plain lists of the amounts, dates and names the record holds | Bookings, Fees, the bundle's panel |
| `understanding/` | reading a message in three steps: the rules shared by every template (`rules.ts`), a System One decision model (`system-one.ts`), a small language model (`model-llm.ts`), the router that tries them cheapest first (`router.ts`), names and numbers taken out first (`redact.ts`), what a call costs (`rates.ts`, reading the one dated table of model prices in `rates/<date>.json`, which the evaluation script and the bundle's tests also use; `rates-check.ts` checks a file), the monthly AI allowance, button mode and the pause on a step that keeps failing (`ai-state.ts`), and the reader that ties them to an agent (`reader.ts`) | a `Reading`: its own rules, its intents, its prompt and its questions (`model.ts` says what) | Bookings, Fees |
| `payments/` | the payments seam and its in-memory fake (`payments.ts`), the Razorpay adapter (`razorpay.ts`), what Guard does with a link or a refund (`guard-model.ts`), the Razorpay limits spec (`guard-limits.ts`), making a link the careful way (`links.ts`), asking for a refund and following Guard's hold (`refunds.ts`) | the amounts, the rule names, what to tell the customer | Bookings, Fees, the bundle |
| `messaging/` | the WhatsApp seam and its fake with the 24-hour window (`messaging.ts`), the Cloud API adapter (`whatsapp.ts`), the signed webhooks (`webhooks.ts`), and the one way a message leaves an agent (`say.ts`) | a voice (its templates), the facts, the offers, the gates of its own | Bookings, Fees, the bundle |
| `record/` | the action record: what the agent did, tried or was stopped from doing, with a fingerprint of each entry (`record.ts`) | the names of its own actions and rules | everything |
| `report/` | signing a report and a certificate (`sign.ts`, `keys.ts`, `digest.ts`), the printable page and its verification block (`page.ts`), the small text helpers, the period label, the Innovator badge and what a report was counted from (`text.ts`), the words no document may contain (`claims.ts`), the month as a range and the one folder a report is written into (`months.ts`), the monthly job that sends the owner last month's report once (`monthly-job.ts`) and the two helpers every report script uses (`cli.ts`) | the numbers, the words, and for the job a `make` that builds the template's own report and message | Bookings, Fees, the bundle |
| `approvals/` | the owner's approval on WhatsApp for a refund Guard is holding: the relay, its store, its server and its clients (`relay.ts` and the rest), and the one-use code (`code.ts`) | a voice: the words it says to the owner | Bookings, the bundle (Fees has no voice for it yet: see `templates/education/fees/Deferred.md`) |
| `limits/` | the rules every template has: STOP ends messages, a refund is never more than was paid and goes to the owner above the limit, a message matches the record (`limits.ts`) | its own words for the one case | Bookings, Fees |
| `reminders/` | when reminders are due, and sending one message when several fell due at once (`reminders.ts`) | the moments | Bookings, Fees |
| `crash-test/` | the frame of a crash test and what the hand check prints (`situations.ts`, `print.ts`) | the situations | Bookings, Fees |
| `standins/` | Razorpay, WhatsApp, System One and Guard as small servers (and the pieces the tests use directly) | the template's WhatsApp templates; how a decision model should answer | Bookings, the bundle's tests |

What stays in a template: the things that are about its business. For Bookings that is the calendar, the slot, the booking's states, its templates and its situations. For Fees it is the fee of a student for a month, its states, its words and its situations. See `templates/commerce/bookings/Explanation.md` and `templates/education/fees/Explanation.md`.

## Using a module from a template

```ts
import { createSay } from "../../../modules/messaging/say.ts";
import { createRefunds } from "../../../modules/payments/refunds.ts";
```

The paths are relative, like every import in this repository. The template's `Explanation.md` says which modules it uses and what it hands in.

## Adding a feature

If two templates need it, it goes here. If one does, it stays in that template until the second arrives. Moving it later is the job `Explanation.md` describes (the cut points), done with the same care: the old template's tests and hand check must give the same answers before and after.

[Explanation.md](Explanation.md) says how the cut was made and what it cost. [Deferred.md](Deferred.md) says what is not done.
