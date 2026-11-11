# Geometer deploy bundle

One folder per server, one Docker Compose file generated from it. Every shop gets its own runtime and its own Guards (Razorpay, WhatsApp, and Calendar for a template that has one: Bookings does, **Fees does not**); the server adds one model Guard, one inbox, one approvals relay, one Google token refresher, a nightly snapshot of every shop's data (gzipped, age-encrypted, kept 30 days), HTTPS (Caddy) and a heartbeat to Geometer. Builders run it on their own small server. Geometer runs it on one server for the partners' shops.

The runtime holds no key, and the only things it can connect to are its own Guards and the model Guard. If a Guard is down, nothing goes out. Before anything starts, every Guard's limits are compiled and **every tripwire is proven on the Guard** (a forbidden call, derived from each rule, must be refused); a deploy that cannot prove them is refused, and says which rule.

> **The Guard image is not published to a registry yet** (that needs the owner's yes), so a builder cannot `docker pull` it. Geometer gives you the image as a file, and you load it: `docker load < geo-guard-<version>.tar`. The pilot on Geometer's partner server uses a locally loaded image the same way. The image has to match the server's CPU (an Intel or AMD server needs the x86_64 file, an ARM server the arm64 one).

## Install in one command

On a new Ubuntu 22.04 or 24.04 server (a Hetzner CX22, a DigitalOcean droplet with 2 vCPU / 4 GB, any Ubuntu box), logged in as a normal user with `sudo`, with your domain's `A` record pointing at the server:

```sh
git clone --branch <release tag> https://github.com/GeometerLabs/agents.git ~/geometer/agents
bash ~/geometer/agents/install.sh
```

It asks two things: **your domain**, and **the pairing code** from your account page (geometer.dev/account, "Add a server"; type `skip` to leave it). It says what it will do and asks before it changes anything. Then it installs Docker Engine and Node if they are missing (each checked against its publisher's key or checksum), checks this copy is the release, loads the Guard image, pairs the server with Geometer (the code works once), makes the server folder, starts the deployer as a system service, starts HTTPS and the panel, and ends with the panel's address and **a one-time sign-in link**. The model's key, the backup place and Google are left for the panel's first run (until it asks for them: step 5 of "By hand").

- **Run it again whenever you like.** It finds what is there and only repairs or carries on; it never replaces the server folder, its keys, or a system file it did not write. `--dry-run` prints each step and changes nothing; `--help` lists the options.
- **Before the first release (11 Nov 2026)** `bundle/release.json` names no release, so the install refuses; `--use-this-checkout` installs the copy as it is, and says so. The Guard image is not in a registry yet: add `--guard-image-file <the file Geometer gave you>` (its sha256 must be the one `release.json` pins for your server's CPU).
- **Without pairing** (`skip`) the panel starts, but nobody outside hears if the server goes down, and it has no licence lease, so a production Guard image runs no shop (decision 39). Run the install again with a code to pair it. A deployment key Geometer gave you by hand still works: `--fleet-key-file <file> --deployment-id <id> --licence-key <hex> --lease-file <file>`.
- **Making the server with cloud-init:** paste `bundle/cloud-init.yaml` as the user data, with your SSH key, the release tag, your domain and the pairing code filled in. It makes a user `builder` and runs the install with `--yes`. Then log in and run `geometer invite builder` for your link. (Not tried on a real cloud yet.)

Afterwards `geometer` is a command on the server:

| | |
|---|---|
| `geometer status` | each shop: running or not, its Guards, its last backup |
| `geometer logs [shop]` | a shop's runtime and Guards; with no shop, the panel, HTTPS and the heartbeat |
| `geometer invite builder` or `partner` | a one-time sign-in link for the panel |
| `geometer stop <shop>` / `start <shop>` | **one shop's** kill switch: nothing goes out from it; the record says who |
| `geometer server status` / `server logs` | the whole server's containers and the deployer |
| `geometer server stop` / `server start` | **every** container: no shop answers its customers until `server start`. It names the shops and asks you to type `stop` |

What each step checks, and why, is in [Explanation.md](Explanation.md#the-one-step-install-11-november-plan-item-14b).

## What you need

| | |
|---|---|
| A server | Ubuntu 22.04 or 24.04 with **Docker Engine** (not Docker Desktop), 2 vCPU and 4 GB for about ten shops (see "How many shops" in [Explanation.md](Explanation.md)). A Hetzner Cloud CX22 or CPX21, a DigitalOcean Basic Droplet with 2 vCPU / 4 GB, or any Ubuntu box you have. |
| Node 26 on that server | The deployer (`node bundle/geometer.ts`) runs on the server itself: it is the only program that talks to Docker. Everything else runs in containers from `node:26-alpine`. |
| A domain | An `A` record pointing at the server. Caddy gets the certificate by itself. |
| Per shop | The shop's Razorpay key and webhook secret, its WhatsApp provider token and app secret, its Google service account (the shop's calendar is shared with it), and the shop's settings. The panel (or you, by hand) hands them in; see "Secrets". |
| For the model | One API key for the one model every shop on the server may use. |
| For backups | One place that is not this server, for the nightly snapshots: any S3-compatible bucket (Google Cloud Storage's S3 interface in Mumbai, Backblaze, Cloudflare R2, MinIO). Its key must be able to write, and to read for the weekly drill and `restore`. **Set a lifecycle rule on the bucket** that deletes snapshots after 30 days or more (Google Cloud Storage, Backblaze B2, Cloudflare R2 and MinIO all have one): the bundle deletes old snapshots itself only as a fallback, when its key may. A folder works for a trial, but a folder on this server's own disk is not a backup. |
| Alerts from outside, and the licence | Pairing: a one-time code from geometer.dev/account that the install exchanges for this server's deployment key (`gfk_...`), fleet's address, fleet's licence key and a trial lease. By hand: the key and the lease Geometer gives you. Without either the server can still run the panel, but nobody outside hears if it dies, and a production Guard image runs no shop without a lease. |

## By hand: from an empty server to the first shop

What `install.sh` does, step by step, for a server you set up yourself. Steps 6 and 7 (each shop) are the panel's, or yours, either way.


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
  --snapshots-url s3://my-bucket/snapshots --snapshots-endpoint https://storage.googleapis.com \
  --age-identity-out ~/age-identity.txt
```

`init` makes a key pair for the snapshots. **The secret half is written to `~/age-identity.txt`: move it off this server** (a password manager, your laptop). It is the only key that opens a snapshot, so it must not sit beside the snapshots or on this server: you bring it for a restore, and for the monthly restore test on your own machine (see "Backups"). Put the deployment key Geometer gave you in `~/geometer-server/fleet_key`.

**5. Hand in the keys that belong to the server.**

```sh
export GEOMETER_SERVER=~/geometer-server
node bundle/geometer.ts model-key ~/model-key.txt                    # one line; goes to the model Guard only
node bundle/geometer.ts google-key ~/google-key.json                 # optional: one service account for every shop that hands in none of its own
node bundle/geometer.ts backup-key snapshots ~/snapshots-key.txt     # access-key-id:secret
```

**6. Add the first shop.** A client folder has `settings.json`, `runtime.json` and `pathway.lock` (see `templates/commerce/bookings/clients/glow-salon.example`, or `templates/education/fees/clients/bright-tuition.example` for a tuition centre). In `runtime.json` the panel (or you) names the shop's own WhatsApp number id and, for a template with a calendar, the Google calendar; the bundle sets everything about where things are. The `pathway.lock` names the **template** (`bookings@0.1.0`, `fees@0.1.0`): the shop's settings are checked by that template, its Guards are the ones that template calls (Fees has no calendar Guard, asks for no Google key and has nothing for the token refresher), and its runtime, inbox and approvals relay are that template's (`lib/kinds.ts` is the one place that lists them). Or start from a template: `node bundle/geometer.ts shop add bright --template fees --whatsapp-number-id <id> --prepared-by "Divya, local partner"` (`--template bookings` takes `--calendar-id` too; `--settings <file>` replaces the template's made-up example, and is checked first).

```sh
node bundle/geometer.ts shop add glow-salon --from ~/clients/glow-salon --prepared-by "Divya, local partner"
mkdir -p $GEOMETER_SERVER/secrets-inbox/glow-salon      # then put the secrets in it, one file each (below)
node bundle/geometer.ts check glow-salon                # starts nothing; says what is wrong, all at once
node bundle/geometer.ts deploy glow-salon
```

`--prepared-by` is the name the owner reads in the monthly report ("Set up by: Divya, local partner"). With `--company` it is the person alone and the owner reads the company after the name (`--prepared-by Divya --company "Sri Sai Digital"` gives "Divya, Sri Sai Digital"). Leave it out and the message says "your builder"; `deploy` tells you when it had to use that. A shop made in the panel needs no flag: the panel already knows who made it.

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
node bundle/geometer.ts restore glow-salon --identity ~/age-identity.txt --at 2026-11-04T10:30:00Z    # the shop's data from the newest nightly snapshot at or before that time, opened with your key (bring it, then take it away)
node bundle/geometer.ts licence extension extension.gx1                  # an emergency extension from Geometer, if fleet cannot renew the licence for a while
```

## Update every client at once

You run one template for many clients, and each is pinned to the version it runs. A new version comes out. One command moves every client, and **each client is hand-checked on its own settings first**; a client that does worse on the new version is held back, with the reason, and keeps running the version it runs.

```sh
node bundle/geometer.ts update --dry-run                 # runs the checks and says what would happen; writes and starts nothing
node bundle/geometer.ts update --to 0.2.0                # every client; without --to, the version in this checkout (templates/commerce/bookings/package.json)
node bundle/geometer.ts update --shops glow-salon,pet-spa    # just these two, in this order
node bundle/geometer.ts rollback                         # the clients the last update left on its version (moved, or found already there), back to the pin they had
node bundle/geometer.ts rollback --shops glow-salon      # or just this one (also: rollback glow-salon)
```

A version other than the one in this checkout needs its own folder beside the server, a checkout of its tag, laid out like this repository: `~/geometer-server/templates/commerce/bookings@0.2.0/`, with `~/geometer-server/modules/` beside `templates/`. (A server set up before the templates were grouped by domain keeps them at `~/geometer-server/pathways/bookings@0.2.0/`; those are still found.) A client whose new version is not there is held back and told where to put it. With no `--to`, a client that already runs a version **newer** than this checkout's is left as it is (it is never taken back); name the version with `--to` to move a client to an older one, which is a move like any other: hand-checked, and refused if the older version cannot read the saved data the newer one wrote (below).

For each client, in order:

1. The template's own hand check (`templates/commerce/bookings/scripts/hand-check.ts`, the same one that makes the go-live certificate) is run **on that client's settings** at the version it runs now, and again at the new version. Each says "Held N of M".
2. A client that holds everything that held before **moves**: its `pathway.lock` is changed and the same checked deploy as `geometer deploy` runs, so only what changed is restarted and the running Guards are asked again ("12 of 12 limits proven to bite").
3. A client with any situation that held before and now **fails, or is no longer run**, is **held back**: nothing about it is touched. A situation that failed on both versions does not hold it back (it is no worse off). A new situation that fails does.

```
Update, each client checked on its own settings first:
  ✗ bright-tuition  HELD BACK. Held 33 of 34 at bookings@0.2.0; 34 of 34 held at bookings@0.1.0. Now failing: Deposit link paid twice. It stays on bookings@0.1.0.
      - Deposit link paid twice: The customer was charged twice: ...
  ✓ glow-salon      moved from bookings@0.1.0 to bookings@0.2.0. Held 34 of 34 on its own settings (34 of 34 before). 12 of 12 limits proven to bite.
  = pet-spa         unchanged. Already on bookings@0.2.0.
  ✓ my-agent        moved from 4f9c2e1 to a81b30d. Held 10 of 10 on its own settings (10 of 10 before).

Moved 2, held back 1, unchanged 1, skipped 0.
```

The exit code is 0 when every client is moved, unchanged or skipped, and 1 when any is held back or the run did not finish. Fix what failed (or the client's settings) and run `update` again: it checks the held-back clients again.

**Where the pins are.** A client's version is its pin, the line in `shops/<shop>/pathway.lock`. The pins it had before are `lockHistory` in `state/state.json`; `rollback` takes the last one. `state.update` and `state.rollback` in the same file are the last run of each, client by client (what was decided, the two "Held N of M", the situations that failed, what the Guards proved). `status` and the panel's status file show the version that runs.

**Stopped in the middle.** Each step is written to the state file before the pin is touched. If the run stops (the machine, a deploy that was cut off), run the same command again: clients that are done are not checked or deployed a second time, and the one that was half-way is finished. A deploy that is **refused** puts that client's earlier pin back and stops the rollout there, so one client is affected at most; run the same command again to carry on with the rest. Another request (other `--to` or `--shops`) starts a new run.

**While a booking is in progress.** A move restarts that client's runtime, as any deploy does that changes it. The runtime saves each event before it answers and each step whole, so a booking in the middle picks up where it was; the other clients are not touched. What has been run: the template's tests stop a runtime between a payment link and its payment and finish the booking once after the restart, and the Docker proof restarts a runtime and its Guard with a refund held for the owner and finds it still held (see [Explanation.md](Explanation.md)). Not run: an update with a live booking in the middle.

**Rollback** is the same move the other way, through the same checks, and it takes the pin it goes back to off the history, so rolling back twice goes back twice and a rollback never moves a client forward unchecked. One thing stops it: a runtime cannot start on saved data written by a newer layout than it knows. If the new version changed the layout (the update says so in a note), `rollback` is refused before anything is touched, saying why; an `update --to` an older version is refused for the same reason. With no names, `rollback` takes the clients the **last update** left on the version it names and that have an earlier pin to go back to, so running `update` again to look at a held-back client does not empty that list. The way out is a newer version that fixes what went wrong, or `geometer restore` of the record from before the update, which loses what came in since.

**Editing in the panel does not move a client.** A client's settings can be changed in the panel as before; its pin is kept. Only `update` (and `rollback`) change a pin, after the hand check.

**Agents you wrote** (see below) have no template version and no hand check. Their version is whatever you say it is (`version` in `agent.json`: a git commit, an image tag), and their check is the crash test of your own agent ([below](#a-crash-test-for-your-agent)). For each one, `update` runs that crash test **on the agent's own settings at the version Geometer last recorded as in service, and again at the version in `agent.json`**, and decides as it does for a template: an agent that holds everything it held before is **moved** (recorded at the new version, with a new go-live certificate); one that now fails a situation it held, or no longer runs it, is **held back**, with the situation named, and the old version stays the one in service. Geometer does not run your agent, so nothing is deployed, and "held back" means: keep running the old version. An agent with no `run` command, or no `version`, is skipped, and the note says what to set. `rollback` has nothing to undo for an agent.

## Bring your own agent

You built an agent with Claude Code, Lovable, n8n or your own code. It takes bookings, collects deposits and refunds them. Geometer puts the same Guards in front of the services it calls, keeps the same record, asks the owner on WhatsApp before a big refund, and writes the same monthly report. **You change three web addresses and one key in your agent. Geometer does not host it, rebuild it or read its code.**

```sh
node bundle/geometer.ts agent add my-agent \
  --deposit 200 --refund-limit 100 --owner-whatsapp +919800000001 \
  --whatsapp-number-id 123456789012345 --calendar-id shop@group.calendar.google.com
```

`--upstreams razorpay,whatsapp,calendar` is the default (the services the templates use; a refund needs WhatsApp, because the owner is asked there). Without `razorpay` in `--upstreams` the shop takes UPI, and `agent add` asks for `--upi-id` and `--payee` (B71: a gateway is only ever what you chose). Instead of the flags, `--settings my-settings.json` takes the same settings file a template uses (`templates/commerce/bookings/clients/glow-salon.example/settings.json`), checked by the same validator. `add` starts nothing. It prints what your agent must use instead of the real services:

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

**What it does not do.** It does not host or rebuild your agent, and cannot make it behave: it can only stop what goes through the Guards and say what happened. Guard has no rule for prices or opening hours, so for an agent we did not write they are in the settings file (and in the report's policy digest) but nothing checks them. A call that does not go through the addresses above is not seen. Only Razorpay, WhatsApp and Google Calendar are covered; other services and the Claude Code plugin, n8n and Lovable doors are on the list of things not built ([Deferred.md](Deferred.md)). How it is built, and what was and was not run: [Explanation.md](Explanation.md), "Bring your own agent".

## A crash test for your agent

Before an agent goes live for a client, and before every new version of it, Geometer can try it on that client's own settings with services failing on purpose. It starts **your** agent with **your** command, puts the real Guards in front of stand-in Razorpay, Google Calendar and WhatsApp, plays the customer and the provider, and makes things go wrong. It changes nothing in your code beyond what `agent add` already asked of it: where it sends its calls.

```sh
node bundle/geometer.ts agent set my-agent --run "node /srv/my-agent/server.js" --version 4f9c2e1   # once; also --run / --version on `agent add`
node bundle/geometer.ts agent crash-test my-agent                       # "Held N of M"; --situations a,b for some; --details for every check; --json for data
node bundle/geometer.ts agent go-live my-agent --out ./certificate      # the same, and the go-live certificate (exports/my-agent/ as well, which `agent report` reads)
```

```
  Held 8 of 9.  1 failed.  8 not tested.  1 not run on these settings.
  ...
  ✓      Razorpay created the link but the reply was lost
  ✗      Razorpay made the refund but the reply was lost
        ✗ After the answer was lost the agent did not ask for the refund again
            Guard saw 3 more refund requests after the one whose answer was lost, and stopped all of them (hold): Razorpay was spared a second refund by Guard's at-most-once rule, not by the agent
  ...
  NOT TESTED   real WhatsApp, real Razorpay (test mode or live) and a real Google calendar (stand-in services ...) · ... · A refund above the limit ... (not run: the refund limit (₹300) is not below the deposit (₹200))
```

**The situations**, each in a new world (new stand-ins, new Guards, a new copy of your agent), each **judged only from what the stand-ins hold and what each Guard decided about each call your agent made, never from what your agent says**:

| Situation | Judged from |
|---|---|
| A normal booking (no faults; this is also how the crash test learns it can drive your agent) | One link for the deposit and the customer sent that link (Razorpay, the WhatsApp outbox); one payment on it; one confirmed calendar event; told "booked" once; nothing refunded |
| Razorpay created the link but the reply was lost | Razorpay holds one link, not two; Guard let one create request through; the customer was sent that very link |
| Razorpay made the refund but the reply was lost | Razorpay holds one refund; and **no refund request from your agent after the one whose answer was lost** (Guard's decisions). A repeat is stopped by Guard's at-most-once rule even with a new idempotency key, so the money check holds and the agent check does not: that is the point |
| Payment event arrives twice, the second one late | Still one calendar event, no second message to the customer, no second link, nothing refunded |
| Calendar saved nothing but said it was saved | No confirmed event; **Guard saw the agent read the calendar after writing it**; the customer was not told "booked" |
| Razorpay key expired | No link; a handful of tries at most; nothing held in the calendar; the customer got no link and no "booked" |
| A refund above the limit is held | Razorpay refunded nothing; Guard holds one request for the owner however often the agent sends it; the agent asked for the deposit and no other amount |
| Customer asks for more back than they paid | Razorpay refunded no more than was paid; the agent never asked for more (Guard's decisions); no message names the amount the customer asked for |
| Same WhatsApp message arrives twice | Still one link, no second create request at Guard, no second answer, no second calendar event |
| Customer pushes for a price below the floor | No link at any amount but the deposit (Guard's decisions, Razorpay's links); no message mentions the lower price |

One thing is read as words, and the output says which: whether a message to the customer says a booking is made. That is the WhatsApp stand-in's own record of what was sent, matched against your words (`driver.bookedWords`; "booked" or "confirmed" unless you say otherwise). It matches words, not meaning, so a message that says a booking could not be made should not use the words of the one that says it was.

A situation these settings cannot express is **named as not run** and is in neither count: with a refund limit that is not below the deposit, no refund of the deposit is above it. So is a situation your agent cannot be driven through (it takes no WhatsApp message at the path below; it asked for no refund when the customer wrote "cancel"). The reason is printed, and it is on the NOT TESTED line too. The crash test runs on the client's settings **as they are**; it never changes them to make a situation fit.

**What your agent has to be.** A program that listens on `PORT` and takes two webhooks, and answers 2xx when it has taken one:

| | |
|---|---|
| `POST /webhooks/whatsapp` | Meta's webhook, signed with the app secret (`X-Hub-Signature-256`). The customer's messages. |
| `POST /webhooks/razorpay` | Razorpay's webhook, signed with the webhook secret (`X-Razorpay-Signature`, event id in `X-Razorpay-Event-Id`). Needed for the payment-event situations. |

Its calls to the services go where `agent add` printed: it is started with these in its environment (the names `examples/own-agent/agent.js` reads; your run command is `sh -c`, so it can copy them into the names your agent reads: `RAZORPAY_BASE=$GEOMETER_RAZORPAY_URL node app.js`):

`PORT`, `GEOMETER_RAZORPAY_URL`, `GEOMETER_CALENDAR_URL`, `GEOMETER_WHATSAPP_URL` (a service your agent does not use has none), `GEOMETER_CREDENTIAL`, `CALENDAR_ID`, `PHONE_NUMBER_ID`, and what the crash test signs its webhooks with and a few facts from the settings: `GEOMETER_WHATSAPP_APP_SECRET`, `GEOMETER_RAZORPAY_WEBHOOK_SECRET`, `GEOMETER_DEPOSIT_INR`, `GEOMETER_PRICE_INR`, `GEOMETER_OWNER_WHATSAPP`, `GEOMETER_AGENT_VERSION`. `GEOMETER_RETRY_MS` (300) is how long to wait between two sends of a refund Guard is holding: your agent waits minutes in life; if it reads this variable it does not make the test wait for them. `GEOMETER_CRASH_TEST=1` says it is being tried; do not behave differently because of it.

**What the customer writes** is English by default: "I want to book", "Please cancel my booking", "Can you do it for ₹{offer}?", "Cancel my booking and refund my ₹{claim}". `{offer}` and `{claim}` are amounts on no price list. Your agent's own words, and the rest of the contract, go in `agent.json`, all optional:

```json
"run": "node /srv/my-agent/server.js --release {version}",
"version": "4f9c2e1",
"driver": {
  "cwd": "/srv/my-agent", "whatsappPath": "/hooks/wa", "razorpayPath": "/hooks/rzp",
  "says": { "book": ["hi", "a haircut tomorrow at 6pm"], "cancel": "cancel my booking", "haggle": "Rs {offer} only?", "refundMore": "cancel and give me back Rs {claim}" },
  "bookedWords": "\\b(booked|confirmed|done)\\b", "startSeconds": 20, "situationSeconds": 40
}
```

`{version}` in `run` is the version (also `GEOMETER_AGENT_VERSION`), so one command starts any version: `git worktree add ../my-agent-{version} {version} && ...`, or `docker run ... my-agent:{version}`. `--run` and `--version` on `agent crash-test` try one without recording it. The agent is started by `sh -c` in its own process group and stopped, with everything it started, when the situation ends.

**The geo-guard program.** The Guards are the real ones, so the crash test needs the `geo-guard` program: `--guard-bin <path>`, `GEO_GUARD_BIN`, `geo-guard` on the PATH, or, **on a Linux server that has the Guard image loaded, out of the image** (`docker create`, `docker cp`: the image is a static Linux program, and the server's image already matches its CPU). On a laptop without one, the message says so. About 35 seconds for ten situations on a laptop.

**The go-live certificate** has the template's format (so `agent report` reads it the same way: it must be signed with the server's key, and its checks must have run on this agent's settings), in English: "Held N of M situations. K failed. J not tested.", what did not hold, the limits Guard enforces for this agent, the list of what was not tested (the situations that could not be run here named in it), that it was run by hand against stand-in services with the real Guards in front, and the version of the agent. It is written whatever the result, and says what failed. The version is recorded as the one in service only when everything held.

An example agent that passes all ten is `bundle/examples/own-agent/server.js` (plain Node, no dependencies). `server-broken.js` is the same agent with one thing done wrong: when the answer to a refund is lost it asks again straight away with a new idempotency key. It fails that one situation and no other, and Razorpay still holds one refund because Guard held every repeat. Both are run by the tests.

## The licence

Each shop on your server is covered by a **licence lease**: a short signed note from Geometer's fleet service that says which shops are paid for and until when. It comes back with every heartbeat, and your server keeps the newest one. Nothing here talks to Razorpay: fleet decides what is paid.

**Set up once.** Fleet's operator gives you the public half of fleet's licence key (64 letters and digits; fleet prints it with `licence key show`). Pin it when you make the server folder:

```sh
node bundle/geometer.ts init /srv/geometer --domain shops.example.com ... --licence-key <the 64 characters fleet printed>
```

`init` prints the key's id; it should be the id fleet printed. A lease is only ever checked with this key, never with one that comes inside a lease. Without it, no lease is kept and no shop is ever paused by one. To add a second key while Geometer changes keys, add it to `"licence": {"keys": [...]}` in `geometer.json`.

**What a shop's owner and customers see.**

| Where the shop stands | Customers | The owner |
|---|---|---|
| In order, payment due, or overdue (days 0 to 29) | Nothing changes. | Nothing. The panel shows you the dates and a renew link. |
| **Wind-down** (from day 30) | A request to book (or to pay a fee) gets "Online booking is paused for now. Please contact the shop directly." Nothing is kept to do later. Refunds, cancellations, existing bookings and payments from links sent earlier still go through. | One plain notice on WhatsApp, in their language, naming the person who set the shop up. |
| **Final stop** (no earlier than day 60) | Nothing more is sent. Open payment links are cancelled; the shop's own accounts and keys stay the shop's. Payments already made are still recorded, and refunds still go through. **Nothing is deleted.** | One notice, in their language: online booking (or fee collection, or ordering) has stopped because the service from the person who set the shop up has ended; how many bookings (or fees, or orders) are still open; and that they can write to hello@geometer.dev to be connected with another local partner. It never talks about money or blames anyone, and it offers no copy of the records. |

**The records are for you, not the owner.** For 90 days after the final stop you (the builder or partner who serves the shop) can still download everything that is the shop's, from the panel or with `geometer export <shop>`. Nothing is sent to the owner automatically, and after a shop is moved (the panel's "Move this shop") the new partner gets the same download.

Paying at any point brings the shop back at once, at the next heartbeat. Nothing a customer asked during the wind-down is done by itself afterwards: they ask again.

**If your server is offline,** a paying shop keeps working: its lease covers it for about a month past its next invoice. A lease that runs out while nothing new arrives pauses new bookings at most; only a lease that says "stopped" stops a shop. Setting the server's clock back does not stretch a lease.

**If Geometer's fleet is down for a long time,** Geometer can send you an emergency extension (a file starting `gx1.`). Hand it in:

```sh
node bundle/geometer.ts licence extension extension.gx1
```

It is checked with the same pinned key. Until the date it names, no shop here pauses because its lease could not be renewed. It does not lift a pause or a stop that a lease states.

**Where it is kept:** `state/licence/` (the lease, `seen.json`, `extensions/`). `geometer status` shows each shop's licence line. The panel shows it on the shop's page, with the renew link and a note if the lease has not been refreshed for more than 2 days.

**Guard checks it too, with a new enough Guard image.** The shop's agent reads the lease and stops taking new work. A Guard image built from Guard's licence change (monorepo ADR-0062) or later, with fleet's key built into it, checks the same lease on its own:

- each shop's Guards (Razorpay, WhatsApp, Calendar; not the server's model Guard) get a `[licence]` block in their `guard.toml` and the folder `state/licence/`, read-only;
- in the wind-down they refuse a new payment link and a new calendar event with their own answer, `subscription_suspended`; in the final stop, a message too, except to the owner's number;
- refunds, cancellations, reads and changes to existing bookings always go through;
- an agent you run yourself (`geometer agent add`) is checked the same way, under its own name.

So a shop stays paused even if someone changes its agent or the agent's licence file. `deploy` asks the Guard image whether it reads the block: an older image gets none, and the deploy says so. After the start, each Guard must report the same key ids that `geometer.json` pins (`licence.keys`). If one does not, the deploy is refused and says which. The shop keeps running and nothing is stopped, because refunds owed must still go through. Write to support. A person answers.

## The owner's monthly report

On the first morning of the month each shop's agent sends its owner last month's report on WhatsApp, with a link to the full page. The bundle turns this on for every shop it deploys. You do nothing for it. Three things make it work, and all three come from the bundle:

- **The page opens.** Caddy serves each shop's report pages at `https://<your domain>/r/<shop>/<32 random letters and digits>/<file>`. It can read that one folder of the shop's data and nothing else of it, and only to read. The folder itself, the shop's folder, `/r`, and any other address under `/r` answer 404, so nobody can list the pages or guess their way to another shop's. The only secret in an address is the random part, so treat a link like a key: whoever has it can read that month's report.
- **The name.** "Set up by: Divya, local partner" comes from `shops/<shop>/report.json` if the shop has one (`shop add --prepared-by` writes it), otherwise from the panel's record of who made the shop (`owner.json`: "Divya, Sri Sai Digital" when that account gave a company or business name when it joined, else "Divya, local partner" or "Divya, builder"). With neither it says "your builder".
- **The Innovator badge.** On the message, the page and the certificate when Geometer's fleet service says the shop's builder or partner has it (`fleet/<shop>.json`). It follows what fleet says: a change redeploys the shop. The report you make from the panel carries the same name and badge.

Good to know:

- The first deploy after you update the bundle redeploys every shop once, because that is what writes the report setting into its config. The runtime restarts, as with any deploy.
- The report says **test money** unless the panel's connection check confirmed a **live** Razorpay account for the shop.
- A version of the template from before the report existed would refuse the setting and not start. So the bundle asks the version each shop is **pinned to** (its own checkout, beside the server for an older pin) whether it accepts the setting, writes it only if it does, and says so when it skips it. A client that `update` held back on an older version keeps working and gets no report until it moves. The same check now guards fleet's button mode.
- If you change the domain or the HTTPS port, run `deploy` again for each shop. The links already sent stay on the old address.
- Nothing has deleted old pages yet. Each month adds one small folder per shop.

## Backups

| Layer | How often | Where | Encrypted |
|---|---|---|---|
| Every runtime database, each Guard's own store and evidence ledger, and the shop's fingerprint key (inside the manifest) | every night, kept 30 days | your snapshot place: one object per database file, gzipped first | age, to the public key in `geometer.json`; the secret half is not on the server |
| Restore drill, on the server | every week | without the key: reads every object of each shop's newest snapshot back and compares its sha256 with what was uploaded; the copy passed SQLite's integrity check when it was made; its record is the start of the live record (same last entry, same hash chain) and matches the shop's published daily fingerprints | |
| Full restore test, by you | monthly, on your own machine | with your key: download the newest snapshot of one shop and open it (`node bundle/backup/restore-snapshot.ts <its folder> --identity <key file> --out <empty folder>`): every file is decrypted, unzipped and checked against its manifest | |

There is no continuous copy any more (since 9 November 2026): a shop's data in a snapshot is up to a day old. A WhatsApp shop's conversations are on the customer's and the owner's phones, every decision is in the hash-chained record and its daily fingerprint, and the providers keep their own records of payments, refunds and calendar events. A restored shop starts by looking at those (below), so a day-old snapshot does not send anything twice.

**What the backup costs.** One night writes a fixed number of objects per shop, whatever the shop holds: one per database file (the runtime and each Guard; a Guard's backup folder, ledger and all, goes up as one tar) and one manifest. So a shop with three Guards writes 5 objects a night, about **150 writes a month**, makes **one list** a night (about 30 a month), and, if its key may and the 30 days are full, deletes 5 a night (deletes are free on Google Cloud Storage, as remembered; with a create-only key the bucket's lifecycle rule does them, and the night says "pruning left to the bucket's lifecycle rule"). The weekly drill reads each object of the newest snapshot once, 5 reads a shop, and lists nothing. `bundle/test/backup-cost.test.ts` holds that count to the request, for an empty shop and one with thousands of records. At Google Cloud Storage's Class A price as remembered (about $0.005 per 1,000; to be checked against the pricing page) that is a small fraction of a rupee a shop a month, where the continuous copy measured about ₹410. Storage is the snapshots' gzipped size times 30.

**What the weekly drill can and cannot say.** The key that opens a snapshot is not on the server, so the drill does not open one. The snapshot job checks the plain copy before it encrypts it (SQLite's integrity check) and hands back a seal, kept in `state/snapshots/<shop>.json`: each object's sha256 as uploaded, and the copy's record (its length, a digest of its last entry and the head of its hash chain; no customer's words or numbers). The drill reads the objects back and compares them with the seal, and compares the seal's record with the live one and the published fingerprints. A bucket key that may not read makes a drill that could not complete, with the bucket's reason, and fleet alerts on it as on a failed drill. A shop with no snapshot yet (added since last night) is not drilled, and its heartbeat says nothing about a drill until it has one. Whether a snapshot really opens is the full restore test, done by you with your key, once a month.

**Restoring.** `restore <shop> --identity FILE [--at TIME]`, with your key brought to the server for the restore (take the key file away again afterwards), fetches the newest snapshot at or before the time (the newest of all without one), checks it against its manifest and SQLite's integrity check while the shop still runs, then stops only the shop's runtime, puts the file in place (the one it replaces is kept as `agent.db.before-restore-<time>`) and starts it. The runtime then starts in its restored mode before it does anything else: every id moves on by 100,000 (so a new booking can never take an id used after the snapshot, and with it another customer's payment link or calendar event), a `restored` entry goes into the record, and every payment link, refund and calendar write is looked up at the provider before anything is sent (a refund already on Razorpay's list is recorded as made, not sent again; Guard's own store, which a restore does not touch, refuses a second refund of the same payment too). What happened after the snapshot is not in the shop's record, and if the restored record is shorter than the last daily fingerprint, the fingerprint and the drill will say from then on that the record no longer matches what was published ([Deferred.md](Deferred.md)). A Guard's own store is not put back by `restore`; the snapshot has its files (`geo-guard restore`, with the Guard stopped). The shop's fingerprint key (`secrets/person-keys/<shop>`, which matches a person to the record's fingerprints) travels in the snapshot's encrypted manifest, and `restore` puts it back before the runtime starts: on a new machine, where the first deploy made a new key, the snapshot's key replaces it and the new one is kept beside it. `restore` needs a bucket key that may read and list. On a machine with your key, `node bundle/backup/restore-snapshot.ts <one snapshot's folder> --identity <key file> --out <empty folder>` opens a downloaded snapshot, old or new, and checks every file against its manifest. The fingerprint key comes out as `person_key`.

A failed drill, or a snapshot that did not happen, shows in `status` and in `status/<shop>.json` (`backups`). The record and bookings the panel's monthly report reads are exported every quarter of an hour to `exports/<shop>/`.

The heartbeat carries two optional facts per shop, so a snapshot that stopped or a drill that failed alerts from outside the server: the age of the last good snapshot (alert after 36 hours) and the age and verdict of the last drill (alert if it failed, or after 8 days without one). It sends ages and a yes/no, never the drill's reason (that stays in `status`). Geometer's fleet service must be new enough to know these two fields before a bundle sends them; an older one refuses every heartbeat as malformed. A shop whose very first snapshot never succeeds sends nothing about backups until one does (see [Deferred.md](Deferred.md)).

The heartbeat also carries **the cost meter's counts** per shop (messages by understanding step, model spend in micro-rupees, WhatsApp by type), as a difference since the last heartbeat fleet accepted. Fleet answers with each shop's plan, its allowance, whether its owner is an innovator, and `ai: "buttons"` when the partner's recharge cannot cover the shop's messages above its allowance; the deployer then writes `"ai": "buttons"` into that shop's generated runtime config (only when the template knows the setting; see [Explanation.md](Explanation.md)). Once a shop's model spend reaches the month's AI cap, fleet answers `model: "off"` and the deployer writes `"model": "off"` the same way: the language model is left out until the 1st, and the rules and the decision model keep answering. Deploy a fleet that knows these before a bundle that sends them.

## The folder, for the panel

```
<server>/geometer.json            this server (written by init)
<server>/fleet_key                this server's deployment key (0600; `pair` writes it, or you put the key Geometer gave you here); the ops container gets a copy
<server>/pairing.json             what pairing gave besides the key: the server's id, fleet's address and licence key, the trial lease (no secret; `pair` writes it)
<server>/state/install.json       which release install.sh installed, when, and whether the first sign-in link was made (no secret)
<server>/shops/<shop>/            settings.json, runtime.json, pathway.lock, owner.json (account name, optional company, role), pins.json   the panel writes; the deployer applies
<server>/shops/<shop>/report.json  {"schema": 1, "preparedBy": "Divya, local partner"}: who the owner's monthly report says set the shop up (optional; wins over owner.json; `shop add --prepared-by Divya --company "Sri Sai Digital"` writes "Divya, Sri Sai Digital")
<server>/secrets-inbox/<shop>/    razorpay_key ("<key id>:<key secret>"), whatsapp_token, ...        the panel writes, mode 0600; the deployer moves and deletes
<server>/requests/<shop>.stop.json  a request to stop a shop                                          the panel writes; the deployer acts, shows it in status, removes it
<server>/status/<shop>.json       deploy, limits {proven, of, unprovable}, versions, stopped, backups  the deployer writes; the panel reads
<server>/exports/<shop>/          record.json and bookings.json, customers as keyed fingerprints     the deployer writes; the panel's monthly report reads
<server>/fleet/<shop>.json        fleet's last answer: plan, allowance, innovator, ai, model, warn    ops writes (the one folder it can write); the deployer and the panel read
<server>/fleet/usage-baseline.json  the cost meter's counts fleet has accepted                         ops writes and reads, so a restart does not replay history
<server>/panel/                   the panel's own data
<server>/state/                   the deployer's memory (Guard bundle versions, who stopped a shop, lock history, the last update and rollback step by step)
<server>/generated/               compose.yaml, Caddyfile, per-container config: rewritten on every deploy, never edited
<server>/secrets/                 one folder per container; secrets/person-keys/<shop> (0600) is the shop's fingerprint key: the export and snapshot jobs read it, and the panel keeps a copy
```

**The panel** is a container named `panel` that runs `bundle/panel/main.ts` (set `"panel": {"enabled": true, "mode": "own"}` in `geometer.json`, or `--panel` at `init`; Geometer's partner server uses `"mode": "hosted"`). It is served at the root of your domain (the inbox keeps `/c/...`). It is mounted with exactly the folders above that it writes or reads, plus `geometer.json` read-only: **not** `secrets/`, `state/` or `generated/`, no Docker socket. It runs as the user who runs the deployer, because it insists on keeping its keys and the files it writes private to its user (0600); a deployer run as root hands those files to uid 1000 and the panel runs as that. Its keys are made for it in `secrets/panel/`: `data_key` (32 random bytes as hex, which encrypts what it keeps), `signing_key` (an Ed25519 private key in PEM, which signs the go-live certificate) and `guard_agent_token` (below).

The panel reaches each shop's Razorpay, WhatsApp and Calendar Guards on a network of its own that carries nothing else (no runtime, no model Guard, no admin port, no inbox). At each Guard it presents its own agent, `panel-<shop>`, which that Guard allows **its connection-check reads and nothing else**: `list_links` at Razorpay, `read_number` at WhatsApp (`GET /{version}/{phone_number_id}`) and, at Calendar, `get_calendar` (`GET /calendar/v3/calendars/{calendarId}`) and `list` (`GET .../events`, which the panel asks for one event of, because that is where Google says whether the account can write). Each is pinned to the shop's own id like the routes beside it. The panel reads **one** token file and presents it to every Guard, so there is one token, `secrets/panel/guard_agent_token`, mounted only into the panel; every Guard keeps its hash under its `panel-<shop>` agent. Without these the panel's "Ready to go live" cannot pass in production.

The first builder's way in is `node bundle/geometer.ts panel invite --role builder` (it asks the running panel for a one-time link; in hosted mode this is the only way to make an invitation). `--role partner` is for a partner's account.

**Unfinished work, handing a shop on, taking its files out (7 Nov).** The panel's "To do" tab lists, across the shops a person can see, the real jobs that need a person (a deposit with no confirmed booking, a refund waiting or of unknown outcome, an answer from the owner that has waited too long; `PANEL_APPROVAL_WAIT_HOURS`, default 12), each as one plain sentence with the recovery buttons that fit it; a button files a request that the deployer carries to the shop's agent, which looks again or asks again through Guard and the normal limits and never sends a refund again. A shop moves to another partner or builder only after the owner sends a one-use code from their own number (the panel's "Move this shop"), with the reason kept and never to Geometer; the shop's WhatsApp, payment and calendar accounts stay the shop's and no key is carried across. `geometer export <shop> [--out <folder>]` (and the shop page's download) writes everything that is the shop's in open files with a manifest of sha256 values, a README, no key or secret, and works for a stopped shop and a lapsed plan; it is for the builder or partner (the panel's sign-in or the server's command line), and is never sent to the owner; check one with `node bundle/export/check.ts <folder>`. Details: `bundle/panel/Explanation.md`; what is left: `Deferred.md`.

`pins.json` (the ids the panel's connection checks confirmed) is used for the exact allowlists when it is there, and for the runtime too, so the two always agree; a changed pin is a new version of that Guard's bundle. A Razorpay key handed in that is not the key id the check confirmed, or of the other mode, is refused by name. With no `google_service_account.json` in a shop's inbox, the server-wide key (`node bundle/geometer.ts google-key <file>`) is used, which is how Geometer's hosted server works; the panel is told its address so it can say who to share a calendar with.

`status/<shop>.json` is the panel's own shape (`bundle/panel/contract.ts`, `parseStatus`): `updatedAt`, `deploy {state, at, message}`, `limits {proven, of, unprovable}`, `versions`, `stopped {at, requestId}`, `backups`. `updatedAt` is the last time the deployer confirmed the shop **from its running Guards**; while `apply --watch` runs it is refreshed every minute if the runtime and all three Guards answer, and is left alone when one does not, so the panel shows "Not confirmed yet" rather than a stale "live". A failed tripwire is written at once (fewer limits proven than there are).

`check <shop>` runs the generator's checks offline. Once the shop has been deployed (and the server has a panel) it also runs the panel's read-only connection checks, **inside the panel container** (`services/connection-check.ts`: it calls the same function the panel's "Run the checks" button does, so the panel shows what it found, and **when all of them confirm it writes `pins.json`**: the next `deploy` or `apply` then pins the Guards to the confirmed ids, so after a deploy `check` is no longer read-only on the shop's files). A check the panel cannot make yet (a shop made with `shop add` has no business number in the panel) is reported as "NOT RUN", not as a failure. It has to be there: only the panel is on the network the Guards' agent ports are on, and only it has the token. Before the first deploy there are no running Guards to ask, so it says "not run" and why; deploy, then run `check` again.

## Running it on your laptop

Docker Desktop works for a trial (use `--domain localhost` and `--http-port 8080 --https-port 8443`; Caddy makes its own certificate). The test of the whole server on real Docker is `bundle/test/proof/run.ts`. It needs `node:26-alpine`, Caddy, MinIO, and a Guard image that reads `[licence]` with RFC 8032's published test key built in (`GUARD_IMAGE`, default `geo-guard:local-b14`; that key is for tests only). It runs every bundle container inside one cgroup capped at 2 CPUs and 4 GiB. At 1, 5, 10 and 25 shops it takes about an hour; `--only <phase,...>` runs some phases. The ordinary tests (`cd bundle && npm test`) need no Docker.
