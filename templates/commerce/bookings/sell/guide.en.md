# Pitch and sell the Bookings template

For local partners (18 and over) and builders. Written 3 November 2026, in the pilot phase. The shop owner never reads this guide: they get the one-page sheet (`one-pager.en.html`) from you. The same guide exists in Hindi, Malayalam and Kannada. Use the language the owner speaks.

**Your part, in one line.** You are the person who looks after this service with its owner: you know the shop, you tune its rules, you fix things when they go wrong, you bring customers when the street asks, and you are the person the owner calls. Setup is only the first step, never the pitch. What lasts is your care and your judgment, not access to the tool.

```text
practise with a friend → a friendly shop → a stranger's shop → quote → first payment → first-month check-in → tuning and the monthly report, month after month
```

## 1. Is this shop a fit?

| A good fit | Not a fit (for now) |
| --- | --- |
| Salons with high-ticket bookings: bridal, makeup, spa | Walk-in-only shops |
| Studios (fitness, dance, photo) | Kiranas |
| Home services | Pharmacies |
| Anyone who takes bookings on WhatsApp and has no-shows, or wants deposits | Clinics (health data is the wrong place to learn first) |

Tuition and coaching centres: wait for the fee and dues template.

### Ask yourself

1. Do this shop's customers book a time, instead of just walking in?
2. Do they book on WhatsApp today?
3. Does the shop lose money to no-shows and late cancellations, or would the owner like to take a deposit?

Three yes: go. Two yes: go, but carefully. One or none: skip it. A polite skip is better than a pitch that fails.

## 2. Before you go

1. Practise with a friend who plays the owner. Do sections 3 and 5 out loud, three times.
2. Run the demo yourself, twice, start to finish (section 4).
3. Visit a friendly shop first. Ask your buddy, or Geometer's team, to come on the first visit.
4. Then visit a shop you don't know. A "no" is normal. Write down what they said.
5. Know your price before you walk in (section 6). Write it on a card.

Carry: your laptop (charged, demo tested on a phone), 3 printed one-page sheets with your name and number written in, the shop terms with your price filled in, and a pen.

The card "What to ask the shop for" (`sell/ask-card.en.md`) lists what to ask the owner for. Bring it.

## 3. The first three sentences

Say them in the owner's language, slowly.

1. "Hello, I'm [your name] from [town], and I help shops with bookings on WhatsApp, and I stay on afterwards to look after it with you."
2. "It's a booking helper: it books the time and takes the deposit, only inside rules you set, so it can't go below your prices."
3. "May I show you on your own phone, with test money, in 3 minutes?"

Then stop talking. If they say yes, go to section 4. If they say no, say "Thank you. May I leave this sheet with you?" and leave.

Don't open with "AI", with technology, or with the price. If they ask "Is this AI?", say yes (section 5).

Setup is the first step, so it is never the pitch. What you offer is that you stay and look after it with them: you know their shop, you tune its rules, you fix things when they go wrong, and you are the person they call.

## 4. Show it on the owner's own phone

**Before you go in.** On your laptop, in the agents folder:

```sh
node templates/commerce/bookings/demo/server.ts            # English
node templates/commerce/bookings/demo/server.ts --lang hi  # Hindi (also ml, kn)
```

It prints a line like `On a phone, same Wi-Fi:  http://192.168.1.23:8787`. Open that address on the owner's phone. Both devices need the same Wi-Fi. If the phone can't open it, turn on your phone's hotspot and join your laptop to it. The demo has no login: never open it to the internet.

Optional, 30 seconds: tap "Set up for this shop" and enter the shop's name, up to 4 services with the owner's own prices, the deposit and the opening hours. Do this before the visit if you have the price list.

**Say first:** "This is a practice copy. It uses test money. Nothing real is sent to anyone." Every screen says it too: "Demo · test money · nothing real is sent".

