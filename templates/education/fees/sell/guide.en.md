# Pitch and sell the Fees template

For local partners (18 and over) and builders. Written 5 November 2026, in the pilot phase. The centre owner never reads this guide: they get the one-page sheet (`one-pager.en.html`) from you. The same guide exists in Hindi, Malayalam and Kannada. Use the language the owner speaks.

**Read section 11 first.** Fees is not live in any centre yet, and it has no phone demo. Today you can explain it, show a printed walkthrough on your laptop, and ask for a letter of intent. You cannot promise a start date.

```text
practise with a friend → a friendly centre → a stranger's centre → letter of intent → (when your town is ready) setup → still paying at month 3
```

**What Fees does, in one breath.** Each month, on WhatsApp, it sends every parent a fee reminder with a Razorpay payment link, in the parent's own language: Hindi, English, Malayalam or Kannada. It is built so that a fee the payment record shows paid gets no reminder: paid is judged from Razorpay's own record, never from what a parent says. Part payments, a late fee, discounts and refunds all work inside limits the owner sets. On the 1st the owner gets a monthly report on WhatsApp.

## 1. Is this centre a fit?

| A good fit | Not a fit (for now) |
| --- | --- |
| Tuition and coaching centres | A centre that collects only cash or only bank transfer: Fees does not see those payments. UPI works: the owner marks each fee paid |
| Music, dance, drawing and sports classes | A centre that charges annual or per-term fees only |
| Hobby schools | A centre with no WhatsApp number |
| Small private schools with monthly fees collected from parents by a payment link | An owner who wants a bot that grants discounts: the agent will not grant what the owner has not allowed |

Salons, studios and shops that take bookings: use the Bookings guide.

### Ask yourself

1. Does the centre charge a monthly fee that parents pay, or could pay, by a payment link?
2. Does the centre have a WhatsApp number that parents already know?
3. Does the owner spend time every month chasing fees, or lose track of who has paid?

Three yes: go. Two yes: go, but carefully. One or none: skip it. A polite skip is better than a pitch that fails.

## 2. Before you go

1. Practise with a friend who plays the owner. Do sections 3 and 5 out loud, three times.
2. Run the walkthrough yourself, twice, start to finish (section 4): once in English and once in the owner's language.
3. Visit a friendly centre first. Ask your buddy, or Geometer's team, to come on the first visit.
4. Then visit a centre you don't know. A "no" is normal. Write down what they said.
5. Know your price before you walk in (section 6). Write it on a card.

Carry: your laptop (charged, walkthrough tested), 3 printed one-page sheets with your name and number written in, the shop terms with your price filled in, a letter of intent, and a pen.

## 3. The first three sentences

Say them in the owner's language, slowly.

1. "Hello, I'm [your name] from [town], and I help tuition centres collect their monthly fees on WhatsApp."
2. "It's a fee helper: each month it sends every parent a reminder with a payment link in their own language, and a fee that the payment record shows paid gets no more reminders."
3. "May I show you on my laptop, with test money, in 3 minutes?"

Then stop talking. If they say yes, go to section 4. If they say no, say "Thank you. May I leave this sheet with you?" and leave.

Don't open with "AI", with technology, or with the price. If they ask "Is this AI?", say yes (section 5).

## 4. Show it to the owner

Fees has no phone demo yet (Bookings has one). What you show today is a printed conversation, on your laptop: one parent's month at Bright Tuition Centre, run on stand-in services with test money. Nothing real is sent to anyone.

**Before you go in.** On your laptop, in the agents folder, run it twice: once in English, and once in the owner's language.

```sh
node templates/education/fees/scripts/walkthrough.ts --lang en
node templates/education/fees/scripts/walkthrough.ts --lang hi  # Hindi (also ml, kn)
```

It prints five numbered steps. Read them to the owner, or turn the laptop towards them and scroll. Each step is what the parent, the agent and the owner really wrote; none of it is typed in advance.

**Say first:** "This is a practice run. It uses test money. Nothing real is sent to anyone." The printout says the same on its first line: "Stand-in services and test money: nothing real is sent."

1. **The first reminder goes out on its own,** in the parent's language, with a payment link for exactly this fee.

```text
Agent to the parent: Fee reminder from Bright Tuition Centre. Rohan Mehta's class 10 fee for Nov 2026 is ₹1,800, due on Thu 5 Nov. Pay here: https://rzp.io/l/plink5 Reply STOP if you do not want these reminders.
```

