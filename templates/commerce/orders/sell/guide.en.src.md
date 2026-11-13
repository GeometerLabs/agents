# Pitch and sell the Orders template

For local partners (18 and over) and builders. Written 8 November 2026, in the pilot phase. The shop owner never reads this guide: they get the one-page sheet (`one-pager.en.html`) from you. The same guide exists in Hindi, Malayalam and Kannada. Use the language the owner speaks.

**Read section 11 first.** Orders is not live in any shop yet, and it has no phone demo. Today you can explain it, show a printed walkthrough on your laptop, and ask for a letter of intent. You cannot promise a start date.

**Your part, in one line.** You are the person who looks after this service with its owner: you know the shop, you tune its rules, you fix things when they go wrong, you bring customers when the street asks, and you are the person the owner calls. Setup is only the first step, never the pitch. What lasts is your care and your judgment, not access to the tool.

```text
practise with a friend → a friendly shop → a stranger's shop → letter of intent → (when your town is ready) setup → first-month check-in → tuning and the monthly report, month after month
```

**What Orders does, in one breath.** A customer writes on WhatsApp what they want, for which day and which slot, pickup or delivery. The helper works out the total and asks for an advance. The order is confirmed only when the advance is on record. With UPI, that means the owner has seen the money in their own UPI app and tapped "Received". The helper keeps to the menu price, the day's stock, the day's order limit and the cut-off time, and a refund goes through the owner. It speaks Hindi, English, Malayalam or Kannada.

**The one claim you may make about money,** word for word: "No order confirmed without the payment record (or your confirmation for UPI); every refund tracked."

## 1. Is this shop a fit?

| A good fit | Not a fit (for now) |
| --- | --- |
| Tiffin and meal services that take orders a day ahead | A shop that only sells over the counter, with nothing to pre-order |
| Bakeries and sweet shops with cakes and festival boxes to order | A shop that does not want to take an advance |
| Caterers with small and medium orders | A shop with no WhatsApp number |
| Home kitchens with a daily menu and a daily limit | An owner who wants the bot to give discounts: the helper never goes below the menu price |

Salons, studios and shops that take appointments: use the Bookings guide. Tuition and class fees: use the Fees guide.

### Ask yourself

1. Does the shop make a limited amount each day, and take orders ahead for a day and a slot?
2. Can the shop take an advance, by its own UPI ID or by a Razorpay account?
3. Does the owner lose time or food to no-shows, last-minute calls and orders they cannot make?

Three yes: go. Two yes: go, but carefully. One or none: skip it. A polite skip is better than a pitch that fails.

## 2. Before you go

1. Practise with a friend who plays the owner. Do sections 3 and 5 out loud, three times.
2. Run the walkthrough yourself, twice, start to finish (section 4): once in English and once in the owner's language.
3. Visit a friendly shop first. Ask your buddy, or Geometer's team, to come on the first visit.
4. Then visit a shop you don't know. A "no" is normal. Write down what they said.
5. Know your price before you walk in (section 6). Write it on a card.

Carry: your laptop (charged, walkthrough tested), 3 printed one-page sheets with your name and number written in, the shop terms with your price filled in, a letter of intent, and a pen.

The card "What to ask the shop for" (`sell/ask-card.en.md`) lists what to ask the owner for. Bring it.

## 3. The first three sentences

Say them in the owner's language, slowly.

1. "Hello, I'm [your name] from [town], and I help tiffin services, bakeries and caterers take pre-orders on WhatsApp with an advance, and I stay on afterwards to look after it with you."
2. "It's an order helper: a customer picks the item, the day and the slot and pays the advance, and the order is confirmed only when the advance is on record, never below your price and never more than you can make."
3. "May I show you on my laptop, with test money, in 3 minutes?"

Then stop talking. If they say yes, go to section 4. If they say no, say "Thank you. May I leave this sheet with you?" and leave.

Don't open with "AI", with technology, or with the price. If they ask "Is this AI?", say yes (section 5).

Setup is the first step, so it is never the pitch. What you offer is that you stay and look after it with them: you know their shop, you tune its rules, you fix things when they go wrong, and you are the person they call.

## 4. Show it to the owner

Orders has no phone demo yet (Bookings has one). What you show today is a printed conversation, on your laptop: one customer's order at Annapurna Tiffins, a made-up tiffin service that takes UPI, run on stand-in services with test money. Nothing real is sent to anyone.

