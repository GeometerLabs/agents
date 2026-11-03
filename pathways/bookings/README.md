# Bookings pathway (v0 core)

Market: Commerce and support (bookings).

A WhatsApp agent for businesses that take bookings with a deposit and a cancellation rule: salons, tuition centres, fitness studios and home services. A customer writes in Hindi, English, Malayalam or Kannada; the agent holds a slot, sends a deposit link, books only when the calendar and the payment record both agree, reminds the customer, and handles cancellations, refunds and rescheduling, asking the owner when a decision is theirs.

**What this folder is, and is not.** It is the v0 core of the pathway, built and checked against **stand-in services in memory**. It is **not the Geometer engine**, it talks to no real WhatsApp, Razorpay or calendar, and nothing here has been run against a real business. The "hand check" below is a hand-run check for the Phase 0 prototype, not the engine's crash test.

It has no dependencies. The agent and its tests make no network call outside this computer: the server, the live adapters, the inbox and the stand-ins talk HTTP, but only to each other on ports you choose, and only the dev forwarder can reach a real service. The rule parser reads the messages; a model parser exists too (see "Choose the model"), but nothing uses it until you point it at a model. TypeScript is run directly by Node's built-in type stripping.

## Run it

You need Node 26 (any Node with built-in TypeScript type stripping works). There is nothing to install.

```sh
# from the root of this repository
node --test pathways/bookings/test/            # the unit and situation tests
node pathways/bookings/scripts/hand-check.ts   # the hand check; add --details to see what was done in each situation
node pathways/bookings/scripts/review-sheet.ts ml   # the Malayalam review sheet (kn for Kannada), see Languages below
node pathways/bookings/scripts/model-eval.ts        # the model eval: the rule parser baseline, plus any model whose key is in .env (see Choose the model)
```

The hand check opens with "Stand-ins, not the Geometer engine. Hand-run check for the Phase 0 prototype." and then prints a count in the product's words: `Held N of M. K failed. J not tested.`, the checks that failed, and what was not tested. It counts situations; it does not grade the agent.

## Run it against stand-ins / against test mode

The same agent code can talk to the real wire formats of Razorpay, Google Calendar and WhatsApp. The live adapters (`src/adapters/live/`) hold **no keys** and send **no Authorization header**: each one points at a base URL, which in production is a Guard instance in front of that one service. Only that URL changes between a test, a demo, a stand-in and the real thing.

```ts
import { createLiveAdapters } from "./src/adapters/live/index.ts";
const { payments, calendar, messaging } = createLiveAdapters(
  { payments: { baseUrl }, calendar: { baseUrl, calendarId }, messaging: { baseUrl, phoneNumberId } },
  { clock, window }, // window: the runtime's own record of when each customer last wrote
);
```

**One command for the whole local stack.** From `pathways/bookings`, `npm run stack` starts the stand-ins, the inbox and a runtime in live mode against them, on a temp copy of the example client (`-- --client <folder>` for another, `-- --free-ports` if 8790, 8788 or 8780 are taken).
It prints the URLs and three `curl`s: a customer writes, they pay the deposit link, read what the stand-ins hold. The secrets are generated into a temp folder, never into the repository, and Ctrl+C removes it with everything else. `test/full-chain.test.ts` runs the same chain.

**Against stand-ins** (nothing real, no keys, no network beyond this computer). The stand-ins speak the three wire formats over HTTP in front of the same in-memory fakes the tests use, and deliver signed webhooks like the providers do:

```sh
# from the root of this repository. The inbox reads each secret from a file; the stand-ins sign with these default values.
mkdir -p /tmp/geometer-dev
printf 'standin-razorpay-webhook-secret' > /tmp/geometer-dev/rzp
printf 'standin-whatsapp-app-secret'     > /tmp/geometer-dev/app
printf 'any-verify-token'                > /tmp/geometer-dev/verify
printf 'any-internal-token'              > /tmp/geometer-dev/token

node pathways/bookings/standins/main.ts --port 8790 --inbox http://127.0.0.1:8788      # the stand-in services
RUNTIME_URL=http://127.0.0.1:8787 INTERNAL_TOKEN_FILE=/tmp/geometer-dev/token RAZORPAY_WEBHOOK_SECRET_FILE=/tmp/geometer-dev/rzp \
  WHATSAPP_APP_SECRET_FILE=/tmp/geometer-dev/app WHATSAPP_VERIFY_TOKEN_FILE=/tmp/geometer-dev/verify PORT=8788 \
  node pathways/bookings/inbox/main.ts                                                  # the inbox, in another terminal

# a customer writes (the stand-in delivers a signed webhook to the inbox, which hands it to the runtime at RUNTIME_URL):
curl -s -X POST localhost:8790/_standin/whatsapp/inbound -d '{"from":"+919811111111","text":"haircut tomorrow at 6pm"}'
curl -s localhost:8790/_standin/state                  # the outbox, links, refunds, events and calendar the fakes hold
curl -s -X POST localhost:8790/_standin/razorpay/pay -d '{"link_id":"plink_1"}'   # the customer pays a link (use an id from "links" in the state)
curl -s -X POST localhost:8790/_standin/fault -d '{"service":"calendar","op":"insert","mode":"silentFailure"}'   # make the next calendar save do nothing
```

The scripts are `npm run standins` and `npm run inbox` (inside `pathways/bookings`). The inbox is its own process because it holds the webhook secrets, so the agent runtime never does. WhatsApp webhooks are verified by Meta's signature (the default), or, for a provider that does not sign (Gupshup), by a token in the URL (`WHATSAPP_VERIFICATION=path-token`, `WHATSAPP_PATH_TOKEN_FILE`, optionally `WHATSAPP_ALLOWED_SOURCES`); the second is weaker, see Explanation.md 7b. The tests start both on free ports (`test/standins.test.ts` runs the adapters and the agent against the stand-ins over real HTTP, `test/e2e.test.ts` goes from a stand-in WhatsApp message through a signed webhook and the inbox to a runtime).

**Against real test-mode services, before Guard is configured** (Phase 0 only): the dev forwarder adds the credential and passes each call on to the real host. It has no limits and no record, refuses any Razorpay key that does not start with `rzp_test_`, and prints that in a banner.

```sh
cp .env.example .env        # at the repository root; git ignores .env. Fill in what you want to try; names only are in the example.
node pathways/bookings/standins/dev-forwarder.ts --port 8791     # npm run dev-forwarder
# base URLs for createLiveAdapters:  http://127.0.0.1:8791/razorpay   /google   /whatsapp
```

WhatsApp is written for Meta's Cloud API shape (Graph v26.0). The provider is not chosen yet, so a provider sandbox that uses other paths needs its own small mapping first. A live "confirmed" message means WhatsApp **accepted** it; WhatsApp has no endpoint to read a message back, and delivery status webhooks are not handled yet. The templates to submit to Meta are in `whatsapp-templates.json` (`node scripts/whatsapp-templates.ts` prints them). Design and decisions: Explanation.md, "Live services". What is left: Deferred.md.

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
| `runtime.json` | `mode` (`"fakes"` for a local run, `"live"` for real services through Guard), `host` (default 127.0.0.1), `port` (default 8780), `dataDir` (default `data`, inside the client folder, never commit it), `tickSeconds` (default 30), for live `services`: the base URL of the Guard in front of payments, the calendar and messaging, and optionally `parser`: the model that reads messages, see "Choose the model" (left out, the rule parser does) |
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

In `fakes` mode the stand-in WhatsApp prints what it is asked to send, and the stand-in services forget everything when the process stops, so use a new data folder for each local run. If the process dies in the middle of a step, the step runs again from the last saved state; read "Running it as a server" in [Explanation.md](Explanation.md) for what that means for a WhatsApp message. Live mode uses the live adapters (`src/adapters/live/`); `npm run stack` runs a client in live mode against the stand-ins.

## The monthly report and the certificates

What a shop is given, in its language (Hindi, English, Malayalam, Kannada, or Hindi and English together): a five-line WhatsApp text it can read in ten seconds, a printable page behind it ("Show what we did ▸" for the detail), a go-live certificate before it switches on, and a monthly record certificate. Everything is counted from the action record; nothing is written by a model. They state facts and list what was **not** tested or not counted on every document; they never say "safe", "guaranteed" or "certified", and they make no earnings claim. Phase 1 documents say the checks were run by hand, and the go-live certificate says it was against stand-in services.