| Step | You tap | The owner sees | You say |
| --- | --- | --- | --- |
| 1. A customer books and pays a test deposit | On the "Customer" tab, tap the first suggestion ("I want a haircut tomorrow at 6pm"). Then tap "Pay the ₹200 deposit (test money)". | The price, a free time and a deposit link held for 15 minutes. Then "You're booked!". On the "Owner" tab: "The booking it made is in your calendar. We checked." | "A customer wrote on WhatsApp. It booked the time and took the deposit." |
| 2. The customer haggles | Tap "Start again". Tap the second suggestion ("haircut tomorrow at 6pm, can you do it for ₹300?"). | "Our haircut is ₹450. Sorry, I can't go lower than that." Then the deposit link at the real price. On the "Owner" tab: "It said no to ₹300. It never goes below your price." | "It can't go below your ₹450 price, even when a customer pushes." |
| 3. A refund it can't give alone | Tap "Start again", the first suggestion and "Pay the ₹200 deposit (test money)". Tap "1 day passes" (again, if the booking is still more than a day away). Tap "Cancel the booking". Open the "Owner" tab. | A question: "Give back ₹200?", the reason "Cancelled less than 24 hours before the start.", and the buttons "Approve" and "Deny". | "A cancellation this late is your decision, so it asks you. Nothing goes back until you tap." Let the owner tap "Approve". |
| 4. Show what we did | Open the "What we did" tab. Tap "Show what we did ▸". | Every action in a list (written for you, in English), each marked "confirmed" when it was read back from the calendar or the payment record. | "Nothing is hidden. The monthly report is made from this record." |

**Good to know**

- In Malayalam and Kannada the demo's buttons, tabs and suggestions are still in English, and so is the reply to "Cancel the booking". To see the chat in Malayalam or Kannada, type the customer's message yourself: the Malayalam and Kannada guides give the sentences.
- If the shop is closed tomorrow (Glow Salon is closed on Sunday, so on a Saturday), the suggestions pick the next open day. In Malayalam and Kannada, change "tomorrow" in the sentence you type to "the day after tomorrow" (നാളെ becomes മറ്റന്നാൾ, ನಾಳೆ becomes ನಾಡಿದ್ದು).
- For step 3 the booking must be less than 24 hours away. Look at the demo clock and the booking time in the chat, and tap "1 day passes" again if it is further away. On a Saturday it takes two taps.
- The refund question also appears when a refund is above the owner's refund limit. The demo shows the late cancellation because it is quick to show.
- The prices are Glow Salon's unless you set the demo up for the shop. Use the owner's own prices when you can.
- Let the owner type as a customer and try to talk it into a discount. That is the best part of the demo.
- The demo shows what happened in the demo. It is not a claim about a live shop. It always shows "We didn't check: phone calls · walk-ins."
- Stop it with Ctrl+C. Nothing is saved.

## 5. Questions owners ask

Answer in your own words, but keep to what is true. Where the answer is "it depends", say so. The answers describe a live shop; section 11 says what exists today.

### "What if it makes a mistake?"

> "It can make mistakes. That is why it works inside your limits, and why every month you see what it did, including its mistakes. If it gets something wrong, call me. We look at the record together and fix it."

Never say it won't make mistakes.

### "Who sees my customers' messages?"

> "Their messages go through WhatsApp and the WhatsApp service we use, like with any business WhatsApp tool. They stay with me and you. Geometer only receives counts and health signals, never the words of a message. A customer who writes STOP gets no more messages."

Name the service and where it runs when you know. Don't say that nobody can see them. You can.

### "Meta gives AI for free in WhatsApp. Why pay?"

> "Meta's free AI can answer and book. That is real, and for simple replies it may be enough. What it doesn't give you is these four things: limits you set, like 'it can't go below your ₹450 price' and 'it asks you before a refund'; deposits taken with the money visible; a report every month of what it did; and me, a person in [town] you can call. We work alongside it, not against it."

Don't run Meta's AI down. In November 2026 it replies, books and speaks Indian languages, and UPI was "coming soon". Check before each pitch: this changes.