**Before you go in.** On your laptop, in the agents folder, run it twice: once in English, and once in the owner's language.

```sh
node templates/commerce/orders/scripts/walkthrough.ts --lang en
node templates/commerce/orders/scripts/walkthrough.ts --lang hi  # Hindi (also ml, kn)
```

It prints five numbered steps. Read them to the owner, or turn the laptop towards them and scroll. Each step is what the customer, the helper and the owner really wrote; none of it is typed in advance.

**Say first:** "This is a practice run. It uses test money. Nothing real is sent to anyone." The printout says the same on its first line: "Stand-in services and test money: nothing real is sent."

1. **An order for tomorrow's lunch.** The helper works out the total and the advance, holds the stock for 30 minutes, and tells the owner what to look for in their UPI app.

```text
   Customer: 2 veg thali 10 nov 12:00 pm pickup
   Agent to the customer: 2 × veg thali for Tue 10 Nov, 12:00 pm to 1:00 pm, pickup. Total ₹240. To confirm, pay ₹120 here: upi://pay?pa=annapurna@okicici&pn=Annapurna%20Tiffins&am=120.00&tn=o-1&cu=INR (UPI ID annapurna@okicici, Annapurna Tiffins) (I'll hold your order for 30 minutes.) The owner confirms the payment, then I'll message you.
   Agent to the owner: UPI payment to check: customer +919844444444 will pay the ₹120 advance for order o-1 (2 × veg thali, Tue 10 Nov, 12:00 pm to 1:00 pm). When it shows in your UPI app, tap Received or reply "received UX4W8X". If a different amount came, reply "received UX4W8X" and the amount.
```

> "Nobody typed this. The customer wrote the item, the day and the slot, and the helper worked out ₹240 and asked for ₹120 in advance. The stock is held, not sold yet."

2. **"I have paid", and the owner has marked nothing.** The helper does not take the customer's word for it.

```text
   Customer: I have paid
   Agent to the customer: Thank you. The owner will look for your ₹120 payment in their UPI app and confirm it, then I'll message you. A screenshot is not proof of payment, so please wait for that message.
   Agent to the owner: Customer +919844444444 says they have paid the ₹120 advance for order o-1. A screenshot is not proof: check your UPI app. When it is there, tap Received or reply "received UX4W8X".
```

> "Paid means you saw the money in your UPI app. A message or a screenshot confirms nothing."

3. **The owner marks the advance received.** Only then is the order confirmed, and the owner is told what to prepare.

```text
   Owner: received UX4W8X
   Agent to the customer: Confirmed! 2 × veg thali for Tue 10 Nov, 12:00 pm to 1:00 pm, pickup. The owner has confirmed your advance of ₹120. ₹120 is to pay on pickup. Cancel at least 6 hours before the start for a refund.
   Agent to the owner: New order o-1 from +919844444444: 2 × veg thali for Tue 10 Nov, 12:00 pm to 1:00 pm, pickup. Total ₹240, advance ₹120 paid, ₹120 to collect. Nothing more to do now.
   Agent to the owner: Thank you. ₹120 for order o-1 is marked paid by you.
```

> "You saw ₹120 in your UPI app and tapped Received. Now it is confirmed. The code in the reply changes every time."

4. **A second customer asks for a lower price.** The helper does not go below the menu price.

```text
   Customer: 2 veg thali 10 nov 12:00 pm pickup ₹90
   Agent to the customer: Our veg thali is ₹120, and I can't go lower than that. 2 × veg thali for Tue 10 Nov, 12:00 pm to 1:00 pm, pickup. Total ₹240. To confirm, pay ₹120 here: upi://pay?pa=annapurna@okicici&pn=Annapurna%20Tiffins&am=120.00&tn=o-2&cu=INR (UPI ID annapurna@okicici, Annapurna Tiffins) (I'll hold your order for 30 minutes.) The owner confirms the payment, then I'll message you.
   Agent to the owner: UPI payment to check: customer +919833333333 will pay the ₹120 advance for order o-2 (2 × veg thali, Tue 10 Nov, 12:00 pm to 1:00 pm). When it shows in your UPI app, tap Received or reply "received 3KWS4Z". If a different amount came, reply "received 3KWS4Z" and the amount.
```

> "The veg thali is ₹120. Nobody can talk it down, and a clever sentence changes nothing."

5. **The first customer cancels in time.** The advance is owed back. The helper never sends money: the owner sends it from their own UPI app and taps "Refund sent", and only then is the customer told.

