# Self-help group savings and repayments (planned)

> **Status: a spec, not a template.** Nothing here runs, and no group has used it. Comment on it in this repository's GitHub Discussions. It would be built on the fee and dues collection pathway (B16), after that exists. Read [../README.md](../README.md) first.

## The job

A self-help group (SHG) meets once a month. Each member puts in her savings. Some members borrow from the group's pot and pay it back in instalments. The book-keeper writes it all in the group's books. Trust breaks when someone says "I paid" and the book says she didn't, or when nobody outside the leaders can read the book.

This template does four things, and only these:

1. **Savings.** Remind each member of her monthly contribution before the meeting, and record it when it is paid.
2. **Repayments.** Remind a borrowing member of the instalment due, from the schedule the group decided, and record it when it is paid.
3. **Meeting reminders.** The day, time and place, once, before each meeting.
4. **A statement every member can read:** her own payments and the group's totals, in her language, signed.

**What it never does:** hold, pool, lend or move money. The group's money stays in the group's own bank account and the group's own cash box. Geometer and the agent only record and remind.

## Who it is for

- **Women's self-help groups**, usually 10 to 20 members, with a president, a treasurer and a book-keeper (in some places called a community resource person, or CRP).
- **The book-keeper.** She is the person whose work changes most. The aim is fewer arguments and less copying, not a replacement for her. Her time is counted (see "The human outcome to count").
- **Whoever sets it up:** a local partner or builder, working with the group, not for the group.

## Settings

Everything a group changes is a settings file, not code, as in Bookings.

| Setting | What it covers |
| --- | --- |
| Group | Name, village, the group's own language, the group's own bank account (a label, never a key) |
| Members | Each member's name, the phone she chose, her language, whether the phone is shared, and her own short code for opening her statement. A member joins by sending a message from her own phone; nobody can add her number for her |
| Roles | The president, the treasurer, the book-keeper, and the one named person who sees disputes. Only the treasurer and the book-keeper may mark a cash payment |
| Contribution | The monthly savings amount (one for the group, or one per member if the group decided so), and the day of the month it is due |
| Meeting | The weekday or the date rule ("second Saturday"), the time, the place as a line of text |
| Loans | The schedule the group decided, **typed in by the book-keeper and confirmed by a second named person**: who borrowed, how much, how many instalments, the due dates and the amount of each. The agent never works out an interest rate or an instalment |
| Languages | Each member's language for messages and the statement; Hindi, Malayalam, Kannada and English at first |
| Reminders | How many days before the meeting, how many reminders at most, and the hours when nothing is sent (no message at night) |
| Messages | Whether a reminder may show the amount. **Off by default,** because phones are shared |

## Limits, in plain words

These are the rules the agent can't go around. Each one is checked in code outside the AI and written to the record when it decides.

1. **It never pools, holds, lends or moves money.** There is no instruction, setting or approval that makes it. It has no bank keys.
2. **A reminder stops the moment a payment is recorded.** Not at the next run: the moment.
3. **Every amount in a message or a statement comes from the record.** Not from a model, not from a typed guess.
4. **No message after STOP.** A member who sends STOP gets nothing more, from any part of it.
5. **Only the treasurer or the book-keeper can mark a cash payment.** Anyone else who tries is told no, and it is recorded. A marked payment is recorded as "marked by [who] on [date and time]", and the member is told at once on her own phone.
6. **A correction never erases.** If a marked payment was a mistake, the book-keeper adds a correction line. Both lines stay in the record and on the statement.
7. **It never calculates interest or an instalment, ranks members, or says who should get a loan.** It records what the group decided.
8. **It never names one member to another.** No "late" list in a group chat. Nothing is posted to a group chat at all.
9. **Unknown is never permission.** If it can't tell whether something was paid, it says "couldn't confirm" and asks the book-keeper.
10. **Only a person can widen a limit,** and the change is recorded.

## How "done" is judged

"Paid" is judged from records, never from what a person or the agent says.

| How it was paid | What counts | How the statement labels it |
| --- | --- | --- |
| UPI or a Razorpay link | The payment provider's own record | "Paid by UPI" or "Paid by link", with the time |
| Cash at the meeting | The book-keeper's (or treasurer's) marked entry | "Cash, marked by [name]" with the time. **Labelled differently on purpose,** so a member can see which payments rest on a person's word |

The statement totals show the two apart: "₹X by UPI, ₹Y marked as cash". Where a digital payment can't be matched to a member, the record says "couldn't confirm" and nothing is counted.

## The member statement

After each meeting every member gets a **signed statement** in her language: her own payments, the group's totals, and what was not checked. This is the "many witnesses" idea (B28): the same record is on every member's phone, so a quiet change by one person would not match the other copies. **B28 is not built, and nothing here is claimed until it is.**

