# Orders: what is not built

- **Nothing has run against a real WhatsApp, Razorpay or UPI account.** No shop is live on Orders. Every number in this folder is from stand-in services.
- **Native review.** The Hindi, Malayalam and Kannada messages, buttons, word lists, report words, sell guides and one-page sheets are machine-written. [REVIEW-hi.md](REVIEW-hi.md), [REVIEW-ml.md](REVIEW-ml.md) and [REVIEW-kn.md](REVIEW-kn.md) list the messages; the guides and sheets carry a banner. Needed before a real shop sees them.
- **Native review of `wait_over` (11 Nov).** The words a customer gets when the wait for a Guard runs out are machine-written in Hindi, Malayalam and Kannada; all three REVIEW sheets list them. Revisit when: a native reader is found (the same review as the rest).
- ~~**No stand-in server and no local stack** (Bookings and Fees have `standins/` and `scripts/local-stack.ts`), and no test of the relay against the real `geo-guard` binary. Add them when the first shop goes live.~~ Done 17 Nov: `standins/`, `scripts/local-stack.ts`, `test/full-chain.test.ts` and `test/approvals-guard-binary.test.ts` (written, not yet run).
- ~~**The balance at pickup or delivery.** Only the advance is tracked. The rest is paid in cash or by UPI at the door and the agent never learns whether it was.~~ Done 17 Nov: the balance is its own record, owner-marked (cash, UPI) or provider-confirmed by a link (see Explanation.md). What is left is below.
- **Fulfilment.** An order is completed when its slot ends. Whether the food was made, collected or delivered is not known. No delivery fee, no delivery tracking, no route.
- **Changing a confirmed order.** A customer cancels and orders again. There is no "make it 3 instead of 2". Trigger: a pilot shop whose customers ask to change a quantity. Done when: a confirmed order can be changed (stock, advance and slot checked again on the change, the difference refunded or asked for).
- **Customer confirmations as templates in every variant.** The owner's notices are WhatsApp templates; a customer's "Confirmed!" is a template only for a Razorpay pickup order that leaves something to pay. The others go as plain text inside the customer's 24-hour window, which is when they are sent, and as the generic name (which a provider that knows only approved templates refuses) outside it. Trigger: Meta approval of the order templates (needs the shop's WhatsApp business account). Done when: every customer message that goes out unasked is an approved template in the variants the settings can make.
- ~~**Reminders.** No reminder before the slot. The customer is told the day and the window when the order is confirmed.~~ Done 17 Nov (settings `reminder`).
- **Quantities in words.** One to ten in English and Hindi and one to five in Malayalam and Kannada. A bigger number is a digit. Latin-letter "do" is not read as two (it clashes with "can you do").
- **Items and day by the model.** The model reads the kind, the language and a price named; the items, quantities, day, slot and way come from the rules alone. A message the rules cannot read gets the menu list.
- **Several orders in one conversation.** The latest open order is the one answered; a second order replaces a held one, it is not added beside it. Trigger: a pilot shop whose customers order for two days at once. Done when: a second order is held beside the first and each is answered by its own reference.
- ~~**Per-slot capacity.** Stock is per item per day, and the limit is per day. A slot cannot be full on its own.~~ Done 17 Nov (settings `maxOrders` on a slot).
- **Part payments.** A Razorpay link is for the exact advance. A payment of another amount cannot happen on such a link; on UPI the owner's marks are added up and a part keeps the order held.
- **Tests and review of the sell guide wording by a person.** The tests scan for banned words and tie numbers to the hand check; a person has not read the Hindi, Malayalam and Kannada guides.

## Money clarity (14 Nov 2026): left open

- ~~**No "time ran out: did money come?" card for an Orders owner.** Built for Bookings (Explanation.md there). An Orders owner can still mark a late advance on WhatsApp with the code, and the order page has no "paid after the time ended?" either. It is the same ledger, so only the page's list and words are missing. Done when: an Orders shop has no WhatsApp.~~ Done 17 Nov (`late_deposit` on the owner's page and in the assistant).
- **"Extend the hold once" and the real-phone tries.** See templates/commerce/bookings/Deferred.md and modules/Deferred.md, "Money clarity".

## Left open after finishing Orders (17 Nov 2026)

- **The customer's new lines as Meta templates.** Only the reminder has templates. `slot_full`, `balance_paid` and `balance_link` answer or follow something the customer or the owner just did, so
  they go as plain text inside the window, and as the generic name outside it, which a provider that knows only approved templates refuses. Done when: the Meta approval for the order templates is
  in hand; then add them to `META_TEMPLATES` (the mechanism is shared) and regenerate `whatsapp-templates.json`.
- **The balance has no place in the books.** `ReceivedFor` (modules/accounting) is "advance", "fee" or "extra"; the balance is a record line the books do not read, so it is not in the receipts, the
  owner's Money section or the accountant's files. Trigger: the CA's reading of how cash taken at the door is documented (docs plans/next-phase.md section 7). Done when: the accounting module
  has a decision for it and `record_balance` posts through `books.post`.