```text
   Customer: cancel my order
   Agent to the customer: Your order for Tue 10 Nov, 12:00 pm to 1:00 pm is cancelled. The owner will send your ₹120 back to you by UPI, and I'll message you when they mark it sent.
   Agent to the owner: Customer +919844444444 cancelled order o-1: 2 × veg thali for Tue 10 Nov, 12:00 pm to 1:00 pm. Please do not prepare it.
   Agent to the owner: Refund to send: customer +919844444444 (order o-1) is owed ₹120 by UPI. The agent never sends money. After you send it, tap Refund sent or reply "refunded CGHC7T".
   Owner: refunded CGHC7T
   Agent to the customer: The owner has marked your ₹120 refund for order o-1 as sent by UPI. Please check your UPI app.
   Agent to the owner: Thank you. The ₹120 refund for order o-1 is marked sent, and the customer has been told.
```

> "Every refund is on a list until you mark it sent. A cancellation too late for a refund comes to you to say yes or no, and so does a refund above your limit."

**Good to know**

- The code in the owner's reply ("received" and "refunded", then six letters and digits) is different on every run, so yours will not match the one above. Nothing else differs.
- In Hindi, Malayalam and Kannada the customer's lines, and the helper's lines to the customer, are in that language. The owner's lines stay in English, because the example shop's owner reads English. At a real shop they come in the owner's own language.
- The example file for Annapurna Tiffins lists English and Hindi. The walkthrough adds Malayalam and Kannada names for the three items so you can show it in all four.
- The printout shows what happened in a run on stand-in services. It is not a claim about a live shop, and it does not cover the rest of the price paid at pickup, or whether the food was made and delivered (section 11).
- Nothing is saved. Run it again any time.

## 5. Questions owners ask

Answer in your own words, but keep to what is true. Where the answer is "it depends", say so. The answers describe a live shop; section 11 says what exists today.

### "What if it makes a mistake?"

> "It can make mistakes. That is why it works inside your limits, and why you can see what it did, including its mistakes. If it gets something wrong, call me. We look at the record together and fix it."

Never say it won't make mistakes.

### "Who sees my customers' messages?"

> "Their messages go through WhatsApp and the WhatsApp service we use, like with any business WhatsApp tool. They stay with me and you. Geometer only receives counts and health signals, never the words of a message. A customer who writes STOP gets no more messages."

Name the service and where it runs when you know. Don't say that nobody can see them. You can.

### "Meta gives AI for free in WhatsApp. Why pay?"

> "Meta's free AI can answer questions. That is real, and for simple replies it may be enough. What it doesn't give you is these four things: limits you set, like 'never below your ₹120 price' and 'never more than the day's stock'; an advance on record before any order is confirmed; a list of every refund owed; and me, a person in [town] you can call. We work alongside it, not against it."

Don't run Meta's AI down. What it can do changes: check before each pitch.

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

### "What if it stops working?"

> "Your own WhatsApp keeps working as always, and you can message customers yourself. The helper just stops until it is fixed. If the AI that reads customers' messages is down, it answers with buttons instead, every limit still holds, and you are told. In the first week I check it myself every day, and you can call me any time."

There is no live system yet, so there are no live alerts either (section 11).

### "Can I switch it off?"

> "Yes, any time. Tell me with one message and I stop it. You can also disconnect it yourself from your phone: in the WhatsApp Business app, Settings, Account, Business Platform, Disconnect. The menu names can change. Your number and your chats stay."

### "Why pay every month once it is set up?"

> "Setup is only the first day. After that I look after it with you: I check in during the first month, I tune your rules when your shop changes, I fix things when they go wrong, I go through the monthly report with you, and I'm the person you call. That is what the monthly amount is for."

### "Who do I call?"

> "Me. My name and number are on this sheet. I look after it with you: I know your shop, and when something goes wrong I'm the one who sorts it out with you."

Answer your phone, and reply the same day. If you are stuck, the help line is: "Write to support. A person answers."

### "What if a customer says they paid and did not?"

> "It does not take their word, and a screenshot is not proof. It tells the customer that you will look in your UPI app, it asks you to look, and it confirms nothing until you tap Received. With Razorpay it looks at Razorpay's own record instead."

### "Can it give a lower price?"

> "No. It never quotes or agrees to less than your menu price, and asking again, or asking cleverly, changes nothing. A price you want to change, you change in the settings, with me."