> "Nobody sent this. It went out on the reminder day you choose, with a link for exactly this fee."

2. **"I already paid", and the record shows nothing.** The agent does not take the parent's word for it.

```text
Parent: I already paid the fee
Agent to the parent: We cannot see a payment yet for Rohan Mehta's class 10 fee for Nov 2026. If you paid just now, it can take a few minutes to show. I have asked the owner to check. If it did not go through, you can pay here: https://rzp.io/l/plink5
Agent to the owner: Parent +919844444444 says they paid Rohan Mehta's class 10 fee for Nov 2026 (₹1,800), but the payment record shows ₹0. Please check and message them.
```

> "Paid means Razorpay's record says paid. It says what it can see, it tells you, and it marks nothing paid."

3. **A discount request above your limit.** The parent asks for ₹300 off; the example centre's limit is ₹100. The owner is asked, approves that exact amount, and the parent gets a new link for the new amount.

```text
Parent: Please take ₹300 off the fee
Agent to the parent: I cannot change the fee myself. I have asked the owner about taking ₹300 off Rohan Mehta's fee for Nov 2026. You will hear back here.
Agent to the owner: Approval needed: +919844444444 asks to take ₹300 off Rohan Mehta's class 10 fee for Nov 2026. The fee is ₹1,800 and ₹1,800 is to pay now. Reply "approve q-1" or "deny q-1".
Owner: approve q-1
Agent to the parent: Done. ₹300 is taken off Rohan Mehta's fee for Nov 2026. ₹1,500 is now to pay: https://rzp.io/l/plink6
```

> "Up to your limit it can take money off by itself and tell you. Above it, it asks you, and you reply 'approve q-1'."

4. **The parent pays, and gets a receipt.** The agent reads the payment from the payments service's own record, and only then sends the receipt.

```text
Agent to the parent: Thank you! Bright Tuition Centre has received ₹1,500 for Rohan Mehta's class 10 fee for Nov 2026. Nothing more is due. Your receipt number is f-5.
```

> "The money went to your own Razorpay account. The receipt came after Razorpay's record showed it."

5. **No reminder once paid.** The due day, the grace days and the later reminder days all pass.

```text
(nothing is sent)
```

> "The reminder days after the payment passed. Nothing was sent, because the record shows this fee paid."

**Good to know**

- The walkthrough shows a different child in each language, so the names, amounts, link numbers and receipt numbers on your screen differ from the ones above. Nothing else differs.
- In Hindi, Malayalam and Kannada the parent's lines, and the agent's lines to the parent, are in that language. The owner's lines stay in English, because the example centre's owner reads English. At a real centre they come in the owner's own language.
- The printout shows what happened in a run on stand-in services. It is not a claim about a live centre, and it does not cover cash, bank transfer or UPI payments (section 11).
- Nothing is saved. Run it again any time.

## 5. Questions owners ask

Answer in your own words, but keep to what is true. Where the answer is "it depends", say so. The answers describe a live centre; section 11 says what exists today.

### "What if it makes a mistake?"

> "It can make mistakes. That is why it works inside your limits, and why every month you see what it did, including its mistakes. If it gets something wrong, call me. We look at the record together and fix it."

Never say it won't make mistakes.

### "Who sees my parents' messages?"

> "Their messages go through WhatsApp and the WhatsApp service we use, like with any business WhatsApp tool. They stay with me and you. Geometer only receives counts and health signals, never the words of a message. A parent who writes STOP gets no more messages."

Name the service and where it runs when you know. Don't say that nobody can see them. You can.

### "Meta gives AI for free in WhatsApp. Why pay?"

> "Meta's free AI can answer questions. That is real, and for simple replies it may be enough. What it doesn't give you is these four things: limits you set, like 'it takes off no more than your ₹100 limit' and 'a refund a parent asks for goes to you first'; a payment record it checks before every reminder; a report every month of what it did; and me, a person in [town] you can call. We work alongside it, not against it."

Don't run Meta's AI down. What it can do changes: check before each pitch.

### "Will I lose my WhatsApp number or my app?"

> "No. You keep your number and your WhatsApp Business app; the helper works next to them. But it depends on your account. I check it before I set up anything. If it can't keep your number and your app, we don't go ahead."

