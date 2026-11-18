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

A feed is refused when it is too large (over 1 MB or 200 items), not `shop-feed/1`, or wrongly signed.

## Keys

The directory keeps, for each shop page, the first key it saw (`keyId`). A feed signed with another key is not shown: its items are
held, and the change is listed for a person to look at. A key changes only when a shop loses its folder (its key moves with it when the
shop changes Operator), so this is rare. A later version may let the old key sign the new one.

## The index

The index is a cache. It holds only what the feeds say, and it can be thrown away and rebuilt from them at any time.

- SQLite with FTS5 (`node:sqlite`, no other dependency): each item's titles and texts in every language it has, its category, the shop's
  place, availability, the confirmed date and the price.
- Words match in any of the four languages, because each listing carries its words in all of them (the owner's own, and the ones an
  assistant wrote). "billi", "poocha", "bekku" and "cat" find the same kitten.
- Distance from the shop's `lat` and `lon` when it has them; otherwise the town.

## The order

Results are in this order, and in no other:

1. **Fit.** Items that match every word of the search, then items that match some of them. When the search names a category, only
   that category.
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
   what is `gone`. Use the price and availability the shop just gave. A shop that did not answer keeps the index's data and shows
   "Call to check".
4. Answer.

## The search API

```http
GET /search?q=persian+kitten&category=pets&lat=10.52&lon=76.21&radius_km=25&lang=ml
```

```json
{
  "format": "directory-search/1",
  "results": [
    { "shop": { "name": "Rani Pets", "page": "https://streetlist.in/rani-pets/", "town": "Thrissur", "distanceKm": 1.4 },
      "item": { "id": "l-3", "title": "പേർഷ്യൻ പൂച്ചക്കുട്ടി", "machineWritten": false, "price": { "value": "8000.00", "currency": "INR" },
                "photo": "https://streetlist.in/rani-pets/photo/ph-9.jpg", "availability": "in_stock", "confirmed": "2026-11-17T04:10:00.000Z" },
      "chat": "https://streetlist.in/rani-pets/chat?about=l-3", "checked": true }
  ],
  "order": "https://streetlist.in/order",
  "next": null
}
```

The same search is a server-rendered page for people (it works without JavaScript), and the MCP tools `search_listings`,
`get_listing` and `shop_page` on the directory's MCP endpoint, for AI assistants. The directory's [Agent Card](agent-card.md) lists them.

## Privacy

- No account, no cookie, no tracking for search.
- The directory keeps counts (searches a day, results shown), never a search tied to a person or an address. Per-address limits are
  kept in memory only.
- Shops are asked about item ids only ([shop-check](shop-check.md#rules)); they never learn the search or the buyer.

## The buyer's assistant (optional)

A buyer may ask in their own words or by voice: "Persian kitten near Thrissur?". An assistant turns the question into a search (words,
category, place, distance) and the results into a short answer in the buyer's language, naming only listings the directory returned. It
never ranks (the order above does), never sees a shop's conversations, and the buyer's words are cleaned of numbers and names before a
model sees them. It runs only where its owner turned a model on; without one, the search box gives the same results.