### "Can it take more orders than I can make?"

> "No. You set the most of each item you make in a day, and the most orders you take in a day. It counts what is held for customers who have not paid yet as well, and it refuses the next order, politely, once the stock or the day's limit is reached. A held order that is not paid in time frees its stock again."

### "What about the cut-off?"

> "You set when orders close, for example 20:00 the evening before, or 09:00 the same morning for lunch. After that time it takes no new order for that slot, and a hold never lasts past it."

### "What if a customer cancels?"

> "Up to the cancellation time you set, for example 6 hours before the slot, the advance is owed back, never more than was paid. Later than that, it asks you, and you reply 'approve o-1' to refund or 'deny o-1' to keep it. The helper never sends money: you send each refund yourself, and it keeps the list and reminds you."

### "What happens to a customer who writes STOP?"

> "STOP ends all messages to that customer: confirmations, reminders, everything. It tells you that the customer wrote STOP. Their order is still their order, so you speak to them yourself."

### "How do customers pay by UPI?"

> "Straight to your own UPI ID. The customer gets a pay link with the exact advance and the order reference. The money comes to you, not to us, and there is no gateway fee. When you see it in your UPI app, you tap "Received" on WhatsApp. Only then is the order confirmed."

Say this, word for word: "No order confirmed without the payment record (or your confirmation for UPI); every refund tracked."

- A customer's screenshot is not proof. The helper tells them the owner will confirm, and confirms nothing.
- A shop that has, or wants, its own Razorpay account can use Razorpay instead: the helper then reads Razorpay's own record and refunds within your limit; above the limit, the refund waits for you. The shop opens that account itself.

### "What about the rest of the price?"

> "The advance is what the helper tracks. The rest you collect at pickup or delivery, as you do today, in cash or by UPI. The helper tells the customer how much is left to pay and tells you the same."

If the shop wants the whole price taken online, set the advance to the full amount.

### "Is this AI?"

> "Yes. An AI helps it understand what a customer wrote, but the messages it sends are fixed wording, with every amount, day and slot taken from the record. It only does orders, inside your rules. It doesn't chat about anything else."

## 6. Price

Three payments, three different people. Keep them apart. The amounts are from Geometer's price list of {{date}}.

| Who pays | Who gets it | What for | Amount |
| --- | --- | --- | --- |
| You | Geometer | Each live shop, each month | {{plan.business.fee}} |
| The shop | You | Looking after it each month (a starting point; you decide) | {{guide.business.shop-min}} to {{guide.business.shop-max}} |
| The shop | You | Setup, once. You keep all of it. | {{guide.business.setup-min}} to {{guide.business.setup-max}} |
| The shop, as its own line on your bill | WhatsApp, at cost | Message fees | about {{guide.business.whatsapp}} per shop per month |

The monthly amount is the price of your care: the first-month check-in, the tuning, the fixes and the report. Setup is paid once; looking after it is what the shop keeps paying for.

1. **Geometer's fee: {{plan.business.fee}} per live shop per month, before GST.** Orders takes an advance, so it is on the Business plan, with {{plan.business.allowance}} messages a month included. Extra messages are {{overage.extra}} for each 1,000, paid from your prepaid balance, and never charged without your yes. WhatsApp's own message fees are passed on at cost, and so is the payment fee when you top up the balance. A builder who runs it on their own server, with their own AI key and WhatsApp account, pays {{licence.builder.fee}} a month for each live client business instead. The first {{innovator.places}} builders and partners with a shop live get the Innovator badge: a badge, not a discount. A shop counts for a month when it was live on 15 or more days. You pay nothing to join: no joining fee, no kit, no paid training. The fee starts when a shop goes live.
2. **The shop's price: a starting point; you decide.** The table gives the range. The setup is {{guide.business.setup-min}} to {{guide.business.setup-max}}, and you keep all of it. Put WhatsApp on the shop's bill as its own line, at cost: a shop that sends more messages then pays for more, and your service price stays yours.
3. **Write the price down** in the shop terms (section 8). The terms say: no surprise charges, the shop can cancel with one message, no automatic debit unless the owner clearly agreed.
4. **Nothing else to pay.** WhatsApp's message fees are at cost. You pay for nothing else to use Orders. A shop that chooses Razorpay opens and pays for its own Razorpay account: see the Razorpay item in section 8.
5. **When to take money:** Orders is not live anywhere, so do not take a setup fee or a first month, and do not give a start date. Ask the owner to sign a letter of intent: a short note that says "I will take this at this price when it is ready."
6. **Money flow only.** Say who pays whom, as above. Never say how much anyone will make or how much a shop will take in, not even as an example. Geometer doesn't either.

