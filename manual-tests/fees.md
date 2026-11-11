<!--
What this is for: the manual test script for the Fees template (templates/education/fees) on the real services: WhatsApp sandbox, Razorpay test mode and UPI. Fees has no calendar.
Who runs it: the owner or a partner, by hand, in one sitting (plus one step the next day). Read README.md in this folder first (set-up and procedures P1 to P6).
Entry names below are the ones the code writes (templates/education/fees/src/agent.ts, modules/payments/refunds.ts, modules/payments/owner-marked/obligations.ts).
-->

# Fees: manual test

Centre: Bright Tuition Centre "TEST" (settings `bright-tuition.example.json` for Razorpay, `bright-tuition-upi.example.json` for UPI). Put the **customer phone C** as the parent of two test students ("Test One", class 8, ₹1,200 and "Test Two", class 9, ₹1,500) and **C2** as the parent of a third. The owner phone is **O**. Fee due day 5, grace 5 days, late fee ₹100, reminders on days -3, 0, +5, +10 at 10:00, at most 4 a month, a waiver limit of ₹100, a refund limit of ₹500, part payments from ₹300. For the clock-bound steps ask the lead to set the due day to today plus 3 so the first reminder goes today (the reminders run on the runtime's own beat; "the first reminder day" opens the month).
Part A is Razorpay test mode; Part B is UPI with every fee set to ₹1 and the late fee 0.
Note the time before each step so you can find its record entries (P1).

## Part A: Razorpay test mode

**A1. The reminder and the payment (happy path).**
1. Wait for (or trigger, by the due-day setting above) the reminder. C sees, in C's language (English here): `Fee reminder from Bright Tuition Centre "TEST". Test One's class 8 fee for <Month Year> is ₹1,200, due on <date>. Pay here: <link> Reply STOP if you do not want these reminders.` A parent with two children gets one reminder for each. Hindi, Malayalam and Kannada parents get the same facts in their language (the Malayalam and Kannada wording is machine-written and waits for a native reader).
- Guard: allows the link (₹1 up to the dearest fee plus its late fee) and the send.
- Record: `open_fee` confirmed; `create_fee_link` attempted then confirmed; `send_message` confirmed.
2. C pays with Razorpay's test UPI `success@razorpay` (or the test card; never a real one).
- C sees: `Thank you! Bright Tuition Centre "TEST" has received ₹1,200 for Test One's class 8 fee for <Month>. Nothing more is due. Your receipt number is f-1.`
- Record: `receive_payment_event` confirmed; `record_payment` confirmed (refs.paymentId); `settle_fee` confirmed. The Razorpay dashboard shows the payment.
3. Wait for the next reminder day (or move the clock with the lead): **no reminder** goes for the paid fee (rule `no-reminder-once-paid`). Record: no `send_message` for it; a blocked entry may say why.

**A2. "I already paid" (judged from the record, not from the parent's word).**
- On a fee with nothing paid, C writes `I have paid`. C sees `We cannot see a payment yet for Test Two's class 9 fee for <Month>. If you paid just now, it can take a few minutes to show. I have asked the owner to check. If it did not go through, you can pay here: <link>`. O sees `Parent <C> says they paid Test Two's class 9 fee for <Month> (₹1,500), but the payment record shows ₹0. Please check and message them.` (at most once an hour). Record: `ask_owner` confirmed; the fee is not settled.
- Pay it now, then C writes `I have paid` again: `Yes, we can see your payment of ₹1,500 ... Nothing more is due. Thank you.`
- Pay ₹300 only (part payments are allowed): `We can see ₹300 paid ... so ₹1,200 is still to pay. Pay the rest here: <link>`. Record: `record_payment` confirmed (a part); the fee is not `settle_fee`d.

**A3. A payment made twice, or the event delivered twice (the retried-payment case).**
- Pay a fee, then make the same payment event arrive again (Razorpay dashboard, Test mode, Webhooks, event log, resend; if no resend, **check in the provider's console**, or ask the lead to replay the captured body). Then pay the link a second time if Razorpay lets you (write down what it says).
- C sees at most once `...the extra ... is being refunded` (O: `Parent <C> paid more than was due for Test One's fee for <Month>. The extra ₹<x> is being refunded.`), and none for a replayed identical event.
- Guard: one refund per payment, never more than the payment (`one-refund-per-payment`, `refund-limit`).
- Record: no second `record_payment` for the same payment id; at most one `refund` confirmed per payment; the Razorpay dashboard shows at most one refund.

**A4. Owner approval and refusal of a refund Guard holds.** (P2: refund limit ₹500 is the example: use a ₹1,500 fee paid, and C asks for ₹800 back; or lower the limit.)
4. C writes `I want a refund of 800 for Test Two`. C sees `I have asked the owner about refunding ₹800 of the ₹1,500 you paid for Test Two's fee for <Month>. You will hear back here.`; O sees `Approval needed: <C> asks for ₹800 back of the ₹1,500 paid ... Reply "approve q-1" or "deny q-1" ...`. A refund a parent asks for always goes to the owner first.
5. O replies `approve q-1`. The refund above the limit is then asked from Razorpay through Guard, which **holds** it; the approvals relay asks O once: `Approval needed: refund ₹800 for <C> (Test Two, <Month>). Reply "approve K7M2QX" or "deny K7M2QX" within <N> hours.` O replies `approve <code>`: O sees `Thank you. The ₹800 refund for <C> is being sent, and they will be told.`; C sees `The owner approved your refund. ₹800 is on its way.`
- Record: `ask_owner`; `owner_decision` confirmed; `refund` attempted, `held_for_owner`, then `refund` confirmed (refs.refundId). Razorpay: one refund of ₹800.
6. Refusal: repeat on another payment; O replies `deny <code>`. C sees `The owner has decided not to refund this payment.` Record: `owner_decision` confirmed (deny); no `refund` confirmed; Razorpay shows no refund.
7. More than was paid: C asks `refund 2000` on a ₹1,500 payment. C sees `Our record shows ₹1,500 paid for ... so I cannot pass on a request for more than that. Tell me the amount you want back, or talk to the owner.` Record: `refund` blocked; nothing sent to Razorpay. On a fee with nothing paid: `There is no payment on record ... so there is nothing to refund.`

**A5. An amount over a limit (waivers).**
- C writes `can you take 50 off Test One's fee?` (within the ₹100 limit): C sees `Done. ₹50 is taken off ...`; O sees `Done within your ₹100 limit: ₹50 taken off ...`. Record: `waive_fee` confirmed.
- C asks for ₹300 off: C sees `I cannot change the fee myself. I have asked the owner about taking ₹300 off ...`; O sees `Approval needed: <C> asks to take ₹300 off ... Reply "approve q-2" or "deny q-2"`. Record: `waiver_request` held_for_owner. **A waiver is not held by Guard** (a smaller link is not a refund): it is the agent's own question to the owner.
- O replies `approve q-2`: C sees `Done. ₹300 is taken off ... ₹<x> is now to pay: <link>`; record `owner_decision` confirmed, `waive_fee` confirmed, a new `create_fee_link` for the smaller amount (the old link is closed or replaced). O replies `deny q-2` on another: C sees `The owner has decided not to change ...`; no `waive_fee`.
- The agent never offers a discount unasked.

**A6. The amount changes after the owner was asked (the old approval must not cover the changed action).**
8. C asks for ₹300 off (as above); **before** O answers, pay part of the fee (₹300) so the balance has changed. Then O replies `approve q-N`.
- What O saw: ₹300 off at the old balance. What must happen: the yes is **not applied**. O sees `Not done: Test Two's fee for <Month> (<C>) changed since you were asked, so nothing was applied. If it still matters, the parent can ask again.`
- Record: `owner_decision` **blocked** with the note "the fee changed since the owner was asked (the balance was X and is Y ...)"; no `waive_fee`.
- Also try the same with a late fee arriving between ask and answer (ask on day +4, answer on day +6).
- For a held **refund**: change the centre's refund limit or the payment (a part refund already done) between the hold and the approval; expect Guard to refuse or the same bytes to go out, never a different amount. Record the entries and the dashboard.

**A7. The lost reply (a refund went out and the answer never came).** Use P5 on an approved refund.
- C sees: `We are checking your ₹800 refund and will message you as soon as it is confirmed.` (the unresolved wording; never "is on its way").
- Record: `refund` attempted, then `unconfirmed` with the note "...may or may not have been made. It was NOT sent again. Check the payment gateway's own records for payment pay_..."; or `confirmed` with "the payments service's own list shows the refund, and it is not sent again".
- Must hold: no second refund for the same payment id, in the record or on the Razorpay dashboard; the same state after P6; the panel's look-again reads Razorpay's own refund list and clears the item only when it finds the refund. If not reproduced, write "not reproduced".

**A8. Reminders when the payments service cannot be read.** Stop the Razorpay Guard (P3) at the reminder hour. Expected: **no reminder goes out** (rule 1: a reminder only if the record shows the fee unpaid and could be read). Record: no `send_message` for a reminder; the reminder goes after the Guard is back, once, not once per tick.

**A9. A provider outage and a wrong key (P3).**
- WhatsApp Guard down while C writes `I have paid`: nothing comes back, no half-answer; after the Guard is back, one reply. Past 15 minutes: one to-do item for the owner; no message to C if the WhatsApp Guard is the one down.
- Razorpay Guard down while C asks to pay: the same wait. After the bound or with a wrong key: C sees `Sorry, I could not make the payment link just now, so I have not sent it. I have told the owner. Please try again in a few minutes.`; O sees `Could not make the payment link for Test One's fee for <Month> (<C>). No reminder went out. Please check Razorpay.` Record: `create_fee_link` blocked/failed. A wrong key must **not** wait 15 minutes.
- Nothing sent twice: look at both phones and the dashboard.

**A10. STOP.** C writes `STOP`. No reply to C. O sees `Parent <C> sent STOP. No more messages will go to them.` Record: `opt_out` confirmed; no later `send_message` to C, and no late fee for them.

**A11. The 24-hour window (P4, day 2).** C writes once on day 1 and then stays silent over 24 hours. A reminder goes at the next reminder hour. Expected: the approved template (`fee_reminder` family), not free text (Meta's `131047` otherwise); after C writes, free text again. A voice note from C gets `Please type your message; I cannot listen to voice notes yet.` Template approval in the sandbox: **check in the provider's console**.

**A12. The two-customers case does not apply.** Fees has no slot or stock. The nearest case is two parents paying the same fee link at the same moment: both pay, write down whether the second is refunded (`one` settled fee, the extra refunded) and show the entries.

## Part B: UPI (₹1, owner-marked)

Settings `bright-tuition-upi.example.json`, the fee ₹1, late fee 0. C pays ₹1 by hand from a UPI app of yours to the centre's UPI ID. This is the only real-money step; it comes back to you. (UPI has no test mode.)

**B1. The reminder.** C gets the reminder with the UPI link or QR, the UPI ID and ₹1 (the pay words are the UPI variant). O gets `UPI payment to check ...` with a code. Record: `open_fee` confirmed; `upi_request` (refs.requestId, amountPaise); `send_message` confirmed.
**B2. "I paid" and a screenshot are not proof.** C pays ₹1 and sends a screenshot or taps I have paid. Record: `upi_paid_claim` (refs.via); the fee is **not** settled; O sees the "says they have paid ... A screenshot is not proof: check your UPI app" message (at most once an hour); no further reminders are blocked by the claim alone (check and note).
**B3. The owner marks it received.** O looks in the UPI app and replies `received <code>` (or taps Received). C sees the receipt. Record, **the owner's statement and labelled so, not a provider confirmation:** `owner_marked_paid` confirmed with refs `markedBy`, `paymentId`, `requestId`, `amountPaise`, then `settle_fee`. There is **no** `receive_payment_event` from a provider for it. The report line reads "marked paid by owner". A screen that says a gateway confirmed a UPI mark is a finding. A part mark (`received <code> 0.50`) leaves the fee open and the owner is asked for the rest (Bookings and Orders write `upi_deposit_part` / `upi_advance_part` held_for_owner; the Fees code writes no entry by such a name, so copy whatever the record shows and tell the lead).
**B4. The same mark twice** gives `That payment is already marked. It is counted once.` and no second `owner_marked_paid`. A wrong code: `I don't know that code...`
**B5. A refund on UPI.** An overpayment or an approved refund: O sees `Refund to send: ₹x by UPI to ...`; C is not told "sent". O sends ₹1 back by hand and replies `refunded <code>`: record `upi_refund_owed` (held_for_owner) then `upi_refund_marked_done`; `kept <code>` gives `upi_refund_kept`. No Guard hold exists on this path.
**B6.** Repeat A9 (WhatsApp outage) and A11 (window) once on the UPI centre.

## Monthly report

**R1.** On the 1st from 09:00 (centre time), once, O gets the owner's message: collected, still to collect, given back, reminders sent, what was taken off, what the owner was asked, approved and refused, what the limits stopped, and what was not checked. Inside the window it is text; outside, the template (`fee_monthly_report`). Compare with the Razorpay test dashboard ("collected" is counted from Razorpay's own list, each payment once) and, for UPI, the owner-marked amounts. A number that cannot be counted is listed under "not counted". Restart the runtime before and after 09:00: one report.
**R2.** Without waiting: `node templates/education/fees/scripts/client-report.ts --settings <file> --record entries.json --dues dues.json --month <YYYY-MM> --lang en --out ./out --source test-mode`. Fees has no monthly record certificate yet (Deferred.md).

## Results table

| Step | Pass / fail / not reproduced | Note (what you saw on the phones) | Record entry id (`seq`) |
| --- | --- | --- | --- |
| A1 reminder and payment | | | |
| A2 "I already paid" | | | |
| A3 paid twice / event twice | | | |
| A4 refund approve / deny / too much | | | |
| A5 waivers and limits | | | |
| A6 amount changed after approval | | | |
| A7 lost reply | | | |
| A8 reminders with the payments service down | | | |
| A9 outage and wrong key | | | |
| A10 STOP | | | |
| A11 24-hour window | | | |
| A12 two payers at once | | | |
| B1 to B6 UPI | | | |
| R1/R2 monthly report | | | |

**Send back to the lead:** the table, `entries.json`, the screenshots of the messages quoted above, the Razorpay payment and refund ids, and anything the phones showed that differs from the words quoted here.
