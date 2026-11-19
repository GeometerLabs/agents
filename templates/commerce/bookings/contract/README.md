# The Bookings runtime contract

A suite that describes what a Bookings shop's runtime does **as the outside sees it**, so the TypeScript runtime and the Go runtime (decision 61, wave 2) are held to the same
tests. Every test makes the shop's folder in a temp directory exactly as the deployer does, starts the shop as a **separate process** on a free port, and talks to it **only over
HTTP and the files the deployer writes**. It is the model of `templates/commerce/listings/contract/` (read its README first); the generic pieces (the process tracker, the fake
model, the fake push Guard, the soft passkey authenticator, the test-clock file, the process starter and the HTTP caller) are shared from `modules/test/contract/` and
`modules/channels/test/soft-authenticator.ts`.

```
BOOKINGS_IMPL=ts node --test --test-concurrency=1 templates/commerce/bookings/contract/        # the TypeScript runtime (the default)
BOOKINGS_IMPL=go BOOKINGS_GO_BIN=go/bin/bookings node --test --test-concurrency=1 templates/commerce/bookings/contract/
```

On `go`, when the binary is not there, every test is skipped with the reason "no Go Bookings runtime yet (wave 2)". Any other value of `BOOKINGS_IMPL` stops the run. Nothing
here is TypeScript only.

Part 1 (this file, sections 1 to 6) is the INVENTORY a later agent ports Bookings to Go from. Part 2 (section 7 on) says what the suite is and how to run it.

---------------------------------------------------------------------------------------------------------------------------------------------------------------------------

## 1. The routes a Bookings shop serves

Everything is `modules/runtime/http.ts` (the same server for every template); Bookings gives it `templates/commerce/bookings/server/runtime.ts` (what each route reads) and
`server/start.ts`. Two credentials: the **internal token** (`INTERNAL_TOKEN_FILE`, the inbox's), the **channel token** (`CHANNEL_TOKEN_FILE`, the public front's). `x-owner-link`
(the panel-made link, checked against `owner-link.json` on every call) or `x-owner-session` (a session this runtime made) is "the owner". Every answer is JSON,
`cache-control: no-store`; a body over its limit is 413 and the connection closes; a wrong method is 405 with `allow`.

