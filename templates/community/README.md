# Planned templates

A **planned** template is a spec. It says what the template would do, for whom, inside which limits, and what it would reuse. **It is not runnable.** There is no code, no settings file and no sell guide here yet, and nothing in these folders has been run, tested or used by anyone.

Why write the spec first: these templates handle other people's money or decisions, in villages and community groups where trust in "who handles the money and the records" is the whole problem. We want people who know a self-help group, a festival committee or a gram panchayat to tell us what is wrong before anyone builds it.

## What you can do

- **Read a spec and comment** on it in this repository's GitHub Discussions (one thread per spec). The most useful comments say "this would not work in my group, because ..." or "you missed this person".
- **Say what is missing** from the limits, the privacy section or the legal section. Each spec ends with open questions.
- **Offer a real group** to try it with, or a native-speaker review of the planned wording. A template is published only after one real, measured deployment.

## What is here

| Spec | The job | Built on | Phase |
| --- | --- | --- | --- |
| [self-help-group](self-help-group/README.md) | Monthly savings, repayments of the group's own loans, meeting reminders and a statement every member can read | Fee and dues collection (B16) | After B16 |
| [community-fund](community-fund/README.md) | Contributions to a festival, a borewell or a housing society, spending recorded with who approved it, and a statement to every contributor | Fee and dues collection (B16) | After B16 |
| [meeting-follow-through](meeting-follow-through/README.md) | What happens after a meeting: decisions drafted from a voice note, confirmed by a named person, then reminders and evidence that each task got done | Voice (B29), reminders, approvals, record and statements (B28) | Phase 3, after fee collection and voice |

The built community template, equipment rental, is not here: it runs on the Bookings template as settings, in [../commerce/bookings/](../commerce/bookings/).

## What every planned template promises, and what it does not

- **The agent never moves money.** It records and reminds. The group's money stays in the group's own account.
- **Limits sit outside the AI.** What may be sent, what counts as paid and who may mark a cash payment are rules checked in code, in plain words, and written to the record.
- **"Done" is judged from records,** not from what the agent or a person says.
- **Everyone can see the record that is about them,** in their own language, as a signed statement on their own phone. This is the "many witnesses" idea (B28). **B28 is not built.** These specs describe how the statements would work; they claim nothing the code does not do today.
- **A change shows.** We say "can't be quietly rewritten without it showing". We do not say tamper-proof, safe or guaranteed.
- **Legal review comes first.** Each spec names the laws to look at. None of it is legal advice, and none of it has been reviewed by a lawyer.
- **No earnings claims.** No spec says what anyone will make.

## The shape of a spec

Every spec has the same headings, so they can be compared: the job, who it is for, settings, limits in plain words, how "done" is judged, the statement, privacy, legal care, the human outcome to count, what it reuses and what is new, the sell-guide outline, and questions for contributors. The sell-guide outline follows [../SELL-GUIDE.md](../SELL-GUIDE.md): the 11 headings, with the key content for each.

`planned.test.ts` checks that every folder here has its headings, that the lists in this file and in the root README match the folders, and that no spec uses a word the claim rules ban. Run it with `node --test templates/community/`.

## When a spec becomes a template

A spec stops being only a spec (and leaves this list) when its code exists, its situations and hand check run, and its sell guide is written in every language it speaks (see [../../CONTRIBUTING.md](../../CONTRIBUTING.md), "What a template must have"). Until then this folder is the honest place for it.
