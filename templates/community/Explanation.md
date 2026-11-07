# Explanation: the planned community templates

3 November 2026. Why the three specs in this folder are shaped the way they are. They are specs, not code ([README.md](README.md)); what is not built is in [Deferred.md](Deferred.md).

## Why specs first

These templates handle other people's money or decisions, in places where trust in "who handles the money and the records" is the whole problem. A wrong guess costs a group its savings or its goodwill. Writing the limits, the privacy defaults and the legal questions down first lets people who know such groups say where it is wrong before anyone builds anything.

## The decisions that matter

**1. The limit is on the agent, and what the agent will show.** Geometer cannot stop a committee paying a bill from its own bank account, and must never be given the keys to try. What it can do is refuse to say "approved" without the named approvers, and put "paid without a recorded approval" on the statement for everyone. In the community-fund spec this is limit 5, and it is the honest form of "limits outside the AI" for outgoing money: the limit is on what is recorded and said, not on what a treasurer does with her own account. Anything stronger would need the agent to hold the money, which it must never do.

**2. The agent never holds, pools, lends or moves money.** The group's money stays in the group's own account and cash box. This is the line that keeps the templates away from the chit fund, money-lending and deposit-scheme laws as far as design can; it does not replace legal review, which each spec asks for first.

**3. "Paid" is judged from a record, and cash is labelled differently.** A UPI or link payment rests on the provider's record. A cash payment rests on a named person's marked entry, shown as "Cash, marked by [name]" and counted apart. The statement shows the two apart so a member can see which payments rest on a person's word. This is the same "judged from the service's own record" rule as Bookings, with a labelled exception where no service exists.

**4. A correction never erases.** A wrong entry is fixed by a new line. Both lines stay in the record and on the statement. A quiet rewrite is the thing the whole design exists to show.

**5. The statement is the product.** The money is not moved by the agent, so the value is that everyone who gave or saved can read the record about them, in their language, signed, with totals. That is B28's "many witnesses" idea. It is described here as planned, because B28 is not built. The specs say so in the status line, in the statement section and in the last paragraph.

**6. Privacy defaults assume a shared phone.** A woman in a self-help group may not want her husband to see her savings or a loan. So reminders show the group's name and the day, not the amount; the amount is opt-in; the statement opens with a code the member chose; a member sees her own detail and the totals; nothing is ever posted to a group chat; nobody is named to others as late. The treasurer and book-keeper see more, because they make the entries.

**7. A member joins by her own message.** Nobody can add another person's number. This is the consent that makes a reminder lawful and respectful, and it is what lets a member leave.

**8. The loan schedule is typed in, never worked out.** The agent never calculates interest or an instalment, and never says who should get a loan. A second named person confirms the entry. This keeps it a record of the group's decision, which is what keeps it away from lending decisions.

**9. Approval rules by amount, and the requester cannot approve.** In the community fund, one approver up to an amount and two of three above it, set by the committee. The person asking to spend cannot be among the approvers of that spend. The rule is typed in and read aloud at setup.

**10. Pressure is a harm to design out.** A festival or temple fund can turn coercive. So: at most two reminders for a recurring due, none for open gifts, no "pending" list, anonymous gifts shown as a count, names off by default.

**11. Meeting follow-through starts where minutes end.** Transcription is a commodity, and the government's SabhaSaar already writes Gram Sabha minutes. The value is the follow-through: a named person confirms the drafted decisions, only then do tasks and reminders exist, and "done" rests on evidence from someone other than the task's owner. The lightest capture (a voice note of the decisions from one person) is the default, because a full recording of a meeting is the most sensitive thing in the set.

**12. The model proposes and never decides.** In meeting follow-through, a model drafts who/what/when/how much. Unsure fields stay blank. Amounts, dates and names are confirmed with buttons or typed digits. Nothing becomes a task, a reminder or a payment from a transcript alone.

**13. A promise never counts as done.** "I will" and "I did" are different states. A reminder stops only when the person responsible has marked the task done and the chosen person has confirmed it with evidence that fits the kind of task (a photo and a shared location from someone else, the counterpart's own record, the payment provider's record). The statement names the kind of evidence, because a photo is something to look at, not proof.

**14. The human outcome is counted, not graded.** Each spec lists what to count: disputes about who paid, the book-keeper's or treasurer's time, the book-keeper's role and pay as she tells it, questions answered, harm. This is the company's "whose control" rule: the owner's limits govern what the agent may do, but not what happens to the person whose work changes.

**15. Price is left open on purpose.** A shop's price does not fit a group holding a few lakh rupees, or a temple fund. Who pays (the group, a federation, a programme) is an open question, and each sell-guide outline says not to quote a number until the founder decides.

## What the three have in common, and what differs

| | Self-help group | Community fund | Meeting follow-through |
| --- | --- | --- | --- |
| Many payers, one ledger | Yes (members) | Yes (contributors) | No money in the ledger |
| Money in | Savings and repayments | Gifts and dues | Not handled |
| Money out | Not handled (the group lends from its own pot; the agent records the schedule) | Spend ledger with approvers | Not handled |
| Cash | Marked by treasurer or book-keeper | Marked by treasurer | Treasurer's marked entry only for money tasks |
| The statement | Member's own payments and group totals | What came in, what went out and who approved, the balance | What happened to the last meeting's decisions |
| Built on | Fee and dues collection (B16) | Fee and dues collection (B16) | Voice (B29), reminders, approvals, statements (B28) |

## Where the numbers and names came from

Every number in a statement or a table in these specs is made up. The laws named are the ones the partner rules and the owner's brief already point at (the Chit Funds Act 1982, the Prize Chits and Money Circulation Schemes (Banning) Act 1978, state money-lending acts, the Banning of Unregulated Deposit Schemes Act 2019, FCRA for foreign gifts to a committee, the DPDP Act 2023). Naming a law is a prompt to ask a lawyer, not a statement that the template meets it.

## What was checked

`planned.test.ts` checks the shape (the same headings, the 11-row sell-guide outline in order, the shared limits in every spec), the links, that the lists in this folder's README.md and the root README match the folders, and that no spec uses a banned word outside its "Never say" row. It checks nothing about whether the design is right. That needs people who know these groups.
