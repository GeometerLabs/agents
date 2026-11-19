# internal/directory: what was built

The directory of local shops in Go, wave 1c of decision 61: since 19 Nov 2026 THE directory (the TypeScript `modules/discovery` and `bundle/services/directory.ts` it replaced are deleted).
One service, `cmd/directory`, reading the config file the deployer writes and the data folder existing servers have (`directory.sqlite`, `directory.key`, in the `directory-data` volume at
/home/node/directory); `modules/discovery/contract/` is the black-box suite it passes. The deployer runs it from the programs' image (`bundle/generate/compose.ts`, `bundle/lib/go-build.ts`),
with `/directory health` as its health check; a person's commands are `docker exec <directory> /directory changes` and `/directory accept <shop page>`.

## Files

| file | what | TypeScript it follows |
| --- | --- | --- |
| `jsutil.go` | the web-form behaviours Go lacks: `URLSearchParams` read and written, `encodeURIComponent` (the text ones, UTF-16 lengths and slices, `toLowerCase`, NFC, `trim`, TextDecoder, `Date.parse`, are `internal/language`'s, shared with the shops' runtime) | the language |
| `whatwg.go` | an https address read as `new URL` reads it, or refused (never accepted with another meaning) | `new URL` |
| `text.go`, `romanise.go`, `romanise_tables.go` | normalising, search words, distance, the hash; the Latin fold (its tables were generated from `romanise.ts`; Go source since the deletion) | `text.ts`, `romanise.ts`, `order.ts` (hash) |
| `feed.go`, `trust.go`, `check.go`, `notices.go`, `ingest.go`, `refresh.go` | reading a feed, pinning a key, asking a shop, notices, the timed read | the same names |
| `index.go` | the SQLite index (the same file: schema 1, FTS5 with the same tokenizer) | `index.ts` |
| `order.go`, `search.go`, `limits.go` | the fair order, a search, per-address limits | the same names |
| `words.go`, `page.go`, `words/` | the words (generated from `modules/discovery/words.ts`, which stays), the shops' style sheet and paints (generated from `modules/channels`), and the Go-source parts (`words/page.css`, `script.js`, `mcp.json`, `cards.json`, `assistant.json`); the search page and the order page | `words.ts`, `page.ts` |
| `card.go`, `mcp.go`, `http.go` | the signed Agent Card, the MCP endpoint (its JSON-RPC too), the routes | `card.ts`, `mcp.ts`, `channels/mcp.ts` (`serverPost`), `http.ts` |
| `clean.go`, `assistant.go` | the buyer's assistant: cleaning (the personal details by `understanding.Redact`, then the addresses), the patterns, the typed search, the caps; the model call is `understanding.Model` (`Open`, `AskContext`), the one the shops use | `assistant.ts`, `understanding/redact.ts`, `understanding/model-llm.ts` (the openai wire) |
| `fetcher.go` | the way out: the door's own port for this server's shops, a guarded direct call for any other address; connections kept and reused (32 idle a host, 4 s), as Node's agent keeps them | `services/directory.ts`, `services/door.ts` |

Signature checking lives in `internal/signing` (`VerifyDocument`, `VerifyNotice`), beside the signing the shops' runtime already uses: one implementation of the Ed25519 over RFC 8785 canonical
JSON, read and write. A document is checked over its members exactly as received, so a member this code does not know is signed over as written.

## Choices that are not obvious

* **Regular expressions.** RE2 has no look-behind and no look-ahead, and its `\s` is ASCII. The patterns spell the white space out (`jsWS`), the look-behind is a check of the character before
  a match, and the look-ahead is a trailing group that takes one character and gives it back (`clean.go`, `assistant.go`).
* **Addresses.** `whatwg.go` refuses what it does not model (a host that is not plain ASCII letters, digits, hyphens and dots, or ends in a number, userinfo, backslash, a dot segment). A
  refusal where JavaScript accepts is the safe direction; `vectors_test.go` checks hostile addresses made by the TypeScript: the Go result is JavaScript's or a refusal.
* **The index is one connection.** The TypeScript index is one synchronous connection; one connection here keeps a feed going in whole while a search reads.
* **Words.** `scripts/gen_directory.ts` renders the words from `modules/discovery/words.ts` (the one TypeScript file of the directory kept: the review sheet reads it) into `words/pack.json.gz`,
  with the shops' style sheet (`look.ts` CUSTOMER_CSS), paints and MCP versions; every function-valued line is checked against its template for n = 0..1000, and
  `modules/discovery/contract/words-fresh.test.ts` fails when the pack is stale. What had no TypeScript source left after the deletion became Go source, cut byte for byte from what the generator
  made before (the page's own CSS with `{{shops}}` and `{{kinds}}` slots, the script, the MCP tools, the Agent Card bodies, the assistant's prompt and schema, the Latin-fold tables).
* **The model call** is `internal/understanding`'s (`Open` with the directory's own credential, `AskContext` with the request's context, 8000 ms and 1024 tokens by default): the body is written
  in model-llm.ts's member order with no HTML escaping, the schema as the raw JSON in its own order, the answer decoded to `any` and checked by hand, cached input tokens read and priced at the
  cached rate. Before the join it was a copy of its own (`AskJSON`), with struct decoding.
* **Tests made from the TypeScript before it went.** `testdata/vectors.json` (text, fold, order, addresses, dates, numbers, requests, cleaning, typed answers), `testdata/feeds.json.gz` (a good feed
  and 47 changes: what the reader refuses and why, drops, keeps), `testdata/pages.json.gz` (the search page in every state, four languages, the order page, whole). Their generator
  (`gen_directory_vectors.ts`) was deleted with the TypeScript; the files are the source. The contract's `golden/differential.json.gz` holds the TypeScript service's answers to several hundred
  requests (see its README). Hand-written tests carry the TypeScript tests' rules that need a clock or a fake network: `fetcher_test.go`, `check_test.go`, `limits_test.go`, `refresh_test.go`,
  `notices_test.go`, `cmd/directory/main_test.go`.
* **JSON member order** is the TypeScript object's wherever a struct or `orderedMap` writes it; a Go map would sort. The Agent Card is a map (its signature is over the sorted RFC 8785 form, so
  the order of members is not part of it).

## Found in the TypeScript (not changed)

* A feed's `updated` is read and kept but never judged: a stale feed is not refused for its age (only a check answer's `at` has a window). The spec does not ask for one.
* `lang=` on `/search` with an unknown language falls back to the browser's language (English), so `readRequest`'s `lang must be en, hi, ml or kn` is reachable only over MCP.
* `rebuildIndex` (`ingest.ts`) was called by no service path; its Go twin is not written.
