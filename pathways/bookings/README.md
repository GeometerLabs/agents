# Bookings pathway (v0 core)

Market: Commerce and support (bookings).

A WhatsApp agent for businesses that take bookings with a deposit and a cancellation rule: salons, tuition centres, fitness studios and home services. A customer writes in Hindi or English; the agent holds a slot, sends a deposit link, books only when the calendar and the payment record both agree, reminds the customer, and handles cancellations, refunds and rescheduling, asking the owner when a decision is theirs.

**What this folder is, and is not.** It is the v0 core of the pathway, built and checked against **stand-in services in memory**. It is **not the Geometer engine**, it talks to no real WhatsApp, Razorpay or calendar, and nothing here has been run against a real business. The "hand check" below is a hand-run check for the Phase 0 prototype, not the engine's crash test.

It has no dependencies and makes no network call. TypeScript is run directly by Node's built-in type stripping.

## Run it

You need Node 26 (any Node with built-in TypeScript type stripping works). There is nothing to install.

```sh
# from the root of this repository
node --test pathways/bookings/test/            # the unit and situation tests
node pathways/bookings/scripts/hand-check.ts   # the hand check; add --all to see every check
```

The hand check opens with "Stand-ins, not the Geometer engine. Hand-run check for the Phase 0 prototype." and then prints a count in the product's words: `Held N of M. K failed. J not tested.`, the checks that failed, and what was not tested. It counts situations; it does not grade the agent.

## What the customer sees

```text
Customer: कल शाम 6 बजे हेयरकट, 300 में हो जाएगा?
Agent:    हमारा हेयरकट ₹450 का है, इससे कम में नहीं हो पाएगा। हमारा हेयरकट ₹450 है।
          बुधवार, 4 नवंबर, शाम 6:00 बजे खाली है। ₹200 जमा करके पक्का करें: https://rzp.io/l/… (स्लॉट 15 मिनट के लिए रोका गया है।)
```

Every amount, date, time, service and link in a message is written from the booking's record by a fixed template, then read back from the final text and checked against the record before it is sent. In v0 there is no model-written text.

## Settings: tailoring without code

One JSON file per business. [`settings/glow-salon.example.json`](settings/glow-salon.example.json) is a complete example. Mistakes are listed all at once, in plain words, for example: `Service "haircut" needs a price in whole rupees ("priceInr"), for example 450.`

| Setting | What it covers |
| --- | --- |
| `name`, `address` | The business |
| `timezone` | Default `Asia/Kolkata`. Dates such as "कल" are read in this zone |
| `services` | Each has an `id`, `names` per language (the first is what the agent says; the rest are synonyms, including Hindi), `priceInr` in whole rupees (**also the price floor**) and `durationMinutes` |
| `openingHours` | Per weekday, `{ "open": "10:00", "close": "20:00" }`, or `null` when closed |
| `slotMinutes`, `bufferMinutes` | Bookings start on this grid; this gap is kept between bookings |
| `deposit` | `amountInr`, and `holdMinutes` (default 15) |
| `cancellation` | `windowHours`: cancel at least this long before the start and the deposit is refunded. `refundLimitInr`: the agent refunds up to and including this amount alone; above it the owner must approve |
| `languages` | `["hi", "en"]` by default; the first is the default |
| `owner` | `whatsapp` number, and `language` for the owner's messages (default `en`) |
| `reminders` | `hoursBefore`, default `[24, 2]` |

## The rules, in plain words

These are pure checks in [`src/limits.ts`](src/limits.ts). Each reads only its arguments and returns `{ verdict: allow | block | hold_for_owner, ruleId, reason }`, so Guard can later run the same functions outside the AI. In v0 the agent calls them in-process.

