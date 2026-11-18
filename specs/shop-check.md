# shop-check/1: "do you still have these?"

**Status:** draft, 18 November 2026.

A directory finds candidates in its own index, which can be minutes or hours old. Just before it shows a result to a buyer, it asks
the few shops it is about to show whether the items are still there and at what price. The shop answers from its own record, at once,
with no language model, and signs the answer. This is the "ask to confirm" half of "find in an index, ask the shop to confirm".

## Where it is

One more operation of the shop's public API (`modules/channels/api.ts`) and the same tool on its MCP endpoint (`<shop page>/mcp`):
the API, the MCP tools and the page's operations come from one list (`ops.ts`), and a test keeps the three the same.

```http
POST <shop page>/api/v1/check
Content-Type: application/json

{ "format": "shop-check/1", "ids": ["l-3", "l-7"] }
```

MCP: the tool `check_items` with the argument `{ "ids": ["l-3", "l-7"] }`.

## The answer

```json
{
  "format": "shop-check/1",
  "page": "https://streetlist.in/rani-pets/",
  "at": "2026-11-18T09:12:00.000Z",
  "items": [
    { "id": "l-3", "availability": "in_stock", "price": { "value": "8000.00", "currency": "INR", "note": "each" }, "quantity": 2,
      "confirmed": "2026-11-17T04:10:00.000Z" },
    { "id": "l-7", "availability": "gone" }
  ],
  "signature": { "alg": "Ed25519", "keyId": "q3Jt…", "sig": "…" }
}
```

| `availability` | Meaning |
|---|---|
| `in_stock` | Live, and the owner confirmed it in the last 3 days. |
| `call_to_check` | Live, confirmed 3 to 30 days ago. Show it with "Call to check". |
| `gone` | Sold, removed, hidden, not confirmed for 30 days, or never shown in the feed. A directory drops it. |

The answer says no more than the feed would say about the same items. It is signed like the feed ([shop-feed.md](shop-feed.md#the-signature)),
over the canonical JSON of the answer without `signature`, with the same key.

## Rules

- **At most 10 ids** in one question. Unknown ids answer `gone`; the answer does not say whether an id ever existed.
- **Nothing about the buyer.** The question carries item ids only: no search words, no place, no buyer, no session. A shop cannot
  tell who searched or for what.
- **No model.** The answer is read from the shop's record. A check costs the shop nothing and cannot be talked into a different answer.
- **Limits.** The front's per-address limits apply (the same as every public operation). A directory caches answers for 60 seconds and
  asks with a timeout of about 1.5 seconds; a shop that does not answer in time is shown with the index's data and "Call to check".
- **Read only.** A check changes nothing in the shop's record and is not written in it (it is not an event of the shop's).

## Why

Asking every shop on every search (a broadcast) is always fresh but slow, costly, and shows every buyer's question to every shop. An
index alone is fast but can be stale. Asking only the shops about to be shown, with ids only, gives a fresh answer where it matters,
in about a second, and tells the shops nothing about the buyer.
