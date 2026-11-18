# shop-feed/1: what a shop has, signed by the shop

**Status:** draft, 18 November 2026. **Written by:** Geometer. **Licence:** the same as this repository.

A shop feed is one JSON file that says what a shop has right now, where the shop is, and how to reach it. A directory reads it to
build its search; a search engine or an AI assistant may read it too. The shop's own runtime writes it from the shop's own record.

## Where it is

- At `<shop page>/listings.json`, for example `https://streetlist.in/glow-salon/listings.json`.
- The shop's page links to it: `<link rel="alternate" type="application/json" title="shop-feed/1" href="listings.json">`.
- The shop's Agent Card names it (see [agent-card.md](agent-card.md)).
- It exists only while the owner has turned on "Show my shop on Streetlist and in search". Otherwise the address answers `404`.

## HTTP

| | |
|---|---|
| Method | `GET` (and `HEAD`) |
| Type | `application/json; charset=utf-8` |
| Caching | `Cache-Control: public, max-age=300` and an `ETag`; a reader sends `If-None-Match` and gets `304` when nothing changed |
| Other sites | `Access-Control-Allow-Origin: *` (it is public data, read-only) |
| Size | at most 1 MB; at most 200 items |

## The document

```json
{
  "format": "shop-feed/1",
  "updated": "2026-11-18T03:30:00.000Z",
  "shop": {
    "name": "Rani Pets",
    "page": "https://streetlist.in/rani-pets/",
    "trade": "pet shop",
    "languages": ["ml", "en"],
    "place": { "town": "Thrissur", "pincode": "680001", "lat": "10.527642", "lon": "76.214435" },
    "chat": "https://streetlist.in/rani-pets/chat",
    "check": "https://streetlist.in/rani-pets/api/v1/check",
    "agentCard": "https://streetlist.in/rani-pets/agent-card.json",
    "registration": { "kind": "pet-shop", "number": "KL/SAWB/PS/0123", "source": "owner" }
  },
  "items": [
    {
      "id": "l-3",
      "page": "https://streetlist.in/rani-pets/#l-3",
      "category": "pets",
      "title": { "ml": "പേർഷ്യൻ പൂച്ചക്കുട്ടി", "en": "Persian kitten", "hi": "फ़ारसी बिल्ली का बच्चा", "kn": "ಪರ್ಷಿಯನ್ ಬೆಕ್ಕಿನ ಮರಿ" },
      "text": { "ml": "…", "en": "…", "hi": "…", "kn": "…" },
      "ownerLanguage": "ml",
      "machineWritten": ["en", "hi", "kn"],
      "price": { "value": "8000.00", "currency": "INR", "note": "each" },
      "quantity": 2,
      "photos": [{ "url": "https://streetlist.in/rani-pets/photo/ph-9.jpg", "type": "image/jpeg", "width": 1200, "height": 900 }],
      "availability": "in_stock",
      "confirmed": "2026-11-17T04:10:00.000Z"
    }
  ],
  "signature": {
    "alg": "Ed25519",
    "keyId": "q3Jt…(43 characters)",
    "key": "MCowBQYDK2VwAyEA…(the public key, SPKI DER, base64url)",
    "sig": "…(64 bytes, base64url)"
  }
}
```

### Fields

