# Fees template (fee and dues collection)

Market: Commerce and support (collections).

A WhatsApp agent for tuition and coaching centres, music and dance classes, hobby schools and small private schools that collect a monthly fee from parents. Each month it sends the parent of every student a reminder, with a Razorpay payment link, in that parent's language (Hindi, English, Malayalam or Kannada). The agent works inside limits the owner sets. Its main limit is **"never a reminder once paid"**, and paid is judged from Razorpay's own payment record, never from what a parent says.

**What this folder is, and is not.** It is the Fees template, built and checked against **stand-in services** (a stand-in WhatsApp, a stand-in Razorpay, a model of Guard, and for the approval the real `geo-guard` binary in front of the Razorpay stand-in). It **runs as a server** the way Bookings does (one SQLite file per centre, a signed-webhook inbox, an approvals relay), and `geometer shop add --template fees` starts a centre on a Geometer server. It is **not the Geometer engine**, it has been run against no real WhatsApp or Razorpay account, and **no centre is live on it**. Nothing here is a claim about real services.

It has no dependencies. The agent and its tests make no call outside the computer. Most of the code is not in this folder: it is in [`agents/modules/`](../../../modules/README.md), shared with Bookings (the runtime server, the inbox, the approvals relay, the payment and refund code, the report frame). What is here is Fees: a student's fee for a month, its states, its words, its limits, its checks, and the thin files that give the shared code those.

## Run it

You need Node 26 (any Node with built-in TypeScript type stripping works). There is nothing to install.

```sh
# from the root of this repository
node --test templates/education/fees/test/                 # the tests
node templates/education/fees/scripts/hand-check.ts        # the hand check; add --details to see what was done in each situation
node templates/education/fees/scripts/hand-check.ts --settings templates/education/fees/settings/maths-circle.example.json   # the same situations on any centre's own settings
node templates/education/fees/scripts/walkthrough.ts --lang hi   # one parent's month, printed (en, hi, ml, kn)
node templates/education/fees/scripts/report-example.ts    # a sample monthly report, signed with a throwaway key, into templates/education/fees/report-sample/
node templates/education/fees/scripts/review-sheet.ts ml   # the Malayalam review sheet (kn for Kannada), see Languages below
node templates/education/fees/scripts/local-stack.ts       # the whole chain on this computer: stand-ins, inbox, runtime, a stub Guard and the approvals relay (npm run stack)
node templates/education/fees/scripts/go-live-certificate.ts --settings centre.json --lang hi --out ./out   # the go-live certificate from a hand check on the centre's own settings
node templates/education/fees/scripts/client-report.ts --settings centre.json --record entries.json --dues dues.json --month 2026-11 --lang hi --out ./out --source stand-in --go-live ./out/go-live-certificate.json
node templates/education/fees/scripts/guard-spec.ts --settings templates/education/fees/settings/bright-tuition.example.json --tenant bright-tuition --reviewed-by builder-arjun   # the Guard limits spec
node templates/education/fees/scripts/whatsapp-templates.ts  # rewrites whatsapp-templates.json, the list to submit to Meta
```

The hand check prints a count in the product's words: `Held N of M. K failed. J not tested.`, a line for each situation, and the list of what was not tested. For Bright Tuition Centre it is **Held 26 of 26** (209 checks), with 12 listed as not tested. For Gauss Maths Circle (a second example: no late fee, no waivers, no part payments, English and Kannada) it is **Held 23 of 23**, with 3 situations named as not run, because that centre's settings cannot express them. The bundle reads this output (`bundle/handcheck.ts`), so its shape is shared (`modules/crash-test/print.ts`).

Every situation is judged from the stand-ins' own records (what the payments service, Guard's model and the WhatsApp outbox hold), never from what the agent said. The count is a count of those situations, not a verdict on the agent.

## Run it as a server (a live centre)

A centre is a folder like [`clients/bright-tuition.example`](clients/bright-tuition.example) (`settings.json`, `runtime.json`, `pathway.lock`). On a Geometer server the deploy bundle makes it for you and runs it; by hand:

