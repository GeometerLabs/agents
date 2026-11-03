// The data duties, on the host side: the nightly snapshot, the weekly restore drill and `restore`. Each starts a short-lived container with the volumes it
// needs (the deployer is the only process with the Docker socket) and reads one line of JSON back. Nothing here sees a secret except the bucket keys it
// mounts into those containers.
//
//   what is copied        where                                              by
//   runtime database      continuously, every second, off the server          Litestream (litestream.yml)
//   runtime database      nightly, age-encrypted, kept 30 days, elsewhere     backup/snapshot.ts (VACUUM INTO: never touches the live file's checkpoints)
//   each Guard's store    nightly with the above, Guard's own POST /admin/backup (a consistent copy of its store and its evidence ledger, checked by
//                         geo-verify), not Litestream: Litestream has to own the checkpointing of what it streams
//   the weekly drill      restores the continuous copy into a scratch folder, checks integrity, compares the last record entry with the live one
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { adminCall, compose } from "../deploy.ts";
import type { Context } from "../deploy.ts";
import { names } from "../generate/shop.ts";
import { LITESTREAM_IMAGE, loadServer, serverPaths } from "../lib/server.ts";
import type { ServerConfig } from "../lib/server.ts";
import { secretFile } from "../lib/secrets.ts";
import { loadState, saveState } from "../lib/state.ts";
import { updateStatus } from "../lib/status.ts";
import { ensureDir } from "../lib/util.ts";
import type { DrillResult } from "./drill-check.ts";
import type { ShopSnapshot } from "./snapshot.ts";

export const project = (server: ServerConfig) => `geometer-${server.id.replace(/_/gu, "-")}`;
const volume = (server: ServerConfig, v: string) => `${project(server)}_${v}`;
const stampOf = (d: Date) => d.toISOString().replace(/[-:]|\.\d{3}/gu, "");
const GUARD_BACKUPS = "/var/lib/geo-guard/backups";

/** The flags every job container gets: no network unless it needs the bucket, no capability but reading and writing files it does not own, the code read-only. */
function jobFlags(ctx: Context, server: ServerConfig, network: boolean, user = "0"): string[] {
  return ["run", "--rm", "--user", user, "--cap-drop", "ALL", ...(user === "0" ? ["--cap-add", "DAC_OVERRIDE", "--cap-add", "DAC_READ_SEARCH"] : []), "--read-only", "--tmpfs", "/tmp", "--security-opt", "no-new-privileges:true",
    "--network", network ? `${project(server)}_egress` : "none", "-v", `${ctx.appDir}:/app:ro`];
}

function lastJson(text: string): any {
  try { return JSON.parse(text.trim().split("\n").at(-1) ?? ""); } catch { return undefined; }
}

