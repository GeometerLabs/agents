# Meeting follow-through (planned)

> **Status: a spec, not a template.** Nothing here runs, and no group has used it. Comment on it in this repository's GitHub Discussions. It would be built in Phase 3, after the fee and dues collection template (B16) and the voice module (B29). Read [../README.md](../README.md) first.

## The job

Groups decide things in meetings and then lose them. A self-help group agrees to repair the water tap by the 20th. A committee agrees a vendor will deliver on Friday. A cooperative agrees who will visit the block office. At the next meeting nobody is sure what was decided, who said they would do it, or whether it happened.

**This is not a minutes or transcription product.** Transcription is a commodity, and the government's SabhaSaar already writes Gram Sabha minutes (check its scope before launch). The value here begins after the meeting:

1. **Someone records the meeting,** or sends a WhatsApp voice note of the decisions.
2. **The agent drafts the decisions:** who does what, by when, and any money involved.
3. **A named person the group chose confirms them.** Nothing becomes a task, a reminder or a payment from the transcript alone.
4. **Reminders go to whoever has the task.**
5. **The record and a signed statement show what was done, what was not, and who approved what.** The next meeting opens with that list.

**What it never does:** decide anything, or move money. It drafts, asks, reminds and records.

## Who it is for

- **Self-help groups,** committees (festival, water, school management, housing society) and **cooperatives** that meet regularly and decide things that other people have to do.
- **The person who confirms:** the secretary, the chair or another named person. She or he is the group's choice, and is recorded as such.
- **The people who hold tasks:** any member, and sometimes a person outside the group (a vendor, a technician) who is only reminded, with their consent.
- **Whoever sets it up:** a local partner or builder, working with the group.

## Settings

| Setting | What it covers |
| --- | --- |
| Group | Name, village or building, language(s), meeting days |
| People | Each person's name, phone, language, role. A person joins by her own message |
| Confirmers | The named person (or two) who may confirm decisions, and the person who may confirm that a task was done. These may be different. **The person who holds a task cannot be the only one to confirm it is done** |
| How a meeting is captured | A recording with everyone's consent, or a voice note of the decisions from one person, or typing. The group picks. If anyone present declines, no recording |
| Consent | The words said at the start, and who agreed, recorded with the time |
| Task kinds | "Physical" (something done on the ground), "Document" (a letter, an application), "Money" (something paid or collected), "Plain" (a call, a message). Each kind has an evidence rule (below) |
| Reminders | Days before the due date, a maximum number, quiet hours, who gets them |
| Retention | How long audio and transcript are kept if nobody confirms (default 7 days; deleted at once when decisions are confirmed) |
| Statement | When it goes out, to whom, which languages |

## Limits, in plain words

1. **The transcript never decides.** The model proposes. A person disposes.
2. **Amounts, dates and names are confirmed with buttons or typed digits.** Never by "yes" to a sentence the model wrote. The confirmer sees "₹2,500, to Ramesh, by 20 Dec" as separate fields and taps or types each.
3. **Nothing becomes a task, a reminder or a payment from the transcript alone.** Only from a confirmation by the named person.
4. **The agent never moves money.** A decision that involves money creates a task for a person; the money moves in the group's own account.
5. **Reminders stop once a task is marked done by the person responsible and confirmed by the chosen person.** Not before. "I'll do it" and "I did it" are not the same, and neither stops a reminder until the second person has seen the evidence.
6. **Recording needs everyone's consent,** asked at the start and recorded. A person who says no, or who leaves, can have the recording stopped. The audio is **deleted after the decisions are confirmed** (DPDP).
7. **A promise never counts as done.**
8. **No message after STOP.**
9. **Nobody is named to the group as late** by a message. Overdue tasks appear on the statement, with the name of the task's owner as the group decided, and nowhere else.
10. **A correction never erases.** Both lines stay.
11. **Unknown is never permission.** If the model is unsure of an amount, a date or a name, it leaves the field blank and asks.
12. **Only a person can widen a limit,** and it is recorded.

## How "done" is judged

A task has states, and the statement shows them in plain words: proposed, confirmed (a decision), assigned, reminded, **claimed done** (by the person responsible), **confirmed done** (with evidence), disputed, dropped (by a group decision).

**"Done" is a record, not a word.** For tasks done on the ground, evidence from the ground is needed:

| Task kind | What counts as done |
| --- | --- |
| Physical (a repair, a visit, a delivery) | A **named person's confirmation, with a photo and a shared location,** from someone other than the task's owner. Or the counterpart's own record: the vendor's invoice or delivery note, an office's reference number |
| Document (an application, a letter) | The **counterpart's own record:** a reference or receipt number, or a stamped copy photographed by a person other than the owner |
| Money (a payment made or collected) | The **payment provider's own record,** or the treasurer's marked entry, labelled differently |
| Plain (a call, a message) | The confirmer's own confirmation that she or he heard it was done, labelled as "told, not checked" |

A photo and a shared location are things a person can look at. They are not proof. The statement says what kind of evidence each "done" rests on, so a reader can judge. Where nothing can be shown, the task stays "claimed done" and is counted that way.

## The signed statement

After each meeting and before the next, the group gets a signed statement. It opens the next meeting:

```text
Sunrise SHG · what happened to the decisions of 12 Nov

Done, with evidence          3
  Repair the tap by 20 Nov     done 18 Nov · confirmed by Meena · photo and location · Ramesh
  Visit the block office       done 19 Nov · counterpart's reference 2211/B · Lakshmi
  Pay Raju Tents ₹2,500        done 20 Nov · UPI record · treasurer
Claimed done, not confirmed  1   Collect the forms · Suma
Not done                     1   Buy 20 chairs · due 25 Nov · Anil
Dropped by the group         1   Hire a sound system

New decisions of 3 Dec        confirmed by Meena, 3 Dec, 6:40 pm
Not checked: whether the work was good, and anything not shown above.
Code 8M3Q1T · scan or type it to check this statement is unchanged.
```

