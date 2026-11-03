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
# Node 26 (any way you like; this one needs nothing else)
curl -fsSL https://nodejs.org/dist/latest-v26.x/node-v26.10.0-linux-x64.tar.xz | sudo tar -xJ -C /usr/local --strip-components=1
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
node bundle/geometer.ts backup-key stream ~/stream-key.txt           # access-key-id:secret
node bundle/geometer.ts backup-key snapshots ~/snapshots-key.txt
```

**6. Add the first shop.** A client folder has `settings.json`, `runtime.json` and `pathway.lock` (see `pathways/bookings/clients/glow-salon.example`). In `runtime.json` the panel (or you) names the shop's own WhatsApp number id and Google calendar; the bundle sets everything about where things are.

```sh
node bundle/geometer.ts shop add glow-salon --from ~/clients/glow-salon
mkdir -p $GEOMETER_SERVER/secrets-inbox/glow-salon      # then put the secrets in it, one file each (below)
node bundle/geometer.ts check glow-salon                # changes nothing; says what is wrong, all at once
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
node bundle/geometer.ts rollback glow-salon   # the previous pathway.lock, deployed through the same checks
node bundle/geometer.ts restore glow-salon --at 2026-11-04T10:30:00Z    # the record as it was, from the continuous copy
```

**Upgrading a shop** is changing its `pathway.lock` after the crash test has passed with that shop's own settings. A version other than the current one needs a checkout beside the server: `~/geometer-server/pathways/bookings@0.2.0/`. `rollback` puts the previous lock back.

## Backups

| Layer | How often | Where | Encrypted |
|---|---|---|---|
| Every runtime database | about every second | your stream bucket, by Litestream | by your bucket and TLS. **Not age**: Litestream 0.5 no longer supports client-side encryption; see [Explanation.md](Explanation.md) |
| Every runtime database, and each Guard's own store and evidence ledger | every night, kept 30 days | your snapshot place | age, to the public key in `geometer.json` |
| Restore drill | every week | restores the continuous copy into a scratch folder, checks integrity, compares the last record entry with the live record | |

A failed drill, or a snapshot that did not happen, shows in `status` and in `status/<shop>.json`. It cannot yet reach Geometer's alerts: the heartbeat has no field for it (see [Deferred.md](Deferred.md)).

Restoring a snapshot needs the secret half of the age key, which is not on the server: `restore` uses the continuous copy; a snapshot is decrypted on the machine that has the key.

## The folder, for the panel

```
<server>/geometer.json         this server (written by init)
<server>/shops/<shop>/         settings.json, runtime.json, pathway.lock           the panel writes; the deployer applies
<server>/secrets-inbox/<shop>/ razorpay_key, whatsapp_token, ...                    the panel writes (write-only in spirit); the deployer moves and deletes
<server>/status/<shop>.json    last deploy, "N of M limits proven", versions, last backup and drill   the deployer writes; the panel reads
<server>/state/                the deployer's memory (Guard bundle versions, who stopped a shop, lock history)
<server>/generated/            compose.yaml, Caddyfile, per-container config: rewritten on every deploy, never edited
<server>/secrets/              one folder per container
```

The panel is a container named `panel` that runs `bundle/panel/main.ts` (when it exists, set `"panel": {"enabled": true}` in `geometer.json`). It gets the shops folder and the secrets inbox to write, the status folder to read, and a route at `/panel/`. It gets no Docker socket and no secrets folder. `check` calls `connectionChecks({ serverDir, shop })` exported by `bundle/panel/checks.ts` when that file exists, and says plainly that the read-only connection checks were not run when it does not.

## Running it on your laptop

Docker Desktop works for a trial (use `--domain localhost` and `--http-port 8080 --https-port 8443`; Caddy makes its own certificate). The test that proves the architecture is `bundle/test/proof/run.ts`; it needs the Guard image, `node:26-alpine`, Caddy, Litestream and MinIO, and takes about twenty minutes. The ordinary tests (`cd bundle && npm test`) need no Docker.
