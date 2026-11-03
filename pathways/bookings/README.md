# Bookings pathway (v0 core)

Market: Commerce and support (bookings).

A WhatsApp agent for businesses that take bookings with a deposit and a cancellation rule: salons, tuition centres, fitness studios and home services. A customer writes in Hindi, English, Malayalam or Kannada; the agent holds a slot, sends a deposit link, books only when the calendar and the payment record both agree, reminds the customer, and handles cancellations, refunds and rescheduling, asking the owner when a decision is theirs.

**What this folder is, and is not.** It is the v0 core of the pathway, built and checked against **stand-in services in memory**. It is **not the Geometer engine**, it talks to no real WhatsApp, Razorpay or calendar, and nothing here has been run against a real business. The "hand check" below is a hand-run check for the Phase 0 prototype, not the engine's crash test.

It has no dependencies. The agent and its tests make no network call off this computer (the server in `server/` listens on a port you choose, see "Run the agent as a server"). TypeScript is run directly by Node's built-in type stripping.

## Run it

You need Node 26 (any Node with built-in TypeScript type stripping works). There is nothing to install.

```sh
# from the root of this repository
node --test pathways/bookings/test/            # the unit and situation tests
node pathways/bookings/scripts/hand-check.ts   # the hand check; add --details to see what was done in each situation
node pathways/bookings/scripts/review-sheet.ts ml   # the Malayalam review sheet (kn for Kannada), see Languages below
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

## Run the agent as a server

`server/` runs one client's agent live: it saves every incoming event as a task before it answers, handles one task at a time, saves the agent's state after each step, and picks up where it stopped after a restart. Two pieces it does not contain: the inbox, which checks each provider's webhook signature and forwards the event to it, and Guard, which holds the service keys. The runtime holds no secret of either kind.

```sh
# from the root of this repository
openssl rand -hex 32 > /tmp/inbox-token                                 # the secret the inbox sends as a bearer token
INTERNAL_TOKEN_FILE=/tmp/inbox-token npm run serve --prefix pathways/bookings -- --client clients/glow-salon.example
```

A client is a folder (`clients/glow-salon.example/` is a working example that runs on the stand-in services):

| File | What it holds |
| --- | --- |
| `settings.json` | The business: the same format as `settings/glow-salon.example.json` |
| `runtime.json` | `mode` (`"fakes"` for a local run, `"live"` for real services through Guard), `host` (default 127.0.0.1), `port` (default 8780), `dataDir` (default `data`, inside the client folder, never commit it), `tickSeconds` (default 30) and, for live, `services`: the base URL of the Guard in front of payments, the calendar and messaging |
| `pathway.lock` | The pathway version this client is pinned to, for example `bookings@0.1.0`. The runtime refuses to start if it is not the version it is (`package.json`), and prints both |

What it answers:

| Request | Answer |
| --- | --- |
| `POST /internal/events` with `Authorization: Bearer <token>` and `{"events": [{"kind": "message", "message": {...}}, {"kind": "payment_event", "event": {...}}]}` | `200 {"saved": n, "duplicates": m}` once the events are on disk. An event id seen before is a no-op. Anything else (401, 400, 413, 500) means "not saved, send it again" |
| `GET /healthz` | The process is up |
| `GET /readyz` | 200 if the store can be read and the queue is going, otherwise 503 |
| `GET /status` with the token | Counts only, never message content: bookings by state, tasks pending, done and failed, the last step, the record length, the pathway version |

```sh
curl -s localhost:8780/internal/events -H "Authorization: Bearer $(cat /tmp/inbox-token)" \
  -d '{"events":[{"kind":"message","message":{"id":"wamid.1","from":"+919811111111","text":"I want a haircut tomorrow at 6pm","timestamp":'$(date +%s)'000}}]}'
```

In `fakes` mode the stand-in WhatsApp prints what it is asked to send, and the stand-in services forget everything when the process stops, so use a new data folder for each local run. If the process dies in the middle of a step, the step runs again from the last saved state; read "Running it as a server" in [Explanation.md](Explanation.md) for what that means for a WhatsApp message. Live mode needs the live adapters (`src/adapters/live/`), which are built on another branch and say so plainly when missing.

## What the customer sees

```text
Customer: कल शाम 6 बजे हेयरकट, 300 में हो जाएगा?
Agent:    हमारा हेयरकट ₹450 का है, इससे कम में नहीं हो पाएगा। बुधवार, 4 नवंबर, शाम 6:00 बजे खाली है।
          ₹200 जमा करके पक्का करें: https://rzp.io/l/… (स्लॉट 15 मिनट के लिए रोका गया है।)
