// geometer: the deploy bundle's command line.   node bundle/geometer.ts <command> [--server <folder>]
//
//   init <folder> --domain D --reviewed-by ID --licence-key HEX[,HEX] [--model-wire openai|anthropic --model NAME] [--fleet-url U --fleet-key-file F] [backup options]
//                                --model may be left out until the first shop (the panel's first run asks for it); a deploy refuses until it is chosen.
//                                --licence-key: the public half of fleet's licence key, as fleet's `licence key show` prints it (64 hex characters); pairing the server gives it.
//                                It is pinned in geometer.json, and a lease is only ever checked with it. Required (decision 39, monorepo ADR-0070): a release's Guard runs a
//                                builder's shop only under Geometer's lease, so a server without the key could run no shop. Tests and the Docker proof pass RFC 8032's published
//                                test key, the one their Guard image is built with.
//   init <folder> --pairing --domain D --reviewed-by ID [--guard-licence-kid KID] ...   the same, with this server's id, fleet's address, the deployment key and fleet's licence
//                                key taken from what `pair` kept in the folder, and the trial lease taken in. --guard-licence-kid: refuse when fleet's licence key is not the
//                                one built into the Guard image (bundle/release.json names it), since every shop's deploy would be refused then. A pairing that brought no
//                                licence key is refused like a missing --licence-key.
//                                --pages-domain D [--pages-extra D2,D3]: Geometer's partner server only (panel mode hosted, with fleet): this server answers for the pages domain
//                                (streetlist.in) with the front door, and serves the Streetlist home there (home, below). The extra domains are redirected to D.
//   home pack <streetlist folder> [--out F] [--commit ID]   make the one file that carries a built Streetlist site (on your machine, after `npm run build` there)
//   home install [<file or https address>] [--sha256 HEX]   check a pack against the pin (bundle/home.json), install it beside the one served and switch to it, atomically
//   home rollback | home status   go back to the build before; say what is served and what is pinned
//   pair <folder> --fleet-url U  pair a NEW server with Geometer's fleet: reads the one-time code from your account page (geometer.dev/account, "Add a server") on
//                                standard input, never from the command line, exchanges it once, and keeps the answer in the folder (fleet_key, 0600, and pairing.json).
//                                install.sh runs this, then `init --pairing`. On a folder set up with pairing skipped (geometer.json with no "fleet" section) it pairs
//                                late: every local check first, the code sent once, then only a `fleet` section is added (the folder keeps its own id; fleet's goes in
//                                fleet.deploymentId) and the trial lease taken. A pairing kept but not added is added by running it again, with no new code.
//   model-key <file>             the model's API key, handed to the model Guard only
//   speech-key <file>            the speech provider's key (voice notes, B29), handed to the speech Guard only
//   google-key <file>            one Google service-account key for every shop that hands in none of its own (hosted mode)
//   gupshup-token <file>         the Gupshup partner's Universal Token (follow-up 2): the token refresher mints and renews each Gupshup shop's app token with it, for every
//                                Gupshup shop that hands in no static gupshup_authorization. Only on a server run by that Gupshup partner: it acts for every app linked
//                                to the partner. It lasts at most 60 days; hand in a new one before then (the panel's to-do list says when).
//   shop add <name> --from <client folder> [--prepared-by "Divya, local partner" | --prepared-by Divya --company "Sri Sai Digital"]      copy a client folder in (settings.json, runtime.json,
//                                pathway.lock); --prepared-by is the name the owner's monthly report message says set the shop up (written to report.json; without it the message says "your
//                                builder"). With --company, --prepared-by is the person's name alone and the message says "Divya, Sri Sai Digital".
//   shop add <name> --template bookings|fees|orders (--upi-id ID --payee "Name" | --payment razorpay | --settings F) [--whatsapp-number-id ID] [--calendar own|google] [--calendar-id ID] [--prepared-by ... [--company ...]]
//                                start a shop from a template of this checkout: its example settings (or the file --settings names, checked first), a pin to the template's version here, and a
//                                runtime.json that names the WhatsApp number (and, for a template with a calendar, the calendar). The settings start as the template's made-up example: change
//                                them to the real ones. How customers pay is never the example's (B71): the shop's own UPI ID, the default, or --payment razorpay for its own gateway account.
//   check <shop>                 settings, pin, secrets, the generator's rules, compile and every tripwire, offline. Starts nothing. Once the shop is deployed it ALSO
//                                runs the panel's read-only connection checks (WhatsApp number, Razorpay key, calendar) inside the panel container; when they all confirm
//                                the panel records the ids in shops/<shop>/pins.json, and the next deploy or `apply` pins the Guards to them.
//   agent add <name> [--settings F | --deposit N --refund-limit N --owner-whatsapp +91...] [--upstreams upi|razorpay|own-api,whatsapp,calendar] [--upi-id ID --payee "Name"]
//                    [--gateway-draft D --gateway-accept A --gateway-upstream host:port] [--whatsapp-number-id ID] [--calendar-id ID] [caps...]
//                                put Guard in front of the services an agent SOMEONE ELSE wrote calls (no hosting, no rebuild); prints the addresses it must use instead, and where its
//                                credentials are (one per Guard, in secrets/agents/<name>/credentials.env; never printed)
//   agent check|deploy|show <name>      the same checks and checked deploy as a shop's; show prints the addresses again and where the credentials are (never a credential)
//   agent rotate <name> [--guard <kind>] [--overlap-minutes N]   a new credential for each Guard (or one), handed to the agent through secrets/agents/<name>/credentials.env;
//                                the old one keeps working for 15 minutes (or N, 0 to 1440), then stops at the Guard. Nothing is printed.
//   agent remove <name> [--force]   stop its Guards and take it off this server; its record, settings and last snapshot are kept (where is printed), its credentials are
//                                revoked, nothing is deleted. Refused while a call is held for the owner or work is unfinished, unless --force.
//   agent record <name>          the record of what the agent did, built from its Guards' own decisions and the services' own state (the deployer also does this every five minutes)
//   agent report <name> --month 2026-11 --out <folder> [--language en]      the monthly report and certificate from that record
//   agent crash-test <name> [--situations a,b] [--run "<cmd>"] [--version V] [--details] [--json]      start the agent with its own command and try situations that could go wrong, through the
//                                real Guards: "Held N of M", judged from the stand-ins' records and Guard's decisions. agent go-live <name> [--out <folder>] does the same and writes the go-live certificate.
//                                agent set <name> --run "<cmd>" --version V   records how to start the agent ({version} in the command) and which version it is at
//   panel invite --role builder|partner [--note T]     a one-time invitation link from the running panel (the first builder's way in; hosted mode has no other)
//   invite builder|partner [--note T]                  the same, shorter
//   panel confirm-link --kind limits|go-live --shop S [--changes JSON] [--note T]    a one-time link a person opens in the panel to confirm what Claude Code asked for (the plugin, B11); it only asks
//   export <shop> [--out <folder>]    everything that is the shop's, in plain open files, as a folder and a .tar.gz: settings, limits and their history, the record (JSON lines), reports,
//                                certificates, a manifest with each file's sha256 and a README. No key or secret is in it. It reads files only, so it works for a stopped shop and a lapsed plan.
//                                Check one with: node bundle/export/check.ts <folder>
//   paper dispute <shop> --case b-3 [--lang en] [--out <folder>]   the signed record of one booking or fee (B35), side by side, in the shop's language; never who is right
//   paper identity <shop> [--lang en] [--out <folder>]              the agent's identity paper (B36), full and public (the fields in shops/<shop>/identity.json "public")
//   paper ledger <shop> [--out <folder>]                            the record as geometer-verify's evidence pack, and the anchor over today's head (B28)
//                                The panel makes them (it holds the signing key and the papers); a person's statement is made in the panel only.
//   fingerprints                 the daily fingerprint of every shop's record, now (it also runs once a day by itself): local file always; git and OpenTimestamps only
//                                when <server>/fingerprints.json turns them on with the owner's yes
//   licence lease <file>         a lease from Geometer (gl1.), given by hand (a server set up with --fleet-key-file has none until its first heartbeat brings one):
//                                checked with the pinned key, for this server, newer than the one kept
//   licence extension <file>     an emergency extension from Geometer (gx1.), checked with the pinned key and kept: until it ends, no shop here winds down because fleet could
//                                not renew its lease. It never lifts a wind-down or a stop the lease states.
//   deploy [shop]                check, then bring up only what changed, then read the running Guards
//   up                           bring up the server's own services (HTTPS, the panel, the heartbeat) before any shop exists; install.sh ends with it. Once a shop is
//                                deployed, `deploy` is what brings things up.
//   server status [--wait S]     every container of this server and how it is; --wait: until the panel and HTTPS are up, at most S seconds
//   server stop --confirm        stop EVERY container on this server: no shop answers customers until `server start`. Without --confirm it only says what it would stop.
//                                (Not the same as `stop <shop>`, the kill switch for one shop.) The `geometer` command install.sh writes also stops the deployer first.
//   server start                 start them again as they were (a server with no shop yet: the same as `up`)
//   status                       every shop: running or not, what its Guards enforce, the last snapshot and drill
//   stop <shop> [--reason T]     the Guard kill switch: nothing goes out. The record says who stopped it.   start <shop> releases it.
//   restore <shop> --identity FILE [--at TIME]   put the shop's runtime database back from the newest nightly snapshot (at or before TIME, if given). FILE is the
//                                owner's age key, which is kept off the server: bring it for the restore and take it away after. The shop is then up to a day behind:
//                                before it sends anything it moves its ids on and looks at the payment service and the calendar. For an agent someone else wrote,
//                                its Guards' stores, its record and its key go back (the Guards are stopped only after the snapshot has been checked and tried)
//   update [--to V] [--shops a,b] [--dry-run]   move clients to a new template version, one at a time, each hand-checked on its own settings first; a client with any situation
//                                that held before and fails now is held back with the reason. Stopped half-way, the same command again carries on. --dry-run changes nothing.
//   rollback [<shop> | --shops a,b]   back to the previous pathway.lock, deployed through the same checks; with no name, the clients the last update moved
//   logs <shop> [--tail N]       a shop's runtime and Guards;   logs [--tail N] with no shop: the server's own services (the panel, HTTPS, the heartbeat, the inbox, the relay)
//   apply [--watch]              the host-side deployer: applies what the panel writes, running the same checked deploy
//   whatsapp-templates <shop> [--submit | --status] [--template bookings|orders|fees] [--languages hi,en] [--only name1,name2]
//                                put the shop's WhatsApp templates (about 130 messages in four languages) into ITS OWN Gupshup account, instead of typing them into Gupshup's dashboard.
//                                Plain steps: 1. the shop is set up on its own Gupshup account (runtime.json has the app name; add "appId" under services.messaging, shown on the app's page).
//                                2. Give the key for this one command: GUPSHUP_APIKEY=... node bundle/geometer.ts whatsapp-templates <shop> --server <folder>   (or it is read from the shop's
//                                secret file once `gupshup_apikey` is handed in); never type it as an argument. 3. Run it as it is: a DRY RUN prints exactly what would be sent and sends nothing.
//                                4. Try one first: add --submit --only <name> --languages en, then --status. 5. Then --submit for all; a template already pending or approved is skipped, so
//                                running it again is safe. 6. --status lists each one's state; Meta approves in up to a day. A rejected one is left alone and flagged. Not tried against the real service.
//   backup now | drill           the nightly snapshot and the weekly restore drill, once
//
// The deployer is the only process with the Docker socket. The panel never gets it.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { applyOnce, runLicence, watch } from "./apply.ts";
import { applyServerSettings } from "./server-settings.ts";
import { takeExtension, takeLease } from "./lib/licence.ts";
import { joinPairing, latePairingProblem, pairServer, pairingPaths, readPairing } from "./lib/pairing.ts";
import { GUPSHUP_UNIVERSAL_TOKEN_FILE } from "./generate/configs.ts";
import { jwtExpiryMs } from "./services/gupshup-tokens.ts";
import type { PairingFile } from "./lib/pairing.ts";
import { kidOf } from "../modules/licence/token.ts";
import { runBackup, runDrill, restoreAgent, restoreShop } from "./backup/jobs.ts";
import { generateIdentity } from "./backup/age.ts";
import { NO_LICENCE_KEY, Refused, checkShop, compose, composeFile, deploy, ops, upServer } from "./deploy.ts";
import type { Context } from "./deploy.ts";
import { addAgent, checkAgent, connectionOf, connectionText, deployAgent } from "./agent/deploy.ts";
import { listAgents, readAgent } from "./agent/folder.ts";
import type { AgentFlags } from "./agent/folder.ts";
import { CRASH_SUBCOMMANDS, crashCommand } from "./agent/crash-test/cli.ts";
import { MANAGE_SUBCOMMANDS, manageCommand } from "./agent/manage-cli.ts";
import { recordAgent } from "./agent/records.ts";
import { exportCommand } from "./export/cli.ts";
import { homeCommand } from "./home-cli.ts";
import { whatsappTemplatesCommand } from "./whatsapp-templates-cli.ts";
import { paperCommand } from "./backup/papers-cli.ts";
import { runFingerprints } from "./backup/fingerprints.ts";
import { writeAgentReport } from "./agent/report.ts";
import { dockerGuardTool } from "./generate/verify.ts";
import { exitCodeOf, runRollback, runUpdate, summary } from "./update.ts";
import { realRunner } from "./lib/runner.ts";
import { INTAKE, secretFile, writeModelKey, writeSecretFile, writeSpeechKey, prepareSecretsRoot } from "./lib/secrets.ts";
import { DEFAULT_APP_IMAGE, DEFAULT_GUARD_IMAGE, DEFAULT_PREPARED_BY, NO_MODEL, fleetIdOf, listShops, loadServer, modelChosen, parseServer, publicUrl, serverNotes, serverPaths } from "./lib/server.ts";
import { guardsOf, kindFor } from "./lib/kinds.ts";
import { COMPANY_LIMIT, companyOf, parseReportFile, preparedByOf } from "./panel/contract.ts";
import { discoverTemplates } from "./panel/templates.ts";
import { loadState, saveState } from "./lib/state.ts";
import { readStatus, updateStatus } from "./lib/status.ts";
import { ensureDir, hostId, serverIdProblem, shopNameProblem, stableJson, writeAtomic } from "./lib/util.ts";

