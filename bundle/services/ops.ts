// `ops` is the one container that holds every Guard's admin credential and can reach every Guard's admin port (through the forwarders on the admin
// network). It does two things:
//   run                                  every 60 s, send the heartbeat to Geometer's fleet service (heartbeat.ts)
//   <command>                            what the host-side deployer runs with `docker compose exec ops node ops.ts <command>`, because the deployer cannot
//                                        reach container addresses on every host (Docker Desktop) and the admin ports are never published:
//     admin <guard-service> <METHOD> <path> [json]     one admin call, answered as {"status":200,"body":...}
//     observe                                          everything the heartbeat reads, as JSON (what `geometer status` shows)
//     stop <shop> <on|off> <by> <reason>               the kill switch on all three of the shop's Guards, and the shop's agent on the model Guard
//     recover <shop> <request-id> <case> <action>      ask the shop's runtime to look again or ask again about one booking or fee (POST /internal/recover); answered as {"status":200}
//     issue-approver <shop> <ttl-seconds>              a fresh reading credential for the shop's relay, printed once on stdout
//   Nothing in this file logs a token, and the body of a heartbeat has no message text in it.
import { existsSync, readFileSync } from "node:fs";
import { parseKey } from "../../modules/record/key-file.ts";
import { OWN_API, isGatewayKind } from "../../modules/payments/providers/index.ts";
import { readUsageBaseline, writeAnswerFiles, writeLeaseInbox, writeUsageBaseline } from "../lib/fleet.ts";
import type { UsageBaseline } from "../lib/fleet.ts";
import type { UsageTotals } from "../lib/usage.ts";
import { buildHeartbeat, sendHeartbeat } from "./heartbeat.ts";
import type { AdminStatus, BackupFacts, Baseline, GuardObservation, RuntimeStatus, ShopObservation } from "./heartbeat.ts";

export interface OpsGuard { id: string; service: string; adminUrl: string; healthUrl: string; adminTokenFile: string; /** The Guard's agent port (an agent someone else wrote: where the reading agent looks at the service's state). */ agentUrl?: string }
/** An agent someone else wrote: its Guards, and nothing the bundle runs (no runtime). */
export interface OpsOwnAgent { createdAt: string; recordTokenFile: string; /** The label key (B69): see agent/facts.ts. */ labelKeyFile: string; ownerWhatsapp: string; calendarId?: string; /** The deployer's status file for the agent: its backup and drill (B51). Left out: no backup fields are sent. */ statusFile?: string; guards: OpsGuard[] }
export interface OpsConfig {
  deploymentId: string;
  bundleVersion: string;
  heartbeatSeconds?: number;
  fleet?: { url: string; keyFile: string };
  /** The panel's address (https://<domain>), sent in the heartbeat as `panel_url` so the builder's account page can link to it. Left out: no panel here. */
  panelUrl?: string;
  /** The one folder ops can write (<server>/fleet): fleet's answer for each shop, and the usage baseline. Left out: the baseline is kept in memory only and no answer is written. */
  fleetDir?: string;
  shops: Record<string, { pathway: string; pathwayVersion: string; runtimeUrl: string; internalTokenFile: string; /** The deployer's status file for this shop (read-only here). Left out: no backup fields are sent. */ statusFile?: string; guards: OpsGuard[] }>;
  model: OpsGuard;
  ownAgents?: Record<string, OpsOwnAgent>;
}

const readSecret = (path: string): string => (existsSync(path) ? readFileSync(path, "utf8").trim() : "");
const timeout = () => AbortSignal.timeout(4_000);

