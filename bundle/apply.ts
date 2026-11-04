// The host-side deployer. It reads the desired-state folder the panel writes (shops/<shop>/, and files handed in under secrets-inbox/<shop>/) and runs the
// SAME checked deploy as `geometer deploy`. It is the only process with the Docker socket: the panel only writes files, and reads status/<shop>.json.
// While it runs it also does the scheduled data duties: a fresh reading credential for each relay every day, the nightly snapshot, the weekly drill.
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runBackup, runDrill, runExports } from "./backup/jobs.ts";
import { Refused, deploy, desiredHashOf, ops, renewRelayCredential } from "./deploy.ts";
import type { Context } from "./deploy.ts";
import { listShops, loadServer, readShop, serverPaths } from "./lib/server.ts";
import { parseStopRequest } from "./lib/requests.ts";
import { loadState, saveState, shopIndex } from "./lib/state.ts";
import { updateStatus } from "./lib/status.ts";
import { shopNameProblem, sha256Hex, stableJson } from "./lib/util.ts";

/** What a shop is asked to be: its three files, and the names of the secrets waiting for it. */
export function desiredSignature(ctx: Context, shop: string): string {
  const f = readShop(ctx.dir, shop);
  const waiting = join(serverPaths(ctx.dir).secretsInbox, shop);
  const inbox = existsSync(waiting) ? readdirSync(waiting).filter((n) => !n.startsWith(".")).sort() : [];
  return sha256Hex(stableJson({ settings: f.settingsText, runtime: f.runtime, lock: f.lockText, pins: f.pinsText, inbox, ...(f.fleetAi ? { fleetAi: f.fleetAi } : {}) }));
}

const failedFor = new Map<string, string>();

/** One pass: deploy each shop whose desired state differs from what was applied (or that has secrets waiting). A shop that was refused is not retried until something changes. */
export async function applyOnce(ctx: Context): Promise<{ applied: string[]; failed: number; skipped: string[] }> {
  const applied: string[] = []; const skipped: string[] = []; let failed = 0;
  for (const shop of listShops(ctx.dir)) {
    const state = loadState(ctx.dir);
    const signature = desiredSignature(ctx, shop);
    const current = state.shops[shop]?.applied;
    const waiting = readdirSafe(join(serverPaths(ctx.dir).secretsInbox, shop)).length > 0;
    const upToDate = current !== undefined && current.desiredHash === desiredHashOf(readShop(ctx.dir, shop)) && !waiting;
    if (upToDate || failedFor.get(shop) === signature) { skipped.push(shop); continue; }
    try {
      await deploy(ctx, shop);
      failedFor.delete(shop);
      applied.push(shop);
    } catch (e) {
      failed++;
      failedFor.set(shop, signature);
      const problems = e instanceof Refused ? e.problems : [{ rule: "deploy", message: (e as Error).message }];
      if (!(e instanceof Refused)) updateStatus(ctx.dir, shop, ctx.now(), (s) => { s.deploy = { state: "failed", at: ctx.now().toISOString(), message: problems[0].message.slice(0, 480) }; });
      ctx.log(`${shop}: not deployed.\n${problems.map((p) => `  - [${p.rule}] ${p.message}`).join("\n")}`);
    }
  }
  return { applied, failed, skipped };
}

const readdirSafe = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir).filter((n) => !n.startsWith(".")) : []);

const HOUR = 3_600_000;
const warned = new Set<string>();

/**
 * The panel's stop requests. The deployer acts first (the Guard kill switch, on every Guard of the shop), writes `stopped` into status/<shop>.json, and only
 * THEN removes the request, so the panel never says "stopped" for something that is not, and never loses a request that was not carried out. A request for a
 * shop that has no Guards yet is carried out as a mark on the shop (nothing can go out from a shop that does not run), applied again when it is first deployed.
 */
export async function processStopRequests(ctx: Context): Promise<string[]> {
  const dir = serverPaths(ctx.dir).requests;
  const done: string[] = [];
  if (!existsSync(dir)) return done;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".stop.json")).sort()) {
    const shop = file.slice(0, -".stop.json".length);
    const path = join(dir, file);
    const request = shopNameProblem(shop) ? undefined : parseStopRequest(readFileSync(path, "utf8"), shop);
    if (!request) { if (!warned.has(path)) { warned.add(path); ctx.log(`requests/${file} is not a stop request for a shop on this server, so it is left alone.`); } continue; }
    const state = loadState(ctx.dir);
    const applied = state.shops[shop]?.applied !== undefined;
    const by = `${request.requestedBy.name || request.requestedBy.id} (${request.requestedBy.role ?? "user"}, from the panel)`;
    const reason = `request ${request.requestId}`;
    let stoppedReason = `stopped by ${by} at ${ctx.now().toISOString()}: ${reason}`;
    if (applied) {
      const r = await ops(ctx, ["stop", shop, "on", by, reason]);
      let result: { reason: string; results: { status: number }[] } | undefined;
      try { result = JSON.parse(r.stdout.trim().split("\n").at(-1) ?? ""); } catch { /* the Guards could not be asked */ }
      if (!result || !result.results.every((x) => x.status === 200)) { ctx.log(`${shop}: the stop request ${request.requestId} could not be carried out on every Guard yet; it stays, and is tried again.`); continue; }
      stoppedReason = result.reason;
    }
    const at = ctx.now().toISOString();
    (state.shops[shop] ??= { index: shopIndex(state, shop), guards: {}, lockHistory: [] }).stopped = { by, at, reason: stoppedReason, requestId: request.requestId };
    saveState(ctx.dir, state);
    updateStatus(ctx.dir, shop, ctx.now(), (s) => { s.stopped = { at, requestId: request.requestId, by, reason: stoppedReason }; });
    rmSync(path, { force: true });
    ctx.log(`${shop}: stopped at the panel's request ${request.requestId}.`);
    done.push(shop);
  }
  return done;
}