```sh
# from the root of this repository
node pathways/bookings/scripts/report-example.ts                 # a sample of everything, from a scripted busy month, into pathways/bookings/report-sample/ (git-ignored)
node pathways/bookings/scripts/report-key.ts ~/geometer-keys     # make the signing key, outside any repository
node pathways/bookings/scripts/client-report.ts --settings shop.json --record entries.json --bookings bookings.json \
     --month 2026-11 --lang hi --out ./out --source stand-in --key ~/geometer-keys/report-key.pem
node pathways/bookings/scripts/go-live-certificate.ts --settings shop.json --lang hi --out ./out --key ~/geometer-keys/report-key.pem
node pathways/bookings/scripts/verify-report.ts ./out/report-2026-11.json --trust-key ~/geometer-keys/report-key.pub.pem
```

`--source` (stand-in, test-mode or live) is required and printed on every layer. `--lang both` writes the Hindi and English messages separately and one page with both. A signature shows who issued a document and that it has not changed; it does not show the numbers are true. How it works, and what is not built (the verify page on geometer.dev, a QR code, the Guard anchor): [Explanation.md](Explanation.md) and [Deferred.md](Deferred.md).

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

## Choose the model

Geometer bundles one model (decision 6 in the implementation plan). The eval picks it: it reads 136 labelled customer messages (about 33 each in Hindi, English, Malayalam and Kannada, with Hinglish, Manglish and Kanglish, typos, cancels, reschedules, haggling and "ignore your rules" tricks) and scores the rule parser and each candidate on the same ones. The labels are machine-written and **need a native speaker's review** before a result decides anything.

```sh
# 1. Put the keys you have in a file called .env at the root of this repository. Git ignores it. One line per provider:
#      ANTHROPIC_API_KEY=...
#      GEMINI_API_KEY=...
#      SARVAM_API_KEY=...
#      GROQ_API_KEY=...
#      OPENAI_API_KEY=...
# 2. Check the candidates in pathways/bookings/eval/models.json (name, wire, base URL, model id, the key's name, and the price
#    per million input and output tokens, left empty until you fill it in from the provider's current price page).
# 3. Run the eval from the root of this repository:
node pathways/bookings/scripts/model-eval.ts --max-messages 40      # a cheap first look: 40 messages, spread over the four languages
node pathways/bookings/scripts/model-eval.ts                        # all 136 messages
node pathways/bookings/scripts/model-eval.ts --only claude-haiku-5-5 --only gemini-3.5-flash-lite
```

It prints one table with a column for the rule parser (the baseline) and one for each model that has a key: how often all six fields were right (kind, service, date, time, offered price, and the trick flag), by language and by field; how often the model could not be used and the rule parser read the message instead; p50 and p95 latency; the tokens used; and the cost of 1,000 messages from the tokens the API reported. A candidate with no key in `.env` is skipped with a line saying so; with no keys at all only the baseline runs. Each model call costs a little, so `--max-messages` caps how many are sent, and the token totals are printed. The full results go to `eval/results.json`, which git ignores. Keys are read and sent by the eval script only (`scripts/eval-keys.ts`); the pathway's own model parser holds no key.

To use a model, give the client a `parser` in its `runtime.json` (the rule parser stays the default everywhere), or build it in code:

```json
"parser": { "wire": "openai", "baseUrl": "https://your-guard.example/model/v1", "model": "...", "timeoutMs": 8000 }
```

```ts
import { createModelParser } from "./src/adapters/model-llm.ts";
const parser = createModelParser({ wire: "openai", baseUrl: "https://your-guard.example/model/v1", model: "..." }); // wire: "openai" | "anthropic"; the same fields
```

`runtime.json` takes no key, and refuses a `baseUrl` that carries one (a user name, a password, a query), in plain words. In production `baseUrl` is a Guard instance in front of the model provider, and Guard adds the key. If the model times out (8 seconds unless `timeoutMs` says otherwise), answers with an error, or gives an answer that is not a valid intent, the rule parser reads the message and the record says why.

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
src/adapters/                      calendar, payments, messaging fakes; the intent parser seam (model.ts), the rule parser, and the model
                                   parser over HTTP (model-llm.ts, with its prompt and answer schema in model-prompt.ts)