## 7. Never say

| Never say | Why | Say instead |
| --- | --- | --- |
| "It's safe." | An owner can check a limit. Nobody can check a promise like that. | "It can't go below your ₹120 price." |
| "It's guaranteed." / "It never makes mistakes." | Mistakes can happen. | "You can see what it did, including mistakes." |
| "We take the risk." / "We'll cover any loss." | We don't pay for losses, as insurance would. | "A refund goes through you, and the agent never sends money." |
| "It's certified." | A certificate only states facts. | "Here is what we tried, what held, and what we did not check." |
| "Customers will pay on time." / "You'll never lose an order." | Nobody can promise what a customer does. | "An order is confirmed only after the advance is on record." |
| "It will pay for itself." / "You'll fill every slot." | Nobody can promise that. | "You decide your price and your limits. You can judge for yourself." |
| "No more no-shows." | An advance helps, but a customer can still not turn up. | "With an advance on record, a missed order is not a free one." |
| "It's already working in many shops." / "It's live." | No shop is live yet. | "It has been tested on stand-in services. Your shop would be among the first." |
| "It's an AI chatbot, like ChatGPT." | WhatsApp doesn't allow general chatbots. This is an order service. | "An order helper that takes the advance and keeps to your menu, stock and cut-off." |
| "Meta's free AI is no good." | We don't know that, and we work alongside it. | "Meta's AI answers. We add your limits, an advance on record, a list of refunds, and me." |
| "It checks the UPI payment automatically." | With UPI, nothing checks the payment for the owner. The owner sees the money in their own UPI app and taps "Received". | "No order confirmed without the payment record (or your confirmation for UPI); every refund tracked." |
| "It handles the whole payment, cash too." | Only the advance is tracked. The rest is collected by the shop. | "It takes the advance. You collect the rest at pickup or delivery." |
| "It knows when the food is ready or delivered." | It does not. An order is completed when its slot ends. | "It tells you what to prepare and when." |
| "It will be running by [date]." | Meta approves the messages, the payment account needs setting up, and no real shop has been through the go-live checks yet. | "I can't promise a date. I'll tell you when it is ready." |
| "You'll make ₹X a month selling this." | Nobody can say how much anyone will make. | "The shop pays you, and you set your price." |
| "Introduce me to a friend and get a discount." | No rewards for introductions, ever. | "Would you introduce me to one shop owner you know?" |

## 8. The setup visit

Take your laptop and the owner's phone. Go through the list in order, and tick each item with the owner. No real Orders shop has gone live yet (section 11), so this is the visit as it will be, for you to learn. Until Geometer tells you your town is ready, do not start it: show the walkthrough, ask for the letter of intent, and promise no date. Ask for what is on the card "What to ask the shop for" (`sell/ask-card.en.md`); it also says what not to promise.

- [ ] **How the shop gets paid.** UPI is the default: customers pay the shop's own UPI ID, and the shop needs no gateway account.
  - Ask the owner for the UPI ID and the name that shows on it. Type both carefully, then read them back to the owner. Nothing checks a UPI ID for you, so one wrong letter sends the money to someone else.
  - Show the owner the "Received" button on WhatsApp.
  - Use Razorpay only if the shop has, or wants, its own account (see "The shop's own Razorpay account" below).
- [ ] **The WhatsApp check.** Open the shop's WhatsApp with the owner.
  - It must be the WhatsApp Business app, and the shop keeps its number and its app.
  - WhatsApp needs a Facebook login with admin access to the shop's Meta business portfolio. The owner logs in themselves, on their own phone: you never see a password or a code.
  - The name WhatsApp shows must match what the shop calls itself in public (signboard, Google or Instagram page).
  - Meta may ask the shop to verify its business later. Which documents it accepts for a small shop is not confirmed, so don't promise that no papers will be needed.
  - Tell the owner: open the app at least once every 2 weeks, don't uninstall it, and link the other devices again afterwards.
