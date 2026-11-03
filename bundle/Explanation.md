# Explanation: the deploy bundle

November 2026. Plan items B9, parts of B9a, B14 (the fail-closed minimum), B19, B20 and B26, and the data redundancy of plan section 6. How to use it is in [README.md](README.md); what is missing is in [Deferred.md](Deferred.md). **Nothing here has met a real provider or a real customer.** The Guards ran against stand-ins; the claims below say which test shows each one.

## What is where

| File | What it is |
|---|---|
| `geometer.ts` | the command line: `init`, `model-key`, `backup-key`, `shop add`, `check`, `deploy`, `status`, `stop`, `start`, `restore`, `rollback`, `logs`, `apply [--watch]`, `backup now`, `backup drill` |
| `deploy.ts` | the checked deploy: plan, compile, verify, write, `docker compose up`, then ask the running Guards |
| `apply.ts` | the host-side deployer loop and the scheduled jobs (relay credential, nightly snapshot, weekly drill) |
| `generate/guards.ts` | every Guard defined once: its tool name, upstream and header; the WhatsApp, Calendar and model specs; the guard.toml |
| `generate/shop.ts` | one shop planned from its settings and `runtime.json`; every rule about the shop's own numbers |
| `generate/rules.ts` | tool names agree, no secret in a generated file, tripwires hold, the "N of M" line |
| `generate/verify.ts` | `geo-guard compile` then `verify-bundle --config` in the Guard image with no network |
| `generate/compose.ts`, `configs.ts`, `litestream.ts` | `compose.yaml`, the Caddyfile, the four small config files, Litestream's config |
| `services/inbox.ts`, `relay.ts` | the server's one inbox and one approvals relay: the pathway's own, one instance per shop behind `/c/<shop>` |
| `services/refresher.ts` | the Google token refresher |
| `services/ops.ts`, `heartbeat.ts` | the heartbeat sender, and the admin client the deployer reaches through `docker compose exec` |
| `backup/` | age, the S3 and folder stores, the nightly snapshot, the drill's check, and the host side that runs them |
| `lib/` | names and files, the server folder, secrets, state, status, the Docker seam, the router |
| `test/` | 94 tests with no Docker (`npm test`), and `test/proof/run.ts`, the real-Docker proof |

## One source for every spec

`generate/guards.ts` defines each Guard once (its `tool` name, its upstream, the header it adds) and generates both files of the pair from that definition, so the tool name is written in one place. A Guard checks the same thing at start (`cannot start: the policy bundle names tool "razorpay" ... but guard.toml says tool = "whatsapp"`); the generator also compares the spec, the guard.toml and the compiled bundle's tool and tenant before anything is started (`tool-names-match`).

The Razorpay spec still comes from `pathways/bookings/src/guard-limits.ts`: the deposit bound and the refund threshold are the shop's own settings, not typed. The WhatsApp spec pins the shop's `phone_number_id` with `"match": "exact"` (not a number that merely ends the same way) and the Calendar spec pins the shop's `calendarId` the same way on every event operation. The monorepo's `deploy/pathways/bookings/*` are now **fixtures**: `test/drift.test.ts` reads them from a sibling path (and skips, saying why, when they are absent) and compares routes, rule ids and kinds, limits, intents and the guard.toml keys and headers. It found one real difference on its first run: the Anthropic template says `anthropic-version = "2023-06-01"` and the pathway's parser sends `2026-10-21` (structured output needs the newer one). The generator writes the parser's value (exported from `model-llm.ts`, one source), and the test does not compare that value. **Not checked against the real API:** which of the two a Guard keeps when the agent also sends one.

