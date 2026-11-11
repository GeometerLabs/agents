<!--
What this is for: the manual test script for the Bookings template (templates/commerce/bookings) on the real services: WhatsApp sandbox, Razorpay test mode, UPI, a test Google calendar.
Who runs it: the owner or a partner, by hand, in one sitting (plus one step the next day). Read README.md in this folder first (set-up and procedures P1 to P6).
Entry names below are the ones the code writes (templates/commerce/bookings/src/agent.ts, modules/payments/refunds.ts, modules/payments/owner-marked/obligations.ts).
-->

# Bookings: manual test

Shop: Glow Salon "TEST" (haircut ₹450, 45 minutes; deposit ₹200, hold 15 minutes; cancel 24 hours before for a refund; a ₹200 refund limit; buffer 10 minutes). Run **Part A on Razorpay test mode**, then **Part B on UPI** (settings `glow-salon-upi.example.json`, everything at ₹1).
Phones: **O** = owner, **C** = customer, **C2** = second customer. Note the time before each step so you can find its record entries (P1).

## Part A: Razorpay test mode

**A1. Hello and the quote (happy path, first half).**
1. C writes: `haircut tomorrow at 6pm`.
- C sees: either `Just to be sure: haircut on <day>, 6:00 pm. Reply "yes" to continue.` (reply yes) or straight `Our haircut is ₹450. <slot> is free. Pay a ₹200 deposit to confirm: <link> (I'll hold the slot for 15 minutes.)`. Hindi, Malayalam and Kannada customers (typed in the language or in Latin letters) get the same words in their language.
- Guard: allows the payment-link creation (an amount from ₹1 up to the deposit range), the calendar hold and the WhatsApp sends.
- Record: `receive_message` confirmed; `hold_slot` attempted then confirmed (refs.eventId); `create_deposit_link` attempted then confirmed (refs.linkId).
- Calendar: an event appears in GEOMETER TEST, marked tentative. Look at the calendar.