export async function adminCall(g: Pick<OpsGuard, "adminUrl" | "adminTokenFile">, method: string, path: string, body?: unknown, fetchFn: typeof fetch = fetch): Promise<{ status: number; body: unknown }> {
  try {
    const r = await fetchFn(`${g.adminUrl.replace(/\/+$/u, "")}${path}`, { method, headers: { authorization: `Bearer ${readSecret(g.adminTokenFile)}`, "content-type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10_000) });
    const text = await r.text();
    let parsed: unknown = text;
    try { parsed = JSON.parse(text); } catch { /* not JSON */ }
    return { status: r.status, body: parsed };
  } catch (e) { return { status: 0, body: { error: `could not be reached (${(e as { cause?: { code?: string } }).cause?.code ?? (e as Error).name})` } }; }
}

async function get(url: string, headers: Record<string, string> = {}, fetchFn: typeof fetch = fetch): Promise<{ status: number; json: unknown }> {
  try {
    const r = await fetchFn(url, { headers, signal: timeout() });
    const text = await r.text();
    let json: unknown = null;
    try { json = JSON.parse(text); } catch { /* plain text */ }
    return { status: r.status, json };
  } catch { return { status: 0, json: null }; }
}

/** Whether a Guard can hold a call for the owner, so the heartbeat counts what it holds: a gateway's (refunds), or an agent's own API's (B71 part 2). By its kind, never a provider's name. */
const holdsCalls = (guardId: string): boolean => { const kind = guardId.replace(/^guard-/u, ""); return isGatewayKind(kind) || kind === OWN_API; };

export async function observeGuard(g: OpsGuard, withHeld: boolean, fetchFn: typeof fetch = fetch): Promise<GuardObservation> {
  const [health, status, held] = await Promise.all([
    get(`${g.healthUrl}/readyz`, {}, fetchFn),
    adminCall(g, "GET", "/admin/status", undefined, fetchFn),
    withHeld ? adminCall(g, "GET", "/admin/approvals?state=pending", undefined, fetchFn) : Promise.resolve(null),
  ]);
  const list = held && held.status === 200 && Array.isArray((held.body as { approvals?: unknown }).approvals) ? (held.body as { approvals: unknown[] }).approvals.length : held && held.status === 200 && Array.isArray(held.body) ? (held.body as unknown[]).length : null;
  return { id: g.id, healthReady: health.status === 200, admin: status.status === 200 ? (status.body as AdminStatus) : null, held: withHeld ? list : 0 };
}

/**
 * The backup times the deployer recorded for a shop, from its status file. Only three fields are taken, each checked for its type; the drill's free-text reason
 * (`drillDetail`) and everything else in the file are never read into the heartbeat. A missing or unreadable file is `undefined`: no backup field is sent,
 * which fleet reads as "nothing to report", never as a problem.
 */
export function readBackups(statusFile: string | undefined): BackupFacts | undefined {
  if (!statusFile) return undefined;
  try {
    const b = (JSON.parse(readFileSync(statusFile, "utf8")) as { backups?: Record<string, unknown> | null }).backups;
    if (typeof b !== "object" || b === null) return undefined;
    return { lastCopyAt: typeof b.lastCopyAt === "string" ? b.lastCopyAt : null, lastDrillAt: typeof b.lastDrillAt === "string" ? b.lastDrillAt : null, drillOk: typeof b.drillOk === "boolean" ? b.drillOk : null };
  } catch { return undefined; }
}

/**
 * The cost meter's cumulative counts the 15-minute export wrote into a shop's status file. Only the numbers are taken, each checked; a file with any of them
 * missing or wrong has no usable counts, and then nothing is sent for the shop and its baseline stays where it was.
 */
export function readUsage(statusFile: string | undefined): UsageTotals | undefined {
  if (!statusFile) return undefined;
  try {
    const u = (JSON.parse(readFileSync(statusFile, "utf8")) as { usage?: Record<string, any> | null }).usage;
    if (typeof u !== "object" || u === null || typeof u.byStep !== "object" || u.byStep === null || typeof u.whatsapp !== "object" || u.whatsapp === null) return undefined;
    const n = [u.messages, u.byStep.rules, u.byStep.decision, u.byStep.model, u.modelMicroInr, u.whatsapp.service, u.whatsapp.utility, u.whatsapp.marketing, u.whatsapp.estMicroInr];
    if (!n.every((v) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0)) return undefined;
    const ok = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
    const unpriced = ok(u.unpriced) ? { unpriced: u.unpriced } : {}; // optional: an older status file has none
    // the badges' counts, optional the same way: each is taken only whole, never half a language list
    const reports = ok(u.reportsSent) ? { reportsSent: u.reportsSent } : {};
    const r = u.repliesByLanguage;
    const replies = typeof r === "object" && r !== null && ok(r.hi) && ok(r.en) && ok(r.ml) && ok(r.kn) ? { repliesByLanguage: { hi: r.hi, en: r.en, ml: r.ml, kn: r.kn } } : {};
    return { messages: n[0], byStep: { rules: n[1], decision: n[2], model: n[3] }, modelMicroInr: n[4], ...unpriced, whatsapp: { service: n[5], utility: n[6], marketing: n[7], estMicroInr: n[8], estimated: u.whatsapp.estimated === true }, ...reports, ...replies };
  } catch { return undefined; }
}

/** The unfinished-work counts by kind the 15-minute export wrote into a shop's status file (`obligations.counts`). Only counts are taken; anything else is unknown. */
export function readObligations(statusFile: string | undefined): Record<string, number> | undefined {
  if (!statusFile) return undefined;
  try {
    const o = (JSON.parse(readFileSync(statusFile, "utf8")) as { obligations?: { counts?: unknown } | null }).obligations?.counts;
    if (typeof o !== "object" || o === null || Array.isArray(o)) return undefined;
    const entries = Object.entries(o as Record<string, unknown>);
    return entries.every(([, v]) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0) ? Object.fromEntries(entries) as Record<string, number> : undefined;
  } catch { return undefined; }
}

export async function observeShop(id: string, c: OpsConfig["shops"][string], fetchFn: typeof fetch = fetch): Promise<ShopObservation> {
  const token = readSecret(c.internalTokenFile);
  const [healthz, readyz, status, guards] = await Promise.all([
    get(`${c.runtimeUrl}/healthz`, {}, fetchFn), get(`${c.runtimeUrl}/readyz`, {}, fetchFn),
    get(`${c.runtimeUrl}/status`, { authorization: `Bearer ${token}` }, fetchFn),
    Promise.all(c.guards.map((g) => observeGuard(g, holdsCalls(g.id), fetchFn))),
  ]);
  const backups = readBackups(c.statusFile);
  const usage = readUsage(c.statusFile);
  const obligations = readObligations(c.statusFile);
  return { id, pathway: c.pathway, pathwayVersion: c.pathwayVersion, up: healthz.status === 200, ready: readyz.status === 200, status: status.status === 200 ? (status.json as RuntimeStatus) : null, guards, ...(backups ? { backups } : {}), ...(usage ? { usage } : {}), ...(obligations ? { obligations } : {}) };
}

type WithCounts = AdminStatus & { counts?: { decisions?: number } };

/**
 * An agent someone else wrote, seen the way the heartbeat sees a shop. It has no runtime, so "up" and "ready" are about the part Geometer runs, its Guards: up when every one answers,
 * ready when every one is ready (the fleet alert that says "runtime" then means those Guards). `steps` is the calls its Guards have decided on, from each Guard's own count, so it only
 * grows; nothing is said about what a call was (counts only). `errors` is 0: Guard's status does not carry the provider's failures as a count (see Deferred.md).
 */
export async function observeAgent(c: OpsOwnAgent, version: string, id: string, fetchFn: typeof fetch = fetch): Promise<ShopObservation> {
  const guards = await Promise.all(c.guards.map((g) => observeGuard(g, holdsCalls(g.id), fetchFn)));
  const up = guards.every((g) => g.admin !== null);
  const ready = up && guards.every((g) => g.healthReady && g.admin?.tripwires?.ok !== false);
  const steps = guards.reduce((n, g) => n + ((g.admin as WithCounts | null)?.counts?.decisions ?? 0), 0);
  // its snapshot's and drill's ages, as a shop's: a snapshot that stops coming, or a failed drill, alerts the same way
  const backups = readBackups(c.statusFile);
  return { id, pathway: "own-agent", pathwayVersion: version, up, ready, status: { steps, errors: 0, startedAt: c.createdAt, tasks: { pending: 0, failed: 0 }, bookings: {} }, guards, ...(backups ? { backups } : {}) };
}

/** Stop or start a shop (or an agent someone else wrote): nothing new goes out. The reason says who and when; Guard writes it, with its own admin id, into its evidence. */
export async function stopShop(config: OpsConfig, shop: string, on: boolean, by: string, reason: string, fetchFn: typeof fetch = fetch) {
  const own = config.ownAgents?.[shop];
  const c = config.shops[shop] ?? (own ? { guards: own.guards } : undefined);
  if (!c) throw new Error(`no shop ${shop} on this server`);
  // by "-" the reason is used as it is: the deployer re-applying a stop that was already worded must not wrap it in a second "stopped by"
  const why = by === "-" ? reason : on ? `stopped by ${by} at ${new Date().toISOString()}${reason ? `: ${reason}` : ""}` : `released by ${by} at ${new Date().toISOString()}`;
  const results = await Promise.all([
    // the shop's OWN Guards only: the model Guard is listed under every shop for the heartbeat, and its kill switch would stop every shop
    ...c.guards.filter((g) => g.id !== "guard-model").map(async (g) => ({ guard: g.service, ...(await adminCall(g, "POST", "/admin/kill", { on, reason: why }, fetchFn)) })),
    // The model Guard is shared, so only this shop's agent is stopped there: the other shops keep working. (An agent someone else wrote does not use the model.)
    ...(own ? [] : [adminCall(config.model, "POST", `/admin/agents/runtime-${shop}/stop`, { on, reason: why }, fetchFn).then((r) => ({ guard: config.model.service, ...r }))]),
  ]);
  return { shop, on, reason: why, results: results.map((r) => ({ guard: r.guard, status: r.status })) };
}

/** Ask a shop's runtime to run a recovery step (the to-do list's buttons). The runtime saves it like any event; its agent does it through Guard and the normal limits. */
export async function recoverCase(config: OpsConfig, shop: string, requestId: string, caseId: string, action: string, fetchFn: typeof fetch = fetch): Promise<{ shop: string; status: number }> {
  const c = config.shops[shop];
  if (!c) throw new Error(`no shop ${shop} on this server`);
  try {
    const r = await fetchFn(`${c.runtimeUrl.replace(/\/+$/u, "")}/internal/recover`, { method: "POST", headers: { authorization: `Bearer ${readSecret(c.internalTokenFile)}`, "content-type": "application/json" }, body: JSON.stringify({ id: requestId, case: caseId, action }), signal: timeout() });
    return { shop, status: r.status };
  } catch { return { shop, status: 0 }; }
}

async function main(argv: string[], config: OpsConfig): Promise<number> {
  const [command, ...args] = argv;
  const out = (v: unknown) => console.log(JSON.stringify(v));
  const guardByService = (service: string): OpsGuard | undefined => [config.model, ...Object.values(config.shops).flatMap((s) => s.guards), ...Object.values(config.ownAgents ?? {}).flatMap((a) => a.guards)].find((g) => g.service === service);
  if (command === "admin") {
    const g = guardByService(args[0]);
    if (!g) { console.error(`no Guard called ${args[0]}`); return 2; }
    out(await adminCall(g, args[1], args[2], args[3] ? JSON.parse(args[3]) : undefined));
    return 0;
  }
  if (command === "observe") {
    out({
      shops: await Promise.all(Object.entries(config.shops).map(([id, c]) => observeShop(id, c))), model: await observeGuard(config.model, false),
      ...(config.ownAgents ? { agents: await Promise.all(Object.entries(config.ownAgents).map(([id, c]) => observeAgent(c, config.bundleVersion, id))) } : {}),
    });
    return 0;
  }
  if (command === "agent-facts") {
    // what an agent someone else wrote did, as its Guards and the services say it (agent/facts.ts); the deployer folds it into the record
    const c = config.ownAgents?.[args[0]];
    if (!c) { console.error(`no agent ${args[0]}`); return 2; }
    const { collectFacts } = await import("../agent/facts.ts");
    let skip: { settled: string[]; paid: string[] } | undefined;
    try { skip = args[1] ? JSON.parse(args[1]) : undefined; } catch { /* ask about everything */ }
    out(await collectFacts({
      agentId: `agent-${args[0]}`, relayId: `relay-${args[0]}`, recordToken: readSecret(c.recordTokenFile), labelKey: parseKey(readSecret(c.labelKeyFile), `The label key of ${args[0]}`), ...(c.calendarId ? { calendarId: c.calendarId } : {}),
      guards: c.guards.map((g) => ({ kind: g.id.replace(/^guard-/u, ""), adminUrl: g.adminUrl, adminToken: readSecret(g.adminTokenFile), agentUrl: g.agentUrl ?? "" })),
    }, new Date(), fetch, skip));
    return 0;
  }
  if (command === "recover") {
    try { out(await recoverCase(config, args[0], args[1], args[2], args[3])); return 0; } catch (e) { console.error((e as Error).message); return 2; }
  }
  if (command === "stop") { out(await stopShop(config, args[0], args[1] !== "off", args[2] ?? "someone", args.slice(3).join(" "))); return 0; }
  if (command === "issue-approver") {
    const c = config.shops[args[0]] ?? config.ownAgents?.[args[0]];
    if (!c) { console.error(`no shop or agent ${args[0]}`); return 2; }
    // the Guard the owner answers through: a gateway's (its refunds), or an agent's own API's (the calls its spec holds, B71 part 2). A UPI shop has neither.
    const g = c.guards.find((x) => isGatewayKind(x.id.replace(/^guard-/u, ""))) ?? c.guards.find((x) => x.id === `guard-${OWN_API}`);
    if (!g) { console.error(`${args[0]} has no Guard that holds a call for the owner (a UPI shop has none), so there is no approvals relay to give a credential to`); return 2; }
    const r = await adminCall(g, "POST", "/admin/approvers", { id: `relay-${args[0]}`, roles: ["shop-owner"], ttl_seconds: Number(args[1] ?? 604_800), note: "the approvals relay's reading credential" });
    const token = (r.body as { token?: string }).token;
    if (r.status !== 200 || !token) { console.error(`Guard did not issue a credential (HTTP ${r.status})`); return 1; }
    console.log(token);
    return 0;
  }
  if (command === "run") return await run(config);
  console.error("usage: ops.ts run | admin <guard> <METHOD> <path> [json] | observe | stop <shop> <on|off> <by> <reason> | issue-approver <shop> <ttl> | agent-facts <agent> [skip json]");
  return 2;
}

/** What the heartbeat loop remembers between minutes. `usageBaseline` also lives on disk (the fleet folder), so a restart of ops does not lose it. */
export interface HeartbeatState { baseline: Baseline; usageBaseline: UsageBaseline; lastKnown: Record<string, RuntimeStatus>; lastProblem: string }

/**
 * One heartbeat: observe every shop, send, and, ONLY if fleet answered 200, move the totals forward and keep fleet's answer (<fleetDir>/<shop>.json) and the usage
 * baseline on disk. A refused or unreachable fleet changes nothing, so a missed minute is counted in the next one, once.
 */
export async function heartbeatTick(config: OpsConfig, key: string, state: HeartbeatState, fetchFn: typeof fetch = fetch, now: Date = new Date()): Promise<{ accepted: boolean }> {
  const shops = [
    ...await Promise.all(Object.entries(config.shops).map(([id, c]) => observeShop(id, c, fetchFn))),
    // agents someone else wrote are one more entry each in the same heartbeat, with their Guards' counts (they carry no cost-meter counts: their record is not a template's)
    ...await Promise.all(Object.entries(config.ownAgents ?? {}).map(([id, c]) => observeAgent(c, config.bundleVersion, id, fetchFn))),
  ];
  for (const s of shops) if (s.status) state.lastKnown[s.id] = s.status;
  const { body, next, nextUsage } = buildHeartbeat({ deploymentId: config.deploymentId, bundleVersion: config.bundleVersion, ...(config.panelUrl ? { panelUrl: config.panelUrl } : {}), now, shops, baseline: state.baseline, lastKnown: state.lastKnown, usageBaseline: state.usageBaseline });
  const r = await sendHeartbeat(config.fleet!.url, key, body, fetchFn);
  if (r.accepted) {
    state.baseline = next; state.usageBaseline = nextUsage; state.lastProblem = "";
    if (config.fleetDir) {
      try {
        writeUsageBaseline(config.fleetDir, state.usageBaseline, Object.keys(config.shops));
        // fleet's answer, for the shops in it; no answer (an older fleet) leaves each shop's file as it was: keep the last mode, never "normal"
        if (r.answer) writeAnswerFiles(config.fleetDir, [...Object.keys(config.shops), ...Object.keys(config.ownAgents ?? {})], r.answer, now);
        // the signed licence lease, as it came: the deployer checks it with the pinned key and keeps it only if it is good and newer (lib/licence.ts). Ops trusts nothing in it.
        if (r.lease) writeLeaseInbox(config.fleetDir, r.lease);
      } catch (e) { console.error(`could not write ${config.fleetDir}: ${(e as Error).message}`); }
    }
  } else if (r.problem !== state.lastProblem) { state.lastProblem = r.problem ?? ""; console.error(`heartbeat not accepted: ${state.lastProblem}`); }
  return { accepted: r.accepted };
}

/** The heartbeat loop. */
async function run(config: OpsConfig): Promise<number> {
  if (!config.fleet) { console.error("No fleet address in geometer.json, so no heartbeat is sent. (Alerts from outside the server need one.)"); await new Promise(() => undefined); }
  const key = readSecret(config.fleet!.keyFile);
  if (!key) { console.error("The deployment key file is empty or missing, so no heartbeat can be sent."); return 2; }
  // The usage baseline survives a restart of ops (a file in the fleet folder), so a restart sends the difference and never replays the whole record.
  const state: HeartbeatState = { baseline: {}, usageBaseline: config.fleetDir ? readUsageBaseline(config.fleetDir) : {}, lastKnown: {}, lastProblem: "" };
  const tick = () => heartbeatTick(config, key, state);
  await tick();
  setInterval(() => void tick().catch((e) => console.error(`heartbeat failed: ${(e as Error).message}`)), (config.heartbeatSeconds ?? 60) * 1000);
  await new Promise(() => undefined);
  return 0;
}

if (import.meta.main) {
  const config = JSON.parse(readFileSync(process.env.CONFIG ?? "/etc/geometer/ops.json", "utf8")) as OpsConfig;
  process.exitCode = await main(process.argv.slice(2), config);
}
