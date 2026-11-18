# Agent Cards: how a shop's assistant and a directory describe themselves

**Status:** draft, 18 November 2026.

An AI assistant that wants to find a shop, or ask it something, needs to know what the shop's program can do and where to reach it.
We use the **A2A Agent Card**: the JSON description defined by the Agent2Agent (A2A) protocol, an open standard governed under the
Linux Foundation. We do not invent our own.

## Where the cards are

| Who | Card address | Why there |
|---|---|---|
| A shop | `<shop page>/agent-card.json` (for example `https://streetlist.in/rani-pets/agent-card.json`) | Many shops share one domain, each under its own path, so a shop's card cannot be the domain's `/.well-known/agent-card.json`. A2A also lets a client get a card from a directory or a known URL; the shop's page and feed link to it. |
| A directory | `/.well-known/agent-card.json` at the directory's own domain | A directory owns its domain. |

A shop's card exists only while the owner has turned on "Show my shop on Streetlist and in search".

## What a shop's card says

The card follows the field names of the A2A specification (version 1.0). The code that builds it (`modules/listings/`) reads the
specification and follows it exactly; this table says what we put in, not the schema.

| Content | Value |
|---|---|
| Name and description | The shop's public name and its trade, in the owner's language and English. |
| Provider | The shop (its name and page). Geometer is not the provider; it only runs the software. |
| Skills | `show_listings` (what the shop has: the [shop feed](shop-feed.md)); `check_items` ([shop-check](shop-check.md)); and the shop's own work from its API, such as `book`, `order` or `fees` (the same operations as `modules/channels/api.ts`). Each skill names its input and output formats and gives one example. |
| Interfaces | The shop's MCP endpoint (`<shop page>/mcp`) and its JSON API (`<shop page>/api/v1`). |
| Input and output | `application/json` only. No free-text skill: a shop's program takes typed requests and answers from its record. |
| Signature | The card is signed with the shop's own key (the same key as its feed), as A2A version 1.0 allows for signed cards. |

**Not served yet (said plainly):** the A2A message endpoint itself (sending A2A tasks to a shop). Until it is built, a client talks to a
shop through its MCP endpoint or its JSON API, which the card names. This is in `modules/Deferred.md`.

## What a directory's card says

| Content | Value |
|---|---|
| Name and description | "Directory of local shops" and the towns it covers. |
| Skills | `search_listings` (words, category, place, distance; results in the fair order), `get_listing`, `shop_page`. See [directory.md](directory.md). |
| Interfaces | The directory's MCP endpoint (`/mcp`) and its JSON search API (`/search`). |
| Signature | Signed with the directory's own key. |

## Why A2A, and why not more of it yet

- An Agent Card is the format other AI systems already look for, so any assistant can find what a shop can do without knowing us.
- The card is small and static, and costs nothing to serve.
- The A2A message protocol is heavier, and an MCP endpoint and a JSON API already carry every operation a shop has. We serve the card
  now and add the A2A endpoint when an outside assistant needs it.
