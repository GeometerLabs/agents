# Deferred: what the Fees template leaves open

5 November 2026. Each item is left out on purpose, with the reason and what would make it worth doing. Nothing here is claimed as done anywhere else in this folder.

## Going live

| Left open | Why | Revisit when |
| --- | --- | --- |
| **A runtime server for Fees: no `template.json`, no inbox, no `geometer shop add` for Fees** | Bookings' server (the runtime, its config check, the services wiring, the start file, the inbox with the signed webhooks) was not moved to `modules/`, because only what two templates need moved. A Fees server is not a small change to `shop add`: it needs the same pieces for fees. The bundle finds a template by a `template.json` in its folder and runs `<template>/server/config.ts`; Fees has neither, on purpose, so the panel does not offer a template that cannot run | The first Fees centre is agreed; then lift the generic parts of Bookings' server into `modules/` and give Fees a thin file of its own |
| **The approvals relay has no Fees voice, and the runtime has no context endpoint for Fees** | A refund above the centre's refund limit goes to Guard, which holds it for the owner's one-use code. The approvals relay is what asks the owner, in the centre's words, and it asks the runtime what the refund is about. The relay's voice is Bookings' (`RelayVoice` in `modules/approvals/relay.ts` is the seam; Fees has not written one) and the runtime context endpoint is Bookings' too. **So on a live Fees centre, nothing would yet ask the owner about a refund Guard is holding**: the parent would be told the owner will confirm the refund, and the request would run out unanswered. The agent itself never asks a second time, by design. The tests and the hand check do the owner's part by hand (`ownerAnswers`) | Before any Fees centre goes live: this is the first thing to build with the server |
| **A parent-requested refund above the limit goes straight to Guard's hold: there is no `q-` step first** | Decided, not forgotten. A refund within the limit is not owed on its own, so the owner is asked (`approve q-2`). Above the limit Guard is the one that holds it, and a second question from the agent would ask the owner twice. This relies on the relay above | The relay has a Fees voice |
| **No late fee for a parent who sent STOP** | Decided, not forgotten. After STOP the agent sends nothing, and a late fee added with no way to tell the parent is not fair to them. The fee is still owed and the owner is told once, so the owner speaks to that parent. A centre that wants the late fee anyway needs a decision about how the parent is told | An owner asks |
| **A go-live certificate and a monthly record certificate for Fees** | Bookings has both (`scripts/go-live-certificate.ts`, the certificate in the monthly report). They are made from a hand-check run on the centre's own settings and read by the report. Fees runs the hand check on any settings, but nothing yet turns that into a signed certificate or reads one into the report, so the report says nothing about it. The sell guide says plainly that a Fees centre cannot go live without one | The server above exists |
| **Making a report from files** | Bookings has `scripts/client-report.ts` (from a saved record, settings and bookings). Fees' report is made by the shared monthly job and by `scripts/report-example.ts`; there is no saved record and no saved fees to read, because there is no runtime to save them. Check a Fees report file with Bookings' `verify-report.ts` (it reads any signed Geometer document) | The server above exists |
| **A phone demo** | Bookings has a demo a partner shows on the owner's phone. For Fees the demo is `scripts/walkthrough.ts`, a printed conversation. It is the same agent on the same stand-ins, but the owner does not tap anything | A partner asks for it, or the pilot centres do |
| **Modules are not versioned on their own** | `modules/` is one folder for all templates. A Fees version kept beside the server (`<server>/templates/education/fees@0.2.0`) finds the shared code at `<server>/modules`, which is the current one, not the one of that version's day. The bundle copes (it refuses the optional runtime settings for a version whose config cannot be read) but cannot pin modules | A module changes in a way an old template version cannot take |

## Real services

| Left open | Why | Revisit when |
| --- | --- | --- |
| **Any run against real Razorpay, WhatsApp or Guard** | Everything ran on stand-ins shaped like the real services (Razorpay's field names and paise, partial payments with `accept_partial` and `partially_paid`, Meta's webhook shapes). A real account may differ | Test-mode accounts exist |
| **UPI (plan item B33)** | `payment.module` accepts only `razorpay`. A centre whose parents pay by UPI, with no Razorpay account, is not a fit yet. The sell guide says so | B33 is built |
| **Fees paid in cash or by bank transfer** | The agent reads only Razorpay's record. A parent who says they paid another way goes down the "I already paid" path: it says it cannot see a payment, tells the owner, and marks nothing paid. The fee stays open and reminders can continue until the owner sorts it out with the parent. There is no way for the owner to mark a fee paid by hand | An owner asks for it. It would need a record entry that says a person confirmed it, and a rule for who may |
| **Submitting the templates to Meta** | `whatsapp-templates.json` (68 entries: 15 fee and owner templates and 2 report templates, each in four languages) is the form to submit, not submitted. Meta decides the category and may ask for changes; the usual risk is a long template with many values being filed as marketing, which costs more per message. Several messages that answer a parent have no template and go as plain text inside the 24-hour window | The templates are submitted |
| **Webhook signatures and real message delivery** | The inbox verifies signatures in Bookings; Fees has no inbox. A message counts when the provider's outbox holds it | The server above exists |
| **Guard stand-ins** | The in-memory Guard model checks both a link's amount range and a refund. The HTTP stand-in (`modules/standins/guard.ts`) holds a refund above the threshold and does not check a link's amount. Guard's daily caps are in the spec; the in-memory model does not count a day's refunds or an hour's links | Fees has an HTTP stack to run |
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
| **A crash or restart in the middle of a step, two parents at the exact same instant, faults beyond the listed ones** | The situations try the faults they list. These are the engine's crash test (plan items B1 to B5) | The engine's crash test runs these |
