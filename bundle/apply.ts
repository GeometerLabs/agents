// The host-side deployer. It reads the desired-state folder the panel writes (shops/<shop>/, and files handed in under secrets-inbox/<shop>/) and runs the
// SAME checked deploy as `geometer deploy`. It is the only process with the Docker socket: the panel only writes files, and reads status/<shop>.json.
// While it runs it also does the scheduled data duties: a fresh reading credential for each relay every day, the nightly snapshot, the weekly drill.
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runBackup, runDrill, runExports } from "./backup/jobs.ts";
import { runFingerprints } from "./backup/fingerprints.ts";
import { agentDesiredHash, deployAgent } from "./agent/deploy.ts";
import { listAgents, readAgent } from "./agent/folder.ts";
import { recordAgents } from "./agent/records.ts";
import { Refused, deploy, desiredHashOf, desiredOf, ops, renewRelayCredential } from "./deploy.ts";
import type { Context } from "./deploy.ts";
import { listShops, loadServer, readShop, serverPaths } from "./lib/server.ts";
import { RECOVERY_FILE, parseRecoveryRequest, parseStopRequest } from "./lib/requests.ts";
import { loadState, saveState, shopIndex } from "./lib/state.ts";
import type { State } from "./lib/state.ts";
import { OWN_API, isGatewayKind } from "../modules/payments/providers/index.ts";
import { heldRulesOf } from "../modules/approvals/held-call.ts";
import { syncLicence } from "./lib/licence.ts";
import { applyServerSettings } from "./server-settings.ts";
import { updateStatus } from "./lib/status.ts";
import { shopNameProblem, sha256Hex, stableJson } from "./lib/util.ts";

/** What a shop is asked to be: its three files, and the names of the secrets waiting for it. */
export function desiredSignature(ctx: Context, shop: string): string {
  const f = readShop(ctx.dir, shop);
  const waiting = join(serverPaths(ctx.dir).secretsInbox, shop);
  const inbox = existsSync(waiting) ? readdirSync(waiting).filter((n) => !n.startsWith(".")).sort() : [];
  return sha256Hex(stableJson({ ...desiredOf(f), inbox }));
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
  // the agents someone else wrote, the same way: deployed when their folder (or a key handed in for them) differs from what was applied
  for (const agent of listAgents(ctx.dir)) {
    const state = loadState(ctx.dir);
    const folder = readAgent(ctx.dir, agent);
    const waitingFiles = readdirSafe(join(serverPaths(ctx.dir).secretsInbox, agent));
    const signature = sha256Hex(stableJson({ desired: agentDesiredHash(folder), inbox: waitingFiles.sort() }));
    const upToDate = state.agents?.[agent]?.applied?.desiredHash === agentDesiredHash(folder) && waitingFiles.length === 0;
    if (upToDate || failedFor.get(agent) === signature) { skipped.push(agent); continue; }
    try {
      await deployAgent(ctx, agent);
      failedFor.delete(agent);
      applied.push(agent);
    } catch (e) {
      failed++;
      failedFor.set(agent, signature);
      const problems = e instanceof Refused ? e.problems : [{ rule: "deploy", message: (e as Error).message }];
      if (!(e instanceof Refused)) updateStatus(ctx.dir, agent, ctx.now(), (s) => { s.deploy = { state: "failed", at: ctx.now().toISOString(), message: problems[0].message.slice(0, 480) }; });
      ctx.log(`${agent}: not deployed.\n${problems.map((p) => `  - [${p.rule}] ${p.message}`).join("\n")}`);
    }
  }
  return { applied, failed, skipped };
}

const readdirSafe = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir).filter((n) => !n.startsWith(".")) : []);

const HOUR = 3_600_000;
export const AGENT_RECORD_EVERY_MS = 5 * 60_000;
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

/** A recovery request the runtime did not take for this long is dropped, said once in the log: the to-do list is built from the record, so a button that did nothing shows again. */
export const RECOVERY_GIVE_UP_MS = HOUR;

/**
 * The panel's recovery requests (the to-do list's buttons). Each is carried to the shop's runtime through `ops`, which holds the runtime's token; the runtime saves it as an event and its
 * agent does it through Guard and the normal limits. The file is removed only when the runtime answered 200, or when it has been waiting longer than an hour (then it is dropped and said).
 * A request is a name and an id: nothing the panel writes here can send a message or move money by itself.
 */
