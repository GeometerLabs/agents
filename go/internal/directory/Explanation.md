# internal/directory: what was built

The directory of local shops (`modules/discovery` and `bundle/services/directory.ts`) in Go, wave 1c of decision 61. One service, `cmd/directory`, reading the same config file, the same
data folder (`directory.sqlite`, `directory.key`) and answering the same routes as the TypeScript one; `modules/discovery/contract/` is the black-box suite both pass.

## Files

| file | what | TypeScript it follows |
| --- | --- | --- |
| `jsutil.go` | the JavaScript behaviours Go lacks: UTF-16 lengths and slices, `toLowerCase`, `trim`, `URLSearchParams`, `encodeURIComponent`, `Date.parse` (ISO forms) | the language |
| `whatwg.go` | an https address read as `new URL` reads it, or refused (never accepted with another meaning) | `new URL` |
| `text.go`, `romanise.go`, `romanise_gen.go` | normalising, search words, distance, the hash; the Latin fold (tables generated) | `text.ts`, `romanise.ts`, `order.ts` (hash) |
| `feed.go`, `trust.go`, `check.go`, `notices.go`, `ingest.go`, `refresh.go` | reading a feed, pinning a key, asking a shop, notices, the timed read | the same names |
| `index.go` | the SQLite index (the same file: schema 1, FTS5 with the same tokenizer) | `index.ts` |
| `order.go`, `search.go`, `limits.go` | the fair order, a search, per-address limits | the same names |
| `words.go`, `page.go` | the packed words (generated), the search page and the order page | `words.ts`, `page.ts` |
| `card.go`, `mcp.go`, `http.go` | the signed Agent Card, the MCP endpoint (its JSON-RPC too), the routes | `card.ts`, `mcp.ts`, `channels/mcp.ts` (`serverPost`), `http.ts` |
| `redact.go`, `assistant.go` | the buyer's assistant: cleaning, the patterns, the model call, the typed search, the caps | `assistant.ts`, `understanding/redact.ts`, `understanding/model-llm.ts` (the openai wire) |
| `fetcher.go` | the way out: the door's own port for this server's shops, a guarded direct call for any other address | `services/directory.ts`, `services/door.ts` |

Signature checking lives in `internal/signing` (`VerifyDocument`, `VerifyNotice`), beside the signing the shops' runtime already uses: one implementation of the Ed25519 over RFC 8785 canonical
JSON, read and write. A document is checked over its members exactly as received, so a member this code does not know is signed over as written.

## Choices that are not obvious

* **Regular expressions.** RE2 has no look-behind and no look-ahead, and its `\s` is ASCII. The patterns spell the white space out (`jsWS`), the look-behind is a check of the character before
  a match, and the look-ahead is a trailing group that takes one character and gives it back (`redact.go`, `assistant.go`).
* **Addresses.** `whatwg.go` refuses what it does not model (a host that is not plain ASCII letters, digits, hyphens and dots, or ends in a number, userinfo, backslash, a dot segment). A
  refusal where JavaScript accepts is the safe direction; `vectors_test.go` checks hostile addresses made by the TypeScript: the Go result is JavaScript's or a refusal.
* **The index is one connection.** The TypeScript index is one synchronous connection; one connection here keeps a feed going in whole while a search reads.
* **Words are generated.** `scripts/gen_directory.ts` renders the words, the style sheet and script (cut out of a page the real `page.ts` renders), the MCP tool definitions, the card (with slots)
  and the assistant's system prompt and schema (captured from a call to a fake model) into `words/pack.json.gz`; every function-valued line is checked against its template for n = 0..1000.
  `modules/discovery/contract/words-fresh.test.ts` fails when a committed file is stale. After the TypeScript directory is deleted, the generated files are the source.
* **The model call** (`AskJSON`) is the openai wire of `understanding/model-llm.ts` with its defaults (8000 ms, 1024 tokens). `internal/runtime/model.go` is the same call with the shop's
  defaults (12 s, 1200 tokens); the two can be joined into one package when `internal/understanding` lands (another stream's package: not touched here). Likewise `redact.go` and `CleanQuestion`
  are the directory's own text helpers, to be joined with `internal/language`.
* **JSON member order** is the TypeScript object's wherever a struct or `orderedMap` writes it; a Go map would sort. The Agent Card is a map (its signature is over the sorted RFC 8785 form, so
  the order of members is not part of it).

## Found in the TypeScript (not changed)

* A feed's `updated` is read and kept but never judged: a stale feed is not refused for its age (only a check answer's `at` has a window). The spec does not ask for one.
* `lang=` on `/search` with an unknown language falls back to the browser's language (English), so `readRequest`'s `lang must be en, hi, ml or kn` is reachable only over MCP.
* `rebuildIndex` (`ingest.ts`) is called by no service path; its Go twin is not written.