The facts behind "it depends":

- It must be the WhatsApp Business app, not plain WhatsApp.
- The account may need to be some months old. Some providers ask for about 3 months of real use.
- Open the app at least once a week: after about 2 weeks without it, the connection drops. Uninstalling the app disconnects the number.
- Linked devices are unlinked and must be linked again. In one-to-one chats, disappearing messages, view-once and live location stop working, and broadcast lists become read-only.

### "What does it cost?"

> "It's [your monthly price] a month, and [your setup price] once for setting it up. Razorpay takes its own fee, about 2% plus GST, on each payment. WhatsApp's message fees are small, at cost. Nothing else. You can stop with one message."

Section 6 has the numbers.

### "What happens if it stops working?"

> "Your own WhatsApp keeps working as always, and you can message parents yourself. The helper just stops until it is fixed. If the AI that reads parents' messages is down, it answers with buttons instead, every limit still holds, and you are told. In the first week I check it myself every day, and you can call me any time."

There is no live system yet, so there are no live alerts either (section 11).

### "Can I switch it off?"

> "Yes, any time. Tell me with one message and I stop it. You can also disconnect it yourself from your phone: in the WhatsApp Business app, Settings, Account, Business Platform, Disconnect. The menu names can change. Your number and your chats stay."

### "Who do I call?"

> "Me. My name and number are on this sheet. I set it up, so I'm the one who answers for it."

Answer your phone, and reply the same day.

### "What if a parent paid in cash?"

> "Cash and bank transfers are not handled yet. The agent reads only Razorpay's record, so it can't see them. If a parent says they paid that way, it says it cannot see a payment, tells you, and marks nothing paid. The fee stays open, so reminders can carry on until you sort it out with the parent."

If most of the centre's fees are cash, it is not a fit yet (section 1).

### "What if a parent says they paid and did not?"

> "It does not take their word. It looks at Razorpay's record. If the record shows nothing, it tells the parent what it can see, that a payment can take a few minutes to show, and gives the payment link again. It tells you, and it marks nothing paid."

### "Can it give discounts by itself?"

> "Only inside the limit you set. In the example centre that is ₹100 in total for one child in one month, and it tells you when it does. Above that, it asks you. You reply 'approve q-1' for that exact amount, and the parent gets a new link for the new amount. If you set the limit to zero, it takes nothing off by itself."

A parent who pushes does not move the limit.

### "Can parents get money back?"

> "A parent can ask. It never passes on a request for more than the payment on record, and there is one refund per payment. A refund within your refund limit goes to you to decide. Above the limit, ₹500 in the example centre, Guard holds it, and you approve it with a one-use code. If a parent pays the same fee twice, the extra is given back once, within the refund limit, and you are told."

### "What happens to a parent who writes STOP?"

> "STOP ends all messages to that parent: reminders, notices, everything. It tells you that the parent wrote STOP, and it adds no late fee for that parent. The fee is still owed, so you speak to that parent yourself."

### "Does it chase parents who have paid?"

> "It is built not to. A fee that Razorpay's record shows paid gets no reminder. You can see that in step 5 of the walkthrough."

A payment made another way (cash, bank transfer) is not in that record (section 11).

### "Is this AI?"

> "Yes. An AI helps it understand what a parent wrote, but the messages it sends are fixed wording, with every amount and date taken from the record. It only does fees, inside your rules. It doesn't chat about anything else."

### "How do parents pay by UPI?"

> "Straight to your own UPI ID. The parent gets a QR picture and a pay link with the exact amount and the fee code. The money comes to you, not to us, and there is no gateway fee. When you see it in your UPI app, you tap "Received" on WhatsApp. Only then is the fee marked paid."

Say this, word for word: "No fee marked paid without your confirmation; every refund tracked."

- A parent's screenshot is not proof. The helper tells them the owner will confirm, and marks nothing paid.
- You send each refund from your own UPI app. The helper keeps the list of refunds owed and reminds you. It tells the parent "sent" only after you mark it done.
- A centre that has, or wants, its own Razorpay account can use Razorpay instead: the helper then reads Razorpay's own record and refunds within your limit. The centre opens that account itself. Razorpay's fee applies only then.

## 6. Price

Three payments, three different people. Keep them apart.

