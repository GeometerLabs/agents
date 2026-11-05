// Deploy: from a shop's desired state to running containers, checked before anything starts.
//
//   1. take the secrets handed in, plan the shop, resolve its pathway pin, decide each Guard's bundle version (always higher than the last)
//   2. compile every spec and render every guard.toml, then `geo-guard verify-bundle --config` on each: EVERY tripwire must pass
//   3. if any rule is broken, stop. Nothing running is touched, nothing is started, and every broken rule is named
//   4. write the files, then `docker compose up -d`, then restart only the services whose files changed under an unchanged compose entry
//   5. wait for the Guards, ask each RUNNING Guard for its policy and its tripwires: its digest must be the one compiled, and the number in the shop's
//      certificate ("N of M limits proven to bite") is read from there. A mismatch stops the shop with the kill switch.
//   6. write status/<shop>.json for the panel
// Docker, the clock and sleeping go through the context, so the tests run all of this against a fake.
import { chownSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { composeServer } from "./generate/compose.ts";
import type { Composed, Dirs, PanelOptions, ShopDeploy } from "./generate/compose.ts";
import { inboxConfig, opsConfig, refresherConfig, relayConfig } from "./generate/configs.ts";
import type { ShopWebhooks } from "./generate/configs.ts";
import { PANEL_READS, guardToml } from "./generate/guards.ts";
import { agentFacts } from "./agent/applied.ts";
import { litestreamConfig } from "./generate/litestream.ts";
import { noSecretsIn, provenLine, toolNamesMatch, tripwiresHold } from "./generate/rules.ts";
import { names, planModelGuard, planShop } from "./generate/shop.ts";
import type { GuardPlan, ShopPlan } from "./generate/shop.ts";
import type { CompileResult, GuardTool, TripwireResult } from "./generate/verify.ts";
import { pathwayDirFor, pinnedRuntimeCheck } from "./lib/pathways.ts";
import type { Runner } from "./lib/runner.ts";
import { ensureSecret, panelUser, prepareSecretsRoot, readSecretFile, secretFile, takeSecrets, writeSecretFile } from "./lib/secrets.ts";
import { listShops, loadServer, readShop, serverPaths } from "./lib/server.ts";
import type { ServerConfig, ShopFolder } from "./lib/server.ts";
import { loadState, saveState, shopIndex } from "./lib/state.ts";
import type { Snapshot, State } from "./lib/state.ts";
import { readStatus, refusalMessage, updateStatus } from "./lib/status.ts";
import type { GuardProof } from "./lib/status.ts";
import { Refused, ensureDir, mintGuardToken, mintSecret, mintSigningKey, sha256Hex, stableJson, writeAtomic } from "./lib/util.ts";
import type { Problem } from "./lib/util.ts";

export interface Context {
  /** The server folder. */
  dir: string;
  /** The agents repository: the bundle's own code and the current pathway. */
  appDir: string;
  runner: Runner;
  tool: GuardTool;
  log: (line: string) => void;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  docker: string;
  /** Seconds to wait for the Guards after `up`. Default 120. */
  waitSeconds?: number;
  /** More compose files merged over the generated one (a test adds its stand-ins and a bucket this way). Never used by a real server. */
  extraComposeFiles?: string[];
}

export const composeFile = (dir: string) => join(serverPaths(dir).generated, "compose.yaml");

export function dirsOf(ctx: Context): Dirs {
  const p = serverPaths(ctx.dir);
  return { app: ctx.appDir, generated: p.generated, secrets: p.secrets, status: p.status, fleet: p.fleet, shops: p.shops, secretsInbox: p.secretsInbox, requests: p.requests, exports: p.exports, panelData: p.panel, config: p.config };
}

/** `docker compose` on this server's generated file. */
export function compose(ctx: Context, args: string[], options: { timeoutMs?: number } = {}) {
  return ctx.runner.run(ctx.docker, ["compose", "-f", composeFile(ctx.dir), ...(ctx.extraComposeFiles ?? []).flatMap((f) => ["-f", f]), "--project-directory", serverPaths(ctx.dir).generated, ...args], { timeoutMs: options.timeoutMs ?? 600_000 });
}

/** One command inside the ops container: the only way to a Guard's admin port. */
export const ops = (ctx: Context, args: string[]) => compose(ctx, ["exec", "-T", "ops", "node", "/app/bundle/services/ops.ts", ...args], { timeoutMs: 60_000 });

/** An admin call on one Guard, through ops. */
export async function adminCall(ctx: Context, service: string, method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  const r = await ops(ctx, ["admin", service, method, path, ...(body !== undefined ? [JSON.stringify(body)] : [])]);
  try { return JSON.parse(r.stdout.trim().split("\n").at(-1) ?? "") as { status: number; body: any }; } catch { return { status: 0, body: { error: `ops did not answer (${r.stderr.trim().slice(0, 200) || `exit ${r.code}`})` } }; }
}

// ---- secrets ---------------------------------------------------------------------------------------------------------------------------------

const pathOf = (dir: string, container: string, file: string) => secretFile(dir, container, ...file.split("/"));
const have = (dir: string, container: string, file: string) => !!readSecretFile(pathOf(dir, container, file));

function webhooksFor(dir: string, shop: string): ShopWebhooks {
  const meta = have(dir, "inbox", `${shop}/whatsapp_app_secret`);
  return { verification: !meta && have(dir, "inbox", `${shop}/whatsapp_path_token`) ? "path-token" : "meta-signature", hasGoogle: have(dir, "refresher", `${shop}/google_service_account.json`) || have(dir, "refresher", "_server/google_service_account.json"), ownGoogleKey: have(dir, "refresher", `${shop}/google_service_account.json`) };
}

/** What a shop needs before it can run, said by the name the panel hands it in under. */
function missingSecrets(dir: string, shop: string, webhooks: ShopWebhooks): Problem[] {
  const need = (container: string, file: string, handIn: string): Problem[] => have(dir, container, file) ? [] : [{ rule: `secret-missing:${handIn}`, message: `${shop}: ${handIn} has not been handed in. Put it in secrets-inbox/${shop}/${handIn} (the panel does this); it is moved to where only the right container can read it.` }];
  return [
    ...need(`g-${shop}-razorpay`, "razorpay_authorization", "razorpay_key"),
    ...need(`g-${shop}-whatsapp`, "whatsapp_authorization", "whatsapp_token"),
    ...need("inbox", `${shop}/razorpay_webhook_secret`, "razorpay_webhook_secret"),
    ...(webhooks.verification === "path-token" ? need("inbox", `${shop}/whatsapp_path_token`, "whatsapp_path_token") : [...need("inbox", `${shop}/whatsapp_app_secret`, "whatsapp_app_secret"), ...need("inbox", `${shop}/whatsapp_verify_token`, "whatsapp_verify_token")]),
    // the shop's own Google key, or (hosted mode) the one the server holds for every shop: `geometer google-key <file>`
    ...(have(dir, "refresher", "_server/google_service_account.json") ? [] : need("refresher", `${shop}/google_service_account.json`, "google_service_account.json")),
  ];
}

type Three = "razorpay" | "whatsapp" | "calendar";
interface Credentials { agent: Record<Three | "model" | "relay", string>; admin: Record<Three, string>; /** the panel's own agent at each Guard (only when the panel is on): the connection checks' reads, nothing else. One token: the panel reads ONE token file (golive.ts) and presents it to every Guard. */ panel?: string }

/** Every credential a shop's containers share: made once, kept in the file of the container that owns it, copied to the containers that must match. */
function ensureCredentials(dir: string, shop: string, panelOn: boolean): Credentials {
  const rt = names.runtime(shop);
  const internal = ensureSecret(secretFile(dir, rt, "internal_token"), mintSecret);
  const agent = {
    razorpay: ensureSecret(secretFile(dir, rt, "agent_razorpay"), mintGuardToken),
    whatsapp: ensureSecret(secretFile(dir, rt, "agent_whatsapp"), mintGuardToken),
    calendar: ensureSecret(secretFile(dir, rt, "agent_calendar"), mintGuardToken),
    model: ensureSecret(secretFile(dir, rt, "agent_model"), mintGuardToken),
    relay: ensureSecret(secretFile(dir, "relay", shop, "agent_whatsapp"), mintGuardToken),
  };
  const admin = Object.fromEntries((["razorpay", "whatsapp", "calendar"] as const).map((k) => [k, ensureSecret(secretFile(dir, "ops", shop, `admin_${k}`), mintGuardToken)])) as Credentials["admin"];
  for (const container of ["ops", "inbox", "relay"]) writeSecretFile(secretFile(dir, container, shop, "internal_token"), internal);
  writeSecretFile(secretFile(dir, "inbox", shop, "relay_token"), ensureSecret(secretFile(dir, "relay", shop, "relay_token"), mintSecret));
  writeSecretFile(secretFile(dir, "relay", shop, "owner_notify_secret"), ensureSecret(secretFile(dir, `g-${shop}-razorpay`, "owner_notify_secret"), mintSecret));
  writeSecretFile(secretFile(dir, "refresher", shop, "admin_token"), admin.calendar);
  ensureDir(secretFile(dir, `g-${shop}-calendar`));
  // The panel's agent token lives ONLY in the panel's folder (every Guard keeps its hash, under the agent `panel-<shop>`, allowed the reads and nothing else). 0600: the
  // panel runs as the user who wrote it. One token for the panel, not one per Guard: the panel reads a single token file and presents it to each Guard it checks.
  const panel = panelOn ? ensureSecret(secretFile(dir, "panel", names.panelGuardToken), mintGuardToken, 0o600) : undefined;
  return { agent, admin, ...(panel ? { panel } : {}) };
}

const sha = (value: string) => sha256Hex(value);
const agentsOf = (shop: string, kind: GuardPlan["kind"], c: Credentials) => [
  { id: names.agentId(shop), sha: sha(c.agent[kind as "razorpay"]) },
  ...(kind === "whatsapp" ? [{ id: names.relayAgentId(shop), sha: sha(c.agent.relay), operations: ["send"] }] : []),
  // the panel's own agent: allowed the read operations of its connection checks at this Guard and nothing else
  ...(c.panel && kind !== "model" ? [{ id: names.panelAgentId(shop), sha: sha(c.panel), operations: PANEL_READS[kind as Three] }] : []),
];

// ---- preparing a shop -----------------------------------------------------------------------------------------------------------------------

export interface PreparedGuard { plan: GuardPlan; version: number; contentHash: string; compiled?: CompileResult; toml?: string; tripwires?: TripwireResult }
interface Prepared { folder: ShopFolder; plan: ShopPlan; guards: PreparedGuard[]; webhooks: ShopWebhooks; pathwayDir: string; index: number; desiredHash: string }

export const contentHash = (spec: Record<string, unknown>) => sha256Hex(stableJson({ ...spec, version: 0 }));
/** What a shop is asked to be: its three files. A shop is up to date when this equals what was applied. */
// Fleet's button mode is part of what a shop is asked to be, so a flip redeploys it. It is only added to the hash when it is on, so a shop that never had it keeps the hash it has.
// The monthly report's two live facts (who set the shop up, the Innovator badge) are part of it too, so a change of either redeploys the shop and rewrites its runtime config. They are
// always in the hash, so every shop deployed before the report existed is redeployed once, which is what writes its `report` block.
export const desiredOf = (f: Pick<ShopFolder, "settingsText" | "runtime" | "lockText" | "pinsText" | "preparedBy" | "innovator"> & { fleetAi?: "buttons" }) => ({
  settings: f.settingsText, runtime: f.runtime, lock: f.lockText, pins: f.pinsText, ...(f.fleetAi ? { fleetAi: f.fleetAi } : {}), report: { preparedBy: f.preparedBy, innovator: f.innovator },
});
export const desiredHashOf = (f: Parameters<typeof desiredOf>[0]): string => sha256Hex(stableJson(desiredOf(f)));

/** Everything about one shop that can be decided and refused without starting anything. Takes the shop's handed-in secrets as a side effect. */
export async function prepareShop(ctx: Context, server: ServerConfig, state: State, name: string): Promise<{ prepared?: Prepared; problems: Problem[]; notes: string[] }> {
  const folder = readShop(ctx.dir, name);
  const taken = takeSecrets(ctx.dir, name);
  const problems: Problem[] = [...taken.problems];
  const notes = taken.unknown.map((u) => `${name}: secrets-inbox/${name}/${u} is not a name the bundle knows, so it was left where it is.`);
  const webhooks = webhooksFor(ctx.dir, name);
  const pathwayDir = folder.lock ? pathwayDirFor(ctx.appDir, ctx.dir, folder.lock) : undefined;
  // The settings the bundle adds to the generated config (`ai`, `report`) are judged by the check of the version the shop is PINNED to, not by this checkout's: a client held back
  // on an older version has a runtime that refuses a key it does not know.
  const check = pathwayDir ? await pinnedRuntimeCheck(pathwayDir) : undefined;
  const first = planShop(server, folder, {}, check);
  problems.push(...first.problems);
  notes.push(...first.notes);
  if (folder.lock && !pathwayDir) problems.push({ rule: "pathway-pin", message: `${name} is pinned to ${folder.lock.pathway}@${folder.lock.version}, but this server does not have that version. Put a checkout of it in ${join(serverPaths(ctx.dir).root, "pathways", `${folder.lock.pathway}@${folder.lock.version}`)}, or change the pin once that version has passed the crash test with this shop's settings.` });
  problems.push(...missingSecrets(ctx.dir, name, webhooks));
  // The key handed in must be the account the connection check confirmed: a different account is an error, never a silent switch.
  const pinned = folder.pins.razorpay;
  const authorization = pinned ? readSecretFile(secretFile(ctx.dir, `g-${name}-razorpay`, "razorpay_authorization")) : undefined;
  if (pinned && authorization) {
    const keyId = Buffer.from(authorization.replace(/^Basic /u, ""), "base64").toString("utf8").split(":")[0];
    if (keyId !== pinned.keyId) problems.push({ rule: "razorpay-key-matches-pin", message: `${name}: the Razorpay key handed in (id ${keyId}) is not the account the connection check confirmed (id ${pinned.keyId}). Check the account again before going on.` });
    else if (!keyId.startsWith(`rzp_${pinned.mode}_`)) problems.push({ rule: "razorpay-key-matches-pin", message: `${name}: the Razorpay key ${keyId} is not a ${pinned.mode}-mode key, which is what the connection check confirmed.` });
  }
  if (first.problems.length > 0 || !pathwayDir) return { problems, notes };

  // Guard loads a bundle only if its version is HIGHER than the one it already has: the same content keeps its version, changed content gets the next.
  const prev = state.shops[name]?.guards ?? {};
  const versions: Record<string, number> = {};
  for (const g of first.guards) versions[g.kind] = prev[g.kind]?.contentHash === contentHash(g.spec) ? prev[g.kind].version : (prev[g.kind]?.version ?? 0) + 1;
  const plan = planShop(server, folder, versions, check);
  // reserve the network index now, so two shops added together never share one (it is saved only when the deploy goes through)
  const index = (state.shops[name] ??= { index: shopIndex(state, name), guards: {}, lockHistory: [] }).index;
  return {
    prepared: { folder, plan, webhooks, pathwayDir, index, guards: plan.guards.map((g) => ({ plan: g, version: versions[g.kind], contentHash: contentHash(g.spec) })), desiredHash: desiredHashOf(folder) },
    problems, notes,
  };
}

export type Sha = { admin: string; agents: { id: string; sha: string; operations?: string[] }[] };

/** Compile one Guard's spec, render its guard.toml, run the tool-name rule and verify-bundle. Nothing running is touched. */
export async function compileAndVerify(ctx: Context, server: ServerConfig, shop: string | undefined, g: PreparedGuard, who: Sha): Promise<Problem[]> {
  const compiled = await ctx.tool.compile(g.plan.specText);
  if (!compiled.ok) return compiled.problems.map((p) => ({ ...p, message: `${g.plan.service}: ${p.message}` }));
  g.compiled = compiled.result;
  g.toml = guardToml({ def: g.plan.def, tenant: g.plan.tenant, deployment: g.plan.deployment, bundleDigest: compiled.result.digest, upstream: g.plan.upstream, adminSha: who.admin, agents: who.agents, ...(g.plan.kind === "razorpay" && shop ? { approver: { id: names.approverId(shop), secretFile: "/run/secrets/owner_notify_secret" } } : {}) });
  g.tripwires = await ctx.tool.verify(compiled.result.text, g.toml);
  return [...toolNamesMatch(g.plan, g.toml, compiled.result), ...tripwiresHold(g.plan, g.tripwires)];
}

/** Server-level things every deploy needs: the Guard image on this machine, the model's key, the deployment key. */
export async function serverProblems(ctx: Context, server: ServerConfig): Promise<Problem[]> {
  const problems: Problem[] = [];
  const image = await ctx.runner.run(ctx.docker, ["image", "inspect", "--format", "{{.Id}}", server.guardImage], { timeoutMs: 30_000 });
  if (image.code !== 0) problems.push({ rule: "guard-image", message: `The Guard image ${server.guardImage} is not on this machine. It is not published to a registry yet, so it cannot be pulled: load it with \`docker load < geo-guard.tar\` (the tarball Geometer gives you), or set "guardImage" in geometer.json to the name it was loaded under.` });
  const keyFile = server.model.wire === "anthropic" ? "model_api_key" : "model_authorization";
  if (!have(ctx.dir, "g-model", keyFile)) problems.push({ rule: "secret-missing:model_key", message: `The model's API key is not in place. Run \`geometer model-key <file>\` (a file with the key on one line); it goes to the model Guard only.` });
  if (server.backup && !have(ctx.dir, "backup", "stream")) problems.push({ rule: "secret-missing:backup-key", message: "The continuous copy's bucket key is not in place. Run `geometer backup-key stream <file>` (the file has `access-key-id:secret` on one line)." });
  if (server.backup && !have(ctx.dir, "backup", "snapshots") && server.backup.snapshots.url.startsWith("s3://")) problems.push({ rule: "secret-missing:backup-key", message: "The snapshot bucket's key is not in place. Run `geometer backup-key snapshots <file>`." });
  if (server.fleet && !readSecretFile(resolve(ctx.dir, server.fleet.keyFile))) problems.push({ rule: "fleet-key", message: `The deployment key file ${server.fleet.keyFile} is missing, so no heartbeat could be sent and Geometer's alerts from outside would never fire.` });
  return problems;
}

/** `check`: everything a deploy would check, offline. It starts nothing and touches nothing that is running (it does take the secrets handed in out of the inbox, and make any token that is missing). */
export async function checkShop(ctx: Context, name: string): Promise<{ ok: boolean; problems: Problem[]; notes: string[]; lines: string[] }> {
  const server = loadServer(ctx.dir);
  const state = loadState(ctx.dir);
  const { prepared, problems, notes } = await prepareShop(ctx, server, state, name);
  problems.push(...await serverProblems(ctx, server));
  const lines: string[] = [];
  if (prepared) {
    const creds = ensureCredentials(ctx.dir, name, server.panel.enabled);
    for (const g of prepared.guards) {
      problems.push(...await compileAndVerify(ctx, server, name, g, { admin: sha(creds.admin[g.plan.kind as "razorpay"]), agents: agentsOf(name, g.plan.kind, creds) }));
      if (g.tripwires) lines.push(`${g.plan.service}: ${provenLine(g.tripwires)}`);
    }
  }
  return { ok: problems.length === 0, problems, notes, lines };
}

// ---- writing the server and bringing it up ------------------------------------------------------------------------------------------------

function deployOf(name: string, shop: { index: number; applied?: Snapshot }): ShopDeploy {
  const s = shop.applied!;
  return { name, index: shop.index, pathwayDir: s.pathwayDir, guards: Object.values(s.guards).map((g) => ({ kind: g.kind as GuardPlan["kind"], service: g.service, tenant: name })) };
}

/** Write every generated file for the whole server from what has been applied, and return the compose text. */
export function writeServer(ctx: Context, server: ServerConfig, state: State): Composed {
  const p = serverPaths(ctx.dir);
  const applied = Object.entries(state.shops).filter(([, s]) => s.applied).sort(([a], [b]) => (a < b ? -1 : 1));
  const shops = applied.map(([name, s]) => {
    const snap = s.applied!;
    const settings = JSON.parse(snap.settingsText) as { owner: { whatsapp: string } };
    const runtime = snap.runtime as { services: { messaging: { phoneNumberId: string } } };
    return { ...deployOf(name, s), webhooks: webhooksFor(ctx.dir, name), ownerWhatsapp: settings.owner.whatsapp, phoneNumberId: runtime.services.messaging.phoneNumberId, pathwayVersion: snap.pathway.split("@")[1] };
  });
  for (const [name, s] of applied) {
    const client = join(p.generated, "shops", name, "client");
    writeAtomic(join(client, "settings.json"), s.applied!.settingsText);
    writeAtomic(join(client, "runtime.json"), stableJson(s.applied!.runtime));
    writeAtomic(join(client, "pathway.lock"), s.applied!.lockText);
    for (const g of Object.values(s.applied!.guards)) writeGuardFiles(ctx.dir, g.service, g);
  }
  if (state.modelApplied) writeGuardFiles(ctx.dir, names.modelGuard, state.modelApplied);
  // agents someone else wrote stay in the compose file whenever a shop is deployed (without this, `up --remove-orphans` would take their Guards away)
  const agents = agentFacts(ctx.dir, state);
  for (const a of Object.values(state.agents ?? {})) if (a.applied) for (const g of Object.values(a.applied.guards)) writeGuardFiles(ctx.dir, g.service, g);
  writeAtomic(join(p.generated, "inbox", "inbox.json"), inboxConfig(server, shops, agents));
  writeAtomic(join(p.generated, "relay", "relay.json"), relayConfig(server, shops, agents));
  writeAtomic(join(p.generated, "refresher", "refresher.json"), refresherConfig(server, shops, {}, agents));
  writeAtomic(join(p.generated, "ops", "ops.json"), opsConfig(server, shops, agents));
  // the deployment key goes to the one container that sends heartbeats
  if (server.fleet) writeSecretFile(secretFile(ctx.dir, "ops", "fleet_key"), readSecretFile(resolve(ctx.dir, server.fleet.keyFile)) ?? "");
  if (server.backup) {
    const [accessKeyId, ...secret] = (readSecretFile(secretFile(ctx.dir, "backup", "stream")) ?? ":").split(":");
    writeSecretFile(secretFile(ctx.dir, "litestream", "litestream.yml"), litestreamConfig(server.backup, shops.map((s) => s.name), { accessKeyId, secretAccessKey: secret.join(":") }));
  }
  // the folder ops writes fleet's answers into: made for the user ops runs as (the one who runs the deployer, like the panel), so both can read and write it
  ensureDir(p.fleet);
  const opsUser = panelUser();
  if (process.getuid?.() === 0) chownSync(p.fleet, opsUser.uid, opsUser.gid);
  const composed = composeServer(server, dirsOf(ctx), shops, { backup: !!server.backup, opsUser: `${opsUser.uid}:${opsUser.gid}`, ...(server.panel.enabled ? { panel: preparePanel(ctx) } : {}), ...(agents.length > 0 ? { agents } : {}) });
  writeAtomic(composeFile(ctx.dir), composed.compose);
  writeAtomic(join(p.generated, "Caddyfile"), composed.caddyfile);
  return composed;
}

/**
 * What the panel container needs from the host: two keys (0600, in secrets/panel/, which the panel refuses to use if anyone else could read them), folders it can write
 * (the shops, the secrets inbox, stop requests, its own data) and the user to run as. It is given NO other folder of the server.
 */
function preparePanel(ctx: Context): PanelOptions {
  const p = serverPaths(ctx.dir);
  // data_key: 32 bytes as hex (vault.ts). signing_key: an Ed25519 private key in PEM, as the pathway's report key is (modules/report/sign.ts loadPrivateKey); it signs go-live certificates.
  for (const [name, make] of [["data_key", mintSecret], ["signing_key", mintSigningKey]] as const) {
    const path = secretFile(ctx.dir, "panel", name);
    if (!readSecretFile(path)) writeSecretFile(path, make(), 0o600);
  }
  const { uid, gid } = panelUser();
  for (const d of [p.shops, p.secretsInbox, p.requests, p.exports, p.panel, p.status]) {
    ensureDir(d);
    if (process.getuid?.() === 0 && d !== p.exports && d !== p.status) chownSync(d, uid, gid); // a deployer running as root hands the panel's folders to the user the panel runs as
  }
  const server = secretFile(ctx.dir, "refresher", "_server", "google_service_account.json");
  let shareAddress: string | undefined;
  try { shareAddress = (JSON.parse(readFileSync(server, "utf8")) as { client_email?: string }).client_email; } catch { /* no server-wide key */ }
  const run = existsSync(join(ctx.appDir, "bundle", "panel", "main.ts"));
  if (!run) ctx.log("note: the panel is switched on in geometer.json, but this checkout has no bundle/panel/main.ts, so no panel container is started (its network, keys and Guard agents are still made).");
  return { user: `${uid}:${gid}`, run, ...(shareAddress ? { shareAddress } : {}) };
}

function writeGuardFiles(dir: string, service: string, g: { specText: string; bundleText: string; tomlText: string }): void {
  const folder = join(serverPaths(dir).generated, "guards", service);
  writeAtomic(join(folder, "spec.json"), g.specText);
  writeAtomic(join(folder, "bundle.json"), g.bundleText);
  writeAtomic(join(folder, "guard.toml"), g.tomlText);
}

/** The compose entry of a service, and what is in the files it mounts, as two hashes: a changed entry is recreated by compose, changed files need a restart. */
function serviceHashes(composed: Composed, name: string): { block: string; files: string } {
  const s = composed.services[name];
  return { block: sha256Hex(stableJson(s.block)), files: sha256Hex(stableJson(s.files.map((f) => (existsSync(f) ? sha256Hex(readFileSync(f, "utf8")) : "")))) };
}

export interface ShopResult { shop: string; proven: { passed: number; of: number; line: string }; guards: Record<string, GuardProof> }

/**
 * Deploy one shop, or all shops. Returns what was proven on the running Guards. Throws Refused, naming every broken rule, before anything is changed.
 */
export async function deploy(ctx: Context, only?: string): Promise<ShopResult[]> {
  const targets = only ? [only] : listShops(ctx.dir);
  const known = targets.filter((t) => existsSync(serverPaths(ctx.dir).shop(t)));
  const before = new Map(known.map((shop) => [shop, readStatus(ctx.dir, shop)?.deploy]));
  for (const shop of known) updateStatus(ctx.dir, shop, ctx.now(), (s) => { s.deploy = { state: "in-progress", at: ctx.now().toISOString() }; });
  try {
    return await deployChecked(ctx, only);
  } catch (e) {
    if (e instanceof Refused) {
      // A refusal names its shop in its message. One that names none (the Guard image, the model's key) is every target's; one that names another shop is not mine.
      const names = (p: Problem) => known.filter((k) => new RegExp(`(^|[^a-z0-9-])${k}([^a-z0-9-]|$)`, "u").test(p.message));
      for (const shop of known) {
        const why = e.problems.filter((p) => { const n = names(p); return n.length === 0 || n.includes(shop); });
        updateStatus(ctx.dir, shop, ctx.now(), (s) => { s.deploy = why.length > 0 ? { state: "failed", at: ctx.now().toISOString(), message: refusalMessage(why), refusal: why } : before.get(shop) ?? { state: "never" }; }, why.length > 0);
      }
    }
    throw e;
  }
}

async function deployChecked(ctx: Context, only?: string): Promise<ShopResult[]> {
  const server = loadServer(ctx.dir);
  prepareSecretsRoot(ctx.dir);
  const state = loadState(ctx.dir);
  const targets = only ? [only] : listShops(ctx.dir);
  if (targets.length === 0) throw new Refused([{ rule: "no-shops", message: "There are no shops yet. Add one with `geometer shop add <name> --from <client folder>`." }]);

  // 1. plan every target and refuse on anything that can be seen without compiling
  const prepared: Prepared[] = [];
  const problems: Problem[] = await serverProblems(ctx, server);
  for (const name of targets) {
    const r = await prepareShop(ctx, server, state, name);
    problems.push(...r.problems);
    r.notes.forEach((n) => ctx.log(`note: ${n}`));
    if (r.prepared) prepared.push(r.prepared);
  }
  if (problems.length > 0) throw new Refused(problems);

  // 2. credentials, then compile and verify every Guard (the model Guard knows every shop's runtime, so it is verified again whenever a shop is added)
  const creds = new Map(prepared.map((p) => [p.folder.name, ensureCredentials(ctx.dir, p.folder.name, server.panel.enabled)]));
  for (const p of prepared) for (const g of p.guards) problems.push(...await compileAndVerify(ctx, server, p.folder.name, g, { admin: sha(creds.get(p.folder.name)!.admin[g.plan.kind as "razorpay"]), agents: agentsOf(p.folder.name, g.plan.kind, creds.get(p.folder.name)!) }));
  const everyShop = [...new Set([...Object.entries(state.shops).filter(([, s]) => s.applied).map(([n]) => n), ...prepared.map((p) => p.folder.name)])].sort();
  const modelAdmin = ensureSecret(secretFile(ctx.dir, "ops", "_model", "admin_token"), mintGuardToken);
  const modelPlan = planModelGuard(server, 1);
  const prevModel = state.model;
  const modelVersion = prevModel?.contentHash === contentHash(modelPlan.spec) ? prevModel.version : (prevModel?.version ?? 0) + 1;
  const model: PreparedGuard = { plan: planModelGuard(server, modelVersion), version: modelVersion, contentHash: contentHash(modelPlan.spec) };
  const modelAgents = everyShop.map((s) => ({ id: names.agentId(s), sha: sha(creds.get(s)?.agent.model ?? readSecretFile(secretFile(ctx.dir, names.runtime(s), "agent_model")) ?? "") }));
  problems.push(...await compileAndVerify(ctx, server, undefined, model, { admin: sha(modelAdmin), agents: modelAgents }));
  if (problems.length > 0) throw new Refused(problems);

  // 3. nothing broken: no secret in any file we are about to write, then write
  const configs: Record<string, string> = {};
  for (const p of prepared) {
    configs[`${p.folder.name}/runtime.json`] = stableJson(p.plan.runtime);
    for (const g of p.guards) { configs[`${g.plan.service}/spec.json`] = g.plan.specText; configs[`${g.plan.service}/guard.toml`] = g.toml!; }
  }
  configs["g-model/guard.toml"] = model.toml!;
  const secretValues = prepared.flatMap((p) => { const c = creds.get(p.folder.name)!; return [...Object.values(c.agent), ...Object.values(c.admin), ...Object.values(c.panel ?? {}), ...["razorpay_authorization", "whatsapp_authorization"].map((f) => readSecretFile(secretFile(ctx.dir, `g-${p.folder.name}-${f.split("_")[0]}`, f)) ?? ""), readSecretFile(secretFile(ctx.dir, names.runtime(p.folder.name), "internal_token")) ?? ""]; });
  const leaks = noSecretsIn(configs, secretValues.filter(Boolean));
  if (leaks.length > 0) throw new Refused(leaks);

  const at = ctx.now().toISOString();
  for (const p of prepared) {
    const s = state.shops[p.folder.name];
    const previousLock = s.applied?.lockText;
    if (previousLock !== undefined && previousLock !== p.folder.lockText) s.lockHistory.push(previousLock);
    for (const g of p.guards) s.guards[g.plan.kind] = { version: g.version, contentHash: g.contentHash, digest: g.compiled!.digest, tripwires: { passed: g.tripwires!.passed, of: g.tripwires!.of, notSelfTestable: g.tripwires!.notSelfTestable } };
    s.applied = {
      appliedAt: at, pathway: `${p.folder.lock!.pathway}@${p.folder.lock!.version}`, lockText: p.folder.lockText, settingsText: p.folder.settingsText, runtime: p.plan.runtime, pathwayDir: p.pathwayDir, desiredHash: p.desiredHash,
      guards: Object.fromEntries(p.guards.map((g) => [g.plan.kind, { kind: g.plan.kind, service: g.plan.service, specText: g.plan.specText, bundleText: g.compiled!.text, tomlText: g.toml! }])),
    };
    s.lastDeployAt = at;
  }
  state.model = { version: model.version, contentHash: model.contentHash, digest: model.compiled!.digest, tripwires: { passed: model.tripwires!.passed, of: model.tripwires!.of, notSelfTestable: model.tripwires!.notSelfTestable } };
  state.modelApplied = { kind: "model", service: names.modelGuard, specText: model.plan.specText, bundleText: model.compiled!.text, tomlText: model.toml! };
  const composed = writeServer(ctx, server, state);

  // 4. only what changed: compose recreates a service whose entry changed; a service whose FILES changed (compose cannot see that) is restarted
  const changed = await bringUp(ctx, state, composed, prepared.map((p) => p.folder.name));

  // 5. the RUNNING Guards say what they enforce, the model Guard's among them
  const results: ShopResult[] = [];
  const modelProof = await proveRunning(ctx, [model]);
  if (modelProof.problems.length > 0) throw new Refused(modelProof.problems);
  for (const p of prepared) {
    const proof = await proveRunning(ctx, p.guards);
    if (proof.problems.length === 0) await renewRelayCredential(ctx, p.folder.name);
    const stop = state.shops[p.folder.name].stopped;
    if (stop) await ops(ctx, ["stop", p.folder.name, "on", "-", stop.reason]); // a recreated Guard keeps its kill switch in its store; this makes sure
    const total = Object.values(proof.guards).reduce((t, g) => ({ passed: t.passed + g.passed, of: t.of + g.of }), { passed: 0, of: 0 });
    const line = provenLine({ ...total, notSelfTestable: Object.values(proof.guards).flatMap((g) => g.notSelfTestable) });
    updateStatus(ctx.dir, p.folder.name, ctx.now(), (s) => {
      s.deploy = proof.problems.length === 0 ? { state: "applied", at } : { state: "failed", at, message: refusalMessage(proof.problems), refusal: proof.problems };
      s.limits = { proven: total.passed, of: total.of, unprovable: [...new Set(Object.values(proof.guards).flatMap((g) => g.notSelfTestable))], line, perGuard: proof.guards, model: modelProof.guards.model };
      s.versions = { pathway: state.shops[p.folder.name].applied!.pathway, bundle: opsBundleVersion(), guard: server.guardImage, guards: Object.fromEntries(Object.entries(state.shops[p.folder.name].guards).map(([k, v]) => [k, v.version])) };
      if (stop) s.stopped = { at: stop.at, by: stop.by, reason: stop.reason, ...(stop.requestId ? { requestId: stop.requestId } : {}) }; else delete s.stopped;
      s.webhooks = { razorpay: `https://${server.domain}/c/${p.folder.name}/webhooks/razorpay`, whatsapp: `https://${server.domain}/c/${p.folder.name}/webhooks/whatsapp` };
    });
    if (proof.problems.length > 0) {
      await ops(ctx, ["stop", p.folder.name, "on", "the deployer", "a running Guard did not match what was checked"]);
      throw new Refused(proof.problems);
    }
    results.push({ shop: p.folder.name, proven: { ...total, line }, guards: proof.guards });
  }
  ctx.log(`Changed services: ${changed.length === 0 ? "none" : changed.join(", ")}`);
  return results;
}

/**
 * Bring up what changed in the compose file just written, and nothing else: compose recreates a service whose entry changed, and a service whose FILES changed (compose cannot see
 * that) is restarted. Shared by the deploy of a shop and of an agent someone else wrote, so the two cannot drift apart. Returns the services that changed.
 */
export async function bringUp(ctx: Context, state: State, composed: Composed, forWhom: string[]): Promise<string[]> {
  const hashes = Object.fromEntries(Object.keys(composed.services).map((n) => [n, serviceHashes(composed, n)]));
  const before = state.serviceHashes ?? {};
  ctx.log(`Bringing up ${forWhom.join(", ")}...`);
  // A new shop's Calendar Guard mounts its own sub-folder of the token volume, and Docker cannot even create that container before the folder exists. The refresher
  // makes every shop's folder when it starts, so a refresher that is already running with the old list is restarted FIRST, and waited for.
  if (before.refresher && before.refresher.block === hashes.refresher.block && before.refresher.files !== hashes.refresher.files) {
    await compose(ctx, ["restart", "refresher"]);
    for (let i = 0; i < 40; i++) { const ps = await compose(ctx, ["ps", "refresher"], { timeoutMs: 30_000 }); if (/\(healthy\)/u.test(ps.stdout)) break; await ctx.sleep(3_000); }
  }
  const up = await compose(ctx, ["up", "-d", "--remove-orphans"]);
  if (up.code !== 0) throw new Refused([{ rule: "compose-up", message: `docker compose up failed: ${up.stderr.trim().split("\n").slice(-3).join(" | ")}. ${await whatIsNotUp(ctx)}` }]);
  // A Guard shares its forwarder's network namespace. If the forwarder was recreated (a shop added changes the model forwarder's networks), the Guard must
  // be recreated too, or it is left in a namespace that no longer exists. Compose does this for a dependent; this makes sure, and costs one restart at most.
  const stranded = Object.keys(hashes).filter((n) => n.startsWith("fwd-") && before[n] && before[n].block !== hashes[n].block && before[`g-${n.slice(4)}`]).map((n) => `g-${n.slice(4)}`);
  if (stranded.length > 0) {
    ctx.log(`Recreating ${stranded.join(", ")} (their forwarder's networks changed).`);
    const r = await compose(ctx, ["up", "-d", "--force-recreate", "--no-deps", ...stranded]);
    if (r.code !== 0) throw new Refused([{ rule: "compose-recreate", message: `docker compose could not recreate ${stranded.join(", ")}: ${r.stderr.trim().split("\n").slice(-4).join(" | ")}` }]);
  }
  const restart = Object.keys(hashes).filter((n) => before[n] && before[n].block === hashes[n].block && before[n].files !== hashes[n].files && !stranded.includes(n) && n !== "refresher");
  const changed = Object.keys(hashes).filter((n) => !before[n] || before[n].block !== hashes[n].block || before[n].files !== hashes[n].files);
  if (restart.length > 0) {
    ctx.log(`Restarting ${restart.join(", ")} (their files changed).`);
    const r = await compose(ctx, ["restart", ...restart]);
    if (r.code !== 0) throw new Refused([{ rule: "compose-restart", message: `docker compose restart failed: ${r.stderr.trim().split("\n").slice(-4).join(" | ")}` }]);
  }
  state.serviceHashes = hashes;
  saveState(ctx.dir, state);
  return changed;
}

/** After a failed `up`: which services are not running well, and the last lines each one said (they hold no secret: our programs never log one). */
async function whatIsNotUp(ctx: Context): Promise<string> {
  const ps = await compose(ctx, ["ps", "-a", "--format", "{{.Service}}\t{{.Status}}"], { timeoutMs: 60_000 });
  const bad = ps.stdout.trim().split("\n").map((l) => l.split("\t")).filter(([service, status]) => status !== undefined && !/\((healthy)\)|^Up (?!.*\((unhealthy|health: starting)\))/u.test(status) && !(service.startsWith("rd-") && /^Exited \(0\)/u.test(status))).map(([service, status]) => `${service}: ${status}`);
  if (bad.length === 0) return "";
  const logs = await compose(ctx, ["logs", "--no-color", "--tail", "6", ...bad.slice(0, 4).map((b) => b.split(":")[0])], { timeoutMs: 60_000 });
  return `Not running well: ${bad.slice(0, 6).join("; ")}. Their last lines: ${logs.stdout.trim().split("\n").slice(-12).join(" | ").slice(0, 900)}`;
}

const opsBundleVersion = (): string => (JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string }).version;

