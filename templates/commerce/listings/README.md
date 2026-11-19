# Listings only: a shop that only shows what it has

## What it is for, and why

Most small shops in a town do not need a booking system, an order desk or a fee register. They need people to **find what they have today**: two Persian kittens, a second-hand
cycle, a day's fresh fish. This template is that and nothing more. The shop has a page, "What we have", and an open feed of its listings ([shop-feed/1](../../../specs/shop-feed.md)).
The owner does the work in their own app: they say what they have (and take a photo), the **assistant** writes the listing in four languages, and the owner taps to show it. The
assistant later asks "Still have it?" and the owner answers Yes or Sold. The listings machinery is shared with every template ([modules/listings](../../../modules/listings/README.md)); this
template is the smallest agent that can host it.

Because the shop **takes no money and sends no WhatsApp message**, it has no Guard, and so it needs no container of its own. Many such shops run in **one shared process** on a
server, each with a store file of its own. It is **free**: Geometer pays for its model use, up to a small monthly limit. An **Operator** sets it up once (a visit); the owner does
everything else with the assistant.

## Architecture

**The runtime is Go** (decision 61, waves 1a to 1b, finished 19 Nov 2026): one shop alone is `go/cmd/listings`, and every listings-only shop of a server is held by ONE process,
`go/cmd/listings-shared` (`go/internal/shared`), the `rt-listings` container, run from the programs' image the server builds from its own checkout (`bundle/lib/go-build.ts`). The
TypeScript runtime that was here (`server/main.ts`, `shared-main.ts`, `start.ts`, `runtime.ts`, `store.ts`, `back-soon.ts`, `src/agent.ts`, `assistant.ts`, `channel.ts`) and the
TypeScript shared process with its worker pool (`modules/runtime/shared*.ts`) are deleted; the Go runtime passes the contract in `contract/`, held to golden answers recorded from the
TypeScript before it went. What stays TypeScript here is what the deployer, the panel and the generators read: `src/settings.ts` (the settings' shape), `src/chat-limits.ts`,
`src/state.ts` and `server/snapshot.ts` (the saved store's shape, which `bundle/lib/listings-carry.ts` converts when a shop takes an agent), `server/config.ts` (the deployer's check of
`runtime.json`) and `package.json` (the version).

```
              the inbox's front (modules/channels/front.ts)  ·  ops  ·  the deployer
                                   │  http://door-listings:8780/shop/<name>/...
                                   ▼
   ┌──────────────────────  rt-listings: ONE Go process (go/cmd/listings-shared)  ──────────────────────┐
   │   finds the shops in /shops every few seconds, routes /shop/<name>/… to that shop                  │
   │   a shop that panics or sticks is charged a strike; two put it in a child process of its own;      │
   │   three failures there pause it ("back soon")                                                       │
   │   /healthz /readyz /shared/shops             (the process is up; which shops it holds or paused)   │
   └─────────────────────────────────────────────────────────────────────────────────────────────────────┘
        │ read-only mounts                                             │ one volume, a folder per shop
        │  /shops/<shop>/client/   settings.json, runtime.json,        │  /home/node/<shop>/data/agent.db      (the store)
        │                          pathway.lock (written LAST),        │                     owner-access.sqlite (passkeys, sessions)
        │                          pages.json, owner-grants.json …     │                     push.sqlite, chat-identity.sqlite …
        │  /run/secrets/<shop>/    internal_token, channel_token,      │
        │                          record_key, agent_model             ▼  the same layout as any shop's volume, one level down
        ▼                                                            backup, "Get my shop's file", "Change my Operator"
   only way out: the model Guard (g-model), on a network only it, the door and this container share
```

### Why not one container per shop

A container per shop (with its Guards, forwarders, network and reports folder) is what a shop that **moves money or messages** needs, because the Guards are what stop it. A listings-only
shop has nothing to guard: it takes no payment and sends no message. A container, a door and a network for each would cost more than the shop earns (nothing, by design), and would cap a
server at a few hundred shops. One Go process holds a hundred shops in about 104 MB (go/TRIAL.md). What it costs is that the shops live in one process, so **the code keeps them apart by
construction**, and the **one thing a shop can reach is the model Guard**.

### What keeps one shop from another

1. **Own credentials.** Each shop has its own token files (internal, channel, record key, the model Guard's agent credential), handed to that shop alone; a shop missing one is skipped.
2. **Own routes.** The process routes by the shop's name, and **the shop checks its own token**: a request sent to the wrong shop is refused by that shop.
3. **Own store.** Each shop's data folder is its own: `agent.db`, `owner-access.sqlite`, `push.sqlite`, `chat-identity.sqlite`; photos are a table of the shop's own `agent.db`.
4. **One way out.** The container is on one network with the model Guard and its door, and nothing else; each shop reaches the Guard with its own credential, and what limits each shop's
   model use is its own runtime budget (`runtime.json` `budget`). The Guard's own daily cap is one number for the server (Deferred: a cap per agent at the Guard).
5. **One shop's failure is that shop's alone** (`go/internal/shared`, read its header): a panic in a request, the runner or the clock is recovered and charged to its shop; a stuck request
   gets a deadline; two strikes move the shop to a child process of the same binary; three failures there pause it ("back soon", with `x-back-soon: 1`). What Go cannot recover (a stack
   overflow, running out of memory, a concurrent map write) restarts the process, and nobody is charged.

`contract/shared.contract.test.ts` runs the Go process on the deployer's folder layout (routing, another shop's token refused, a missing token file, a shop found and let go, a quarantine
child); `go/internal/shared/host_test.go` tests the strikes, the quarantine and the pause with fake shops.

## Taking an agent, and leaving

A listings-only shop that takes an agent (Bookings, Orders, Fees, Stock orders) **keeps its file**. The deployer (`bundle/lib/listings-move.ts`, called by `bundle/deploy.ts` when the pin
changes from a shared template to another): lets the shop go and waits; **copies** the folder into the shop's own volume `rt-data-<shop>` (the shared volume is only read); **converts the
copy** (`bundle/lib/listings-carry.ts`: the new template's own store holding the listings and the AI counts, written by its own codec, as one step with no new record line); only then sets
the old folder aside as `.moved-<shop>-<time>`; and gives the shop an address of its own. If anything fails before that last step the shared file is exactly as it was, the shop's folder is
written back, and the shop is on the shared process again. The SQLite file is the same in every template (same tables, same schema number), so the **record's chain and the photos come
along**. The owner's passkeys come along too, **but a passkey belongs to the owner's number**: an owner who had none and is now given one in the new settings (a template that sends
WhatsApp needs a real number) is given a new sign-in code by the Operator. "Get my shop's file" and "Change my Operator" work as for any shop (`bundle/backup`, `modules/approvals/leave.ts`): nothing in them knows the template.

The Operator changes the shop's pin and gives it the new template's settings (today by hand; a panel button is not built yet, see Deferred).

## Run it, test it, extend it

* **One shop on its own:** `INTERNAL_TOKEN_FILE=token.txt go/bin/listings --client <folder>` (folder: `settings.json`, `runtime.json`, `pathway.lock`; build it with `cd go && go build -o bin/listings ./cmd/listings`).
* **The shared process:** `SHOPS_DIR=/shops SECRETS_DIR=/run/secrets go/bin/listings-shared`, as `rt-listings` runs it (`bundle/generate/compose.ts`).
* **On a server:** `geometer shop add <name> --template listings` writes a folder with the example settings; or the panel's "Only show what the shop has (free)".
* **Tests:** the contract, `node --test --test-concurrency=1 templates/commerce/listings/contract/` (the Go binaries built first; `contract/README.md`), and
  `node --test templates/commerce/listings/test/ bundle/test/listings-shop.test.ts` (the settings and the deployer's side).
* **Extend:** a listings-only shop should stay small. A new field of the shop goes in `src/settings.ts` (and `bundle/panel/listings.ts`); a new thing the owner does with listings goes in
  `modules/listings` (it then works for every template). To give such shops something that needs a Guard (push, WhatsApp), they would stop being shared: use another template.

## What is not built, and why

See `bundle/Deferred.md` (rows "Listings-only shops"): an owner signing up alone (a phone check and a "not visited yet" mark), push alerts for these shops, customer chat ("Ask about this"
falls back to the shop's phone), the real budgets of the caps work (a named constant stands in), a panel button to upgrade a shop, the shop's start being waited for after a deploy, and a run
on real Docker and a real model.