| Who pays | Who gets it | What for | Amount |
| --- | --- | --- | --- |
| You | Geometer | Each live centre, each month | ₹299 |
| The centre | You | The monthly service (a starting point; you decide) | ₹999 to ₹1,499 |
| The centre | You | Setup, once. You keep all of it. | ₹1,999 to ₹2,999 |
| The centre | Razorpay | A fee on each payment | about 2% plus GST (only if the centre chooses Razorpay) |
| As you agree with the centre | WhatsApp, at cost | Message fees | about ₹100 to ₹300 per centre per month |

1. **Geometer's fee: ₹299 per live centre per month.** Fees is in the Business plan, with 3,000 messages a month included. The first 100 innovators (builders and partners) pay ₹179, which is 40% off, locked for as long as they stay, for up to 25 centres each, and they get an Innovator badge. Extra messages are ₹49 for each 1,000, paid from your prepaid balance, and never charged without your yes. WhatsApp's own message fees are passed on at cost. A builder who runs it on their own server pays half the plan price. A centre counts for a month when it was live on 15 or more days. You pay nothing to join: no joining fee, no kit, no paid training. The fee starts when a centre goes live.
2. **The centre's price: a starting point; you decide.** The table gives the range. The setup is ₹1,999 to ₹2,999, and you keep all of it.
3. **Write the price down** in the shop terms (section 8). The terms say: no surprise charges, the centre can cancel with one message, no automatic debit unless the owner clearly agreed.
4. **Tell the centre about Razorpay's fee:** "Razorpay keeps its fee even when you give a payment back. On a ₹1,200 fee that is about ₹28." Check Razorpay's current page; if the centre's own agreement says otherwise, the agreement wins. The centre opens and pays for its own Razorpay account, and WhatsApp's message fees are at cost. You pay for nothing else to use Fees. This applies only if the centre chooses Razorpay: on UPI there is no gateway fee.
5. **When to take money:** Fees is not live anywhere, so do not take a setup fee or a first month, and do not give a start date. Ask the owner to sign a letter of intent: a short note that says "I will take this at this price when it is ready."
6. **Money flow only.** Say who pays whom, as above. Never say how much anyone will make or how much a centre will collect, not even as an example. Geometer doesn't either.

## 7. Never say

| Never say | Why | Say instead |
| --- | --- | --- |
| "It's safe." | An owner can check a limit. Nobody can check a promise like that. | "It can't take off more than your ₹100 limit without asking you." |
| "It's guaranteed." / "It never makes mistakes." | Mistakes can happen. | "Every month you see what it did, including mistakes." |
| "We take the risk." / "We'll cover any loss." | We don't pay for losses, as insurance would. | "A refund a parent asks for goes to you first." |
| "It's certified." | A certificate only states facts. | "Here is what we tried, what held, and what we did not check." |
| "Parents will pay on time." / "You'll get your fees in." | Nobody can promise what a parent does. A reminder is not a payment. | "It sends each parent a reminder with a payment link. The report shows what was collected." |
| "It will pay for itself." / "You'll recover what you're owed." | Nobody can promise that. | "Each month the report shows what was collected. You can judge." |
| "It never chases anyone who has paid." | It goes by Razorpay's record. A payment made another way is not in it. | "A fee that Razorpay's record shows paid gets no reminder. Cash is not handled yet." |
| "It's already working in many centres." / "It's live." | No centre is live yet. | "It has been tested on stand-in services. Your centre would be among the first." |
| "It's an AI chatbot, like ChatGPT." | WhatsApp doesn't allow general chatbots. This is a fee service. | "A fee helper that sends reminders with a payment link, inside your rules." |
| "Meta's free AI is no good." | We don't know that, and we work alongside it. | "Meta's AI answers. We add your limits, a payment record checked before every reminder, a report, and me." |
| "It handles cash and bank transfers too." | Only payments through Razorpay are read, and a UPI fee is marked paid by the owner. Cash and bank transfers are not handled. | "Fees reads Razorpay's record. With UPI, you mark each fee paid. Cash and bank transfers are not handled yet." |
| "It will be running by [date]." | Meta approves the messages, Razorpay activates the account, and no real centre has been through the go-live checks yet. | "I can't promise a date. I'll tell you when it is ready." |
| "You'll make ₹X a month selling this." | Nobody can say how much anyone will make. | "The centre pays you, and you set your price." |
| "Introduce me to a friend and get a discount." | No rewards for introductions, ever. | "Would you introduce me to one centre owner you know?" |
| "The payment is checked automatically." | With UPI, nothing checks the payment for the owner. The owner sees the money in their own UPI app and taps "Received". | "No fee marked paid without your confirmation; every refund tracked." |