const APP_DIR = resolve(dirname(new URL(import.meta.url).pathname), "..");

// Builds the real context (docker, clock, logger, Guard tool) for a server folder; tests pass overrides to swap any of it for fakes.
export function makeContext(dir: string, overrides: Partial<Context> = {}): Context {
  const docker = process.env.GEOMETER_DOCKER ?? "docker";
  return {
    dir: resolve(dir), appDir: APP_DIR, runner: realRunner, log: (line) => console.log(line), now: () => new Date(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)), docker,
    tool: dockerGuardTool(loadServerImage(dir), realRunner, join(serverPaths(dir).state, "work"), docker),
    ...overrides,
  };
}

function loadServerImage(dir: string): string {
  try { return loadServer(dir).guardImage; } catch { return DEFAULT_GUARD_IMAGE; }
}

const refusal = (e: Refused): string => `\nThis was refused, and nothing was started or changed:\n${e.problems.map((p) => `  - [${p.rule}] ${p.message}`).join("\n")}`;

function serverDir(values: { server?: string }): string {
  const dir = values.server ?? process.env.GEOMETER_SERVER ?? (existsSync("geometer.json") ? "." : undefined);
  if (!dir) throw new Error("Say which server folder: --server <folder> (or set GEOMETER_SERVER, or run this inside it).");
  return resolve(dir);
}