### "Will I lose my WhatsApp number or my app?"

> "No. You keep your number and your WhatsApp Business app; the helper works next to them. But it depends on your account. I check it before I set up anything. If it can't keep your number and your app, we don't go ahead."

The facts behind "it depends":

- It must be the WhatsApp Business app, not plain WhatsApp.
- It needs a Facebook login with admin access to the shop's Meta business portfolio, which the owner uses themselves. Meta may later ask the shop to verify its business; which documents it accepts for a small shop is not confirmed.
- Open the app at least once every 2 weeks: after about 2 weeks without it, the connection drops. Uninstalling the app disconnects the number.
- Linked devices are unlinked and must be linked again. In one-to-one chats, disappearing messages, view-once and live location stop working, and broadcast lists become read-only.

### "What does it cost?"

> "It's [your monthly price] a month, and [your setup price] once for setting it up. WhatsApp's message fees are their own line on the bill, at cost. Nothing else. You can stop with one message."

Section 6 has the numbers.

### "What happens if it stops working?"

> "Your own WhatsApp keeps working as always, and you can answer customers yourself. The helper just stops answering until it is fixed. If it isn't sure, it sends nothing rather than guess. In the first week I check it myself every day, and you can call me any time."

When it is live there will be alerts to you. They are not built yet (section 11).

### "Can I switch it off?"

> "Yes, any time. Tell me with one message and I stop it. You can also disconnect it yourself from your phone: in the WhatsApp Business app, Settings, Account, Business Platform, Disconnect. The menu names can change. Your number and your chats stay."

### "Why pay every month once it is set up?"

> "Setup is only the first day. After that I look after it with you: I check in during the first month, I tune your rules when your shop changes, I fix things when they go wrong, I go through the monthly report with you, and I'm the person you call. That is what the monthly amount is for."

### "Who do I call?"

> "Me. My name and number are on this sheet. I look after it with you: I know your shop, and when something goes wrong I'm the one who sorts it out with you."

Answer your phone, and reply the same day.

### "Is this AI?"

> "Yes. It is an AI that only does bookings and deposits, inside your rules. It doesn't chat about anything else."

### "How do my customers pay me?"

> "By UPI, straight to your own UPI ID. The customer gets a QR picture and a pay link with the exact amount and the booking code. The money comes to you, not to us, and there is no gateway fee. When you see it in your UPI app, you tap "Received" on WhatsApp. Only then is the booking made."

Say this, word for word: "No booking without your confirmation; every refund tracked."

- A customer's screenshot is not proof. The helper tells them the owner will confirm.
- A hold that you never confirm is released when its time runs out.
- You send each refund from your own UPI app. The helper keeps the list of refunds owed and reminds you. It tells the customer "sent" only after you mark it done.
- A shop that has, or wants, its own Razorpay account can use Razorpay instead: it confirms by itself and refunds within your limit. The shop opens that account itself.

## 6. Price

Three payments, three different people. Keep them apart. The amounts are from Geometer's price list of 11 November 2026.

| Who pays | Who gets it | What for | Amount |
| --- | --- | --- | --- |
| You | Geometer | Each live shop, each month, before GST. Basic: no money moves. | ₹149 |
| You | Geometer | The same, Business: deposits, refunds and the monthly report | ₹299 |
| The shop | You | Looking after it each month, Basic (a starting point; you decide) | ₹499 to ₹699 |
| The shop | You | Looking after it each month, Business (a starting point; you decide) | ₹999 to ₹1,499 |
| The shop | You | Setup for Basic, once. You keep all of it. | ₹999 to ₹1,999 |
| The shop | You | Setup for Business, once. You keep all of it. | ₹1,999 to ₹2,999 |
| The shop, as its own line on your bill | WhatsApp, at cost, through your prepaid balance | Message fees | about ₹90 (Basic) or ₹295 (Business) per shop per month |

The monthly amount is the price of your care: the first-month check-in, the tuning, the fixes and the report. Setup is paid once; looking after it is what the shop keeps paying for.

