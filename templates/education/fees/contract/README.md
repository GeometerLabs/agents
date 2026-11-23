# The Fees runtime contract

A suite that describes what a Fees (and Classes) centre's runtime does **as the outside sees it**, so the TypeScript runtime and the Go runtime (decision 61, wave 3) are held to
the same tests. Every test makes the centre's folder in a temp directory exactly as the deployer does, starts the centre as a **separate process** on a free port, and talks to it
**only over HTTP and the files the deployer writes** (and reads `agent.db` read-only). It is the model of `templates/commerce/bookings/contract/` (read its README first): the
generic pieces come from `modules/test/contract/`, and the Guards' recording proxy is the Bookings contract's own `recorder` (`guards.ts`).

```
(cd go && go build -o bin/fees ./cmd/fees)
node --test --test-concurrency=1 templates/education/fees/contract/        # the Go program go/bin/fees (or FEES_GO_BIN)
```

Since 24 Nov 2026 the shop runs on the Go program only: the TypeScript runtime this contract was written against was deleted (decision 61; go/TRIAL.md, "The switch"),
so `FEES_IMPL=ts` is gone (`FEES_IMPL` may still say go; anything else stops the run). Without the binary every test is skipped and says why. Nothing here is
TypeScript only. `cross-restart.test.ts` is a Go-to-Go restart on one folder (it ran the two runtimes in turn until then), and `differential.test.ts` holds the
public demo's TypeScript world (src/harness.ts) to the Go shop on the demo's own paths.

## What a Fees centre is, for a port

The routes are `modules/runtime/http.ts`'s (the Bookings README's section 1), with Fees' own: `GET /internal/channel/parent?link=<hash>` (a parent's private page, by the hash of
their link), `GET /internal/channel/material?link=<hash>&batch=<id>[&file=<id>]` (Classes' reading material from `<client>/materials/<batch>/`), `GET
/internal/channel/request?handle=<hash>` is a payment's confirmation page, and `GET /internal/channel/documents?link=<hash>|handle=<hash>&lang=xx`. `/status` names its cases
`fees` (open, paid, closed). Fees has **no calendar**: runtime.json's `services` are `payments` (a Razorpay centre only; a UPI centre, the default, has none) and `messaging`.
The files are Bookings' (agent.db schema 5, the record, the snapshot in pieces); the saved state's members are `templates/education/fees/server/snapshot.ts`'s, every one on
purpose. The beat (`src/agent.ts onTick`) opens a month's fees at its first reminder moment (and a student's earlier unpaid months, `backDues`, at once), adds the late fee once
after the grace days, sends the reminders (one message for a family), the owner's UPI refund reminders, closes links at the licence's final stop, runs Classes (links, the
attendance question, the missed-class notes, doubts waiting) and, after it, the licence notice, the monthly report and the morning line.

## The files

| File | What it holds |
| --- | --- |
| `harness.ts` | the centre's folder, the process, the HTTP caller, the record read, the WhatsApp outbox (guards mode), a parent's link from their messages, `waitFor` |
| `guards.ts` | the two fake Guards (payments through the stub Guard, WhatsApp), over Fees' stand-ins |
| `smoke.contract.test.ts` | health, status, every credential refusal, 404s, the centre's page, the inbox's and the panel's requests checked whole, folder refusals, the live test clock |
| `month.contract.test.ts` | the month on the test clock: when fees open, one reminder per family, the reminder days and words, the late fee, the cap, STOP, restarts, a restore |
| `upi.contract.test.ts` | a UPI centre's money: the owner's one-use codes (words, button, page), parts, overpayment owed back, cash, waivers within and above the limit |
| `razorpay.contract.test.ts` | a Razorpay centre's money on the wire: one link per amount, paid from the provider's own list, a claim not believed, a Guard outage, refunds (owner's, refused, held by Guard, released once) |
| `parent.contract.test.ts` | a parent's private page: what it opens, "show how to pay", "I have paid" and its confirmation page, another parent's fee, revoke and a new link, a restart |
| `owner.contract.test.ts` | the licence, the owner's page, the shop's assistant over the Fees skill, the panel's to-do list, the monthly report |
| `assistant.contract.test.ts` | the shop's assistant's money paths: a waiver card's Refuse, a cancel card void after a payment, refund cards on a Razorpay centre (held by Guard, released once) and a UPI centre (owed by the owner), a message card, the morning line's fees not paid |
| `classes.contract.test.ts` | Classes: the class link and consent, the attendance and the missed-class note, a fee past its grace days, doubts, the reading material |
| `chat.contract.test.ts` | the centre's public chat |
| `record.contract.test.ts` | the store file, the saved state's members, what never leaves the centre (numbers, words, students' names) |
| `cross-restart.test.ts` | a Go-to-Go restart on one folder (the TypeScript and Go runtimes in turn until 24 Nov 2026) |
| `differential.test.ts` | (fakes and guards) the public demo's TypeScript world and the Go shop on the demo's own paths, every WhatsApp message compared whole |

## Two kinds of centre

A **fakes** centre runs on the TEST clock (Mon 2 Nov 2026, 09:00 in India; the beat every second) with the runtime's own in-memory stand-ins, observed through the record, `/status`,
the channel routes and the owner's page. A **guards** centre is `live` against the fake Guards on the real clock; since the real clock cannot be moved, its fees are two earlier
unpaid months (Meera's and Rohan's September), which the first beat opens whatever the day, and the month's own fees never open in a test (`GUARDS_MONTH` in the harness says why).
