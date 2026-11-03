# Community and committee funds (planned)

> **Status: a spec, not a template.** Nothing here runs, and no committee has used it. Comment on it in this repository's GitHub Discussions. It would be built on the fee and dues collection pathway (B16), after that exists. Read [../README.md](../README.md) first.

## The job

A village or a building collects money for a shared purpose: a temple or festival committee, a borewell and water-maintenance group, a housing society or village association. The people who give rarely see what came in, what was spent, and who agreed to spend it. That gap is where distrust starts.

This template does four things:

1. **Collect.** Ask for a contribution or a recurring due, take it on a payment link or record it when it is paid in cash, and give every contributor a receipt.
2. **Record spending.** When the committee spends, the spend is recorded with the amount, the payee, the purpose and **who approved it**.
3. **Remind** for recurring dues, and stop when they are paid.
4. **Send every contributor a signed statement:** what came in, what went out with the committee's approval, and the balance.

**The heart of it is the statement.** The money is not moved by the agent, ever.

**What it never does:** hold money, pay anyone, or move money out. The committee pays from its own bank account or UPI, and then records the payment. Outgoing money is never moved by the agent.

## Who it is for

- **Temple and festival committees** (a Ganesh or Durga puja committee, a village jatra or urs, a church or mosque repair fund).
- **Water and borewell groups,** and other maintenance funds: a pump, a tank, a lane, a drain.
- **Housing societies and village associations** that collect monthly dues.
- **Their treasurers and secretaries,** and above all **the people who give.** A contributor is anyone who gave, in any amount, through any route the committee records.

## Settings

| Setting | What it covers |
| --- | --- |
| Fund | A name and a purpose in a line ("Ganesh festival 2027", "Borewell repair"). A group can have several funds, each with its own statement |
| Account | The fund's own bank account or UPI handle, as a label. The agent never holds a key to it |
| Contributors | Name, house or flat, phone, language. A person joins by sending a message from her own phone, or is entered by the secretary as "known by the committee" and given a paper receipt |
| What is asked | A fixed due per house, a monthly due, or an open contribution with a suggested amount. Recurring dues have a due day |
| Roles | The president, the secretary and the treasurer, and the list of **approvers**. The treasurer may mark cash received |
| Approval rule | By amount. For example: up to ₹2,000 needs one approver, above that needs two of three. **The person asking to spend cannot be one of the approvers of that spend** |
| Spending kinds | A short list the committee chooses (tent, lights, repair, food, printing). Not a score; only a label |
| Reminders | For recurring dues only. At most two per due, never at night, none after payment or STOP. Open contributions get one request, not a chase |
| Statement | When it goes out (after each month, and at the end of a festival), what it names (see "Privacy"), the languages |
| Names | Whether contributor names are shown to other contributors. **Off by default** |

## Limits, in plain words

1. **It never moves money out, and it never holds money.** It has no bank keys and makes no payment.
2. **A spend counts as approved only when the named approvers have each confirmed it,** each from their own phone, with a one-use code. A spend with fewer approvals than the rule asks is shown as "waiting for approval".
3. **The person who asks for a spend cannot approve it.** If the rule needs two approvers and the requester is one of three, the other two must both approve.
4. **A spend is recorded with who approved it,** the time, the amount (typed digits, confirmed), the payee and the purpose. A photo of the bill can be added.
5. **If money was paid out without a recorded approval, the statement says so in plain words.** The agent cannot stop a committee paying from its own account. It can refuse to hide it. "Paid without a recorded approval: ₹X, on [date], marked by [treasurer]."
6. **Every amount in a message or a statement comes from the record.**
7. **A reminder stops the moment a payment is recorded.** No message after STOP.
8. **Only the treasurer (or someone the committee names for this) marks cash received,** recorded as "marked by [who] on [date and time]", and the contributor is told at once.
9. **A correction never erases.** It adds a line; both stay.
10. **Nobody is named to others as not having paid.** No "pending" list is posted anywhere.
11. **It never runs a raffle, a lucky draw or a chit.**
12. **Only a person can widen a limit,** and it is recorded.

## How "done" is judged

| What | What counts | How the statement labels it |
| --- | --- | --- |
| A contribution paid by UPI or link | The payment provider's own record | "Paid by UPI/link", with the time |
| A cash contribution | The treasurer's marked entry | "Cash, marked by [name]", labelled differently on purpose |
| A spend **approved** | Each named approver's own confirmation with their one-use code | "Approved by [names], [time]" |
| A spend **paid** | The treasurer marks it paid and types the UPI or bank reference. If a provider record exists, that counts | "Paid, marked by [name], reference [ref]" or "Paid, provider record" |
| The balance | The sum of the record, nothing else | "Recorded balance ₹X. Not checked against the bank." |