/** A fresh reading credential for the shop's relay (an approver credential that expires: the production profile requires it), written where only the relay reads it. */
export async function renewRelayCredential(ctx: Context, shop: string, ttlSeconds = 7 * 86_400): Promise<boolean> {
  const r = await ops(ctx, ["issue-approver", shop, String(ttlSeconds)]);
  const token = r.stdout.trim().split("\n").at(-1) ?? "";
  if (r.code !== 0 || !/^gg_[0-9a-f]{32}$/u.test(token)) { ctx.log(`${shop}: the relay's reading credential could not be renewed (${r.stderr.trim().slice(0, 150) || `exit ${r.code}`}).`); return false; }
  writeSecretFile(secretFile(ctx.dir, "relay", shop, "read_token"), token);
  return true;
}

/** Wait for the shop's Guards, then read their policy and tripwires from the running processes. */
export async function proveRunning(ctx: Context, guards: PreparedGuard[]): Promise<{ guards: Record<string, GuardProof>; problems: Problem[] }> {
  const out: Record<string, GuardProof> = {};
  const problems: Problem[] = [];
  const tries = Math.max(1, Math.ceil((ctx.waitSeconds ?? 120) / 3));
  for (const g of guards) {
    let status: { status: number; body: any } = { status: 0, body: null };
    for (let attempt = 0; attempt < tries; attempt++) {
      status = await adminCall(ctx, g.plan.service, "GET", "/admin/status");
      if (status.status === 200 && status.body?.tripwires?.ran === true) break;
      if (attempt < tries - 1) await ctx.sleep(3_000);
    }
    const b = status.body;
    const digest: string | undefined = b?.policy?.digest;
    const t = b?.tripwires;
    if (status.status !== 200 || !t?.ran) { problems.push({ rule: `running-guard:${g.plan.service}`, message: `${g.plan.service} did not report its tripwires within ${ctx.waitSeconds ?? 120} s, so nothing is claimed about it.` }); continue; }
    out[g.plan.kind] = { passed: Number(t.passed), of: Number(t.of), notSelfTestable: (t.not_self_testable_items ?? []).map((i: { item: string }) => i.item), policyDigest: digest ?? "", version: g.version, ready: t.ok === true };
    if (digest !== g.compiled!.digest) problems.push({ rule: `running-guard:${g.plan.service}`, message: `${g.plan.service} is running the policy ${String(digest)}, not the one that was checked (${g.compiled!.digest}). The shop has been stopped.` });
    if (t.ok !== true) problems.push({ rule: `tripwire:${(t.failed ?? []).join(",") || g.plan.service}`, message: `${g.plan.service}'s tripwires failed on the running Guard (${t.passed} of ${t.of}). The shop has been stopped.` });
  }
  return { guards: out, problems };
}

export { Refused };