1. **Geometer's plan: Basic ₹149 or Business ₹299 per live shop per month, before GST.** A shop counts for a month when it was live on 15 or more days. Basic holds bookings, reminders, prices and hours, no money moves, and includes 1,000 customer messages a month. Business adds deposits, refunds, the owner's OK on refunds above the limit and the monthly report, and includes 3,000 messages. A Bookings shop that takes a deposit is Business; one where no money moves is Basic. A shop with several workflows or branches is Operations, ₹999 a month with 10,000 messages: ask Geometer's support before you quote it. You pay nothing to join: no joining fee, no kit, no paid training. The plan starts when a shop goes live. A builder who runs it on their own server, with their own AI key and WhatsApp account, pays ₹199 a month for each live client business instead, whatever the plan. The first 100 builders and partners with a shop live get the Innovator badge and a vote on the next template: a badge, not a discount.
2. **Above the allowance, and WhatsApp.** Extra messages cost ₹49 for each 1,000, from your prepaid balance, and only with your yes; you get a warning at 80%. Or you move the shop up a plan. Meta's and the provider's WhatsApp charges are passed on at cost, from the same balance, and so is the payment fee when you top it up (2.36%). Geometer never handles the money of shops or their customers.
3. **Put WhatsApp on the shop's bill as its own line, at cost.** Charge your monthly service, and add WhatsApp's message fees as a separate line at what they cost you. A shop that sends more messages then pays for more, and your service price stays yours. WhatsApp platforms in India bill messages as a separate line too.
4. **The shop's price: a starting point; you decide.** For Basic, ₹499 to ₹699 a month and a setup of ₹999 to ₹1,999. For Business, ₹999 to ₹1,499 a month and a setup of ₹1,999 to ₹2,999. The setup is all yours. What you keep each month is your service price minus Geometer's plan; WhatsApp, on its own line, passes through at cost.
5. **Write the price down** in the shop terms (section 8). The terms say: no surprise charges, the shop can cancel with one message, no automatic debit unless the owner clearly agreed.
6. **When to take money:** until Geometer tells you your town is ready, don't take the setup fee or a first month. Ask the owner to sign a letter of intent: a short note that says "I will take this at this price when it is ready."
7. **Money flow only.** Say who pays whom, as above. Never say how much anyone will make, not even as an example. Geometer doesn't either.

## 7. Never say

| Never say | Why | Say instead |
| --- | --- | --- |
| "It's safe." | An owner can check a limit. Nobody can check a promise like that. | "It can't go below your ₹450 price." |
| "It's guaranteed." / "It never makes mistakes." | Mistakes can happen. | "Every month you see what it did, including mistakes." |
| "We take the risk." / "We'll cover any loss." | We don't pay for losses, as insurance would. | "It asks you before any refund over your limit." |
| "It's certified." | A certificate only states facts. | "Here is what we tried, what held, and what we did not check." |
| "Everything gets done." / "It never misses a booking." | "Done" is what the records show, within what was checked. | "Every booking it makes is checked against your booking record. And I'll show you what wasn't checked." |
| "It will pay for itself." | Nobody can promise that. | "Each month the report shows the deposits it took. You can judge." |
| "It's already working in many shops." | No shop is live yet. | "It has been tested on practice services. Your shop would be among the first." |
| "It's an AI chatbot, like ChatGPT." | WhatsApp doesn't allow general chatbots. This is a booking service. | "A booking helper that takes deposits, inside your rules." |
| "Meta's free AI is no good." | We don't know that, and we work alongside it. | "Meta's AI answers. We add your limits, deposits you can see, a report, and me." |
| "Nothing can go wrong with your WhatsApp." | It depends on the account. | "I check your WhatsApp first. If it can't keep your number and app, we don't go ahead." |
| "You'll make ₹X a month selling this." | Nobody can say how much anyone will make. | "The shop pays you, and you set your price." |
| "Introduce me to a friend and get a discount." | No rewards for introductions, ever. | "Would you introduce me to one shop owner you know?" |
| "The payment is checked automatically." | With UPI, nothing checks the payment for the owner. The owner sees the money in their own UPI app and taps "Received". | "No booking without your confirmation; every refund tracked." |

