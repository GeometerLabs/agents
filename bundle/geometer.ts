// geometer: the deploy bundle's command line.   node bundle/geometer.ts <command> [--server <folder>]
//
//   init <folder> --domain D --reviewed-by ID --model-wire openai|anthropic --model NAME [--fleet-url U --fleet-key-file F] [backup options]
//   model-key <file>             the model's API key, handed to the model Guard only
//   google-key <file>            one Google service-account key for every shop that hands in none of its own (hosted mode)
//   shop add <name> --from <client folder>      copy a client folder in (settings.json, runtime.json, pathway.lock)
//   check <shop>                 settings, pin, secrets, the generator's rules, compile and every tripwire, offline. Starts nothing. Once the shop is deployed it ALSO
//                                runs the panel's read-only connection checks (WhatsApp number, Razorpay key, calendar) inside the panel container; when they all confirm
//                                the panel records the ids in shops/<shop>/pins.json, and the next deploy or `apply` pins the Guards to them.
//   agent add <name> [--settings F | --deposit N --refund-limit N --owner-whatsapp +91...] [--upstreams razorpay,whatsapp,calendar] [--whatsapp-number-id ID] [--calendar-id ID] [caps...]
//                                put Guard in front of the services an agent SOMEONE ELSE wrote calls (no hosting, no rebuild); prints the addresses and the one credential it must use instead
//   agent check|deploy|show <name> [--credential]      the same checks and checked deploy as a shop's; show prints the addresses again
//   agent record <name>          the record of what the agent did, built from its Guards' own decisions and the services' own state (the deployer also does this every five minutes)
//   agent report <name> --month 2026-11 --out <folder> [--language en]      the monthly report and certificate from that record
//   panel invite --role builder|partner [--note T]     a one-time invitation link from the running panel (the first builder's way in; hosted mode has no other)
//   deploy [shop]                check, then bring up only what changed, then read the running Guards
//   status                       every shop: running or not, what its Guards enforce, the last backup and drill
//   stop <shop> [--reason T]     the Guard kill switch: nothing goes out. The record says who stopped it.   start <shop> releases it.
//   restore <shop> [--at TIME]   put the shop's record back from the continuous copy (or --from-snapshot FILE --identity FILE)
//   update [--to V] [--shops a,b] [--dry-run]   move clients to a new template version, one at a time, each hand-checked on its own settings first; a client with any situation
//                                that held before and fails now is held back with the reason. Stopped half-way, the same command again carries on. --dry-run changes nothing.
//   rollback [<shop> | --shops a,b]   back to the previous pathway.lock, deployed through the same checks; with no name, the clients the last update moved
//   logs <shop> [--tail N]
//   apply [--watch]              the host-side deployer: applies what the panel writes, running the same checked deploy
//   backup now | drill           the nightly snapshot and the weekly restore drill, once
//
// The deployer is the only process with the Docker socket. The panel never gets it.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { applyOnce, watch } from "./apply.ts";
import { runBackup, runDrill, restoreShop } from "./backup/jobs.ts";
import { generateIdentity } from "./backup/age.ts";
import { Refused, checkShop, compose, deploy, ops } from "./deploy.ts";
import type { Context } from "./deploy.ts";
import { addAgent, checkAgent, connectionOf, connectionText, deployAgent } from "./agent/deploy.ts";
import { listAgents, readAgent } from "./agent/folder.ts";
import type { AgentFlags } from "./agent/folder.ts";
import { recordAgent } from "./agent/records.ts";
import { writeAgentReport } from "./agent/report.ts";
import { dockerGuardTool } from "./generate/verify.ts";
import { exitCodeOf, runRollback, runUpdate, summary } from "./update.ts";
import { realRunner } from "./lib/runner.ts";
import { INTAKE, secretFile, writeSecretFile, prepareSecretsRoot } from "./lib/secrets.ts";
import { DEFAULT_APP_IMAGE, DEFAULT_GUARD_IMAGE, listShops, loadServer, parseServer, serverPaths } from "./lib/server.ts";
import { loadState, saveState } from "./lib/state.ts";
import { readStatus, updateStatus } from "./lib/status.ts";
import { ensureDir, hostId, serverIdProblem, shopNameProblem, stableJson, writeAtomic } from "./lib/util.ts";

