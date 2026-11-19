# Open specifications: showing what local shops have, and finding it

These documents describe how a shop shows what it has, and how anyone finds it. They are open on purpose. A shop's data is the shop's
own; any program may read a shop's public feed, run its own directory, or build its own search. Geometer's code in this repository is
one implementation of these documents, not the only one allowed.

| Document | What it describes | Status |
|---|---|---|
| [shop-feed.md](shop-feed.md) | `shop-feed/1`: the signed file in which a shop publishes what it has, and the short notice it sends when that file changes | Draft, 18 Nov 2026 |
| [shop-check.md](shop-check.md) | `shop-check/1`: the question a directory asks a shop just before it shows a result: "do you still have these, at what price?" | Draft, 18 Nov 2026 |
| [agent-card.md](agent-card.md) | How a shop's assistant, and a directory, describe themselves to other programs with an A2A Agent Card | Draft, 18 Nov 2026 |
| [directory.md](directory.md) | `directory/1`: how a directory reads feeds, keeps its index, ranks results fairly and answers searches over HTTP and MCP | Draft, 18 Nov 2026 |

## The idea in one picture

```
 owner's phone                    the shop's runtime                     any directory (ours is one)              a buyer
 ─────────────                    ──────────────────                     ───────────────────────────              ───────
 "two Persian kittens,            listing kept in the shop's own store   reads every listed shop's feed           "Persian kitten
  ₹8,000 each" + photo  ──tap──►  ──► shop-feed/1 at <shop>/listings.json ─────────► index (a cache)            near Thrissur?"
                                  ──► "my feed changed" notice ──────────►  (rebuildable from the feeds)              │
                                                                                     │                                 ▼
                                  shop-check/1  ◄──── "still have l-3?" ──── top matches only ◄──── search ◄──── the buyer's assistant
                                  (answered from the record, signed)                 │                         (turns words into a search,
                                                                                     ▼                          and results into words)
                                                                          results in the fair order ──────────► tap: the shop's page and chat
```

## The rules every part keeps

1. **The shop's record is the source.** A listing exists because the shop's owner published it (a tap in the owner's app). The feed,
   every directory's index and every answer are copies of that record, and each can be rebuilt from it.
2. **Find in an index, then ask the shop to confirm.** A directory never asks every shop on every search (slow, costly, and every shop
   would see every buyer's question). It searches its own index, then asks only the few shops it is about to show, with item ids and
   nothing about the buyer.
3. **Machine to machine in the middle, people's words only at the ends.** Between programs only typed, signed records travel: no free
   text that a program would have to interpret, so no instruction can hide in a message. A language model, where one is used, works only
   at the buyer's end (turning a question into a search, and results into words) and at the owner's end (drafting a listing the owner
   then confirms). A shop answers a check from its record, with no model.
4. **Signed by the shop.** A shop signs its feed and its check answers with its own key (Ed25519). The key belongs to the shop and moves
   with it when it changes its Operator, so a directory that knew the shop still knows it. No directory can change a shop's price or
   say a shop has something it does not.
5. **A fair order.** Results are ordered by fit first, then distance, and shops at the same distance take turns. Never by payment, plan
   or Operator. The rule is in [directory.md](directory.md#the-order) and its code is open.
6. **Nothing private leaves the shop.** A feed carries only what the shop shows on its public page: no customer, no customer's number,
   no order, no conversation.
7. **Open standards where they exist.** schema.org on the shop's page, A2A Agent Cards for describing agents, MCP for tools, and a
   mapping to Beckn/ONDC (`modules/ondc`). Where no standard fits, these documents are short, versioned and stable.

## Versions

Each format names itself (`"format": "shop-feed/1"`). A new field that a reader may ignore does not change the version. A change that
an old reader would misread does: it gets `/2`, and the writer keeps serving `/1` for at least six months.

## Where the code is

| Part | Code | Its own README |
|---|---|---|
| A shop's listings, its feed, its key and its check answers | `modules/listings/` | `modules/listings/README.md` |
| Stock counts shared by listings, Orders and Stock orders | `modules/stock/` | `modules/stock/README.md` |
| Signing: canonical JSON, Ed25519 keys, signed feeds, check answers, notices and Agent Cards | `modules/signing/` | `modules/signing/README.md` |
| A directory: reading feeds, the index, the order, search, MCP | `go/internal/directory/` (Go, since 19 Nov 2026) | `go/internal/directory/Explanation.md` |
| The mapping to Beckn/ONDC | `modules/ondc/` | `modules/Explanation.md`, "Mapping to Beckn and ONDC" |