// The command line entry: parses arguments, runs the command and returns the process exit code instead of exiting, so tests can call it directly.
export async function main(argv: string[], overrides: Partial<Context> = {}): Promise<number> {
  const [command, ...rest] = argv;
  const { values, positionals } = parseArgs({
    args: rest, allowPositionals: true, strict: false,
    options: {
      server: { type: "string" }, domain: { type: "string" }, id: { type: "string" }, "reviewed-by": { type: "string" }, "model-wire": { type: "string" }, model: { type: "string" },
      "fleet-url": { type: "string" }, "fleet-key-file": { type: "string" }, "licence-key": { type: "string" }, "guard-image": { type: "string" }, from: { type: "string" }, template: { type: "string" }, reason: { type: "string" }, at: { type: "string" },
      tail: { type: "string" }, watch: { type: "boolean" }, interval: { type: "string" }, "stream-url": { type: "string" }, "stream-endpoint": { type: "string" }, "snapshots-url": { type: "string" }, // stream-*: only to say they are no longer used
      "snapshots-endpoint": { type: "string" }, "age-recipient": { type: "string" }, "age-identity-out": { type: "string" }, "from-snapshot": { type: "string" }, identity: { type: "string" },
      kind: { type: "string" }, shop: { type: "string" }, changes: { type: "string" }, pairing: { type: "boolean" }, "guard-licence-kid": { type: "string" }, wait: { type: "string" }, confirm: { type: "boolean" },
      "prepared-by": { type: "string" }, company: { type: "string" }, "upi-id": { type: "string" }, payee: { type: "string" }, payment: { type: "string" }, role: { type: "string" }, note: { type: "string" }, "approval-hours": { type: "string" }, "http-port": { type: "string" }, "https-port": { type: "string" }, panel: { type: "boolean" }, "panel-mode": { type: "string" },
      // agent add / report
      settings: { type: "string" }, upstreams: { type: "string" }, "owner-whatsapp": { type: "string" }, "owner-language": { type: "string" }, "business-name": { type: "string" }, deposit: { type: "string" }, "refund-limit": { type: "string" },
      "price-floor": { type: "string" }, hours: { type: "string" }, timezone: { type: "string" }, "whatsapp-number-id": { type: "string" }, "calendar-id": { type: "string" }, calendar: { type: "string" }, "forward-whatsapp-to": { type: "string" },
      "gateway-draft": { type: "string" }, "gateway-accept": { type: "string" }, "gateway-upstream": { type: "string" },
      "refund-inr-per-day": { type: "string" }, "refunds-per-day": { type: "string" }, "links-per-hour": { type: "string" }, "messages-per-hour": { type: "string" }, "events-per-hour": { type: "string" }, "events-deleted-per-day": { type: "string" },
      credential: { type: "boolean" }, month: { type: "string" }, out: { type: "string" }, language: { type: "string" }, source: { type: "string" }, case: { type: "string" }, lang: { type: "string" },
      // agent crash-test / go-live / set (and --run, --version on agent add)
      run: { type: "string" }, version: { type: "string" }, situations: { type: "string" }, "guard-bin": { type: "string" }, json: { type: "boolean" }, details: { type: "boolean" },
      // agent rotate / remove
      guard: { type: "string" }, "overlap-minutes": { type: "string" }, force: { type: "boolean" },
      // update / rollback
      to: { type: "string" }, shops: { type: "string" }, "dry-run": { type: "boolean" },
      // home install / pack, init
      languages: { type: "string" }, only: { type: "string" }, submit: { type: "boolean" }, status: { type: "boolean" },
      sha256: { type: "string" }, commit: { type: "string" }, "pages-domain": { type: "string" }, "pages-extra": { type: "string" },
    },
  }) as { values: Record<string, string | boolean | undefined>; positionals: string[] };
  const str = (k: string) => (typeof values[k] === "string" ? values[k] as string : undefined);

  try {
    if (!command || command === "--help" || command === "help") { console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n")); return command ? 0 : 2; }

    if (command === "init") return await init(positionals[0], values as Record<string, string | boolean | undefined>);
    if (command === "pair") return await pair(positionals[0], str("fleet-url"));

    // packing a built Streetlist site happens on the owner's machine, with no server folder
    if (command === "home" && positionals[0] === "pack") return await homeCommand("", positionals[0], positionals.slice(1), { ...(str("out") ? { out: str("out")! } : {}), ...(str("sha256") ? { sha256: str("sha256")! } : {}), ...(str("commit") ? { commit: str("commit")! } : {}) }, { log: (l) => console.log(l) });
    const dir = serverDir({ server: str("server") });
    if (command === "model-key") {
      const server = loadServer(dir);
      if (!modelChosen(server)) throw new Error(NO_MODEL); // the key's file name depends on the wire, so the model comes first
      const key = readFileSync(resolve(positionals[0] ?? ""), "utf8").trim();
      if (key.length < 8) throw new Error("That file is empty or too short to be an API key.");
      writeModelKey(dir, server.model.wire, key);
      console.log("The model's key is in place, for the model Guard only.");
      return 0;
    }

    if (command === "speech-key") {
      // B29: the speech provider's key (Sarvam's), for the speech Guard only. Handing it in is the first of the two things a shop's "speech" block needs (the other is that the Guards are placed).
      const key = readFileSync(resolve(positionals[0] ?? ""), "utf8").trim();
      writeSpeechKey(dir, key);
      console.log("The speech provider's key is in place, for the speech Guard only.");
      return 0;
    }

    if (command === "backup-key") {
      const which = positionals[0];
      if (which === "stream") throw new Error("There is no continuous copy any more (since 9 Nov 2026), so the stream bucket's key is not needed. The nightly snapshot is the backup: backup-key snapshots <file>.");
      if (which !== "snapshots") throw new Error("backup-key snapshots <file>   (the file has access-key-id:secret on one line)");
      const key = readFileSync(resolve(positionals[1] ?? ""), "utf8").trim();
      if (!/^[^:\s]+:\S+$/u.test(key)) throw new Error("The file must have the key as access-key-id:secret, on one line.");
      prepareSecretsRoot(dir);
      writeSecretFile(secretFile(dir, "backup", which), key);
      console.log("The snapshot bucket's key is in place (it is read by the snapshot job, the drill and `restore` only).");
      return 0;
    }

    if (command === "google-key") {
      const file = readFileSync(resolve(positionals[0] ?? ""), "utf8");
      const problem = INTAKE["google_service_account.json"].check(file);
      if (problem) throw new Error(problem);
      prepareSecretsRoot(dir);
      writeSecretFile(secretFile(dir, "refresher", "_server", "google_service_account.json"), file.trim());
      console.log(`The server-wide Google key is in place (${(JSON.parse(file) as { client_email: string }).client_email}). A shop that hands in no key of its own uses it; share each shop's calendar with that address.`);
      return 0;
    }

    if (command === "gupshup-token") {
      // follow-up 2: the partner's Universal Token, kept only in the refresher's folder; never printed, only its end (read from the token itself, not checked)
      const token = readFileSync(resolve(positionals[0] ?? ""), "utf8").trim();
      if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(token)) throw new Error("The file must hold Gupshup's Universal Token on one line, as Gupshup gave it (three parts with dots between, like eyJ...).");
      prepareSecretsRoot(dir);
      writeSecretFile(secretFile(dir, "refresher", "_server", GUPSHUP_UNIVERSAL_TOKEN_FILE), token);
      const ends = jwtExpiryMs(token);
      console.log(`The Gupshup universal token is in place${ends ? ` (it says it ends ${new Date(ends).toISOString().slice(0, 10)}; hand in a new one before then)` : ""}. Each Gupshup shop that hands in no gupshup_authorization of its own gets its app token renewed by the refresher from the next \`geometer deploy\`.`);
      return 0;
    }

    if (command === "shop" && positionals[0] === "add") {
      const name = positionals[1] ?? "";
      const problem = shopNameProblem(name);
      if (problem) throw new Error(problem);
      const from = str("from");
      const template = str("template");
      if (from && template) throw new Error("Say where the shop starts, once: --from <client folder> or --template <id>, not both.");
      if (!from && !template) throw new Error("Say where the shop starts: shop add <name> --from <client folder> (a folder with settings.json and pathway.lock), or shop add <name> --template <id> (a template of this checkout).");
      let preparedBy = str("prepared-by");
      const company = str("company");
      if (company !== undefined) {
        // with --company, --prepared-by is the person's name alone and the owner reads "Name, Company"
        if (preparedBy === undefined || preparedBy.trim() === "") throw new Error('--company goes with --prepared-by, the person\'s name: for example --prepared-by "Divya" --company "Sri Sai Digital".');
        if (!companyOf(company)) throw new Error(`--company must be the company or business name on one line, up to ${COMPANY_LIMIT} characters.`);
        preparedBy = preparedByOf({ accountName: preparedBy, company, role: "partner" });
      }
      if (preparedBy !== undefined && !parseReportFile(JSON.stringify({ schema: 1, preparedBy }))) throw new Error('--prepared-by must be the name the owner reads for who set the shop up, on one line with single spaces, up to 120 characters: for example --prepared-by "Divya, local partner".');
      const target = serverPaths(dir).shop(name);
      if (existsSync(target)) throw new Error(`There is already a shop called ${name}.`);
      // a name whose secrets inbox already holds files belongs to a setup someone else started (the panel makes the inbox first): never adopt it
      const waiting = serverPaths(dir).inbox(name);
      if (existsSync(waiting) && readdirSync(waiting).length > 0) throw new Error(`The secrets inbox for ${name} already holds files, so that name is taken by a setup in progress. Choose another name.`);
      // A shop that starts from a template is made from that template's own files: its example settings (or the file --settings names), the pin to the version in this
      // checkout, and a runtime.json that says who things are (the WhatsApp number's id, a calendar's id where the template has one). Everything is checked before a folder is made.
      let fromTemplate: { settings: string; runtime: Record<string, unknown>; lock: string; where: string } | undefined;
      if (template) {
        const found = discoverTemplates(join(APP_DIR, "templates")).find((t) => t.id === template);
        const kind = kindFor(found?.id);
        if (!found || !kind) throw new Error(`There is no template called "${template}" in this checkout that the bundle can run. It has: ${discoverTemplates(join(APP_DIR, "templates")).filter((t) => kindFor(t.id)).map((t) => t.id).join(", ") || "none"}.`);
        const settingsFile = str("settings") ?? join(found.folder, found.settingsExample);
        let settingsText: string;
        try { settingsText = readFileSync(resolve(settingsFile), "utf8"); } catch { throw new Error(`I could not read the settings file ${settingsFile}.`); }
        let parsed: unknown;
        try { parsed = JSON.parse(settingsText); } catch (e) { throw new Error(`${settingsFile} is not valid JSON: ${(e as Error).message}`); }
        // B71: how the shop takes money is never the example's. With --settings the file says it; otherwise the shop's own UPI ID (the default) or an explicit gateway.
        // Without either it is refused: an example's made-up UPI ID would send customers' money to nobody the shop knows.
        const upiId = str("upi-id");
        const payee = str("payee");
        const paymentFlag = str("payment");
        if (str("settings") !== undefined && (upiId !== undefined || payee !== undefined || paymentFlag !== undefined)) throw new Error("The settings file you gave says how customers pay (\"payment\"), so --upi-id, --payee and --payment mean nothing here. Change the file instead.");
        if (str("settings") === undefined) {
          if (paymentFlag !== undefined && paymentFlag !== "razorpay" && paymentFlag !== "upi") throw new Error(`--payment ${paymentFlag} is not a payment module I know. Leave it out for UPI (the default), or say --payment razorpay for a shop with its own Razorpay account.`);
          if (paymentFlag === "razorpay" && (upiId !== undefined || payee !== undefined)) throw new Error("A shop on its own Razorpay account has no UPI ID here: leave out --upi-id and --payee, or leave out --payment razorpay.");
          if (paymentFlag !== "razorpay" && (upiId === undefined || payee === undefined)) throw new Error("Say how this shop's customers pay. UPI is the default and needs no gateway account: --upi-id <the shop's own UPI ID, for example glowsalon@okicici> --payee \"<the name customers see, for example Glow Salon>\". A shop with its own Razorpay account says --payment razorpay instead.");
          const block = paymentFlag === "razorpay" ? { module: "razorpay" } : { module: "upi", upi: { id: upiId, payee } };
          parsed = { ...(parsed as Record<string, unknown>), payment: block };
          settingsText = `${JSON.stringify(parsed, null, 2)}\n`;
        }
        const numberId = str("whatsapp-number-id");
        const calendarId = str("calendar-id");
        if (calendarId !== undefined && !kind.guards.includes("calendar")) throw new Error(`The ${found.id} template has no calendar, so --calendar-id means nothing for it.`);
        // B72: a Bookings shop uses the shop's own booking list unless it is given a calendar (--calendar-id) or asked for Google Calendar (--calendar google). With --settings the file says it.
        const calendarFlag = str("calendar");
        if (calendarFlag !== undefined && calendarFlag !== "own" && calendarFlag !== "google") throw new Error(`--calendar ${calendarFlag} is not a choice. Say --calendar own (the shop's own booking list) or --calendar google (the shop's Google Calendar, with --calendar-id when you have it).`);
        if (str("settings") !== undefined && calendarFlag !== undefined) throw new Error("The settings file you gave says where bookings are kept (\"calendar\"), so --calendar means nothing here. Change the file instead.");
        if (calendarFlag === "own" && calendarId !== undefined) throw new Error("--calendar own means no Google Calendar, so --calendar-id means nothing with it.");
        if (kind.guards.includes("calendar") && str("settings") === undefined && (parsed as { calendar?: unknown }).calendar === undefined) {
          const module = calendarFlag ?? (calendarId !== undefined ? "google" : "own");
          parsed = { ...(parsed as Record<string, unknown>), calendar: { module } };
          settingsText = `${JSON.stringify(parsed, null, 2)}\n`;
        }
        const checked = kind.validateSettings(parsed);
        if (!checked.ok) throw new Error(`These ${found.id} settings need fixing (${settingsFile}):\n- ${checked.errors.join("\n- ")}`);
        if (numberId !== undefined && !/^\d{6,20}$/u.test(numberId)) throw new Error("--whatsapp-number-id must be the shop's WhatsApp phone number id: digits only.");
        fromTemplate = {
          settings: settingsText.endsWith("\n") ? settingsText : `${settingsText}\n`,
          runtime: { mode: "live", tickSeconds: 30, services: { ...(guardsOf(kind, checked.settings).includes("razorpay") ? { payments: {} } : {}), ...(guardsOf(kind, checked.settings).includes("calendar") ? { calendar: calendarId !== undefined ? { calendarId } : {} } : {}), messaging: numberId !== undefined ? { phoneNumberId: numberId } : {}, timeoutMs: 20_000 } },
          lock: `${found.id}@${found.version}\n`,
          where: str("settings") ? "the settings file you gave" : `the ${found.id} template's example (${found.settingsExample}), which is somebody else's made-up centre: change it to the real one`,
        };
      }
      mkdirSync(target, { recursive: true });
      if (fromTemplate) {
        writeFileSync(join(target, "settings.json"), fromTemplate.settings);
        writeFileSync(join(target, "runtime.json"), `${JSON.stringify(fromTemplate.runtime, null, 2)}\n`);
        writeFileSync(join(target, "pathway.lock"), fromTemplate.lock);
        console.log(`The settings are ${fromTemplate.where}. They are in shops/${name}/settings.json.`);
      } else for (const file of ["settings.json", "runtime.json", "pathway.lock"]) {
        const src = join(resolve(from as string), file);
        if (!existsSync(src)) { if (file === "runtime.json") continue; throw new Error(`${src} is missing: a client folder needs settings.json and pathway.lock (and runtime.json).`); }
        cpSync(src, join(target, file));
      }
      if (preparedBy !== undefined) writeFileSync(join(target, "report.json"), `${JSON.stringify({ schema: 1, preparedBy }, null, 2)}\n`);
      console.log(`Added ${name}. Next: hand in its secrets (the panel does this), then \`geometer check ${name}\`.${preparedBy === undefined ? ` The owner's monthly report will say "${DEFAULT_PREPARED_BY}" set it up; \`--prepared-by "Divya, local partner"\` (or \`--prepared-by Divya --company "Sri Sai Digital"\`, or shops/${name}/report.json) names a person.` : ""}`);
      return 0;
    }

    const ctx = makeContext(dir, overrides);
    const shop = positionals[0];

    // an agent someone else wrote (agent add / check / deploy / show / record / report), and the shop commands when they are given an agent's name
    if (command === "agent") return await agentCommand(ctx, positionals[0], positionals[1], values);
    const isAgent = (n: string | undefined): n is string => n !== undefined && existsSync(serverPaths(dir).agent(n));
    if (command === "check" && isAgent(shop)) return await agentCommand(ctx, "check", shop, values);
    if (command === "deploy" && isAgent(shop)) return await agentCommand(ctx, "deploy", shop, values);

    if (command === "check") {
      if (!shop) throw new Error("Say which shop: check <shop>");
      const r = await checkShop(ctx, shop);
      [...serverNotes(dir), ...r.notes].forEach((n) => console.log(`note: ${n}`));
      r.lines.forEach((l) => console.log(l));
      const c = await connectionChecks(ctx, shop);
      console.log(c.text);
      if (!r.ok) { console.log(refusal(new Refused(r.problems))); return 1; }
      console.log(`${shop} passes the generator's checks${c.failed ? ", but the connection checks above failed" : ""}. Nothing was started or changed on the Guards.${c.recorded ? " The connection checks recorded the confirmed ids in the shop's pins.json: the next deploy, or `apply`, pins the Guards to them." : ""}`);
      return c.failed ? 1 : 0;
    }

    if ((command === "panel" && positionals[0] === "invite") || command === "invite") {
      if (!loadServer(dir).panel.enabled) throw new Error('This server has no panel: set "panel": { "enabled": true } in geometer.json and deploy, or `init --panel`.');
      // `invite builder` is the short form of `panel invite --role builder`
      const role = command === "invite" ? positionals[0] : str("role");
      if (role !== "builder" && role !== "partner") throw new Error(command === "invite" ? "Say who the invitation is for: invite builder|partner [--note TEXT]" : "Say who the invitation is for: panel invite --role builder|partner [--note TEXT]");
      const r = await compose(ctx, ["exec", "-T", "panel", "node", "/app/bundle/panel/main.ts", "invite", "--role", role, ...(str("note") ? ["--note", str("note") as string] : [])], { timeoutMs: 60_000 });
      if (r.code !== 0) throw new Error(`The panel did not make a link (${(r.stderr.trim() || r.stdout.trim() || `exit ${r.code}`).slice(0, 300)}). Is it running? \`geometer status\` says; \`geometer deploy\` starts it.`);
      console.log(r.stdout.trim());
      return 0;
    }

    if (command === "panel" && positionals[0] === "confirm-link") {
      // asks the running panel for a one-time link a person opens to confirm something Claude Code drafted (the plugin, B11). It only asks: nothing is applied from here.
      if (!loadServer(dir).panel.enabled) throw new Error('This server has no panel: set "panel": { "enabled": true } in geometer.json and deploy, or `init --panel`.');
      const r = await compose(ctx, ["exec", "-T", "panel", "node", "/app/bundle/panel/main.ts", "confirm-link", "--kind", str("kind") ?? "", "--shop", str("shop") ?? "", ...(str("changes") ? ["--changes", str("changes") as string] : []), ...(str("note") ? ["--note", str("note") as string] : [])], { timeoutMs: 60_000 });
      if (r.code !== 0) throw new Error(`The panel did not make a link (${(r.stderr.trim() || r.stdout.trim() || `exit ${r.code}`).slice(0, 400)}). Is it running? \`geometer status\` says; \`geometer deploy\` starts it.`);
      console.log(r.stdout.trim());
      return 0;
    }

    if (command === "fingerprints") {
      const r = await runFingerprints(ctx);
      r.lines.forEach((l) => console.log(l));
      return r.ok ? 0 : 1;
    }
    if (command === "paper") {
      const files = await paperCommand(ctx, positionals[0] ?? "", positionals[1] ?? "", { ...(str("case") ? { caseId: str("case") } : {}), ...(str("language") ?? str("lang") ? { lang: (str("language") ?? str("lang")) as string } : {}), out: str("out") ?? "." });
      console.log(`Wrote ${files.length} files:\n${files.map((f) => `  ${f}`).join("\n")}\nCheck a signed one at geometer.dev/verify, or with node templates/commerce/bookings/scripts/verify-report.ts <file>. Each paper lists what it did not check.`);
      return 0;
    }

    if (command === "export") {
      if (!shop) throw new Error("Say which shop: export <shop> [--out <folder>]");
      const r = await exportCommand(ctx, shop, str("out") ?? ".");
      console.log(`Exported ${shop}: ${r.files} files in ${r.folder} and the same as ${r.archive}.`);
      for (const line of [...r.notes, ...r.warnings]) console.log(`note: ${line}`);
      console.log(`${r.whole ? "Every file is the one the manifest names." : "A file does not match the manifest: do not rely on this package."} No key or secret is in it. README.txt inside says how to check it: node bundle/export/check.ts <folder>`);
      return r.whole ? 0 : 1;
    }

    if (command === "deploy") {
      serverNotes(dir).forEach((n) => console.log(`note: ${n}`));
      // with no name: every shop, then every agent someone else wrote
      const agents = shop ? [] : listAgents(dir);
      if (shop || listShops(dir).length > 0 || agents.length === 0) {
        const results = await deploy(ctx, shop);
        for (const r of results) { console.log(`${r.shop}: ${r.proven.line}`); for (const [k, g] of Object.entries(r.guards)) console.log(`  ${k}: ${g.passed} of ${g.of} tripwires passed on the running Guard${g.notSelfTestable.length ? `, ${g.notSelfTestable.length} not self-testable (not counted)` : ""}`); }
      }
      for (const a of agents) await agentCommand(ctx, "deploy", a, values);
      return 0;
    }

    if (command === "home") return await homeCommand(dir, positionals[0], positionals.slice(1), { ...(str("out") ? { out: str("out")! } : {}), ...(str("sha256") ? { sha256: str("sha256")! } : {}), ...(str("commit") ? { commit: str("commit")! } : {}) }, { log: (l) => console.log(l) });
    if (command === "whatsapp-templates") return await whatsappTemplatesCommand(APP_DIR, dir, positionals[0], { ...(str("template") ? { template: str("template")! } : {}), ...(str("languages") ? { languages: str("languages")! } : {}), ...(str("only") ? { only: str("only")! } : {}), submit: values.submit === true, status: values.status === true }, { log: (l) => console.log(l) });
    if (command === "status") return await status(ctx);
    if (command === "up") return await up(ctx);
    if (command === "server") return await serverCommand(ctx, positionals[0], { wait: str("wait"), confirm: values.confirm === true });

    if (command === "licence") {
      if ((positionals[0] !== "extension" && positionals[0] !== "lease") || !positionals[1]) throw new Error("Say what to do: licence extension <file>   (the gx1. token Geometer sent, in a file or as it is), or licence lease <file>   (a gl1. lease)");
      const server = loadServer(dir);
      const text = existsSync(resolve(positionals[1])) ? readFileSync(resolve(positionals[1]), "utf8") : positionals[1];
      if (positionals[0] === "lease") {
        // the by-hand path for a server set up with --fleet-key-file (decision 39: a production Guard runs no shop without a lease); a paired server gets its trial lease at init
        const r = takeLease(dir, server, text);
        if (!r.taken) { console.log(`This lease was not kept: ${r.why}.`); return r.same ? 0 : 1; }
        runLicence(ctx);
        console.log(`Kept: a lease for ${r.payload.shops.length} shop${r.payload.shops.length === 1 ? "" : "s"} on ${fleetIdOf(server)}, signed ${new Date(r.payload.issued_at * 1000).toISOString().slice(0, 10)}. Each shop's Guards and agent read it at their next start; \`geometer deploy\` starts them.`);
        return 0;
      }
      const r = takeExtension(dir, server, text, Math.floor(ctx.now().getTime() / 1000));
      if (!r.taken) { console.log(`This extension was not kept: ${r.why}.`); return r.same ? 0 : 1; }
      runLicence(ctx);
      console.log(`Kept. Until ${new Date(r.payload.until * 1000).toISOString().slice(0, 10)}, no shop on this server winds down because its lease could not be renewed. It does not lift a wind-down or a stop that fleet's lease states, and it changes nothing that was paid.`);
      return 0;
    }

    if (command === "stop" || command === "start") {
      if (!shop) throw new Error(`Say which shop: ${command} <shop> (${command === "stop" ? "the kill switch for that one shop: nothing goes out from it" : "releases that shop's kill switch"}). The whole server is \`geometer server ${command}\`.`);
      const on = command === "stop";
      const by = hostId();
      const r = await ops(ctx, ["stop", shop, on ? "on" : "off", by, str("reason") ?? ""]);
      if (r.code !== 0) throw new Error(`The Guards could not be reached: ${r.stderr.trim().slice(0, 300) || "is the server up?"}`);
      const result = JSON.parse(r.stdout.trim().split("\n").at(-1)!) as { reason: string; results: { guard: string; status: number }[] };
      const state = loadState(ctx.dir);
      const held = state.shops[shop] ?? state.agents?.[shop];
      if (held) { if (on) held.stopped = { by, at: ctx.now().toISOString(), reason: result.reason }; else delete held.stopped; saveState(ctx.dir, state); }
      updateStatus(ctx.dir, shop, ctx.now(), (s) => { if (on) s.stopped = { at: ctx.now().toISOString(), by, reason: result.reason }; else delete s.stopped; });
      for (const x of result.results) console.log(`${x.guard}: ${x.status === 200 ? (on ? "stopped" : "released") : `HTTP ${x.status} (not confirmed)`}`);
      console.log(on ? `${shop} is stopped: nothing new goes out. ${result.reason}` : `${shop} is released.`);
      return result.results.every((x) => x.status === 200) ? 0 : 1;
    }

    if (command === "update" || command === "rollback") {
      // names come as --shops a,b, or (for rollback) as the one shop named after the command
      const asked = [str("shops"), ...positionals].filter((x): x is string => !!x).flatMap((x) => x.split(",")).map((x) => x.trim()).filter(Boolean);
      const shops = asked.length > 0 ? asked : undefined;
      const dryRun = values["dry-run"] === true;
      const run = command === "update" ? await runUpdate(ctx, { to: str("to"), shops, dryRun }) : await runRollback(ctx, { shops, dryRun });
      console.log(summary(run));
      return exitCodeOf(run);
    }

    if (command === "logs") {
      if (!shop) {
        // no shop: the server's own services, the ones that run before any shop does
        const r = await compose(ctx, ["logs", "--no-color", "--tail", str("tail") ?? "100", ...SERVER_SERVICES.filter((n) => n !== "panel" || loadServer(dir).panel.enabled)]);
        process.stdout.write(r.stdout); process.stderr.write(r.stderr);
        return r.code;
      }
      // the shop's own Guards, as it was applied: a Fees centre has no calendar Guard and a UPI shop (B33) no Razorpay one
      const applied = loadState(ctx.dir).shops[shop]?.applied;
      const guards = applied ? Object.values(applied.guards).map((g) => g.service) : [`g-${shop}-razorpay`, `g-${shop}-whatsapp`, `g-${shop}-calendar`];
      const r = await compose(ctx, ["logs", "--no-color", "--tail", str("tail") ?? "200", `rt-${shop}`, ...guards]);
      process.stdout.write(r.stdout); process.stderr.write(r.stderr);
      return r.code;
    }

    if (command === "apply") {
      if (values.watch) { await watch(ctx, Number(str("interval") ?? 10) * 1000); return 0; }
      await applyServerSettings(ctx);
      const r = await applyOnce(ctx);
      return r.failed > 0 ? 1 : 0;
    }

    if (command === "restore") {
      if (!shop) throw new Error("Say which shop: restore <shop> --identity <the owner's key file> [--at <time>]");
      const how = { at: str("at"), fromSnapshot: str("from-snapshot"), ...(str("identity") ? { identity: resolve(str("identity")!) } : {}) };
      // a name is a shop's or an agent's someone else wrote, never both (agent add refuses a shop's name)
      console.log(loadState(ctx.dir).agents?.[shop] ? await restoreAgent(ctx, shop, how) : await restoreShop(ctx, shop, how));
      return 0;
    }

    if (command === "backup") {
      if (positionals[0] === "now") { const r = await runBackup(ctx); console.log(r.lines.join("\n")); return r.ok ? 0 : 1; }
      if (positionals[0] === "drill") { const r = await runDrill(ctx); console.log(r.lines.join("\n")); return r.ok ? 0 : 1; }
      throw new Error("backup now | backup drill");
    }

    console.error(`I don't know "${command}". Run \`geometer help\`.`);
    return 2;
  } catch (e) {
    if (e instanceof Refused) { console.error(refusal(e)); return 1; }
    console.error((e as Error).message);
    return 1;
  }
}

/**
 * The panel's read-only connection checks (the WhatsApp number is this shop's, the Razorpay key is the right mode, the calendar is shared and writable), run where they
 * can run: inside the panel container, which is on the network the Guards' agent ports are on and has the token (services/connection-check.ts). They go through the shop's
 * RUNNING Guards, so they only happen once the shop has been deployed; before that this says so. Returns the text to print and whether anything failed.
 */
export async function connectionChecks(ctx: Context, shop: string): Promise<{ text: string; failed: boolean; /** every check confirmed, so the panel wrote pins.json */ recorded: boolean }> {
  const not = (why: string) => ({ text: `Connection checks: not run. ${why}`, failed: false, recorded: false });
  let server;
  try { server = loadServer(ctx.dir); } catch (e) { return not((e as Error).message); }
  if (!server.panel.enabled) return not("This server has no panel (\"panel\" in geometer.json), and the checks run inside it.");
  if (readStatus(ctx.dir, shop)?.deploy.state !== "applied") return not(`${shop} is not deployed yet, so its Guards are not up to be asked: deploy it, then run \`geometer check ${shop}\` again (or press "Run the checks" in the panel).`);
  const r = await compose(ctx, ["exec", "-T", "panel", "node", "/app/bundle/services/connection-check.ts", shop], { timeoutMs: 120_000 });
  let body: { connections?: { service: string; ok: boolean; code: string; detail?: string; notChecked?: string[]; confirmed?: { appId?: string; appName?: string } }[] | null; missing?: boolean } | undefined;
  try { body = JSON.parse(r.stdout.trim().split("\n").at(-1) ?? ""); } catch { /* not JSON */ }
  if (!body) return not(`The panel did not answer (${(r.stderr.trim() || r.stdout.trim() || `exit ${r.code}`).slice(0, 200)}). Is the panel container up (\`geometer status\`)?`);
  if (body.missing) return not(`The panel has no settings for ${shop} (the panel keeps them in shops/${shop}/).`);
  if (!body.connections) return not("The panel has not been told where the Guards are (PANEL_GUARD_URL).");
  // "not_configured" means the panel has nothing to check with yet (a shop made by `shop add` has no business number or key id in the panel's own data): that is not a failure
  const notRun = body.connections.filter((c) => !c.ok && c.code === "not_configured");
  const failed = body.connections.some((c) => !c.ok && c.code !== "not_configured");
  // a Gupshup shop's WhatsApp check confirms an app, never a number (panel/checks.ts checkGupshup): it is printed as what it is
  const lines = body.connections.map((c) => `${c.service}: ${c.ok ? (c.confirmed?.appName ? `Gupshup answered for app ${c.confirmed.appName}` : c.confirmed?.appId ? `Gupshup answered for app ${c.confirmed.appId}` : "confirmed") : c.code === "not_configured" ? "NOT RUN (the panel does not have what it needs for this yet: enter it on the shop's page in the panel)" : `NOT confirmed (${c.code}${c.detail ? `: ${c.detail}` : ""})`}${c.notChecked?.length ? `; not checked: ${c.notChecked.join(", ")}` : ""}`);
  const verdict = failed ? "FAILED" : notRun.length > 0 ? "none failed, but some could not run" : "all passed";
  return { text: `Connection checks (read-only through the shop's Guards; nothing is sent or charged; the same as the panel's "Run the checks", so the panel shows these too, and this writes the shop's pins.json when they all confirm): ${verdict}\n${lines.map((l) => `  ${l}`).join("\n")}`, failed, recorded: body.connections.length > 0 && body.connections.every((c) => c.ok) };
}

async function init(folder: string | undefined, v: Record<string, string | boolean | undefined>): Promise<number> {
  if (!folder) throw new Error("Say where the server folder goes: init <folder> --domain <domain> --reviewed-by <you> --model-wire openai|anthropic --model <name>");
  const dir = resolve(folder);
  if (existsSync(join(dir, "geometer.json"))) throw new Error(`${dir} is already a server folder.`);
  const s = (k: string) => (typeof v[k] === "string" ? v[k] as string : undefined);
  // --pairing: what `pair` kept in the folder says who this server is to fleet; nothing given by hand may contradict it
  let paired: PairingFile | undefined;
  if (v.pairing === true) {
    paired = readPairing(dir);
    if (s("id") !== undefined && s("id") !== paired.deploymentId) throw new Error(`--id ${s("id")} is not the id fleet gave this server when it was paired (${paired.deploymentId}); every heartbeat must name that one. Leave out --id.`);
    if (s("fleet-url") !== undefined || s("fleet-key-file") !== undefined || s("licence-key") !== undefined) throw new Error("With --pairing, fleet's address, the deployment key and the licence key come from the pairing: leave out --fleet-url, --fleet-key-file and --licence-key.");
    const want = s("guard-licence-kid");
    const kids = paired.licenceKeys.map((k) => kidOf(Buffer.from(k, "hex")));
    if (want !== undefined && paired.licenceKeys.length > 0 && !kids.includes(want)) throw new Error(`Fleet's licence key (key id ${kids.join(", ")}) is not the one built into this release's Guard image (key id ${want}), so every shop's deploy would be refused. Nothing was set up. This is Geometer's to fix: write to support. The pairing is kept, so running the install again later needs no new code.`);
  }
  const id = paired?.deploymentId ?? s("id") ?? basename(dir).toLowerCase().replace(/[^a-z0-9_-]+/gu, "-").replace(/^-+/u, "").slice(0, 64);
  const problem = serverIdProblem(id);
  if (problem) throw new Error(problem);
  // Decision 39: no server folder without Geometer's licence key, so no shop is set up that its Guards would then refuse to run. By hand it is --licence-key,
  // refused in the same words as a refused deploy. With --pairing it is the key fleet sent when the server was paired; a pairing that brought none (fleet's
  // licence was off) is refused in words of its own, since "pair the server" is what the builder just did: the way out is Geometer's, and the pairing is kept.
  if (paired && paired.licenceKeys.length === 0) throw new Error(`Fleet sent no licence key when this server was paired (its licence is off), and Guard runs a builder's shop only under Geometer's licence (decision 39), so the server folder was not made. This is Geometer's to fix: write to support and give this server's id, ${paired.deploymentId}. The pairing is kept in this folder, so no new code is needed.`);
  if (!paired && !s("licence-key")) throw new Error(NO_LICENCE_KEY);
  let recipient = s("age-recipient");
  if (s("snapshots-url") && !recipient) {
    const out = s("age-identity-out");
    if (!out) throw new Error("Snapshots are encrypted with age. Give --age-recipient <age1...>, or --age-identity-out <file> and a new key pair is made: the SECRET half goes in that file, which you keep somewhere else (not on this server, not in the bucket); it is only needed to restore.");
    const key = generateIdentity();
    writeFileSync(resolve(out), `${key.identity}\n`, { mode: 0o600 });
    recipient = key.recipient;
    console.log(`A new age key pair was made. The secret half is in ${resolve(out)} (mode 0600). Move it off this machine: it is the only key that opens a snapshot, and it is needed only to restore.`);
  }
  if (s("stream-url") || s("stream-endpoint")) console.log("note: --stream-url and --stream-endpoint are not used any more: the continuous copy was removed on 9 Nov 2026, and the nightly snapshot (--snapshots-url) is the backup.");
  const raw = {
    schema: 1, id, domain: s("domain") ?? "localhost", reviewedBy: s("reviewed-by") ?? "", guardImage: s("guard-image") ?? DEFAULT_GUARD_IMAGE, appImage: DEFAULT_APP_IMAGE,
    approvalHours: s("approval-hours") ? Number(s("approval-hours")) : 24,
    // no --model: the folder is made without one, and the panel's first run (or the builder, by hand) chooses it before the first shop
    ...(s("model") !== undefined || s("model-wire") !== undefined ? { model: { wire: s("model-wire") ?? "openai", model: s("model") ?? "" } } : {}),
    ...(paired ? { fleet: { url: paired.fleetUrl, keyFile: pairingPaths(dir).key } } : s("fleet-url") ? { fleet: { url: s("fleet-url"), keyFile: s("fleet-key-file") ?? "" } } : {}),
    ...(paired && paired.licenceKeys.length > 0 ? { licence: { keys: paired.licenceKeys } } : s("licence-key") ? { licence: { keys: s("licence-key")!.split(",").map((k) => k.trim().toLowerCase()).filter(Boolean) } } : {}),
    ...(s("snapshots-url") && recipient ? { backup: { snapshots: { url: s("snapshots-url"), ...(s("snapshots-endpoint") ? { endpoint: s("snapshots-endpoint") } : {}), keepDays: 30 }, ageRecipient: recipient } } : {}),
    panel: { enabled: v.panel === true, mode: v["panel-mode"] === "hosted" ? "hosted" : "own" },
    // the partner server's pages domain (item 11f; streetlist.in by default there, item 6 of before-launch.md): given by hand, never assumed; extra domains are redirected to it
    ...(s("pages-domain") ? { pages: { domain: s("pages-domain"), extraDomains: (s("pages-extra") ?? "").split(",").map((d) => d.trim().toLowerCase()).filter(Boolean) } } : {}),
    ports: { http: s("http-port") ? Number(s("http-port")) : 80, https: s("https-port") ? Number(s("https-port")) : 443 },
  };
  const checked = parseServer(raw);
  if (checked.errors.length > 0) throw new Error(`These need fixing:\n- ${checked.errors.join("\n- ")}`);
  const p = serverPaths(dir);
  for (const d of [p.shops, p.secretsInbox, p.status, p.state, p.generated, p.requests, p.exports, p.panel]) ensureDir(d);
  prepareSecretsRoot(dir);
  writeAtomic(p.config, stableJson(raw));
  for (const k of checked.config.licence?.keys ?? []) console.log(`Fleet's licence key is pinned: key id ${kidOf(Buffer.from(k, "hex"))}.${paired ? "" : " It should be the id fleet's `licence key show` printed."}`);
  if (paired) {
    console.log(`Paired with Geometer's fleet for the account "${paired.accountName}": this server is ${id}, and its heartbeats go to ${paired.fleetUrl}.`);
    // decision 39: the trial lease goes in before the first start, so a new server is never stuck waiting for its first heartbeat
    if (paired.trialLease) {
      const r = takeLease(dir, checked.config, paired.trialLease);
      console.log(r.taken ? `The trial lease is kept (signed ${new Date(r.payload.issued_at * 1000).toISOString().slice(0, 10)}): shops can start before the first heartbeat.` : `note: the trial lease fleet sent was not kept: ${r.why}. The first heartbeat brings a lease.`);
    } else console.log("note: fleet sent no trial lease, so the first heartbeat brings this server's lease; until it does, a Guard image that requires a lease starts no shop.");
  }
  console.log(`Server folder ready: ${dir}\nNext: ${checked.config.model.model === "" ? "choose the model (the panel's first run asks; by hand, \"model\" in geometer.json), then " : ""}\`geometer model-key <file>\`, then \`geometer shop add <name> --from <client folder>\`, hand in the shop's secrets, and \`geometer check <name>\`.`);
  return 0;
}

const AGENT_FLAG_NAMES = ["settings", "upstreams", "owner-whatsapp", "owner-language", "business-name", "deposit", "refund-limit", "price-floor", "hours", "timezone", "whatsapp-number-id", "calendar-id", "forward-whatsapp-to", "upi-id", "payee",
  "gateway-draft", "gateway-accept", "gateway-upstream",
  "refund-inr-per-day", "refunds-per-day", "links-per-hour", "messages-per-hour", "events-per-hour", "events-deleted-per-day", "run", "version"] as const;

/** `agent add|check|deploy|show <name>`: an agent someone else wrote, behind the same Guards. */
export async function agentCommand(ctx: Context, sub: string | undefined, name: string | undefined, values: Record<string, string | boolean | undefined>): Promise<number> {
  if (!sub || !name) throw new Error("Say what to do and to which agent: agent add|check|deploy|show|record|report <name>");
  const str = (k: string) => (typeof values[k] === "string" ? values[k] as string : undefined);
  if (sub === "add") {
    const flags: Record<string, string> = {};
    for (const k of AGENT_FLAG_NAMES) if (str(k) !== undefined) flags[k] = str(k)!;
    const folder = addAgent(ctx.dir, name, flags as AgentFlags, (p) => readFileSync(resolve(p), "utf8"), ctx.now());
    const server = loadServer(ctx.dir);
    const kinds = folder.agent!.upstreams;
    const keys = [...(kinds.includes("razorpay") ? ["razorpay_key (key_id:key_secret)"] : []), ...(kinds.includes("whatsapp") ? ["whatsapp_token", "whatsapp_app_secret", "whatsapp_verify_token"] : []), ...(kinds.includes("calendar") ? ["google_service_account.json"] : [])];
    console.log(`Added ${name}: Guard's limits are made from its settings (agents/${name}/settings.json), the same way a template's are.\n\n${connectionText(name, connectionOf(ctx.dir, server, folder))}\n\nNext: put the shop's own keys in secrets-inbox/${name}/, one file each (${keys.join(", ")}), then \`geometer agent check ${name}\` and \`geometer agent deploy ${name}\`.\nYour agent keeps working as it is; only these addresses and this credential change. A refund above the limit gets HTTP 202 until the owner approves on WhatsApp: send the refund with a "receipt", and send the identical call again after the 202 until it stops being held.`);
    return 0;
  }
  // rotate and remove say themselves what is wrong with a name (remove also finishes an agent whose folder it already moved)
  if ((MANAGE_SUBCOMMANDS as readonly string[]).includes(sub)) return await manageCommand(ctx, sub as (typeof MANAGE_SUBCOMMANDS)[number], name, values);
  if (!existsSync(serverPaths(ctx.dir).agent(name))) throw new Error(`There is no agent called ${name}. Add one with: geometer agent add ${name} --deposit 200 --refund-limit 200 --owner-whatsapp +919800000001 ...`);
  const server = loadServer(ctx.dir);
  if (sub === "check") {
    const r = await checkAgent(ctx, name);
    r.notes.forEach((n) => console.log(`note: ${n}`));
    r.lines.forEach((l) => console.log(l));
    if (!r.ok) { console.log(refusal(new Refused(r.problems))); return 1; }
    console.log(`${name} passes the generator's checks. Nothing was started or changed on the Guards.`);
    return 0;
  }
  if (sub === "deploy") {
    const r = await deployAgent(ctx, name);
    console.log(`${name}: ${r.proven.line}`);
    for (const [k, g] of Object.entries(r.guards)) console.log(`  ${k}: ${g.passed} of ${g.of} tripwires passed on the running Guard${g.notSelfTestable.length ? `, ${g.notSelfTestable.length} not self-testable (not counted)` : ""}`);
    console.log(connectionText(name, r.connection));
    return 0;
  }
  // --credential printed the shared credential before 12 Nov 2026; credentials are never printed now (agent/credentials.ts), so it says where they are instead
  if (sub === "show") { console.log(`${connectionText(name, connectionOf(ctx.dir, server, readAgent(ctx.dir, name)))}${values.credential === true ? "\nnote: --credential no longer prints anything: credentials are never printed. Your agent reads them from the file named above." : ""}`); return 0; }
  if ((CRASH_SUBCOMMANDS as readonly string[]).includes(sub)) return await crashCommand(ctx, sub as (typeof CRASH_SUBCOMMANDS)[number], name, values);
  if (sub === "record") {
    const r = await recordAgent(ctx, name);
    console.log(`${name}: ${r.added} added to the record (${r.total} in all), from what its Guards decided and what the services hold.${r.problems.length > 0 ? `\n${r.problems.map((p) => `  - ${p}`).join("\n")}` : ""}`);
    return r.problems.length > 0 && r.total === 0 ? 1 : 0;
  }
  if (sub === "report") {
    const month = str("month"); const out = str("out");
    if (!month || !out) throw new Error("Say the month and where to put the files: agent report <name> --month 2026-11 --out <folder> [--language en|hi|ml|kn|all]");
    const source = (str("source") ?? "live") as "live" | "test-mode" | "stand-in";
    const r = writeAgentReport(ctx.dir, name, { month, out: resolve(out), language: (str("language") ?? "en") as "en", source, now: ctx.now().getTime() });
    console.log(`Wrote ${r.files.length} files to ${resolve(out)}. The report's code is ${r.code}; the certificate's is ${r.certificateCode}.${r.goLiveSaid ? `\n${r.goLiveSaid}` : "\nNo go-live certificate was found, so the report lists the go-live checks as not given. `geometer agent go-live` makes one."}\n${r.ownerTexts.join("\n\n")}`);
    return 0;
  }
  throw new Error(`I don't know "agent ${sub}". Try: agent add|check|deploy|show|record|report|crash-test|go-live|set|rotate|remove <name>`);
}

/** The services every server runs, before and after its first shop (composeServer): what `logs` with no shop shows and `server status` waits for. */
const SERVER_SERVICES = ["caddy", "panel", "ops", "inbox", "relay", "refresher"] as const;

/** `up`, and `server start` on a server with no shop yet. */
async function up(ctx: Context): Promise<number> {
  const r = await upServer(ctx);
  const server = loadServer(ctx.dir);
  console.log(`The server's own services are up: ${r.services.join(", ")}${r.changed.length === 0 ? " (nothing changed)" : ""}. ${server.panel.enabled ? `The panel answers at ${publicUrl(server)} once HTTPS is ready; \`geometer invite builder\` makes a sign-in link.` : "This server has no panel."}`);
  return 0;
}

/**
 * `pair <folder> --fleet-url U`: the one-time code comes on standard input (one line), so it is never on a command line, in the shell's history or in `ps`. The answer is
 * kept in the folder before anything else (lib/pairing.ts); the code is not. A folder that is already a server set up with pairing skipped is paired late (follow-up 8):
 * every local check before the code is read, then only a `fleet` section is added to its geometer.json (joinPairing). A late pairing that was kept but not joined is
 * joined without a new code.
 */
async function pair(folder: string | undefined, fleetUrl: string | undefined): Promise<number> {
  if (!folder || !fleetUrl) throw new Error("Say where the new server folder goes and fleet's address: pair <folder> --fleet-url https://fleet.geometer.dev   (then paste the code from your account page)");
  const dir = resolve(folder);
  const late = existsSync(join(dir, "geometer.json"));
  const joined = () => {
    const r = joinPairing(dir);
    for (const line of r.lines) console.log(line);
    if (r.joined) console.log("Next: the install's start (a server with no shop yet) or `geometer deploy` (a server with shops) writes the heartbeat's settings, and each shop's Guards take fleet's lease at that deploy.");
    return 0;
  };
  if (late && existsSync(pairingPaths(dir).info)) return joined(); // paired before and not joined yet (or joined already: nothing changes): no new code
  if (late) { const problem = latePairingProblem(dir); if (problem) throw new Error(problem); } // every local check before a code is read
  if (process.stdin.isTTY) process.stderr.write("Paste the pairing code from your account page (geometer.dev/account, \"Add a server\") and press Enter: ");
  const { createInterface } = await import("node:readline/promises");
  const lines = createInterface({ input: process.stdin, terminal: false });
  let code = "";
  for await (const line of lines) { code = line; break; }
  lines.close();
  const p = await pairServer({ dir, fleetUrl, code, now: new Date() });
  if (late) return joined();
  console.log(`Paired with Geometer's fleet for the account "${p.accountName}". This server is ${p.deploymentId}; its key is in ${pairingPaths(resolve(folder)).key} (only you can read it). Next: geometer init ${folder} --pairing --domain <domain> --reviewed-by <you> --panel`);
  return 0;
}

/**
 * `server status|start|stop`: the whole server, as distinct from one shop. `stop <shop>` stays the kill switch for that shop; stopping every container is a different
 * act with a different name, and it asks to be confirmed, because no shop answers its customers while the server is stopped.
 */
async function serverCommand(ctx: Context, sub: string | undefined, o: { wait?: string; confirm: boolean }): Promise<number> {
  const server = loadServer(ctx.dir);
  const state = loadState(ctx.dir);
  const deployed = [...Object.entries(state.shops).filter(([, s]) => s.applied).map(([n]) => n), ...Object.entries(state.agents ?? {}).filter(([, a]) => a.applied).map(([n]) => n)].sort();
  const started = existsSync(composeFile(ctx.dir));
  if (sub === "status") {
    if (!started) { console.log("Nothing has been started on this server yet: `geometer up` starts its own services (HTTPS, the panel, the heartbeat)."); return 1; }
    const want = SERVER_SERVICES.filter((n) => n !== "panel" || server.panel.enabled);
    const limit = Date.now() + Math.max(0, Number(o.wait ?? 0)) * 1000;
    for (;;) {
      const ps = await compose(ctx, ["ps", "-a", "--format", "{{.Service}}\t{{.State}}\t{{.Status}}"], { timeoutMs: 60_000 });
      const rows = ps.stdout.trim().split("\n").filter(Boolean).map((l) => l.split("\t")).map(([service, st, text]) => ({ service, state: st, text: text ?? "" }));
      // up means running, and healthy where the service has a health check (Caddy has none)
      const up = (name: string) => rows.some((r) => r.service === name && r.state === "running" && !/unhealthy|health: starting/u.test(r.text));
      const missing = want.filter((n) => !up(n));
      if (missing.length === 0 || Date.now() >= limit) {
        for (const r of rows.sort((a, b) => a.service.localeCompare(b.service))) console.log(`${r.service.padEnd(28)} ${r.text || r.state}`);
        console.log(missing.length === 0 ? `The server's own services are up${server.panel.enabled ? `; the panel is at ${publicUrl(server)}` : ""}. Shops deployed: ${deployed.length === 0 ? "none yet" : deployed.join(", ")} (\`geometer status\` says how each is).` : `Not up yet: ${missing.join(", ")}. \`geometer logs\` shows what they said.`);
        return missing.length === 0 ? 0 : 1;
      }
      await ctx.sleep(3_000);
    }
  }
  if (sub === "start") {
    if (!started || deployed.length === 0) return await up(ctx);
    const r = await compose(ctx, ["start"], { timeoutMs: 600_000 });
    if (r.code !== 0) throw new Error(`The containers could not be started as they were (${r.stderr.trim().split("\n").slice(-2).join(" | ").slice(0, 300)}). \`geometer deploy\` brings everything up again, checked.`);
    console.log(`Started every container on this server as it was. ${deployed.length} shop${deployed.length === 1 ? "" : "s"} answer customers again; \`geometer status\` says how each is.`);
    return 0;
  }
  if (sub === "stop") {
    const what = deployed.length === 0 ? "No shop runs here yet, so only the panel and HTTPS stop." : `These stop answering their customers until \`geometer server start\`: ${deployed.join(", ")}. Payment links already sent still work at the payment service; nothing new goes out.`;
    if (!o.confirm) { console.log(`This stops EVERY container on this server. ${what}\nTo stop one shop instead, it is \`geometer stop <shop>\` (its kill switch). To go ahead: geometer server stop --confirm`); return 3; }
    if (!started) { console.log("Nothing has been started on this server, so there is nothing to stop."); return 0; }
    const r = await compose(ctx, ["stop"], { timeoutMs: 600_000 });
    if (r.code !== 0) throw new Error(`docker compose stop failed: ${r.stderr.trim().split("\n").slice(-2).join(" | ").slice(0, 300)}`);
    console.log(`Stopped every container on this server. ${what}`);
    return 0;
  }
  throw new Error("Say what to do with the whole server: server status [--wait S] | server start | server stop --confirm   (one shop: stop <shop> / start <shop>)");
}

async function status(ctx: Context): Promise<number> {
  serverNotes(ctx.dir).forEach((n) => console.log(`note: ${n}\n`));
  const state = loadState(ctx.dir);
  const shops = Object.keys(state.shops).sort();
  const agents = Object.entries(state.agents ?? {}).filter(([, a]) => a.applied).map(([n]) => n).sort();
  if (shops.length === 0 && agents.length === 0) { console.log("No shop has been deployed yet."); return 0; }
  const observed = await ops(ctx, ["observe"]);
  const live = observed.code === 0 ? JSON.parse(observed.stdout.trim().split("\n").at(-1)!) as { shops: { id: string; up: boolean; ready: boolean; guards: { id: string; healthReady: boolean; admin: { kill_switch?: { on?: boolean }; tripwires?: { passed?: number; of?: number; ok?: boolean } } | null }[]; status: { tasks?: { pending?: number }; lastStepAt?: string } | null }[] } : undefined;
  if (!live) console.log("The server is not answering (is it up? `docker compose` could not run `ops`). Showing what was last applied.\n");
  for (const name of shops) {
    const s = readStatus(ctx.dir, name);
    const o = live?.shops.find((x) => x.id === name);
    console.log(`${name}  ${s?.versions?.pathway ?? state.shops[name].applied?.pathway ?? "(not deployed)"}  ${o ? (o.up && o.ready ? "running" : o.up ? "up, not ready" : "DOWN") : "unknown"}${s?.stopped ? `  STOPPED${s.stopped.by ? ` by ${s.stopped.by}` : ""} (${s.stopped.at})` : ""}`);
    if (o) for (const g of o.guards) console.log(`  ${g.id}: ${g.admin === null ? "admin port not reachable" : `${g.healthReady ? "ready" : "NOT READY"}, ${g.admin.kill_switch?.on ? "KILLED" : "open"}, tripwires ${g.admin.tripwires?.passed ?? "?"} of ${g.admin.tripwires?.of ?? "?"}${g.admin.tripwires?.ok === false ? " (FAILED)" : ""}`}`);
    if (s?.limits) console.log(`  ${s.limits.line}${s.deploy.state === "failed" ? `; the last deploy FAILED: ${s.deploy.message}` : ""}`);
    if (s?.licence?.listed) console.log(`  licence: ${s.licence.state.replace("_", " ")}${s.licence.paidThrough ? `, paid through ${s.licence.paidThrough.slice(0, 10)}` : ""}${s.licence.state !== "wind_down" && s.licence.state !== "stopped" && s.licence.windDownOn ? `, covered until ${s.licence.windDownOn.slice(0, 10)}` : ""}${s.licence.stopOn ? `, final stop ${s.licence.stopOn.slice(0, 10)}` : ""}${s.licence.exportUntil ? `, records can be downloaded until ${s.licence.exportUntil.slice(0, 10)}` : ""}${s.licence.leaseIssuedAt ? ` (lease signed ${s.licence.leaseIssuedAt.slice(0, 10)})` : ""}`);
    // decision 39 (monorepo ADR-0070): a shop the lease does not list has no licence, and a release's Guard takes no new work for it
    else if (s?.licence) console.log("  licence: none yet (the lease does not list this shop, so its Guards take no new work; it comes with a heartbeat once the trial or a plan covers it)");
    console.log(`  backup: ${s?.backups?.lastCopyAt ? `last snapshot ${s.backups.lastCopyAt}` : "no snapshot yet"}; restore drill: ${s?.backups?.lastDrillAt ? `${s.backups.drillOk ? "passed" : "FAILED"} ${s.backups.lastDrillAt}${s.backups.drillOk ? "" : ` (${s.backups.drillDetail})`}` : "never run"}`);
  }
  // agents someone else wrote: their Guards only
  const seenAgents = (live as { agents?: NonNullable<typeof live>["shops"] } | undefined)?.agents;
  for (const name of agents) {
    const s = readStatus(ctx.dir, name);
    const o = seenAgents?.find((x) => x.id === name);
    console.log(`${name}  own agent  ${o ? (o.up && o.ready ? "running" : o.up ? "up, not ready" : "DOWN") : "unknown"}${s?.stopped ? `  STOPPED${s.stopped.by ? ` by ${s.stopped.by}` : ""} (${s.stopped.at})` : ""}`);
    if (o) for (const g of o.guards) console.log(`  ${g.id}: ${g.admin === null ? "admin port not reachable" : `${g.healthReady ? "ready" : "NOT READY"}, ${g.admin.kill_switch?.on ? "KILLED" : "open"}, tripwires ${g.admin.tripwires?.passed ?? "?"} of ${g.admin.tripwires?.of ?? "?"}${g.admin.tripwires?.ok === false ? " (FAILED)" : ""}`}`);
    if (s?.limits) console.log(`  ${s.limits.line}${s.deploy.state === "failed" ? `; the last deploy FAILED: ${s.deploy.message}` : ""}`);
  }
  return 0;
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