```sh
INTERNAL_TOKEN_FILE=token.txt node templates/education/fees/server/main.ts --client templates/education/fees/clients/bright-tuition.example   # npm run serve
node templates/education/fees/inbox/main.ts        # the inbox: Razorpay's and WhatsApp's signed webhooks in, the owner's replies to the relay (modules/inbox/main.ts lists the environment)
node templates/education/fees/approvals/main.ts    # the approvals relay: asks the owner about a refund Guard is holding (modules/approvals/main.ts lists the environment)
```

- **The runtime** (`server/`) keeps one SQLite file per centre (`agent.db` in its data folder). Every event the inbox hands it is saved before it is acknowledged, a step is saved whole or not at all, and a restart carries on from what was saved. **All of the store is saved**, including the day the agent first ran (without it a restart would make the agent believe it had just started, and no month would be chased) and the counters that make the next `f-3` and `q-2`. `runtime.json` takes the same settings as Bookings' (`parser`, `decision`, `ai`, `allowance`, `report`, ...) with `services` for **payments and messaging only: there is no calendar**.
- **Reminders and the report** run on the runtime's own beat (`tickSeconds`): the month is opened and the first reminder goes at the centre's hour on its first reminder day, and last month's report goes to the owner on the 1st from 09:00 (`report/monthly-job.ts`, once, even across a crash).
- **Refunds Guard holds.** A refund above `refund.limitInr` is held by Guard. The approvals relay then asks the owner **once**, in the owner's language: "Approval needed: refund ₹1,800 for +919844444444 (Rohan Mehta, Nov 2026). Reply "approve K7M2QX" or "deny K7M2QX" within 24 hours." The amount is Guard's own; the parent and the student come from the fee the runtime holds (`/internal/refund-context`, read-only, matched to Guard's held call). The owner's reply releases the refund once or denies it. `test/approvals-guard-binary.test.ts` runs this against the real `geo-guard` (skipped, with its reason, when the binary is not built). **A waiver is not held by Guard** (a smaller link is not a refund): above the waiver limit it is the agent's own question to the owner ("approve q-2"), in the ordinary conversation.
- **Go-live certificate and monthly report from files.** `scripts/go-live-certificate.ts` runs the hand check on the centre's own settings and writes a signed certificate (the limits in plain words, "Held N of M", what was not tested); `scripts/client-report.ts` makes the monthly report from the saved record and fees (`--dues`), reads the certificate back and says what its checks ran on: this centre's own settings, the example centre, other settings, or that none was given. There is no monthly record certificate for Fees yet.
- **Start one on a server.** `node bundle/geometer.ts shop add bright --template fees --whatsapp-number-id <id> --prepared-by "Divya, local partner"` makes the shop from this template's example (change the settings to the real centre's, or give `--settings <file>`). The bundle gives a Fees centre two Guards (Razorpay, WhatsApp), no calendar Guard and no Google key, and runs this runtime, this inbox and this relay's words for it. The panel sets a Fees centre up on a phone in the same five steps (the centre with its batches and students, the rules of the month, languages, accounts, checks), makes its go-live certificate and monthly report, and shows its page in four languages. The panel's form takes at most 6 batches and 300 students; `--settings <file>` takes any number (Deferred.md).

## What the parent sees

- **The reminder.** On the days the centre chooses (example: three days before the due day, on it, and five and ten days after), at an hour it chooses. It says whose fee it is, for which month, how much, the due date and the payment link. It ends with "Reply STOP if you do not want these reminders." A parent with two children gets one reminder for each.
- **Buttons.** Pay now, I have paid, Talk to the owner. They are WhatsApp reply buttons where the stand-in or provider takes them; a parent can always type instead.
- **"I already paid".** The agent reads the payment record again. If it shows the whole fee, it says so. If it shows part, it says how much is left. If it shows nothing, it says "we cannot see a payment yet", gives the link, and tells the owner (at most once an hour). It never marks a fee paid on a parent's word.
- **Part payments**, when the centre allows them (from a least amount). The link is for the balance; a link with a part payment on it cannot be cancelled, so a new one is made for what is left, and anything the old one collects beyond what is owed is given back.
- **A discount.** The agent never offers one. If a parent asks, it can take off up to the centre's waiver limit, in all, for one student in one month, and it tells the owner. Above that, the owner is asked for that exact amount on that exact fee at that balance ("approve q-1" or "deny q-1"). If the fee changed since the owner was asked, the yes is not applied.
- **Money back.** Never more than a payment on record, and one refund for a payment. A refund a parent asks for goes to the owner to decide. A refund above the centre's refund limit is asked for through Guard, which holds it for the owner's one-use code. A payment made twice is refunded once, for the extra, when it is within the limit.
- **STOP** ends every message to that parent, with no reply, and no late fee is added for them.
- **A voice note** is answered with "please type".

