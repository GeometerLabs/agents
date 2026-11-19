# modules/listings: what a shop has, shown on its own page and in an open feed

## What it is for, and why

A small shop in a town has things people want to find: two Persian kittens, a second-hand cycle, a day's fresh fish. Today a person has to
type each one into some system for the shop, and most shops never do. This module lets the **shop's owner say it** ("two Persian kittens,
₹8,000 each", plus a photo from their phone), lets the **assistant write the listing** in four languages, and lets the owner **publish it with
one tap**. Nobody else types anything.

The listing is the shop's own record, kept in the shop's own store. Everything public is a copy made from it:

* the "What we have" page (`<shop page>/shop`),
* schema.org data on that page, for search engines,
* the open feed at `<shop page>/listings.json`, which follows the open spec [shop-feed/1](../../specs/shop-feed.md) and is **signed with the shop's own key**,
* "do you still have these?" at `POST <shop page>/api/v1/check` ([shop-check/1](../../specs/shop-check.md)) and the shop's Agent Card at `<shop page>/agent-card.json` ([agent-card.md](../../specs/agent-card.md)),
* the shop's export file and its nightly backup.

The owner's switch "Show my shop on Streetlist and in search" is **off by default**. While it is off, the page is `noindex` and the feed
answers 404. Nobody who runs the shop (the "Operator") can hold the data hostage: it is in the shop's own store, in its backup and in its
export, in an open format.

## Architecture

```
 owner's phone (the owner's app)                        the shop's runtime (one per shop)                      the public
 ───────────────────────────────                        ──────────────────────────────────                      ──────────
 photo ──(phone resizes to 1600 px JPEG)──► POST owner-photo ──► photo.ts checks + cleans ──► listing_photos table
 "two kittens ₹8,000 each" ─► assistant (modules/assistant)
        │  price, note, quantity: read from the words by RULE
        │  titles/texts in en/hi/ml/kn: from the talk model, then CHECKED against the words
        ▼
   draft listing (state "draft", not public) ──► ONE card: "Show this on your page?  [Show it] [No]"
        │ owner taps (an Authority from modules/memory)
        ▼
   listings.ts publish ──► assistant.listings in the shop's store (saved with the step, in the backup)
        │                                   │
        │                                   ├──► front: <shop>/shop        (HTML, photo tiles, JSON-LD when the switch is on)
        │                                   ├──► front: <shop>/listings.json (shop-feed/1, signed by the runtime, only when the switch is on)
        │                                   ├──► front: <shop>/agent-card.json (signed, only when the switch is on)
        │                                   ├──► front: POST <shop>/api/v1/check (answered and signed by the runtime, read only)
        │                                   └──► front: <shop>/listings/photo/<id>.jpg|webp
        ▼
   morning: "Still have the Persian kitten? [Yes] [Sold]"  (at most 3 a day) ──► confirm / sold
```

Files:

| File | What it does | Touches disk or network? |
|---|---|---|
| `listings.ts` | The state, every rule (limits, freshness, who may write, pets rules) | No (pure) |
| `photo.ts` | Reads a photo's kind and size from its bytes, removes EXIF and XMP | No (pure) |
| `feed.ts` | Builds `listings.json` (shop-feed/1, unsigned) and the schema.org JSON-LD; `feedItem` is the one item builder the check answer uses too | No (pure) |
| `protocol.ts` | Signs the feed, makes and signs the check answer and the "feed changed" notice, reads a check question (at most 10 ids) | No (node:crypto only) |
| `../runtime/shop-key.ts`, `../runtime/store.ts` (table `shop_key`) | Makes the shop's key on its first start, keeps it in the shop's database, adopts it from the owner's file | The shop's SQLite file |
| `../runtime/shop-protocol.ts`, `http.ts` (`/internal/channel/shop-feed`, `shop-check`, `shop-card`, `/internal/feed-notice`) | The runtime's side: builds from its own state and signs; the front and the inbox only carry | The shop's SQLite file |
| `../channels/shop-card.ts`, `ops.ts` (`check_items`), `storefront.ts` | The card builder, the check operation in the shop's one operation list, and the public routes | Served by the front |
| `../../bundle/services/notices.ts` | The inbox's courier that carries the notice to the directory | The network, from the inbox |
| `kit.ts` | The owner's page operations as events the runtime runs in a step; the public and owner reads | No (pure) |
| `words.ts` | Every line people read, in four languages; the review-sheet lines | No |
| `../assistant/listing-draft.ts` | Reads the owner's words by rule, asks the talk model, checks its answer | Model call through the model Guard |
| `../assistant/listing-card.ts` | The card (a "skill" of the assistant), the "Still have it?" question, listings as talk sources | No |
| `../channels/storefront.ts`, `owner-listings-page.ts` | The public page, feed and photo routes; the owner's listings page | Served by the front |
| `../runtime/store.ts` (table `listing_photos`), `http.ts`, `core.ts` | Photo bytes, owner routes, running the events | The shop's SQLite file |

