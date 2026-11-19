# Go runtime for a listings-only shop

A listings-only shop is the smallest kind: it only shows what it has (`templates/commerce/listings`). This folder is **the shop's runtime written in Go**, begun as a trial of whether code
that runs inside a shop can be Go (decision 61, `docs` repo `plans/next-phase.md` section 1c). The trial's results, wave 1a (the rest of the listings shop) and wave 1 merged (with the
owner control) are in [TRIAL.md](TRIAL.md). It is not wired into the deployer yet: `cmd/listings` runs ONE shop, the way `templates/commerce/listings/server/main.ts` does, and it reads
the same folder; `cmd/listings-shared` runs every shop of a server in one process, the way `server/shared-main.ts` does.

What stays TypeScript: the front (`modules/channels/front.ts`), the deployer, the panel, the directory. They call this runtime over HTTP and cannot tell which one answered; the
**contract** in `templates/commerce/listings/contract/` is what both must pass.

## Build and run

```
cd go
go build -o bin/listings ./cmd/listings                 # 23.3 MB; with -ldflags "-s -w" 16.4 MB (19 Nov, wave 1 merged)
go build -o bin/listings-shared ./cmd/listings-shared   # 23.8 MB; with -ldflags "-s -w" 16.8 MB
INTERNAL_TOKEN_FILE=internal_token CHANNEL_TOKEN_FILE=channel_token RECORD_KEY_FILE=record_key \
  bin/listings --client <shop folder>/client
```

The folder, the three token files and the environment are the TypeScript runtime's (`modules/runtime/shared.ts` `folderSource` describes the layout): `client/` holds `settings.json`,
`runtime.json`, `pathway.lock` (written last), `owner-link.json`, `pages.json` and `owner-grants.json`; the secrets are `internal_token`, `channel_token` and `record_key`. `runtime.json`
says where to listen (`host`, `port`) and where the data is (`dataDir`). Ctrl+C or SIGTERM finishes the step in hand and closes the store.

The contract against this binary (from the repository root; build both binaries first, the shared-process and cross-runtime tests use them):

```
LISTINGS_IMPL=go LISTINGS_GO_BIN=go/bin/listings node --test --test-concurrency=1 templates/commerce/listings/contract/
```

The Go version is 1.27 (`go.mod`). No cgo: the binary needs no C library.

## Package map