src/adapters/live/                 the same three over Razorpay, Google Calendar and WhatsApp wire formats (no keys), and webhooks.ts
src/language/meta-templates.ts     the WhatsApp templates in Meta's form; whatsapp-templates.json is the list to submit
inbox/                             the webhook inbox: its own process, holds the webhook secrets, verifies, forwards to the runtime
standins/                          the three wire formats over HTTP in front of the fakes; dev-forwarder.ts for real test-mode services
src/language/                      templates (hi, en, ml, kn), the outgoing check, date and time phrases;
                                   words.ts: the Malayalam and Kannada words customers use, as plain lists
src/harness.ts                     the fakes wired to the agent, for tests and the hand check
server/                            the runtime server: main.ts (command line), start.ts (read the client folder, wire, listen), config.ts,
                                   runtime.ts (a step is saved whole), tasks.ts (one at a time, retries), store.ts (SQLite), snapshot.ts,
                                   events.ts, server.ts (HTTP), ticker.ts, services.ts (fakes or live)
clients/glow-salon.example/        an example client folder: settings.json, runtime.json, pathway.lock
crash-test/situations.ts           the crash-test situations, judged from the fakes' own records
crash-test/not-tested.ts           what the hand check does not cover (printed by it, carried by the go-live certificate)
report/                            the monthly report and the certificates: data.ts (counts), text.ts (owner's five lines), html.ts (the page),
                                   certificate.ts, strings.ts (every word, per language, and the banned words), sign.ts (seal and check),
                                   keys.ts (the key pair), run.ts and cli.ts (the scripts' work), example-month.ts (a scripted busy month)
scripts/report-key.ts, client-report.ts, go-live-certificate.ts, verify-report.ts, report-example.ts
test/                              unit tests, plus one test per situation; test/demo.test.ts drives the demo through its HTTP endpoints;
                                   the runtime server's tests (runtime, store, server, ticker, config, start) use test/runtime-kit.ts
scripts/hand-check.ts              the hand check
demo/                              the partner demo: server.ts (start it), app.ts (web server and limits), session.ts (a world and its buttons),
                                   view.ts (the owner's summary and the record), personalise.ts (the shop form), strings.ts, page.ts/.css/.js
scripts/review-sheet.ts            writes REVIEW-ml.md and REVIEW-kn.md from the templates and word lists
scripts/model-eval.ts              the model eval (eval-score.ts scores it, eval-keys.ts reads the keys: laptop only)
eval/                              messages.jsonl (the labelled messages), models.json (the candidates); results.json is git-ignored
REVIEW-ml.md, REVIEW-kn.md         every Malayalam and Kannada line, for a native speaker to mark OK or change
Explanation.md, Deferred.md        how it was built and why; what is left open and why
```

## What is not done yet

- **Real services.** The live adapters, the inbox and the stand-ins are written and tested, but only against the stand-ins and the providers' own sample payloads. Nothing here has talked to a real Razorpay, Google or WhatsApp account yet, and the WhatsApp provider is not chosen.
- **Guard.** The limits run in the agent's own process. Nothing outside the AI enforces them yet, and nothing fails closed if the agent is compromised.
- **The engine crash test.** The situations here are hand-written and run on in-memory fakes. Simulated services, injected faults at every step, exact replay and saved checks are the engine's job (Phase 2).
- **Model-written text.** Messages are templates only. The model parser only reads a customer's message into an intent. It is built and tested against a local stub server, **not yet run against a real model**, and the agent uses the rule parser unless it is given the model parser.
- **The builder panel, hosting and sending the report**, and **Tamil, Telugu** and other languages. (Restarts and persistence are built, in `server/`; the report and certificates are built, in `report/`.) Malayalam and Kannada are built but **not yet reviewed by a native speaker**. The demo (see "Show it to a shop") is local only; a hosted demo link is not built.

The full list, with a reason and a trigger for each, is in [Deferred.md](Deferred.md). What the hand check does not test is printed every time it runs.

## Not a claim

A pathway core checked against stand-in services and a rule-based parser. A result says that these situations held within what was tried, nothing more. Licence: Apache-2.0 (see [../../LICENSE](../../LICENSE)).
