# Pitch and sell the Bookings pathway: equipment rental

A variant for custom hiring centres and village equipment owners who rent a tractor and its attachments, a pump set or a tent by the half day or the day. Written 3 November 2026. **Read the main guide first ([guide.en.md](../guide.en.md)).** This page changes only what is different. The same variant exists in Hindi, Malayalam and Kannada. The shop owner never reads it.

Sections 2 (before you go), 9 (the first month) and 10 (when something goes wrong) are exactly as in the main guide. Section 7 is the main table plus the rows below. The one-page sheet is the main guide's; a rental sheet is not made yet.

The example shop is made up: Hosahalli Farm Hiring Centre, in `pathways/bookings/settings/equipment-rental.example.json`. It speaks Kannada and Hindi.

## 1. Is this a fit?

| A good fit | Not a fit (for now) |
| --- | --- |
| A hiring centre that rents out one tractor with its attachments (rotavator, sprayer, trolley) | A centre that rents out several machines at the same time: the helper books one thing at a time for the whole business |
| A village owner of one machine, rented by the half day or the day | Hire priced per acre or per hour used: each job here has one fixed price |
| Farmers who book by WhatsApp or phone today, and cancel late when it rains | A hire of several days in a row, or longer than 8 hours: one booking is one day at most |
| An owner who loses a day's work when a farmer doesn't turn up | A hire that needs a driver, a delivery or the field's place written down: the helper doesn't record them |
| An owner who is happy to type or read short messages | Farmers who only send voice notes: a voice note gets one short reply asking them to type; it is not listened to |

### Ask yourself

1. Is it one machine, with its attachments, that is rented out at one time?
2. Is each job a half day or a day, at a price the owner can name?
3. Does the owner lose work to no-shows and late cancellations, or want a deposit?

Three yes: go. Two yes: go, but carefully. If the first answer is no, start with the one machine that is booked most, or skip for now.

## 3. The first three sentences

Say them in the owner's language, slowly.

1. "Namaste, I'm [your name] from [village or town], and I help machine owners take bookings on WhatsApp."
2. "It books your tractor for a half day or a full day and takes a deposit, only inside rules you set, so it can't go below your price, and it asks you before giving a deposit back on a late cancellation."
3. "May I show you on your own phone, with test money, in 3 minutes?"

Then stop talking, as in the main guide. Don't open with "AI", with technology or with the price.

## 4. Show it on the owner's own phone

Set up the laptop and the phone as in section 4 of the main guide (same Wi-Fi, the address it prints, "Demo · test money · nothing real is sent"). Start the demo on the rental example, in the owner's language:

```sh
node pathways/bookings/demo/server.ts --settings pathways/bookings/settings/equipment-rental.example.json --lang kn  # Kannada (or hi)
```

The example speaks Kannada and Hindi. For a centre whose farmers write another language, tap "Set up for this shop" instead: the centre's name, the jobs in the farmers' own words with the owner's prices, the deposit, the opening hours and the language. It takes about 30 seconds.

| Step | You tap | The owner sees | You say |
| --- | --- | --- | --- |
| 1. A farmer books and pays a test deposit | On the "Customer" tab, tap the first suggestion (it asks for the rotavator half day tomorrow at 12pm). Then tap "Pay the ₹1,000 deposit (test money)". | The price, a free time and a deposit link held for 30 minutes. Then the confirmation, in the chat's language. On the "Owner" tab: "The booking it made is in your calendar. We checked." | "A farmer wrote on WhatsApp. It booked the tractor for that time and took the deposit." |
| 2. The farmer haggles | Tap "Start again". Tap the second suggestion (the same job, for ₹2130). | The real price, ₹3,200, and that it can't go lower. Then the deposit link at the real price. On the "Owner" tab: "It said no to ₹2,130. It never goes below your price." | "It can't go below your ₹3,200 price, even when a farmer pushes." |
| 3. A refund it can't give alone | Tap "Start again", the first suggestion and "Pay the ₹1,000 deposit (test money)". Tap "1 day passes". Tap "Cancel the booking". Open the "Owner" tab. | A question: "Give back ₹1,000?", the reason "Cancelled less than 24 hours before the start.", and the buttons "Approve" and "Deny". | "A cancellation this late is your decision, whether it was the rain or not. Nothing goes back until you tap." Let the owner tap "Approve". |
| 4. Show what we did | Open the "What we did" tab. Tap "Show what we did ▸". | Every action in a list, each marked "confirmed" when it was read back from the calendar or the payment record. | "Nothing is hidden. The monthly report is made from this record." |

**Good to know**

- In Kannada the demo's buttons, tabs and suggestions are in English, with the machine's name in Kannada. In Hindi everything is in Hindi. To see the chat in Kannada, type the farmer's message yourself: the Kannada variant gives the sentences.
- The example shop is open every day, so tomorrow is always open. "1 day passes" once is enough for step 3.
- Let the owner type as a farmer and try to talk it into a lower price. The demo has one customer, so it can't show two machines clashing: explain the one-thing-at-a-time rule in words (section 5).
- The prices are the example shop's unless you set the demo up for the centre. Use the owner's own prices when you can.
- The demo shows what happened in the demo. It is not a claim about a live shop.

## 5. Questions owners and farmers ask

The main guide's questions and answers stay as they are (mistakes, who sees the messages, Meta's free AI, your number, cost, if it stops, switching it off, who to call, "is this AI"). These come on top for rental. Keep to what is true.

### "What if it rains and the farmer cancels?"

> "If the farmer cancels at least 24 hours before, the deposit goes back by itself, up to your refund limit. If it is later, the helper asks you, and you decide, rain or not. It doesn't know the weather."

