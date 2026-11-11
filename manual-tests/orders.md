<!--
What this is for: the manual test script for the Orders template (templates/commerce/orders) on the real services: WhatsApp sandbox, Razorpay test mode and UPI. Orders has no calendar: stock and the day's limit are worked out from the orders themselves.
Who runs it: the owner or a partner, by hand, in one sitting (plus one step the next day). Read README.md in this folder first (set-up and procedures P1 to P6).
Entry names below are the ones the code writes (templates/commerce/orders/src/agent.ts, modules/payments/refunds.ts, modules/payments/owner-marked/obligations.ts).
-->

# Orders: manual test

Shop: Annapurna Tiffins "TEST" (veg thali ₹120, stock 12 a day; chicken meal ₹160, stock 8; curd ₹20, stock 30; pickup lunch 12:00 to 13:00 and dinner 19:00 to 20:00, delivery to Kakkanad, Edappally and Infopark; at most 8 orders a day and 10 items an order; cut-off for lunch 09:00 the same day and dinner 15:00; advance 50% held for 30 minutes; cancel at least 6 hours ahead for the advance back; a ₹300 refund limit; the owner approves any order above ₹1,000). Part A uses `annapurna-tiffins-razorpay.example.json`; Part B uses `annapurna-tiffins.example.json` (UPI) with the menu prices set to ₹2 and the advance full, so the advance is ₹2 and the smallest test is ₹1 (set veg thali to ₹1 for the single-item steps).
For the stock steps the lead sets veg thali `dailyStock` to **3** for the test day.
Phones: **O** owner, **C** customer, **C2** second customer. Note the time before each step (P1).

## Part A: Razorpay test mode

**A1. An order from one sentence, then the advance (happy path).**
1. C writes `2 veg thali tomorrow lunch pickup`.
- C sees the quote: `2 veg thali for <day> lunch (12:00 to 13:00), pickup. Total ₹240. To confirm, pay ₹120 here: <link> (I'll hold your order for 30 minutes.)` (or first one question at a time: the day, pickup or delivery buttons, a slot list; and `Just to be sure: ... Reply "yes" to continue.`). Hindi, Malayalam and Kannada are the same facts in the customer's language; Latin-letter typing works.
- Guard: allows the link (₹1 up to the dearest order the shop can take); rules `price-at-or-above-menu`, `order-size`, `within-stock`, `within-day-cap`, `before-cutoff` all allow.
- Record: `receive_message` confirmed; `check_order` confirmed; `hold_stock` confirmed; `create_advance_link` attempted then confirmed.
2. C pays the link with Razorpay's test UPI `success@razorpay` (or the test card; never a real one).
- C sees: `Confirmed! 2 veg thali for <day> lunch, pickup. We have received your advance of ₹120. ... Cancel at least 6 hours before the start for a refund.`
- O sees: `New order o-1 from <C>: 2 veg thali for <day> lunch, pickup. Total ₹240, advance ₹120 paid, ₹120 to collect. ...`
- Record: `receive_payment_event` confirmed; `record_payment` confirmed (refs.paymentId); `confirm_order` confirmed (rule `confirm-only-when-recorded`). "I have paid" in words, the button or a screenshot confirms nothing on its own. Razorpay dashboard shows the payment.
3. Delivery: C writes `1 chicken meal tomorrow dinner delivery`, then an address in Edappally. A second order with an address outside the list (`Anna Nagar, Chennai`) gets `Sorry, we do not deliver to that address. We deliver to: Kakkanad, Edappally, Infopark. You can pick up instead.` Record: `check_address` confirmed / blocked (`within-delivery-area`); the address goes in O's order message and nowhere else (not in the record).