**A2. Pay the deposit (happy path, second half).**
2. C opens the link and pays with Razorpay's test UPI `success@razorpay` (or the test card). Never a real card.
- C sees: `Booked! haircut on <slot>. Your ₹200 deposit is received. Cancel at least 24 hours before the start for a refund.`
- O sees: nothing needed in the happy path (the owner's messages are for exceptions).
- Record: `receive_payment_event` confirmed; `record_deposit` confirmed (refs.paymentId); `confirm_booking` attempted then confirmed; the calendar event is now confirmed.
- Pass only if the calendar event changed from tentative to confirmed **and** the Razorpay dashboard shows the payment.

**A3. The deposit is paid twice, or the payment event comes twice (the retried-payment case).**
3. Start a new booking with C (a different time) and pay it. Then make the same payment event arrive again: in the Razorpay dashboard (Test mode, Webhooks, event log) resend the payment-link-paid event; if the dashboard has no resend (**check in the provider's console**), ask the lead to replay the captured webhook body with its signature. Then try to pay the same link a second time in the browser (a paid link normally refuses; write down what Razorpay says).
- C sees at most once: `You paid the deposit twice. The extra ₹200 is being refunded.` (above the refund limit: `...will be refunded once the owner approves.`). A replayed event carrying the same payment id gives **no** second message.
- Guard: one refund per payment, never above one deposit (rule `refund-at-most-deposit`).
- Record: the second `receive_payment_event` with the same id adds no money (no second `record_deposit`); at most one `refund` confirmed. **Never two `refund` confirmed for one payment id.** Razorpay dashboard: at most one refund.

**A4. Owner approval of a refund.** (P2: set `cancellation.refundLimitInr` to 100.)
4. C has a booking paid more than 24 hours ahead. C writes `cancel my booking` and answers yes.
- C sees: `Your booking for <slot> is cancelled. The owner will confirm your ₹200 refund shortly.`
- O sees: `Approval needed: refund ₹200 for <C's number> (haircut, <slot>). Reply "approve K7M2QX" or "deny K7M2QX" within <N> hours.` (the code differs).
- Guard: **holds** the refund (HTTP 202); it is not sent.
- Record: `cancel_booking` confirmed; `refund` attempted then `held_for_owner`.
5. O replies `approve <code>`.
- O sees: `Thank you. The ₹200 refund for <C> is being sent, and they will be told.` C sees: `The owner approved your refund. ₹200 is on its way.`
- Record: `owner_decision` confirmed; `refund` confirmed (refs.refundId). The Razorpay test dashboard shows one refund. A second `approve` with the same code does nothing.

**A5. Owner refusal.** Repeat step 4 on a new booking, then O replies `deny <code>`.
- O sees: `Understood. The ₹200 refund for <C> will not be sent, and they will be told.` C sees: `The owner has decided not to refund the ₹200 deposit.`
- Record: `owner_decision` confirmed (a deny); no `refund` confirmed; Razorpay shows no refund.

**A6. A cancellation less than 24 hours before the start.** Book a slot about 5 hours ahead, pay, cancel.
- C sees: `...As it is less than 24 hours before the start, the owner will decide about your ₹200 deposit and message you.`
- O sees: `Customer <C> cancelled haircut on <slot> less than 24 hours before the start. Deposit ₹200. Reply "approve b-3" to refund it or "deny b-3" to keep it.` (your booking id).
- Guard: nothing moves until O answers. Record: `cancel_booking` confirmed, no `refund` yet.

**A7. An amount over a limit.**
- 7a. C writes `haircut tomorrow 6pm, can you do it for ₹300?` C sees `Our haircut is ₹450, and I can't go lower than that.` and then the quote. Record: the rule `price-at-or-above-list` is in the decisions of `hold_slot` / `create_deposit_link`, allowing ₹450 only.
- 7b. A refund bigger than the deposit: with a ₹200 deposit paid, C asks `I want ₹500 back`. Expected: never more than ₹200 (rule `refund-at-most-deposit`); the record shows `refund` blocked or the amount limited; nothing larger reaches Razorpay.
- 7c. A refund above the owner's limit: covered by A4 (held for the owner).

**A8. The amount changes after the owner was asked (the old approval must not cover a changed action).**
8. Make a held refund as in step 4 (₹200, not yet answered). Before O answers, the lead lowers the deposit in the settings to ₹100 and redeploys, so the held ₹200 is now above one deposit. Then O replies `approve <code>`.
- What O saw on WhatsApp: ₹200. What must reach Razorpay: only what matches it, or nothing.
- Expected from the code: the agent sends the same bytes that were held; Guard refuses refunds of older, larger deposits still open (`refund-at-most-deposit`, Bookings README). Record: `owner_decision` confirmed, then `refund` blocked or failed. **Never** a Razorpay refund of a different amount than the ₹200 O saw. Razorpay dashboard: no refund of any other amount.
- Write down exactly what C and O were told. If O is told "is being sent" and nothing was sent, put that in the note: a finding for the lead. (Not confirmed from the code: what O is told when Guard refuses after the approval.)

**A9. The lost reply (the refund went out and the answer never came).** Use P5 on a refund the owner approved (step 4 or 5 repeated).
- C sees: `We are checking your ₹200 refund and will message you as soon as it is confirmed.` (the unresolved wording; not "is on its way", not "refunded").
- O: an item in the panel's unfinished-work list for the refund whose outcome is not known; write down its words (not confirmed from the code).
- Record: `refund` attempted, then `refund` `unconfirmed` with the note "...may or may not have been made. It was NOT sent again. Check the payment gateway's own records for payment pay_..." (or `confirmed`, "the payments service's own list shows the refund, and it is not sent again", if the list showed it).
- Must hold: no second `refund` attempted for the same payment id; the state survives P6 (restart the runtime, same state, still no second refund); the panel's look-again on the item reads Razorpay's own refund list: found gives `refund` confirmed with "looked again: ... It was not sent again" and the item clears; not found gives `unconfirmed` again. Compare with the Razorpay dashboard.
- If P5 did not reproduce it, write "not reproduced"; do not mark pass.

**A10. Two customers for the last slot, at the same moment.**
10. Pick a slot nobody holds. C and C2 each type `haircut tomorrow at 6pm` and send within the same second (count down together).
- Expected: one gets the quote with a link; the other gets `Sorry, <slot> is not available. Please suggest another time.` The calendar has one tentative event.
- Record: winner `hold_slot` confirmed; other `hold_slot` blocked, rule `no-double-booking` ("unavailable"), or blocked with "the calendar refused: someone took the time first".
- **How it works in the code (read before you trust a pass):** Bookings **reads the calendar first and then inserts** (`slotRules` reads the conflicts, then `ensureEvent` inserts a tentative hold). Google Calendar never refuses an overlapping insert. Two customers of one shop are kept apart only because the shop's runtime handles one message at a time, in arrival order, so the second sees the first's hold. That does not cover an event made by hand or by anything outside the runtime in the same moment; Bookings' Deferred.md lists this as an open race. Test it once: while C types the request, O adds an event by hand at the same time in the test calendar. Write down who won and whether two events now overlap. Two overlapping events is a finding.

**A11. A calendar conflict (the time is already taken).**
11. In the test calendar add an event by hand tomorrow 3pm for an hour. C asks for `haircut tomorrow 3:30pm`, then for 4:05pm (inside the 10-minute buffer).
- C sees `Sorry, <slot> is not available. Please suggest another time.` both times.
- Rules: `no-double-booking` blocks. Record: `hold_slot` blocked; no `create_deposit_link`.

**A12. A calendar save that silently fails.**
12. The lead makes the calendar save not stick: take the service account's write access away from GEOMETER TEST (a read-only share). There is no real-service switch for "answers OK and saves nothing"; this is the nearest, so write down which you used. C books and pays.
- Expected: the agent reads the calendar back, does not see the booking, and does **not** say booked. C sees `We received your ₹200 deposit, but I couldn't confirm <slot> in our calendar yet, so it is not booked. I've told the owner, who will contact you.` (failed hold before payment: `Sorry, I couldn't hold <slot> just now, so nothing is booked. I've told the owner...`).
- O sees `Could not confirm <C>'s haircut on <slot> in the calendar, so it is NOT booked. Their ₹200 deposit is recorded. Reply "retry b-3" to check the calendar again, or "approve b-3" to cancel it and ...`
- Record: `record_deposit` confirmed; `confirm_booking` attempted then failed or unconfirmed ("the calendar does not show the booking"); never `confirm_booking` confirmed. Give the access back, O replies `retry b-3`: `confirm_booking` confirmed.

**A13. A provider outage and a wrong key (P3).**
- 13a. Stop the **WhatsApp Guard**. C writes `haircut tomorrow 6pm`. Nothing comes back, no half-answer. After 2 minutes start the Guard: C gets the reply once. Record: one `receive_message`, one `hold_slot`, one `create_deposit_link`, one `send_message`. Repeat but leave the Guard down past 15 minutes: the owner's to-do list gets one item; C is told nothing (the WhatsApp Guard is down, nothing can reach C).
- 13b. Stop the **Razorpay Guard** after C has the hold and before C pays. Start it. A payment made while it was down arrives afterwards: `record_deposit` confirmed once.
- 13c. A wrong Razorpay secret, redeployed; C books. C sees `Sorry, I couldn't create the payment link just now, so nothing is booked. I've told the owner.` O sees `Could not set up <C>'s haircut on <slot>: the calendar or the payment link did not work. Nothing is booked.` Record: `create_deposit_link` failed or unconfirmed. This must **not** wait 15 minutes (a provider's "no" is not an outage). Put the key back.
- In every case: no message twice and no refund twice (phones and Razorpay dashboard).

**A14. The 24-hour window (P4, day 2).** Book a slot about 25 hours ahead and pay; C stays silent until the reminder (set 24 hours and 2 hours before).
- Expected: the reminder arrives as the approved template (`Reminder: your haircut at <shop> is on <slot>.`), not free text; after C writes once, free text works again. Record: `send_message` for the reminder; if the template is not approved it is not `confirmed` (error 131047 or 132001). Template approval in the sandbox: **check in the provider's console**.

## Part B: UPI (₹1, the owner-marked path)

Settings `glow-salon-upi.example.json` with deposit, price and refund at ₹1. C pays by hand from a UPI app of yours **₹1** to the shop's UPI ID. This is the only real-money step in the script, and it comes back to you. (UPI has no test mode.)

**B1. The quote.** C writes `haircut tomorrow 6pm`. C sees the QR picture (inside the window), the UPI ID, ₹1, and the buttons I have paid, Cancel booking, Talk to the owner. O sees `UPI payment to check: customer <C> will pay the ₹1 deposit for haircut on <slot> (booking b-N). When it shows in your UPI app, tap Received or reply "received K7M2QX"...`
- Record: `hold_slot` confirmed; `upi_request` (refs.requestId, amountPaise).

**B2. "I have paid" is not proof.** C pays ₹1, then sends a screenshot (or taps I have paid, or writes `I paid`). C sees that the owner will confirm. O sees `Customer <C> says they have paid the ₹1 deposit for booking b-N. A screenshot is not proof: check your UPI app. When it is there, tap Received or reply "received K7M2QX".` (at most once an hour).
- Not booked yet. Record: `upi_paid_claim` (refs.via = screenshot, button or words); no `confirm_booking`.

**B3. The owner marks it received.** O looks in the UPI app, sees ₹1, replies `received <code>` (or taps Received).
- O sees `Thank you. ₹1 for booking b-N is marked paid by you.` C sees `Booked! ...`.
- Record, **the owner's statement, not a provider confirmation:** `owner_marked_paid` confirmed with refs `markedBy`, `paymentId`, `requestId`, `amountPaise`, then `confirm_booking`. There must be **no** `receive_payment_event` from a provider for this payment. In the panel and report it reads "Deposits marked paid by owner". A screen that says Razorpay or a gateway confirmed a UPI mark is a finding.
- Wrong amount: O replies `received <code> 0.50`: C is not booked; O sees `You marked ₹0.50 ... not booked yet. ... When the other ₹0.50 arrives ...`; record `upi_deposit_part` held_for_owner.

**B4. The same mark twice.** O replies `received <code>` again: `That payment is already marked. It is counted once.` Record: no second `owner_marked_paid`. A wrong code: `I don't know that code...`

**B5. The hold runs out, then the owner marks.** Set the hold to 2 minutes for this step; mark after it. O sees `You marked ₹1 received for booking b-N after its hold had ended, so it was not booked again by itself...`. Record: `owner_marked_paid`, `upi_request_closed`, `upi_refund_owed`; no `confirm_booking`.

**B6. A UPI refund (and a retry of the owner's mark).** Cancel a paid booking inside the window. C is told the owner will send it; nothing says "sent". O sees `Refund to send: ₹1 by UPI to customer <C> (booking b-N). The agent never sends money. When you have sent it, tap Refund sent or reply "refunded <code>".` O sends ₹1 back by hand and replies `refunded <code>`. Record: `upi_refund_owed` (held_for_owner), then `upi_refund_marked_done`. A repeated `refunded <code>` adds no second entry. No gateway, so Guard holds nothing here: the owner is the check.

**B7. Kept.** On another: reply `kept <code>`: `upi_refund_kept`; O sees `Noted. The ₹1 ... is kept for a booking you make yourself.`

**B8. UPI and the outage/window steps.** Repeat A13a and A14 once on the UPI shop (WhatsApp Guard down: the owner's "UPI payment to check" waits and goes once).

## Monthly report

**R1.** On the 1st at 09:00 (shop time), once, O's phone gets the five-line report. Inside the 24-hour window it is text; otherwise the approved template (`monthly_report`; UPI shops `monthly_report_upi`). Check: the money equals the Razorpay test dashboard for Part A and the owner-marked ₹1 lines for Part B ("marked paid by owner"); a "what we did not check" part exists; the page behind the link opens; the owner's language is used. Restart the runtime on the 1st before and after 09:00: one report only.
**R2 (when you cannot wait for the 1st).** `node templates/commerce/bookings/scripts/client-report.ts --settings <file> --record entries.json --bookings bookings.json --month <YYYY-MM> --lang en --out ./out --source test-mode` and compare the same numbers. A month with nothing in the record sends nothing.

## Results table

| Step | Pass / fail / not reproduced | Note (what you saw on the phones) | Record entry id (`seq`) |
| --- | --- | --- | --- |
| A1 quote | | | |
| A2 deposit paid | | | |
| A3 paid twice / event twice | | | |
| A4 approve | | | |
| A5 deny | | | |
| A6 late cancel | | | |
| A7 over a limit | | | |
| A8 amount changed after approval | | | |
| A9 lost reply | | | |
| A10 two customers, last slot | | | |
| A11 calendar conflict | | | |
| A12 calendar save fails | | | |
| A13 outage and wrong key | | | |
| A14 24-hour window | | | |
| B1 to B8 UPI | | | |
| R1/R2 monthly report | | | |

**Send back to the lead:** the table, `entries.json`, screenshots of every message quoted above, the Razorpay payment and refund ids, the A10 note on whether two events overlapped, and anything the phones showed that differs from the words quoted here.