| # | Route | Credential | What it does |
|---|-------|-----------|--------------|
| 1 | `GET /healthz` | none | `{ok:true}` while the process is up |
| 2 | `GET /readyz` | none | 200 `{ok:true}`, or 503 `{ok:false, reason}` when the store cannot be read or the queue is not going |
| 3 | `GET /status` | internal | counts only: `bookings` by state, `tasks {pending,done,failed}`, last step, record length, version, `refunds {waitingForOwner, beingSentAgain, needBuilder{total,...}}`, `ownerAccess {passkeys, alertPhones, locked?, removal?}`. Never a word of a message |
| 4 | `POST /internal/events` | internal | `{"events":[1..100]}` from the inbox: `message`, `message_status`, `payment_event`, `approval_decision`; checked whole (one bad event refuses all, 400), saved BEFORE the 200 `{saved, duplicates}`; a repeated id is a no-op; `tick` and the channel kinds are refused here; body max 256 KB (413) |
| 5 | `POST /internal/recover` | internal | `{id, case, action}` the panel's to-do list (`recheck_payment`, `retry_booking`, `ask_owner_again`, `recheck_refund`); saved like an event, 400 on a malformed one |
| 6 | `GET /internal/refund-context?receipt=b-3:pay_x` | internal | what the approvals relay may know of a HELD refund (`booking, customerPhone, businessName, timeZone, ownerLanguage, serviceName, slotMs, paymentId, amountPaise, approval, expiresAtMs, requestedBy?`); 404 when none is held, 400 without a receipt |
| 7 | `GET /internal/owner-session` | internal + `x-owner-session` | 204 when the session is good, else 403 (the approvals relay asks this) |
| 8 | `GET/POST /internal/limit-changes` | internal | GET: the limits the owner may change, their value in force and the changes; POST `{id, change, result, why?}`: the deployer's word that Guard has the value (`active`) or that it failed |
| 9 | `GET/POST /internal/feed-notice` | internal | a listings feature: 204 for Bookings (no listings) |
| 10 | `POST /internal/channel/events` | channel (+ owner for an owner kind) | 1 to 10 events, body max 16 KB: `channel_request` (`book` with `serviceId, startMs, name, phone, language`; `cancel`; `paid` with optional `upiRef`), `owner_action` (`received, refunded, kept, approve, deny, retry, card_yes, card_no, send_link, revoke_link, ... ` with `case` and a 32-hex `digest`; needs the owner), `owner_message` (the talk box, 1 to 900 characters; needs the owner), `owner_signin`, `chat_message` (a guest's send, rate limited per guest, per shop and for new guests: 429) |
| 11 | `GET /internal/channel/chat?handle=<64 hex>[&after=N][&cid=<id>]` | channel | a chat guest's thread (empty for an unseen guest) and where send `cid` stands |
| 12 | `POST /internal/channel/chat-id` | channel | a guest's identity (keep this chat, a new phone, delete my chat) (`modules/channels/chat-identity-http.ts`) |
| 13 | `POST /internal/channel/chat-voice` | channel | a guest's recording (only with a `speech` block) |
| 14 | `GET /internal/channel/offer?service=&from=YYYY-MM-DD&days=N` | channel | the shop (name, address, hours, `takesNewWork`, the character), its services and prices, and the free starts per day (`days` at most 14); `calendarUnread: true` when the calendar cannot be read |
| 15 | `GET /internal/channel/request?handle=<hash>` | channel | one request by its handle's hash (state, payment instructions, the booking as the customer's page shows it) |
| 16 | `GET /internal/channel/owner` | owner | what waits for the owner (items, cards, the assistant's app view `app`, `listen`) |
| 17 | `GET /internal/channel/documents?handle=<hash>&lang=xx` | channel | the receipts, bills and refund notes of one page's booking, newest first |
| 18 | `GET /internal/channel/accounting?period=2026-11\|26-27` | owner SESSION only | the accountant's files (journal CSV, documents CSV, README) |
| 19 | `GET /internal/channel/owner-file[?take=<id>]` | owner SESSION only | "Get my shop's file": the state, or the bytes once |
| 20 | `GET/POST /internal/channel/owner-signin` | `x-owner-signin: <link>` | GET what the link is now (valid, used, expired, replaced, unknown); POST uses it once and makes a session `{session, expires_at_ms}` |
| 21 | `POST /internal/channel/owner-signout` | session | ends that session |
| 22 | `POST /internal/channel/owner-passkey` | channel (+ grant) | `{op: grant_state, register_options, register, status, signin_options, signin}`: passkeys (WebAuthn), setup tokens and recovery codes from `owner-grants.json` |
| 23 | `POST /internal/channel/owner-phones` | session | `{op: list, dismiss, remove, codes, add_phone, cancel_removal}` |
| 24 | `POST /internal/channel/push` | channel (+ owner) | web push: `key`, `owner_state/subscribe/unsubscribe/choice`, `customer_state/subscribe/unsubscribe` |
| 25 | `POST /internal/channel/owner-voice` | owner | a recording from the owner's page (only with a `speech` block and the assistant), max 256 KB |
| 26 | `GET/POST /internal/channel/owner-limits` | owner (POST: a PASSKEY session, else 403 `passkey_needed`) | the owner's limits page |

Present in the shared server but **404 for Bookings** (its channel has no listings, stock, parent or material): `/internal/channel/listings`, `listing-photo`, `shop-feed`,
`shop-check`, `shop-card`, `owner-listing`, `owner-stock`, `owner-photo`, `parent`, `material`. The contract asserts the 404 so a port does not grow them. Any other path is 404.
The booking page, `/api/v1/...` and the MCP endpoint are the PUBLIC FRONT (`modules/channels/front.ts`, not the runtime) and are not in this suite; what they send the runtime
is routes 10 to 17.

## 2. The files a Bookings shop reads and writes

The deployer's side is `bundle/generate/shop.ts` (`planShop`: runtime.json) and `bundle/generate/compose.ts` (the container's environment: `INTERNAL_TOKEN_FILE`,
`RECORD_KEY_FILE`, `CHANNEL_TOKEN_FILE`; the folders; the secrets mounted at `/run/secrets`).

**Read (the client folder), re-read on every use unless said:**

| File | Written by | What |
|------|-----------|------|
| `settings.json` | the Operator's form | the shop: `name, address, timezone, services[{id,names{lang:[..]},priceInr,durationMinutes,resource?}], openingHours, slotMinutes, bufferMinutes, deposit{amountInr,holdMinutes}, cancellation{windowHours,refundLimitInr}, languages, owner{whatsapp,language}, reminders{hoursBefore}, payment{module}, calendar{module}, resources, assistant, approvers` (`src/settings.ts`). Read at start; the owner's number is read again at every step |
| `runtime.json` | the deployer | `mode` (`fakes`/`live`), `host, port, dataDir, tickSeconds`, `services{payments,calendar,messaging,push{baseUrl,agentTokenFile,relayKey?,relayShop?},timeoutMs}`, `parser`, `talk`, `decision`, `ai`, `model`, `allowance`, `budget`, `pauseMinutes`, `report{preparedBy,innovator,pageBaseUrl,pagesDir,source,tenant,signingKeyFile?}`, `speech` (`modules/runtime/config.ts`). `report.preparedBy` and `innovator` are re-read when the file's modified time changes. NOTE `services: {}` means "no WhatsApp" (`runtimeHasWhatsApp`) |
| `pathway.lock` | the deployer, LAST | `bookings@<version>`; a different version or pathway stops the start |
| `owner-link.json` | the panel | the hash of the owner's panel-made link (`x-owner-link`) |
| `pages.json` | the deployer | `{schema, base, ownerBase, slug, url, pictures?}`: the shop's page addresses (links in messages, `rpId`/origin of passkeys) |
| `owner-grants.json` | the panel | the Operator's setup QR and card, codes, the lock, the pending removal request |
| `owner-reset.json` | Geometer's reset | the window in which only the reset's own QR works |
| `owner-sessions.json` | the panel | "sign out every device" (`endBefore`) |
| `licence.json` | `bundle/lib/licence.ts` | the lease (`paid_through`, wind-down, final stop); read by modified time; a missing or bad file never restricts (`modules/licence/rules.ts`) |
| `terms.json` (terms) | the Operator | the shop terms the owner agrees to on WhatsApp (`modules/terms/reader.ts`) |
| `go-live-certificate.json`, the report's `signingKeyFile` | the deployer | read at START (an unreadable path stops the start with a sentence) |
| secrets: `internal_token`, `channel_token`, `record_key` (64 hex, REQUIRED in live mode), `agent_<service>` (the credential this agent presents to each Guard) | the deployer | files named by the environment and `agentTokenFile`s |