## 8. The setup visit

Take your laptop and the owner's phone. Go through the list in order, and tick each item with the owner. No real Fees centre has gone live yet (section 11), so this is the visit as it will be, for you to learn. Until Geometer tells you your town is ready, do not start it: show the walkthrough, ask for the letter of intent, and promise no date. When your town is ready, the panel's Set up page does the same list on a phone, in five steps.

**How the centre gets paid.** UPI is the default: parents pay the centre's own UPI ID, and the centre needs no gateway account. Ask the owner for the UPI ID and the name that shows on it. Type both carefully, then read them back to the owner. Nothing checks a UPI ID for you, so one wrong letter sends the money to someone else. Then show the owner the "Received" button on WhatsApp. Use Razorpay only if the centre has, or wants, its own account.

- [ ] **The WhatsApp check.** Open the centre's WhatsApp with the owner.
  - It must be the WhatsApp Business app, and the centre keeps its number and its app.
  - Ask how old the account is. If it is too new, the helper can't connect yet: agree a date to check again, and take no money.
  - Tell the owner: open the app at least once a week, don't uninstall it, and link the other devices again afterwards.
- [ ] **Meta's approval of the messages.** Every reminder and every notice to the owner goes out as a message wording that Meta must approve first. The list is in `templates/education/fees/whatsapp-templates.json`, in all four languages. Approval can take days, and Meta can ask for changes. Say so, and give no date.
- [ ] **The centre's own Razorpay account.** Only if the centre chooses Razorpay. Payments go straight to the centre, never to you or Geometer. The owner makes the account on their own phone: you never see their password or code. The helper then needs access to the account: a Razorpay key ID, a key secret and a webhook secret, made by the owner in the Razorpay dashboard. Never write them in a chat or on paper. The account may need a website and policy pages (about, contact, pricing, terms, privacy, cancellation and refunds). Whether an Instagram page counts is not confirmed, so ask Razorpay. It takes the time Razorpay takes: minutes, or up to 4 working days in the cases we know of.
- [ ] **The students and their parents.** For each child: the name, the class, the parent's WhatsApp number and the parent's language (Hindi, English, Malayalam or Kannada). Ask the owner to read the list back. The list is the owner's: don't keep a copy on your own phone.
- [ ] **The fees and the limits, in the owner's words.** Ask, write down, read back:

  | What | Ask | Example (Bright Tuition Centre) |
  | --- | --- | --- |
  | Fee for each class | "What is the monthly fee for each class?" | "₹1,200, ₹1,500 and ₹1,800." |
  | Due day | "On which day of the month is the fee due?" | "The 5th." |
  | Grace days | "For how many days after that is a payment still on time?" | "5 days." |
  | Late fee | "Do you add a late fee? How much?" | "₹100, after the grace days. None for a parent who sent STOP." |
  | Reminder days | "When should parents be reminded?" | "3 days before, on the due day, and 5 and 10 days after, at 10:00. At most 4 a month." |
  | Part payments | "May a parent pay part of the fee? From how much?" | "Yes, from ₹300." |
  | Waiver limit | "How much may it take off by itself for one child in one month?" | "Up to ₹100 in total. Above that, it asks you." |
  | Refund limit | "From which amount do you want a one-use code before a refund goes?" | "₹500. A refund is never more than the payment on record." |