export async function runBackup(ctx: Context): Promise<{ ok: boolean; lines: string[] }> {
  const server = loadServer(ctx.dir);
  const lines: string[] = [];
  if (!server.backup) return { ok: false, lines: ["No backup is set up: `geometer init` was not given a stream, a snapshot place and a key (see bundle/README.md, 'Backups')."] };
  const state = loadState(ctx.dir);
  const shops = Object.entries(state.shops).filter(([, s]) => s.applied);
  const stamp = stampOf(ctx.now());
  const work = join(serverPaths(ctx.dir).state, "work");
  ensureDir(work);
  // 1. each Guard writes its own consistent backup into its own state volume
  for (const [shop, s] of shops) for (const g of Object.values(s.applied!.guards)) {
    const r = await adminCall(ctx, g.service, "POST", "/admin/backup", { to: `${GUARD_BACKUPS}/${stamp}` });
    if (r.status !== 200) lines.push(`${g.service}: Guard's own backup was not made (HTTP ${r.status}: ${String(r.body?.error ?? "").slice(0, 120)}); the shop's runtime database is still copied.`);
  }
  // 2. the snapshot container
  const jobFile = join(work, `snapshot-${stamp}.json`);
  writeFileSync(jobFile, JSON.stringify({ stamp, keepDays: server.backup.snapshots.keepDays ?? 30, recipient: server.backup.ageRecipient, target: server.backup.snapshots,
    shops: shops.map(([shop, s]) => ({ name: shop, runtimeDb: `/v/${names.dataVolume(shop)}/data/agent.db`, guards: Object.values(s.applied!.guards).map((g) => ({ kind: g.kind, dir: `/v/${names.stateVolume(shop, g.kind as "razorpay")}/backups/${stamp}` })) })) }), { mode: 0o644 });
  const mounts = shops.flatMap(([shop, s]) => [["-v", `${volume(server, names.dataVolume(shop))}:/v/${names.dataVolume(shop)}`], ...Object.values(s.applied!.guards).map((g) => ["-v", `${volume(server, names.stateVolume(shop, g.kind as "razorpay"))}:/v/${names.stateVolume(shop, g.kind as "razorpay")}`])]).flat();
  const bucket = server.backup.snapshots.url.startsWith("s3://");
  const key = secretFile(ctx.dir, "backup", "snapshots");
  const r = await ctx.runner.run(ctx.docker, [...jobFlags(ctx, server, bucket), "-v", `${jobFile}:/job/job.json:ro`, ...(bucket && existsSync(key) ? ["-v", `${key}:/run/secrets/snapshots:ro`] : []), ...(bucket ? [] : ["-v", `${server.backup.snapshots.url}:${server.backup.snapshots.url}`]), ...mounts, server.appImage, "node", "/app/bundle/backup/snapshot.ts", "/job/job.json"], { timeoutMs: 900_000 });
  rmSync(jobFile, { force: true });
  const out = lastJson(r.stdout) as { results?: ShopSnapshot[] } | undefined;
  if (r.code !== 0 || !out?.results) return { ok: false, lines: [...lines, `The snapshot job failed: ${r.stderr.trim().split("\n").slice(-3).join(" | ") || `exit ${r.code}`}`] };
  let ok = true;
  for (const res of out.results) {
    if (res.ok) { state.shops[res.name].lastBackupAt = ctx.now().toISOString(); updateStatus(ctx.dir, res.name, ctx.now(), (s) => { s.backups = { ...(s.backups ?? { lastDrillAt: null, drillOk: null }), lastCopyAt: ctx.now().toISOString() }; }, false); lines.push(`${res.name}: snapshot ${res.stamp} written (${res.files} files, ${res.bytes} bytes, encrypted)${res.record ? `, record at entry #${res.record.lastSeq ?? 0}` : ""}`); }
    else { ok = false; lines.push(`${res.name}: NO snapshot (${res.error})`); }
  }
  saveState(ctx.dir, state);
  return { ok, lines };
}

/** The record and the bookings of every shop, exported for the monthly report: one container, every shop, files without customers' numbers (see export.ts). */
export async function runExports(ctx: Context): Promise<{ ok: boolean; lines: string[] }> {
  const server = loadServer(ctx.dir);
  const state = loadState(ctx.dir);
  const shops = Object.entries(state.shops).filter(([, s]) => s.applied).map(([n]) => n);
  if (shops.length === 0) return { ok: true, lines: [] };
  const work = join(serverPaths(ctx.dir).state, "work");
  ensureDir(work);
  const jobFile = join(work, `export-${stampOf(ctx.now())}.json`);
  writeFileSync(jobFile, JSON.stringify({ shops: shops.map((n) => ({ name: n, db: `/v/${names.dataVolume(n)}/data/agent.db`, out: `/out/${n}` })) }), { mode: 0o644 });
  const r = await ctx.runner.run(ctx.docker, [...jobFlags(ctx, server, false), "-v", `${jobFile}:/job/job.json:ro`, "-v", `${serverPaths(ctx.dir).exports}:/out`, ...shops.flatMap((n) => ["-v", `${volume(server, names.dataVolume(n))}:/v/${names.dataVolume(n)}`]), server.appImage, "node", "/app/bundle/backup/export.ts", "/job/job.json"], { timeoutMs: 300_000 });
  rmSync(jobFile, { force: true });
  const out = lastJson(r.stdout) as { results?: { name: string; ok: boolean; entries?: number; bookings?: number; error?: string }[] } | undefined;
  if (r.code !== 0 || !out?.results) return { ok: false, lines: [`The export job failed: ${r.stderr.trim().split("\n").slice(-2).join(" | ") || `exit ${r.code}`}`] };
  return { ok: out.results.every((x) => x.ok || x.error === "no database yet"), lines: out.results.map((x) => (x.ok ? `${x.name}: exported ${x.entries} record entries and ${x.bookings} bookings` : `${x.name}: not exported (${x.error})`)) };
}

/** The weekly drill: restore the continuous copy into a scratch folder and compare it with the live record. A failure is written where the panel and `status` show it. */
export async function runDrill(ctx: Context): Promise<{ ok: boolean; lines: string[] }> {
  const server = loadServer(ctx.dir);
  if (!server.backup) return { ok: false, lines: ["No backup is set up, so there is nothing to drill."] };
  const state = loadState(ctx.dir);
  const shops = Object.entries(state.shops).filter(([, s]) => s.applied).map(([n]) => n);
  const work = join(serverPaths(ctx.dir).state, "work", `drill-${stampOf(ctx.now())}`);
  const lines: string[] = [];
  const verdicts: DrillResult[] = [];
  try {
    for (const shop of shops) {
      const out = join(work, shop);
      mkdirSync(out, { recursive: true, mode: 0o777 }); chmodSync(out, 0o777); // the umask would make this 0755, and Litestream runs as another user
      const r = await ctx.runner.run(ctx.docker, ["run", "--rm", "--user", "1000:1000", "--network", `${project(server)}_egress`, "-v", `${out}:/out`, "-v", `${secretFile(ctx.dir, "litestream", "litestream.yml")}:/etc/litestream.yml:ro`, LITESTREAM_IMAGE, "restore", "-config", "/etc/litestream.yml", "-o", "/out/agent.db", `/data/${shop}/data/agent.db`], { timeoutMs: 600_000 });
      if (r.code !== 0) verdicts.push({ name: shop, ok: false, detail: `the continuous copy could not be restored: ${(r.stderr || r.stdout).trim().split("\n").slice(-2).join(" | ").slice(0, 200)}` });
    }
    const toCheck = shops.filter((s) => !verdicts.some((v) => v.name === s));
    if (toCheck.length > 0) {
      const jobFile = join(work, "job.json");
      writeFileSync(jobFile, JSON.stringify({ maxLagEntries: 100, shops: toCheck.map((s) => ({ name: s, restored: `/scratch/${s}/agent.db`, live: `/v/${names.dataVolume(s)}/data/agent.db` })) }), { mode: 0o644 });
      // the scratch folder is mounted writable: a restored database in WAL mode needs its -shm beside it to be opened, even to be read
      const r = await ctx.runner.run(ctx.docker, [...jobFlags(ctx, server, false), "-v", `${jobFile}:/job/job.json:ro`, "-v", `${work}:/scratch`, ...toCheck.flatMap((s) => ["-v", `${volume(server, names.dataVolume(s))}:/v/${names.dataVolume(s)}`]), server.appImage, "node", "/app/bundle/backup/drill-check.ts", "/job/job.json"], { timeoutMs: 600_000 });
      const j = lastJson(r.stdout) as { results?: DrillResult[] } | undefined;
      if (!j?.results) toCheck.forEach((s) => verdicts.push({ name: s, ok: false, detail: `the drill's check did not run: ${r.stderr.trim().split("\n").slice(-2).join(" | ").slice(0, 200)}` }));
      else verdicts.push(...j.results);
    }
  } finally { rmSync(work, { recursive: true, force: true }); }
  const at = ctx.now().toISOString();
  for (const v of verdicts) {
    state.shops[v.name].lastDrill = { at, ok: v.ok, detail: v.detail };
    updateStatus(ctx.dir, v.name, ctx.now(), (s) => { s.backups = { ...(s.backups ?? { lastCopyAt: null }), lastDrillAt: at, drillOk: v.ok, drillDetail: v.detail }; }, false);
    lines.push(`${v.name}: restore drill ${v.ok ? "passed" : "FAILED"}: ${v.detail}`);
  }
  saveState(ctx.dir, state);
  return { ok: verdicts.every((v) => v.ok), lines };
}

/** Put a shop's record back from the continuous copy (at a moment if asked) or from a snapshot. The old file is kept beside it, never deleted. */
export async function restoreShop(ctx: Context, shop: string, o: { at?: string; fromSnapshot?: string; identity?: string }): Promise<string> {
  const server = loadServer(ctx.dir);
  const state = loadState(ctx.dir);
  if (!state.shops[shop]?.applied) throw new Error(`${shop} has not been deployed, so there is nothing to restore into.`);
  if (o.fromSnapshot) throw new Error("Restoring from a snapshot file is done with `node bundle/backup/restore-snapshot.ts <file> --identity <key file>` on a machine that has the key; see bundle/README.md, 'Restoring'. (The key is not kept on this server.)");
  if (!server.backup) throw new Error("No continuous copy is set up for this server.");
  if (o.at && Number.isNaN(Date.parse(o.at))) throw new Error(`"${o.at}" is not a time. Use a form like 2026-11-04T10:30:00Z.`);
  const stamp = stampOf(ctx.now());
  const dataVolume = volume(server, names.dataVolume(shop));
  for (const svc of [names.runtime(shop), "litestream"]) await compose(ctx, ["stop", svc]);
  const r = await ctx.runner.run(ctx.docker, ["run", "--rm", "--user", "1000:1000", "--network", `${project(server)}_egress`, "-v", `${dataVolume}:/data/${shop}`, "-v", `${secretFile(ctx.dir, "litestream", "litestream.yml")}:/etc/litestream.yml:ro`, LITESTREAM_IMAGE, "restore", "-config", "/etc/litestream.yml", "-o", `/data/${shop}/data/agent.db.restoring`, ...(o.at ? ["-timestamp", new Date(o.at).toISOString()] : []), `/data/${shop}/data/agent.db`], { timeoutMs: 900_000 });
  if (r.code !== 0) { for (const svc of ["litestream", names.runtime(shop)]) await compose(ctx, ["start", svc]); throw new Error(`The continuous copy could not be restored; the shop's own file is untouched and it has been started again. ${(r.stderr || r.stdout).trim().split("\n").slice(-2).join(" | ").slice(0, 300)}`); }
  const swap = await ctx.runner.run(ctx.docker, ["run", "--rm", "--user", "1000:1000", "--network", "none", "-v", `${dataVolume}:/data/${shop}`, "busybox:1.37.0", "sh", "-c", `cd /data/${shop}/data && mv agent.db agent.db.before-restore-${stamp} 2>/dev/null; rm -f agent.db-wal agent.db-shm; mv agent.db.restoring agent.db`]);
  for (const svc of ["litestream", names.runtime(shop)]) await compose(ctx, ["start", svc]);
  if (swap.code !== 0) throw new Error(`The restored file could not be put in place: ${swap.stderr.trim().slice(0, 200)}`);
  return `${shop}'s record is restored${o.at ? ` as it was at ${o.at}` : " to the latest copy"}. The file it replaced is kept as agent.db.before-restore-${stamp}. The shop is running again.`;
}