| Rule | In plain words |
| --- | --- |
| `price-at-or-above-list` | Never quote or agree below the price list |
| `within-hours` | Never book outside opening hours (or between two slots) |
| `no-double-booking` | One customer per slot; holds count, and the gap between bookings is kept |
| `confirm-only-when-recorded` | Say "booked" only when the calendar shows it **and** the deposit is recorded, both read back from the services |
| `one-deposit-per-booking` | A second payment is not another deposit: refund it within the limit, and tell the owner |
| `refund-limit` | A refund above the limit, or for a late cancellation, needs the owner's approval. "Within the limit" includes the limit itself |
| `no-message-after-stop` | No reminder after a cancellation, a finished booking or STOP |
| `message-matches-record` | Every amount, date, time and link in a message equals the record. Anything unexplained blocks the message |
| `opt-out` | STOP ends all messages to the customer. No reply, no reminder |

## How a booking moves

```text
enquiry -> confirming_details -> awaiting_deposit -> confirmed -> completed
              (if a weekday phrase or    |   \                \-> cancelled (refund within limit, or ask the owner)
               a bare "6 बजे" was used)   |    \-> needs_owner (paid, but the calendar cannot confirm)
                                          \-> expired (hold ran out; a late payment re-holds the slot if it is free, else is refunded)
```

`agent.handle(event)` takes one inbound message, one payment event, or one clock tick, and returns. Each step is separate, so the engine can drive it as a task later.

## How "done" is decided

Every write to a service is followed by a read from that service's own store. Only the read is recorded as `confirmed`; a reply that says "ok" is only `attempted`. After a lost reply the agent looks (by booking id) before it retries. Payment events only tell the agent to look: it reconciles from the payments service's record, so a late, duplicated or missing event cannot change what it believes. The record ([`src/record.ts`](src/record.ts)) is append-only and keeps customer text as a digest only.

## Loose dates and times

| Phrase | Read as |
| --- | --- |
| आज / today, कल / tomorrow, परसों / the day after | The calendar date in the business's zone. (कल also means yesterday in Hindi; bookings are only for the future, so it means tomorrow) |
| अगले मंगलवार / next Tuesday | The Tuesday in the **next calendar week** (weeks run Monday to Sunday). Said on Tue 3 Nov: Tue 10 Nov |
| इस मंगलवार / this Tuesday | That day in the current week, today included; if it has passed, the next one |
| मंगलवार / Tuesday | The first such day **after** today |
| "6 बजे", "10:30" without am/pm | The reading that falls inside opening hours |

For any weekday phrase or guessed am/pm, the agent writes back the full date and time ("मंगलवार, 10 नवंबर, शाम 6:00 बजे") and places **no hold** until the customer says yes.

## What is in the folder

```text
settings/glow-salon.example.json   a complete example business
src/settings.ts                    settings types and hand-written validation
src/record.ts                      the append-only action record
src/limits.ts                      the nine rules as pure checks
src/booking.ts, src/agent.ts       the state machine and the agent
src/adapters/                      calendar, payments, messaging fakes; the intent parser seam
src/language/                      templates (hi, en), the outgoing check, date and time phrases
src/harness.ts                     the fakes wired to the agent, for tests and the hand check
crash-test/situations.ts           the crash-test situations, judged from the fakes' own records
test/                              unit tests, plus one test per situation
scripts/hand-check.ts              the hand check
Explanation.md, Deferred.md        how it was built and why; what is left open and why
```

## What is not done yet

- **Real services.** No real WhatsApp provider, Razorpay or Google Calendar adapter. The fakes are shaped like them so an adapter can replace each.
- **Guard.** The limits run in the agent's own process. Nothing outside the AI enforces them yet, and nothing fails closed if the agent is compromised.
- **The engine crash test.** The situations here are hand-written and run on in-memory fakes. Simulated services, injected faults at every step, exact replay and saved checks are the engine's job (Phase 2).
- **Model-written text.** Messages are templates only. The model parser is a stub that is never called (`createOpenAICompatibleParser`).
- **The monthly client report, the builder panel, hosting, restarts and persistence** (state is in memory), and **Malayalam** and other languages.

The full list, with a reason and a trigger for each, is in [Deferred.md](Deferred.md). What the hand check does not test is printed every time it runs.

## Not a claim

A pathway core checked against stand-in services and a rule-based parser. A result says that these situations held within what was tried, nothing more. Licence: Apache-2.0 (see [../../LICENSE](../../LICENSE)).