Never say it understands rain. The only rule is the time before the start.

### "I have more than one machine. Does it handle all of them?"

> "Not at the same time yet. It books one thing at a time for the whole business, so a booking for the sprayer blocks the tractor at that time. One tractor with its attachments works well. We start with the machine that is booked most."

Don't promise a helper for each machine until the founder says it is ready.

### "Can it charge by the acre or by the hour?"

> "No. Each job has one price, for a half day or a full day. It never goes below the price you set."

### "Does it send the driver, or know my field?"

> "No. It books the time and takes the deposit. The field, the driver and the diesel stay between you and the farmer, as now."

### "What if a farmer needs it for three days?"

> "One booking is one day, up to 8 hours. For three days the farmer books three days, one by one, or you handle it yourself."

### "What if the machine comes back damaged?"

> "The deposit is for holding the time. It is not cover for damage, and it doesn't track the machine or what happens to it. Your agreement with the farmer stays yours."

### "Many of my farmers send voice notes."

> "Right now it reads typed messages in Kannada, Hindi, Malayalam and English. A voice note gets one short reply asking the farmer to type; it does not listen to it. Ask farmers to type, or reply to them yourself."

### "How do farmers pay?"

> "The deposit is paid by UPI or card on a Razorpay link, straight to your account. The rest is paid to you as today. The helper doesn't record the rest."

## 6. Price

The three payments are as in section 6 of the main guide: Geometer's ₹199 per live shop per month, the shop's price to you, and the setup you keep. What is different:

1. **The shop's price: a starting point; you decide.** Near ₹999 for one machine, near ₹1,999 for a bigger centre. The setup is ₹1,999 to ₹2,999.
2. **Rental is seasonal.** Before you sign, agree with the owner whether the price is every month or only for the months the helper is on, and write it in the shop terms. Ask the founder how a paused shop is counted before you promise.
3. **One helper books one thing at a time.** For a centre with several machines, ask the founder how two helpers in one centre are counted before you quote.
4. **Razorpay's fee on a bigger deposit:** "Razorpay keeps its fee even when you give a deposit back. On a ₹1,000 deposit that is about ₹24." Check Razorpay's current page.
5. **Money flow only,** as in the main guide. Never say how much anyone will make.

## 7. Never say

Everything in the main table applies. Add these:

| Never say | Why | Say instead |
| --- | --- | --- |
| "It knows when it will rain." | It has no weather. A late cancellation goes to the owner. | "A cancellation less than 24 hours before is your decision." |
| "It handles all your machines." | It books one thing at a time for the whole business. | "It books your tractor and its attachments, one at a time." |
| "Your machine is safe with it." | It doesn't track the machine, the driver or the field. | "It takes a deposit and books the time. The rest stays between you and the farmer." |
| "No farmer will cancel on you." | Farmers can still cancel late. | "When a farmer cancels late, it asks you." |
| "It will bring you more farmers." | Nobody can say that. | "It answers on WhatsApp and books. The report shows what came in." |

## 8. The setup visit

Do the checklist in section 8 of the main guide (the WhatsApp check, the shared calendar, the shop's own Razorpay account, the number for approvals, the test booking, the certificate and the terms). For rental, add these:

- [ ] **One machine to start.** Choose the machine, with its attachments, that the helper will book. Each job is one service: "tractor with rotavator, half day", "tractor with rotavator, full day", "tractor with sprayer, half day", "tractor with trolley, full day".
- [ ] **Each job's name in the farmers' own words.** Ask what farmers really say, in each language. Every name must be different from every other. A farmer who writes only "tractor" gets the price list and is asked which job: add the short names farmers really use.
- [ ] **Hours and slots.** Opening hours, for example 6 am to 6 pm. Bookings start every 2 hours from midnight (6, 8, 10 ...). The longest job is 8 hours. A gap after each booking, for example an hour for the drive and the diesel.
- [ ] **One deposit for every job,** never more than the cheapest job. Hold it for 30 minutes, because farmers may need time to find their UPI app.
- [ ] **The reminder.** One reminder, 24 hours before, so it arrives at the same time of day as the booking. Reminders count hours before the start, so a 2-hour reminder for a 6 am booking would arrive at 4 am.
- [ ] **The rest of the payment.** Agree how the farmer pays the rest (cash or UPI, to the owner). The helper doesn't record it.
- [ ] **Run the check on this shop's own settings.** From the agents folder: `node pathways/bookings/scripts/hand-check.ts --settings <the shop's file>`. Read "Held N of M" aloud, and read the "NOT RUN" list if there is one.

  | Limit | Ask | Example (Hosahalli Farm Hiring Centre) |
  | --- | --- | --- |
  | Price list | "What is the lowest you will ever do each job for?" | "It can't go below your ₹3,200 price." |
  | Deposit | "How much to hold the machine?" | "₹1,000." |
  | Cancellation window | "How early must a farmer cancel to get the deposit back?" | "24 hours before. Later, you decide." |
  | Refund limit | "Up to how much may it give back without asking you?" | "Up to ₹1,000. Above that, it asks you." |

## 11. Be honest about what's true today

As of 3 November 2026 the rental example (a made-up centre) has been checked by hand on practice services with test money: 33 of 33 situations held, and the closed-day request was left out because the example is open every day. No hiring centre is live. It books one thing at a time for the whole business, a booking is one day at most (8 hours), prices are fixed per job, it doesn't record the field, the driver, the weather or the rest of the payment, and it does not listen to a voice note (it replies with one line asking the customer to type). Kannada and Hindi wording is machine-written and waits for a native speaker's review. Never say more than this.