- **The owner is not asked for the balance.** The agent does not remind the owner "₹120 to collect for o-3, send `balance o-3 cash`" at the slot's end; the owner says it when they take the money.
  Trigger: the first pilot owner who forgets it. Done when: the end of the slot asks once, with buttons.
- **The balance on the customer's page, and a part-paid balance.** The page does not show the balance link or a "balance received" state, and a payment on the balance's link that is not exactly
  the balance is not counted (the record says so; the owner looks in the payment account). Done when: a shop's customers use the page to pay the balance.
- **The owner's words when a balance link cannot be made** are the advance link's (`owner_link_failed`: "nothing is ordered"), which is wrong for a balance. Done when: a native-reviewed line is added.
- **The monthly WhatsApp report does not carry the balance.** The page and the text do; the message is an approved template whose body is fixed (`REPORT_SLOTS`). Done when: the report templates are next resubmitted to Meta.
- **The slot's limit is not shown with a number** ("3 left") in the list of slots; a full slot is only left out. Done when: a shop asks for it.
- **A customer's page order is not reminded on WhatsApp** (it has no number the agent may write to); its page shows the slot. Done when: the page takes web push for it (modules/push).
- **Real-phone and real-provider tries** of everything above: none. Every figure and message is from stand-ins.
- **Money that arrives on the balance link of an order cancelled meanwhile.** The link is closed when the owner or the customer cancels, and a payment on it afterwards is not counted and not refunded by the agent (the owner
  sees it in the payment account). Trigger: the first such payment in a pilot. Done when: the agent refunds a payment on a balance link whose order is cancelled, through the same Guard.


## Monthly plans (17 Nov 2026): left open

- **Automatic debit (UPI Autopay, a gateway's recurring mandate).** A renewal is a payment link the customer pays; nothing is ever charged by itself. Trigger: a pilot tiffin shop whose customers forget to renew and who accepts a mandate's setup and the provider's approval. Done when: a mandate is made with the customer's own consent, each charge is one record matched to its period, and it stops the moment the plan is cancelled.
- **Meal choices for a day** (veg or non-veg, a different item on a day). A plan is one meal on set weekdays in one slot. Trigger: a pilot shop that varies the meal. Done when: a day can carry a choice, the kitchen's count is split by it and the price rule is written.
- **A plan for N meals** (20 meals, not a month of weekdays) and **shop holidays** (a day the kitchen is closed, credited to everyone). Trigger: a pilot shop that sells by count or closes on festival days. Done when: the ledger can hold a period of N meals and a closed day turns every due meal that day into a credit once.
- **Subscribing, pausing and skipping on the order page, and a customer's plan page.** WhatsApp only: the page, the API and MCP (`modules/channels`) take one-off orders and are not touched by this stream. Trigger: a pilot customer without WhatsApp, or the shop's page owner asking. Done when: the page can start a plan, show the month with each day's state and take a skip or pause with the same cut-off, through the same ledger.
- **A month that is wholly paused is still asked for.** The days come back as credit, so a customer pays and is credited. Done when: a renewal is not asked for while every day of the next month is paused, and resuming asks for it.
- **The owner's own pause or skip for a customer, and the owner's card to refund a month-end credit.** The refund goes through the agent's refund path (Guard holds above the limit and asks the owner). Done when: the owner can skip or pause a customer's days from the chat or the page, and a month-end refund above the limit shows as a card.
- **A customer who changes the plan** (a different meal, a different slot) or **two plans for one customer.** A customer has one running plan; they cancel and start another. Done when: a change is one step with the difference asked for or credited.
- **The books for plans.** Applied-at-settlement (and at use, for credit carried) is the rule here; the CA's reading (docs plans/next-phase.md section 7) may want it earlier, and the accounting module's invariants were not extended for it. Done when: the accounting module knows a plan period as its own kind and the owner's Money section shows it.
- **Plans lines on the WhatsApp monthly report.** Only the report page has them; the WhatsApp message is an approved template with a fixed body. Done when: the Meta template is approved with the lines.
- **The three plan templates (`plan_renewal`, `plan_pause_done`, `plan_skip_done`) are not approved by Meta**, and the Hindi, Malayalam and Kannada words (messages, customer words, report lines) are not read by a native speaker. Done when: the approval and the review are in hand.
- **Delivery tracking, a handed-over check.** "Delivered" means the slot ended and the plan stood, as for orders (see the fulfilment row above), not that the meal was handed over.
- **Stock for orders that hold on a future day.** The shelf count is one number for the shop, not per day: an order for next week lowers it when it stands. A shop that makes fresh food each day uses the day's stock (`dailyStock`) and does not count the item. Done when: a shop asks for a count per day, with a decision on a cancelled order's day.