```

Every amount, date, time, service and link in a message is written from the booking's record by a fixed template, then read back from the final text and checked against the record's values before it is sent. In v0 there is no model-written text.

## Languages

Hindi and English were first. **Malayalam (`ml`) and Kannada (`kn`)** are added: the same messages, the same checks, the same rules. A customer is answered in the language of their last message (by its script, or by the Latin-letter words people type, "nale 6 mani haircut venam"); a bare "yes" keeps the language they were using.

```text
Customer: നാളെ വൈകുന്നേരം 6 മണിക്ക് ഹെയർകട്ട്, 300 രൂപയ്ക്ക് ചെയ്യാമോ?
Agent:    ഹെയർകട്ട് വില ₹450 ആണ്. ക്ഷമിക്കണം, ഇതിൽ കുറയ്ക്കാൻ കഴിയില്ല. ബുധൻ, 4 നവംബർ, വൈകുന്നേരം 6:00 ഒഴിവുണ്ട്.
          ബുക്കിംഗ് ഉറപ്പിക്കാൻ ₹200 അഡ്വാൻസ് അടയ്ക്കൂ: https://rzp.io/l/… (ഈ സമയം 15 മിനിറ്റ് നിങ്ങൾക്കായി മാറ്റിവച്ചിട്ടുണ്ട്.)

Customer: ನಾಳೆ ಸಂಜೆ 6 ಗಂಟೆಗೆ ಹೇರ್ ಕಟ್ ಬೇಕು, 300ಕ್ಕೆ ಮಾಡ್ತೀರಾ?
Agent:    ಹೇರ್ ಕಟ್ ಬೆಲೆ ₹450. ಕ್ಷಮಿಸಿ, ಇದಕ್ಕಿಂತ ಕಡಿಮೆ ಮಾಡಲು ಸಾಧ್ಯವಿಲ್ಲ. ಬುಧವಾರ, 4 ನವೆಂಬರ್, ಸಂಜೆ 6:00 ಖಾಲಿ ಇದೆ.
          ಬುಕಿಂಗ್ ಖಚಿತಪಡಿಸಲು ₹200 ಮುಂಗಡ ಹಣ ಪಾವತಿಸಿ: https://rzp.io/l/… (ಈ ಸಮಯವನ್ನು 15 ನಿಮಿಷ ನಿಮಗಾಗಿ ಕಾಯ್ದಿರಿಸಲಾಗಿದೆ.)
```

| Written in the messages | Hindi | English | Malayalam | Kannada |
| --- | --- | --- | --- | --- |
| Date | मंगलवार, 10 नवंबर | Tue 10 Nov | ചൊവ്വ, 10 നവംബർ | ಮಂಗಳವಾರ, 10 ನವೆಂಬರ್ |
| Time | शाम 6:00 बजे | 6:00 pm | വൈകുന്നേരം 6:00 | ಸಂಜೆ 6:00 |
| Amount | ₹450 | ₹450 | ₹450 | ₹450 |

- **Amounts, dates, times, service names and links are always filled in from the record**, never translated. Amounts are written with Western digits (₹450) in every language. The outgoing check knows the Malayalam and Kannada weekday, month and part-of-the-day words, so a wrong date, time or amount in any of the four languages is blocked, and anything it cannot explain is blocked too.
- The agent never glues an ending onto a shop's service name or business name (Malayalam and Kannada endings change with the last letter of the word), so a message reads right for any shop's names.
- Owner commands stay `approve b-1`, `deny b-1`, `retry b-1` in Latin letters, explained in the owner's language (set `owner.language`).
- **Machine-written, not yet read by a native speaker.** [REVIEW-ml.md](REVIEW-ml.md) and [REVIEW-kn.md](REVIEW-kn.md) list every Malayalam and Kannada message and every word the agent understands, with a column for the native reviewer. No real shop should use these two languages before that review. The sheets are made by `node pathways/bookings/scripts/review-sheet.ts ml` (or `kn`), and a test fails if a sheet falls behind the templates.
- Adding another language (Tamil and Telugu are next) means adding its entry to each per-language table: the type system refuses to build without a template for every message and a name for every weekday and month. Its customer words go in [`src/language/words.ts`](src/language/words.ts).

## Settings: tailoring without code

One JSON file per business. [`settings/glow-salon.example.json`](settings/glow-salon.example.json) is a complete example. Mistakes are listed all at once, in plain words, for example: `Service "haircut" needs a price in whole rupees ("priceInr"), for example 450.`

| Setting | What it covers |
| --- | --- |
| `name`, `address` | The business |
| `timezone` | Default `Asia/Kolkata`. Dates such as "कल" are read in this zone |
| `services` | Each has an `id`, `names` per language (the first is what the agent says; the rest are synonyms, including Hindi, Malayalam and Kannada), `priceInr` in whole rupees (**also the price floor**) and `durationMinutes` |
| `openingHours` | Per weekday, `{ "open": "10:00", "close": "20:00" }`, or `null` when closed |
| `slotMinutes`, `bufferMinutes` | Bookings start on this grid; this gap is kept between bookings |
| `deposit` | `amountInr`, and `holdMinutes` (default 15) |
| `cancellation` | `windowHours`: cancel at least this long before the start and the deposit is refunded. `refundLimitInr`: the agent refunds up to and including this amount alone; above it the owner must approve |
| `languages` | Any of `"hi"`, `"en"`, `"ml"`, `"kn"`; `["hi", "en"]` by default; the first is the default. Every service needs a name in each language listed |
| `owner` | `whatsapp` number, and `language` for the owner's messages (default `en`; any of the four) |
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
| आज / today, कल / tomorrow, परसों / the day after (ഇന്ന് / നാളെ / മറ്റന്നാൾ, ಇಂದು / ನಾಳೆ / ನಾಡಿದ್ದು) | The calendar date in the business's zone. (कल also means yesterday in Hindi; bookings are only for the future, so it means tomorrow. ഇന്നലെ / ನಿನ್ನೆ, yesterday, is not read as a date) |
| अगले मंगलवार / next Tuesday (അടുത്ത ചൊവ്വാഴ്ച, ಮುಂದಿನ ಮಂಗಳವಾರ) | The Tuesday in the **next calendar week** (weeks run Monday to Sunday). Said on Tue 3 Nov: Tue 10 Nov |
| इस मंगलवार / this Tuesday | That day in the current week, today included; if it has passed, the next one |
| मंगलवार / Tuesday | The first such day **after** today |
| "6 बजे", "6 മണി", "6 ಗಂಟೆ", "10:30" without am/pm | The reading that falls inside opening hours |

For any weekday phrase or guessed am/pm, the agent writes back the full date and time ("मंगलवार, 10 नवंबर, शाम 6:00 बजे") and places **no hold** until the customer says yes.

## What is in the folder

```text
settings/glow-salon.example.json   a complete example business
src/settings.ts                    settings types and hand-written validation
src/record.ts                      the append-only action record
src/limits.ts                      the nine rules as pure checks
src/booking.ts, src/agent.ts       the state machine and the agent
src/adapters/                      calendar, payments, messaging fakes; the intent parser seam
src/language/                      templates (hi, en, ml, kn), the outgoing check, date and time phrases;
                                   words.ts: the Malayalam and Kannada words customers use, as plain lists