```
cmd/listings/            main: the command line, the token files, start and stop (the Go twin of server/main.ts + modules/runtime/start.ts)
internal/store/          the shop's SQLite file, schema 5, the same tables as modules/runtime/store.ts: the queue, the snapshot in pieces, the record, photos, the shop's key
internal/signing/        the shop's Ed25519 key, RFC 8785 canonical JSON, the signed feed / answer / notice and the Agent Card's JWS (modules/signing)
internal/listings/       the listings: state and rules, the owner's ops, the public and owner reads, the feed and check documents, photos, the assistant's draft and its grounding checks
internal/access/         the owner's sessions, sign-in links, passkeys (WebAuthn), the Operator's setup code and card, and who controls them (the gate, the Operator's requests,
                         Geometer's reset, the owner's phones and own codes, the number lock), in owner-access.sqlite, same schema (modules/channels owner-*.ts, webauthn.ts)
internal/testclock/      the contract tests' clock (GEOMETER_TEST=1 + GEOMETER_TEST_CLOCK_FILE, a "fakes" shop only; a live shop refuses to start with it)
internal/push/           web push: the push store (push.sqlite, the TypeScript runtime's own file), RFC 8291 encryption, VAPID, the sender to the shop's push Guard (modules/push)
internal/language/       the bottom layer of reading words (modules/language): plain, canon, JavaScript's string length and whitespace; regex.go matches a JavaScript pattern the way
                         JavaScript does (each top-level alternative tried in turn at each place, the look-behind and look-ahead edges checked by hand, since RE2 has neither), over the
                         TypeScript's own built patterns (patterns.json, written by scripts/gen_patterns.ts); dates.go (findDatePhrase, resolveDate); check.go (the outgoing check)
internal/memory/         the shop's memory (modules/memory): notes with who, where, when and an audience, forget, the end of a note, recall within a scope; `assistant.memory`, field for field
internal/understanding/  the model steps (modules/understanding): one JSON call over the OpenAI-compatible wire (model.go), the System One decision model (systemone.go), the router
                         that reads cheapest first over any template's reading (router.go, generic), and the details taken out before a model sees words (redact.go); every model
                         answer is decoded to `any` and checked by hand
internal/assistant/      the owner's assistant: its state (cards, talk, undo, typed; unknown members stay raw), the card binding (the digest TypeScript and Go agree on, the judge), the owner's words read by rule (rules.go), the owner's reading for the router (reading.go), the owner's talk (talk.go: prompt, answer, checks), notes from words (notes.go), and the words it says, packed per language (words/*.json.gz, made by scripts/gen_words.ts from the TypeScript words and unpacked once per process per language); the runtime package runs it in a step (assistant.go, draft.go, notes.go, talk.go, morning.go, ownerview.go)
internal/budget/         the shop's model budget and the month's AI counts (modules/budget, modules/understanding/ai-state.ts), the decision model's breaker and the day's notices (steps.go)
internal/shared/         the multi-shop host (the Go twin of modules/runtime/shared.ts): finds shop folders, routes /shop/<name>/..., contains a shop that panics or sticks (strikes, quarantine in a child process, pause); read its header first
cmd/listings-shared/     main of the multi-shop host (SHOPS_DIR, SECRETS_DIR, HOST, PORT, SCAN_SECONDS, STATE_DIR; `--one <shop>` is the child it starts for a quarantined shop)
internal/runtime/        the runtime: the folder read and checked, the one-at-a-time step runner, the owner_message draft, the model call, the HTTP routes; owner.go is the
                         owner's sign-in routes, the tick's owner part and the owner's side of push (who may subscribe, what ends a subscription, the alerts to the
                         owner's phones), all under one owner lock; push.go, limits.go, ownerfile.go, stock.go and assistant.go are the other owner routes
internal/guard/          the shared core of every Guard client (modules/core faults.ts, http.ts, json.ts): the errors, the one HTTP client that sends no key, Guard's answers told apart in one place, the bytes JavaScript writes (JSON.stringify, encodeURIComponent, URLSearchParams); guardtest/ is the vector harness
internal/payments/       payments for every provider (modules/payments): the neutral types and interface, ensureLink, the careful refunds (held refunds never re-sent, the sweep), the in-memory stand-in gateway; razorpay/ the live client and webhook reader; upi/ the upi://pay link. The owner-marked UPI ledger is left for the Bookings wave
internal/messaging/      the WhatsApp clients (Meta, Gupshup partner and self-serve), the stand-in and fake, send-once, say, statuses, the webhook readers (modules/messaging)
internal/calendar/       the Google Calendar v3 client through the calendar Guard, the in-memory fake and the shop's own booking list (templates/commerce/bookings src/adapters)
internal/qr/             the UPI QR: matrix, SVG and PNG (modules/qr); see its Explanation.md for the overlap with the books branch
internal/terms/          the shop's terms: text and digest generated from the TypeScript words, the file check, the reader, the owner's side (modules/terms)
scripts/gen_claimwords.py  writes internal/listings/claimwords_gen.go from the TypeScript word lists (talk-check.ts), so the four-language words are never retyped
scripts/gen_patterns.ts    writes internal/language/patterns.json from the TypeScript's built RegExps (`.source`, `.flags`) and testdata/pattern-vectors.json (what JavaScript finds with each
                           in a corpus); `--check` only compares; the test words-fresh fails when it was not run after a change to a pattern it names
scripts/gen_words.ts       renders the owner's words (and the lists the rules read, and the owner-control alerts with the moment they carry) from the TypeScript into internal/assistant/words/*.json.gz; `--check` only compares. `node go/scripts/gen_words.ts` after any change to modules/assistant/words*.ts, modules/listings/words.ts or the alerts in modules/channels/owner-phones.ts and owner-signin.ts (the test words-fresh fails when it was not run)
scripts/sync_rates.sh      copies the dated rate tables (modules/understanding/rates) into internal/budget/rates, which the binary embeds (a test keeps them equal)
scripts/gen_guard_vectors.ts  runs the TypeScript Guard clients against a recording HTTP server (lib/record.ts) and writes what they sent and made of each answer to internal/*/testdata (cases in scripts/vectors/); `--check` only compares; the words-fresh test fails when it is stale
scripts/gen_*_vectors.ts   what the TypeScript digest, formatters and rules give on a set of cases, for the Go tests (internal/assistant/testdata)
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