| Field | Meaning |
|---|---|
| `format` | Always `"shop-feed/1"` for this version. |
| `updated` | When the shop's record last changed anything in this file (ISO 8601, UTC). |
| `shop.name`, `shop.page` | The shop's public name and page, as the page shows them. |
| `shop.trade` | The shop's trade in plain words (a preset's name, or what the Operator typed). Optional. |
| `shop.languages` | The languages the shop answers in, the owner's first. |
| `shop.place` | Where the shop is: `town` (required), `pincode` (optional), `lat` and `lon` (optional, decimal degrees as strings with at most 6 decimals, so every language reads them alike). The owner sets it. |
| `shop.chat`, `shop.check`, `shop.agentCard` | Where a buyer chats, where a directory asks a [shop-check](shop-check.md), and the shop's Agent Card. |
| `shop.registration` | Optional. A registration the trade needs (a pet shop's, under the Prevention of Cruelty to Animals (Pet Shop) Rules, 2018), with `source: "owner"`: it is the owner's word, never checked by anyone. A reader must not call it "verified". |
| `items[].id` | The listing's id in the shop ("l-3"). Never given to another listing. |
| `items[].category` | One of `pets`, `food`, `clothes`, `home`, `electronics`, `vehicles_and_cycles`, `services`, `other`. |
| `items[].title`, `items[].text` | The words, in each language the shop has. `ownerLanguage` is what the owner said or typed; the languages in `machineWritten` were written by an assistant from it, and a reader showing them should say so. |
| `items[].price` | The owner's price: `value` is rupees as a decimal string with two places (exact; never a float), `currency` is `"INR"`, `note` is optional ("each", "per kg"). `null` means "ask the shop". |
| `items[].quantity` | How many the shop has, when the owner counts them. Optional. |
| `items[].photos` | At most 3. Each is a JPEG or WebP at an address under the shop's page, with its location data removed by the shop. |
| `items[].availability` | `in_stock`: the owner confirmed it in the last 3 days. `call_to_check`: confirmed 3 to 30 days ago. |
| `items[].confirmed` | When the owner last said it is still there. |

What a feed never holds: a listing that is sold, removed, or not confirmed for 30 days; anything about customers, orders or
conversations; the owner's own number, unless the shop's public page already shows it.

## The signature

The shop signs the feed with its own Ed25519 key.

1. Take the document without its `signature` member.
2. Write it as canonical JSON ([RFC 8785](https://www.rfc-editor.org/rfc/rfc8785), JSON Canonicalization Scheme): object members
   sorted by key, no spaces, strings escaped the JSON way. The format has no floating-point numbers, so every language writes the same
   bytes.
3. Sign those UTF-8 bytes with Ed25519. `sig` is the 64-byte signature, base64url without padding.
4. `key` is the public key (SPKI DER, base64url). `keyId` is the base64url SHA-256 of the raw 32-byte public key.

**A reader** checks the signature against `key`, then checks that `keyId` matches the key it already knows for this shop page (it pins
the first key it saw). A different key is not trusted until the change is confirmed some other way; see
[directory.md](directory.md#keys).

**The key belongs to the shop.** The shop's runtime makes it on its first start and keeps it in the shop's own folder. It is in the
shop's backup and in the file the owner can take ("Get my shop's file"), so a shop that changes its Operator keeps its key, and every
directory still knows it.

## "My feed changed"

When the feed changes, the shop's runtime tells the directories it knows (its server's own directory, and any the owner adds):

```http
POST <directory>/feed-changed
Content-Type: application/json

{ "format": "shop-feed-changed/1", "feed": "https://streetlist.in/rani-pets/listings.json", "updated": "2026-11-18T03:30:00.000Z",
  "keyId": "q3Jt…", "sig": "…" }
```

The signature covers the canonical JSON of the notice without `sig`, with the same key as the feed. The notice is only a hint: a
directory never takes listings from it. It fetches the feed again (at most once a minute per feed) and believes only what the signed
feed says. A directory that gets no notices still re-reads each feed at least every 6 hours.

## Why this shape

- **One file, at the shop's own address.** Anyone can read it, and the address moves with the shop. No directory owns the data.
- **Signed by the shop, not by us.** A cache, a mirror or another directory can pass the feed on, and no one along the way can change
  a price.
- **schema.org on the page, this file for programs.** The shop's page carries the same items as schema.org `Product` and `Offer` for
  search engines; this file adds what they do not carry: the freshness, the machine-written languages and the signature.
- **Money as decimal strings.** The same rule as the ONDC mapping (`modules/ondc/money.ts`): exact rupees, never a float.