What a member sees (made-up numbers):

```text
Lakshmi · Sunrise SHG · statement for the December meeting

Your savings this month    ₹200   paid by UPI, 3 Dec, 4:02 pm
Your savings so far        ₹2,400 since March
Your loan                  ₹5,000, decided by the group on 12 Jun
  paid so far              ₹2,000 of ₹5,000 (2 of 5 instalments)
  next due                 ₹1,000 on 12 Jan (the date the group typed in)

The group                  recorded savings ₹36,000 from 14 members
                           recorded loans out ₹21,500
                           ₹31,000 by UPI, ₹5,000 marked as cash by the book-keeper (9 entries)

Not checked: the bank balance and the cash in the box. Compare this with the passbook.
Code 7K2M4Q · scan or type it to check this statement is unchanged.
```

- **Her own detail and the totals only.** She does not see another member's amounts.
- **Signed, with a code anyone can check** (planned: the verify page on geometer.dev needs the owner's yes before it is deployed). A valid signature shows the statement wasn't altered. It doesn't show the cash entries are true; that is what the member is there to say.
- **A "this is wrong" button** on every line. It records her objection, tells the named dispute person, and keeps both versions.
- **Read aloud** if the member chooses (B29), through her own headphones or when she is alone, because phones are shared.
- **A paper copy** printed by the book-keeper for any member without a phone, with the same code.
- **A public fingerprint** of the group's ledger, never its data, published daily, would let anyone check the record hasn't been rewritten (B28, planned). No tokens, no wallets, no chain, and nobody's data anywhere public.

## Privacy

Women in these groups often share a phone with family. Some do not want a husband or in-law to see savings or a loan.

- **Minimal messages by default.** A reminder says the group's name and the day ("Sunrise SHG, meeting Saturday 4 pm"). It shows the amount, or the word "loan", only if the member turned that on.
- **The statement opens with the member's own code** (typed digits she chose), not just by tapping the link.
- **A member sees her own detail and the group totals.** The treasurer and the book-keeper see every entry, because they make them. Nobody else does.
- **She joins and leaves by her own message.** Leaving removes her number from reminders. Her past payments stay in the group's record, because the group's books need them, and the statement says so when she joins.
- **Adults only.** 18 and over.
- **Data stays with the group's setup** (the builder's server), not with Geometer. Geometer receives counts and health signals, never names, numbers or amounts.
- **Consent, purpose and deletion follow the DPDP Act:** each member agrees to her number being used for this, and only for this.

## Legal care

**Get legal review before launch.** This is a list of what to ask about, not an opinion.

- **Chit funds.** India's Chit Funds Act, 1982, and the 1978 Prize Chits and Money Circulation Schemes (Banning) Act. **The agent never runs a chit** (a rotating pot where members bid or draw for the pot) and never runs a lucky draw. If a group runs a rotating savings arrangement, it is the group's own, and the agent only records what the group decided.
- **Money lending.** State money-lending laws (for example the Karnataka Money Lenders Act, 1961, and the Kerala Money Lenders Act, 1958) and rules on interest. **The agent never calculates interest to make a lending decision.** The group decides; the book-keeper types it in; a second person confirms it.
- **Pooled money.** Ask whether recording and reminding for a group's savings falls under the Banning of Unregulated Deposit Schemes Act, 2019, or any banking or payments rule, in the states where it would be used. The design says the money never touches Geometer or the agent. A lawyer should confirm that this is enough.
- **Government programmes.** SHGs often sit inside state or national livelihood missions and bank linkage schemes, with their own books. This template must not conflict with them. It should read as a copy of the group's own book, not a rival to it.
- **Records and signatures.** A signed statement is not an audited account and not a legal record of the group.
- **Data protection.** The DPDP Act, 2023 and its rules.

## The human outcome to count