## What the owner sees

- A message for each thing that needs them: an approval, a parent who says they paid with nothing on record, a payment link that could not be made, a message held back, a parent who sent STOP, a parent who asked to talk.
- **The monthly report**, on WhatsApp on the 1st from 09:00, once: collected, still to collect, given back, reminders sent, what was taken off, what the owner was asked, approved and refused, what the limits stopped, and what was not checked. A page behind a link has the whole report, signed, in the owner's language (see The monthly report).

## Languages

Hindi, English, Malayalam and Kannada, and the Hindi, Malayalam and Kannada people type in Latin letters. A parent is written to in their own language, kept per student in the settings, and changes if they write in another. All messages are fixed templates; every amount, date and name is filled in from the record, and the outgoing check reads the final text against the record before it is sent.

The Malayalam and Kannada wording is **machine-written** and must be read by a native speaker before a real centre sees it. [REVIEW-ml.md](REVIEW-ml.md) and [REVIEW-kn.md](REVIEW-kn.md) list every message, button label, word the agent understands, sentence the hand check types, and every word of the monthly report, made from the code itself (`scripts/review-sheet.ts`); a test fails if a committed sheet falls behind. Hindi has no sheet yet.

## Settings: tailoring without code

A centre is a JSON file ([bright-tuition.example.json](settings/bright-tuition.example.json), [maths-circle.example.json](settings/maths-circle.example.json)); the agent reads it and says in plain words what is wrong with it.

