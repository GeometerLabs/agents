# Go runtime for a listings-only shop

A listings-only shop is the smallest kind: it only shows what it has (`templates/commerce/listings`). This folder is **the shop's runtime written in Go**, begun as a trial of whether code
that runs inside a shop can be Go (decision 61, `docs` repo `plans/next-phase.md` section 1c). The trial's results, wave 1a (the rest of the listings shop) and wave 1 merged (with the
owner control) are in [TRIAL.md](TRIAL.md). The deployer runs it (wave 1b): a template folder that says `"runtime": "go"` in `template.json` (listings 0.2.0) is run from the programs' image, which the server builds from its own checkout (see "On a server" below). `cmd/listings` runs ONE shop, the way `templates/commerce/listings/server/main.ts` does, and it reads
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

`listings health <url>` and `listings-shared health <url>` do one GET and exit 0 on a 200, else 1: the container health check of an image that has no shell or wget.

### On a server (wave 1b)

The server compiles the programs itself, from its own checkout, in the official Go image pinned by digest in `bundle/release.json` (`go_image`, `go_image_digest`), at install (`install.sh`) and at `geometer update`; `geometer go-build` does it by hand. Source mounted read-only, `CGO_ENABLED=0`, `GOTOOLCHAIN=local`, `-trimpath -mod=readonly -buildvcs=false -ldflags "-s -w"`, a named volume `geo-go-cache` for the module and build cache. The result is `geo-go:<commit>`, an image `FROM scratch` of the programs alone (no shell, no tools, no certificates), run as `1000:1000`. To add a program (`cmd/directory`, `cmd/bookings`): one line in `GO_PROGRAMS` in `bundle/lib/go-build.ts`, and the template's `template.json` names it. The whole account is in `bundle/Explanation.md` ("How the Go runtimes reach a server"). Measured 19 Nov 2026 on an Apple-silicon Mac (Docker Desktop, 8 GB VM, linux/arm64): the image is **32.7 MB** (both programs); the compile took **12.3 s** from an empty build cache with the modules already in the cache volume (the first build on a server also downloads the modules, about 360 MB in the module cache, not measured here), **13.1 s** with the image made; peak memory of the compile container about **830 MB** (sampled once a second, so a floor). With the full-server settings (`-p 1`, `GOMAXPROCS=1`, `GOGC=50`, a 1536 MB wall) it is **46.7 s from an empty build cache and a peak of 1107 MB** by the container's own counter, about 730 MB of it process memory, the rest file cache. A fresh data volume came out owned by 1000:1000, and one shop's runtime and the shared process were both "healthy" 7 s after `up`, read-only, all capabilities dropped, with the `health` subcommand as their check.

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
internal/assistant/      the owner's assistant: its state (cards, talk, undo, typed; unknown members stay raw), the card binding (the digest TypeScript and Go agree on, the judge), the owner's words read by rule, and the words it says, packed per language (words/*.json.gz, made by scripts/gen_words.ts from the TypeScript words and unpacked once per process per language); the runtime package runs it in a step (assistant.go, draft.go, ownerview.go)
internal/budget/         the shop's model budget and the month's AI counts (modules/budget, modules/understanding/ai-state.ts)
internal/shared/         the multi-shop host (the Go twin of modules/runtime/shared.ts): finds shop folders, routes /shop/<name>/..., contains a shop that panics or sticks (strikes, quarantine in a child process, pause); read its header first
internal/health/         the `health` subcommand both programs share (one GET of an address, exit 0 or 1)
cmd/listings-shared/     main of the multi-shop host (SHOPS_DIR, SECRETS_DIR, HOST, PORT, SCAN_SECONDS, STATE_DIR; `--one <shop>` is the child it starts for a quarantined shop)
internal/runtime/        the runtime: the folder read and checked, the one-at-a-time step runner, the owner_message draft, the model call, the HTTP routes; owner.go is the
                         owner's sign-in routes, the tick's owner part and the owner's side of push (who may subscribe, what ends a subscription, the alerts to the
                         owner's phones), all under one owner lock; push.go, limits.go, ownerfile.go, stock.go and assistant.go are the other owner routes
scripts/gen_claimwords.py  writes internal/listings/claimwords_gen.go from the TypeScript word lists (talk-check.ts), so the four-language words are never retyped
scripts/gen_words.ts       renders the owner's words (and the lists the rules read, and the owner-control alerts with the moment they carry) from the TypeScript into internal/assistant/words/*.json.gz; `--check` only compares. `node go/scripts/gen_words.ts` after any change to modules/assistant/words*.ts, modules/listings/words.ts or the alerts in modules/channels/owner-phones.ts and owner-signin.ts (the test words-fresh fails when it was not run)
scripts/sync_rates.sh      copies the dated rate tables (modules/understanding/rates) into internal/budget/rates, which the binary embeds (a test keeps them equal)
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

* Every file starts with what it is and why. A choice that is not obvious says why. Where Go and JavaScript differ (UTF-16 lengths, the whitespace `\s` matches, regular expressions
  with no look-behind, `Math.round`) the comment says which TypeScript behaviour it copies.
* The shop's state is the TypeScript runtime's JSON, field for field. What this runtime does not model (the assistant's memory, the limit changes, which the limits routes read and write as they are, any member a later version adds) is carried through as raw
  JSON, so a shop that goes back to the TypeScript runtime loses nothing.
* No home-folder paths, no keys; the binary's path in tests comes from `LISTINGS_GO_BIN` or `go/bin/listings`.
