# The directory contract

A suite that describes what the directory SERVICE does **as the outside sees it** (`bundle/services/directory.ts`: the process the deployer runs as the `directory` container), so more than
one implementation can be held to it. Every test writes the service's config as the deployer does, starts the service as a **separate process** on a free port and talks to it only over
HTTP (and reads two of its files, read only). Decision 61, wave 1c (the same method as `templates/commerce/listings/contract/`).

```
DIRECTORY_IMPL=ts node --test --test-concurrency=1 modules/discovery/contract/        # the TypeScript service (the default)
DIRECTORY_IMPL=go DIRECTORY_GO_BIN=go/bin/directory node --test --test-concurrency=1 modules/discovery/contract/
```

On `go` with no binary at `DIRECTORY_GO_BIN` (default `go/bin/directory`) every test is skipped and says why. Build: `cd go && go build -o bin/directory ./cmd/directory`.
Every process the harness starts goes through `templates/commerce/listings/contract/children.ts` (its own process group, stopped at the end of every test, a leak fails the run).

## The inventory

**Routes** (all through the door, which forwards them; the service itself answers on `PORT`/`HOST`):

| route | what |
| --- | --- |
| `GET /healthz` | `ok` (never limited; the container's health check) |
| `GET /search` | the people's page (HTML), or `directory-search/1` JSON for `Accept: application/json` (without text/html) or `format=json`; `q category lat lon town radius_km lang offset` |
| `POST /search/ask` | "Ask in your own words" (only with the assistant on; else 404): form body `ask lat lon lang`, at most 2 KB, same-origin only (`Origin`/`Sec-Fetch-Site`) |
| `GET /search/font.woff2`, `GET /order` | the font; the page that states the fair order in plain words |
| `POST /feed-changed` | a signed `shop-feed-changed/1` notice: a hint only; 2 KB |
| `POST /mcp` | MCP over JSON (`initialize ping tools/list tools/call`, batches of 1 to 20): `search_listings get_listing shop_page` and, with the assistant on, `ask`; 16 KB |
| `GET /.well-known/agent-card.json` | the directory's own Agent Card, signed (JWS, EdDSA) with its key |
| anything else | `404 Not here` |

Per address (the LAST entry of `X-Forwarded-For`, held as a salted hash in memory): 40 searches, 90 protocol calls, 20 notices, 120 page views a minute. No cookie, `Referrer-Policy: no-referrer`,
a content policy with a nonce for the one script.

**Config** (`CONFIG`, default `/etc/geometer/directory.json`, written by `bundle/generate/configs.ts directoryConfig`): `origin served[] doorUrl dataDir feeds[] provider{organization,url} area?
assistant?{monthlyMicroInr dailyCalls perBuyerPerDay model{wire baseUrl model} provider? agentTokenFile}` (the config may also carry `systemOne`; the deployer never writes it). Environment: `PORT`
(8799), `HOST` (127.0.0.1), and for the tests `DIRECTORY_TICK_MS` (20 000).

**Files** (in `dataDir`): `directory.sqlite` (the index: a CACHE of the shops' own feeds, plus the list of feeds, the pinned key of each shop page and the key changes waiting for a person; schema 1,
the same file in both runtimes) and `directory.key` (the service's own signing key, PKCS#8 base64url, 0600, made on the first start; it signs only the Agent Card). The assistant's credential is the
file `agentTokenFile` names (read once at start; unreadable or empty leaves the assistant off). Sub-commands run beside the service (`docker exec`): `changes` lists the key changes that wait,
`accept <shop page>` accepts one.

**Outbound calls**: a feed (`GET <page>listings.json`, `If-None-Match` after the first read, 10 s, at most 1 MB) and a check (`POST <check address>`, `{"format":"shop-check/1","ids":[...]}`, 1.5 s, at
most 64 KB) at an address under a served pages domain go to `doorUrl` with that domain as the Host; any other address (a configured feed on a builder's own domain) is called directly and refused
unless https, a public DNS name and an address that is not private, loopback, link-local or reserved. A model call (`POST <baseUrl>/chat/completions`, the directory's own `Authorization: Bearer`,
JSON schema `typed_search`) only with the assistant on. Nothing else leaves.

**The timed work**: every `DIRECTORY_TICK_MS` (20 s) the feeds that are due are read, four at a time: hinted by a notice (at most once a minute per feed), never read, or not read for six hours.
A 404 or 410 keeps the shop's items and, after a whole day of it, drops the feed and its items (the pinned key stays). A feed signed by another key than the pinned one is HELD (hidden from
every search) and listed for a person.

## Which test file covers what, and what is left to a unit test

| TypeScript test (`modules/discovery/test/`) | covered by | what stays a unit test (a pure function: a Go unit test with vectors made from the TypeScript) |
| --- | --- | --- |
| `feed.test.ts` (reading a feed, the limits, the money strings) | **contract** `feeds.contract.test.ts` (over HTTP: what is listed, dropped, refused and why) | `parseFeed` on every field: a unit test with vectors (`go/internal/directory/testdata`) |
| `index.test.ts` (the index, words, FTS, the rebuild) | **contract** `search.contract.test.ts` (four languages, Latin letters, filters, the rebuild is not reachable) | `skeleton` (romanise), `normal`, `wordsOf`: unit with vectors |
| `search.test.ts` (candidates, order, check, the 10) | **contract** `search.contract.test.ts` (fit, bands, in stock, turns, the cap) and `feeds.contract.test.ts` (the checks) | the order function on fixed seeds: unit with vectors (`order`, `turnHash`) |
| `order.test.ts` (the order never reads a price) | **contract** `search.contract.test.ts` (same shops, other prices and names: same order) | the field list and the fixed-seed order: unit |
| `notices.test.ts` | **contract** `feeds.contract.test.ts` (accepted, refused, limited, once a minute) | `feedAllowed` on addresses: unit with vectors of the TypeScript URL reader (`testdata/url-vectors.json`) |
| `http.test.ts` (routes, headers, privacy, limits) | **contract** `search.contract.test.ts` | the limiter window: unit |
| `page.test.ts` (the pages in four languages) | **contract** `search.contract.test.ts` (the states, the policy, the escaping) | the words, the price format, "confirmed N days ago": unit with vectors; and the packed words are GENERATED from the TypeScript with a freshness test |
| `mcp.test.ts` | **contract** `search.contract.test.ts` (the endpoint) and `assistant.contract.test.ts` (`ask`) | none |
| `assistant.test.ts` (typed search, cleaning, rules, caps, grounding) | **contract** `assistant.contract.test.ts` (good and malformed answers, caps, credential, cleaning, the page) | `readTypedSearch`, `cleanQuestion`, `readRules`, `requestOf`: unit with vectors; `groundedProblem` (the hook for a model-written line, which the service never wires) and the decision model (`systemOne`, which the deployer never configures) are NOT ported (Deferred.md) |

Not covered over HTTP because a test cannot reach it: the rebuild of the index from its kept feeds (`rebuildIndex` is called by no service path), and a real model or provider (everything is a scripted fake).

`harness.ts` also holds the fake door (one local server that answers for every shop of the pages domain), the fake shops (signed with the TypeScript signing module, as the TypeScript shops
are) and the fake OpenAI-compatible model. The order rotates by day, so the tests check its PROPERTIES, never a fixed sequence; each test uses a visitor address of its own so the limits of one
never meet another's.