src/harness.ts                     the fakes wired to the agent, for tests and the hand check
server/                            the runtime server: main.ts (command line), start.ts (read the client folder, wire, listen), config.ts,
                                   runtime.ts (a step is saved whole), tasks.ts (one at a time, retries), store.ts (SQLite), snapshot.ts,
                                   events.ts, server.ts (HTTP), ticker.ts, services.ts (fakes or live)
clients/glow-salon.example/        an example client folder: settings.json, runtime.json, pathway.lock
crash-test/situations.ts           the crash-test situations, judged from the fakes' own records
test/                              unit tests, plus one test per situation; test/demo.test.ts drives the demo through its HTTP endpoints;
                                   the runtime server's tests (runtime, store, server, ticker, config, start) use test/runtime-kit.ts
scripts/hand-check.ts              the hand check
demo/                              the partner demo: server.ts (start it), app.ts (web server and limits), session.ts (a world and its buttons),
                                   view.ts (the owner's summary and the record), personalise.ts (the shop form), strings.ts, page.ts/.css/.js
scripts/review-sheet.ts            writes REVIEW-ml.md and REVIEW-kn.md from the templates and word lists
REVIEW-ml.md, REVIEW-kn.md         every Malayalam and Kannada line, for a native speaker to mark OK or change
Explanation.md, Deferred.md        how it was built and why; what is left open and why
```

## What is not done yet

- **Real services.** No real WhatsApp provider, Razorpay or Google Calendar adapter. The fakes are shaped like them so an adapter can replace each.
- **Guard.** The limits run in the agent's own process. Nothing outside the AI enforces them yet, and nothing fails closed if the agent is compromised.
- **The engine crash test.** The situations here are hand-written and run on in-memory fakes. Simulated services, injected faults at every step, exact replay and saved checks are the engine's job (Phase 2).
- **Model-written text.** Messages are templates only. The model parser is a stub that is never called (`createOpenAICompatibleParser`).
- **The monthly client report, the builder panel and hosting**, and **Tamil, Telugu** and other languages. (Restarts and persistence are built, in `server/`.) Malayalam and Kannada are built but **not yet reviewed by a native speaker**. The demo (see "Show it to a shop") is local only; a hosted demo link is not built.

The full list, with a reason and a trigger for each, is in [Deferred.md](Deferred.md). What the hand check does not test is printed every time it runs.

## Not a claim

A pathway core checked against stand-in services and a rule-based parser. A result says that these situations held within what was tried, nothing more. Licence: Apache-2.0 (see [../../LICENSE](../../LICENSE)).