export async function processRecoveryRequests(ctx: Context): Promise<string[]> {
  const dir = serverPaths(ctx.dir).requests;
  const done: string[] = [];
  if (!existsSync(dir)) return done;
  for (const file of readdirSync(dir).sort()) {
    const m = RECOVERY_FILE.exec(file);
    if (!m) continue;
    const [, shop, id] = m;
    const path = join(dir, file);
    const request = shopNameProblem(shop) ? undefined : parseRecoveryRequest(readFileSync(path, "utf8"), shop, id);
    if (!request) { if (!warned.has(path)) { warned.add(path); ctx.log(`requests/${file} is not a recovery request for a shop on this server, so it is left alone.`); } continue; }
    const state = loadState(ctx.dir);
    if (state.shops[shop]?.applied === undefined) { ctx.log(`${shop}: the recovery request ${id} waits: the shop is not running yet.`); continue; }
    const r = await ops(ctx, ["recover", shop, request.requestId, request.case, request.action]);
    let status = 0;
    try { status = (JSON.parse(r.stdout.trim().split("\n").at(-1) ?? "") as { status: number }).status; } catch { /* ops could not be asked */ }
    if (status === 200) { rmSync(path, { force: true }); ctx.log(`${shop}: ${request.action} on ${request.case} was handed to the shop's agent (request ${id}).`); done.push(id); continue; }
    if (ctx.now().getTime() - Date.parse(request.requestedAt) > RECOVERY_GIVE_UP_MS) { rmSync(path, { force: true }); ctx.log(`${shop}: the recovery request ${id} (${request.action} on ${request.case}) was dropped: the shop's runtime did not take it in an hour. It will show on the to-do list again if it still needs doing.`); }
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
  // a UPI shop (B33) has no gateway Guard and so no approvals relay: there is no credential to renew for it
  const shopsWithRelay = Object.entries(state.shops).filter(([, s]) => s.applied && Object.values(s.applied.guards).some((g) => isGatewayKind(g.kind))).map(([n]) => n);
  // an agent someone else wrote has a relay credential too when a call of its can be held for the owner: a refund on its gateway, or (B71 part 2) a call its own
  // API's reviewed spec holds. Without the renewal the relay's credential runs out after a week and the owner is never asked again.
  const holdsForOwner = (a: NonNullable<State["agents"]>[string]): boolean => Object.values(a.applied!.guards).some((g) => isGatewayKind(g.kind) || (g.kind === OWN_API && heldRulesOf(JSON.parse(g.specText) as { tool?: unknown; rules?: unknown }).rules.length > 0));
  const withRelay = Object.entries(state.agents ?? {}).filter(([, a]) => a.applied && holdsForOwner(a)).map(([n]) => n);
  // B51: a server with only agents still takes its snapshot and drill, so return early only when there is nothing applied at all
  const anyAgent = Object.values(state.agents ?? {}).some((a) => a.applied);
  if (shops.length === 0 && !anyAgent) return ran;
  if (since(jobs.relayCredentialsAt) >= 24 * HOUR) {
    for (const shop of [...shopsWithRelay, ...withRelay]) await renewRelayCredential(ctx, shop);
    jobs.relayCredentialsAt = now.toISOString(); ran.push("relay credentials");
  }
  // the record of each agent someone else wrote, from its Guards' decisions and the services' own state: every five minutes. Guard lists only its 500 most recent decisions, so
  // the record is read well before a busy agent could fill the list (and what is settled is not asked of the services again, so the record's own reads stay few)
  if (Object.values(state.agents ?? {}).some((a) => a.applied) && since(jobs.agentRecordsAt) >= AGENT_RECORD_EVERY_MS) {
    jobs.agentRecordsAt = now.toISOString();
    (await recordAgents(ctx)).filter((l) => /could not|cannot/u.test(l)).forEach((l) => ctx.log(l)); ran.push("agent records");
  }
  // the exports and fingerprints are about shops' runtimes (their databases): a server with only agents someone else wrote has none. The snapshot and the drill below
  // are not: an agent's Guards and record are in them too (B51)
  // the record and bookings for the panel's monthly report: every quarter of an hour (counts for the report; no customer's number leaves the shop's volume)
  if (shops.length > 0 && since(jobs.exportsAt) >= 15 * 60_000) {
    jobs.exportsAt = now.toISOString();
    const e = await runExports(ctx); e.lines.filter((l) => /not exported|failed/u.test(l)).forEach((l) => ctx.log(l)); ran.push("exports");
  }
  // the daily fingerprint of each shop's record (B28): the ledger's head, never its data, appended to a local file; a git repository and a timestamp calendar only with the owner's yes
  if (shops.length > 0 && since(jobs.fingerprintsAt) >= 24 * HOUR && jobs.exportsAt) {
    jobs.fingerprintsAt = now.toISOString(); saveState(ctx.dir, state);
    const f = await runFingerprints(ctx); f.lines.filter((l) => /REFUSED|not pushed|could not/u.test(l)).forEach((l) => ctx.log(l)); ran.push(f.ok ? "fingerprints" : "fingerprints REFUSED");
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

/**
 * The licence lease (B13), on every loop: the lease ops kept from fleet's last answer is checked and kept if it is good and newer, each deployed shop's runtime is handed
 * its entry, and the state the panel shows is written (lib/licence.ts). Cheap: one signature check per lease file, and files written only when they change.
 */
export function runLicence(ctx: Context): string[] {
  const state = loadState(ctx.dir);
  const shops = Object.entries(state.shops).filter(([, s]) => s.applied).map(([n]) => n);
  const lines = syncLicence(ctx.dir, loadServer(ctx.dir), shops, ctx.now());
  lines.forEach((l) => ctx.log(l));
  return lines;
}

export async function watch(ctx: Context, everyMs = 10_000): Promise<void> {
  let lastRefresh = 0;
  ctx.log(`Watching ${serverPaths(ctx.dir).shops} (and the secrets inbox) every ${Math.round(everyMs / 1000)} s. Press Ctrl+C to stop.`);
  for (;;) {
    // the server's own settings first (the panel's first run): a shop deployed in the same pass then finds the model and its key in place
    try { await processStopRequests(ctx); await processRecoveryRequests(ctx); await applyServerSettings(ctx); await applyOnce(ctx); runLicence(ctx); await runDueJobs(ctx); if (ctx.now().getTime() - lastRefresh >= 60_000) { lastRefresh = ctx.now().getTime(); await refreshStatuses(ctx); } } catch (e) { ctx.log(`The deployer hit a problem and will try again: ${(e as Error).message}`); }
    await ctx.sleep(everyMs);
  }
}
