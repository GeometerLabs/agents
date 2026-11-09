// The data duties, on the host side: the nightly snapshot, the weekly restore drill and `restore`. Each starts a short-lived container with the volumes it
// needs (the deployer is the only process with the Docker socket) and reads one line of JSON back. Nothing here sees a secret except the bucket key it mounts
// into those containers, and, for `restore` only, the owner's age key that the person restoring brings for the purpose.
//
//   what is copied        when and where                                       by
//   runtime database      nightly, gzipped and age-encrypted to the owner      backup/snapshot.ts (VACUUM INTO: a consistent copy while the runtime writes)
//   each Guard's store    nightly with the above, Guard's own POST /admin/backup (a consistent copy of its store and its evidence ledger, checked by geo-verify)
//   the weekly drill      WITHOUT the key: reads the newest snapshot's objects back and compares their sha256 with what was uploaded, and checks that the copy's
//                         record (integrity-checked when it was made) is the start of the live record and matches the published fingerprints (drill-check.ts)
//   `restore`             with the owner's key (--identity): puts the runtime's database back from the newest snapshot at or before a time; the runtime then
//                         starts in its restored mode. A full restore test is the same, by a person, monthly, on their own machine (restore-snapshot.ts)
// The snapshot job hands back each snapshot's seal (object digests, record facts, chain head: no customer's words or numbers); the newest per shop is kept in
// state/snapshots/<shop>.json for the drill.
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { adminCall, compose } from "../deploy.ts";
import type { Context } from "../deploy.ts";
import { modulesOf } from "../generate/compose.ts";
import { names } from "../generate/shop.ts";
import { appliedPathwayDir } from "../lib/pathways.ts";
import { RESTORE_NOTE } from "../../modules/runtime/restored.ts";
import { loadServer, serverPaths } from "../lib/server.ts";
import type { ServerConfig } from "../lib/server.ts";
import { ensurePersonKey, ensureShopPersonKeys, restorePersonKey, secretFile } from "../lib/secrets.ts";
import { loadState, saveState } from "../lib/state.ts";
import { updateStatus } from "../lib/status.ts";
import type { UsageTotals } from "../lib/usage.ts";
import { ensureDir, writeAtomic } from "../lib/util.ts";
import { readFingerprints } from "../../modules/record/publish.ts";
import type { DrillResult, PublishedLine } from "./drill-check.ts";
import { fingerprintFile, lastFingerprint } from "./fingerprints.ts";
import { PERSON_KEY_OBJECT } from "./snapshot.ts";
import type { RecordFacts, Seal, ShopSnapshot } from "./snapshot.ts";

export const project = (server: ServerConfig) => `geometer-${server.id.replace(/_/gu, "-")}`;
const volume = (server: ServerConfig, v: string) => `${project(server)}_${v}`;
const stampOf = (d: Date) => d.toISOString().replace(/[-:]|\.\d{3}/gu, "");
const GUARD_BACKUPS = "/var/lib/geo-guard/backups";
const NO_BACKUP = "No backup is set up: `geometer init` was not given a snapshot place and a key (see bundle/README.md, 'Backups').";

/** The newest snapshot's seal for a shop, as the snapshot job handed it back: what the drill checks the snapshot by. */
export const sealFile = (dir: string, shop: string) => join(serverPaths(dir).state, "snapshots", `${shop}.json`);
function readSeal(dir: string, shop: string): Seal | undefined {
  try { return JSON.parse(readFileSync(sealFile(dir, shop), "utf8")) as Seal; } catch { return undefined; }
}
/** What a night says when the key could not prune: the bucket's own lifecycle rule deletes old snapshots, and this was only the fallback. */
export const PRUNE_LEFT = "pruning left to the bucket's lifecycle rule";

/** The flags every job container gets: no network unless it needs the bucket, no capability but reading and writing files it does not own, the code read-only. */
function jobFlags(ctx: Context, server: ServerConfig, network: boolean, user = "0"): string[] {
  return ["run", "--rm", "--user", user, "--cap-drop", "ALL", ...(user === "0" ? ["--cap-add", "DAC_OVERRIDE", "--cap-add", "DAC_READ_SEARCH"] : []), "--read-only", "--tmpfs", "/tmp", "--security-opt", "no-new-privileges:true",
    "--network", network ? `${project(server)}_egress` : "none", "-v", `${ctx.appDir}:/app:ro`];
}

