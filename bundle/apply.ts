// The host-side deployer. It reads the desired-state folder the panel writes (shops/<shop>/, and files handed in under secrets-inbox/<shop>/) and runs the
// SAME checked deploy as `geometer deploy`. It is the only process with the Docker socket: the panel only writes files, and reads status/<shop>.json.
// While it runs it also does the scheduled data duties: a fresh reading credential for each relay every day, the nightly snapshot, the weekly drill.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { runBackup, runDrill } from "./backup/jobs.ts";
import { Refused, deploy, desiredHashOf, renewRelayCredential } from "./deploy.ts";
import type { Context } from "./deploy.ts";
import { listShops, loadServer, readShop, serverPaths } from "./lib/server.ts";
import { loadState, saveState } from "./lib/state.ts";
import { updateStatus } from "./lib/status.ts";
import { sha256Hex, stableJson } from "./lib/util.ts";

/** What a shop is asked to be: its three files, and the names of the secrets waiting for it. */
export function desiredSignature(ctx: Context, shop: string): string {
  const f = readShop(ctx.dir, shop);
  const waiting = join(serverPaths(ctx.dir).secretsInbox, shop);
  const inbox = existsSync(waiting) ? readdirSync(waiting).filter((n) => !n.startsWith(".")).sort() : [];
  return sha256Hex(stableJson({ settings: f.settingsText, runtime: f.runtime, lock: f.lockText, inbox }));
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
      updateStatus(ctx.dir, shop, ctx.now(), (s) => { s.lastDeploy = { at: ctx.now().toISOString(), ok: false, refusal: problems }; });
      ctx.log(`${shop}: not deployed.\n${problems.map((p) => `  - [${p.rule}] ${p.message}`).join("\n")}`);
    }
  }
  return { applied, failed, skipped };
}

const readdirSafe = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir).filter((n) => !n.startsWith(".")) : []);

const HOUR = 3_600_000;

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
  ctx.log(`Watching ${serverPaths(ctx.dir).shops} (and the secrets inbox) every ${Math.round(everyMs / 1000)} s. Press Ctrl+C to stop.`);
  for (;;) {
    try { await applyOnce(ctx); await runDueJobs(ctx); } catch (e) { ctx.log(`The deployer hit a problem and will try again: ${(e as Error).message}`); }
    await ctx.sleep(everyMs);
  }
}