**A balance check (planned).** Each month the treasurer may type in the balance in the passbook and add a photo of the page. The statement then shows "Recorded ₹X. Treasurer entered the passbook balance ₹Y on [date]. Difference ₹Z." This does not prove anything. It makes a gap visible, to everyone, in the same place.

## The contributor statement

Every contributor gets the same signed statement in her or his language. It is the same for everyone, apart from the line about her or his own contributions. This is the "many witnesses" idea (B28): the same record is on every contributor's phone, so a quiet change by one person would not match the other copies. **B28 is not built, and nothing here is claimed until it is.**

Made-up numbers:

```text
Ganesh festival 2027 · statement at 30 Sep

What came in      ₹1,86,500 from 142 contributors
                  ₹1,52,000 by UPI/link, ₹34,500 marked as cash by the treasurer (31 entries)
                  Anonymous gifts: 6, total ₹7,200
Your gifts        ₹1,000, paid by UPI, 4 Aug

What went out, each with who approved it
  12 Aug  Tent and chairs, Raju Tents       ₹42,000   approved by Anil and Meena
  15 Aug  Lights                            ₹18,500   approved by Anil and Meena
  02 Sep  Prasad and food                   ₹61,200   approved by Meena and Suresh
  09 Sep  Sound                             ₹9,000    paid without a recorded approval
                                            Total out ₹1,30,700

Balance           recorded ₹55,800. Not checked against the bank.
                  Treasurer's passbook entry 28 Sep: ₹55,300. Difference ₹500.

Questions about any line: tap it. The secretary and the president see it, and the answer is added here.
Code 4P9X2B · scan or type it to check this statement is unchanged.
```