/**
 * Keep `updatedAt` honest. Every minute the deployer asks the RUNNING Guards and runtimes (through ops) and, for each shop whose runtime and three Guards all answer
 * and have run their tripwires, rewrites the shop's `limits` from what they say and moves `updatedAt`. A shop that does not answer is left as it was: the file goes quiet and the
 * panel says "Not confirmed yet" after its stale time. A Guard whose tripwires FAILED is confirmed (with fewer limits proven than there are): that is news, and it is shown at once.
 */
export async function refreshStatuses(ctx: Context): Promise<string[]> {
  const state = loadState(ctx.dir);
  const applied = Object.entries(state.shops).filter(([, s]) => s.applied).map(([n]) => n);
  if (applied.length === 0) return [];
  const r = await ops(ctx, ["observe"]);
  let seen: { shops: { id: string; up: boolean; ready: boolean; guards: { id: string; healthReady: boolean; admin: { tripwires?: { ran?: boolean; ok?: boolean; passed?: number; of?: number; not_self_testable_items?: { item: string }[] } } | null }[] }[] } | undefined;
  try { seen = JSON.parse(r.stdout.trim().split("\n").at(-1) ?? ""); } catch { return []; }
  const confirmed: string[] = [];
  for (const shop of applied) {
    const o = seen?.shops.find((x) => x.id === shop);
    const mine = o?.guards.filter((g) => g.id !== "guard-model") ?? [];
    if (!o || mine.length !== 3 || mine.some((g) => g.admin?.tripwires?.ran !== true)) continue;
    const answered = o.up && o.ready && mine.every((g) => g.healthReady);
    const proven = mine.reduce((n, g) => n + (g.admin!.tripwires!.passed ?? 0), 0), of = mine.reduce((n, g) => n + (g.admin!.tripwires!.of ?? 0), 0);
    const failed = mine.some((g) => g.admin!.tripwires!.ok === false);
    if (!answered && !failed) continue;
    updateStatus(ctx.dir, shop, ctx.now(), (s) => {
      const line = `${proven} of ${of} limits proven to bite`;
      s.limits = { proven, of, unprovable: [...new Set(mine.flatMap((g) => (g.admin!.tripwires!.not_self_testable_items ?? []).map((i) => i.item)))], line: `${line} on the running Guards`, perGuard: s.limits?.perGuard ?? {}, ...(s.limits?.model ? { model: s.limits.model } : {}) };
      const stop = state.shops[shop].stopped;
      if (stop) s.stopped = { at: stop.at, by: stop.by, reason: stop.reason, ...(stop.requestId ? { requestId: stop.requestId } : {}) }; else delete s.stopped;
    });
    confirmed.push(shop);
  }
  return confirmed;
}

/** The scheduled jobs that are due now. Run once each when due, and the time is remembered so a restart does not run them twice. */
export async function runDueJobs(ctx: Context): Promise<string[]> {
  const ran: string[] = [];
  const state = loadState(ctx.dir);
  const server = loadServer(ctx.dir);
  const now = ctx.now();
  const jobs = state.jobs ??= {};
  const since = (iso?: string) => (iso ? now.getTime() - Date.parse(iso) : Infinity);
  const shops = Object.entries(state.shops).filter(([, s]) => s.applied).map(([n]) => n);
  if (shops.length === 0) return ran;
  if (since(jobs.relayCredentialsAt) >= 24 * HOUR) {
    for (const shop of shops) await renewRelayCredential(ctx, shop);
    jobs.relayCredentialsAt = now.toISOString(); ran.push("relay credentials");
  }
  // the record and bookings for the panel's monthly report: every quarter of an hour (counts for the report; no customer's number leaves the shop's volume)
  if (since(jobs.exportsAt) >= 15 * 60_000) {
    jobs.exportsAt = now.toISOString();
    const e = await runExports(ctx); e.lines.filter((l) => /not exported|failed/u.test(l)).forEach((l) => ctx.log(l)); ran.push("exports");
  }
  if (server.backup && since(jobs.snapshotAt) >= 24 * HOUR && now.getHours() >= 2) {
    jobs.snapshotAt = now.toISOString(); saveState(ctx.dir, state);
    (await runBackup(ctx)).lines.forEach((l) => ctx.log(l)); ran.push("snapshot");
  }
  if (server.backup && since(jobs.drillAt) >= 7 * 24 * HOUR && now.getHours() >= 3) {
    jobs.drillAt = now.toISOString(); saveState(ctx.dir, state);
    const r = await runDrill(ctx); r.lines.forEach((l) => ctx.log(l)); ran.push(r.ok ? "drill" : "drill FAILED");
  }
  const fresh = loadState(ctx.dir); fresh.jobs = { ...fresh.jobs, ...jobs }; saveState(ctx.dir, fresh);
  return ran;
}

export async function watch(ctx: Context, everyMs = 10_000): Promise<void> {
  let lastRefresh = 0;
  ctx.log(`Watching ${serverPaths(ctx.dir).shops} (and the secrets inbox) every ${Math.round(everyMs / 1000)} s. Press Ctrl+C to stop.`);
  for (;;) {
    try { await processStopRequests(ctx); await applyOnce(ctx); await runDueJobs(ctx); if (ctx.now().getTime() - lastRefresh >= 60_000) { lastRefresh = ctx.now().getTime(); await refreshStatuses(ctx); } } catch (e) { ctx.log(`The deployer hit a problem and will try again: ${(e as Error).message}`); }
    await ctx.sleep(everyMs);
  }
}
