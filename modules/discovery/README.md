# discovery: a directory of local shops

## What it is for

A buyer wants "a Persian kitten near Thrissur". The shops that have one are many small shops, each with its own server or none at all. This module is
**a directory**: a program that reads what each shop publishes, keeps a search index, and answers searches fairly, from a web page, from a JSON
address, and from AI assistants.

It follows four open documents, in [`specs/`](../../specs/README.md), and anyone may run their own directory from them:

| Document | What it says |
|---|---|
| [`shop-feed.md`](../../specs/shop-feed.md) | The signed file a shop publishes: what it has, where it is, how to reach it. |
| [`shop-check.md`](../../specs/shop-check.md) | The question "do you still have these?" and the shop's signed answer. |
| [`agent-card.md`](../../specs/agent-card.md) | How a shop and a directory describe themselves to other programs (A2A Agent Cards). |
| [`directory.md`](../../specs/directory.md) | How a directory reads feeds, orders results, answers searches over HTTP and MCP. |

The rule the whole design keeps: **find in an index, then ask the shop to confirm.** A directory never asks every shop on every search. It searches
its own index (which can be an hour old), puts the matches in a fair order, and asks only the ten shops it is about to show, with item ids and nothing about the buyer.

## Architecture

```
  shops (anywhere)                          the directory (this module)                        askers
  ────────────────                          ───────────────────────────                        ──────
  <shop page>/listings.json  ──read──►  refresh.ts ── feed.ts (limits, fields)
  (shop-feed/1, signed)                        │       trust.ts (signature, key pinned)
                                               ▼
  POST /feed-changed  ──hint──►  notices.ts ─► ingest.ts ─► index.ts  SQLite + FTS5 (a cache)
  (shop-feed-changed/1)                                          │
                                                                 ▼ candidates (no order yet)
                                          search.ts ◄── order.ts  THE fair order (pure)
                                               │
        <shop page>/api/v1/check  ◄──ask──  check.ts   top 10 shops, ids only, ~1.5 s, 60 s memory, signature checked
        (shop-check/1, signed)                 │
                                               ▼
                                   http.ts ─►  GET /search      page for people (page.ts, words.ts), or JSON
                                               GET /order       the rule in plain words
                                               POST /mcp        search_listings, get_listing, shop_page (mcp.ts)
                                               GET /.well-known/agent-card.json (card.ts, signed)
```

