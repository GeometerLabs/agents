# modules/channels: a shop's public face and the owner's page

## What it is for

A shop's customers and the shop's owner meet the shop through the **front**: a small web server (`front.ts`) that serves, for every shop on a server, its booking or order page, its chat, its storefront
("What we have"), its JSON API, its MCP endpoint, and the owner's private page. This module is that front, its pages and the operations behind them. The front **holds no business rule and no key**: it checks the
shape of what it is sent, applies per-address limits, and passes everything to the shop's **runtime** (`modules/runtime`), which decides, saves, signs and answers.

## Architecture

```
 a customer, an AI assistant, a directory          the front (this module, one process for every shop)         the shop's runtime (one per shop)
 ─────────────────────────────────────────         ──────────────────────────────────────────────────         ─────────────────────────────────
 GET  <shop>/ , /chat , /shop                ──►   front.ts  limits, shapes, Origin checks               ──►   /internal/channel/...  (the channel token)
 POST <shop>/api/v1/...   (ops.ts, api.ts)   ──►   one operation list (ops.ts / order-ops.ts):                   decides, saves, answers, signs
 POST <shop>/mcp          (mcp.ts)           ──►   the API, the MCP tools and the pages are three maps
 GET  <shop>/listings.json, /agent-card.json ──►   over it; a test keeps the three lists the same
 POST <shop>/api/v1/check                    ──►   storefront.ts, shop-card.ts: the open protocol
```

## The shop's public addresses (under `<shop page>`)

| Address | What | Spec |
|---|---|---|
| `/shop` | "What we have": the listings as photo tiles | `modules/listings/README.md` |
| `/listings.json` | The shop's feed, signed with the shop's own key; only while the owner's switch is on | [shop-feed.md](../../specs/shop-feed.md) |
| `/agent-card.json` | The shop's A2A Agent Card, signed; only while the switch is on | [agent-card.md](../../specs/agent-card.md) |
| `POST /api/v1/check` | "Do you still have these?" up to 10 item ids; read only; counted per shop | [shop-check.md](../../specs/shop-check.md) |
| `/api/v1/...`, `/mcp` | The shop's own operations (Bookings: services, free times, start a booking, ...; Orders: the menu, start an order, ...), and `check_items` | `api.ts`, `mcp.ts` |
| `/chat`, `/o/<link>`, `/owner/...` | The chat; the owner's private page | `CHAT.md` |

The operation lists (`OPERATIONS` in `ops.ts`, `ORDER_OPERATIONS` in `order-ops.ts`), the API's routes (`api.ts`), and the MCP tools (`mcp.ts`) are checked against each other by a test. A Fees centre and a Stock
orders shop have no API or MCP of their own; they answer `/api/v1/check` alone.

## Limits

Per-address windows in memory (`limits.ts`): a booking or order start, a cancel, a read, wrong guesses, sign-in links, chat sends. **`check`** is the exception: 600 a minute **per shop** (`shop:<name>`), because a
directory reaches every shop from one address. What must survive a restart (per-number and per-shop caps) is kept by the runtime.

## Security and privacy

* The front never holds a signing key. The runtime signs the feed, the check answer and the card (`modules/runtime/shop-protocol.ts`); the front asks for them with the channel token.
* A check carries item ids only: nothing about the buyer reaches the runtime, and nothing is written to the record.
* Customer phone numbers and names never leave as themselves; every owner action needs the owner's own link or session, checked at the runtime.

## Run and test

No build step. `node --test modules/channels` (the fake runtime in each test; the shop's protocol is `test/shop-protocol.test.ts`).

## Extend

A new operation: add it to the operation list and its function in `ops.ts` (or `order-ops.ts`), its route in `api.ts`, its tool in `mcp.ts`, and its limit kind in `front.ts`; the list test will fail until all three agree.

## What is not built

See `modules/Deferred.md`. This README is short on purpose: the owner's page, passkeys and chat have their own notes (`CHAT.md`, `modules/Explanation.md`).