| Setting | What it is |
| --- | --- |
| `name`, `address`, `timezone`, `languages` | The centre's name (said in messages), where it is, the time zone for dates and reminder hours, the languages parents are written in (the first is the default) |
| `batches` | Each class or batch: an id, what parents call it in each language (the first is what the agent says) and the monthly fee in whole rupees |
| `students` | Each student: name, the parent's WhatsApp number, the batch, and the parent's language (left out: the centre's first language) |
| `due` | The day of the month the fee is due (1 to 28) and the grace days before a late fee |
| `lateFeeInr` | Added once, after the grace days, if the fee is still unpaid. 0: none. Never more than the cheapest fee |
| `reminders` | Days from the due day (negative is before), the hour (6 to 21), and the most reminders for one fee in a month |
| `partPayments` | Whether a parent may pay part, and the least a first part may be |
| `waiver.limitInr` | The most the agent takes off one student's month on its own. 0: every request goes to the owner |
| `refund.limitInr` | The refund the agent may ask for on its own (an overpayment); above it Guard holds the refund for the owner. It is the same number Guard's threshold is made from |
| `payment.module` | `razorpay` (UPI is the next module, plan item B33, and is not built) |
| `owner` | The owner's WhatsApp number and language |
| `approvers` | Optional: others who approve a refund Guard holds (a teacher, a partner), each from their own phone: `people` (1 to 6 of `{"id", "whatsapp", "language"}`) and `twoAboveInr` (above it, two different people must approve). Left out: the owner alone |

## The rules, in plain words

1. **A reminder only if the record shows the fee unpaid and could be read.** If the payments service cannot be read just now, no reminder goes out (`no-reminder-once-paid`).
2. **At most so many reminders for one fee in a month** (`reminder-cap`).
3. **A payment link is for what the record says is still owed, and nothing else** (`fee-link-matches-record`), and Guard bounds a link to a range from ₹1 to the dearest fee with its late fee.
4. **A waiver above the limit is the owner's call, for that exact amount; never more than what is owed** (`waiver-limit`).
5. **"Received" and "nothing more is due" go out only when the payment record shows the money** (`paid-only-when-recorded`).
6. **A refund is never more than the payment, one per payment** (`refund-limit`, `one-refund-per-payment`); above the limit the owner approves.
7. **A message matches the record** (`message-matches-record`) **and no message follows STOP** (`opt-out`).
8. **No payouts**, no matter who asks (Guard).

The limits are pure functions (`src/limits.ts`) so Guard can run the same ones. `scripts/guard-spec.ts` writes the Razorpay limits spec for a centre's settings.

## The monthly report

`report/` makes the same three layers as Bookings: the owner's five lines, a printable page in the owner's language (or Hindi and English together), and signed data, all counted from the action record and the fees as they stand (`report/data.ts`). Collected is the sum of payments read back from Razorpay's own list, each counted once; a number that cannot be counted is listed under "not counted", not guessed. The monthly job is the shared one (`modules/report/monthly-job.ts`): once, even across a crash, from 09:00 on the 1st, as a template when the owner's window is closed (`fee_monthly_report`, `fee_monthly_report_innovator`) and as plain text when it is open. The Innovator badge is a line of its own. Check a Fees report file with Bookings' `scripts/verify-report.ts`: it reads any signed Geometer document.

## Sell it

[`sell/guide.en.md`](sell/guide.en.md) (and `.hi`, `.ml`, `.kn`) teaches a local partner or a builder to pitch it, and [`sell/one-pager.en.html`](sell/one-pager.en.html) is the sheet the owner keeps. The demo in section 4 is `scripts/walkthrough.ts`: there is no phone demo for Fees yet. `test/sell-guide.test.ts` holds the guide's numbers and quotes to the real hand check and walkthrough. The Fees price is the Business plan's (see the guide's section 6).

## What is in the folder

| Path | What |
| --- | --- |
| `src/agent.ts` | The agent: one event in (a message, a payment event, an approvals answer, a tick), done, back |
| `src/due.ts` | A student's fee for a month as a state machine (open, paid, closed), and the conversation store |
| `src/limits.ts`, `src/guard-limits.ts` | The pure limits; the Guard spec made from the settings |
| `src/settings.ts` | The settings and their checks |
| `src/language/` | The templates in four languages, the buttons, the Meta template list, the outgoing check's facts |
| `src/adapters/` | The rule parser (words about fees), the intent type, the reader that uses the shared understanding steps |
| `src/harness.ts` | The agent on the stand-ins, with a clock you can move, and the parent, the payment provider and the owner as helpers |
| `crash-test/` | The 26 situations (`situations.ts`), what the scripted parents write (`says.ts`), the plan for running them on any centre's settings (`shop.ts`), and the not-tested list |
| `report/` | The monthly report and the go-live certificate: data, owner text, page, WhatsApp message, signing, the monthly job, the example month, the certificate, reading it back |
| `server/` | The runtime: config, store, snapshot (every field of the store), services, start, main. The code is shared (`modules/runtime/`); these files give it Fees |
| `inbox/`, `approvals/` | The inbox's and the approvals relay's entry points; the relay's Fees voice (`approvals/relay.ts`) |
| `standins/` | The Razorpay and WhatsApp stand-ins over HTTP, for the local stack and the end-to-end test |
| `clients/` | An example centre's folder (`bright-tuition.example`) |
| `template.json` | What the bundle and the panel read to offer Fees: its id, its steps, the accounts it uses (WhatsApp and Razorpay; no calendar) |
| `scripts/` | Hand check, walkthrough, report example, review sheet, Guard spec, Meta template list, local stack, go-live certificate, client report |
| `settings/` | Two example centres |
| `sell/` | The sell guide and the owner's one-page sheet, in four languages |
| `whatsapp-templates.json` | The list to submit to Meta: 15 fee and owner templates and the 2 report templates, each in four languages (68 entries) |
| `test/` | The tests |

## What is not done yet

See [Deferred.md](Deferred.md). The ones to know first: nothing has been run against a real WhatsApp or Razorpay account, so no centre is live; a waiver is not held by Guard (it is the agent's question to the owner); no monthly record certificate; no phone demo; no UPI; cash and bank transfers are not handled; the Malayalam and Kannada wording is not yet read by a native speaker.

## Not a claim

Everything above was run on stand-in services. "Held 26 of 26" means 26 situations were tried and the stand-ins' records showed the limits held in them. It does not mean the agent is right in a real centre, and it says nothing about situations that were not tried. No word in this folder is a promise about what will be collected.