Counted, published beside the technical results, never graded (the company's "whose control" rule):

- **Disputes about who paid.** How many "I paid but it isn't recorded" claims per month, and how each was settled: from the record, by the book-keeper's correction, or not settled.
- **The book-keeper's time.** Hours per month spent writing, copying and reconciling, before and after.
- **The book-keeper's role.** Whether her pay, her standing in the group or the number of groups she keeps changed, as she tells it.
- **Members who read their statement,** and members who asked for paper or read-aloud.
- **Harm.** Any case of a statement or message seen by someone who should not have, reported by a member.

## What it reuses, and what is new

**Reused from fee and dues collection (B16) and the shared modules (B30):**

| Module | Used for |
| --- | --- |
| Conversation | WhatsApp in and out, the 24-hour window and templates, STOP |
| Language | Message packs per language; amounts and dates checked after translation |
| Payments | A payment link or QR to the group's own account, judged from the provider's record |
| Reminders | Due times, never after a payment is recorded or STOP |
| Approvals | The treasurer's and the dispute person's decisions on WhatsApp |
| Record and statements (B28) | The append-only record, signed statements, the verify code |
| Voice (B29) | Read-aloud statements; voice notes for a member who cannot type |

**New for this template:**

- **A group, not one payer.** Many members, each with her own balance, under one ledger.
- **Cash marking by named roles,** with "marked by", an instant receipt to the member, a dispute button, and correction lines.
- **The loan schedule as typed-in data,** with a second person's confirmation and no arithmetic by the agent.
- **A meeting rule** ("second Saturday") and the meeting reminder.
- **The member statement** with group totals, privacy defaults and a paper copy.
- **Consent and shared-phone settings:** opt-in by the member's own message, minimal messages, a code to open the statement.
- **Quiet hours** for reminders. (Bookings counts "hours before"; a group needs "no message at night".)

## The sell guide (outline)

Follows [../../SELL-GUIDE.md](../../SELL-GUIDE.md). The seller is a young local partner, 18 or over, often a woman who knows the groups in her area. The buyer is usually not a shop owner: it is a group's leaders, or the federation or programme that supports many groups. The guide is written in every language the template speaks.

| # | Heading | Key content |
| --- | --- | --- |
| 1 | Is this group a fit? | Good: a group that meets every month, has a book-keeper, and has had arguments about who paid. Not a fit: a group that does not want its books seen by all members; a group running a bidding chit; a group whose leaders will not let members open statements. Three questions: do you meet monthly, does one person keep the book, do members sometimes dispute it |
| 2 | Before you go | Practise with your own family group, then a friendly group, then a stranger's. Learn the limits by heart. Know who pays (open question) |
| 3 | The first three sentences | For the leaders, in the group's language: who you are; "it reminds members and writes down every payment, and every member gets a copy of her own page"; "may I show it at your next meeting, with test money?" |
| 4 | Show it on the leaders' own phones | A demo with made-up members: a reminder, a UPI payment recorded, a cash payment marked by the book-keeper and the member told at once, a "this is wrong" tap, the statement and the paper copy. Test money, nothing real sent |
| 5 | Questions groups ask | Who holds the money? (Not us, never.) Can it give loans? (No.) Does it work out interest? (No.) What if someone says she paid in cash? (The book-keeper marks it, and the member sees it.) Who sees my savings? (Only you and the totals.) What if my husband sees my phone? (Minimal messages, your own code.) Who do I call? What if it stops? Can we stop it? Is this AI? |
| 6 | Price | **Not decided.** A group holding a few lakh rupees cannot carry a shop's price. Who pays (the group, a federation, a programme) and how much is an open question. Do not quote a price until the founder decides. Money flow only; never what anyone will make |
| 7 | Never say | "Your money is safe." "No one can cheat now." "It gives loans." "It works out the interest." "It is certified by the government." "It replaces your book-keeper." For each, why and what to say instead ("every member sees her own page") |
| 8 | The setup visit | At a meeting with everyone present: each member joins by her own message; choose the treasurer, the book-keeper and the dispute person; enter the contribution and the meeting day; enter the loans from the group's own book, confirmed by a second person; read the opening balances aloud and have each member agree hers; test payment; the certificate read aloud; paper copies. Say what platform access it needs (a WhatsApp number for the group's setup, the group's own payment account) and how long it takes |
| 9 | The first month | Be at the first meeting. Read the first statements together. Ask the book-keeper what changed for her. Ask for one introduction, never a reward |
| 10 | When something goes wrong | Stop it first. Tell the leaders before the members find out. Look at the record with the book-keeper. A wrong payment is corrected by a line, never erased |
| 11 | Be honest about what's true today | Dated. This is a spec: nothing is built, no group has used it, the statements and the public fingerprints are planned (B28), and no lawyer has reviewed it |

## Questions for contributors

- Which payment provider will open an account for an SHG, or accept UPI to the group's own bank account, and give a record the agent can read? If none, UPI payments also become "marked by" entries.
- How should a statement look for a member who reads little? Pictures, colours, read-aloud?
- Who should see disputes in a group where the president and the treasurer are relatives?
- Should a group ever see a monthly "late payments" count, with no names? We lean to no.
- Which state programmes already keep digital SHG books, and how should this sit beside them?
- What is the right second person to confirm a loan entry?

## What this spec does not claim

It does not claim the template exists, that any law is satisfied, that a member's savings are protected, or that records can't be altered. It claims one thing about the design: a change to the record would show, because every member holds a signed copy of her own page. That claim is not true until B28 is built.