- [ ] **Meta's approval of the messages.** Every confirmation and every notice to the owner that goes out after the customer's 24-hour window is a message wording that Meta must approve first. The list is in `templates/commerce/orders/whatsapp-templates.json`, in all four languages. Approval can take days, and Meta can ask for changes. Say so, and give no date.
- [ ] **The shop's own Razorpay account.** Only if the shop chooses Razorpay. Payments go straight to the shop, never to you or Geometer. The owner makes the account on their own phone: you never see their password or code. The helper then needs access to the account: a Razorpay key ID, a key secret and a webhook secret, made by the owner in the Razorpay dashboard. Never write them in a chat or on paper. The account may need a website and policy pages. Whether an Instagram page counts is not confirmed, so ask Razorpay. It takes the time Razorpay takes: minutes, or up to 4 working days in the cases we know of. **Razorpay's fee** is written only here: about {{razorpay.platform-fee}} plus GST on each payment. Tell the shop: "Razorpay keeps its fee even when you give a payment back." Check Razorpay's current page; if the shop's own agreement says otherwise, the agreement wins. Put the fee in the shop terms for this shop. On UPI there is no gateway fee.
- [ ] **The menu, the stock and the prices.** For each item: the names customers use in each language (Hindi, English, Malayalam or Kannada), the price in whole rupees, and the most the kitchen makes in a day. The price is also the lowest the helper will ever agree to. Ask the owner to read the list back.
- [ ] **The times, the limits and the rules, in the owner's words.** Ask, write down, read back:

  | What | Ask | Example (Annapurna Tiffins) |
  | --- | --- | --- |
  | Menu and prices | "What do you sell, and at what price?" | "Veg thali ₹120, chicken meal ₹160, curd ₹20." |
  | Daily stock | "What is the most you make of each in a day?" | "12 veg thalis, 8 chicken meals and 30 curd cups a day." |
  | Cut-off | "When do orders close?" | "20:00 the evening before. For lunch, 09:00 the same day. For dinner, 15:00 the same day." |
  | Slots | "When can customers collect or get it delivered?" | "Pickup: lunch 12:00 to 13:00, dinner 19:00 to 20:00. Delivery: lunch 12:30 to 13:30, dinner 19:30 to 20:30." |
  | Delivery area | "Which places do you deliver to?" | "Kakkanad, Edappally, Infopark." |
  | Advance | "How much must a customer pay to confirm? All, or a part?" | "Half (50%), and the order is held for 30 minutes." |
  | Day's limits | "How many orders a day, and how many items in one order?" | "At most 8 orders a day and 10 items in one order." |
  | Cancellation | "Until when can a customer cancel for a refund?" | "Up to 6 hours before the slot. Later, you decide." |
  | Refund limit | "Above what amount must a refund wait for you?" | "₹300. A refund is never more than the advance paid." |
  | Approval line | "Above what order total do you want to say yes first?" | "₹1,000. Above that, the order waits for you before any payment is asked." |