- **The same statement is on every member's phone.** This is the "many witnesses" idea (B28): a quiet change to the record would not match the other copies. **B28 is not built, and nothing here is claimed until it is.**
- **Signed, with a code anyone can check** (planned; the verify page needs the owner's yes before it is deployed). A signature shows the statement is unchanged. It does not show a task was well done.
- **Read aloud** on request (B29). **A paper copy** for the next meeting.
- **A person can tap "this is wrong"** on any line. It is recorded and shown to the confirmer.

## Privacy

- **A recording of a meeting is the most sensitive thing in this template.** People say things in meetings they do not say outside.
- **Choose the lightest way:** a voice note of the decisions from one person, instead of a recording of the whole meeting, is the default. A full recording is an option the group chooses, with everyone's consent.
- **Consent is asked first, recorded, and can be withdrawn.** If any person present says no, nothing is recorded.
- **The audio and the transcript are deleted after the decisions are confirmed,** and after the retention days if nobody confirms. The record keeps the confirmed decisions, who confirmed and when. It does not keep what people said.
- **The model that drafts decisions sees the transcript** (a cost and a risk). Where it runs, and whether the transcript leaves the builder's server, must be chosen and said in the sell guide. We lean to speech and drafting engines that can run under the builder's control.
- **People outside the group,** such as a vendor, receive only their own task, with their consent.
- **Members see the statement, not each other's private messages.**
- **Shared phones:** messages say the group's name and "a task is due", without detail, unless the person turned detail on.
- **Data stays with the builder's server,** not with Geometer. Geometer receives counts and health signals, never names, numbers, words or audio.
- **DPDP Act:** consent, purpose, deletion.

## Legal care

**Get legal review before launch.** What to ask about, not an opinion:

- **Recording a meeting.** Consent from everyone present, how it is shown, how it is withdrawn.
- **The DPDP Act, 2023 and its rules:** consent notices in the language people understand, purpose, deletion, children (none), a person's right to see and erase her data.
- **Statutory minutes.** Panchayats, cooperative societies and registered committees have legal duties about minutes and records, with named office-bearers and signatures. This template's statement is **not statutory minutes** and does not replace them.
- **Gram Sabha.** The government's SabhaSaar already writes Gram Sabha minutes. This template must not be presented as an alternative to it. Check its current scope and whether a link to it is possible.
- **Money tasks.** Where a decision involves money, the money moves in the group's own account. Everything in the fee collection, self-help group and community fund specs about chit funds, money lending and pooled money applies.
- **Speech to text of Indian languages,** and where the data goes. Check each engine's terms.

## The human outcome to count

Counted, published beside the technical results, never graded:

- **Tasks done with evidence, claimed done, not done, dropped,** per meeting, as a count. Not a score for any person.
- **Time from the meeting to confirmed decisions,** and how many needed correction.
- **Disputes of the form "we never decided that":** how many, and how each ended.
- **Who holds the tasks.** Whether tasks fall mostly on a few members, counted so the group can see it.
- **The secretary's or chair's time:** before and after.
- **Who spoke and who did not** is **not** measured. This is not a surveillance tool.
- **Harm:** any person pressed or shamed because of a message or a statement, or any recording made without consent.

## What it reuses, and what is new

**Reused (the shared modules, B30):**

| Module | Used for |
| --- | --- |
| **Voice (B29)** | Voice notes in, transcribed and then confirmed; the statement and the approval read aloud; recording consent and deletion |
| Conversation | WhatsApp in and out, the 24-hour window and templates, STOP |
| Language | Message packs per language; amounts, dates and names checked after translation |
| Reminders | Due times, never after a task is confirmed done, or STOP |
| Approvals | The named confirmer's decisions with one-use codes |
| Record and statements (B28) | The append-only record, signed statements, the verify code |

**New for this template:**

- **A decision drafter:** a model proposes who/what/when/how much from a transcript or a voice note, with unsure fields left blank. It never decides.
- **A decision and task ledger** with states, owners, due dates and evidence.
- **Confirmation by field:** buttons and typed digits for each amount, date and name.
- **Evidence rules per task kind,** with a "someone other than the owner" check.
- **Consent to record,** captured and deleted with the audio.
- **The opening list for the next meeting:** what happened to the last decisions.
- **Reminders to the task's owner,** including people outside the group, with their own consent.
- **Carry-over and dropping:** a task the group drops is recorded as dropped, by a decision.

## The sell guide (outline)

Follows [../../SELL-GUIDE.md](../../SELL-GUIDE.md). The seller is a young local partner, 18 or over. The buyer is the group's secretary or chair, or the programme that supports many groups.

| # | Heading | Key content |
| --- | --- | --- |
| 1 | Is this group a fit? | Good: a group that meets regularly, decides things others must do, and forgets or argues about them. Not a fit: a group that does not want a recording or a voice note; a meeting where members will not agree to be recorded; a group that needs statutory minutes only. Three questions: do you decide things in meetings, do they get forgotten, is there a person the group trusts to confirm |
| 2 | Before you go | Practise with a friend: run a pretend meeting, send a voice note, confirm the drafts. Learn the limits |
| 3 | The first three sentences | For the secretary: who you are; "after your meeting it writes down what you decided, who will do it and by when, you confirm it, and then it reminds the person"; "may I show it with a pretend meeting?" |
| 4 | Show it on the secretary's own phone | A pretend meeting: a voice note of three decisions; the drafts with blank unsure fields; confirming each amount and date by tapping or typing; a reminder to the task's owner; a "done" with a photo and location; the confirmer confirming; the statement that opens the next meeting. Test data, nothing real sent |
| 5 | Questions groups ask | Does it record everything we say? (Only if everyone agrees, and it deletes the audio.) Who decides what we decided? (The person you chose.) Can it make people do things? (No: it reminds.) Can it pay? (No.) Is it the government's minutes? (No.) Who hears my voice? Who do I call? Can we stop it? Is this AI? |
| 6 | Price | **Not decided.** Who pays and how much is an open question. Do not quote one. Money flow only; never what anyone will make |
| 7 | Never say | "It writes your minutes." "It makes sure things get done." "Nothing is forgotten now." "It listens to everything safely." "It is approved by the government." "It replaces your secretary." For each, why and what to say instead |
| 8 | The setup visit | At a meeting: explain recording; ask for and record consent; choose the confirmer(s); enter the people, who join by their own message; choose how a meeting is captured; set the task kinds and evidence rules; a pretend meeting end to end; the certificate read aloud. Say what platform access it needs (a WhatsApp number, a speech engine) and how long it takes |
| 9 | The first month | Be at the first real meeting. Read the first statement at the next one. Ask what changed for the secretary. One introduction, never a reward |
| 10 | When something goes wrong | Stop it first. Tell the secretary before members find out. If a recording was made without consent, delete it and say so. Look at the record |
| 11 | Be honest about what's true today | Dated. A spec: nothing built, no group has used it, the voice module and the statements are planned, and no lawyer has read it |

## Questions for contributors

- Is a **voice note from one person** enough for most groups? Would a full recording ever be agreed?
- Who does a group trust to confirm? What if the secretary is the one who forgets?
- How should evidence work in a village with weak signal: a photo now, a location later?
- What counts as "the counterpart's own record" for a panchayat or a block office?
- Where may a transcript be processed: on the builder's server, or only on a service the group has agreed to?
- How should a task owner outside the group consent, and how does she or he leave?

## What this spec does not claim

It does not claim the template exists, that decisions will be followed, that anything will get done, or that a recording is private. It claims one thing about the design: nothing becomes a task, a reminder or a payment from a transcript alone, and a "done" rests on something other than a person's say-so. That is a design rule, not yet code.
