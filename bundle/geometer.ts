// geometer: the deploy bundle's command line.   node bundle/geometer.ts <command> [--server <folder>]
//
//   init <folder> --domain D --reviewed-by ID --model-wire openai|anthropic --model NAME [--fleet-url U --fleet-key-file F] [backup options]
//   model-key <file>             the model's API key, handed to the model Guard only
//   shop add <name> --from <client folder>      copy a client folder in (settings.json, runtime.json, pathway.lock)
//   check <shop>                 settings, pin, secrets, the generator's rules, compile and every tripwire, offline. Changes nothing.
//   deploy [shop]                check, then bring up only what changed, then read the running Guards
//   status                       every shop: running or not, what its Guards enforce, the last backup and drill
//   stop <shop> [--reason T]     the Guard kill switch: nothing goes out. The record says who stopped it.   start <shop> releases it.
//   restore <shop> [--at TIME]   put the shop's record back from the continuous copy (or --from-snapshot FILE --identity FILE)
//   rollback <shop>              the previous pathway.lock, deployed
//   logs <shop> [--tail N]
//   apply [--watch]              the host-side deployer: applies what the panel writes, running the same checked deploy
//   backup now | drill           the nightly snapshot and the weekly restore drill, once
//
// The deployer is the only process with the Docker socket. The panel never gets it.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { applyOnce, watch } from "./apply.ts";
import { runBackup, runDrill, restoreShop } from "./backup/jobs.ts";
import { generateIdentity } from "./backup/age.ts";
import { Refused, checkShop, compose, deploy, ops } from "./deploy.ts";
import type { Context } from "./deploy.ts";
import { dockerGuardTool } from "./generate/verify.ts";
import { realRunner } from "./lib/runner.ts";
import { secretFile, writeSecretFile, prepareSecretsRoot } from "./lib/secrets.ts";
import { DEFAULT_APP_IMAGE, DEFAULT_GUARD_IMAGE, loadServer, parseServer, serverPaths } from "./lib/server.ts";
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
      "approval-hours": { type: "string" }, "http-port": { type: "string" }, "https-port": { type: "string" }, panel: { type: "boolean" },
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

    if (command === "shop" && positionals[0] === "add") {
      const name = positionals[1] ?? "";
      const problem = shopNameProblem(name);
      if (problem) throw new Error(problem);
      const from = str("from");
      if (!from) throw new Error("Say which client folder to copy in: shop add <name> --from <folder>");
      const target = serverPaths(dir).shop(name);
      if (existsSync(target)) throw new Error(`There is already a shop called ${name}.`);
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

    if (command === "check") {
      if (!shop) throw new Error("Say which shop: check <shop>");
      const r = await checkShop(ctx, shop);
      r.notes.forEach((n) => console.log(`note: ${n}`));
      r.lines.forEach((l) => console.log(l));
      console.log(await connectionChecks(ctx, shop));
      if (!r.ok) { console.log(refusal(new Refused(r.problems))); return 1; }
      console.log(`${shop} passes every check. Nothing was started.`);
      return 0;
    }

    if (command === "deploy") {
      const results = await deploy(ctx, shop);
      for (const r of results) { console.log(`${r.shop}: ${r.proven.line}`); for (const [k, g] of Object.entries(r.guards)) console.log(`  ${k}: ${g.passed} of ${g.of} tripwires passed on the running Guard${g.notSelfTestable.length ? `, ${g.notSelfTestable.length} not self-testable (not counted)` : ""}`); }
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
      if (state.shops[shop]) { if (on) state.shops[shop].stopped = { by, at: ctx.now().toISOString(), reason: result.reason }; else delete state.shops[shop].stopped; saveState(ctx.dir, state); }
      updateStatus(ctx.dir, shop, ctx.now(), (s) => { s.stopped = on ? { by, at: ctx.now().toISOString(), reason: result.reason } : null; });
      for (const x of result.results) console.log(`${x.guard}: ${x.status === 200 ? (on ? "stopped" : "released") : `HTTP ${x.status} (not confirmed)`}`);
      console.log(on ? `${shop} is stopped: nothing new goes out. ${result.reason}` : `${shop} is released.`);
      return result.results.every((x) => x.status === 200) ? 0 : 1;
    }

    if (command === "rollback") {
      if (!shop) throw new Error("Say which shop: rollback <shop>");
      const state = loadState(ctx.dir);
      const previous = state.shops[shop]?.lockHistory.pop();
      if (previous === undefined) throw new Error(`${shop} has no earlier pathway.lock to go back to.`);
      saveState(ctx.dir, state);
      writeAtomic(join(serverPaths(dir).shop(shop), "pathway.lock"), previous);
      console.log(`Back to ${previous.trim()}.`);
      const results = await deploy(ctx, shop);
      results.forEach((r) => console.log(`${r.shop}: ${r.proven.line}`));
      return 0;
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

/** The panel's read-only connection checks (the WhatsApp number is this shop's, the Razorpay key is the shop's own account, the calendar is shared and writable). Not built here. */
async function connectionChecks(ctx: Context, shop: string): Promise<string> {
  const path = join(ctx.appDir, "bundle", "panel", "checks.ts");
  if (!existsSync(path)) return "Connection checks: not run. They come from the panel (bundle/panel/checks.ts, exporting `connectionChecks({ serverDir, shop })`), and this build has no panel, so the WhatsApp number, the Razorpay account and the calendar were not confirmed.";
  try {
    const mod = await import(path) as { connectionChecks?: (input: { serverDir: string; shop: string }) => Promise<{ ok: boolean; lines: string[] }> };
    if (typeof mod.connectionChecks !== "function") return "Connection checks: not run. bundle/panel/checks.ts does not export connectionChecks({ serverDir, shop }).";
    const r = await mod.connectionChecks({ serverDir: ctx.dir, shop });
    return `Connection checks (read-only, nothing is sent or charged): ${r.ok ? "all passed" : "FAILED"}\n${r.lines.map((l) => `  ${l}`).join("\n")}`;
  } catch (e) { return `Connection checks: not run (${(e as Error).message}).`; }
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
    panel: { enabled: v.panel === true },
    ports: { http: s("http-port") ? Number(s("http-port")) : 80, https: s("https-port") ? Number(s("https-port")) : 443 },
  };
  const checked = parseServer(raw);
  if (checked.errors.length > 0) throw new Error(`These need fixing:\n- ${checked.errors.join("\n- ")}`);
  const p = serverPaths(dir);
  for (const d of [p.shops, p.secretsInbox, p.status, p.state, p.generated]) ensureDir(d);
  prepareSecretsRoot(dir);
  writeAtomic(p.config, stableJson(raw));
  console.log(`Server folder ready: ${dir}\nNext: \`geometer model-key <file>\`, then \`geometer shop add <name> --from <client folder>\`, hand in the shop's secrets, and \`geometer check <name>\`.`);
  return 0;
}

async function status(ctx: Context): Promise<number> {
  const state = loadState(ctx.dir);
  const shops = Object.keys(state.shops).sort();
  if (shops.length === 0) { console.log("No shop has been deployed yet."); return 0; }
  const observed = await ops(ctx, ["observe"]);
  const live = observed.code === 0 ? JSON.parse(observed.stdout.trim().split("\n").at(-1)!) as { shops: { id: string; up: boolean; ready: boolean; guards: { id: string; healthReady: boolean; admin: { kill_switch?: { on?: boolean }; tripwires?: { passed?: number; of?: number; ok?: boolean } } | null }[]; status: { tasks?: { pending?: number }; lastStepAt?: string } | null }[] } : undefined;
  if (!live) console.log("The server is not answering (is it up? `docker compose` could not run `ops`). Showing what was last applied.\n");
  for (const name of shops) {
    const s = readStatus(ctx.dir, name);
    const o = live?.shops.find((x) => x.id === name);
    console.log(`${name}  ${s?.versions?.pathway ?? state.shops[name].applied?.pathway ?? "(not deployed)"}  ${o ? (o.up && o.ready ? "running" : o.up ? "up, not ready" : "DOWN") : "unknown"}${s?.stopped ? `  STOPPED by ${s.stopped.by} (${s.stopped.at})` : ""}`);
    if (o) for (const g of o.guards) console.log(`  ${g.id}: ${g.admin === null ? "admin port not reachable" : `${g.healthReady ? "ready" : "NOT READY"}, ${g.admin.kill_switch?.on ? "KILLED" : "open"}, tripwires ${g.admin.tripwires?.passed ?? "?"} of ${g.admin.tripwires?.of ?? "?"}${g.admin.tripwires?.ok === false ? " (FAILED)" : ""}`}`);
    if (s?.tripwires) console.log(`  last deploy: ${s.tripwires.line}`);
    console.log(`  backup: ${s?.backup.lastBackupAt ? `last snapshot ${s.backup.lastBackupAt}` : "no snapshot yet"}; restore drill: ${s?.backup.lastDrill ? `${s.backup.lastDrill.ok ? "passed" : "FAILED"} ${s.backup.lastDrill.at}${s.backup.lastDrill.ok ? "" : ` (${s.backup.lastDrill.detail})`}` : "never run"}`);
  }
  return 0;
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