**The approval window is one setting**, `approvalHours` in `geometer.json` (default 24). It becomes Guard's `approval_ttl_seconds`. The owner's message used to say "within 24 hours" from a constant; the relay already computed the hours from Guard's `expires_at_ms` less the hold's time, and the remaining `24` (a default in the relay's store) is gone, so the words can only come from Guard. A test with a six-hour hold shows "within 6 hours".

## Why a Guard per shop

A Guard binds one tool and one bundle (`tool` in guard.toml, one policy in force), and its per-agent configuration cannot restrict argument values: an `[[agents]]` entry has an id, a token hash, a tenant and an optional list of **operations** (`config.rs` lines 11-27; `engine.rs` 783 checks `agent.tenant == cfg.tenant` and 802 checks the operation against `agent.operations`; nothing reads an argument). A WhatsApp or Calendar Guard shared by two shops would have one bundle for both, so the exact-allowlist that pins the shop's number could only list both numbers, and shop A's runtime could send from shop B's. Hence three Guards per shop, each pinned to that shop's own ids. The model Guard is shared because the thing it pins (the model) is the same for everyone; every shop's runtime is an agent of it, in the server's tenant.

## The shape of the server

`generate/compose.ts` documents the layout at its top. The points that took a decision:

- **The runtime's network holds the runtime, its three Guards, the model Guard and its door, and nothing else.** Docker has no one-way network: a container on the runtime's network is a container the runtime can connect to. The inbox, the relay and ops must reach the runtime, so they are **not** on its network. A `door-<shop>` (a busybox `nc`) is on the runtime's network and on the `admin` network, listens only on its `admin` address and passes bytes to the runtime; the runtime is not on `admin`, so it cannot connect to the door. The relay reaches the shop's WhatsApp Guard on that Guard's `admin` address. The proof tries each of these from inside the runtime.
- **Guard's admin port.** Guard's production profile refuses `admin_listen` on any address but loopback unless `listen_tls` is set (`config.rs` 608), and `listen_tls` also puts the agent port behind TLS. The runtime would then need a certificate authority. The bundle keeps the admin port on loopback and puts a 1 MB busybox forwarder (`fwd-<shop>-<tool>`) in the Guard's network namespace, listening only on the Guard's address on the `admin` network. The forwarder **owns** the namespace and the Guard joins it, as the TLS front does in `deploy/compose`: a Guard that crashes and restarts leaves the namespace and the forwarder as they were (the other way round, a restarted Guard strands its sidecar). This sidesteps the TLS rule rather than meeting it, on purpose: the forwarder's network has no route to anything that is not a service of the bundle, and every admin call needs the admin token. It costs three small containers per shop; Deferred.md has the way out.
- **Reaching the admin ports from the host.** On Docker Desktop the host cannot reach container addresses, and on Linux not those of an internal network. So the deployer never connects to a Guard: it runs `docker compose exec ops node ops.ts admin <guard> ...` and `ops` (the one container that holds every Guard's admin token and is on the `admin` network) makes the call. No admin port is published.
- **Secrets.** One folder per container under `secrets/`, mounted into that container only. The Razorpay key is in `secrets/g-<shop>-razorpay/` and nowhere else; the webhook secrets in `secrets/inbox/`; the owner's approver secret in `secrets/g-<shop>-razorpay/` and `secrets/relay/<shop>/`; the Google key in `secrets/refresher/`. The runtime's folder has its own internal token and its credentials for its Guards. File modes are in the README. The panel has no secrets folder and no Docker socket.
- **Users.** Our Node programs run as the image's `node` user (uid 1000), the Guard as its own uid 65532, both read-only, no capabilities, `no-new-privileges`. A named volume mounted at `/home/node` is created with the image's ownership, so a non-root runtime can write its database without a root `chown` step. The Google token volume has one sub-folder per shop, and a Calendar Guard mounts only its own (Compose `volume.subpath`, Docker Engine 26 or newer).
- **The Guard image.** Not in a registry. The deploy checks it is on the machine and says how to load it.

## Deploy, in the order it happens

`check` and `deploy` share one path (`prepareShop`, `compileAndVerify`). `check` stops before writing; `deploy` goes on.

1. The secrets handed in are taken (each checked for shape; a bad one stays in the inbox and is named). The shop's files are read; every problem with them is collected, not just the first.
2. **Generator rules** (each names itself in a refusal): `runtime-timeout-exceeds-guard` (the runtime's `services.timeoutMs` must exceed Guard's `upstream_timeout_ms`, 15 s; the pathway's own default is 10 s, so the bundle writes 20 s when runtime.json says nothing and refuses 15 s or less), `runtime-mode-live` (a deployed shop never runs the in-process stand-ins), `calendar-id`, `whatsapp-number-id`, `model-matches-guard` (the shop's parser must ask for the server's one model on its wire), `pathway-pin`, `secret-missing:<name>`, `guard-image`, `tool-names-match`, `no-secret-in-files`.
3. **Versions.** Guard ignores a bundle whose `version` is not higher than the one in its store, and compose does not recreate a container when a bind-mounted file changes. So each Guard has a counter in `state/state.json`: the same spec content keeps its number, changed content gets the next, and a rollback of settings gets a *new* higher number, never the old one.
4. Every spec is compiled and every guard.toml verified with `verify-bundle --config` in the image (`--network none`, read-only). **Every tripwire must pass**; a failure names the rule. The model Guard is verified again whenever a shop is added, because its agent list changes.
5. Files are written, `docker compose up -d` brings up what is missing or whose entry changed, and **only** the services whose mounted *files* changed under an unchanged entry are restarted. Nothing else is touched.
6. **The proof is read from the running Guards**, not from the offline check: each Guard's `/admin/status` must report the policy digest that was compiled and `tripwires.ok`. "N of M limits proven to bite" is their `passed` of `of`; what a tripwire cannot test without writing (every spend or count limit, the at-most-once rule) is named and never counted. If a running Guard disagrees, the shop is stopped with the kill switch and the deploy is refused. A Guard also repeats its tripwires every five minutes, and a failure turns `/readyz` to 503.
7. The relay's reading credential (an approver credential, which production requires to expire) is issued through ops and written where only the relay reads it; the deployer renews it daily.
8. `status/<shop>.json` is written for the panel.

`stop` sends `POST /admin/kill` to the shop's three Guards and `POST /admin/agents/runtime-<shop>/stop` to the model Guard (so the other shops keep working). The reason carries who stopped it and when; Guard writes it, with its own admin id, into its evidence ledger, and the deployer keeps it in `state/` and `status/`. Guard keeps the kill switch in its store, so it survives a restart (the proof restarts the Guard); the deployer also re-applies it after a deploy.

## The inbox, the relay, the refresher, the heartbeat

- **Inbox.** `/c/<shop>/webhooks/...`; each shop has its own `inboxHandler` (extracted from `startInbox`; the checks are the pathway's) with that shop's secrets and its own runtime. A test proves that A's signature does not open B's door, that an unprefixed path is not served, and that with **two shops on one Meta app** (one app secret, so a valid signature does not say whose message it is) a body for B's number posted to A's door is verified and then dropped: `metadata.phone_number_id` must be the shop's. Routing one shared callback URL to the right shop is Deferred.
- **Relay.** The pathway's relay, one instance per shop, each with its own state folder, its own approver secret and its own reading credential, re-read from its file on every call so a renewed credential needs no restart. The WhatsApp Guard has a second agent entry for the relay, limited to the `send` operation.
- **Refresher.** Per shop: a signed assertion (RS256) to the service account's token endpoint, `Bearer <token>` written for that shop's Calendar Guard only, then `POST /admin/reload` on that Guard. About every 45 minutes and always before the token runs out. The token is never logged and is not in any URL; the exchange is tried once, and a failure waits 1, 2, 4 ... 10 minutes instead of repeating; the key file is only read. There is no refresh credential in this flow to rotate; the discipline items that apply are kept and the others do not arise. The Calendar Guards wait for the refresher's first token.
- **Heartbeat.** Every 60 seconds from `ops`: the exact body of the fleet contract, built field by field from numbers and booleans (never copied from a reply), with `ready=false` for a Guard that is not ready, whose admin port cannot be reached, or whose tripwires failed. `since_last` is the difference since the last heartbeat fleet **accepted**, and a runtime that restarted (its `startedAt` changed) starts again from zero. The runtime's `/status` gained `steps`, `errors` and `startedAt` for this (a small change in `server/`; steps counts finished tasks, not ticks). The body is run through fleet's own `checkHeartbeat` in a test. Shop names are checked when the shop is added against the rules that make fleet refuse a whole heartbeat. A failed backup or drill is not reported through the heartbeat (the contract has no field; Deferred.md).

## Data redundancy

Read the table in the README. The decisions:

- **Litestream streams only the runtime databases.** It must own checkpointing; `server/store.ts` never checkpoints by hand (a test reads the source: no `wal_checkpoint`, only `journal_mode = WAL`, and it sets `busy_timeout = 5000`, as Litestream's Docker guide asks). The data lives on a named volume, not a bind mount (Litestream warns that WAL on a Docker Desktop bind mount can corrupt). Litestream is pinned to `0.5.17-scratch` (Apache-2.0, the official image).
- **Guard's store is not streamed.** It is backed up with Guard's own `POST /admin/backup` (a `VACUUM INTO` copy of the store plus the evidence ledger and a signed anchor, verified with `geo-verify`, taken while it runs), written into the Guard's own volume and picked up by the nightly job.
- **Litestream 0.5 has no client-side encryption.** The plan says the stream is age-encrypted; Litestream's configuration reference says an `age:` block makes 0.5.1 and later exit at startup. The bundle does not claim it. The nightly snapshots are age-encrypted in Node (`backup/age.ts`, the standard `age-encryption.org/v1` format with X25519 recipients); the proof opens what it writes with the real `age` tool and the other way round.
- **Nightly snapshot.** One short-lived container with the volumes mounted: `VACUUM INTO` on a read-only connection (never a checkpoint of the live file), integrity check, every file encrypted to the public key, a manifest with each file's size and digest and the record's length, last sequence number and a digest of its last entry, then pruning by the date in the key (30 days). It runs as root with every capability dropped except the two that read and write files it does not own, on the egress network only when the target is a bucket.
- **Weekly drill.** Litestream's own `restore` into a scratch folder, then a container compares: integrity check, and the restored record's last entry against the live record's entry **at the same sequence number**; a copy behind by up to 100 entries passes, a different entry or an empty copy of a non-empty record does not. The result is in `state/`, in `status/<shop>.json` and in `geometer status`. A snapshot is not opened by the drill, because the key is not on the server.
- **`restore`** stops the shop's runtime and Litestream, restores (to a time with `--at`), keeps the file it replaces as `agent.db.before-restore-<time>`, and starts them again.

## The panel's contract (added 4 November)

The panel (`bundle/panel/`, merged into main separately) shares files with the deployer, and writes its shapes in `bundle/panel/contract.ts`. The bundle follows them:

- **`status/<shop>.json`** is the panel's `ShopStatus`: `updatedAt`, `deploy {state, at, message}`, `limits {proven, of, unprovable}`, `versions {pathway, bundle, guard}`, `stopped {at, requestId}`, `backups {lastCopyAt, lastDrillAt, drillOk}`, with more detail beside them that its checker ignores (`refusal` by rule, per-Guard proof, webhook addresses). The panel says "Not confirmed yet" when `updatedAt` is old, so the deployer's loop moves it every minute **only if the runtime and all three Guards answer and have run their tripwires**; one that does not answer is left alone, and a Guard whose tripwires failed is written at once as fewer limits proven than there are. `deploy.state` is `in-progress` while a deploy runs, `applied` after the running Guards agreed with what was checked, `failed` with the rule names in `message` (500 characters at most, the panel's limit) when it was refused.
- **`requests/<shop>.stop.json`.** The deployer reads it, sets the kill switch on every Guard of the shop (and stops that shop's agent at the model Guard), writes `stopped {at, requestId}` into the status, and only then removes the file; if a Guard cannot be reached the request stays and is tried again. A stop for a shop with no Guards yet is recorded and applied at its first deploy. A deploy never undoes a stop.
- **`exports/<shop>/{record,bookings}.json`**, every quarter of an hour, from one short-lived container that reads each runtime database in a single read transaction. The files leave the shop's volume, so a booking's `customer` and a record entry's `conversation` become a short hash of themselves (the report's own digest of an entry already leaves the conversation out, so nothing in a digest changes). The shapes are what `scripts/client-report.ts` reads.
- **`shops/<shop>/pins.json`** (the ids the panel's checks confirmed) are the exact allowlists when present, in the Guards **and** in the runtime's configuration, so they cannot disagree; a runtime.json that names another id is told so. The Razorpay key handed in must be the key id (and mode) the check confirmed.
- **The read-only routes.** WhatsApp `GET /{version}/{phone_number_id}` (`read_number`) and Calendar `GET /calendar/v3/calendars/{calendarId}` (`get_calendar`) are in the specs with the same exact-id rule as the routes beside them. Each Guard has an agent `panel-<shop>` limited (in `guard.toml`, per-agent `operations`) to that one read: `list_links` at Razorpay, `read_number`, `get_calendar`. Its token is in `secrets/panel/<shop>/<kind>` and nowhere else; the Guard keeps a hash.
- **The panel's place on the network.** A network of its own, `panel` (internal), holds the panel and, for each shop's three Guards, their forwarder at a second address, with the Guard's name as an alias. The forwarder still listens for the admin port on the admin address alone, so on the panel's network only the Guard's agent port (and its health port) answers. The panel is also on `front` for Caddy. It is not on `admin`, `egress` or any shop network, and it is mounted with the folders in the README's list and nothing else. **Not done:** the panel's optional look at a runtime's `/status` (Deferred.md).
- **Who the panel runs as.** The panel insists that its key files are 0600 and that the files it writes into the inbox are 0600 and its own, so a different user could not read them. The deployer's user therefore runs the panel container (`user: uid:gid`), and so the deployer can read what the panel wrote. A root deployer cannot give a root-run container's files to anyone sensibly; it runs the panel as 1000 and hands the panel's folders and keys to 1000.
- **The server-wide Google key** (`geometer google-key`) is used for a shop that hands in none: its token is made for that shop's Calendar Guard like any other. The panel is given the key's address (`client_email`, not a secret) so it can say who to share a calendar with.
- **A shop name whose inbox already holds files** is refused by `shop add`: that setup was started by someone else.
- **The panel is served at the root** of the domain (it builds absolute paths, and its public address has no path), with `/c/*` going to the inbox; without a panel the root answers 404.

## What the tests show, and what they do not

94 tests run with no Docker (`cd bundle && npm test`; a 95th checks the status file with the panel's own checker once `bundle/panel/contract.ts` is in the tree, and was run against a copy of it); the pathway's own tests (580, four more than before, one skipped as before) still pass. The tests cover the generator and each of its refusals, the drift against the monorepo fixtures, the compose layout (who is on which network, which container mounts which secrets folder, nothing mounts the Docker socket), the deployer against a fake machine (a broken tripwire starts nothing; versions only rise; only changed services are restarted; a stopped shop stays stopped; a running Guard that disagrees stops the shop), the inbox isolation, the heartbeat against fleet's validator, the refresher's token discipline, snapshots and the drill against real SQLite, age, the S3 signing and the command line.

`test/proof/run.ts` runs the real thing, on Docker Desktop (Apple silicon, 8 GB for the VM, Docker 29.8, Compose v2), with the real Guard image `geo-guard:0.1.0-alpha.2-pathways.1`, the stand-ins as the providers, MinIO as the bucket, the real `apps/fleet` on the host with its own temporary config and data, and `age` from Alpine for the interoperability check. The third full run, on 4 November 2026: **148 checks, none failed** (1, 5 and 10 shops, about 25 minutes). The two runs before it found real faults, now fixed and each with a test: stopping one shop had pulled the shared model Guard's kill switch for every shop; a new shop's Calendar Guard could not be created because the token folder it mounts did not exist yet; the drill could not open a restored copy on a read-only mount; and the proof's own mistakes (a stand-in's answer read as a Guard's refusal; `docker kill` read as a crash, which Docker does not restart).

### The B14 checks

| Claim | Result |
|---|---|
| Every limit is proven on the running Guard | `12 of 12 limits proven to bite` per shop (3 Guards), 7 more named as not testable without writing and not counted; the model Guard 2 of 2. Read from the running Guards' `/admin/status`, with the policy digest equal to the one compiled. 30 s to deploy one shop, 74 s for five, 175 s for ten (compile and verify included). |
| A refused deploy | Two shown with the real binary (below). Neither started anything. |
| Kill the Razorpay Guard under load | 12 payment-link calls a second from inside the runtime for 24 s; the Guard was stopped at 8 s. 85 calls reached the Razorpay stand-in; **0 after the stop** (85 at the stop, 85 at the end; 179 calls found no Guard). A real crash (SIGABRT) is restarted by Docker, in the same namespace, and answers its runtime again. |
| From inside the runtime, nothing but its Guards | Tried by name and by address: the stand-in providers, MinIO, `1.1.1.1:443` and `8.8.8.8:53`, the inbox, the relay, ops, the Guard's own admin port, every forwarder and door address on the admin network, and (with five shops) **the other shop's Guards and runtime**, by name and by address. All unreachable (`ENETUNREACH`, or a timeout where the name does not resolve). It reached its own three Guards and the model Guard, as a control. A control from ops reached the forwarder and the door, so "unreachable" means something. |
| A held refund survives restarts | A refund above the owner's limit: HTTP 202, the approval held for 24 hours, nothing refunded. After restarting the Guard **and** the runtime, the same call was still held under **the same approval**. The owner's signed approval (through the relay's route) was accepted; the identical retry then went through once (one refund at the provider); a repeat was held again, not sent. The relay's reading credential was renewed twice and listed the hold. |
| A forced tripwire failure | A policy for another tool was written into the Razorpay Guard's store, as a second replica on a shared store could (the case the tripwires exist for). `/readyz` went to **503**, `/admin/status` said `0 of 2` with the rules named, every call was refused (`the Guard's self-check failed ... nothing is sent until a later check passes`), and **fleet's alert fired** from the heartbeat the bundle sent: `guard-razorpay, the Guard in front of glow-salon's services on proof, reported not ready ... Check first: is the Guard's container running`. With the right policy back `/readyz` was 200 again. |
| The kill switch | `stop` set it on the shop's three Guards (not the shared model Guard's), the record named who and when, it survived a restart of the Guard, and the Guard refused new calls (503). A stop request from the panel was carried out on the Guards, showed in status with its request id, and was removed. |
| Webhooks | A signed Razorpay webhook through Caddy, the inbox and the door was saved by the runtime; a wrongly signed one was refused (401); the unprefixed path is not the inbox's. |
| The panel's access | Its own agent read the WhatsApp number, the calendar and the payment links through the Guards and was refused (403, "agent panel-glow-salon is not authorized for ...") when it tried to send, to create a payment link or to write the calendar, and was refused another shop's number. From its network it reached only the Guards' agent ports. (This branch's stand-ins have no `GET` for the number or the calendar, so those two answers were the stand-in's 404 after the Guard passed them on.) |
| Data | Litestream streamed to MinIO; a nightly snapshot of 156 files (the runtime's database and the Guard's own backups) is in the snapshot bucket, every object an age file and none holding a plain SQLite header; the weekly drill restored the continuous copy and matched the live record (`restored 1 entries, integrity ok, last entry #1 matches`); `restore` put the record back and the shop ran again; the real `age` opened what Node wrote and Node opened what `age` wrote. The stream bucket holds plain SQLite (Litestream 0.5 cannot encrypt). |

**The refusal output for a broken tripwire**, from the real deploy and the real binary. The spec was changed to list every ending a tripwire could use, so the pin would let any value through:

```
deploy with a rule that fails its tripwire refused:
  - [compile:own-number-only] g-glow-salon-whatsapp: refused: a rule of this spec would not hold, so no bundle was written: own-number-only expected refuse for phone_number_id = geometer-tripwire-x, got allow (phone_number_id allowed)
```

and the failure that started all this, a guard.toml that names another tool than its bundle (a Guard that would look healthy and protect nothing):

```
  - [tripwire] g-glow-salon-razorpay: geo-guard verify-bundle refused this setup: sha256:955cb4b4... ok (ceiling production) | refused: the policy bundle names tool "razorpay" (rule deposit-amount and 7 more) but guard.toml says tool = "whatsapp": every rule would be skipped and nothing would be protected, so this Guard will not run it
```

### Memory, and the shops-per-server cap

Measured with `docker stats` on Docker Desktop (cgroup memory, which includes some page cache; **not RSS on a VPS**), 80 seconds after `up`, idle, with the heartbeat every 10 s rather than 60 (the test's setting). The test infrastructure (stand-ins, MinIO) is not counted.

| | 1 shop | 5 shops | 10 shops |
|---|---|---|---|
| containers | 19 | 51 | 91 |
| **bundle total** | **221 MiB** | **439 MiB** | **713 MiB** |
| each runtime (Node) | 35.6 | 36.5 (max 39.5) | 35.2 (max 38.0) |
| each shop Guard (Rust) | 2.2 (max 2.7) | 1.8 (max 2.2) | 1.6 (max 3.6) |
| model Guard | 1.7 | 3.2 | 2.4 |
| each forwarder or door (busybox) | 1.0 | 1.2 | 1.0 |
| inbox / relay / refresher | 33.5 / 36.9 / 30.5 | 30.3 / 38.5 / 35.1 | 32.3 / 49.8 / 35.5 |
| ops (heartbeat and admin client) | 41.3 | 61.4 | 109.4 |
| Litestream | 13.6 | 16.5 | 20.8 |
| Caddy | 16.2 | 18.4 | 18.4 |

About **55 MiB for each shop** (a runtime 35, three Guards 5, four forwarders and doors 4, and the share of the growth of ops, the relay and Litestream) on top of about **170 MiB** for everything shared. So `memory(N) = 170 + 55 N` MiB: 20 shops 1.3 GB, 30 shops 1.8 GB, 40 shops 2.4 GB. A Guard is 2 MiB; the Node programs are what weigh. `ops` grows with the shops (it asks every runtime and Guard every heartbeat); it is the first to trim.

**The cap I would set: 25 shops on a 2 vCPU / 4 GB server.** Memory alone would allow about 40, leaving 1.5 GB for the operating system, Docker and bursts (Litestream's first sync is 50 MiB). The cap is lower than memory allows because **CPU under real load, disk and the Docker daemon's own use on a 2 vCPU machine were not measured** (B14 item 4), so 25 is a guess to be tested, not a measurement. At 25 shops a server of ₹500 to ₹2,000 a month is **₹20 to ₹80 a shop a month**; at 10 shops it is ₹50 to ₹200, so the plan's "under about ₹100 per shop" holds from about 20 shops on a ₹2,000 server and at any size on a ₹500 one. That is the hosting share of the cost line. Not measured: B14 item 5 (the demo salon through Guard for two weeks).


## Size

Lines of code, counted with `wc -l` on the branch (every line, comments and blank lines included; the bundle's lines are long):

| | Before | After |
|---|---|---|
| The Guard templates, hand-copied in the monorepo (5 specs and 5 guard.toml) | 574 lines, edited by hand per shop | still there as fixtures; **the generator that replaces them is `generate/guards.ts`, `shop.ts` and `rules.ts`: 373 lines**, producing every spec and guard.toml for every shop from its settings |
| `bundle/` programs (everything above except tests) | 0 | **3,423** (the CLI, deployer and apply loop 921; services 476; generator 846; backup 555; lib 625) |
| `bundle/` tests | 0 | 1,671 (94 tests), plus the proof harness 641 |
| `bundle/` docs (README, Explanation, Deferred) | 0 | 316 |
| The pathway (`pathways/bookings`) | unchanged otherwise | +144 / -26 lines including its tests and notes: the status counters, `parser.agentTokenFile`, the inbox and relay as handlers, the relay's hours |
| The repository as a whole | 40,133 lines | 46,317 lines |

