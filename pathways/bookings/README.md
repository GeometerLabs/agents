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
node pathways/bookings/scripts/hand-check.ts   # the hand check; add --details to see what was done in each situation
```

The hand check opens with "Stand-ins, not the Geometer engine. Hand-run check for the Phase 0 prototype." and then prints a count in the product's words: `Held N of M. K failed. J not tested.`, the checks that failed, and what was not tested. It counts situations; it does not grade the agent.

## Show it to a shop

A demo mode a partner runs on a laptop and opens on the shop owner's own phone. It is the **real agent** running on the in-memory stand-ins with a fake clock: **test money only, nothing real is contacted, nothing is saved.** A banner on every screen says so ("Demo · test money · nothing real is sent").

```sh
# from the root of this repository; both devices on the same Wi-Fi
node pathways/bookings/demo/server.ts                      # Glow Salon, English
node pathways/bookings/demo/server.ts --lang hi            # start in Hindi (any language in LANGUAGES)
node pathways/bookings/demo/server.ts --settings my-shop.json --port 8787
```

It prints the addresses to open, for example `http://192.168.1.23:8787` for the phone. If the phone cannot open it: put both on the same Wi-Fi (a guest network that separates devices will not work), or turn on the phone's hotspot and join the laptop to it. It listens only on this computer and your private network addresses, and answers nothing that comes from the internet. There is no login, so **never open the port to the internet**.

**Three tabs, phone-sized**

| Tab | What it shows |
| --- | --- |
| Customer | A WhatsApp-like chat. Type as a customer in any supported language, or tap a suggestion written for this shop. Buttons: pay the deposit (test money), pay it twice, 1 hour or 1 day passes (holds expire, reminders go out), cancel, start again |
| Owner | What the owner sees, in the shop's language, in big plain words: requests waiting for an answer with **Approve** and **Deny** buttons (they send the owner's command to the agent), then lines such as "It said no to ₹300", "The booking it made is in your calendar. We checked.", "It asked you before giving money back", "We didn't check: phone calls", and the owner's WhatsApp messages |
| What we did | Hidden until you tap **Show what we did ▸**. The action record (each action, whether it was confirmed from the service's own record, every rule's decision in plain words), a work-done line, and what the stand-in calendar and payments service hold |

**Make it the shop's own in 30 seconds.** Tap **Set up for this shop**: name, up to four services with prices, deposit, opening hours, language. The check that reads settings files reads this form too, and its plain-words mistakes show on the form. The demo then starts again with the shop's own menu. The shop is kept for every device on this server, so you can set it up on the laptop and open it on the phone. The refund limit is raised to at least the deposit, so a second payment is handed back straight away; late cancellations still ask the owner.

**A 60-second script**

1. *(10 s)* Set up for this shop, or leave Glow Salon. Open **Customer**.
2. *(15 s)* **A discount is refused.** Tap the suggestion with a lower price ("...can you do it for ₹300?"). The agent states the list price once and sends the deposit link, never the offer. Open **Owner**: "It said no to ₹300. It never goes below your price."
3. *(15 s)* **Paying twice.** Tap **Pay it twice**. One booking, and the extra payment goes back. Owner: "Someone paid twice. The extra ₹200 went back to them."
4. *(15 s)* **A confusing date.** Tap **Start again**, then the suggestion with "next" and a weekday (for example "next Friday"). The agent writes the full date back and holds nothing until the customer says yes.
5. *(optional, 15 s)* **It asks first.** Book, pay, tap **1 day passes**, tap **Cancel the booking**. Owner: "Give back ₹200?" with Approve and Deny. (The agent asks only when the cancellation is less than 24 hours before the start. If the suggestion said "the day after tomorrow" because tomorrow is a closed day, tap **1 day passes** twice first; for a later weekday, until it is the day before.)
6. If the owner (or a friend who codes) wants proof, tap **Show what we did ▸**.

**What this is not.** A demo of the pathway on stand-ins. The owner's lines are counted from the stand-ins' records, so they show what happened in the demo, not a claim about a live shop. The "We didn't check" line is always shown. The clock is a fake clock that starts on today's real date at 10:00 in the shop's time zone and moves only when you tap.

## What the customer sees

```text
Customer: कल शाम 6 बजे हेयरकट, 300 में हो जाएगा?
Agent:    हमारा हेयरकट ₹450 का है, इससे कम में नहीं हो पाएगा। बुधवार, 4 नवंबर, शाम 6:00 बजे खाली है।
          ₹200 जमा करके पक्का करें: https://rzp.io/l/… (स्लॉट 15 मिनट के लिए रोका गया है।)
```

Every amount, date, time, service and link in a message is written from the booking's record by a fixed template, then read back from the final text and checked against the record's values before it is sent. In v0 there is no model-written text.

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
| `message-matches-record` | Every amount, date, time and link in a message is a value from this booking's record; anything the record cannot explain blocks the message. It compares values, not which label a value sits under (see [Deferred.md](Deferred.md)) |
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
test/                              unit tests, plus one test per situation; test/demo.test.ts drives the demo through its HTTP endpoints
scripts/hand-check.ts              the hand check
demo/                              the partner demo: server.ts (start it), app.ts (web server and limits), session.ts (a world and its buttons),
                                   view.ts (the owner's summary and the record), personalise.ts (the shop form), strings.ts, page.ts/.css/.js
Explanation.md, Deferred.md        how it was built and why; what is left open and why
```

## What is not done yet

- **Real services.** No real WhatsApp provider, Razorpay or Google Calendar adapter. The fakes are shaped like them so an adapter can replace each.
- **Guard.** The limits run in the agent's own process. Nothing outside the AI enforces them yet, and nothing fails closed if the agent is compromised.
- **The engine crash test.** The situations here are hand-written and run on in-memory fakes. Simulated services, injected faults at every step, exact replay and saved checks are the engine's job (Phase 2).
- **Model-written text.** Messages are templates only. The model parser is a stub that is never called (`createOpenAICompatibleParser`).
- **The monthly client report, the builder panel, hosting, restarts and persistence** (state is in memory), and **Malayalam** and other languages. The demo above is local only; a hosted demo link is not built.

The full list, with a reason and a trigger for each, is in [Deferred.md](Deferred.md). What the hand check does not test is printed every time it runs.

## Not a claim

A pathway core checked against stand-in services and a rule-based parser. A result says that these situations held within what was tried, nothing more. Licence: Apache-2.0 (see [../../LICENSE](../../LICENSE)).