## 8. The setup visit

Take your laptop and the owner's phone. Go through the list in order, and tick each item with the owner.

**How the shop gets paid.** UPI is the default: customers pay the shop's own UPI ID, and the shop needs no gateway account. Ask the owner for the UPI ID and the name that shows on it. Type both carefully, then read them back to the owner. Nothing checks a UPI ID for you, so one wrong letter sends the money to someone else. Then show the owner the "Received" button on WhatsApp. Use Razorpay only if the shop has, or wants, its own account. Ask for what is on the card "What to ask the shop for" (`sell/ask-card.en.md`); it also says what not to promise.

- [ ] **The WhatsApp check.** Open the shop's WhatsApp with the owner.
  - It must be the WhatsApp Business app, and the shop keeps its number and its app.
  - WhatsApp needs a Facebook login with admin access to the shop's Meta business portfolio. The owner logs in themselves, on their own phone: you never see a password or a code.
  - The name WhatsApp shows must match what the shop calls itself in public (signboard, Google or Instagram page).
  - Meta may ask the shop to verify its business later. Which documents it accepts for a small shop is not confirmed, so don't promise that no papers will be needed.
  - Tell the owner: open the app at least once every 2 weeks, don't uninstall it, and link the other devices again afterwards.
- [ ] **Google Calendar, only if the shop wants it.** The shop does not need one: a Bookings shop with no Google Calendar runs on its own booking list. Choose that with `"calendar": {"module": "own"}` in the shop's settings.json; without that line, or with `"google"`, the shop uses Google Calendar. The owner sends "today" or "tomorrow" on WhatsApp to the shop's number and gets that day's bookings; the panel shows the counts. If the shop does want Google Calendar, share it together on your laptop, not the phone: the owner's Google Calendar, Settings and sharing, Share with specific people. Add the address Geometer gives you, with "Make changes to events". It takes about 2 minutes. A calendar can be added later without losing bookings: the future bookings already made are written to it.
- [ ] **The shop's own Razorpay account.** Only if the shop chooses Razorpay. Deposits go straight to the shop, never to you or Geometer. The owner makes the account on their own phone: you never see their password or code. It may need a website and policy pages (about, contact, pricing, terms, privacy, cancellation and refunds). Whether an Instagram page counts is not confirmed, so ask Razorpay. It takes minutes, or up to 4 working days. **Razorpay's fee** is written only here: about 2% plus GST on each deposit. Tell the shop: "Razorpay keeps its fee even when you give a deposit back. On a ₹200 deposit that is about ₹5." Check Razorpay's current page; if the shop's own agreement says otherwise, the agreement wins. Put the fee in the shop terms for this shop. On UPI there is no gateway fee.
- [ ] **The limits, in the owner's words.** Ask, write down, read back:

  | Limit | Ask | Example (Glow Salon) |
  | --- | --- | --- |
  | Price list | "What is the lowest you will ever do each service for?" | "It can't go below your ₹450 price." |
  | Opening hours | "When do you take bookings?" | "Weekdays: no bookings outside 10 am to 8 pm." |
  | Deposit | "How much to hold a booking?" | "₹200." |
  | Hold time | "How long do we keep a slot for the deposit?" | "15 minutes." |
  | Cancellation window | "How early must a customer cancel to get the deposit back?" | "24 hours before." |
  | Refund limit | "Up to how much may it give back without asking you?" | "Up to ₹200. Above that, it asks you." |

