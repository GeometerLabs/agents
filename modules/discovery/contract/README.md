# The directory contract

A suite that describes what the directory SERVICE does **as the outside sees it** (the program the deployer runs as the `directory` container: since 19 Nov 2026 the Go program
`go/cmd/directory`). Every test writes the service's config as the deployer does, starts the service as a **separate process** on a free port and talks to it only over HTTP (and reads two of
its files, read only). Decision 61, wave 1c (the same method as `templates/commerce/listings/contract/`). Until the TypeScript service (`bundle/services/directory.ts`, `modules/discovery`) was
deleted, every test passed on both; its answers are kept in `golden/` (below).

```
cd go && go build -o bin/directory ./cmd/directory && cd ..
node --test --test-concurrency=1 modules/discovery/contract/        # DIRECTORY_GO_BIN names another binary (default go/bin/directory)
```

With no binary every test that needs one is skipped and says why. Every process the harness starts goes through `templates/commerce/listings/contract/children.ts` (its own process group,
stopped at the end of every test, a leak fails the run).

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

## The golden answers, the clock

`differential.test.ts` used to give the TypeScript and the Go service the same requests over the same shops and compare the answers whole. Before the TypeScript was deleted it was
RECORDED: `golden/differential.json.gz` holds its 456 answers (every page state in four languages, the JSON, the filters and refusals, the limit pages, the MCP answers, the notices, the
assistant over the form and the tool, the card's body), masked only where a run differs (nonces, ISO times, the card's signature, the style sheet by its hash). It was recorded twice
(identical), and both services matched it. A replay runs at the recorded instant: the fake shops' clock (`harness.ts now()`) and the directory's test clock (`GEOMETER_TEST=1`,
`GEOMETER_TEST_CLOCK_FILE`; refused unless the service listens on 127.0.0.1, which the deployer never gives it) are moved back to it, so the day the order turns on and "Confirmed today"
come out as they were. After a change that is meant, record again (`DIRECTORY_GOLDEN=write`, see the file's header) and read the difference.

## Where the TypeScript unit tests went (deleted 19 Nov 2026)

| TypeScript test (`modules/discovery/test/`) | now checked by |
| --- | --- |
| `feed.test.ts` | `feeds.contract.test.ts` (over HTTP) and `go/internal/directory/golden_test.go` `TestFeedsReadAsTheTypeScriptReadThem` (a good feed and 46 changes, the TypeScript reader's answers in `testdata/feeds.json.gz`) |
| `index.test.ts` | `search.contract.test.ts`, `cross-restart.test.ts`, the golden answers, `refresh_test.go` (a failing feed keeps the index; fewer items replace the old), `vectors_test.go` (the fold, the words); the rebuild is not ported (Deferred.md) |
| `search.test.ts` | `search.contract.test.ts`, `feeds.contract.test.ts`, the golden answers, `check_test.go` (60 s memory at 59 and 61 s, the two-minute edge, an answer changed after signing, the question's body) |
| `order.test.ts` | `search.contract.test.ts`, `order_test.go`, `vectors_test.go` (the TypeScript's order on 36 cases) |
| `notices.test.ts` | `feeds.contract.test.ts`, `shop-protocol.contract.test.ts`, `notices_test.go`, `refresh_test.go` |
| `http.test.ts` | `search.contract.test.ts`, the golden answers (every route's status and headers), `limits_test.go` (the window resets after a minute) |
| `page.test.ts` | the golden answers and `golden_test.go` `TestPagesAreTheTypeScriptPages` (every state in four languages, whole, as the TypeScript rendered them: `testdata/pages.json.gz`) |
| `mcp.test.ts` | `search.contract.test.ts`, `assistant.contract.test.ts`, the golden answers (every MCP answer whole) |
| `assistant.test.ts` | `assistant.contract.test.ts`, the golden answers, `vectors_test.go` (typed answers, cleaning, rules); the decision model and the model-written line are not ported (Deferred.md) |
| `bundle/test/directory-service.test.ts`, `directory-assistant.test.ts` | the deployer's checks: `bundle/test/go-runtime.test.ts`; the service's way out: `fetcher_test.go`; its key: `cmd/directory/main_test.go`; its credential: `assistant.contract.test.ts` |
| `modules/listings/test/protocol.test.ts` (its four checks with the directory's reader) | `shop-protocol.contract.test.ts` (the shops' own feed, check answer and notice, accepted by the directory) |

Not covered over HTTP because a test cannot reach it: the rebuild of the index from its kept feeds (no service path), and a real model or provider (everything is a scripted fake).

`harness.ts` also holds the fake door (one local server that answers for every shop of the pages domain), the fake shops (signed with the TypeScript signing module, as the TypeScript shops
are; `shop-protocol.contract.test.ts` uses the shops' own protocol code) and the fake OpenAI-compatible model. The order rotates by day, so the tests check its PROPERTIES, never a fixed sequence; each test uses a visitor address of its own so the limits of one
never meet another's.