**A2. A payment made twice, or the event delivered twice (the retried-payment case).**
- Pay an order, then make the same event arrive again (Razorpay dashboard, Test mode, Webhooks, event log, resend; if no resend, **check in the provider's console**, or the lead replays the captured body). Then try the link a second time.
- C sees at most once `You paid the advance twice. The extra ₹120 is being refunded.` (above the limit: `...will be refunded once the owner approves.`); none for a replayed identical event.
- Guard/rules: `one-advance-per-order`; a refund never more than was paid and one per payment.
- Record: no second `record_payment` for the same payment id; at most one `refund` confirmed per payment; the dashboard shows at most one refund.

**A3. Owner approval and refusal.**
- *An order above the owner's line (approve).* C writes `9 veg thali tomorrow lunch pickup` (₹1,080, above ₹1,000). C sees `Your order (9 veg thali, <day> lunch) is a big one, so I have asked the owner to approve it. You will hear back here.` **No link yet.** O sees `Approval needed: <C> wants 9 veg thali for <day> lunch, pickup. Total ₹1,080. Reply "approve o-2" to let them pay, or "deny o-2".` Record: `ask_owner` held_for_owner. O replies `approve o-2`: the checks run again, then the quote and link go to C. Record: `owner_decision` confirmed, then `hold_stock` and `create_advance_link`.
- *Refusal.* The same on another order; O replies `deny o-3`. C sees `Sorry, the owner cannot take your order for <day>. Nothing was charged.` Record: `owner_decision` confirmed; no `hold_stock`, no `create_advance_link`.
- *A refund the owner approves or refuses* (P2: set `refund.limitInr` below the advance, e.g. 100): C cancels a paid order more than 6 hours ahead. C sees `Your order for <day> lunch is cancelled. The owner will confirm your ₹120 refund shortly.` O sees `Approval needed: refund ₹120 for <C> ... Reply "approve K7M2QX" or "deny K7M2QX" within <N> hours.` Guard **holds** it (202). `approve <code>`: O `Thank you. The ₹120 refund for <C> is being sent...`; C `The owner approved your refund. ₹120 is on its way.`; record `cancel_order` confirmed, `refund` attempted, `held_for_owner`, `owner_decision` confirmed, `refund` confirmed; one refund on the dashboard. `deny <code>` on another: C `The owner has decided not to refund the ₹120 advance.`; no refund on the dashboard.
- *A late cancellation* (less than 6 hours ahead): C `...the owner will decide about your ₹120 advance and message you.`; O gets a message with `approve o-N` / `deny o-N`; nothing moves until O answers; `cancel_order` confirmed, no `refund` yet.

**A4. An amount over a limit.**
- More than 10 items: `12 veg thali tomorrow lunch pickup`: `Sorry, one order can have at most 10 items. Please send a smaller order, or talk to the owner.` Record: `check_order` blocked (`order-size`). No link.
- Below the menu price: `veg thali for ₹80`: `Our veg thali is ₹120, and I can't go lower than that.` (`price-at-or-above-menu`).
- After the cut-off: ask for today's lunch after 09:00: `Sorry, orders for <day> lunch closed at 9:00 am. Please pick another day or time.` (`before-cutoff`).
- More than the day's stock: see A7.
- Refund bigger than paid: never; the record shows `refund` blocked.

**A5. The amount changes after the owner approved (the old approval must not cover the changed action).**
- *Order total.* Make a big order (step A3) so O is asked, with `approve o-N` not yet sent. Before O answers, C changes the order (`make it 12 thali` or a different day). Expected: the approval is for the order the owner saw; write down what O sees and what the order is when O replies. **Not confirmed from the code:** whether a change by the customer cancels the pending approval or asks the owner again. The pass condition: the order that gets a link is the one O saw, or O is asked again; never a link for a bigger total than the ₹ O saw.
- *The world moved.* After O is asked about a ₹1,080 order, C2 orders enough veg thali to take the stock (the lead set it to 3). O then replies `approve`. The code runs the checks again on approval: expect `check_order` blocked (`within-stock`), C told `Sorry, only <n> veg thali left for <day>...`, and no link. Record: `owner_decision` then `check_order` blocked.
- *A held refund.* Make a held refund (A3), then before O answers lower `refund.limitInr` / change settings (the lead). Expect Guard to send the held bytes unchanged or refuse; never a different amount. Dashboard: no refund of any amount other than the ₹ O saw.
- Write down exactly what C and O were told. If O is told "is being sent" and nothing was sent, that is a finding.

**A6. The lost reply (the refund went out and the answer never came).** Use P5 on an approved refund.
- C sees: `We are checking your ₹120 refund and will message you as soon as it is confirmed.` (unresolved; never "is on its way").
- Record: `refund` attempted then `unconfirmed` with the note "...may or may not have been made. It was NOT sent again. Check the payment gateway's own records for payment pay_..." (or `confirmed`, "the payments service's own list shows the refund, and it is not sent again").
- Must hold: no second `refund` for the same payment id, in the record or on the dashboard; the same state after P6; the panel's look-again reads Razorpay's own list and clears the item only when it finds the refund (`refund` confirmed, "looked again: ... It was not sent again"). If not reproduced, write "not reproduced".

**A7. Two customers for the last item, at the same moment.**
- Stock of veg thali is 3 for the day. C types `2 veg thali tomorrow lunch pickup` and C2 types the same, sent within the same second.
- Expected: one gets the quote and link; the other gets `Sorry, only 1 veg thali left for <day>. Please change the order, or pick another day.` Record: the winner `hold_stock` confirmed; the other `check_order` blocked (`within-stock`).
- **How it works in the code:** Orders keeps **no counter and no reservation of its own**. Stock is worked out each time from the orders that hold stock now (confirmed ones, and ones whose 30-minute hold has not run out), in the shop's own saved state. Two messages are handled one at a time in arrival order by the shop's runtime, so the second sees the first's hold. That is an authoritative store inside one runtime, not a read of an outside system; it holds as long as one runtime serves the shop. Write down anything that gets past it (two holds beyond stock).
- Then let the winner's hold run out unpaid (30 minutes): the stock comes back without any event (`hold_expired` message to the winner: `The hold on your order (...) has ended because the advance was not received in time...`); the other customer can now order. The same for the day's order cap (8): fill it and see `Sorry, we cannot take any more orders for <day>. Please pick another day.`
- A payment that arrives after the hold ended is taken again only if the cut-off, the stock and the day still allow it; otherwise `Your payment of ₹120 arrived after the hold on your order ended, and ... is no longer available. ₹120 is being refunded to you.` Try it: pay the loser's late link after the winner confirmed. Record: `record_payment` confirmed, `refund` confirmed once.

**A8. A provider outage and a wrong key (P3).**
- WhatsApp Guard down while C orders: nothing comes back; after 2 minutes up, one reply; one `hold_stock`, one `create_advance_link`, one `send_message`. Down past 15 minutes: one to-do item for the owner; C hears nothing (the WhatsApp Guard is the one down).
- Razorpay Guard down after the hold, before the payment: the customer pays at Razorpay's page while it is down; the payment arrives afterwards; `record_payment` confirmed once, `confirm_order` once.
- A wrong Razorpay secret: C sees `Sorry, I couldn't create the payment link just now, so nothing is ordered. I've told the owner. Please try again in a few minutes.` Record: `create_advance_link` failed/unconfirmed; `release_stock` for the hold. It must not wait 15 minutes. Put the key back.
- No message twice, no refund twice, in every case.

**A9. STOP and the 24-hour window (P4, day 2).** C writes `STOP`: no reply; record `opt_out`. For the window: C orders in the evening, pays, and stays silent; the next day something is sent that is not a reply (an owner message to C is not, but a reminder or the report is). Expected: the approved template; customer confirmations in other variants go as plain text inside the window (Orders' Deferred.md); if the template is not approved: not `confirmed`, error 131047 or 132001. Template approval in the sandbox: **check in the provider's console**. A voice note gets `Please type your message; I can't listen to voice notes yet.`

## Part B: UPI (₹1 or ₹2, owner-marked)

Settings `annapurna-tiffins.example.json` with prices lowered as above. C pays by hand from a UPI app of yours to the shop's UPI ID. This is the only real-money step; it comes back to you. (UPI has no test mode.)

**B1. The quote.** C writes `1 veg thali tomorrow lunch pickup` (veg thali ₹1). C sees the UPI ID, the QR picture and ... `The owner confirms the payment, then I'll message you.` O sees `UPI payment to check: ...` with a code and a Received button. Record: `hold_stock` confirmed; `upi_request`.
**B2. "I have paid" is not proof.** C pays ₹1 and sends a screenshot or taps I have paid. C is told the owner will look; O sees `...says they have paid ... A screenshot is not proof: check your UPI app...` (at most once an hour). Record: `upi_paid_claim` (refs.via); **no** `confirm_order`.
**B3. The owner marks it received.** O replies `received <code>`. C sees `Confirmed! ...` (`the owner has confirmed`), O gets the new-order message. Record, **the owner's statement and labelled so, not a provider confirmation:** `owner_marked_paid` confirmed with refs `markedBy`, `paymentId`, `requestId`, `amountPaise`, then `confirm_order`. There is **no** `receive_payment_event` from a provider. The report line reads "marked paid by owner". A screen that says a gateway confirmed it is a finding. A part mark (`received <code> 0.50`) keeps the order held and asks for the rest: record `upi_advance_part` held_for_owner.
**B4. The same mark twice:** `That payment is already marked. It is counted once.`; no second `owner_marked_paid`. A wrong code: `I don't know that code...`
**B5. A mark after the hold ended** never confirms the order by itself: O is told the money is owed back or can be kept for an order made by hand; record `owner_marked_paid`, `upi_request_closed`, `upi_refund_owed`; no `confirm_order`.
**B6. A refund on UPI.** Cancel a paid order inside the window: C is not told "sent" until O marks it. O sees `Refund to send: ₹1 by UPI to ...`; O sends it by hand and replies `refunded <code>`. Record: `upi_refund_owed` (held_for_owner), `upi_refund_marked_done`; `kept <code>` gives `upi_refund_kept`. No Guard hold exists on this path; the owner is the check.
**B7.** Repeat A7 (the last item) on the UPI shop: the stock is held by the quote, not by the payment.
**B8.** Repeat A8 (WhatsApp outage) and A9 (window) once on the UPI shop.

## Monthly report

**R1.** On the 1st from 09:00 (shop time), once, O gets the report on WhatsApp (text inside the window, otherwise the template) with a page behind a link. Compare the money with the Razorpay test dashboard (Part A) and the owner-marked amounts (Part B, "marked paid by owner"); a "not tested" part exists. Restart the runtime before and after 09:00: one report.
**R2.** Without waiting: `node templates/commerce/orders/scripts/client-report.ts --settings <file> --record entries.json --orders orders.json --month <YYYY-MM> --lang en --out ./out` and compare. Orders' export removes the delivery address and keeps the customer as a keyed fingerprint.

## Results table

| Step | Pass / fail / not reproduced | Note (what you saw on the phones) | Record entry id (`seq`) |
| --- | --- | --- | --- |
| A1 order and advance | | | |
| A2 paid twice / event twice | | | |
| A3 approve / deny / refund / late cancel | | | |
| A4 over a limit | | | |
| A5 amount changed after approval | | | |
| A6 lost reply | | | |
| A7 last item, two customers | | | |
| A8 outage and wrong key | | | |
| A9 STOP and 24-hour window | | | |
| B1 to B8 UPI | | | |
| R1/R2 monthly report | | | |

**Send back to the lead:** the table, `entries.json`, the screenshots of the messages quoted above, the Razorpay payment and refund ids, what you wrote for A5 about a changed order, and anything the phones showed that differs from the words quoted here.
