# Explanation: the papers (a person's statement, the record of one case, the agent's identity paper)

Three signed papers made from a shop's record, for every template. They are sealed with the same envelope as the monthly report (`geometer-document/1`, `modules/report/sign.ts`), so the site's checker (`/verify`) and `verify-report.ts` read them as they read a report, and each is anchored to the head of the shop's ledger (`modules/record/ledger.ts`) when a tenant is named.

| Paper | Plan | Format | For whom | In which language |
| --- | --- | --- | --- | --- |
| Statement (`statement.ts`) | B28 | `geometer-statement/1` | one customer or parent | theirs (the language of their latest case) |
| Record of one case (`dispute.ts`) | B35 | `geometer-dispute-record/1` | the customer, a payment provider's dispute desk, an auditor | the shop's (the owner's) |
| Identity paper (`identity.ts`) | B36 | `geometer-agent-identity/1` | anyone who scans the certificate, once its page exists | the operator's choice (default English) |

## The rules every paper follows

- **Facts and counts only.** No paper grades, scores, ranks or promises; no paper says who is right. The record of one case has no field and no word for a verdict: a test looks for both, in every language. The banned words of the claim rules (`modules/report/claims.ts`) are checked in every paper, every language.
- **Every paper lists what it did not check**, in its own bytes (`notTested`, plain words in the paper's language). The site's checker lists `notTested` as the paper wrote it, so a reader of the file sees the same lines as a reader of the page.
- **Nothing about anyone else.** A statement is made only from the entries of that person's own cases; it carries no shop total. The record of one case only from that case's entries. The identity paper takes no customer data as input at all (counts of the record, the limits, the go-live certificate).
- **Customer details only as the record keeps them.** In the shop's own store the record holds the number; in the bundle's export, a short hash (`p-…`, `c-…`). A paper made from either shows what it was given. A statement shows the person only the last four digits of their own number. A fee's label is the month and the batch, never the student's name.
- **Draft words are marked.** Hindi, Malayalam and Kannada are machine-written (`words.ts`, `REVIEW_STATUS`); every page in those languages carries a "draft words, waiting for review" tag, and a test keeps it there.
- **The verify link is a plain link** (`geometer.dev/verify/#CODE`) for now: the QR encoder is moving to a shared module in other work.

## How a person is found

A statement is asked for by a WhatsApp number. `isPerson` matches it against a case's customer as the number itself (the shop's store) and as the export's short hashes of it (`p-` + the first 12 hex digits of its sha256, the same `hide` the bundle's export uses), so the same statement comes out of either. The panel takes the number only in a POST body: it is never in an address, a log line or a command line.

## What the record of one case puts side by side

Each entry of the case is one row; each row fills one or more of five columns:

| Column | From |
| --- | --- |
| The customer | `receive_message` (only the message's fingerprint is kept: the paper says so), a customer's "I have paid" (UPI) with how they said it, a STOP |
| The agent | every action of the agent's own, with its outcome |
| Limits and Guard | the limits' decisions on the entry (rule, allowed / stopped / held, and the reason as the record wrote it), and "Guard held it for the owner (approval …)" when the entry carries Guard's approval id |
| The owner | the owner's answer (approve, deny, retry), the owner's UPI marks ("marked paid by owner"), a waiver the owner approved |
| Service records | for a confirmed entry: the ids the payments service, the calendar or WhatsApp showed when the agent read them back, with the amount. A UPI mark has none, and says "no payment service record" |

The agent's own limit checks and Guard's holds are kept apart. Guard's own decision log is not read here, and the paper says so; nor are the providers looked up again (the paper says what the agent read back at the time). With the ledger, each row names its entry number and its hash in the ledger, so it can be held against the evidence pack `geo-verify` checks.

## The identity paper

A **stable id** per deployed agent: `agt_` and 20 base32 characters of random (`newAgentId`). The bundle makes it once and keeps it in `shops/<shop>/identity.json` (written with `wx`, never overwritten), so a settings change, a template update or a move to another partner on the same server keeps it.

The paper states: who runs it and for which shop; the template and its version; the limits in plain words (the go-live certificate's own phrases); the go-live checks, "held N of M", and what they did not test (the certificate's own list); the live counts so far (entries, payments, refunds, times a limit said no, times it waited for the owner); the limits made wider, by whom and when (each saved version of the settings compared with the one before, with each limit's direction: a higher refund limit is wider, a shorter cancellation window is wider); and the ledger's head with the last published fingerprint.

**The operator chooses what is public.** `buildIdentity` returns two papers: the full one, and the public one with only the chosen fields (`CHOOSABLE`; default: the limits, the checks and the limit changes, which are facts about the agent, not about the business). A field kept back reads `{ "shown": false }`, and the page says "not shown by the operator", so a missing "limits made wider" never reads as "no limit was made wider". A shop with no settings history says that too, rather than "no change". The anchor names the record's length, so it is kept back with the ledger field.

## How a template plugs in

A template hands in a `TemplatePapers` (its pathway, which actions are money in and money back, its own action words in four languages) and its cases as `PaperCase`s (`report/papers.ts` in Bookings and in Fees: a booking's service and time, a fee's month, batch and what is still owed), its limits as `LimitFact`s, and how to read its go-live certificate. `cli.ts` is the shared command line; each template's `scripts/papers.ts` is a dozen lines over it.
