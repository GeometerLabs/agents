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

A shop's card exists only while the owner has turned on "Show my shop on Streetlist and in search" (otherwise the address is `404`). The shop's storefront and its feed link to it, and the
feed names it (`shop.agentCard`). It is served `GET`/`HEAD` with `Cache-Control: public, max-age=300`, an `ETag` and `Access-Control-Allow-Origin: *`. The front builds the card (it knows the
shop's operations) and the shop's runtime signs it, only after checking that every interface address and the provider address are under the shop's own page.

## What a shop's card says

The card follows the field names of the A2A specification, **version 1.0.1** (the `a2aproject/A2A` repository, tag `v1.0.1`, commit
`3303592588e388e62e0f69f701af531d2f4e3991`, read 18 Nov 2026 from `specification/a2a.proto` and `docs/specification.md`). In JSON the
members are: `name`, `description`, `supportedInterfaces` (each `url`, `protocolBinding`, `protocolVersion`), `provider` (`organization`,
`url`), `version`, `documentationUrl`, `capabilities`, `defaultInputModes`, `defaultOutputModes`, `skills` (each `id`, `name`,
`description`, `tags`, `examples`, `inputModes`, `outputModes`) and `signatures`. The code that builds a shop's card
(`modules/listings/`) and a directory's card (`go/internal/directory/words/cards.json`) follows them exactly; this table says what we put in, not the schema.

| Content | Value |
|---|---|
| Name and description | The shop's public name and its trade in plain words ("a local shop" when the trade is not known to the runtime, which is today's case). English only for now; the skills' words are the operations' own. |
| Provider | The shop (its name and page, `provider.url` = `<shop page>/`). Geometer is not the provider; it only runs the software. `documentationUrl` is the shop's storefront, `<shop page>/shop`. |
| Skills | `show_listings` (what the shop has: the [shop feed](shop-feed.md)); `check_items` ([shop-check](shop-check.md)); and the shop's own operations from its API, by their own names (`list_services`, `free_slots`, `start_booking`, ... for Bookings; `list_items`, `start_order`, ... for Orders; the same list as `modules/channels/api.ts` and the MCP tools). A Fees centre and a Stock orders shop have no operations of their own, so their cards list the two listing skills only. Each skill names its input and output formats and gives one example. |
| Interfaces | The shop's MCP endpoint (`<shop page>/mcp`), only for a kind of shop that has one (Bookings, Orders), and its JSON API (`<shop page>/api/v1`), which every kind has (for a Fees centre and a Stock orders shop it is the check route alone). The card lists only what answers. |
| Input and output | `application/json` only. No free-text skill: a shop's program takes typed requests and answers from its record. |
| Signature | The card is signed with the shop's own key (the same key as its feed), as A2A allows for signed cards: see "How a card is signed" below. |

### The interfaces: what `protocolBinding` says

In A2A the `protocolBinding` of an interface is an **open string** ("to be easily extended for other protocol bindings"; the ones the
specification names are `JSONRPC`, `GRPC` and `HTTP+JSON`, and those mean an A2A message endpoint). We do not serve one yet, so we do **not**
use those names. We list the interfaces we do serve under their own names, and put that protocol's own version in `protocolVersion`:

| `protocolBinding` | At | `protocolVersion` |
|---|---|---|
| `MCP` | the MCP endpoint (a shop's `<shop page>/mcp`; a directory's `/mcp`) | the newest MCP version it speaks (`2025-11-25`) |
| `HTTPS-JSON` | the JSON API (a shop's `<shop page>/api/v1`; a directory's `/search`) | `1` |

A client that only speaks A2A finds no binding it knows and can tell its user so; one that speaks MCP takes the first.

### How a card is signed

As the A2A specification's section 8.4 says: a JSON Web Signature (RFC 7515) over the RFC 8785 canonical JSON of the card without its
`signatures` member, with members that hold only a default value left out (an empty list is left out). The signature is
`{ "protected": base64url({"alg":"EdDSA","typ":"JOSE","kid":<key id>}), "signature": base64url(sig) }`, where the signing input is
`protected + "." + base64url(canonical card)`. `EdDSA` with Ed25519 is the JOSE name from RFC 8037. `kid` is the same key id the feed uses
([shop-feed.md](shop-feed.md#the-signature)), so a reader who pinned the key for the feed checks the card with it. The code is
`modules/signing/jws.ts`.

**Not served yet (said plainly):** the A2A message endpoint itself (sending A2A tasks to a shop). Until it is built, a client talks to a
shop through its MCP endpoint or its JSON API, which the card names. This is in `modules/Deferred.md`.

## What a directory's card says

| Content | Value |
|---|---|
| Name and description | "Directory of local shops" and the towns it covers. |
| Skills | `search_listings` (words, category, place, distance; results in the fair order), `get_listing`, `shop_page`, and `ask` (the buyer's own words in; a typed search, the results and a short line out) only where the directory's buyer assistant is on. See [directory.md](directory.md). |
| Interfaces | The directory's MCP endpoint (`/mcp`, binding `MCP`) and its JSON search API (`/search`, binding `HTTPS-JSON`). |
| Provider | Whoever runs the directory (its organisation name and address). |
| Signature | Signed with the directory's own key, kept in the directory's data folder (a directory that loses the file makes a new key; the card then has a new `kid`). |

## Why A2A, and why not more of it yet

- An Agent Card is the format other AI systems already look for, so any assistant can find what a shop can do without knowing us.
- The card is small and static, and costs nothing to serve.
- The A2A message protocol is heavier, and an MCP endpoint and a JSON API already carry every operation a shop has. We serve the card
  now and add the A2A endpoint when an outside assistant needs it.
