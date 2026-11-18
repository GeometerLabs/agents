# directory/1: reading shop feeds, a fair order, and search

**Status:** draft, 18 November 2026.

A directory reads shop feeds ([shop-feed.md](shop-feed.md)), keeps a search index, and answers searches from people and from AI
assistants. Anyone may run one. Geometer runs one on its server, beside the door that serves the shops' pages; its code is
`modules/discovery/` and the service that runs it in the bundle.

## Which feeds it reads

1. **Notices.** A shop that turned listing on sends its directory "my feed changed" ([shop-feed.md](shop-feed.md#my-feed-changed)).
   The directory reads that feed if its address is under a pages domain the directory serves, or in its own list of feed addresses.
   It does not accept feeds from anywhere on the internet that it was not set up to read, so no one can fill it with junk.
2. **Its list.** A configured list of feed addresses (for example a builder's server with its own shops).
3. **Refresh.** Every known feed again at least every 6 hours, with `If-None-Match`; a feed that answers `404` or `410` for a day is
   dropped with its items.

A feed is refused when it is too large (over 1 MB or 200 items), not `shop-feed/1`, wrongly signed, or not at the address its own
shop page names (`<shop page>listings.json`) with every address in it (chat, check, agent card, items, photos) under that page. A feed
may only speak for its own page. One malformed item is dropped with a note and the shop's other items stay.

A notice ("my feed changed") is only a hint. When the directory already holds the shop's key, the notice must be signed with it. The
directory re-reads a feed at most once a minute however many notices come, caps the number of feeds it holds, and limits notices per address.

## Keys

The directory keeps, for each shop page, the first key it saw (`keyId`). A feed signed with another key is not shown: its items are
held, and the change is listed for a person to look at. A key changes only when a shop loses its folder (its key moves with it when the
shop changes Operator), so this is rare. A later version may let the old key sign the new one.

## The index

The index is a cache. It holds only what the feeds say, and it can be thrown away and rebuilt from them at any time.

- SQLite with FTS5 (`node:sqlite`, no other dependency): each item's titles and texts in every language it has, its category, the shop's
  place, availability, the confirmed date and the price.
- Words match in any of the four languages, because each listing carries its words in all of them (the owner's own, and the ones an
  assistant wrote). "billi", "poocha", "bekku" and "cat" find the same kitten: the feed carries native script, so the index also keeps
  a rough Latin spelling of every word (`modules/discovery/romanise.ts`: long vowels short, doubled letters one, "kh" as "k") and a search
  typed in Latin letters is turned into the same spelling. It is deliberately loose; the shop's own words and the shop's confirmation do
  the exact work. A word matches by its start, so a word with an ending still matches.
- Distance from the shop's `lat` and `lon` when it has them (haversine); otherwise the town. A shop with no map point counts as near
  only when it is in the buyer's own town.
- A shop whose feed was signed with another key than the pinned one is **held**: it is left out of every search until a person looks.

## The order

Results are in this order, and in no other:

1. **Fit.** Items that match every word of the search, then items that match some of them. When the search names a category, only
   that category. A word that names the shop's town or pincode counts toward "every word" but never makes an item a match by itself:
   "persian kitten Thrissur" lists the Thrissur shops' kittens, not everything a Thrissur shop sells.
2. **Distance.** Nearer first, in bands: 0–2 km, 2–5 km, 5–10 km, 10–25 km, 25–50 km, over 50 km. Without the buyer's place, the
   buyer's town first, then the rest.
3. **Freshness.** In stock before "call to check" within a band.
4. **Taking turns.** Shops in the same band take turns: their order rotates by day and by search, so no shop is always first. One shop
   has at most 3 items in the first 10.

**Never** by payment, plan, Operator, advertising, the shop's size or how often it is searched. This is the owner's rule of
16 November 2026, and the code in `modules/discovery/order.ts` is the only place the order is made. The page that states the rule in
plain words is linked from every search page.

## Search: asking the index, then the shops

1. Find candidates in the index.
2. Put them in the order above.
3. Ask the shops of the first 10 a [shop-check](shop-check.md) (in parallel, about 1.5 seconds each, answers kept 60 seconds). Drop
   what is `gone`. Use the price and availability the shop just gave. A shop that did not answer, answered late, or answered with a
   signature that is not its pinned key's keeps the index's data and shows "Call to check".
4. Put the shown items in the order again (an answer can change an item from "call to check" to "in stock", and freshness is part of
   the order), by the same function.
5. Answer.

A search gives up to 10 results; more are fetched with `offset=10`, `20`, ... (the `next` of the answer), and each page is confirmed
the same way. At most 3 items of one shop stand in the first 10, while other shops have items to put there.

## The search API

The same address answers a person with a page and a program with JSON: it answers JSON when the request says `Accept: application/json`
(and not `text/html`) or has `format=json`, and the page otherwise. Programs should send `Accept: application/json`.

```http
GET /search?q=persian+kitten&category=pets&lat=10.52&lon=76.21&town=Thrissur&radius_km=25&lang=ml&offset=0
```

```json
{
  "format": "directory-search/1",
  "results": [
    { "shop": { "name": "Rani Pets", "page": "https://streetlist.in/rani-pets/", "town": "Thrissur", "distanceKm": 1.4 },
      "item": { "id": "l-3", "title": "പേർഷ്യൻ പൂച്ചക്കുട്ടി", "lang": "ml", "category": "pets", "machineWritten": false, "price": { "value": "8000.00", "currency": "INR" },
                "photo": "https://streetlist.in/rani-pets/photo/ph-9.jpg", "availability": "in_stock", "confirmed": "2026-11-17T04:10:00.000Z" },
      "chat": "https://streetlist.in/rani-pets/chat?about=l-3", "checked": true }
  ],
  "order": "https://streetlist.in/order",
  "next": null
}
```

`lang` is the language the `title` is in: the buyer's if the listing has it, else the owner's, else English. `price` is `null` for "ask the
shop". `checked` is `true` when the shop just confirmed the item and `false` when it did not answer (then `availability` is
`call_to_check`). A bad request is `400` with `{ "error": "<plain sentence>" }`.

The same search is a server-rendered page for people (it works without JavaScript), and the MCP tools `search_listings`,
`get_listing` and `shop_page` on the directory's MCP endpoint, for AI assistants. The directory's [Agent Card](agent-card.md) lists them.

## Privacy

- No account, no cookie, no tracking for search. The pages send `Referrer-Policy: no-referrer`, so opening a shop's chat from a result
  does not tell the shop what was searched.
- The directory keeps counts (searches a day, results shown), never a search tied to a person or an address. Per-address limits are
  kept in memory only.
- Shops are asked about item ids only ([shop-check](shop-check.md#rules)); they never learn the search or the buyer.

## The buyer's assistant (optional)

A buyer may ask in their own words or by voice: "Persian kitten near Thrissur?". An assistant turns the question into a search (words,
category, place, distance) and the results into a short answer in the buyer's language, naming only listings the directory returned. It
never ranks (the order above does), never sees a shop's conversations, and the buyer's words are cleaned of numbers and names before a
model sees them. It runs only where its owner turned a model on; without one, the search box gives the same results.