- **A tap on any spend asks a question** that goes to the secretary and the president and is recorded with the answer.
- **A paper copy for the notice board,** with the same code. Names are shown or hidden as the committee set it.
- **Read aloud** on request (B29).
- **Signed, with a code anyone can check** (planned; the verify page needs the owner's yes before it is deployed). A valid signature shows the statement is unchanged. It does not show the spending was right, and it is not audited accounts.
- **A public fingerprint** of the fund's ledger, never its data, published daily (B28, planned), so that a changed record shows.

## Privacy

- **Contributors see the totals and their own gifts,** not other people's amounts, unless the committee turned names on. Festival lists are traditionally read out in public; this is a setting the committee chooses, not the default.
- **Anonymous gifts** are shown as a count and a total.
- **Phones are shared.** Messages say the fund's name and the date, not the amount, unless the person turned that on. The statement opens with a code the person chose.
- **Nobody is pressed.** At most two reminders per due, none for open gifts. The agent never tells one person who has not paid.
- **The committee sees more:** the treasurer and secretary see every entry, because they make them.
- **Join and leave by your own message.** Past gifts stay in the fund's record, because the accounts need them.
- **Data stays with the committee's setup,** not with Geometer. Geometer receives counts and health signals, never names or amounts.
- **DPDP Act:** consent, purpose and deletion, for contributors' numbers.

## Legal care

**Get legal review before launch.** What to ask about, not an opinion:

- **Who may collect.** A temple, trust or society is governed by its own registration and by state law (a trust or society act, a cooperative societies act, a state endowments act). Some temples are managed by the state or a board, and a separate committee may not collect or spend on its own. A housing society's dues and accounts follow its own bye-laws and the state's rules.
- **Raffles, lucky draws and chits.** The 1978 Prize Chits and Money Circulation Schemes (Banning) Act, state lottery rules and the Chit Funds Act, 1982. **The agent never runs a draw or a chit.**
- **Foreign contributions.** If a contributor lives abroad, the Foreign Contribution (Regulation) Act, 2010 may apply to the committee. Ask before accepting.
- **Pooled money.** Whether recording and reminding for a fund falls under any deposit or payments rule (for example the Banning of Unregulated Deposit Schemes Act, 2019). The design says the money never touches Geometer or the agent.
- **Accounts.** A signed statement is not audited accounts, a tax receipt or a filing. It does not replace the treasurer's duties.
- **Data protection.** The DPDP Act, 2023 and its rules.

## The human outcome to count

Counted, published beside the technical results, never graded:

- **Complaints and disputes about the accounts:** how many per year, before and after, and how each ended.
- **The treasurer's time:** hours per month spent on receipts, lists and answering questions.
- **Questions asked through the statement,** and how many were answered, and how fast.
- **Contributors who opened the statement.**
- **Whether the committee kept using it** after the first festival or the first quarter, and why or why not.
- **Harm:** any person named or pressed because of a message or a statement, and any conflict it caused.

## What it reuses, and what is new

**Reused from fee and dues collection (B16) and the shared modules (B30):**

| Module | Used for |
| --- | --- |
| Conversation | WhatsApp in and out, the 24-hour window and templates, STOP |
| Language | Message packs per language; amounts and dates checked after translation |
| Payments | A payment link or QR to the fund's own account, judged from the provider's record |
| Reminders | Recurring dues, never after payment or STOP |
| Approvals | One-use codes on WhatsApp for each approver |
| Record and statements (B28) | The append-only record, signed statements, the verify code |
| Voice (B29) | Read-aloud statements |

**New for this template:**

- **A spend ledger** beside the contributions, with **an approval rule by amount** (one approver, or two of three) and "the requester cannot approve".
- **"Paid without a recorded approval"** shown on the statement.
- **Several funds** for one committee, each with its own statement.
- **Anonymous gifts,** and the names setting.
- **Questions on a line,** with the answer recorded.
- **The balance check** against the passbook, typed in by the treasurer.
- **Open contributions** (one request, no chase) as well as dues.
- **A notice-board page** and a paper copy.

## The sell guide (outline)

Follows [../../SELL-GUIDE.md](../../SELL-GUIDE.md). The seller is a young local partner, 18 or over, who knows the committees in her or his area. The buyer is the committee: usually the secretary or the treasurer, with the president's agreement.

| # | Heading | Key content |
| --- | --- | --- |
| 1 | Is this committee a fit? | Good: a festival, borewell or society fund with a treasurer, many small givers, and questions every year about where the money went. Not a fit: a committee that wants to keep the accounts private; a fund collecting from outside India without advice; a fund that runs raffles. Three questions: do many people give, is there a treasurer, do people ask for the accounts |
| 2 | Before you go | Practise with a friend as the treasurer, then a friendly committee, then a stranger's. Learn the limits. Know who pays (open question) |
| 3 | The first three sentences | For the secretary or treasurer: who you are; "it gives every person who gave a copy of the accounts on their phone: what came in, what went out and who agreed"; "may I show it with test money?" |
| 4 | Show it on the treasurer's own phone | A demo with made-up givers and spends: a UPI gift recorded, a cash gift marked and the giver told, a spend waiting for two approvers, one approving from a second phone, a spend "paid without a recorded approval", the statement and the paper copy. Test money |
| 5 | Questions committees ask | Who holds the money? (Not us.) Can it pay for us? (No.) Can it stop us spending without approval? (No: it shows it.) Will givers see each other's amounts? (Not unless you turn it on.) What if the treasurer is the one in doubt? Do we need a lawyer? (Yes, before launch.) Who do I call? Can we stop it? Is this AI? |
| 6 | Price | **Not decided.** A temple or society fund is not a shop. Who pays (the committee, the association) and how much is an open question. Do not quote one. Money flow only; never what anyone will make |
| 7 | Never say | "Your money is safe." "Nobody can steal from the fund now." "It stops wrong spending." "It is audited." "It replaces the treasurer." "The temple board approves." For each, why and what to say instead |
| 8 | The setup visit | At a committee meeting: choose the roles and the approvers; type in the approval rule and read it aloud; enter the contributors, who join by their own message; type the opening balance and have the committee agree it; connect the fund's account label; a test gift and a test spend with two approvers; the certificate read aloud; paper copies. Say what platform access it needs and how long it takes |
| 9 | The first month | Be there for the first spend. Read the first statement with the treasurer. Ask what questions came in. One introduction, never a reward |
| 10 | When something goes wrong | Stop it first. Tell the secretary before givers find out. Look at the record. A wrong entry is corrected by a line |
| 11 | Be honest about what's true today | Dated. A spec: nothing built, no committee has used it, the statement signing and public fingerprints are planned (B28), no lawyer has read it |

## Questions for contributors

- Do committees want contributor names shown? Tell us how it works in your village or building.
- Is "two of three approvers" the right shape? Many committees have one strong treasurer. What would they accept?
- What does a temple or society actually use today: a notebook, a Google Sheet, a WhatsApp group, a bank passbook?
- How should a fund handle a very large gift from one person, and the pressure around it?
- Which payment provider accepts a committee's account? If none, UPI also becomes "marked by".
- What should a statement say about spending that is shared in kind (labour, food) and has no bill?

## What this spec does not claim

It does not claim the template exists, that spending will be right, that givers' money is protected, or that records can't be altered. It claims one thing about the design: a change to the record would show, because every contributor holds a signed copy. That claim is not true until B28 is built.
