# Geometer deploy bundle

One folder per server, one Docker Compose file generated from it. Every shop gets its own runtime and its own Guards (Razorpay, WhatsApp, Calendar); the server adds one model Guard, one inbox, one approvals relay, one Google token refresher, a continuous copy of every record (Litestream), HTTPS (Caddy) and a heartbeat to Geometer. Builders run it on their own small server. Geometer runs it on one server for the partners' shops.

The runtime holds no key, and the only things it can connect to are its own Guards and the model Guard. If a Guard is down, nothing goes out. Before anything starts, every Guard's limits are compiled and **every tripwire is proven on the Guard** (a forbidden call, derived from each rule, must be refused); a deploy that cannot prove them is refused, and says which rule.

> **The Guard image is not published to a registry yet** (that needs the owner's yes), so a builder cannot `docker pull` it. Geometer gives you the image as a file, and you load it: `docker load < geo-guard-<version>.tar`. The pilot on Geometer's partner server uses a locally loaded image the same way. The image has to match the server's CPU (an Intel or AMD server needs the x86_64 file, an ARM server the arm64 one).

## What you need

| | |
|---|---|
| A server | Ubuntu 22.04 or 24.04 with **Docker Engine** (not Docker Desktop), 2 vCPU and 4 GB for about ten shops (see "How many shops" in [Explanation.md](Explanation.md)). A Hetzner Cloud CX22 or CPX21, a DigitalOcean Basic Droplet with 2 vCPU / 4 GB, or any Ubuntu box you have. |
| Node 26 on that server | The deployer (`node bundle/geometer.ts`) runs on the server itself: it is the only program that talks to Docker. Everything else runs in containers from `node:26-alpine`. |
| A domain | An `A` record pointing at the server. Caddy gets the certificate by itself. |
| Per shop | The shop's Razorpay key and webhook secret, its WhatsApp provider token and app secret, its Google service account (the shop's calendar is shared with it), and the shop's settings. The panel (or you, by hand) hands them in; see "Secrets". |
| For the model | One API key for the one model every shop on the server may use. |
| For backups | Two places that are not this server: a bucket for the continuous copy and another place for nightly snapshots (any S3-compatible bucket: Google Cloud Storage's S3 interface in Mumbai, Backblaze, Cloudflare R2, MinIO). |
| Alerts from outside | A deployment key from Geometer (`gfk_...`) and the fleet address. Without it the server can still run, but nobody outside hears if it dies. |

## From an empty server to the first shop

**1. Make the server.** Create it, add your SSH key, and open ports 22, 80 and 443 in its firewall (Hetzner: Firewalls; DigitalOcean: Networking, Firewalls). Log in as a normal user with `sudo`, not as root.

**2. Install Docker Engine and Node 26.**

```sh
curl -fsSL https://get.docker.com | sudo sh          # Docker's own script; or follow docs.docker.com/engine/install/ubuntu
sudo usermod -aG docker "$USER" && newgrp docker
docker compose version                               # must print v2.2x or newer
# Node 26: take the Linux binaries from nodejs.org/en/download (or NodeSource's setup script, or nvm) and put `node` on the PATH
node --version                                       # v26.x
```

**3. Get the bundle and the Guard image.**

```sh
git clone https://github.com/GeometerLabs/agents.git && cd agents
docker load < ~/geo-guard-0.1.0-alpha.2-pathways.1-x86_64.tar      # the file Geometer gave you
```

**4. Make the server folder.** Everything lives in one folder; the bundle's own code is read-only inside the containers.

```sh
node bundle/geometer.ts init ~/geometer-server \
  --domain shops.example.com --reviewed-by your-name \
  --model-wire openai --model gpt-4o-mini \
  --fleet-url https://fleet.geometer.dev --fleet-key-file ~/geometer-server/fleet_key \
  --stream-url s3://my-bucket/stream --stream-endpoint https://storage.googleapis.com \
  --snapshots-url s3://my-other-bucket/snapshots --snapshots-endpoint https://s3.us-west-000.backblazeb2.com \
  --age-identity-out ~/age-identity.txt
```

`init` makes a key pair for the snapshots. **The secret half is written to `~/age-identity.txt`: move it off this server** (a password manager, your laptop). It is only needed to restore a snapshot, and it must not sit beside the snapshots. Put the deployment key Geometer gave you in `~/geometer-server/fleet_key`.

**5. Hand in the keys that belong to the server.**

```sh
export GEOMETER_SERVER=~/geometer-server
node bundle/geometer.ts model-key ~/model-key.txt                    # one line; goes to the model Guard only
node bundle/geometer.ts google-key ~/google-key.json                 # optional: one service account for every shop that hands in none of its own
node bundle/geometer.ts backup-key stream ~/stream-key.txt           # access-key-id:secret
node bundle/geometer.ts backup-key snapshots ~/snapshots-key.txt
```

**6. Add the first shop.** A client folder has `settings.json`, `runtime.json` and `pathway.lock` (see `pathways/bookings/clients/glow-salon.example`). In `runtime.json` the panel (or you) names the shop's own WhatsApp number id and Google calendar; the bundle sets everything about where things are.

```sh
node bundle/geometer.ts shop add glow-salon --from ~/clients/glow-salon
mkdir -p $GEOMETER_SERVER/secrets-inbox/glow-salon      # then put the secrets in it, one file each (below)
node bundle/geometer.ts check glow-salon                # starts nothing; says what is wrong, all at once
node bundle/geometer.ts deploy glow-salon
```

`deploy` prints the proof, read from the running Guards: `12 of 12 limits proven to bite`. That line is what the shop's go-live certificate quotes. If a rule cannot be proven, the deploy is refused and **nothing is started**:

```
This was refused, and nothing was started or changed:
  - [tripwire:deposit-amount] g-glow-salon-razorpay: the rule "deposit-amount" would let a forbidden call through (0 of 4 tripwires passed). Nothing was started.
```

**7. Point the providers at the shop.** The address is in `status/glow-salon.json` (and in the panel): Razorpay's webhook goes to `https://shops.example.com/c/glow-salon/webhooks/razorpay`; WhatsApp's callback goes to `https://shops.example.com/c/glow-salon/webhooks/whatsapp`, with the verify token you handed in. (A provider that does not sign its webhooks, like Gupshup, gets a secret path instead: hand in `whatsapp_path_token` and the address ends `/webhooks/whatsapp/<token>`.)

**8. Keep the deployer running.** It applies what the panel writes, renews the relay's reading credential every day, takes the nightly snapshot and runs the weekly restore drill.

```ini
# /etc/systemd/system/geometer-deployer.service
[Unit]
Description=Geometer deploy bundle: the deployer
After=docker.service
Requires=docker.service
[Service]
User=YOUR-USER
Environment=GEOMETER_SERVER=/home/YOUR-USER/geometer-server
WorkingDirectory=/home/YOUR-USER/agents
ExecStart=/usr/local/bin/node bundle/geometer.ts apply --watch
Restart=always
[Install]
WantedBy=multi-user.target
```

## Secrets

Hand each one in as a file in `secrets-inbox/<shop>/<name>`. The deployer moves it into the folder of the one container that needs it and deletes it from the inbox. The runtime never sees any of them.

| Name | Goes to | Notes |
|---|---|---|
| `razorpay_key` | the shop's Razorpay Guard | `key_id:key_secret`, one line |
| `whatsapp_token` | the shop's WhatsApp Guard | the access token |
| `razorpay_webhook_secret` | the inbox | |
| `whatsapp_app_secret` and `whatsapp_verify_token` | the inbox | Meta's signature, and its handshake token |
| `whatsapp_path_token` | the inbox | instead of the two above, for a provider that does not sign |
| `google_service_account.json` | the token refresher | the key file of the service account the shop's calendar is shared with |

Nothing secret is in any generated file; the generator searches for the value of every secret and for the shape of keys, and refuses if it finds one. Folders under `secrets/` are 0755 and files 0644 so a container's own non-root user can read them; `secrets/` itself is 0700, so no other user of the machine gets to any of it. Docker mounts one container's folder into that container only.

## Every day

```sh
node bundle/geometer.ts status                # each shop: running or not, its Guards, last backup and drill
node bundle/geometer.ts logs glow-salon
node bundle/geometer.ts stop glow-salon --reason "owner asked"     # the Guard kill switch: nothing goes out; the record says who
node bundle/geometer.ts start glow-salon
node bundle/geometer.ts update --dry-run     # a new template version for every client: what would move and what would be held back (changes nothing)
node bundle/geometer.ts update                # do it, each client checked on its own settings first
node bundle/geometer.ts rollback              # put the clients the last update moved back on their previous version
node bundle/geometer.ts restore glow-salon --at 2026-11-04T10:30:00Z    # the record as it was, from the continuous copy
```

## Update every client at once

You run one template for many clients, and each is pinned to the version it runs. A new version comes out. One command moves every client, and **each client is hand-checked on its own settings first**; a client that does worse on the new version is held back, with the reason, and keeps running the version it runs.

```sh
node bundle/geometer.ts update --dry-run                 # runs the checks and says what would happen; writes and starts nothing
node bundle/geometer.ts update --to 0.2.0                # every client; without --to, the version in this checkout (pathways/bookings/package.json)
node bundle/geometer.ts update --shops glow-salon,pet-spa    # just these two, in this order
node bundle/geometer.ts rollback                         # the clients the last update left on its version (moved, or found already there), back to the pin they had
node bundle/geometer.ts rollback --shops glow-salon      # or just this one (also: rollback glow-salon)
```

A version other than the one in this checkout needs its own folder beside the server, a checkout of its tag: `~/geometer-server/pathways/bookings@0.2.0/`. A client whose new version is not there is held back and told where to put it. With no `--to`, a client that already runs a version **newer** than this checkout's is left as it is (it is never taken back); name the version with `--to` to move a client to an older one, which is a move like any other: hand-checked, and refused if the older version cannot read the saved data the newer one wrote (below).

For each client, in order:

1. The template's own hand check (`pathways/bookings/scripts/hand-check.ts`, the same one that makes the go-live certificate) is run **on that client's settings** at the version it runs now, and again at the new version. Each says "Held N of M".
2. A client that holds everything that held before **moves**: its `pathway.lock` is changed and the same checked deploy as `geometer deploy` runs, so only what changed is restarted and the running Guards are asked again ("12 of 12 limits proven to bite").
3. A client with any situation that held before and now **fails, or is no longer run**, is **held back**: nothing about it is touched. A situation that failed on both versions does not hold it back (it is no worse off). A new situation that fails does.

```
Update, each client checked on its own settings first:
  ✗ bright-tuition  HELD BACK. Held 33 of 34 at bookings@0.2.0; 34 of 34 held at bookings@0.1.0. Now failing: Deposit link paid twice. It stays on bookings@0.1.0.
      - Deposit link paid twice: The customer was charged twice: ...
  ✓ glow-salon      moved from bookings@0.1.0 to bookings@0.2.0. Held 34 of 34 on its own settings (34 of 34 before). 12 of 12 limits proven to bite.
  = pet-spa         unchanged. Already on bookings@0.2.0.
  - my-agent        skipped. Agents you wrote are updated by you; Geometer re-checks them once the self-serve crash test (B52) exists.

Moved 1, held back 1, unchanged 1, skipped 1.
```

The exit code is 0 when every client is moved, unchanged or skipped, and 1 when any is held back or the run did not finish. Fix what failed (or the client's settings) and run `update` again: it checks the held-back clients again.

**Where the pins are.** A client's version is its pin, the line in `shops/<shop>/pathway.lock`. The pins it had before are `lockHistory` in `state/state.json`; `rollback` takes the last one. `state.update` and `state.rollback` in the same file are the last run of each, client by client (what was decided, the two "Held N of M", the situations that failed, what the Guards proved). `status` and the panel's status file show the version that runs.

**Stopped in the middle.** Each step is written to the state file before the pin is touched. If the run stops (the machine, a deploy that was cut off), run the same command again: clients that are done are not checked or deployed a second time, and the one that was half-way is finished. A deploy that is **refused** puts that client's earlier pin back and stops the rollout there, so one client is affected at most; run the same command again to carry on with the rest. Another request (other `--to` or `--shops`) starts a new run.

**While a booking is in progress.** A move restarts that client's runtime, as any deploy does that changes it. The runtime saves each event before it answers and each step whole, so a booking in the middle picks up where it was; the other clients are not touched. What has been run: the pathway's tests stop a runtime between a payment link and its payment and finish the booking once after the restart, and the Docker proof restarts a runtime and its Guard with a refund held for the owner and finds it still held (see [Explanation.md](Explanation.md)). Not run: an update with a live booking in the middle.

**Rollback** is the same move the other way, through the same checks, and it takes the pin it goes back to off the history, so rolling back twice goes back twice and a rollback never moves a client forward unchecked. One thing stops it: a runtime cannot start on saved data written by a newer layout than it knows. If the new version changed the layout (the update says so in a note), `rollback` is refused before anything is touched, saying why; an `update --to` an older version is refused for the same reason. With no names, `rollback` takes the clients the **last update** left on the version it names and that have an earlier pin to go back to, so running `update` again to look at a held-back client does not empty that list. The way out is a newer version that fixes what went wrong, or `geometer restore` of the record from before the update, which loses what came in since.

**Editing in the panel does not move a client.** A client's settings can be changed in the panel as before; its pin is kept. Only `update` (and `rollback`) change a pin, after the hand check.

**Agents you wrote** (see below) have no template and no hand check yet. `update` skips them and says so; you update them yourself.

## Bring your own agent

You built an agent with Claude Code, Lovable, n8n or your own code. It takes bookings, collects deposits and refunds them. Geometer puts the same Guards in front of the services it calls, keeps the same record, asks the owner on WhatsApp before a big refund, and writes the same monthly report. **You change three web addresses and one key in your agent. Geometer does not host it, rebuild it or read its code.**

```sh
node bundle/geometer.ts agent add my-agent \
  --deposit 200 --refund-limit 100 --owner-whatsapp +919800000001 \
  --whatsapp-number-id 123456789012345 --calendar-id shop@group.calendar.google.com
```

`--upstreams razorpay,whatsapp,calendar` is the default (the services the templates use; a refund needs WhatsApp, because the owner is asked there). Instead of the flags, `--settings my-settings.json` takes the same settings file a template uses (`pathways/bookings/clients/glow-salon.example/settings.json`), checked by the same validator. `add` starts nothing. It prints what your agent must use instead of the real services:

```
Razorpay        https://shops.example.com/g/my-agent/razorpay
WhatsApp        https://shops.example.com/g/my-agent/whatsapp
Google Calendar https://shops.example.com/g/my-agent/calendar
Credential      gg_...   (send it as "Authorization: Bearer gg_..." on every call)
```

The path after each address is the service's own (`/v1/payment_links`, `/v26.0/<number id>/messages`, `/calendar/v3/...`). The credential replaces Razorpay's, Google's and WhatsApp's own keys, which your agent never holds. Then hand in the shop's own keys (the same names as for a shop, in `secrets-inbox/my-agent/`: `razorpay_key`, `whatsapp_token`, `whatsapp_app_secret`, `whatsapp_verify_token`, `google_service_account.json`), and check and deploy it like a shop:

```sh
node bundle/geometer.ts agent check my-agent       # starts nothing; says what is wrong, all at once
node bundle/geometer.ts agent deploy my-agent      # "N of N limits proven to bite", counted on the running Guards (N depends on the limits)
node bundle/geometer.ts agent show my-agent        # the addresses again (--credential also prints the credential)
```

A server that holds only agents like this needs steps 1 to 4 above (the model that `init` asks for is not used, so any name will do) and the `google-key` of step 5 if you use it, but **no** `model-key`, no model Guard and no shop. The same server can hold shops too. (The nightly backups and the restore drill cover shops; an agent's Guards are not in them yet: [Deferred.md](Deferred.md).)

In WhatsApp's settings, send the shop's webhooks to `https://shops.example.com/c/my-agent/webhooks/whatsapp`. Geometer's inbox checks each one, keeps the owner's replies to approval requests, and passes the whole webhook on to your agent as it came, signature included, if you gave `--forward-whatsapp-to https://your-agent.example.com/whatsapp`. Your agent keeps taking its own Razorpay webhooks.

**What your agent has to do.** Little, and the example (`bundle/examples/own-agent/agent.js`, plain Node, no dependencies) does all of it:

- A refund above the owner's limit gets **HTTP 202**: Guard is holding it and the owner has been asked on WhatsApp. **Send the refund with a `receipt`** (any reference of yours: it is how the owner's request finds the right payment), and **send the identical call again** every few minutes until it is made (HTTP 200). Nothing else hurries it; only the owner can approve, and a hold lasts `approvalHours` (24 by default) and then runs out. Once it is made, do not send it again: Guard holds a repeat of a refund that was already made as a new request to the owner, and the owner would be asked twice.
- A refused call gets HTTP 403 and a reason in words. The limits are the template's: a payment link only for the deposit, a refund of at least 1 paisa and at most one deposit, no payouts, a calendar event only on the shop's own calendar, a message only from the shop's own number, and the caps (links, refunds, messages, events).

**What Geometer adds**, the same as for a template:

| | |
|---|---|
| The limits | Made from the settings by the templates' own code. The deploy is refused, naming the rule, unless every limit it can test is proven on the Guard (`geometer agent check`). |
| The owner's approvals | A refund above the limit waits on WhatsApp for the owner's one-use code (the approvals relay, the same one). |
| The record | Built from what the Guards decided (allowed, held, refused, and the answer the service gave) and what the services themselves hold (the payment, the refund, the calendar event). Never from what the agent says. `geometer agent record my-agent`; the deployer does it every five minutes, and says so if Guard's list of its 500 most recent calls ever ran ahead of it. |
| The report | `geometer agent report my-agent --month 2026-11 --out ./report` writes the monthly report and certificate the templates' do, from that record. |
| Alerts | The heartbeat carries the agent's Guards (up, ready, killed, held calls, calls decided, counts only), so Geometer's alerts from outside work; the relay tells you when a request to the owner could not be made. |
| Stop | `geometer stop my-agent` is the Guard kill switch: nothing new goes out. |

**What it does not do.** It does not host or rebuild your agent, and cannot make it behave: it can only stop what goes through the Guards and say what happened. Guard has no rule for prices or opening hours, so for an agent we did not write they are in the settings file (and in the report's policy digest) but nothing checks them. A call that does not go through the addresses above is not seen. Only Razorpay, WhatsApp and Google Calendar are covered; other services, the Claude Code plugin, n8n and Lovable doors, and a self-serve crash test of your agent are on the list of things not built ([Deferred.md](Deferred.md)). How it is built, and what was and was not run: [Explanation.md](Explanation.md), "Bring your own agent".

## Backups

| Layer | How often | Where | Encrypted |
|---|---|---|---|
| Every runtime database | about every second | your stream bucket, by Litestream | by your bucket and TLS. **Not age**: Litestream 0.5 no longer supports client-side encryption; see [Explanation.md](Explanation.md) |
| Every runtime database, and each Guard's own store and evidence ledger | every night, kept 30 days | your snapshot place | age, to the public key in `geometer.json` |
| Restore drill | every week | restores the continuous copy into a scratch folder, checks integrity, compares the last record entry with the live record | |

A failed drill, or a snapshot that did not happen, shows in `status` and in `status/<shop>.json` (`backups`). The record and bookings the panel's monthly report reads are exported every quarter of an hour to `exports/<shop>/`.

The heartbeat carries two optional facts per shop, so a snapshot that stopped or a drill that failed alerts from outside the server: the age of the last good snapshot (alert after 36 hours) and the age and verdict of the last drill (alert if it failed, or after 8 days without one). It sends ages and a yes/no, never the drill's reason (that stays in `status`). Geometer's fleet service must be new enough to know these two fields before a bundle sends them; an older one refuses every heartbeat as malformed. A shop whose very first snapshot never succeeds sends nothing about backups until one does (see [Deferred.md](Deferred.md)).

Restoring a snapshot needs the secret half of the age key, which is not on the server: `restore` uses the continuous copy; a snapshot is decrypted on the machine that has the key.

## The folder, for the panel

```
<server>/geometer.json            this server (written by init)
<server>/shops/<shop>/            settings.json, runtime.json, pathway.lock, owner.json, pins.json   the panel writes; the deployer applies
<server>/secrets-inbox/<shop>/    razorpay_key ("<key id>:<key secret>"), whatsapp_token, ...        the panel writes, mode 0600; the deployer moves and deletes
<server>/requests/<shop>.stop.json  a request to stop a shop                                          the panel writes; the deployer acts, shows it in status, removes it
<server>/status/<shop>.json       deploy, limits {proven, of, unprovable}, versions, stopped, backups  the deployer writes; the panel reads
<server>/exports/<shop>/          record.json and bookings.json, without customers' numbers           the deployer writes; the panel's monthly report reads
<server>/panel/                   the panel's own data
<server>/state/                   the deployer's memory (Guard bundle versions, who stopped a shop, lock history, the last update and rollback step by step)
<server>/generated/               compose.yaml, Caddyfile, per-container config: rewritten on every deploy, never edited
<server>/secrets/                 one folder per container
```

**The panel** is a container named `panel` that runs `bundle/panel/main.ts` (set `"panel": {"enabled": true, "mode": "own"}` in `geometer.json`, or `--panel` at `init`; Geometer's partner server uses `"mode": "hosted"`). It is served at the root of your domain (the inbox keeps `/c/...`). It is mounted with exactly the folders above that it writes or reads, plus `geometer.json` read-only: **not** `secrets/`, `state/` or `generated/`, no Docker socket. It runs as the user who runs the deployer, because it insists on keeping its keys and the files it writes private to its user (0600); a deployer run as root hands those files to uid 1000 and the panel runs as that. Its keys are made for it in `secrets/panel/`: `data_key` (32 random bytes as hex, which encrypts what it keeps), `signing_key` (an Ed25519 private key in PEM, which signs the go-live certificate) and `guard_agent_token` (below).

The panel reaches each shop's Razorpay, WhatsApp and Calendar Guards on a network of its own that carries nothing else (no runtime, no model Guard, no admin port, no inbox). At each Guard it presents its own agent, `panel-<shop>`, which that Guard allows **its connection-check reads and nothing else**: `list_links` at Razorpay, `read_number` at WhatsApp (`GET /{version}/{phone_number_id}`) and, at Calendar, `get_calendar` (`GET /calendar/v3/calendars/{calendarId}`) and `list` (`GET .../events`, which the panel asks for one event of, because that is where Google says whether the account can write). Each is pinned to the shop's own id like the routes beside it. The panel reads **one** token file and presents it to every Guard, so there is one token, `secrets/panel/guard_agent_token`, mounted only into the panel; every Guard keeps its hash under its `panel-<shop>` agent. Without these the panel's "Ready to go live" cannot pass in production.

The first builder's way in is `node bundle/geometer.ts panel invite --role builder` (it asks the running panel for a one-time link; in hosted mode this is the only way to make an invitation). `--role partner` is for a partner's account.

`pins.json` (the ids the panel's connection checks confirmed) is used for the exact allowlists when it is there, and for the runtime too, so the two always agree; a changed pin is a new version of that Guard's bundle. A Razorpay key handed in that is not the key id the check confirmed, or of the other mode, is refused by name. With no `google_service_account.json` in a shop's inbox, the server-wide key (`node bundle/geometer.ts google-key <file>`) is used, which is how Geometer's hosted server works; the panel is told its address so it can say who to share a calendar with.

`status/<shop>.json` is the panel's own shape (`bundle/panel/contract.ts`, `parseStatus`): `updatedAt`, `deploy {state, at, message}`, `limits {proven, of, unprovable}`, `versions`, `stopped {at, requestId}`, `backups`. `updatedAt` is the last time the deployer confirmed the shop **from its running Guards**; while `apply --watch` runs it is refreshed every minute if the runtime and all three Guards answer, and is left alone when one does not, so the panel shows "Not confirmed yet" rather than a stale "live". A failed tripwire is written at once (fewer limits proven than there are).

`check <shop>` runs the generator's checks offline. Once the shop has been deployed (and the server has a panel) it also runs the panel's read-only connection checks, **inside the panel container** (`services/connection-check.ts`: it calls the same function the panel's "Run the checks" button does, so the panel shows what it found, and **when all of them confirm it writes `pins.json`**: the next `deploy` or `apply` then pins the Guards to the confirmed ids, so after a deploy `check` is no longer read-only on the shop's files). A check the panel cannot make yet (a shop made with `shop add` has no business number in the panel) is reported as "NOT RUN", not as a failure. It has to be there: only the panel is on the network the Guards' agent ports are on, and only it has the token. Before the first deploy there are no running Guards to ask, so it says "not run" and why; deploy, then run `check` again.

## Running it on your laptop

Docker Desktop works for a trial (use `--domain localhost` and `--http-port 8080 --https-port 8443`; Caddy makes its own certificate). The test that proves the architecture is `bundle/test/proof/run.ts`; it needs the Guard image, `node:26-alpine`, Caddy, Litestream and MinIO, and takes about twenty minutes. The ordinary tests (`cd bundle && npm test`) need no Docker.