- [ ] **The owner's number for approvals.** This is the WhatsApp number where the helper asks "Approval needed" and tells the owner about new orders. For a big order or a late cancellation the owner replies "approve o-1" or "deny o-1". With UPI, the owner replies "received" and the code, or taps "Received", then "Refund sent". Practise one of each together. For a refund above the refund limit on a Razorpay shop, the approvals relay asks the owner and takes a one-use code. It is built, but it has only been tried on stand-in services (section 11).
- [ ] **The checks on this shop's settings.** Copy `templates/commerce/orders/settings/annapurna-tiffins.example.json`, put in the shop's numbers from the list above, and run `node templates/commerce/orders/scripts/hand-check.ts --settings <your file>` (ask Geometer's team if you are unsure). A check that these settings can't express, for example an address outside the delivery area for a shop that does not deliver, is named as not run and is not counted. Read the result with the owner, including the "Not tested" line. Then make the go-live certificate with `node templates/commerce/orders/scripts/go-live-certificate.ts --settings <your file> --lang <en, hi, ml or kn> --out <folder>`. It says what was tried, on which settings, and what was not checked. Read every line aloud in the owner's language, including "Not checked".
- [ ] **The shop terms, signed.** The price (monthly and setup), what the helper does and doesn't do, the limits, WhatsApp's message fees, cancel with one message, no surprise charges, your name and number. Both sign. Leave a copy and the one-page sheet. Malayalam and Kannada wording waits for a native speaker's review: do not use it with a real shop until then. Signed paper is still what Geometer's checks assume. Later, Geometer may tell you that the terms can be agreed on WhatsApp instead; do that only after Geometer says so. A shop that chose Razorpay also has Razorpay's fee in its terms (see the Razorpay item).

## 9. The first month

When a shop is live:

1. **Week 1: check in.**
   - Be there, or on the phone, when the first orders come in.
   - For 7 days, go through the owner's WhatsApp messages from the helper every day: each new order, each "Approval needed", each refund to send. You are the alert for now.
   - At the end of the week, ask: "Did it say anything to a customer that you would not have said?" A limit gets wider only when the owner says so, and it is written down.
   - With UPI, a customer's screenshot is not proof. The owner taps "Received" after seeing the money in their own UPI app.
   - Check that refunds owed are being sent: the owner sends each one from their own UPI app and marks it sent.
2. **On the 1st: read the first monthly report together.** It comes to the owner on WhatsApp, with a page behind it. Read every line: Advance marked paid by owner, To collect at pickup, Refunds marked sent by owner; Orders taken, Cancelled; You were asked, You approved, You said no; Stopped by your limits; and Not checked. Include the mistakes. If there is a mistake, you say it first.
3. **Ask for one introduction.** "Do you know another shop owner who takes pre-orders? Would you introduce me?" Ask only after the owner has seen the month and is happy. Never offer a reward, a discount or a gift for it.
4. **Keep looking after it.** Every month: read the report together, ask what the owner would change, and tune the rules when they ask. A limit gets wider only when the owner says so, and it is written down. A shop that is still being looked after at month 3 is the real result.

## 10. When something goes wrong

1. **Stop the agent first.** Ask Geometer's team to stop it: "Write to support. A person answers." The owner can also disconnect it from their phone (section 5). Nothing more goes out once the server has stopped it, which can take a minute.
2. **Call the owner before they find out.** "Something went wrong with [what]. I have stopped the helper. Here is what happened and what I am doing. Your own WhatsApp works as normal."
3. **Look at the record.** Find the action, what was confirmed, and which limit said what.
4. **Fix it, check it again, then switch it on.** If a customer paid and was not confirmed, or was confirmed and should not have been, sit with the owner and put it right with the customer first. If a refund is owed, the owner sends it from their own UPI app, and the helper tells the customer "sent" only after the owner marks it done.
5. **Put it in the month's mistakes,** and tell Geometer's team the same day.

You are the person the owner calls, and the shop's named, accountable person. Your name is on the terms. Putting it right with them is part of looking after it. Don't blame the software, and don't say "it won't happen again".

## 11. Be honest about what's true today

As of 8 November 2026 the Orders agent and its checks run against stand-in services (stand-in WhatsApp, UPI marks and Razorpay), not real ones. On the Annapurna Tiffins example settings (UPI) the hand check holds 17 of 17 situations (82 checks), with 14 listed as not tested and 2 not run on those settings; on the same shop with Razorpay it holds 18 of 18 (89 checks), with 1 not run on those settings. It is a count of those situations, not a verdict on the agent. No shop is live. You can show the walkthrough on a laptop, but there is no phone demo yet. The monthly report and the go-live certificate are built and have been tried only on stand-in services. The approvals relay, the Meta message list and the panel set-up for Orders are built and have been tried only on stand-in services, never against a real Guard, WhatsApp or Meta account; Meta still has to approve the wording. Hindi, Malayalam and Kannada wording is machine-written and waits for a native speaker's review. What the hand check does not cover, in plain words (14 lines apply to a UPI shop and 14 to a Razorpay shop; the payment lines differ):

- the rest of the price, paid at pickup or delivery (only the advance is tracked)
- whether the food was made, collected or delivered (an order is completed when its slot ends)
- changing a confirmed order (a customer cancels and orders again)
- for Razorpay, payments outside Razorpay
- real WhatsApp
- for Razorpay, real Razorpay, test mode or live
- webhook signatures
- a real model (the rules and stand-in models were run, and messages are fixed wording only)
- Tamil, Telugu and other languages
- a native speaker's review of the Hindi, Malayalam and Kannada wording
- a crash or restart in the middle of a step
- two customers taking the last portion at the exact same instant
- quantities written in words other than one to ten in English and Hindi, and the Malayalam and Kannada words for one to five
- faults beyond the ones listed above
- for UPI, automatic payment checking: it does not apply, because the owner marks each payment
- for UPI, a real UPI app paying a real UPI ID: the owner's marks were tried, not a payment

So: promise no start date, take no setup fee or first month (use the letter of intent), and say plainly "it is not live anywhere yet". Never say more than this.