## The data

Everything lives in the shop's assistant state, `assistant.listings` (plain JSON, saved in the same transaction as every other change):

```ts
ListingsState {
  seq: number;                  // last id given; ids ("l-3") are never reused
  items: Listing[];
  shop: { visible: boolean; town?; pincode?; lat?; lon?; registration?; extraCategories? };
  pending: PendingPhoto[];      // photos uploaded but not yet in a listing
  uploads: { day: string; n: number };   // the day's photo count (at most 30)
}
Listing {
  id: "l-3"; state: "draft" | "live" | "sold" | "removed";
  category: "pets" | "food" | "clothes" | "home" | "electronics" | "vehicles" | "services" | "other";
  ownerLang: "en" | "hi" | "ml" | "kn";                 // what the owner said; the others are machine-written
  words: { en?: {title, text}, hi?, ml?, kn? };         // title <= 80, text <= 400 characters
  pricePaise?: number; priceNote?: string; qty?: number; // the OWNER's price. None means "Ask the shop"
  photos: { id: "ph-<12 hex>", type: "image/jpeg" | "image/webp", width, height, bytes }[];   // at most 3
  createdMs; publishedMs?; confirmedMs?; soldMs?; removedMs?; askedMs?;
  by: "owner" | "operator" | "builder"; from: "whatsapp" | "app" | "panel";
  claims?: string[];            // the owner's own words about an animal's health, shown as "the owner says"
}
```

Photo bytes are in the table `listing_photos` of the same SQLite file (`id, type, width, height, bytes, at_ms`), so the nightly snapshot and the
replication carry them with the listings that name them.

## How the owner's words become a listing

1. The owner uploads a photo in their app. The phone resizes it (longest side 1600 px, JPEG), which drops location data.
2. The owner says or types the words. If a photo is waiting, or the words say "for sale" / "put this on my page" (four languages), and nothing
   else reads them (a refund, a note, a limit...), the assistant treats them as a listing (`listing-draft.ts`).
3. **Price, note and quantity are read from the words by rule**, never from a model. A bare number is never money (a rupee sign or word is
   needed). Two numbers give no quantity (guessing would be inventing).
4. The talk model is asked only for the category, a title and a short text in each of the four languages. The answer is **checked**, not trusted:
   every number in it (as a digit or a number word, in any of the four languages) must be a number the owner said; no guarantee, discount or
   promise the owner did not make; no health, vaccination or pure-breed word the owner did not use; protected animals are refused before the
   model is even asked.
5. A draft is made (state `draft`, never public) and ONE card is shown, bound to the exact fields: "Show this on your page?" The tap publishes
   those fields. If the draft changed since, the old card is void and a new one is made (the same rule as every card, `modules/assistant/cards.ts`).
6. Without a model (button mode, no key, the AI cap), the owner uses the plain form in the app: photo, title, price, category. The words are saved in
   the owner's language only.

Every model call goes through the model Guard and is counted in the month's AI spend. The tests use a scripted fake: **not tested on a real model**.

## Who may write

Writes need an `Authority` (`modules/memory`: `ownerAuthority`, `panelAuthority`), checked at run time. A customer's words have no path to any
write: customer code never imports the authority makers (a test reads the source). The only thing done without one is making a **draft**, which
nobody can see. Publishing, confirming, selling, removing, editing and the owner's settings all need the authority.

## Photos and their checks (`photo.ts`)