const APP_DIR = resolve(dirname(new URL(import.meta.url).pathname), "..");

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

export async function main(argv: string[], overrides: Partial<Context> = {}): Promise<number> {
  const [command, ...rest] = argv;
  const { values, positionals } = parseArgs({
    args: rest, allowPositionals: true, strict: false,
    options: {
      server: { type: "string" }, domain: { type: "string" }, id: { type: "string" }, "reviewed-by": { type: "string" }, "model-wire": { type: "string" }, model: { type: "string" },
      "fleet-url": { type: "string" }, "fleet-key-file": { type: "string" }, "guard-image": { type: "string" }, from: { type: "string" }, reason: { type: "string" }, at: { type: "string" },
      tail: { type: "string" }, watch: { type: "boolean" }, interval: { type: "string" }, "stream-url": { type: "string" }, "stream-endpoint": { type: "string" }, "snapshots-url": { type: "string" },
      "snapshots-endpoint": { type: "string" }, "age-recipient": { type: "string" }, "age-identity-out": { type: "string" }, "from-snapshot": { type: "string" }, identity: { type: "string" },
      role: { type: "string" }, note: { type: "string" }, "approval-hours": { type: "string" }, "http-port": { type: "string" }, "https-port": { type: "string" }, panel: { type: "boolean" }, "panel-mode": { type: "string" },
      // agent add / report
      settings: { type: "string" }, upstreams: { type: "string" }, "owner-whatsapp": { type: "string" }, "owner-language": { type: "string" }, "business-name": { type: "string" }, deposit: { type: "string" }, "refund-limit": { type: "string" },
      "price-floor": { type: "string" }, hours: { type: "string" }, timezone: { type: "string" }, "whatsapp-number-id": { type: "string" }, "calendar-id": { type: "string" }, "forward-whatsapp-to": { type: "string" },
      "refund-inr-per-day": { type: "string" }, "refunds-per-day": { type: "string" }, "links-per-hour": { type: "string" }, "messages-per-hour": { type: "string" }, "events-per-hour": { type: "string" }, "events-deleted-per-day": { type: "string" },
      credential: { type: "boolean" }, month: { type: "string" }, out: { type: "string" }, language: { type: "string" }, source: { type: "string" },
      // update / rollback
      to: { type: "string" }, shops: { type: "string" }, "dry-run": { type: "boolean" },
    },
  }) as { values: Record<string, string | boolean | undefined>; positionals: string[] };
  const str = (k: string) => (typeof values[k] === "string" ? values[k] as string : undefined);

  try {
    if (!command || command === "--help" || command === "help") { console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n")); return command ? 0 : 2; }

    if (command === "init") return await init(positionals[0], values as Record<string, string | boolean | undefined>);

    const dir = serverDir({ server: str("server") });
    if (command === "model-key") {
      const server = loadServer(dir);
      const key = readFileSync(resolve(positionals[0] ?? ""), "utf8").trim();
      if (key.length < 8) throw new Error("That file is empty or too short to be an API key.");
      prepareSecretsRoot(dir);
      if (server.model.wire === "anthropic") writeSecretFile(secretFile(dir, "g-model", "model_api_key"), key); else writeSecretFile(secretFile(dir, "g-model", "model_authorization"), `Bearer ${key}`);
      console.log("The model's key is in place, for the model Guard only.");
      return 0;
    }

    if (command === "backup-key") {
      const which = positionals[0];
      if (which !== "stream" && which !== "snapshots") throw new Error("backup-key stream|snapshots <file>   (the file has access-key-id:secret on one line)");
      const key = readFileSync(resolve(positionals[1] ?? ""), "utf8").trim();
      if (!/^[^:\s]+:\S+$/u.test(key)) throw new Error("The file must have the key as access-key-id:secret, on one line.");
      prepareSecretsRoot(dir);
      writeSecretFile(secretFile(dir, "backup", which), key);
      console.log(`The ${which} bucket's key is in place (it is read by the ${which === "stream" ? "continuous copy" : "snapshot job"} only).`);
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

    if (command === "shop" && positionals[0] === "add") {
      const name = positionals[1] ?? "";
      const problem = shopNameProblem(name);
      if (problem) throw new Error(problem);
      const from = str("from");
      if (!from) throw new Error("Say which client folder to copy in: shop add <name> --from <folder>");
      const target = serverPaths(dir).shop(name);
      if (existsSync(target)) throw new Error(`There is already a shop called ${name}.`);
      // a name whose secrets inbox already holds files belongs to a setup someone else started (the panel makes the inbox first): never adopt it
      const waiting = serverPaths(dir).inbox(name);
      if (existsSync(waiting) && readdirSync(waiting).length > 0) throw new Error(`The secrets inbox for ${name} already holds files, so that name is taken by a setup in progress. Choose another name.`);
      mkdirSync(target, { recursive: true });
      for (const file of ["settings.json", "runtime.json", "pathway.lock"]) {
        const src = join(resolve(from), file);
        if (!existsSync(src)) { if (file === "runtime.json") continue; throw new Error(`${src} is missing: a client folder needs settings.json and pathway.lock (and runtime.json).`); }
        cpSync(src, join(target, file));
      }
      console.log(`Added ${name}. Next: hand in its secrets (the panel does this), then \`geometer check ${name}\`.`);
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
      r.notes.forEach((n) => console.log(`note: ${n}`));
      r.lines.forEach((l) => console.log(l));
      const c = await connectionChecks(ctx, shop);
      console.log(c.text);
      if (!r.ok) { console.log(refusal(new Refused(r.problems))); return 1; }
      console.log(`${shop} passes the generator's checks${c.failed ? ", but the connection checks above failed" : ""}. Nothing was started or changed on the Guards.${c.recorded ? " The connection checks recorded the confirmed ids in the shop's pins.json: the next deploy, or `apply`, pins the Guards to them." : ""}`);
      return c.failed ? 1 : 0;
    }

    if (command === "panel" && positionals[0] === "invite") {
      if (!loadServer(dir).panel.enabled) throw new Error('This server has no panel: set "panel": { "enabled": true } in geometer.json and deploy, or `init --panel`.');
      const role = str("role");
      if (role !== "builder" && role !== "partner") throw new Error("Say who the invitation is for: panel invite --role builder|partner [--note TEXT]");
      const r = await compose(ctx, ["exec", "-T", "panel", "node", "/app/bundle/panel/main.ts", "invite", "--role", role, ...(str("note") ? ["--note", str("note") as string] : [])], { timeoutMs: 60_000 });
      if (r.code !== 0) throw new Error(`The panel did not make a link (${(r.stderr.trim() || r.stdout.trim() || `exit ${r.code}`).slice(0, 300)}). Is it running? \`geometer status\` says; \`geometer deploy\` starts it.`);
      console.log(r.stdout.trim());
      return 0;
    }

    if (command === "deploy") {
      // with no name: every shop, then every agent someone else wrote
      const agents = shop ? [] : listAgents(dir);
      if (shop || listShops(dir).length > 0 || agents.length === 0) {
        const results = await deploy(ctx, shop);
        for (const r of results) { console.log(`${r.shop}: ${r.proven.line}`); for (const [k, g] of Object.entries(r.guards)) console.log(`  ${k}: ${g.passed} of ${g.of} tripwires passed on the running Guard${g.notSelfTestable.length ? `, ${g.notSelfTestable.length} not self-testable (not counted)` : ""}`); }
      }
      for (const a of agents) await agentCommand(ctx, "deploy", a, values);
      return 0;
    }

    if (command === "status") return await status(ctx);

    if (command === "stop" || command === "start") {
      if (!shop) throw new Error(`Say which shop: ${command} <shop>`);
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
      if (!shop) throw new Error("Say which shop: logs <shop>");
      const r = await compose(ctx, ["logs", "--no-color", "--tail", str("tail") ?? "200", `rt-${shop}`, `g-${shop}-razorpay`, `g-${shop}-whatsapp`, `g-${shop}-calendar`]);
      process.stdout.write(r.stdout); process.stderr.write(r.stderr);
      return r.code;
    }

    if (command === "apply") {
      if (values.watch) { await watch(ctx, Number(str("interval") ?? 10) * 1000); return 0; }
      const r = await applyOnce(ctx);
      return r.failed > 0 ? 1 : 0;
    }

    if (command === "restore") {
      if (!shop) throw new Error("Say which shop: restore <shop> [--at <time>]");
      console.log(await restoreShop(ctx, shop, { at: str("at"), fromSnapshot: str("from-snapshot"), identity: str("identity") }));
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
  let body: { connections?: { service: string; ok: boolean; code: string; detail?: string; notChecked?: string[] }[] | null; missing?: boolean } | undefined;
  try { body = JSON.parse(r.stdout.trim().split("\n").at(-1) ?? ""); } catch { /* not JSON */ }
  if (!body) return not(`The panel did not answer (${(r.stderr.trim() || r.stdout.trim() || `exit ${r.code}`).slice(0, 200)}). Is the panel container up (\`geometer status\`)?`);
  if (body.missing) return not(`The panel has no settings for ${shop} (the panel keeps them in shops/${shop}/).`);
  if (!body.connections) return not("The panel has not been told where the Guards are (PANEL_GUARD_URL).");
  // "not_configured" means the panel has nothing to check with yet (a shop made by `shop add` has no business number or key id in the panel's own data): that is not a failure
  const notRun = body.connections.filter((c) => !c.ok && c.code === "not_configured");
  const failed = body.connections.some((c) => !c.ok && c.code !== "not_configured");
  const lines = body.connections.map((c) => `${c.service}: ${c.ok ? "confirmed" : c.code === "not_configured" ? "NOT RUN (the panel does not have what it needs for this yet: enter it on the shop's page in the panel)" : `NOT confirmed (${c.code}${c.detail ? `: ${c.detail}` : ""})`}${c.notChecked?.length ? `; not checked: ${c.notChecked.join(", ")}` : ""}`);
  const verdict = failed ? "FAILED" : notRun.length > 0 ? "none failed, but some could not run" : "all passed";
  return { text: `Connection checks (read-only through the shop's Guards; nothing is sent or charged; the same as the panel's "Run the checks", so the panel shows these too, and this writes the shop's pins.json when they all confirm): ${verdict}\n${lines.map((l) => `  ${l}`).join("\n")}`, failed, recorded: body.connections.length > 0 && body.connections.every((c) => c.ok) };
}

async function init(folder: string | undefined, v: Record<string, string | boolean | undefined>): Promise<number> {
  if (!folder) throw new Error("Say where the server folder goes: init <folder> --domain <domain> --reviewed-by <you> --model-wire openai|anthropic --model <name>");
  const dir = resolve(folder);
  if (existsSync(join(dir, "geometer.json"))) throw new Error(`${dir} is already a server folder.`);
  const s = (k: string) => (typeof v[k] === "string" ? v[k] as string : undefined);
  const id = s("id") ?? basename(dir).toLowerCase().replace(/[^a-z0-9_-]+/gu, "-").replace(/^-+/u, "").slice(0, 64);
  const problem = serverIdProblem(id);
  if (problem) throw new Error(problem);
  let recipient = s("age-recipient");
  if (s("snapshots-url") && !recipient) {
    const out = s("age-identity-out");
    if (!out) throw new Error("Snapshots are encrypted with age. Give --age-recipient <age1...>, or --age-identity-out <file> and a new key pair is made: the SECRET half goes in that file, which you keep somewhere else (not on this server, not in the bucket); it is only needed to restore.");
    const key = generateIdentity();
    writeFileSync(resolve(out), `${key.identity}\n`, { mode: 0o600 });
    recipient = key.recipient;
    console.log(`A new age key pair was made. The secret half is in ${resolve(out)} (mode 0600). Move it off this machine: it is the only way to read a snapshot.`);
  }
  const raw = {
    schema: 1, id, domain: s("domain") ?? "localhost", reviewedBy: s("reviewed-by") ?? "", guardImage: s("guard-image") ?? DEFAULT_GUARD_IMAGE, appImage: DEFAULT_APP_IMAGE,
    approvalHours: s("approval-hours") ? Number(s("approval-hours")) : 24,
    model: { wire: s("model-wire") ?? "openai", model: s("model") ?? "" },
    ...(s("fleet-url") ? { fleet: { url: s("fleet-url"), keyFile: s("fleet-key-file") ?? "" } } : {}),
    ...(s("stream-url") && s("snapshots-url") && recipient ? { backup: { stream: { url: s("stream-url"), ...(s("stream-endpoint") ? { endpoint: s("stream-endpoint") } : {}) }, snapshots: { url: s("snapshots-url"), ...(s("snapshots-endpoint") ? { endpoint: s("snapshots-endpoint") } : {}), keepDays: 30 }, ageRecipient: recipient } } : {}),
    panel: { enabled: v.panel === true, mode: v["panel-mode"] === "hosted" ? "hosted" : "own" },
    ports: { http: s("http-port") ? Number(s("http-port")) : 80, https: s("https-port") ? Number(s("https-port")) : 443 },
  };
  const checked = parseServer(raw);
  if (checked.errors.length > 0) throw new Error(`These need fixing:\n- ${checked.errors.join("\n- ")}`);
  const p = serverPaths(dir);
  for (const d of [p.shops, p.secretsInbox, p.status, p.state, p.generated, p.requests, p.exports, p.panel]) ensureDir(d);
  prepareSecretsRoot(dir);
  writeAtomic(p.config, stableJson(raw));
  console.log(`Server folder ready: ${dir}\nNext: \`geometer model-key <file>\`, then \`geometer shop add <name> --from <client folder>\`, hand in the shop's secrets, and \`geometer check <name>\`.`);
  return 0;
}

const AGENT_FLAG_NAMES = ["settings", "upstreams", "owner-whatsapp", "owner-language", "business-name", "deposit", "refund-limit", "price-floor", "hours", "timezone", "whatsapp-number-id", "calendar-id", "forward-whatsapp-to",
  "refund-inr-per-day", "refunds-per-day", "links-per-hour", "messages-per-hour", "events-per-hour", "events-deleted-per-day"] as const;

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
    console.log(`Added ${name}: Guard's limits are made from its settings (agents/${name}/settings.json), the same way a template's are.\n\n${connectionText(name, connectionOf(ctx.dir, server, folder), true)}\n\nNext: put the shop's own keys in secrets-inbox/${name}/, one file each (${keys.join(", ")}), then \`geometer agent check ${name}\` and \`geometer agent deploy ${name}\`.\nYour agent keeps working as it is; only these addresses and this credential change. A refund above the limit gets HTTP 202 until the owner approves on WhatsApp: send the refund with a "receipt", and send the identical call again after the 202 until it stops being held.`);
    return 0;
  }
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
    console.log(connectionText(name, r.connection, false));
    return 0;
  }
  if (sub === "show") { console.log(connectionText(name, connectionOf(ctx.dir, server, readAgent(ctx.dir, name)), values.credential === true)); return 0; }
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
    console.log(`Wrote ${r.files.length} files to ${resolve(out)}. The report's code is ${r.code}; the certificate's is ${r.certificateCode}.\n${r.ownerTexts.join("\n\n")}`);
    return 0;
  }
  throw new Error(`I don't know "agent ${sub}". Try: agent add|check|deploy|show|record|report <name>`);
}

async function status(ctx: Context): Promise<number> {
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