Files with no `node:` import at all (no disk, no database, no network, so an agent's own import graph may use them): `types.ts`, `feed.ts`, `order.ts`, `romanise.ts`,
`text.ts`, `words.ts`, `page.ts`, `limits.ts` and `search.ts` (it takes the index and the checker handed in). Files that use only `node:crypto` (to check a signature):
`trust.ts`, `check.ts`, `notices.ts`, `card.ts`. `mcp.ts` reuses the shops' MCP handling in `modules/channels`. **Server files**: `index.ts` (opens a SQLite file), `ingest.ts` and
`refresh.ts` (write the index), and `http.ts` (serves a file and sockets). The network is never opened here: a `Fetcher` is handed in (see `types.ts`), so a test needs no network. The program that runs it
in Geometer's deploy bundle is `bundle/services/directory.ts`.

## The data it keeps

All of it is a **cache** of what shops publish, rebuilt by reading the feeds again (`rebuildIndex`). One SQLite file.

| Table | Holds | Derived? |
|---|---|---|
| `feeds` | Each feed address, where it came from (`config` or `notice`), its ETag, when it was last tried, a pending hint (`wanted_at`), since when it answers 404/410, the last error, and the **text of the last accepted feed** | the list is kept on a rebuild |
| `pins` | For each shop page, the **first key** seen (`key_id`, `key`) | kept on a rebuild |
| `key_changes` | A shop whose feed came signed by another key: the pinned id, the offered key, when. For a person to look at | kept |
| `shops` | name, trade, town, pincode, `lat`, `lon`, chat/check/card addresses, languages, registration (the owner's word), the key it is checked with, `status` (`ok` or `held`) | derived |
| `items` | id, category, titles and texts in every language (JSON), owner language, machine-written languages, price (`"8000.00"` and a note, never a float), quantity, photos (JSON), availability, confirmed date | derived |
| `items_fts` | FTS5: `title`, `body`, `rom` (a rough Latin spelling of all words), `place` (town and pincode) | derived |
| `counts` | `(day, 'searches' or 'results', n)` | the only record of use |

There is **no table of searches, visitors, addresses or sessions**, and a test checks the table list.

### `directory-search/1` (what a search answers)

```json
{ "format": "directory-search/1",
  "results": [ { "shop": { "name": "Rani Pets", "page": "https://streetlist.in/rani-pets/", "town": "Thrissur", "distanceKm": 1.4 },
                 "item": { "id": "l-3", "title": "Persian kitten", "lang": "en", "machineWritten": true, "category": "pets",
                           "price": { "value": "8000.00", "currency": "INR", "note": "each" }, "photo": "https://streetlist.in/rani-pets/photo/ph-9.jpg",
                           "availability": "in_stock", "confirmed": "2026-11-17T04:10:00.000Z" },
                 "chat": "https://streetlist.in/rani-pets/chat?about=l-3", "checked": true } ],
  "order": "https://streetlist.in/order", "next": null }
```

`price` is `null` for "ask the shop". `checked: false` means the shop did not answer (or answered with a signature that is not its pinned key's, or late):
the item shows with `availability: "call_to_check"`. `next` is the `offset` of the next page, or `null`.

## The order of results

The order is made in **one place**, `order.ts` (`orderResults`), and the people's page, the JSON search and the MCP tools all call it. The owner's rule:
*never by payment, plan or Operator*. The steps:

1. **Fit**: items that match every word, then items that match some. (A category is a filter.)
2. **Distance** in bands: 0–2, 2–5, 5–10, 10–25, 25–50, over 50 km. With only a town: the buyer's town first. A shop with no map point counts as near only in the buyer's own town.
3. **Freshness**: in stock before "call to check", within a band.
4. **Taking turns**: shops in the same band take turns; the order is shuffled by a hash of the day and the search, so no shop is always first. At most 3 items of one shop in the first 10 while other shops have items to fill the places.

How it is kept honest in code, not only in words: the function's input type (`Candidate`) has six fields (`key`, `shop`, `fit`, `distanceKm`, `sameTown`, `inStock`),
it copies them one by one (no spread), the rotation is the last tie-break (no fallback to arrival order, name or database row), and the tests fail if a field is
added, if an extra property changes the order, or if the source mentions a price, plan, payment, Operator, advertising, size or popularity. After the shops
confirm, the freshness may change and the order is made **again by the same function**.

## Words in four languages

A listing carries its words in English, Hindi, Malayalam and Kannada (the owner's own, and the ones an assistant wrote). The index holds all of them, so a
search in any language finds the item. The feed carries native script, so a buyer typing Latin letters ("billi", "poocha", "bekku") would miss it; the `rom`
column holds a rough Latin spelling of every word (`romanise.ts`: long vowels short, doubled letters one, "kh" as "k", a final "a" dropped) and a search is
turned into the same spelling. It is deliberately loose and matches by word start. A word that names the shop's town or pincode (the `place` column) counts toward "every word" but
never makes an item a match by itself, so "persian kitten Thrissur" does not list everything a Thrissur shop sells (and so spends no shop checks on it). The tokenizer is configured to keep Indic vowel signs inside words (the
default one cuts a word at every sign).

## Protocols

| Address | What | Spec |
|---|---|---|
| `GET /search?q=&category=&lat=&lon=&town=&radius_km=&lang=&offset=` | The people's page (HTML, no script needed), or JSON with `Accept: application/json` or `format=json` | [directory.md](../../specs/directory.md#the-search-api) |
| `GET /order` | The rule in plain words, in four languages; linked from every page | [directory.md](../../specs/directory.md#the-order) |
| `POST /feed-changed` | A shop's "my feed changed" hint: `shop-feed-changed/1`, at most 2 KB | [shop-feed.md](../../specs/shop-feed.md#my-feed-changed) |
| `POST /mcp` | MCP (streamable HTTP, JSON): `search_listings`, `get_listing`, `shop_page`, all read-only; the same JSON-RPC handling as a shop's endpoint (`modules/channels/mcp.ts`) | [directory.md](../../specs/directory.md#the-search-api) |
| `GET /.well-known/agent-card.json` | The directory's A2A Agent Card, signed | [agent-card.md](../../specs/agent-card.md) |
| `GET /search/font.woff2`, `GET /healthz` | The page's heading font (Baloo 2, SIL OFL); liveness | |

**Which feeds it reads.** A notice is accepted only for a feed under a pages domain the directory serves (`https://<domain>/<slug>/listings.json`) or exactly one
of its configured feed addresses; every known feed is read again at least every 6 hours with `If-None-Match`, and at most once a minute however many notices
come; a feed that answers 404 or 410 for a whole day is dropped with its items.

**What a feed must be.** At most 1 MB and 200 items; `shop-feed/1`; at the address its own shop page names (`<page>listings.json`) with every address in it
(chat, check, card, item pages, photos) under that page; signed (Ed25519, [modules/signing](../signing/README.md)). One malformed item is dropped with a
note and the others stay.

## Security and privacy

- **A feed can only speak for its own page.** Every address in it must sit under the shop's page, so one shop cannot claim another's page (and with it
  the other's pinned key), and a `check` address cannot point the directory anywhere else.
- **Keys are pinned.** The first key seen for a shop page is kept (the full public key, not only its id, so check answers and notices can be verified). A
  feed signed by another key is **held**: the shop leaves every search and the change is listed (`keyChanges()`); `acceptKeyChange(page)` is the person's decision.
- **A shop's answer is checked.** A check answer must be for that shop's page, signed with its pinned key, made within two minutes of the directory's clock
  (a recorded "in stock" cannot be played back later), and about items that were asked for. Anything else is treated as no answer.
- **The shop never learns the search.** The question is `{"format":"shop-check/1","ids":[...]}` and nothing else (no words, place, cookie or address of the buyer);
  `check.ts` takes no such input. The directory's pages send `Referrer-Policy: no-referrer`, so opening a shop's chat from a result does not tell the shop what was searched.
- **No cookie, no account, no tracking.** Counts per day only. Per-address limits live in memory under a salted hash, are forgotten after their window and
  after a restart (`limits.ts`). The address used is the last `X-Forwarded-For` entry (the door appends the real one).
- **Notices are hints.** A notice for a known shop must be signed by it; a notice never supplies a listing; the number of feeds is capped.
- **Output is escaped** (`page.ts` uses the shared `esc`); the page's policy loads nothing from elsewhere and posts only to `/search`; a photo is shown only when it is
  served from the directory's own address, so opening a page never tells another server who looked.
- **Money is a decimal string** ("8000.00"), never a float, as in the ONDC mapping.

## Run it

In Geometer's deploy bundle it is the `directory` service on a server with a pages domain (`bundle/services/directory.ts`, `bundle/Explanation.md`). On its own:

```ts
import { DirectoryIndex } from "./index.ts";
import { createChecker } from "./check.ts";
import { directoryHandler } from "./http.ts";
import { refreshDue } from "./refresh.ts";
import { directoryCard } from "./card.ts";
import { generateSigningKey } from "../signing/keys.ts";

const index = new DirectoryIndex("directory.sqlite");
index.addFeed("https://shops.example/rani-pets/listings.json", "config", Date.now());
const fetch = myFetcher;                       // a Fetcher (types.ts): GET/POST with a timeout and a size cap, throws when it cannot answer
const origin = "https://search.example";
const card = directoryCard({ origin, provider: { organization: "Me", url: origin }, key: generateSigningKey() });
createServer(directoryHandler({
  search: { index, checker: createChecker({ fetch }), origin }, origin, card: () => card,
  notices: { served: ["shops.example"], configured: [] },
})).listen(8799);
setInterval(() => void refreshDue({ index, fetch }), 20_000);   // reads what is due: new, hinted (once a minute) or older than 6 hours
```

A `Fetcher` must refuse private and loopback addresses when feeds can come from strangers; Geometer's service reuses the door's guarded transport.

## Test

```
cd modules && node --test discovery/test/ signing/test/
```

The tests use hand-made signed fixtures that follow the specs (`test/fixtures.ts`), not the shop side's code: `feed.test.ts` (limits, fields, addresses under the page, key
pinning), `order.test.ts` (each rule, taking turns, the cap, and that nothing else can reach the order), `index.test.ts` (four languages and Latin spelling find the same
item, distance, a held key, rebuild), `search.test.ts` (checks: gone dropped, a slow or silent or wrongly signed or replaying shop shown with "Call to check", ids only),
`notices.test.ts`, `mcp.test.ts` (tools and the Agent Card), `page.test.ts` (every state in four languages), `http.test.ts` (over a real local port, no cookie on any answer).

## Extend

- **Another place a result can come from**: add a reader that produces a `Feed` (feed.ts's shape) and call `index.ingest`. The signature and pinning are
  `trust.ts`; do not skip them.
- **Another language**: add it to `Lang` (`types.ts`), `words.ts` (all lines) and `romanise.ts` (its script), and to the review sheets (`bundle/panel/review.ts`).
- **A new tool for assistants**: add it to `DIRECTORY_TOOLS` and `directoryServer` in `mcp.ts`, and to the skills of `card.ts`; keep it read-only.
- **A change to the order**: only in `order.ts`, with a change to [directory.md](../../specs/directory.md#the-order) and to the page that states it
  (`words.ts`, `orderSteps`); the tests that keep forbidden inputs out must still pass.

## Not built, and why

- **The buyer's assistant** (a model that turns "Persian kitten near Thrissur?" into a search and the results into words) is the next piece. The directory is
  ready for it: it is the same `search_listings` call.
- **The A2A message endpoint.** The card lists only what is served (MCP and the JSON search).
- **Directories linking to each other.** One directory reads feeds it is told about; it does not ask other directories.
- **Key rotation signed by the old key.** A key change is held for a person. See `modules/Deferred.md`.
- **Finding shops by itself.** It reads feeds that notices name and feeds in its list. Geometer's service does not yet ask fleet which shops have listing on.
- **Photos from other addresses.** Not shown (they would tell that server who looked).