- [ ] **The owner's number for approvals.** This is the WhatsApp number where it asks "Approval needed". The owner answers "approve q-1" or "deny q-1". For a refund above the refund limit the reply uses a one-use code instead of q-1. Practise one reply together. For a refund above the refund limit, the one-use code comes from the approvals relay. It has been tried against the real Guard program, but not on a live centre (section 11). A fee waiver above the waiver limit is not held that way: the agent asks with the same "approve q-1" reply.
- [ ] **The checks on this centre's settings.** Copy `templates/education/fees/settings/bright-tuition.example.json`, put in the centre's numbers from the list above, and run `node templates/education/fees/scripts/hand-check.ts --settings <your file>` (ask Geometer's team if you are unsure). A check that these settings can't express, for example a late fee when the centre has none, is named as not run and is not counted.
- [ ] **The go-live certificate, read together.** The panel makes it when the checks pass. A builder can also make it with `node templates/education/fees/scripts/go-live-certificate.ts`. It says what was tried, on which settings, and what was not checked. Read every line aloud in the owner's language, including "Not checked". Malayalam and Kannada: don't go live until a native speaker has reviewed the wording.
- [ ] **The shop terms, signed.** The price (monthly and setup), what the helper does and doesn't do, the limits, Razorpay's fee, WhatsApp's message fees, cancel with one message, no surprise charges, your name and number. Both sign. Leave a copy and the one-page sheet. On UPI there is no gateway fee; Razorpay's fee applies only if the centre chooses Razorpay.

## 9. The first month

When a centre is live:

1. **Week 1: check in.**
   - Be there, or on the phone, when the first reminders go out.
   - For 7 days, look at the record every day. You are the alert for now.
   - At the end of the week, ask: "Did it say anything to a parent that you would not have said?" A limit gets wider only when the owner says so, and it is written down.
   - With UPI, a parent's screenshot is not proof. The helper tells them the owner will confirm; the owner taps "Received" after seeing the money in their own UPI app.
   - Check that refunds owed are being sent: the owner sends each one from their own UPI app and marks it done.
2. **On the 1st: read the first monthly report together.** It comes to the owner on WhatsApp, with a page behind it. Read every line: Collected, Still to collect, Given back; Reminders sent, Taken off fees; You were asked, You approved, You said no; Stopped by your limits; and Not checked. Include the mistakes. If there is a mistake, you say it first.
3. **Ask for one introduction.** "Do you know another centre owner who collects monthly fees from parents? Would you introduce me?" Ask only after the owner has seen the report and is happy. Never offer a reward, a discount or a gift for it.
4. **Keep checking in.** A centre that is still paying at month 3 is the real result.

## 10. When something goes wrong

1. **Stop the agent first.** In the panel, open the centre and press the stop button. Nothing more goes out once the server has stopped it, which can take a minute. Ask Geometer's team how it works before your first visit. The owner can also disconnect it from their phone (section 5).
2. **Call the owner before they find out.** "Something went wrong with [what]. I have stopped the helper. Here is what happened and what I am doing. Your own WhatsApp works as normal."
3. **Look at the record.** Find the action, what was confirmed, and which limit said what. The monthly report is made from this record.
4. **Fix it, check it again, then switch it on.** If a parent was charged wrongly, sit with the owner while they refund it from their own Razorpay account. If a parent got a reminder they should not have, the owner says sorry to them first. With UPI, the owner sends the refund from their own UPI app, and the helper tells the parent "sent" only after the owner marks it done.
5. **Put it in the report.** It goes in the month's mistakes, and you tell Geometer's team the same day.

You are the centre's named, accountable person. Your name is on the report and the certificate. Don't blame the software, and don't say "it won't happen again".

## 11. Be honest about what's true today

As of 5 November 2026 the Fees agent and its checks run against stand-in services (stand-in WhatsApp and Razorpay), not real ones. The hand check holds 26 of 26 situations (209 checks), with 12 listed as not tested; on the Gauss Maths Circle example settings it holds 23 of 23, with 3 not run on those settings. It is a count of those situations, not a verdict on the agent. No centre is live. You can show the walkthrough on a laptop, but there is no phone demo yet. Payments by cash or bank transfer are not handled: a parent who says so is sent to the owner and nothing is marked paid. UPI is built as a payment option: the owner marks each fee paid and sends each refund. It is not checked automatically, and it has not run in a live centre. The walkthrough was run with Razorpay; the hand check was run on a Razorpay centre and on a UPI centre. Since 7 November 2026 the Fees agent can run as a live service on the server, with the approvals relay and a go-live certificate, and the panel sets a centre up in five steps. These have been tried only against stand-in services, and the approval against the real Guard program; none has run with a real WhatsApp number or a real Razorpay account. So: promise no start date, take no setup fee or first month (use the letter of intent), and say plainly "it is not live anywhere yet". Hindi, Malayalam and Kannada wording is machine-written: REVIEW-ml.md and REVIEW-kn.md list every line for a native reader, and Malayalam and Kannada wait for that review before any real centre uses them. Never say more than this.
