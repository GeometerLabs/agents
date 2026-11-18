# Go runtime for a listings-only shop (a trial)

A listings-only shop is the smallest kind: it only shows what it has (`templates/commerce/listings`). This folder is **the shop's runtime written in Go**, built as a trial of whether code
that runs inside a shop can be Go (decision 61, `docs` repo `plans/next-phase.md` section 1c). The results are in [TRIAL.md](TRIAL.md). It is not wired into the deployer or the
shared process: it runs ONE shop, the way `templates/commerce/listings/server/main.ts` does, and it reads the same folder.

What stays TypeScript: the front (`modules/channels/front.ts`), the deployer, the panel, the directory. They call this runtime over HTTP and cannot tell which one answered; the
**contract** in `templates/commerce/listings/contract/` is what both must pass.

## Build and run

```
cd go
go build -o bin/listings ./cmd/listings                 # about 20 MB; add -ldflags "-s -w" for about 14 MB
INTERNAL_TOKEN_FILE=internal_token CHANNEL_TOKEN_FILE=channel_token RECORD_KEY_FILE=record_key \
  bin/listings --client <shop folder>/client
```

The folder, the three token files and the environment are the TypeScript runtime's (`modules/runtime/shared.ts` `folderSource` describes the layout): `client/` holds `settings.json`,
`runtime.json`, `pathway.lock` (written last), `owner-link.json`, `pages.json` and `owner-grants.json`; the secrets are `internal_token`, `channel_token` and `record_key`. `runtime.json`
says where to listen (`host`, `port`) and where the data is (`dataDir`). Ctrl+C or SIGTERM finishes the step in hand and closes the store.

The contract against this binary (from the repository root):

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
internal/budget/         the shop's model budget and the month's AI counts (modules/budget, modules/understanding/ai-state.ts)
internal/runtime/        the runtime: the folder read and checked, the one-at-a-time step runner, the owner_message draft, the model call, the HTTP routes; owner.go is the
                         owner's routes and the tick's owner part, under one owner lock
scripts/gen_claimwords.py  writes internal/listings/claimwords_gen.go from the TypeScript word lists (talk-check.ts), so the four-language words are never retyped
```

## Dependencies, and why each

Only the four Go modules the owner approved, and what they themselves need (all from proxy.golang.org):

| module | why |
| --- | --- |
| `modernc.org/sqlite` | the shop's store: pure Go (no cgo), so the binary is one file and cross-compiles; the same file format the TypeScript runtime writes |
| `github.com/go-webauthn/webauthn` | the passkey ceremonies (registration and sign-in): the client data, challenge, origin, relying-party hash, user presence and verification, signature and counter are its checks, not code of ours. Its `protocol` and `webauthncose` packages also read and write the COSE keys |
| `github.com/gowebpki/jcs` | RFC 8785 canonical JSON, which every signed document is signed over |
| `golang.org/x/text` | Unicode: a recovery code as typed is NFKC-folded and upper-cased with the full mapping, as JavaScript's `normalize("NFKC").toUpperCase()` (owner's yes, 19 Nov) |

Everything else is the standard library: `crypto/ed25519` and `crypto/x509` for the key (PKCS#8 DER, base64url, as the store keeps it), `net/http` for the server and the model call,
`database/sql`, `encoding/json`, `regexp`, `time/tzdata` (the zone database inside the binary).

Indirect modules come in with those three (for example `golang.org/x/crypto`, `github.com/fxamacker/cbor`, `modernc.org/libc`); `go.sum` pins them.

## Conventions

* Every file starts with what it is and why. A choice that is not obvious says why. Where Go and JavaScript differ (UTF-16 lengths, the whitespace `\s` matches, regular expressions
  with no look-behind, `Math.round`) the comment says which TypeScript behaviour it copies.
* The shop's state is the TypeScript runtime's JSON, field for field. What this runtime does not model (the assistant's cards, talk, notes, stock, memory) is carried through as raw
  JSON, so a shop that goes back to the TypeScript runtime loses nothing.
* No home-folder paths, no keys; the binary's path in tests comes from `LISTINGS_GO_BIN` or `go/bin/listings`.
