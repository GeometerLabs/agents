# Go runtime for a listings-only shop

A listings-only shop is the smallest kind: it only shows what it has (`templates/commerce/listings`). This folder is **the shop's runtime written in Go**, begun as a trial of whether code
that runs inside a shop can be Go (decision 61, `docs` repo `plans/next-phase.md` section 1c). The trial's results, wave 1a (the rest of the listings shop) and wave 1 merged (with the
owner control) are in [TRIAL.md](TRIAL.md). The deployer runs it (wave 1b): a template folder that says `"runtime": "go"` in `template.json` (listings 0.2.0) is run from the programs' image, which the server builds from its own checkout (see "On a server" below). `cmd/listings` runs ONE shop and `cmd/listings-shared` runs every shop of a server in one process; since 19 Nov 2026 they are the only listings runtime (the TypeScript
`server/main.ts`, `shared-main.ts` and the shared pool they replaced are deleted: TRIAL.md, "Waves 1b and 1c finished").

What stays TypeScript: the front (`modules/channels/front.ts`, with the shops' own MCP endpoints), the deployer, the panel. They call this runtime over HTTP and cannot tell which one answered;
the **contract** in `templates/commerce/listings/contract/` is what both must pass.

Wave 1c adds the **directory of local shops** (`cmd/directory`, `internal/directory`): since 19 Nov 2026 THE directory. The deployer runs it from the programs' image as the `directory`
container (its health check `/directory health`, a person's commands `docker exec <directory> /directory changes|accept <shop page>`), it passes the directory contract in
`modules/discovery/contract/`, and the TypeScript directory it replaced is deleted (TRIAL.md, "Waves 1b and 1c finished").

## Build and run

```
cd go
go build -o bin/listings ./cmd/listings                 # 23.3 MB; with -ldflags "-s -w" 16.4 MB (19 Nov, wave 1 merged)
go build -o bin/listings-shared ./cmd/listings-shared   # 23.8 MB; with -ldflags "-s -w" 16.8 MB
go build -o bin/directory ./cmd/directory               # the directory of local shops (size: TRIAL.md, "Waves 1b and 1c finished")
go build -o bin/bookings ./cmd/bookings                 # one Bookings shop (wave 2, in progress: TRIAL.md "Wave 2: the Bookings runtime")
INTERNAL_TOKEN_FILE=internal_token CHANNEL_TOKEN_FILE=channel_token RECORD_KEY_FILE=record_key \
  bin/listings --client <shop folder>/client
```

The folder, the three token files and the environment are the ones the TypeScript runtime had, which the deployer writes (`bundle/generate/shop.ts` `sharedPaths` for the shared layout): `client/` holds `settings.json`,
`runtime.json`, `pathway.lock` (written last), `owner-link.json`, `pages.json` and `owner-grants.json`; the secrets are `internal_token`, `channel_token` and `record_key`. `runtime.json`
says where to listen (`host`, `port`) and where the data is (`dataDir`). Ctrl+C or SIGTERM finishes the step in hand and closes the store.

`listings health <url>` and `listings-shared health <url>` do one GET and exit 0 on a 200, else 1: the container health check of an image that has no shell or wget.

### On a server (wave 1b)

The server compiles the programs itself, from its own checkout, in the official Go image pinned by digest in `bundle/release.json` (`go_image`, `go_image_digest`), at install (`install.sh`) and at `geometer update`; `geometer go-build` does it by hand. Source mounted read-only, `CGO_ENABLED=0`, `GOTOOLCHAIN=local`, `-trimpath -mod=readonly -buildvcs=false -ldflags "-s -w"`, a named volume `geo-go-cache` for the module and build cache. The result is `geo-go:<commit>`, an image `FROM scratch` of the programs alone (no shell, no tools; the pinned builder's certificate authorities, for the directory's https feeds), run as `1000:1000`. To add a program (`cmd/bookings`; `cmd/directory` was added so): one line in `GO_PROGRAMS` in `bundle/lib/go-build.ts`, and the template's `template.json` names it. The whole account is in `bundle/Explanation.md` ("How the Go runtimes reach a server"). Measured 19 Nov 2026 on an Apple-silicon Mac (Docker Desktop, 8 GB VM, linux/arm64): the image is **32.7 MB** (both programs); the compile took **12.3 s** from an empty build cache with the modules already in the cache volume (the first build on a server also downloads the modules, about 360 MB in the module cache, not measured here), **13.1 s** with the image made; peak memory of the compile container about **830 MB** (sampled once a second, so a floor). With the full-server settings (`-p 1`, `GOMAXPROCS=1`, `GOGC=50`, a 1536 MB wall) it is **46.7 s from an empty build cache and a peak of 1107 MB** by the container's own counter, about 730 MB of it process memory, the rest file cache. A fresh data volume came out owned by 1000:1000, and one shop's runtime and the shared process were both "healthy" 7 s after `up`, read-only, all capabilities dropped, with the `health` subcommand as their check.

The contracts (from the repository root; build the binaries first, the shared-process and restart tests use them):

```
node --test --test-concurrency=1 templates/commerce/listings/contract/    # the listings shop (go/bin/listings and go/bin/listings-shared, or LISTINGS_GO_BIN)
node --test --test-concurrency=1 modules/discovery/contract/    # the directory (go/bin/directory, or DIRECTORY_GO_BIN)
BOOKINGS_IMPL=go BOOKINGS_GO_BIN=go/bin/bookings node --test --test-concurrency=1 templates/commerce/bookings/contract/  # Bookings (wave 2)
```

The Go version is 1.27 (`go.mod`). No cgo: the binary needs no C library.

## Package map

```
cmd/listings/            main: the command line, the token files, start and stop (it was the Go twin of the deleted server/main.ts + modules/runtime/start.ts)
cmd/bookings/            main of ONE Bookings shop (wave 2): the same command line, token files, environment and test clock as cmd/listings; the shared runtime with the Bookings Kit
internal/bookings/       the Bookings template (wave 2): the settings checked with the TypeScript's sentences, the store read and written field for field (unknown members kept raw), the
                         agent over one step, the channel's reads, the pure rules (hours, double booking with units, refund limit, reminders), a customer's message read (parser.go, reading.go: the
                         rule parser and the reading the shared router is given), the ports to the services; read
                         Explanation.md and Deferred.md (what is not ported yet); agent_marks.go is a UPI shop's money (the owner-marked
                         ledger) and the booking's own page link, agent_after.go the beat's licence notice, monthly report and morning line (runtime.AfterTicker) and the `report` block;
                         agent_assistant.go is Bookings as a skill of the shop's assistant (src/assistant.ts), agent_mode.go the button-mode and step-pause lines (reader.ts announceButtonMode); the words of every message, the WhatsApp templates, the labels and lists
                         (templates.go, meta.go, interactive.go) are packed per language in words/*.json.gz, made from the TypeScript by scripts/gen_bookings_words.ts
internal/store/          the shop's SQLite file, schema 5, the same tables as modules/runtime/store.ts: the queue, the snapshot in pieces, the record, photos, the shop's key
internal/signing/        Ed25519 and RFC 8785 canonical JSON, both ways: the shop's key and the signed feed / answer / notice / Agent Card's JWS (modules/signing), and the reading of them (VerifyDocument, VerifyNotice: the directory's checks)
internal/listings/       the listings: state and rules, the owner's ops, the public and owner reads, the feed and check documents, photos, the assistant's draft and its grounding checks
internal/access/         the owner's sessions, sign-in links, passkeys (WebAuthn), the Operator's setup code and card, and who controls them (the gate, the Operator's requests,
                         Geometer's reset, the owner's phones and own codes, the number lock), in owner-access.sqlite, same schema (modules/channels owner-*.ts, webauthn.ts)
internal/testclock/      the contract tests' clock (GEOMETER_TEST=1 + GEOMETER_TEST_CLOCK_FILE, a "fakes" shop only; a live shop refuses to start with it)
internal/push/           web push: the push store (push.sqlite, the TypeScript runtime's own file), RFC 8291 encryption, VAPID, the sender to the shop's push Guard (modules/push)
internal/language/       the bottom layer of reading words (modules/language): plain, canon, the ONE writing of dates, times and rupees for every runtime (format.go,
                         formats.json, FormatInr; the old internal/locale and the assistant's own date tables were joined into it, 19 Nov), JavaScript's string length, slices and whitespace,
                         toLowerCase, NFC, TextDecoder, Date.parse (js.go, shared by the directory, access and listings); regex.go matches a JavaScript pattern the way
                         JavaScript does (each top-level alternative tried in turn at each place, the look-behind and look-ahead edges checked by hand, since RE2 has neither), over the
                         TypeScript's own built patterns (patterns.json, written by scripts/gen_patterns.ts); dates.go (findDatePhrase, resolveDate); check.go (the outgoing check, with the moments a booking may state); format.go + formats.json (dates, times, phone numbers and the English capital, written from the TypeScript by scripts/gen_bookings_words.ts: shared by every template)
internal/memory/         the shop's memory (modules/memory): notes with who, where, when and an audience, forget, the end of a note, recall within a scope, the talk's proposed notes (proposals.go: Remember / No); `assistant.memory`, field for field
internal/understanding/  the model steps (modules/understanding): one JSON call over the OpenAI-compatible wire (model.go; the directory's assistant uses it too, `Open` + `AskContext`), the System One decision model (systemone.go), the router
                         that reads cheapest first over any template's reading (router.go, generic), and the details taken out before a model sees words (redact.go); every model
                         answer is decoded to `any` and checked by hand
internal/assistant/      the owner's assistant: its state (cards, talk, undo, typed; unknown members stay raw), the card binding (the digest TypeScript and Go agree on, the judge), the owner's words read by rule (rules.go), the owner's reading for the router (reading.go), the owner's talk (talk.go: prompt, answer, checks), notes from words (notes.go), the outgoing check's facts of each line it says (writer.go, from each key's generated facts), and the words it says, packed per language (words/*.json.gz, made by scripts/gen_words.ts from the TypeScript words and unpacked once per process per language); the runtime package runs it in a step (assistant.go, draft.go, notes.go, talk.go, morning.go, ownerview.go)
internal/budget/         the shop's model budget and the month's AI counts (modules/budget, modules/understanding/ai-state.ts), the decision model's breaker and the day's notices (steps.go)
internal/shared/         the multi-shop host (it replaced modules/runtime/shared.ts, deleted): finds shop folders, routes /shop/<name>/..., contains a shop that panics or sticks (strikes, quarantine in a child process, pause); read its header first
internal/zone/           modules/core/time.ts in Go (localParts, zonedToMs, addDays...): time zones from the binary's own tzdata; vectors from the TypeScript on Node
internal/slots/          fills `{0}` slots in words the TypeScript rendered (scripts/lib_words.ts carries and verifies them)
internal/accounting/     the shop's books (modules/accounting): the journal fold over the record, posting, gap-free document numbers per financial year, periods, documents and their page, the accountant's files (journal and documents CSV, settlements CSV, README, Tally XML), the owner's money view, invariants, figures, the books summary, the settlements read; accounting/render holds the HTML (owner's Money section, the report's money block, the document page)
internal/report/         the generic monthly report (modules/report): canonical JSON, digest, sealed envelope, the signed summary link (grapheme cuts as Intl.Segmenter), the page and seal block, text helpers, the go-live reading, the once-a-month sender
internal/bookingsreport/ Bookings' monthly report (templates/commerce/bookings/report): the data counted from the record, the report page, owner text, monthly certificate, WhatsApp text and template, the monthly job
cmd/directory/           main of the directory of local shops (CONFIG, PORT, HOST, DIRECTORY_TICK_MS; `changes` and `accept <page>` for a key change, `health <url>`; the contract's test clock on 127.0.0.1 only)
internal/directory/      the directory (modules/discovery): signed feeds read, checked and indexed (SQLite + FTS5, the TypeScript's own file), the fair order, search, the pages, the MCP endpoint, the signed
                         Agent Card, the buyer's assistant; the words are GENERATED from modules/discovery/words.ts (scripts/gen_directory.ts), the page's style, script, tools, card and prompt are Go source (words/); read Explanation.md and Deferred.md
internal/health/         the `health` subcommand the programs share (one GET of an address, exit 0 or 1)
cmd/listings-shared/     main of the multi-shop host (SHOPS_DIR, SECRETS_DIR, HOST, PORT, SCAN_SECONDS, STATE_DIR; `--one <shop>` is the child it starts for a quarantined shop)
internal/runtime/        the runtime every shop shares; template.go is the seam a template plugs into (Kit, the twin of core.ts RuntimeKit: kit.go, kitserver.go, events.go, statuses.go
                         are the parts only a template uses), and with no Kit it is the listings shop. The folder read and checked, the one-at-a-time step runner, the owner_message draft, the model call, the HTTP routes; owner.go is the
                         owner's sign-in routes, the tick's owner part and the owner's side of push (who may subscribe, what ends a subscription, the alerts to the
                         owner's phones), all under one owner lock; push.go, limits.go, ownerfile.go, stock.go and assistant.go are the other owner routes; chat*.go is the customer's chat (the channel state typed, a send run as a template's step, the thread read, the rates, hold-to-talk's route, chat-id) and talkcustomer.go a customer's talk with the model; notice.go is the owner's licence notice every template shares (modules/licence/notice.ts), run from a template's AfterTicker (template.go: work on the beat that saves for itself, kit.go saveMid); the owner's assistant is ONE conversation over skills (assistant.go; assistantkit.go the seam a template's agent turns it on with, StepContext.Assistant, and its WhatsApp say; assistantacts.go a closed day, a move, undo and the limit card; listingskill.go the listings skill every shop has), morning.go the morning line for every shop, voice.go the listener and the owner's page recordings; read Explanation.md and Deferred.md
internal/chatid/         who a chat guest is (modules/channels/chat-identity.ts): a passkey bound to a thread, the number a guest gave for a new phone and its one-use links, their limits, "delete my chat", retention, in chat-identity.sqlite, same schema; the route is runtime/chatidroute.go
internal/guard/          the shared core of every Guard client (modules/core faults.ts, http.ts, json.ts): the errors, the one HTTP client that sends no key, Guard's answers told apart in one place, the bytes JavaScript writes (JSON.stringify, encodeURIComponent, URLSearchParams); guardtest/ is the vector harness
internal/payments/       payments for every provider (modules/payments): the neutral types and interface, ensureLink, the careful refunds (held refunds never re-sent, the sweep), the in-memory stand-in gateway; razorpay/ the live client and webhook reader; upi/ the upi://pay link; ownermarked/ the UPI shop's ledger (requests, the owner's one-use marks, refunds the owner owes), the owner's replies and the neutral view over them
internal/messaging/      the WhatsApp clients (Meta, Gupshup partner and self-serve), the stand-in and fake, send-once, say, statuses, the webhook readers (modules/messaging)
internal/calendar/       the Google Calendar v3 client through the calendar Guard, the in-memory fake and the shop's own booking list (templates/commerce/bookings src/adapters)
internal/qr/             the UPI QR: matrix, SVG and PNG (modules/qr); see its Explanation.md for the overlap with the books branch
internal/terms/          the shop's terms: text and digest generated from the TypeScript words, the file check, the reader, the owner's side (modules/terms); Bookings reads the owner's "terms" and "I agree" with it
internal/voice/          voice notes (modules/voice, B29): the runtime.json `speech` block, Geometer's speech service and the WhatsApp media fetch through their Guards, the length of Ogg and WebM Opus, the cost, the day's limit and the memo; proved on scripts/gen_voice_vectors.ts
scripts/gen_chat_words.ts  writes internal/runtime/chatwords/words.json (the chat's own words: the rate line, the quick taps, "Voice message") from the TypeScript
scripts/gen_customer_talk.ts  writes internal/assistant/customerwords/words.json: a customer's talk prompt for every personality, character name and language, and its answer schema; gen_customer_talk_vectors.ts the checks, answers and prompts the Go ones are proved on
scripts/gen_claimwords.py  writes internal/listings/claimwords_gen.go from the TypeScript word lists (talk-check.ts), so the four-language words are never retyped
scripts/gen_bookings_reading.ts  writes internal/bookings/reading.json: the Bookings rule parser's patterns, the decision model's questions, the model's prompt and schema as templates
scripts/gen_patterns.ts    writes internal/language/patterns.json from the TypeScript's built RegExps (`.source`, `.flags`) and testdata/pattern-vectors.json (what JavaScript finds with each
                           in a corpus); `--check` only compares; the test words-fresh fails when it was not run after a change to a pattern it names
scripts/gen_words.ts       renders the owner's words (and the lists the rules read, and the owner-control alerts with the moment they carry) from the TypeScript into internal/assistant/words/*.json.gz; `--check` only compares. `node go/scripts/gen_words.ts` after any change to modules/assistant/words*.ts, modules/listings/words.ts or the alerts in modules/channels/owner-phones.ts and owner-signin.ts (the test words-fresh fails when it was not run)
scripts/gen_directory.ts   writes internal/directory/words/pack.json.gz (+ the font) from modules/discovery/words.ts and modules/channels (look, paints, MCP versions); `--check` only compares (modules/discovery/contract/words-fresh.test.ts runs it). The directory's vectors (testdata/) were made by a generator deleted with the TypeScript directory: they are the source
scripts/sync_rates.sh      copies the dated rate tables (modules/understanding/rates) into internal/budget/rates, which the binary embeds (a test keeps them equal)
scripts/gen_guard_vectors.ts  runs the TypeScript Guard clients against a recording HTTP server (lib/record.ts) and writes what they sent and made of each answer to internal/*/testdata (cases in scripts/vectors/); `--check` only compares; the words-fresh test fails when it is stale
scripts/gen_*_vectors.ts   what the TypeScript digest, formatters and rules give on a set of cases, for the Go tests (internal/assistant/testdata)
scripts/gen_assistant_vectors.ts  writes internal/runtime/testdata/assistant-lines.json: the assistant's lines in four languages (the day's list, a closed day, every limit line, cards, a customer's closed-day template) and what the outgoing check finds in them as written and tampered
scripts/gen_talk_facts_vectors.ts  writes internal/bookings/testdata/talk-facts-vectors.json: what the owner's talk on a Bookings shop is given (the skill's facts and public sources, the prompt with the declared limits, the schema)
```

## Dependencies, and why each

Only the four Go modules the owner approved, and what they themselves need (all from proxy.golang.org):

| module | why |
| --- | --- |
| `modernc.org/sqlite` | the shop's store: pure Go (no cgo), so the binary is one file and cross-compiles; the same file format the TypeScript runtime writes |
| `github.com/go-webauthn/webauthn` | the passkey ceremonies (registration and sign-in): the client data, challenge, origin, relying-party hash, user presence and verification, signature and counter are its checks, not code of ours. Its `protocol` and `webauthncose` packages also read and write the COSE keys |
| `github.com/gowebpki/jcs` | RFC 8785 canonical JSON, which every signed document is signed over |
| `golang.org/x/text` | Unicode (owner's yes, 19 Nov): a recovery code as typed is NFKC-folded and upper-cased with the full mapping, as JavaScript's `normalize("NFKC").toUpperCase()`; the owner's and the model's words are put in NFC (and the claim lists in NFD) as TypeScript does (`unicode/norm`); the Stock page sorts as `localeCompare` does (`collate`) |

Everything else is the standard library: `crypto/ed25519` and `crypto/x509` for the key (PKCS#8 DER, base64url, as the store keeps it), `net/http` for the server and the model call,
`database/sql`, `encoding/json`, `regexp`, `time/tzdata` (the zone database inside the binary).

Indirect modules come in with those four (for example `golang.org/x/crypto`, `github.com/fxamacker/cbor`, `modernc.org/libc`); `go.sum` pins them.

## Conventions

* Layering, one way only: `language` <- `memory` <- `understanding` <- `assistant` <- `runtime`; the Bookings, Orders and Fees runtimes reuse the first three.
* Every file starts with what it is and why. A choice that is not obvious says why. Where Go and JavaScript differ (UTF-16 lengths, the whitespace `\s` matches, regular expressions
  with no look-behind, `Math.round`) the comment says which TypeScript behaviour it copies.
* The shop's state is the TypeScript runtime's JSON, field for field. What this runtime does not model (the limit changes, of which only `id`, `state` and `told` are read, any member a later version adds, and any member of a note it does not know)
  is carried through as raw JSON, so a shop that goes back to the TypeScript runtime loses nothing. The shop's memory is modelled field for field (internal/memory).
* No home-folder paths, no keys; the binary's path in tests comes from `LISTINGS_GO_BIN` or `go/bin/listings`.
