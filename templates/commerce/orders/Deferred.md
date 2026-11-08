# Orders: what is not built

- **Nothing has run against a real WhatsApp, Razorpay or UPI account.** No shop is live on Orders. Every number in this folder is from stand-in services.
- **Native review.** The Hindi, Malayalam and Kannada messages, buttons, word lists, report words, sell guides and one-page sheets are machine-written. [REVIEW-hi.md](REVIEW-hi.md), [REVIEW-ml.md](REVIEW-ml.md) and [REVIEW-kn.md](REVIEW-kn.md) list the messages; the guides and sheets carry a banner. Needed before a real shop sees them.
- **No stand-in server and no local stack** (Bookings and Fees have `standins/` and `scripts/local-stack.ts`), and no test of the relay against the real `geo-guard` binary. Add them when the first shop goes live.
- **The balance at pickup or delivery.** Only the advance is tracked. The rest is paid in cash or by UPI at the door and the agent never learns whether it was.
- **Fulfilment.** An order is completed when its slot ends. Whether the food was made, collected or delivered is not known. No delivery fee, no delivery tracking, no route.
- **Changing a confirmed order.** A customer cancels and orders again. There is no "make it 3 instead of 2".
- **Customer confirmations as templates in every variant.** The owner's notices are WhatsApp templates; a customer's "Confirmed!" is a template only for a Razorpay pickup order that leaves something to pay. The others go as plain text inside the customer's 24-hour window, which is when they are sent, and as the generic name (which a provider that knows only approved templates refuses) outside it.
- **Reminders.** No reminder before the slot. The customer is told the day and the window when the order is confirmed.
- **Quantities in words.** One to ten in English and Hindi and one to five in Malayalam and Kannada. A bigger number is a digit. Latin-letter "do" is not read as two (it clashes with "can you do").
- **Items and day by the model.** The model reads the kind, the language and a price named; the items, quantities, day, slot and way come from the rules alone. A message the rules cannot read gets the menu list.
- **Several orders in one conversation.** The latest open order is the one answered; a second order replaces a held one, it is not added beside it.
- **Per-slot capacity.** Stock is per item per day, and the limit is per day. A slot cannot be full on its own.
- **Part payments.** A Razorpay link is for the exact advance. A payment of another amount cannot happen on such a link; on UPI the owner's marks are added up and a part keeps the order held.
- **Tests and review of the sell guide wording by a person.** The tests scan for banned words and tie numbers to the hand check; a person has not read the Hindi, Malayalam and Kannada guides.