* Kind by the file's first bytes (JPEG `FF D8 FF`, or WebP `RIFF....WEBP`), never by name or the type the phone says. A PNG renamed `.jpg` is refused.
* At most about 1.5 MB, at most 4096 px a side (read from the header). Animated WebP is refused.
* JPEG: the APP1 (EXIF with GPS, XMP), APP13 (IPTC), comments and other application segments are removed; the colour profile and JFIF header are kept.
  WebP: the `EXIF` and `XMP ` chunks are removed and their flags cleared. Plain code, no dependency.
* The photo's name everywhere is `ph-` and 12 hex digits of the cleaned bytes' hash. An uploaded file name is never used.
* At most 30 photos a day per shop. Served only through the runtime, only if the photo belongs to a public listing (the owner may fetch their own drafts).
* Public address: `<shop page>/listings/photo/<id>.jpg|webp` (not the door's stable `/p/...` page address), with its own type, `nosniff`, a year's cache.
  The page's content policy names that one folder in its single `img-src`, never `'self'`.

## Freshness

The owner confirms with a tap ("Still have the Persian kitten? Yes / Sold"), at most 3 questions a day, about a listing at most every 2 days.
`fresh`: confirmed within 3 days ("Confirmed today"). `check`: older ("Call to check"). Hidden from the public after 30 days without a confirm (still in
the owner's list: "Confirm to show again"). Sold or removed: gone at once. A customer never confirms anything. The question's tap is bound to the listing
and the `confirmedMs` the owner was shown, so an old question does nothing.

## The storefront and the feed

* `GET <shop page>/shop`: "What we have", photo tiles in Streetlist's look, 360 px first, four languages, the price or "Ask the shop", the freshness in
  words, "Ask about this" (opens the shop's chat with the listing named: the chat greets with it and its first line says which listing, so the owner sees it).
  Always `noindex` until the owner's switch is on.
* With the switch on: no `noindex`, a `<link rel="alternate" type="application/json" title="shop-feed/1">`, and schema.org JSON-LD (the shop as a `Store`
  with its place, each listing as a `Product` with an `Offer` in INR, `InStock`). JSON for the script block is escaped (`<`, `>`, `&`, U+2028/9).
* `GET|HEAD <shop page>/listings.json`: **exactly [shop-feed/1](../../specs/shop-feed.md)**: names, `price.value` as a decimal string, places as strings, `availability`
  `in_stock | call_to_check`, `Cache-Control: public, max-age=300`, `ETag` with `304`, `Access-Control-Allow-Origin: *`, at most 1 MB and 200 items.
  The `signature` is the shop's (see "The signed feed" below); `shop.check` and `shop.agentCard` are always written. `shop.trade` is **left out**: the shop's trade is in the Operator's panel,
  which the shop's runtime cannot see (the pages file the deployer writes does not carry it yet), and the spec makes it optional. The storefront page also links to the Agent Card.
* The feed and the page carry only what a visitor may already see. No customer, no number of any customer, no owner's number, no draft, no sold listing.

## The shop's own key

One Ed25519 key per shop ([modules/signing](../signing/README.md)). It is the shop's identity: it signs the feed, every check answer, the Agent Card and every notice, and a directory pins the first
key it sees for a shop page. So the key must stay with the **shop**, not with whoever serves it.

* **Made** by the shop's runtime on its first start (`runtime/start.ts` calls `loadShopKey`), once, inside one database transaction.
* **Kept** in the shop's own database file (`agent.db`, table `shop_key`, one row), next to the record and the listings. That one file is what the nightly snapshot copies (`VACUUM INTO`, encrypted
  to the owner), what a restore puts back and what a move to another Operator carries, so the key is in the shop's backup and a restore gives the **same key id**. It is not in the state
  snapshot, so the owner's export of the listings (a plain file) never holds it.
* **In the owner's file** ("Get my shop's file"): `shop-key/shop-key.json`, in the owner's package only (`bundle/export/build.ts`; the Operator's package never has it). The export job writes it from
  the database at mode 0600 (`bundle/backup/export.ts writeShopKey`). To restore a shop from that file on a new server, put the file in the shop's data folder as `shop-key.json` before the shop
  first starts: the runtime adopts it once and deletes the file (no second plaintext copy is left beside the database). A key the shop already has is never replaced by a file.
* **Never logged, never sent**: the log says only the public key id. Only the public key and the key id leave the shop (in the feed's `signature`). The front, the inbox and the directory never hold it:
  the front asks the runtime for each signed document and passes it on.

## The signed feed

`runtime/shop-protocol.ts` builds the feed from the runtime's own state (the same public read the page uses) and signs it (`protocol.ts signedFeed`): the canonical JSON of the feed without
`signature`, Ed25519, `signature { alg, keyId, key, sig }`. The front sends only the shop's page address, name, languages and chat address; the runtime refuses a page that is not an address of this
shop (its `pages.json`), refuses a chat address off the page, and signs nothing else the front says. Served only while the owner's switch is on (404 otherwise). A directory's own reader
(`go/internal/directory` feed.go and trust.go; modules/discovery/contract/shop-protocol.contract.test.ts) accepts it and refuses it when a price is changed. A listing with no text (the plain form writes a title only) writes no `text` for that language, because the
reader refuses an empty string.

## Check: "do you still have these?"

`POST <shop page>/api/v1/check` with `{"ids": ["l-3", "l-7"]}` and the MCP tool `check_items` (`channels/ops.ts checkItemsOp`, one function for Bookings' and Orders' operation lists; a Fees centre and a Stock
orders shop answer the API route alone). The runtime answers from its record with no model, saying nothing more than the feed would, signs it and stamps it (`at`). At most 10 ids; an id
that is not public now is `gone` (sold, removed, hidden for 30 days without a confirm, a draft, a counted listing at 0, an id that never was, and every id while the switch is off). It is counted per shop (limit
kind `check`, 600 a minute under `shop:<name>`), not per address. It reads a copy of the saved state and writes nothing, not even a record line. The question carries ids only, and the front passes only the
page and the ids to the runtime.

## The Agent Card

`<shop page>/agent-card.json`, while the switch is on. `channels/shop-card.ts` builds it with the A2A 1.0.1 field names the directory's card uses (`go/internal/directory/words/cards.json`): skills `show_listings`, `check_items`
and the shop's own operations (from the same tool lists the API and MCP are made from), interfaces `MCP` (kinds that have an endpoint) and `HTTPS-JSON`. The runtime signs it with the shop's key (a JWS, the same
`kid` as the feed) only if every address in it is under the shop's page.

## How a notice gets out

A shop's runtime sits alone on its own internal network and cannot call anything outside it (`bundle/generate/compose.ts`). The server's directory is on the `pages` network. The one service on both the
network the runtimes' doors are on (`admin`) and the `pages` network is the **inbox**, which already holds each shop's internal token. So the inbox is the courier (`bundle/services/notices.ts`): every 30
seconds it asks each runtime `GET /internal/feed-notice`, and if a signed notice is due it sends it to `http://directory:8799/feed-changed` and tells the runtime `POST /internal/feed-notice {fingerprint}`.
No network rule changes, the runtime still only answers, and the notice is a hint (the directory re-reads the signed feed and believes only that).

* **Only a real change**: the runtime hashes the feed's content (without `updated`) and offers a notice only when that differs from the last one delivered. A price change is one; a read is not.
* **At most one a minute** per shop (the runtime), and at most 15 a minute in all from the inbox (the directory takes 20 a minute from one address). A directory that says wait (`429`) leaves the notice pending
  in the runtime; a refusal is acknowledged and not repeated until the feed changes again. A restart sends one notice, which is harmless.
* **Only for a shop with an address on the pages domain** (`pages.json` `url`): the directory accepts a notice only for `https://<pages domain>/<slug>/listings.json` or a feed in its own list.
* **Other directories**: not built. The shape to add: a list of directory addresses in the shop's settings (`assistant.listings.shop.directories`, https only, at most 5), delivered the same way by the
  courier; the inbox must then refuse private addresses as the directory's fetcher does. See `modules/Deferred.md`.

## Quantity and the stock count

`qty` is the owner's own number when they said one ("two kittens"). If the owner also **counts** the listing (the Stock page in their app, `modules/stock`, id `listing:l-3`), the count is the quantity: the feed's `items[].quantity` and the page show the count, and the listing leaves the page, the feed and the shop's talk by itself when the count reaches 0 (the owner's list marks it sold out). Nothing is written to the listing for this: `qty`, the words, the price and the digest of its card stay as the owner made them, and one place (the stock line) holds the count. The morning question "Still have it? Yes" on such a listing sets the count to the number the owner first said (or 1) and it shows again. A listing nobody counts is exactly as described above. See [`../stock/README.md`](../stock/README.md).

## Pets

A pets listing shows the shop's registration under the Prevention of Cruelty to Animals (Pet Shop) Rules, 2018 as "Registration (the owner says): ...", never as checked.
Nothing here, and nothing the shop's chat says, calls an animal healthy, vaccinated or pure-bred unless the owner's own words did, and then it is shown as "the owner says"
(`talk-check.ts` check 3b). A short list of protected native animals (parakeets and other native parrots, munias, mynas, native owls, Indian star tortoise and native
turtles, monkeys) is refused. **That list is a starting point and must be checked against the Wildlife (Protection) Act schedules from a primary source before a real
pet shop relies on it** (see `modules/Deferred.md`). It only ever refuses, so a gap lets a listing through, never turns a lawful one away.

## Security and privacy

* Owner-only routes check the owner's link or session at the runtime itself (`ownerAuthorised`), not at the front.
* A photo is read and cleaned by the runtime, not trusted from the phone. Route ids are matched against `ph-[0-9a-f]{12}` before any lookup; there is no path from a name.
* The public read (`kit.publicRead`) is a copy without `by`, `from` or the morning's asks. Drafts, sold, removed and hidden listings are not in it.
* Customer talk gets public listings as sources (`listing-card.ts listingSources`), so it can answer "how much is the kitten?" only from them.
* The record keeps a `listing` line per change with ids, category and who, never the words or the price (their keyed digest only).
* The shop's private key is in the shop's own database and the owner's file only; no feed, answer, card, notice, log, export of the listings or Operator's package holds it. The runtime signs only what it
  builds itself (the feed, the answer, the notice) and a card whose addresses are all under the shop's own page.
* A check is read only and tells the shop nothing about the buyer; its answer says no more than the feed.

## Run and test

No build step. From `agents/`: `node --test modules/listings modules/assistant/test/listings.test.ts modules/channels/test/storefront.test.ts bundle/test/listings-export.test.ts`.
The shop's side of the open protocol: `modules/listings/test/protocol.test.ts` (signed feed accepted by the directory's own reader, a changed price refused, check answers, the card, the notice),
`modules/runtime/test/shop-key.test.ts` and `shop-protocol-http.test.ts` (the key, the runtime's routes), `modules/channels/test/shop-protocol.test.ts` (the API, MCP, limits and card through the front for every kind
of shop), `bundle/test/shop-key-export.test.ts` (the owner's file) and `bundle/test/feed-notices.test.ts` (the courier).
Syntax of one file without running it: `node modules/module-map.ts` and the repo's checker. The fakes: a scripted talk model (`assistant/test/listings.test.ts`), a fake backend
(`channels/test/storefront.test.ts`).

## Extend it

* **A new category:** add its id to `CATEGORIES` in `listings.ts`, its name in four languages to `categories` in `words.ts`, and a colour in `storefront.ts CATEGORY_COLOUR`.
  If the feed spec names it differently, map it in `feed.ts SPEC_CATEGORY`. A builder can also add categories per shop (`shop.extraCategories`).
* **A new language:** add it to `Lang`/`LANGS` in `listings.ts`, give every line in `words.ts`, add it to the draft prompt in `assistant/listing-draft.ts`, and put the lines on the review sheets.
* **Another reader of the feed:** read `listings.json`; nothing else is needed. Use `ETag`.

## What is not built, and why

See `modules/Deferred.md`. In short: other directories the owner adds (notices go to the server's own directory only), signing-key rotation signed by the old key, the shop's trade in the feed; a vision model that
reads the photo (the first version reads the owner's words); the protected-animal list from a primary source; an ONDC mapping of listings; the A2A message endpoint;
a shop with listings only and no agent (phase C); photos kept in the shop's SQLite file, which is simple and backed up, but would be moved to files if shops grow very large.