**Written (the data folder `dataDir`):**

* `agent.db` (SQLite, WAL, `synchronous=FULL`, `busy_timeout=5000`, `PRAGMA user_version`; `modules/runtime/store.ts`): tables `tasks(seq, key, state, attempts, event...)` + index
  `tasks_by_state`, `state` (the agent's whole store as JSON, saved whole with each step), `record` (append-only, no UPDATE or DELETE: `seq, action, outcome, booking, entry...` + index
  `record_by_booking`), `window` (the WhatsApp 24-hour window by number), `state_shape`/`state_rows` (the store's shape), `listing_photos` (unused by Bookings), `shop_key`
  (the shop's own Ed25519 key: `loadShopKey`). A newer schema is refused, another format is refused in plain words. **The Go runtime must write the same file** (rule: both
  runtimes read each other's data).
* the shop's report pages under `report.pagesDir` (the monthly report, its certificate and signed summary; UPI QR pictures under random names) and, for the owner's file,
  `owner-file` copies; chat-identity and push stores.
* the monthly report is written as files, the record as `agent.db` lines (read back through `shop.record()` in the harness).

## 3. The Guards a Bookings shop calls

In `live` mode each call goes to a Guard base URL named in `runtime.json` (`baseUrl`), with `Authorization: Bearer <agent_<service> file>` only when `agentTokenFile` is given (the
stand-ins must see NO Authorization when none is). Timeout `services.timeoutMs`. In `fakes` mode the same services are in-memory stand-ins inside the process (no HTTP).

* **Payments** (Razorpay wire; `modules/payments/providers/razorpay/api.ts`): `POST /v1/payment_links` (`amount` in paise, `reference_id` = the booking id "b-3", `description`, `accept_partial`...),
  `GET /v1/payment_links/{id}`, `GET /v1/payment_links?reference_id=&payment_id=`, `POST /v1/payment_links/{id}/cancel`, `GET /v1/payments/{id}`,
  `POST /v1/payments/{id}/refund` (body `amount` paise, `receipt` = "<booking>:<payment id>"; header `Geo-Requested-By` when the owner asked), `GET /v1/payments/{id}/refunds?count=100`,
  `GET /v1/settlements/recon/combined` (the day's rows, once a day, for the books). Guard's answers read: a link, a refund, **202 held** with an approval id (a refund above the
  threshold), 409 `already_done`, 409 other, `denied_by_approver`, `outcome_unknown`, 429/limit refusals, 5xx (`test/fixtures/guard-responses.json`, `razorpay-*.json`).
  A UPI shop (`payment.module` = `upi`) has NO payments Guard: the owner marks money by hand.
* **Calendar** (Google Calendar v3; `src/adapters/live/google-calendar.ts`): `POST /calendar/v3/calendars/{id}/events?sendUpdates=none` (tentative hold with `extendedProperties.private`
  `bookingRef`, `holdExpiresAt`), `GET .../events?privateExtendedProperty=bookingRef=..&singleEvents=true&timeMin=&timeMax=&pageToken=`, `GET/PATCH/DELETE .../events/{id}`,
  `POST /calendar/v3/freeBusy`. A shop on its own booking list (`calendar.module: own`) has none.
* **WhatsApp** (`modules/messaging/whatsapp.ts`; Meta or Gupshup shapes): `POST /{version}/{phone-number-id}/messages` with `text`, `template` (name, language, body parameters,
  optional image header), `interactive` (`button` up to 3, `list` up to 10 rows), `document`, `image`, `sticker`; one reply `{messages:[{id}]}`. Customers outside the 24-hour
  window get only an approved template. A shop with no `services.messaging` has no WhatsApp: everything goes to the page and to push.
* **Push** (`modules/push/sender.ts`): `POST <push Guard>/push` per phone, an encrypted body (RFC 8291) with a VAPID header (`modules/test/contract/push-harness.ts`).
* **The model** (`parser`, `talk`, `decision` in `runtime.json`): OpenAI-style `POST <baseUrl>/chat/completions` (or the Anthropic wire), JSON out. Its answers are untrusted input: the
  runtime checks every field and falls back to the rules (`src/adapters/model-llm.ts`). A call is priced from `provider` + `model` (`modules/budget`, the day's and month's caps).
* **Speech** (`speech` block): a Guard that turns a voice note into words (`modules/voice`).
* Outbound from the tick: **nothing else**. The runtime opens no other connection.

## 4. The timed work (the tick, every `tickSeconds`, at least 1)

`modules/runtime/core.ts` (`tick` event, never from outside) then `src/agent.ts onTick`:

1. compact: once a day the text of conversations that ended more than the retention ago is deleted (the record is never touched);
2. the owner's sign-in notices (told only after the step is saved), the licence notice (once for each `paid_through`);
3. `onTick`: calendar backfill (own list to Google), the button-mode announcement, `refunds.sweep` (a refund waiting to be sent again; a held one is never re-sent on a timer),
   the owner's UPI refund reminders (once a day, at most three), closing deposit links in the licence's final stop, yesterday's settlement rows (once a day), then for each booking:
   an `awaiting_deposit` hold past `holdExpiresAt` EXPIRES (the calendar hold is let go, the slot is free again), a confirmed booking's reminders (the latest due one, never after a
   cancellation or a STOP), a finished booking becomes `completed` and the deposit is applied in the books, the assistant's cards past their time close;
4. the monthly report on the first morning of the month in the shop's zone, once, even across a restart (not in the licence's final stop);
5. the owner's morning line (`assistant.morning` hour, `modules/assistant/morning.ts`), once a day.

## 5. What is in the state, for a port

The agent's store (`src/booking.ts createStore`, serialised by `server/snapshot.ts`) holds `bookings` (Map by id "b-N", states `enquiry, confirming_details, awaiting_deposit,
needs_owner, confirmed, cancelled, completed, expired`), `customers`, the counters (a new booking takes an id no earlier booking used, even after a restore), `channel` (handles
by hash, requests, conversations), `assistant`, the books, the UPI ledger. Ids, hashes and the shape of every file above are part of the contract: a shop must be able to move
between the two runtimes and lose nothing.

---------------------------------------------------------------------------------------------------------------------------------------------------------------------------

## 6. The 89 entries of `templates/commerce/bookings/test/`

85 `*.test.ts` files plus `fixtures/` (stays: the contract's fake Guards answer from it), `helpers/` (stays with the stand-ins and inbox tests), `runtime-kit.ts` and
`stub-model-server.ts` (die with the TypeScript runtime tests that use them). Classes:

* **a** contract: seen over HTTP or files; covered by this suite (file named, status in section 8).
* **b** unit: a pure function (or a module); becomes a Go unit test with vectors made from the TypeScript (the vector file is made BEFORE the TypeScript is deleted).
* **c** demo: used only by the public demo build (`templates/commerce/bookings/demo`); stays TypeScript.
* **d** other component: not the shop runtime (the inbox, the approvals relay, the stand-ins, the scripts, the sell guides, the report command line). It is listed so nothing is
  dropped; it stays TypeScript with its component, and is deleted only if that component is.

Contract files: **S**moke, **M**oney, **L**imits and approvals, **F**low, **O**wner, **C**hat, **R**ecovery, **D** record, report and licence (`*.contract.test.ts`).

| Test file | Tests | Class | Where it ends up |
|-----------|------:|-------|------------------|
| accounting-figures | 2 | b | the report's money figures from the books: vectors |
| accounting-pages | 3 | a | a booking's receipts, the accountant's files over HTTP: **D** |
| adapters | 14 | b | the in-memory fakes (calendar, payments, messaging): what `fakes` mode must do in Go: vectors |
| ai-mode | 17 | a+b | the allowance, button mode, the record of each understanding step: **C** (model) + vectors for the router |
| approvals-card | 2 | d | the relay's card |
| approvals-group | 5 | d | the relay's approvers (B37) |
| approvals-guard-binary | 7 | d | against the real Guard binary (not the shop runtime) |
| approvals-relay | 2 | d | the relay against a stub Guard |
| approvals-runtime | 5 | a | `approval_decision`, `refund-context`, status counts of refunds: **L** |
| assistant | 29 | a | the owner's assistant: fixed phrases, own words, cards by tap: **O** |
| booking | 6 | b | the booking state machine (`src/booking.ts`): vectors |
| buttons | 18 | a+b | button and list words and limits (b), what goes on the wire to WhatsApp (a: **F**) |
| capacity | 7 | a+b | units/resources: no-double-booking pure rule (b); two chairs, three customers (a: **F**) |
| channels | 9 | a | the booking page's requests through the runtime: **F** |
| chat | 7 | a | the chat on the page: **C** |
| config | 14 | a+b | a client folder, what is refused and how it is said: start refusals (a: **S**), validation (b) |
| demo | 24 | c | the demo mode's endpoints |
| dev-forwarder | 5 | d | the dev forwarder |
| e2e | 4 | d | the inbox end to end with stand-ins |
| full-chain | 5 | d | the local stack (inbox, relay, stub Guard); its refund-above-the-limit and restart cases are re-made in **L** and **R** |
| guard-limits | 10 | b | the refund limit rupees to paise, the Guard spec: `scripts/guard-spec.ts` is the deployer's (d), the threshold rule is **L** (the limit boundary over HTTP) |
| guard-outage | 6 | a | a Guard down: **R** |
| guard-responses | 19 | a | how Guard's answers are read, from the fixtures: **M**, **L**, **R** |
| hand-check-shops | 11 | d | the hand check (scripts/hand-check) |
| inbox | 23 | d | the inbox |
| language | 23 | b | the words in four languages and the outgoing check: vectors |
| last-slot | 6 | a | two customers for the last slot: **F** |
| licence | 12 | a+b | the wind-down and the final stop (a: **D**), the words (b) |
| limits-runtime | 2 | a | "limits, tightened by a tap": **L** |
| limits | 10 | b | the pure limit rules (price, hours, no double booking, one deposit, refund limit, stop): vectors; each is also seen over HTTP in **F**, **L**, **M** |
| live-adapters | 14 | a | the exact requests to the Guards: **M**, **F** (the fake Guards record them) |
| meta-templates | 5 | b | template wording per message: vectors |
| model-eval | 13 | d | the model eval script |
| model-llm | 13 | a+b | the model parser on both wires: **C** (a: request shapes, untrusted answers) + vectors for the prompt |
| money-clarity | 4 | a | money lines on the page's documents: **M**/**D** |
| ondc | 5 | b | the ONDC mapping (pure; owner: mapping only): vectors |
| own-calendar | 7 | a | a shop on its own booking list: **F** |
| owner-notices | 2 | a+b | the owner told by template outside the window: **O** |
| owner-number-live | 1 | a | the owner's number changed with no restart: **O** |
| owner-signin | 2 | a | the page's sign-in request through the runtime: **O** |
| page-link | 6 | a | a private link in the UPI quote: **F** |
| papers | 5 | d | the three papers (statement, record of a case, identity paper) |
| parser | 22 | b | the rule parser (Malayalam, Kannada, Hindi, English): vectors |
| payment-events | 2 | a | `payment.captured` that names the payment, not the link: **M** |
| record-decisions | 6 | b | the rule decisions the agent writes in its record: vectors |
| recovery | 8 | a | the to-do list's recovery steps and the handover agreement: **R** |
| refund-held | 26 | a | the whole refund hold, approval, expiry, outcome unknown: **L**, **M**, **R** |
| report-accounting | 3 | b | the report's money block |
| report-badge | 4 | b | the Innovator badge |
| report-certificates | 9 | d | the go-live and record certificates |
| report-cli | 8 | d | the report scripts |
| report-data | 18 | b | the report's numbers from the record |
| report-go-live | 10 | b | the go-live reading |
| report-monthly-config | 5 | a | the `report` block of runtime.json and a client started with it: **D** |
| report-monthly | 19 | a+b | the monthly job: once, on the first morning, across a restart (a: **D**) |
| report-render | 13 | b | the report in four languages |
| report-settled-by-word | 2 | b | "settled by <who>" |
| report-sign | 12 | b | signing and checking |
| report-summary | 6 | b | the signed summary in a link |
| report-whatsapp | 14 | b | the report as a WhatsApp message |
| restored | 3 | a | a shop put back from a snapshot while the world went on: **R** |
| review-sheet | 7 | d | the review sheets |
| runtime | 8 | a | restarts, one step at a time, retries: **R** |
| sample-report | 7 | d | the sample report |
| sell-guide | 34 | d | the sell guide (it imports the demo build) |
| sell-phone | 4 | d | the phone-first sell texts |
| server | 12 | a | the HTTP face: **S** |
| settings | 16 | b | settings parsing and its refusals |
| situations | 1 | d | the crash-test situations (one test each; run on the in-process agent) |
| standins | 22 | d | the stand-ins' own contract |
| start | 7 | a | starting a client for real: **S** |
| step-breaker | 6 | a+b | a decision model that is down: **C** |
| store | 8 | a+b | the durable store (a: the SQLite file's format, **R**; the JSON round trip is b) |
| talk | 4 | a | the shop's talk model on a Bookings shop: **C** |
| terms | 5 | a | the terms the owner agrees to on WhatsApp: **O** |
| ticker | 2 | a | the clock's beat: **R** |
| understanding | 14 | b | the three-step router with stubs: vectors |
| unknown-outcome | 4 | a | "we're checking" kept through a restart: **R** |
| upi | 5 | a | UPI marked paid by the owner: **M** |
| voice-note | 13 | a | a voice note's one plain reply: **C** |
| voice-notes-shared | 0 | a | the shared cases for voice notes (generated, same as voice-notes): **C** |
| voice-notes | 15 | a | voice notes with a speech stand-in: **C** |
| web-demo | 14 | c | the browser build of the demo |
| webhooks | 7 | d | webhook signatures and readers (the inbox's); their output shape is the `payment_event` / `message` of **M**/**F** |
| without-whatsapp | 5 | a | a UPI shop with no WhatsApp: **O** |

(the counts of tests per file are `test(` / `it(` lines; a few files build tests in loops)

## 6b. The named checks: money, limit, approval, licence, recovery, owner control

Each ends in **a** (a contract test, file named) or **b** (a unit with vectors); none is dropped. Names are the test titles (shortened) of the unit tests.

**Money.** refund within the limit goes straight through Guard and the customer is told, nobody asked (refund-held) a **L**; the deposit is the settings' deposit, a link for any other amount
is refused (guard-limits) a **M**; one deposit per booking, a second payment is refunded (limits, payment-events) a **M** + b; `payment.captured` with no link id still finds its booking, one
on no link of ours is ignored (payment-events) a **M**; a refund that already exists is not sent again (refund-held "look before retrying") a **R**; outcome unknown on a refund is never sent again
(refund-held, unknown-outcome) a **R**; a provider 5xx on a refund is not sent again a **R**; 409 `already_done` is done by their word, any other 409 is not (refund-held) a **L**; the deposit lowered
after a booking paid the old one: Guard refuses the larger refund (refund-held) a **L**; the rupee refund limit becomes paise exactly, "at the limit through, one rupee above held" (guard-limits) b +
a **L**; amounts are never changed by the model or a page (money-clarity, channels: a channel booking carries no price) a **M**; UPI: the owner marks money, a mark with another amount, a replayed
code (upi) a **M**; the money lines of a booking's documents (money-clarity, accounting-pages) a **D**; the books (accounting-figures) b.

**Limits.** price at or above the list, within hours (open days, edges, closing time, the slot grid), no double booking with units, confirm only when recorded (the calendar AND the deposit read
back), one deposit per booking, refund limit, no message after STOP, message matches the record, strictest decision wins (limits) b, and over HTTP: hours/slot grid and the last slot a **F**, the
refund limit a **L**, STOP a **F**; capacity (capacity) b + a **F**; "limits, tightened by a tap" (limits-runtime) a **L**; the chat's per-guest, per-shop and new-guest rates and the day's caps
(chat) a **C**; the model's day and month caps (ai-mode) a **C**.

**Approvals.** a refund above the limit is held, the customer told, the agent does not ask the owner (refund-held) a **L**; held, approved, sent again with the same bytes, confirmed once, asked
exactly once a **L**; the same answer twice, an approval for something else, and time send nothing more a **L**; no blind retry of a held refund on a timer a **L**; a forged approve event makes the
agent ask Guard once and nothing else a **L**; deny is final a **L**; Guard's record of a no wins a **L**; expiry a **L**; an approval Guard no longer honours a **L**; a late cancellation within the limit
stays the agent's question (owner asked once), above the limit the relay's a **L**; the `approval_decision` event's check and refund-context endpoint (approvals-runtime) a **L**; the relay itself
(approvals-relay, -card, -group, -guard-binary) d; the owner's cards bound to a digest, one use (assistant) a **O**.

**Licence.** wind-down: a booking request is answered "paused" with no hold, no link, nothing kept; a deposit paid from an earlier link still books and a cancellation still refunds; a request
waiting for "yes" is not held; back to normal takes new bookings; the final stop closes open deposit links once and sends nothing more; the runtime reads `licence.json` by its modified time
and a missing or bad file never restricts; Guard refusing for the licence while the file says "in order"; the final stop's refusal of a send is recorded once as blocked; the report of a month with
a wind-down (licence) a **D**; the words in four languages b.

**Recovery.** retry_booking, ask_owner_again, recheck_payment, recheck_refund, a mismatched action refused (recovery) a **R**; the recovery endpoint's token and shape a **S**/**R**; a task saved
but never run runs at the next start, a step cut off runs again and finds its own calendar event and link, a running task found dead is marked failed, one at a time in order, a failing step is tried
again then failed, a step that fails after the work saves nothing (runtime) a **R**; the Guards down (guard-outage) a **R**; a shop restored from a snapshot (restored) a **R**; two customers for the last
slot (last-slot) a **F**; the case number kept (unknown-outcome) a **R**.

**Owner control.** the owner's number is read at every step (owner-number-live) a **O**; sign-in link used once, the session opens the reads and goes into the record (owner-signin) a **O**; the
full owner-control rules (the lock, QR and card, the 48-hour and one-day waits, Geometer's reset, a restore keeps the lock, the alerts) are the SHARED runtime's (`modules/channels`), proved for the
listings shop by `templates/commerce/listings/contract/owner-control.contract.test.ts`; Bookings mounts the same code, and **O** repeats the lock, the request wait and a sale's number change on a
Bookings shop; owner notices outside the window go by template (owner-notices) a **O**; the owner's own words are read (assistant) a **O**; a shop with no WhatsApp (without-whatsapp) a **O**.

---------------------------------------------------------------------------------------------------------------------------------------------------------------------------

## 7. The harness and the suite

* `harness.ts` writes the folder as the deployer does (settings.json, runtime.json, owner-link.json, pages.json, owner-grants.json, optionally licence.json, the secrets; **pathway.lock
  last**), starts the shop (`node templates/commerce/bookings/server/main.ts --client <folder>`, or the Go binary with the same arguments and the same token files), and gives the
  tests `shop.call`, `events`, `inbound` (a customer's WhatsApp message as the inbox hands it on), `tap`, `channelEvents`, `book`, `request`, `ownerView`, `chat`, `record()` and
  `tasks()` (read from agent.db), `stop`/`start` on the same data, and the files the panel writes (`writeGrants`, `writeReset`, `writeSessionsEnd`, `writeLicence`,
  `setOwnerNumber`). **Two kinds of shop**, because the test clock (`GEOMETER_TEST=1`, `GEOMETER_TEST_CLOCK_FILE`) is honoured for a `"fakes"` shop only:
  * `mode: "fakes"` (default): in-memory services, on the TEST clock put at Tue 3 Nov 2026, 10:00 in India (the unit tests' instant); observed through the channel routes,
    `/status`, agent.db and the report folder. The Go runtime must reproduce the in-memory stand-ins (calendar, payments, WhatsApp) for these.
  * `mode: "guards"`: `runtime.json` live, the real clock, the fake Guards below; observed through what the Guards were sent.
* `guards.ts` is the three fake Guards (payments, calendar, WhatsApp): small recording HTTP proxies in front of the stand-ins (`templates/commerce/bookings/standins`: the providers'
  wire formats over in-memory fakes) and the stub Guard (`modules/standins/guard.ts`: Guard's documented hold and refusal behaviour, built from the limits spec the deployer
  generates from the shop's own settings). Every request is recorded (method, path, query, headers that matter, body, answer); faults are plans (`down`, `answer(<a captured Guard
  answer from test/fixtures/guard-responses.json>)`, `drop`, `loseReply`, `delay`). Payment webhooks are read as the inbox reads them (`parseRazorpayEvent`).
* The fake model, the process starter and tracker (`children.ts`: no process outlives a run), the test-clock file, the fake push Guard and the owner-control helpers are shared
  with the listings contract from `modules/test/contract/`.
* **Every test goes through `contract()`** (harness.ts): with `BOOKINGS_IMPL=go` and no binary every test is skipped with "no Go Bookings runtime yet (wave 2)".

| File | Group | Shop | What it holds the runtime to |
|------|-------|------|-----------------------------|
| `smoke.contract.test.ts` | S | fakes, guards | /healthz /readyz /status, every token refusal, the 404s of routes a Bookings shop must not have, the checks of /internal/events and /internal/recover, the data kept across a restart, a folder it refuses |
| `money.contract.test.ts` | M | guards (+ UPI) | the hold and the link (exact bodies), the paid webhook (checked at the provider, once), a forged or unknown one, a second payment refunded, a cancellation refunded, amounts nobody can change, UPI marks by the owner |
| `limits-approvals.contract.test.ts` | L | guards | the refund limit boundary, the hold, the relay's approval, forged/duplicate/denied/expired answers, the Guard's refusals (captured answers), what needs the owner, the limits page |
| `flow.contract.test.ts` | F | fakes, guards | free times, hours and grid, the last slot, the buffer, someone else's event, an unreadable calendar, hold expiry, completion and reminders on the beat, cancel, a booking from WhatsApp text, STOP, the page link |
| `owner.contract.test.ts` | O | fakes, guards | the lock, the Operator's files after it, a changed number (48 hours), the accountant's files, the owner's limits page, the assistant's talk, the owner told by template, no WhatsApp |
| `chat.contract.test.ts` | C | fakes | the chat's thread and limits, the four languages, the model's answer as untrusted input |
| `recovery.contract.test.ts` | R | guards | a Guard down, the process killed mid-step, a lost reply, the to-do list's recovery steps, a restored snapshot |
| `record-licence.contract.test.ts` | D | fakes, guards | agent.db's format, the append-only record without a customer's number, the licence's wind-down and final stop, the owner's notice, the monthly report |
| `cross-restart.test.ts` | | guards | the TypeScript and Go runtimes in turn on one folder, both ways (skipped without the Go binary) |

## 8. Status of the suite (TypeScript, 19 Nov 2026)

RESULT_PLACEHOLDER

**Written and passing on TypeScript (the class "a" files they stand for):** accounting-pages (the documents route, the accountant's files route), approvals-runtime, channels, chat, guard-outage,
last-slot (two customers for one time), licence (wind-down, the paid-before link, final stop, the owner's notice, Guard's 402, a torn file), limits-runtime, model-llm (the OpenAI
wire request and the untrusted answer), owner-number-live (the 48-hour rule), page-link, payment-events, recovery, refund-held, restored (the id gap), server, store (the file's format
and the record's trigger), ticker (hold expiry, completion and a reminder on the beat), unknown-outcome (the 504), upi (the owner's mark; the customer's claim), own-calendar, record-decisions
(no customer words in the record).

**Class "a" still to WRITE before the TypeScript unit tests are deleted (a later wave's first task; nothing here is lost until then, because the TypeScript tests still exist):**

| Left | Why it was not done in this stream | What it needs |
|------|------------------------------------|---------------|
| voice-note, voice-notes, voice-notes-shared (C) | needs a fake speech Guard (runtime.json `speech`) | a 40-line fake in `guards.ts` |
| assistant (O): the owner's fixed phrases on WhatsApp, own words, cards by tap with the digest | only the page's talk box is covered | `inbound(OWNER_NUMBER, ...)` plus the cards in `ownerView().app` |
| buttons (F): the exact `interactive` payload (3 buttons, 10 rows, 20-character titles) and a tap read without a model | `tap()` exists in the harness and is not used yet | assert on `s.sent()` payloads |
| capacity (F): two chairs / resources over HTTP, a move | needs settings with `resources` | a settings override |
| talk, terms (O/C): the talk model's answer for a customer's words; the shop terms agreed on WhatsApp | no `talk` block or terms.json written by the harness yet | `runtime.talk`, `terms.json` |
| step-breaker, ai-mode (C): a decision model that is down, the month's allowance | needs a second fake model and `allowance` in runtime.json | `runtime.decision`, `runtime.allowance` |
| guard-responses (L, R): unauthenticated 401, provider_unreachable 502, provider 500, replayed, refused_rule, held_uncertain, denied_by_approver | the fixtures are there (`CapturedAnswer`), each needs its case | `payments.answer(fixture(...))` |
| refund-held (L): expiry of the approval, "no longer honoured", "a hold with no approval id goes to the builder", "the deposit lowered after a booking paid" | need a clock for the Guard's 24-hour approval (the stub Guard runs on the real clock) | the stub Guard on the test clock, or a settings spec with a short approval time |
| unknown-outcome, restored (R): kept through a restart, a refund that went out after the snapshot is not sent twice | multi-step restart cases | stop/start with `failNext("outcome_unknown")` |
| recovery (R): `recheck_refund`, `ask_owner_again`'s notice | | owner notices on the WhatsApp stand-in |
| owner-notices (O): every notice of the agent, by template, in each language | only "outside the window is a template" is covered | `s.sent(OWNER_NUMBER)` per scenario |
| owner-signin (O): the WhatsApp link route (`owner_signin` event, `/internal/channel/owner-signin` GET and POST with `x-owner-signin`) | the passkey route is covered, the link route is not | `channelEvents([{kind:"owner_signin"}])` and the link read from the WhatsApp stand-in |
| money-clarity, upi (M): the late claim windows (48 hours, 14 days), the refund the owner owes (`refund_owed`, "kept"), a screenshot | UPI marks only | UPI shop on the test clock |
| report-monthly (D): the owner's WhatsApp message, the certificate and signed summary files, the quiet month, the licence's final stop | only the data file's making, once, is covered | read the WhatsApp stand-in |
| runtime (R): steps one at a time in order, a failing step tried again then failed, a step that fails after its work saves nothing | the step seam is in-process only (`aroundStep`); no HTTP route makes a step throw | **unit** (the task runner of `modules/runtime/core.ts`: vectors), listed here so it is not dropped |
| server (S): "readyz turns 503 when the store cannot be read" | needs a store that fails | **unit** for the Go store |
| web push (route 24), chat identity (route 12), `owner-voice`, `chat-voice`, `owner-file`: | shared with the listings contract (push, owner-file) or need speech | the listings contract proves the shared code; run it against the Bookings shop in the port |

The classes "b" (unit) are NOT started: their vectors (inputs and outputs made from the TypeScript) must be generated before the TypeScript is deleted; that is the port's first step per
package. The list in section 6 is the checklist.

## 9. TypeScript behaviour this suite found worth knowing (nothing was changed)

* `templates/commerce/bookings/server/main.ts` did not take the test clock; it does now (the one runtime file touched; behaviour without the two variables is unchanged).
* A payment of less than the link (the stand-in's `customerPays(amount)` escape hatch, which real Razorpay cannot do on a link that does not accept part payments) is accepted as the
  deposit by the agent (`depositInr` becomes the amount paid). Only the stand-in can make it; recorded here so a port does not copy it by accident or "fix" it unasked.
* A Guard's kill switch is deliberately NOT waited for (modules/core/faults.ts `waitsForGuard`); a Guard that is "busy" or unreachable is. The fake Guards model both (`down()`, `stopped()`).
* `GET /internal/channel/request` answers `status: "not_held"` (not "refused") for a time that was taken, and "refused" with a reason for a request that never became a booking.
