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

```
              the inbox's front (modules/channels/front.ts)  ·  ops  ·  the deployer
                                   │  http://door-listings:8780/shop/<name>/...
                                   ▼
   ┌──────────────────────  rt-listings: ONE container, ONE process  ───────────────────────────────────┐
   │   router (modules/runtime/shared.ts)         looks at /shops every few seconds                      │
   │   /shop/glow-pets/…  ──►  shop "glow-pets"   own server 127.0.0.1:p1 · own tokens · own store       │
   │   /shop/sree-cycles/… ──► shop "sree-cycles" own server 127.0.0.1:p2 · own tokens · own store       │
   │   /healthz /readyz /shared/shops             (the process is up; which shops it holds)              │
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

Each shop in the process is exactly what a single shop's runtime is: `server/start.ts` is the same code `main.ts` runs alone. The shared process adds only the finding, the routing and
the letting go.

### Why not one container per shop

A container per shop (with its Guards, forwarders, network and reports folder) is what a shop that **moves money or messages** needs, because the Guards are what stop it. A listings-only
shop has nothing to guard: it takes no payment and sends no message. A container, a door and a network for each would cost more than the shop earns (nothing, by design), and would cap a
server at a few hundred shops. One process holds hundreds, each a few MB. What the shared process costs is that the shops live in one operating-system process, so **the code keeps them
apart by construction** (next section), and the **one thing a shop can reach is the model Guard**.

### Adding, changing and letting go of a shop (no new container, no restart)

* **Add.** The deployer writes the shop's folder under `generated/listings/<shop>/client/` and its secrets under `secrets/rt-listings/<shop>/`, `pathway.lock` last. The process
  looks at `/shops` every `SCAN_SECONDS` (5) and starts a shop whose folder is whole. The compose entry of `rt-listings` does not change when a shop is added (its list of files is empty
  and its mounts are folders, not shops), so nothing is recreated or restarted. Folders are looked at, not watched: file watching on a bind mount is not reliable.
* **Change.** The process fingerprints `settings.json`, `runtime.json` and `pathway.lock` of each shop. When one changes, **that shop alone** is stopped and started again. `pages.json`,
  `owner-grants.json`, `owner-link.json` and the like are read fresh on every request and need no restart.
* **Let go.** Removing a shop, moving it into a runtime of its own, or restoring it from a backup first **takes its folder away** (`pathway.lock` first; `bundle/deploy.ts`
  `letGoOfListings`). The process stops that shop (its step in hand finishes; its store is closed) and answers "nothing here" for it. The deployer then **waits until
  `/shared/shops` no longer names the shop** before it copies or replaces the file, because a database that is open must not be copied (`bundle/lib/listings-move.ts` `letGoShared`).
  `/shared/shops` names a shop until its store is **closed**, not only until it stops being served; and if the process cannot be asked, the deployer waits and then gives up: it never
  takes silence for "let go" (only a container known to be down counts).
* **Removal keeps the file.** Nothing deletes a shop's folder in the shared volume. A new shop with the name of a removed one is **refused** by the deployer (`shared-name-taken`), because it
  would start on the old store and the old owner's passkey (every owner with no number has the same marker, so the passkey matches). A person moves the old folder aside first.
* **A bad folder** (half written, the wrong version, a broken file) is logged once and skipped; the other shops run on. It is tried again when its files change.
* **One version.** Every shop in the process runs this checkout's version of the template. A shop pinned to another version is refused by the deployer in words (`shared-version`),
  before anything is written.

## The data

Everything the shop keeps is in its **store file**, `agent.db`, the same SQLite file every template's runtime keeps (tables `tasks`, `state`, `record`, `window`, `listing_photos`).

```ts
Settings {                       // templates/commerce/listings/src/settings.ts, the only thing the Operator writes
  name: string; place: { town: string; pincode?: string }; trade?: string;       // trade: a label in the Operator's words
  timezone: string; languages: Language[];
  owner: { whatsapp: string; language: Language; noNumber?: true };              // whatsapp is the marker "+00000000000" when the owner gave no number
  assistant: AssistantSettings;                                                  // always present (an empty block is the defaults)
}
Store { assistant?: AssistantState; ai?: AiState }   // src/state.ts. The listings are assistant.listings (modules/listings README); there are no cases
```

The saved state is `{"format":1,"assistant":{...},"ai":{...}}` (`server/snapshot.ts`). Beside `agent.db`, each shop's folder holds its owner's passkeys and sessions
(`owner-access.sqlite`), its alert subscriptions (`push.sqlite`) and its chat identities, as any shop's data folder does.

## What the Operator sets up (and what the owner does)

The panel's first screen offers **"Only show what the shop has (free)"** (and the same under "Something else"). Three steps: the shop (name, town, pincode if known, what it sells in a few
words), the languages and the owner (language, and a phone number only if they have one), and a last page that says what the shop is, saves it, and points at the owner's first sign-in.
No payment, no WhatsApp, no limits, no character step. After that the owner uses their own app: what they have, "Still have it? Yes / Sold", the switch "Show my shop on Streetlist and in
search" (off until they turn it on), the place and the registration, and "Get my shop's file" / "Change my Operator" (unchanged).

## The first sign-in (an owner with no WhatsApp)

**How an owner without WhatsApp signs in today.** The owner's app has two ways in (`modules/channels/owner-signin.ts`, `owner-access.ts`): a one-use **link sent to the owner's number**
on WhatsApp, and a **passkey** (a fingerprint on their own phone). A shop with no WhatsApp has no link to send, so the passkey is its way in. The first passkey is made with a grant the
**Operator** shows once: a **setup QR code** (one use, this shop only, 15 minutes; `modules/channels/owner-grants.ts`) or a **recovery card** (five one-use codes). Nothing new is built
for listings-only shops: this is the existing path, and a listings-only shop uses it from day one.

**The flow.** On the shop's page in the panel, once the server has set the shop up (a minute), the Operator makes the setup QR. The owner scans it with **their own phone**, which opens the
shop's owner page, and touches the fingerprint reader: that makes the passkey, which is kept in the shop's own store (`owner-access.sqlite`). From then on the owner signs in with the
passkey alone. A numberless owner can also be given a recovery card for a lost phone.

**Who could pretend to be the owner, and how this stops it.**

| Who | What they could try | What stops it |
|---|---|---|
| A stranger who finds the shop's page | Ask to sign in as the owner | There is no link to ask for (no number), no password, and the passkey ceremony needs a grant they do not have. The sign-in page only offers a passkey that **this shop's** store lists. |
| Someone who sees the QR over the Operator's shoulder, or photographs it | Scan it first | It works **once** and for **15 minutes**; whoever scans first makes the passkey and uses it up (the owner then sees it did not work and the Operator makes a new one, and can remove the passkeys made before). The Operator hands it over in person, on the visit. |
| Another listings-only shop's owner | Use their own grant, passkey or session on this shop | Each shop checks the grant **against its own file** (`owner-grants.json` holds this shop's hash only), keeps its own passkeys in its own `owner-access.sqlite`, and lists only those credentials; a session is a row in its own store. All the shops share one pages address (so one relying-party id), so the address does **not** separate them: each shop's own credential list does. `test/first-signin.test.ts` crosses every one of these. |
| The Operator | Make a code for the owner's shop and keep the passkey | This is the honest limit: **an Operator who sets the shop up can make themselves a passkey** with a code they made. It is the same trust the Operator has today for any shop without WhatsApp. It is bounded by what the passkey can do (see below) and made visible: every sign-in and passkey is written in the shop's record (`owner_session`), the owner sees the list of passkeys, and the owner (or a new Operator) can remove them. |
| Geometer | Read a code | The panel keeps only **hashes** of codes (a hash of a 256-bit random value cannot be turned back), and the shop's own server checks them; nothing passes through Geometer or Firebase. |

What a passkey cannot do on a listings-only shop is limited by the shop itself: there is no money, no customer's number, no WhatsApp. The worst an impostor owner could do is **publish or
remove listings** (which the owner sees, and every change is in the shop's record) and **download the shop's file**. That is why the first sign-in can rest on the Operator's visit, and why a
phone check for an owner who **signs up alone** is not built yet (Deferred).

## The isolation rules, and how the code keeps them

1. **Own tokens.** Each shop is started with its own `internal_token`, `channel_token` and `record_key` as **files**; the process's environment names none, so a shop with a missing file
   fails to start instead of running on another's. (`modules/runtime/start.ts` falls back to `INTERNAL_TOKEN_FILE` and friends when a file is not given: the shared process always gives them.)
2. **Own server.** Each shop listens on `127.0.0.1:<its own port>`; the router forwards the request, credential and all, and **the shop checks its own token**. A request sent to the wrong shop
   is refused by that shop. The router holds no shop's data and checks no token itself.
3. **Own store.** Each shop's `dataDir` is its own folder: `agent.db`, `owner-access.sqlite`, `push.sqlite`, `chat-identity.sqlite`. Photos are a table of the shop's own `agent.db`.
4. **No shared state in the code.** Checked on 18 Nov 2026: the runtime, channels, assistant, push and listings modules keep nothing about a shop at module level (the only module-level
   caches are fonts and time formatters, the same for every shop). New code must keep it so: **never key a module-level map by anything a shop owns.**
5. **One way out.** The container is on one network with the model Guard and its door, and nothing else. Each shop reaches the model Guard with **its own credential** (its own agent id),
   so the model Guard **knows** each shop (its record names the agent, and the shop's agent can be switched off by itself: `ops stop <shop>`). **What limits each shop's model use is the
   shop's own runtime allowance** (`runtime.json` `allowance`, from `LISTINGS_ALLOWANCE`: the month's messages and rupees the shop's own calls may add up to), counted in that shop's own
   store. The model Guard's own cap (`model-calls-per-day`) is **one number for the whole server**, shared by every shop on it: a flood from one shop's owner is stopped by that shop's
   allowance first, but a server-wide spike can still use up the day's calls for everyone (Deferred: a cap per agent at the Guard).
6. **A shop that fails to start does not stop the others** (a bad folder is skipped; the process stays healthy). An error inside a request is caught by that shop's own server. What the
   process cannot promise is protection from a crash that escapes every `try` (an unhandled rejection): that would take the whole process down, and every shop with it, until the container
   restarts (seconds; each shop's saved steps resume). One process per shop is the price of ruling that out; it is Deferred, with its trigger.

`templates/commerce/listings/test/shared-shops.test.ts` runs two real shops on one process and presents every credential of one to the other (channel token, internal token, owner link, grant,
session, photo id); `modules/runtime/test/shared.test.ts` tests the finding, restarting and letting go with stand-ins.

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

* **One shop on its own:** `INTERNAL_TOKEN_FILE=token.txt node templates/commerce/listings/server/main.ts --client <folder>` (folder: `settings.json`, `runtime.json`, `pathway.lock`).
* **The shared process:** `SHOPS_DIR=/shops SECRETS_DIR=/run/secrets node templates/commerce/listings/server/shared-main.ts`, as `rt-listings` runs it (`bundle/generate/compose.ts`).
* **On a server:** `geometer shop add <name> --template listings` writes a folder with the example settings; or the panel's "Only show what the shop has (free)".
* **Tests:** `node --test templates/commerce/listings/test/ modules/runtime/test/shared.test.ts bundle/test/listings-shop.test.ts` (written 18 Nov 2026, **not yet run**; not tested on
  a real model, a real browser or real Docker).
* **Extend:** a listings-only shop should stay small. A new field of the shop goes in `src/settings.ts` (and `bundle/panel/listings.ts`); a new thing the owner does with listings goes in
  `modules/listings` (it then works for every template). To give such shops something that needs a Guard (push, WhatsApp), they would stop being shared: use another template.

## What is not built, and why

See `bundle/Deferred.md` (rows "Listings-only shops"): an owner signing up alone (a phone check and a "not visited yet" mark), push alerts for these shops, customer chat ("Ask about this"
falls back to the shop's phone), the real budgets of the caps work (a named constant stands in), a panel button to upgrade a shop, the shop's start being waited for after a deploy, and a run
on real Docker and a real model.