- [ ] **The owner's number for approvals.** This is the WhatsApp number where it asks "Give back ₹200?". The owner answers "approve b-1" or "deny b-1". Practise one together.
- [ ] **One test booking with test money.** From your own phone, book, pay a test deposit, see it in the owner's booking list (or in the calendar, if one is connected), then cancel. Nothing real is paid.
- [ ] **The go-live certificate, read together.** Read every line aloud in the owner's language, including "Not checked". It says the checks were run by hand on practice services, using this shop's own prices, hours and limits, and it lists what was not checked. If some checks could not be run on this shop's settings, it says so. Malayalam and Kannada: don't go live until a native speaker has reviewed the wording.
- [ ] **The shop terms, signed.** The price (monthly and setup), what the helper does and doesn't do, the limits, the WhatsApp message fees, whether the deposit is refundable or counts against the bill (the shop's accountant decides), cancel with one message, no surprise charges, your name and number. Both sign. Leave a copy and the one-page sheet. Signed paper is still what Geometer's checks assume. Later, Geometer may tell you that the terms can be agreed on WhatsApp instead; do that only after Geometer says so. A shop that chose Razorpay also has Razorpay's fee in its terms (see the Razorpay item).

## 9. The first month

1. **Week 1: check in.**
   - Be there, or on the phone, for the first real booking.
   - For 7 days, look at the record every day. You are the alert for now.
   - At the end of the week, ask: "Did it say anything you would not have said?" A limit gets wider only when the owner says so, and it is written down.
   - With UPI, a customer's screenshot is not proof. The helper tells them the owner will confirm; the owner taps "Received" after seeing the money in their own UPI app.
   - Check that refunds owed are being sent: the owner sends each one from their own UPI app and marks it done.
2. **End of the month: read the first report together.** It is 5 lines on WhatsApp, with a page behind it. Read every line, including the mistakes and "Not checked". If there is a mistake, you say it first.
3. **Ask for one introduction.** "Do you know another shop owner who takes bookings on WhatsApp? Would you introduce me?" Ask only after the owner has seen the report and is happy. Never offer a reward, a discount or a gift for it.
4. **Keep looking after it.** Every month: read the report together, ask what the owner would change, and tune the rules when they ask. A limit gets wider only when the owner says so, and it is written down. A shop that is still being looked after at month 3 is the real result.

## 10. When something goes wrong

1. **Stop the agent first.** In the pilot you stop it by hand, because the stop button is not built yet: learn how before your first visit. The owner can also disconnect it from their phone (section 5).
2. **Call the owner before they find out.** "Something went wrong with [what]. I have stopped the helper. Here is what happened and what I am doing. Your own WhatsApp works as normal."
3. **Look at the record.** Find the action, what was confirmed, and which limit said what. "Show what we did" shows it.
4. **Fix it, check it again, then switch it on.** If a customer was charged wrongly, sit with the owner while they refund it from their own Razorpay account. With UPI, the owner sends the refund from their own UPI app, and the helper tells the customer "sent" only after the owner marks it done.
5. **Put it in the report.** It goes in the month's mistakes, and you tell Geometer's support the same day.

You are the person the owner calls, and the shop's named, accountable person. Your name is on the report and the certificate. Putting it right with them is part of looking after it. Don't blame the software, and don't say "it won't happen again".

## 11. Be honest about what's true today

As of 3 November 2026 the agent has been built and checked by hand on practice services with test money. It has not yet run on a real WhatsApp, Razorpay or Google Calendar account, and no shop is live: the first shops are planned for early 2027, town by town, and Geometer tells you when yours is ready. The limits run inside the agent, not yet in a separate guard. The stop button, the alerts to you and the page where anyone can check a certificate are not built yet, and some warnings may not reach an owner who hasn't written to the number that day, so check the record yourself. Hindi, Malayalam and Kannada wording is machine-written: Malayalam and Kannada wait for a native speaker's review before any real shop uses them, and in those two languages the demo's buttons are still in English. Never say more than this. UPI is built as a payment option: the owner marks each payment paid and sends each refund. It is not checked automatically, and it has not run in a live shop.

<!-- Made by prices/render.ts from guide.en.src.md and the price list in force. Edit that file, then run: node prices/render.ts -->
