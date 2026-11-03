// `ops` is the one container that holds every Guard's admin credential and can reach every Guard's admin port (through the forwarders on the admin
// network). It does two things:
//   run                                  every 60 s, send the heartbeat to Geometer's fleet service (heartbeat.ts)
//   <command>                            what the host-side deployer runs with `docker compose exec ops node ops.ts <command>`, because the deployer cannot
//                                        reach container addresses on every host (Docker Desktop) and the admin ports are never published:
//     admin <guard-service> <METHOD> <path> [json]     one admin call, answered as {"status":200,"body":...}
//     observe                                          everything the heartbeat reads, as JSON (what `geometer status` shows)
//     stop <shop> <on|off> <by> <reason>               the kill switch on all three of the shop's Guards, and the shop's agent on the model Guard
//     issue-approver <shop> <ttl-seconds>              a fresh reading credential for the shop's relay, printed once on stdout
//   Nothing in this file logs a token, and the body of a heartbeat has no message text in it.
import { existsSync, readFileSync } from "node:fs";
import { buildHeartbeat, sendHeartbeat } from "./heartbeat.ts";
import type { AdminStatus, Baseline, GuardObservation, RuntimeStatus, ShopObservation } from "./heartbeat.ts";

export interface OpsGuard { id: string; service: string; adminUrl: string; healthUrl: string; adminTokenFile: string }
export interface OpsConfig {
  deploymentId: string;
  bundleVersion: string;
  fleet?: { url: string; keyFile: string };
  shops: Record<string, { pathway: string; pathwayVersion: string; runtimeUrl: string; internalTokenFile: string; guards: OpsGuard[] }>;
  model: OpsGuard;
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

export async function observeGuard(g: OpsGuard, withHeld: boolean, fetchFn: typeof fetch = fetch): Promise<GuardObservation> {
  const [health, status, held] = await Promise.all([
    get(`${g.healthUrl}/readyz`, {}, fetchFn),
    adminCall(g, "GET", "/admin/status", undefined, fetchFn),
    withHeld ? adminCall(g, "GET", "/admin/approvals?state=pending", undefined, fetchFn) : Promise.resolve(null),
  ]);
  const list = held && held.status === 200 && Array.isArray((held.body as { approvals?: unknown }).approvals) ? (held.body as { approvals: unknown[] }).approvals.length : held && held.status === 200 && Array.isArray(held.body) ? (held.body as unknown[]).length : null;
  return { id: g.id, healthReady: health.status === 200, admin: status.status === 200 ? (status.body as AdminStatus) : null, held: withHeld ? list : 0 };
}

export async function observeShop(id: string, c: OpsConfig["shops"][string], fetchFn: typeof fetch = fetch): Promise<ShopObservation> {
  const token = readSecret(c.internalTokenFile);
  const [healthz, readyz, status, guards] = await Promise.all([
    get(`${c.runtimeUrl}/healthz`, {}, fetchFn), get(`${c.runtimeUrl}/readyz`, {}, fetchFn),
    get(`${c.runtimeUrl}/status`, { authorization: `Bearer ${token}` }, fetchFn),
    Promise.all(c.guards.map((g) => observeGuard(g, g.id === "guard-razorpay", fetchFn))),
  ]);
  return { id, pathway: c.pathway, pathwayVersion: c.pathwayVersion, up: healthz.status === 200, ready: readyz.status === 200, status: status.status === 200 ? (status.json as RuntimeStatus) : null, guards };
}

/** Stop or start a shop: nothing new goes out. The reason says who and when; Guard writes it, with its own admin id, into its evidence. */
export async function stopShop(config: OpsConfig, shop: string, on: boolean, by: string, reason: string, fetchFn: typeof fetch = fetch) {
  const c = config.shops[shop];
  if (!c) throw new Error(`no shop ${shop} on this server`);
  const why = on ? `stopped by ${by} at ${new Date().toISOString()}${reason ? `: ${reason}` : ""}` : `released by ${by} at ${new Date().toISOString()}`;
  const results = await Promise.all([
    ...c.guards.map(async (g) => ({ guard: g.service, ...(await adminCall(g, "POST", "/admin/kill", { on, reason: why }, fetchFn)) })),
    // The model Guard is shared, so only this shop's agent is stopped there: the other shops keep working.
    adminCall(config.model, "POST", `/admin/agents/runtime-${shop}/stop`, { on, reason: why }, fetchFn).then((r) => ({ guard: config.model.service, ...r })),
  ]);
  return { shop, on, reason: why, results: results.map((r) => ({ guard: r.guard, status: r.status })) };
}

async function main(argv: string[], config: OpsConfig): Promise<number> {
  const [command, ...args] = argv;
  const out = (v: unknown) => console.log(JSON.stringify(v));
  const guardByService = (service: string): OpsGuard | undefined => [config.model, ...Object.values(config.shops).flatMap((s) => s.guards)].find((g) => g.service === service);
  if (command === "admin") {
    const g = guardByService(args[0]);
    if (!g) { console.error(`no Guard called ${args[0]}`); return 2; }
    out(await adminCall(g, args[1], args[2], args[3] ? JSON.parse(args[3]) : undefined));
    return 0;
  }
  if (command === "observe") {
    out({ shops: await Promise.all(Object.entries(config.shops).map(([id, c]) => observeShop(id, c))), model: await observeGuard(config.model, false) });
    return 0;
  }
  if (command === "stop") { out(await stopShop(config, args[0], args[1] !== "off", args[2] ?? "someone", args.slice(3).join(" "))); return 0; }
  if (command === "issue-approver") {
    const c = config.shops[args[0]];
    if (!c) { console.error(`no shop ${args[0]}`); return 2; }
    const g = c.guards.find((x) => x.id === "guard-razorpay")!;
    const r = await adminCall(g, "POST", "/admin/approvers", { id: `relay-${args[0]}`, roles: ["shop-owner"], ttl_seconds: Number(args[1] ?? 604_800), note: "the approvals relay's reading credential" });
    const token = (r.body as { token?: string }).token;
    if (r.status !== 200 || !token) { console.error(`Guard did not issue a credential (HTTP ${r.status})`); return 1; }
    console.log(token);
    return 0;
  }
  if (command === "run") return await run(config);
  console.error("usage: ops.ts run | admin <guard> <METHOD> <path> [json] | observe | stop <shop> <on|off> <by> <reason> | issue-approver <shop> <ttl>");
  return 2;
}

/** The heartbeat loop. Totals are only moved forward when fleet answered 200, so a missed minute is counted in the next one, once. */
async function run(config: OpsConfig): Promise<number> {
  if (!config.fleet) { console.error("No fleet address in geometer.json, so no heartbeat is sent. (Alerts from outside the server need one.)"); await new Promise(() => undefined); }
  const key = readSecret(config.fleet!.keyFile);
  if (!key) { console.error("The deployment key file is empty or missing, so no heartbeat can be sent."); return 2; }
  let baseline: Baseline = {};
  const lastKnown: Record<string, RuntimeStatus> = {};
  let lastProblem = "";
  const tick = async () => {
    const shops = await Promise.all(Object.entries(config.shops).map(([id, c]) => observeShop(id, c)));
    for (const s of shops) if (s.status) lastKnown[s.id] = s.status;
    const { body, next } = buildHeartbeat({ deploymentId: config.deploymentId, bundleVersion: config.bundleVersion, now: new Date(), shops, baseline, lastKnown });
    const r = await sendHeartbeat(config.fleet!.url, key, body);
    if (r.accepted) { baseline = next; lastProblem = ""; } else if (r.problem !== lastProblem) { lastProblem = r.problem ?? ""; console.error(`heartbeat not accepted: ${lastProblem}`); }
  };
  await tick();
  setInterval(() => void tick().catch((e) => console.error(`heartbeat failed: ${(e as Error).message}`)), 60_000);
  await new Promise(() => undefined);
  return 0;
}

if (import.meta.main) {
  const config = JSON.parse(readFileSync(process.env.CONFIG ?? "/etc/geometer/ops.json", "utf8")) as OpsConfig;
  process.exitCode = await main(process.argv.slice(2), config);
}