/** How a job container reaches the snapshot place: the egress network and the bucket's key for a bucket, the folder itself for a folder. */
function snapshotPlace(ctx: Context, server: ServerConfig): { network: boolean; mounts: string[] } {
  const target = server.backup!.snapshots;
  const bucket = target.url.startsWith("s3://");
  const key = secretFile(ctx.dir, "backup", "snapshots");
  return { network: bucket, mounts: bucket ? (existsSync(key) ? ["-v", `${key}:/run/secrets/snapshots:ro`] : []) : ["-v", `${target.url}:${target.url}`] };
}

function lastJson(text: string): any {
  try { return JSON.parse(text.trim().split("\n").at(-1) ?? ""); } catch { return undefined; }
}

export async function runBackup(ctx: Context): Promise<{ ok: boolean; lines: string[] }> {
  const server = loadServer(ctx.dir);
  const lines: string[] = [];
  if (!server.backup) return { ok: false, lines: [NO_BACKUP] };
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
  for (const [shop] of shops) ensurePersonKey(ctx.dir, shop); // B69: the key goes in the snapshot's manifest, so a restored shop can still match its own people (`restore` puts it back)
  writeFileSync(jobFile, JSON.stringify({ stamp, keepDays: server.backup.snapshots.keepDays ?? 30, recipient: server.backup.ageRecipient, target: server.backup.snapshots,
    shops: shops.map(([shop, s]) => ({ name: shop, runtimeDb: `/v/${names.dataVolume(shop)}/data/agent.db`, personKeyFile: `/run/person-keys/${shop}`, guards: Object.values(s.applied!.guards).map((g) => ({ kind: g.kind, dir: `/v/${names.stateVolume(shop, g.kind as "razorpay")}/backups/${stamp}` })) })) }), { mode: 0o644 });
  const mounts = shops.flatMap(([shop, s]) => [["-v", `${volume(server, names.dataVolume(shop))}:/v/${names.dataVolume(shop)}`], ...Object.values(s.applied!.guards).map((g) => ["-v", `${volume(server, names.stateVolume(shop, g.kind as "razorpay"))}:/v/${names.stateVolume(shop, g.kind as "razorpay")}`])]).flat();
  const place = snapshotPlace(ctx, server);
  const r = await ctx.runner.run(ctx.docker, [...jobFlags(ctx, server, place.network), "-v", `${jobFile}:/job/job.json:ro`, ...place.mounts, "-v", `${join(serverPaths(ctx.dir).secrets, "person-keys")}:/run/person-keys:ro`, ...mounts, server.appImage, "node", "/app/bundle/backup/snapshot.ts", "/job/job.json"], { timeoutMs: 900_000 });
  rmSync(jobFile, { force: true });
  const out = lastJson(r.stdout) as { results?: ShopSnapshot[] } | undefined;
  if (r.code !== 0 || !out?.results) return { ok: false, lines: [...lines, `The snapshot job failed: ${r.stderr.trim().split("\n").slice(-3).join(" | ") || `exit ${r.code}`}`] };
  let ok = true;
  for (const res of out.results) {
    if (res.ok) {
      state.shops[res.name].lastBackupAt = ctx.now().toISOString();
      if (res.seal) { ensureDir(join(serverPaths(ctx.dir).state, "snapshots")); writeAtomic(sealFile(ctx.dir, res.name), `${JSON.stringify(res.seal)}\n`); }
      updateStatus(ctx.dir, res.name, ctx.now(), (s) => { s.backups = { ...(s.backups ?? { lastDrillAt: null, drillOk: null }), lastCopyAt: ctx.now().toISOString() }; }, false);
      lines.push(`${res.name}: snapshot ${res.stamp} written (${res.files} objects, ${res.bytes} bytes, gzipped and encrypted)${res.record ? `, record at entry #${res.record.lastSeq ?? 0}` : ""}${res.pruneError ? `; ${PRUNE_LEFT} (this key may not list or delete: ${res.pruneError.slice(0, 160)})` : ""}`);
    } else { ok = false; lines.push(`${res.name}: NO snapshot (${res.error})`); }
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
  // B69: every shop has its fingerprint key before the job starts (a shop made before B69 gets one now, and the panel's copy with it). The job file only names the file: the key itself is mounted read-only, for this job only.
  for (const n of shops) ensureShopPersonKeys(ctx.dir, n, names.runtime(n), server.panel.enabled);
  writeFileSync(jobFile, JSON.stringify({ shops: shops.map((n) => ({ name: n, db: `/v/${names.dataVolume(n)}/data/agent.db`, out: `/out/${n}`, personKeyFile: `/run/person-keys/${n}` })) }), { mode: 0o644 });
  const r = await ctx.runner.run(ctx.docker, [...jobFlags(ctx, server, false), "-v", `${jobFile}:/job/job.json:ro`, "-v", `${serverPaths(ctx.dir).exports}:/out`, "-v", `${join(serverPaths(ctx.dir).secrets, "person-keys")}:/run/person-keys:ro`, ...shops.flatMap((n) => ["-v", `${volume(server, names.dataVolume(n))}:/v/${names.dataVolume(n)}`]), server.appImage, "node", "/app/bundle/backup/export.ts", "/job/job.json"], { timeoutMs: 300_000 });
  rmSync(jobFile, { force: true });
  const out = lastJson(r.stdout) as { results?: { name: string; ok: boolean; entries?: number; bookings?: number; dues?: number; orders?: number; usage?: UsageTotals; obligations?: Record<string, number>; error?: string }[] } | undefined;
  if (r.code !== 0 || !out?.results) return { ok: false, lines: [`The export job failed: ${r.stderr.trim().split("\n").slice(-2).join(" | ") || `exit ${r.code}`}`] };
  // The cost meter's counts go into the shop's status file, where ops reads them for the heartbeat. They are not a confirmation of the shop, so `updatedAt` stays where it is.
  for (const x of out.results) if (x.ok && x.usage && shops.includes(x.name)) updateStatus(ctx.dir, x.name, ctx.now(), (s) => { s.usage = { ...x.usage as UsageTotals, at: ctx.now().toISOString() }; }, false);
  // the unfinished-work counts by kind, for the heartbeat's open_obligations (a gauge: the counts now, replaced at every export)
  for (const x of out.results) if (x.ok && x.obligations && shops.includes(x.name)) updateStatus(ctx.dir, x.name, ctx.now(), (s) => { s.obligations = { counts: x.obligations!, at: ctx.now().toISOString() }; }, false);
  return { ok: out.results.every((x) => x.ok || x.error === "no database yet"), lines: out.results.map((x) => (x.ok ? `${x.name}: exported ${x.entries} record entries and ${x.orders !== undefined ? `${x.orders} orders` : x.dues !== undefined ? `${x.dues} fees` : `${x.bookings} bookings`}` : `${x.name}: not exported (${x.error})`)) };
}

/** The fingerprints published for a shop (the last 60 days are enough for a snapshot kept 30); a fingerprint file that was changed by hand is a drill failure of its own. */
function publishedOf(dir: string, shop: string): PublishedLine[] {
  try { return readFingerprints(fingerprintFile(dir, shop)).filter((l) => l.tenant === shop).slice(-60).map((l) => ({ seq: l.seq, head: l.head, day: l.day, at: l.at })); } catch { return [{ seq: 0, head: "unreadable", day: "unreadable" }]; }
}

/** The weekly drill, without the key: each shop's newest snapshot read back and compared with its seal, and the seal's record with the live one. A failure is written where the panel and `status` show it. */
export async function runDrill(ctx: Context): Promise<{ ok: boolean; lines: string[] }> {
  const server = loadServer(ctx.dir);
  if (!server.backup) return { ok: false, lines: ["No backup is set up, so there is nothing to drill."] };
  const state = loadState(ctx.dir);
  const applied = Object.entries(state.shops).filter(([, s]) => s.applied).map(([n]) => n);
  // a shop with no snapshot yet (added since last night) has nothing to drill: no verdict, as fleet reads "absent" (the snapshot's age alerts if none comes)
  const seals = new Map(applied.flatMap((s): [string, Seal][] => { const seal = readSeal(ctx.dir, s); return seal ? [[s, seal]] : []; }));
  const shops = applied.filter((s) => seals.has(s));
  const lines: string[] = applied.filter((s) => !seals.has(s)).map((s) => `${s}: no snapshot of it yet, so no drill this time`);
  if (shops.length === 0) return { ok: true, lines };
  const work = join(serverPaths(ctx.dir).state, "work");
  ensureDir(work);
  const jobFile = join(work, `drill-${stampOf(ctx.now())}.json`);
  let verdicts: DrillResult[] = [];
  try {
    writeFileSync(jobFile, JSON.stringify({ target: server.backup.snapshots, shops: shops.map((s) => ({ name: s, live: `/v/${names.dataVolume(s)}/data/agent.db`, seal: seals.get(s), published: publishedOf(ctx.dir, s) })) }), { mode: 0o644 });
    const place = snapshotPlace(ctx, server);
    const r = await ctx.runner.run(ctx.docker, [...jobFlags(ctx, server, place.network), "-v", `${jobFile}:/job/job.json:ro`, ...place.mounts,
      ...shops.flatMap((s) => ["-v", `${volume(server, names.dataVolume(s))}:/v/${names.dataVolume(s)}`]), server.appImage, "node", "/app/bundle/backup/drill-check.ts", "/job/job.json"], { timeoutMs: 600_000 });
    const j = lastJson(r.stdout) as { results?: DrillResult[] } | undefined;
    verdicts = j?.results ?? shops.map((s) => ({ name: s, ok: false, detail: `the drill did not run: ${r.stderr.trim().split("\n").slice(-2).join(" | ").slice(0, 200) || `exit ${r.code}`}` }));
  } finally { rmSync(jobFile, { force: true }); }
  const at = ctx.now().toISOString();
  for (const v of verdicts) {
    if (!state.shops[v.name]) continue;
    state.shops[v.name].lastDrill = { at, ok: v.ok, detail: v.detail };
    updateStatus(ctx.dir, v.name, ctx.now(), (s) => { s.backups = { ...(s.backups ?? { lastCopyAt: null }), lastDrillAt: at, drillOk: v.ok, drillDetail: v.detail }; }, false);
    lines.push(`${v.name}: restore drill ${v.ok ? "passed" : "FAILED"}: ${v.detail}`);
  }
  saveState(ctx.dir, state);
  return { ok: verdicts.length === shops.length && verdicts.every((v) => v.ok), lines };
}

/**
 * Put a shop's runtime database back from the newest snapshot at or before `at` (the newest of all without it), opened with the owner's age key, which the person
 * restoring brings (`identity`, a key file; it is mounted read-only into the one container that opens the snapshot, and is not kept). The file it replaces is kept
 * beside it, never deleted. The runtime starts in its restored mode (modules/runtime/restored.ts): it moves its ids on and writes a `restored` entry before anything else.
 */
export async function restoreShop(ctx: Context, shop: string, o: { at?: string; identity?: string; fromSnapshot?: string }): Promise<string> {
  const server = loadServer(ctx.dir);
  const state = loadState(ctx.dir);
  if (!state.shops[shop]?.applied) throw new Error(`${shop} has not been deployed, so there is nothing to restore into.`);
  if (o.fromSnapshot) throw new Error("--from-snapshot is gone: `restore` now reads the nightly snapshots itself. Give --identity <the owner's key file>, and --at <time> for an older one.");
  if (!server.backup) throw new Error("No snapshot place is set up for this server, so there is nothing to restore from.");
  if (o.at && Number.isNaN(Date.parse(o.at))) throw new Error(`"${o.at}" is not a time. Use a form like 2026-11-04T10:30:00Z.`);
  if (!o.identity) throw new Error("A snapshot opens only with the owner's age key, which is kept off this server: bring it for the restore and give its file with --identity <key file> (take it away again afterwards).");
  if (!existsSync(o.identity)) throw new Error(`${o.identity} is not there: --identity names the file with the owner's age key (AGE-SECRET-KEY-1...).`);
  // the runtime that will read restored.json is the one of the version the shop is pinned to: one from before 9 Nov 2026 would ignore it and reuse ids used after the
  // snapshot, and "look first" would then take another customer's payment link or calendar event for its own
  const applied = state.shops[shop].applied!;
  const pinned = appliedPathwayDir(ctx.appDir, ctx.dir, applied) ?? applied.pathwayDir;
  if (!existsSync(join(modulesOf(pinned), "runtime", "restored.ts"))) throw new Error(`${shop} runs ${applied.pathway}, whose runtime does not know a restore: it would give new bookings ids that were used after the snapshot, and could take another customer's payment link for its own. Move ${shop} to a version from 9 Nov 2026 or later first (geometer update --shops ${shop}), then restore. Nothing was touched.`);
  const stamp = stampOf(ctx.now());
  const work = join(serverPaths(ctx.dir).state, "work", `restore-${shop}-${stamp}`);
  const dataVolume = volume(server, names.dataVolume(shop));
  let got: { stamp: string; record: RecordFacts };
  let keyNote = "";
  try {
    mkdirSync(join(work, "files"), { recursive: true }); chmodSync(join(work, "files"), 0o777); // the container writes here; the deployer removes it after
    writeFileSync(join(work, "job.json"), JSON.stringify({ target: server.backup.snapshots, shop, ...(o.at ? { atMs: Date.parse(o.at) } : {}), identityFile: "/run/secrets/identity", out: "/out/files", nowIso: ctx.now().toISOString() }), { mode: 0o644 });
    // 1. fetch, check and open the snapshot while the shop still runs (nothing of the shop's is touched yet)
    const place = snapshotPlace(ctx, server);
    const r = await ctx.runner.run(ctx.docker, [...jobFlags(ctx, server, place.network), "-v", `${work}:/out`, "-v", `${o.identity}:/run/secrets/identity:ro`, ...place.mounts, server.appImage, "node", "/app/bundle/backup/restore-snapshot.ts", "--job", "/out/job.json"], { timeoutMs: 900_000 });
    const out = lastJson(r.stdout) as { ok?: boolean; stamp?: string; record?: RecordFacts; error?: string } | undefined;
    if (!out?.ok || !out.stamp || !out.record) throw new Error(`No snapshot was restored; the shop was not touched and is still running. ${out?.error ?? (r.stderr.trim().split("\n").slice(-2).join(" | ").slice(0, 300) || `exit ${r.code}`)}`);
    got = { stamp: out.stamp, record: out.record };
    // 2. with the runtime stopped, put it in place as the runtime's own user; the old file is kept, and restored.json tells the runtime it was restored
    await compose(ctx, ["stop", names.runtime(shop)]);
    const swap = await ctx.runner.run(ctx.docker, ["run", "--rm", "--user", "1000:1000", "--network", "none", "-v", `${work}/files:/in:ro`, "-v", `${dataVolume}:/data/${shop}`, "busybox:1.37.0", "sh", "-c",
      `cd /data/${shop}/data && cp /in/agent.db agent.db.restoring && (mv agent.db agent.db.before-restore-${stamp} 2>/dev/null; mv agent.db-wal agent.db.before-restore-${stamp}-wal 2>/dev/null; true) && rm -f agent.db-shm && mv agent.db.restoring agent.db && cp /in/${RESTORE_NOTE} ${RESTORE_NOTE}`]);
    // B69: the snapshot's fingerprint key goes back before the runtime starts, so the shop can match the people already in its record
    if (swap.code === 0) keyNote = keyPutBack(ctx.dir, shop, join(work, "files", PERSON_KEY_OBJECT), server.panel.enabled, stamp);
    await compose(ctx, ["start", names.runtime(shop)]);
    if (swap.code !== 0) throw new Error(`The restored file could not be put in place: ${swap.stderr.trim().slice(0, 200)}`);
  } finally { rmSync(work, { recursive: true, force: true }); }
  const published = lastFingerprint(ctx.dir, shop);
  const behind = published && published.seq > (got.record.lastSeq ?? 0)
    ? ` The shop's last daily fingerprint (${published.day}) covers entry ${published.seq}, after this snapshot: from now on its fingerprint and the drill's comparison will say the record no longer matches what was published (see bundle/Deferred.md).`
    : "";
  return `${shop}'s database is restored from the snapshot of ${got.stamp} (record up to entry #${got.record.lastSeq ?? 0}). The file it replaced is kept as agent.db.before-restore-${stamp}. The shop is running again: before anything else it moves its ids on, writes a "restored" entry, and looks at the payment service and the calendar before it sends anything again.${keyNote}${behind}`;
}

/** The fingerprint key the restore job took out of the snapshot, put back; what to say about it. A snapshot from before the key has none, and the shop keeps the one it has. */
function keyPutBack(dir: string, shop: string, file: string, panelOn: boolean, stamp: string): string {
  if (!existsSync(file)) return " This snapshot holds no fingerprint key (it is older than the key), so the shop keeps the one it has.";
  const kept = restorePersonKey(dir, shop, readFileSync(file, "utf8").trim(), names.runtime(shop), panelOn, stamp);
  return kept ? ` The shop's fingerprint key was put back from the snapshot; the one it replaced is kept as ${kept}.` : "";
}
