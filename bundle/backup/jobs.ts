// The data duties, on the host side: the nightly snapshot, the weekly restore drill and `restore`. Each starts a short-lived container with the volumes it
// needs (the deployer is the only process with the Docker socket) and reads one line of JSON back. Nothing here sees a secret except the bucket key it mounts
// into those containers, the shop's fingerprint key (B69: mounted read-only into the export and snapshot jobs, and put back by `restore`), and, for `restore` only, the owner's age
// key that the person restoring brings for the purpose.
//
//   what is copied        when and where                                       by
//   runtime database      nightly, gzipped and age-encrypted to the owner      backup/snapshot.ts (VACUUM INTO: a consistent copy while the runtime writes)
//   each Guard's store    nightly with the above, Guard's own POST /admin/backup (a consistent copy of its store and its evidence ledger, checked by geo-verify)
//   the weekly drill      WITHOUT the key: reads the newest snapshot's objects back and compares their sha256 with what was uploaded, and checks that the copy's
//                         record (integrity-checked when it was made) is the start of the live record and matches the published fingerprints (drill-check.ts)
//   `restore`             with the owner's key (--identity): puts the runtime's database back from the newest snapshot at or before a time; the runtime then
//                         starts in its restored mode. A full restore test is the same, by a person, monthly, on their own machine (restore-snapshot.ts)
// An agent someone else wrote (B51) is in all three: its Guards' stores as a shop's, its record (state/records/<agent>.json, the deployer's own file) in place of the
// runtime's database, and its key. Its `restore` puts back the Guards' stores too (restoreAgent): it has no runtime that looks at the providers before acting again.
// The snapshot job hands back each snapshot's seal (object digests, record facts, chain head, the key's id: no customer's words or numbers); the newest per shop or
// agent is kept in state/snapshots/<name>.json for the drill.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { adminCall, compose, ops, renewRelayCredential } from "../deploy.ts";
import type { Context } from "../deploy.ts";
import { deployAgent } from "../agent/deploy.ts";
import { readAgent } from "../agent/folder.ts";
import { loadRecord, recordFile } from "../agent/records.ts";
import { canonicalJson } from "../../modules/record/record.ts";
import type { RecordEntry } from "../../modules/record/record.ts";
import { keyedDigest } from "../../modules/record/fingerprint.ts";
import { parseKey } from "../../modules/record/key-file.ts";
import { modulesOf } from "../generate/compose.ts";
import { names } from "../generate/shop.ts";
import { appliedPathwayDir } from "../lib/pathways.ts";
import { RESTORE_NOTE } from "../../modules/runtime/restored.ts";
import { loadServer, serverPaths } from "../lib/server.ts";
import type { ServerConfig } from "../lib/server.ts";
import { PERSON_KEY, ensureAgentLabelKey, ensurePersonKey, ensureShopPersonKeys, keyIdOf, personKeyFile, readSecretFile, restoreAgentKey, restorePersonKey, secretFile } from "../lib/secrets.ts";
import { loadState, saveState } from "../lib/state.ts";
import { updateStatus } from "../lib/status.ts";
import type { UsageTotals } from "../lib/usage.ts";
import { ensureDir, writeAtomic } from "../lib/util.ts";
import { readFingerprints } from "../../modules/record/publish.ts";
import type { DrillResult, PublishedLine } from "./drill-check.ts";
import { fingerprintFile, lastFingerprint } from "./fingerprints.ts";
import { AGENT_RECORD_FILE, PERSON_KEY_OBJECT } from "./snapshot.ts";
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

/** Every deployed agent someone else wrote (B51): its Guards are backed up like a shop's, and its record (state/records/<agent>.json) takes the runtime database's place. */
const appliedAgents = (state: ReturnType<typeof loadState>) => Object.entries(state.agents ?? {}).filter(([, a]) => a.applied);
/** The deployer's folder of agents' records, mounted read-only into the snapshot and drill jobs. The FOLDER, made first: a bind mount of a file that is not there yet would make a directory in its place. */
function recordsMount(dir: string): string[] {
  const folder = join(serverPaths(dir).state, "records");
  ensureDir(folder);
  return ["-v", `${folder}:/run/records:ro`];
}
const guardMounts = (server: ServerConfig, name: string, guards: { kind: string }[]) => guards.flatMap((g) => ["-v", `${volume(server, names.stateVolume(name, g.kind as "razorpay"))}:/v/${names.stateVolume(name, g.kind as "razorpay")}`]);
/** What a night's or a drill's verdict is written on: a shop's state or an agent's. */
const entryOf = (state: ReturnType<typeof loadState>, name: string): { lastBackupAt?: string; lastDrill?: { at: string; ok: boolean; detail: string } } | undefined => state.shops[name] ?? state.agents?.[name];

export async function runBackup(ctx: Context): Promise<{ ok: boolean; lines: string[] }> {
  const server = loadServer(ctx.dir);
  const lines: string[] = [];
  if (!server.backup) return { ok: false, lines: [NO_BACKUP] };
  const state = loadState(ctx.dir);
  const shops = Object.entries(state.shops).filter(([, s]) => s.applied);
  const agents = appliedAgents(state);
  const stamp = stampOf(ctx.now());
  const work = join(serverPaths(ctx.dir).state, "work");
  ensureDir(work);
  // 1. each Guard writes its own consistent backup into its own state volume: a shop's, and an agent's someone else wrote (its approvals and once-only ledger are only there)
  for (const [name, s] of [...shops, ...agents]) for (const g of Object.values(s.applied!.guards)) {
    const r = await adminCall(ctx, g.service, "POST", "/admin/backup", { to: `${GUARD_BACKUPS}/${stamp}` });
    if (r.status !== 200) lines.push(`${g.service}: Guard's own backup was not made (HTTP ${r.status}: ${String(r.body?.error ?? "").slice(0, 120)}); ${state.shops[name] ? "the shop's runtime database" : "the agent's record"} is still copied.`);
  }
  // 2. the snapshot container
  const jobFile = join(work, `snapshot-${stamp}.json`);
  for (const [name] of [...shops, ...agents]) ensurePersonKey(ctx.dir, name); // B69: the key goes in the snapshot's manifest, so a restored shop or agent can still match its own people (`restore` puts it back)
  writeFileSync(jobFile, JSON.stringify({ stamp, keepDays: server.backup.snapshots.keepDays ?? 30, recipient: server.backup.ageRecipient, target: server.backup.snapshots,
    shops: shops.map(([shop, s]) => ({ name: shop, runtimeDb: `/v/${names.dataVolume(shop)}/data/agent.db`, personKeyFile: `/run/person-keys/${shop}`, guards: Object.values(s.applied!.guards).map((g) => ({ kind: g.kind, dir: `/v/${names.stateVolume(shop, g.kind as "razorpay")}/backups/${stamp}` })) })),
    agents: agents.map(([agent, a]) => ({ name: agent, recordFile: `/run/records/${agent}.json`, personKeyFile: `/run/person-keys/${agent}`, guards: Object.values(a.applied!.guards).map((g) => ({ kind: g.kind, dir: `/v/${names.stateVolume(agent, g.kind as "razorpay")}/backups/${stamp}` })) })) }), { mode: 0o644 });
  const mounts = [
    ...shops.flatMap(([shop, s]) => ["-v", `${volume(server, names.dataVolume(shop))}:/v/${names.dataVolume(shop)}`, ...guardMounts(server, shop, Object.values(s.applied!.guards))]),
    ...agents.flatMap(([agent, a]) => guardMounts(server, agent, Object.values(a.applied!.guards))),
    ...(agents.length > 0 ? recordsMount(ctx.dir) : []),
  ];
  const place = snapshotPlace(ctx, server);
  const r = await ctx.runner.run(ctx.docker, [...jobFlags(ctx, server, place.network), "-v", `${jobFile}:/job/job.json:ro`, ...place.mounts, "-v", `${join(serverPaths(ctx.dir).secrets, "person-keys")}:/run/person-keys:ro`, ...mounts, server.appImage, "node", "/app/bundle/backup/snapshot.ts", "/job/job.json"], { timeoutMs: 900_000 });
  rmSync(jobFile, { force: true });
  const out = lastJson(r.stdout) as { results?: ShopSnapshot[] } | undefined;
  if (r.code !== 0 || !out?.results) return { ok: false, lines: [...lines, `The snapshot job failed: ${r.stderr.trim().split("\n").slice(-3).join(" | ") || `exit ${r.code}`}`] };
  let ok = true;
  for (const res of out.results) {
    const entry = entryOf(state, res.name);
    if (!entry) continue;
    if (res.ok) {
      entry.lastBackupAt = ctx.now().toISOString();
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
  const agentNames = new Set(appliedAgents(state).map(([n]) => n));
  const applied = [...Object.entries(state.shops).filter(([, s]) => s.applied).map(([n]) => n), ...agentNames];
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
    // B69: the drill is handed the id of the key this server holds (never the key), to compare with the one the seal names
    const keyId = (name: string) => { const k = readSecretFile(personKeyFile(ctx.dir, name)); return k && PERSON_KEY.test(k) ? { keyId: keyIdOf(k) } : {}; };
    writeFileSync(jobFile, JSON.stringify({ target: server.backup.snapshots, shops: shops.map((s) => (agentNames.has(s)
      ? { name: s, live: `/run/records/${s}.json`, ownAgent: true, seal: seals.get(s), ...keyId(s) }
      : { name: s, live: `/v/${names.dataVolume(s)}/data/agent.db`, seal: seals.get(s), published: publishedOf(ctx.dir, s), ...keyId(s) })) }), { mode: 0o644 });
    const place = snapshotPlace(ctx, server);
    const r = await ctx.runner.run(ctx.docker, [...jobFlags(ctx, server, place.network), "-v", `${jobFile}:/job/job.json:ro`, ...place.mounts,
      ...shops.filter((s) => !agentNames.has(s)).flatMap((s) => ["-v", `${volume(server, names.dataVolume(s))}:/v/${names.dataVolume(s)}`]), ...(shops.some((s) => agentNames.has(s)) ? recordsMount(ctx.dir) : []),
      server.appImage, "node", "/app/bundle/backup/drill-check.ts", "/job/job.json"], { timeoutMs: 600_000 });
    const j = lastJson(r.stdout) as { results?: DrillResult[] } | undefined;
    verdicts = j?.results ?? shops.map((s) => ({ name: s, ok: false, detail: `the drill did not run: ${r.stderr.trim().split("\n").slice(-2).join(" | ").slice(0, 200) || `exit ${r.code}`}` }));
  } finally { rmSync(jobFile, { force: true }); }
  const at = ctx.now().toISOString();
  for (const v of verdicts) {
    const entry = entryOf(state, v.name);
    if (!entry) continue;
    entry.lastDrill = { at, ok: v.ok, detail: v.detail };
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
  let snapshotKey: string | undefined;
  try {
    mkdirSync(join(work, "files"), { recursive: true }); chmodSync(join(work, "files"), 0o777); // the container writes here; the deployer removes it after
    writeFileSync(join(work, "job.json"), JSON.stringify({ target: server.backup.snapshots, shop, ...(o.at ? { atMs: Date.parse(o.at) } : {}), identityFile: "/run/secrets/identity", out: "/out/files", nowIso: ctx.now().toISOString() }), { mode: 0o644 });
    // 1. fetch, check and open the snapshot while the shop still runs (nothing of the shop's is touched yet)
    const place = snapshotPlace(ctx, server);
    const r = await ctx.runner.run(ctx.docker, [...jobFlags(ctx, server, place.network), "-v", `${work}:/out`, "-v", `${o.identity}:/run/secrets/identity:ro`, ...place.mounts, server.appImage, "node", "/app/bundle/backup/restore-snapshot.ts", "--job", "/out/job.json"], { timeoutMs: 900_000 });
    const out = lastJson(r.stdout) as { ok?: boolean; stamp?: string; record?: RecordFacts; error?: string } | undefined;
    if (!out?.ok || !out.stamp || !out.record) throw new Error(`No snapshot was restored; the shop was not touched and is still running. ${out?.error ?? (r.stderr.trim().split("\n").slice(-2).join(" | ").slice(0, 300) || `exit ${r.code}`)}`);
    got = { stamp: out.stamp, record: out.record };
    // B69: the snapshot's fingerprint key, checked now, while nothing of the shop's has been touched
    const keyFile = join(work, "files", PERSON_KEY_OBJECT);
    snapshotKey = existsSync(keyFile) ? readFileSync(keyFile, "utf8").trim() : undefined;
    if (snapshotKey !== undefined && !PERSON_KEY.test(snapshotKey)) throw new Error("No snapshot was restored; the shop was not touched and is still running. The fingerprint key in this snapshot is not a key.");
    // 2. with the runtime stopped, put it in place as the runtime's own user; the old file is kept, and restored.json tells the runtime it was restored
    await compose(ctx, ["stop", names.runtime(shop)]);
    const swap = await ctx.runner.run(ctx.docker, ["run", "--rm", "--user", "1000:1000", "--network", "none", "-v", `${work}/files:/in:ro`, "-v", `${dataVolume}:/data/${shop}`, "busybox:1.37.0", "sh", "-c",
      `cd /data/${shop}/data && cp /in/agent.db agent.db.restoring && (mv agent.db agent.db.before-restore-${stamp} 2>/dev/null; mv agent.db-wal agent.db.before-restore-${stamp}-wal 2>/dev/null; true) && rm -f agent.db-shm && mv agent.db.restoring agent.db && cp /in/${RESTORE_NOTE} ${RESTORE_NOTE}`]);
    // B69: the snapshot's fingerprint key goes back before the runtime starts, so the shop can match the people already in its record
    if (swap.code === 0) keyNote = keyPutBack(ctx.dir, shop, snapshotKey, server.panel.enabled, stamp);
    await compose(ctx, ["start", names.runtime(shop)]);
    if (swap.code !== 0) throw new Error(`The restored file could not be put in place: ${swap.stderr.trim().slice(0, 200)}`);
  } finally { rmSync(work, { recursive: true, force: true }); }
  const published = lastFingerprint(ctx.dir, shop);
  const behind = published && published.seq > (got.record.lastSeq ?? 0)
    ? ` The shop's last daily fingerprint (${published.day}) covers entry ${published.seq}, after this snapshot: from now on its fingerprint and the drill's comparison will say the record no longer matches what was published (see bundle/Deferred.md).`
    : "";
  return `${shop}'s database is restored from the snapshot of ${got.stamp} (record up to entry #${got.record.lastSeq ?? 0}). The file it replaced is kept as agent.db.before-restore-${stamp}. The shop is running again: before anything else it moves its ids on, writes a "restored" entry, and looks at the payment service and the calendar before it sends anything again.${keyNote}${behind}`;
}

/** The fingerprint key the restore job took out of the snapshot, put back; what to say about it. It never throws: the database is already in place and the runtime must still start. */
function keyPutBack(dir: string, shop: string, key: string | undefined, panelOn: boolean, stamp: string): string {
  if (key === undefined) return " This snapshot holds no fingerprint key (it is older than the key), so the shop keeps the one it has.";
  try {
    const kept = restorePersonKey(dir, shop, key, names.runtime(shop), panelOn, stamp);
    return kept ? ` The shop's fingerprint key was put back from the snapshot; the one it replaced is kept as ${kept}.` : "";
  } catch (e) { return ` The shop's fingerprint key could NOT be put back (${(e as Error).message}): open the snapshot with restore-snapshot.ts and put its person_key at secrets/person-keys/${shop}, mode 0600, then deploy.`; }
}

// ---- an agent someone else wrote (B51) ------------------------------------------------------------------------------------------------------------------

/** Where Guard's own `restore` is tried first (backup/jobs.ts, restoreAgent): a copy of the Guard's guard.toml with its store in a scratch folder, and an admin address nothing answers on. */
const TRIAL = "/trial";
const trialToml = (toml: string): string => toml
  .replace(/^state = ".*"$/mu, `state = "${TRIAL}/scratch/state.db"`)
  // Guard's restore refuses while something answers on the admin address; in the Guard's own network namespace the live Guard does, so the trial names another
  .replace(/^admin_listen = ".*"$/mu, 'admin_listen = "127.0.0.1:65534"');

/** One `geo-guard` command in a Guard's own container definition (its image, user, volumes and network namespace), with the snapshot's folder for that Guard at /in. */
const guardCommand = (ctx: Context, service: string, from: string, extra: string[], args: string[]) => compose(ctx, ["run", "--rm", "--no-deps", "-T", "-v", `${from}:/in:ro`, ...extra, service, ...args], { timeoutMs: 300_000 });

/** The running Guard's status, once it answers with its tripwires run (a Guard that was just started takes a few seconds). */
async function guardStatus(ctx: Context, service: string): Promise<{ status: number; body: any }> {
  const tries = Math.max(1, Math.ceil((ctx.waitSeconds ?? 120) / 3));
  let s: { status: number; body: any } = { status: 0, body: null };
  for (let i = 0; i < tries; i++) {
    s = await adminCall(ctx, service, "GET", "/admin/status");
    if (s.status === 200 && s.body?.tripwires?.ran === true) return s;
    if (i < tries - 1) await ctx.sleep(3_000);
  }
  return s;
}

/**
 * Put an agent someone else wrote (B51) back from the newest snapshot at or before `at`: each of its Guards' stores (every decision, the approvals, the once-only ledger),
 * its record (state/records/<agent>.json, whose sequence numbers a record rebuilt from Guard's list of recent decisions could not repeat) and its key. In this order, so
 * nothing is stopped until everything has been checked:
 *   1. fetch, open and check the snapshot while the agent's Guards run (restore-snapshot.ts, runAgentRestoreJob): every file against the manifest, the record, each Guard
 *      folder's tenant;
 *   2. try each Guard's backup with the Guard image the agent is pinned to: Guard's own `restore` into a scratch folder, in that Guard's container definition. An image that
 *      cannot open the store or verify its ledger is refused here, with nothing touched: Guard's restore moves the live store aside before it opens the copy, so a failure
 *      half-way through a real one would leave a Guard that does not start;
 *   3. stop only the agent's Guards, restore each store (the files it replaces are kept beside, `.before-restore-<ms>`), put the record and the key back, the record with a
 *      `restored` entry, as a shop's runtime writes one;
 *   4. start the Guards and bring back what a snapshot cannot hold: the kill switch as this server has it now, the relay's reading credential (renewed every day, so the
 *      snapshot's is out of date), and the policy deployed now (a Guard keeps the policy in its store when the deployed one is not of a higher version: the agent is then
 *      deployed again above it).
 * The Guards' stores go back too, unlike a shop's, because the record is read from them: a record put back alone would be read against Guards that remember more.
 */
export async function restoreAgent(ctx: Context, agent: string, o: { at?: string; identity?: string; fromSnapshot?: string }): Promise<string> {
  const server = loadServer(ctx.dir);
  const state = loadState(ctx.dir);
  const a = state.agents?.[agent];
  if (!a?.applied) throw new Error(`${agent} has not been deployed, so there is nothing to restore into.`);
  if (o.fromSnapshot) throw new Error("--from-snapshot is gone: `restore` reads the nightly snapshots itself. Give --identity <the owner's key file>, and --at <time> for an older one.");
  if (!server.backup) throw new Error("No snapshot place is set up for this server, so there is nothing to restore from.");
  if (o.at && Number.isNaN(Date.parse(o.at))) throw new Error(`"${o.at}" is not a time. Use a form like 2026-11-04T10:30:00Z.`);
  if (!o.identity) throw new Error("A snapshot opens only with the owner's age key, which is kept off this server: bring it for the restore and give its file with --identity <key file> (take it away again afterwards).");
  if (!existsSync(o.identity)) throw new Error(`${o.identity} is not there: --identity names the file with the owner's age key (AGE-SECRET-KEY-1...).`);
  const untouched = `No snapshot was restored; ${agent} was not touched and its Guards still run.`;
  const guards = Object.values(a.applied.guards);
  const stamp = stampOf(ctx.now());
  const work = join(serverPaths(ctx.dir).state, "work", `restore-${agent}-${stamp}`);
  const lines: string[] = [];
  let got: { stamp: string; record: RecordFacts | null; guards: string[] };
  let restored: string[] = [];
  try {
    mkdirSync(join(work, "files"), { recursive: true }); chmodSync(join(work, "files"), 0o777); // the container writes here; the deployer removes it after
    writeFileSync(join(work, "job.json"), JSON.stringify({ target: server.backup.snapshots, shop: agent, ownAgent: true, ...(o.at ? { atMs: Date.parse(o.at) } : {}), identityFile: "/run/secrets/identity", out: "/out/files", nowIso: ctx.now().toISOString() }), { mode: 0o644 });
    // 1. fetch, check and open the snapshot while the agent's Guards still run
    const place = snapshotPlace(ctx, server);
    const r = await ctx.runner.run(ctx.docker, [...jobFlags(ctx, server, place.network), "-v", `${work}:/out`, "-v", `${o.identity}:/run/secrets/identity:ro`, ...place.mounts, server.appImage, "node", "/app/bundle/backup/restore-snapshot.ts", "--job", "/out/job.json"], { timeoutMs: 900_000 });
    const out = lastJson(r.stdout) as { ok?: boolean; stamp?: string; record?: RecordFacts | null; guards?: string[]; error?: string } | undefined;
    if (!out?.ok || !out.stamp || !out.guards) throw new Error(`${untouched} ${out?.error ?? (r.stderr.trim().split("\n").slice(-2).join(" | ").slice(0, 300) || `exit ${r.code}`)}`);
    got = { stamp: out.stamp, record: out.record ?? null, guards: out.guards };
    const keyFile = join(work, "files", PERSON_KEY_OBJECT);
    const snapshotKey = existsSync(keyFile) ? readFileSync(keyFile, "utf8").trim() : undefined;
    if (snapshotKey !== undefined && !PERSON_KEY.test(snapshotKey)) throw new Error(`${untouched} The fingerprint key in this snapshot is not a key.`);
    const back = guards.filter((g) => got.guards.includes(g.kind));
    for (const g of guards.filter((x) => !got.guards.includes(x.kind))) lines.push(`The snapshot holds no backup of the ${g.kind} Guard (its own backup was not made that night), so ${g.service} keeps the store it has.`);
    // 2. each Guard's backup, tried with the pinned Guard image into a scratch folder, while everything still runs
    for (const g of back) {
      const trial = join(work, `trial-${g.kind}`);
      mkdirSync(join(trial, "scratch"), { recursive: true }); chmodSync(trial, 0o777); chmodSync(join(trial, "scratch"), 0o777);
      writeFileSync(join(trial, "guard.toml"), trialToml(readFileSync(join(serverPaths(ctx.dir).generated, "guards", g.service, "guard.toml"), "utf8")), { mode: 0o644 });
      const t = await guardCommand(ctx, g.service, join(work, "files", `guard-${g.kind}`), ["-v", `${trial}:${TRIAL}`], ["restore", "--config", `${TRIAL}/guard.toml`, "--from", "/in"]);
      if (t.code !== 0) throw new Error(`${untouched} The ${g.kind} Guard's backup could not be restored by the Guard image ${agent} runs (${server.guardImage}): ${(t.stderr.trim() || t.stdout.trim()).split("\n").slice(-2).join(" | ").slice(0, 300) || `exit ${t.code}`}. Move the server to a Guard image that can (guardImage in geometer.json, then deploy), and restore again.`);
    }
    // 3. only now: the agent's Guards stop (nothing else does), each store goes back, then the record and the key
    if (back.length > 0) await compose(ctx, ["stop", ...back.map((g) => g.service)]);
    try {
      for (const g of back) {
        const x = await guardCommand(ctx, g.service, join(work, "files", `guard-${g.kind}`), [], ["restore", "--config", "/etc/geo-guard/guard.toml", "--from", "/in"]);
        if (x.code !== 0) throw new Error(`The ${g.kind} Guard's store could not be put back (${(x.stderr.trim() || x.stdout.trim()).split("\n").slice(-2).join(" | ").slice(0, 300) || `exit ${x.code}`}). ${restored.length > 0 ? `Already put back: ${restored.join(", ")} (each keeps the files it replaced beside it, .before-restore-*).` : "No Guard's store was changed."} The record and the key were not touched. The Guards are started again.`);
        restored.push(g.service);
      }
    } finally { if (back.length > 0) await compose(ctx, ["start", ...back.map((g) => g.service)]); }
    lines.push(recordPutBack(ctx, agent, join(work, "files", AGENT_RECORD_FILE), got, stamp));
    lines.push(agentKeyPutBack(ctx.dir, agent, snapshotKey, stamp));
  } finally { rmSync(work, { recursive: true, force: true }); }
  // 4. what the snapshot cannot hold: the kill switch, the relay's credential, and the policy deployed now
  const statuses = new Map<string, { status: number; body: any }>();
  for (const g of guards.filter((x) => restored.includes(x.service))) statuses.set(g.kind, await guardStatus(ctx, g.service));
  const fresh = loadState(ctx.dir).agents![agent];
  if (fresh.stopped) await ops(ctx, ["stop", agent, "on", "-", fresh.stopped.reason]);
  else if ([...statuses.values()].some((s) => s.body?.kill_switch?.on === true)) { await ops(ctx, ["stop", agent, "off", "the deployer", "restore: the snapshot was taken while the agent was stopped; it is not stopped now"]); lines.push("The snapshot was taken while the agent was stopped; it is not stopped now, so its Guards' kill switch was released again."); }
  // the approvals relay serves an agent with a Razorpay Guard (agent/deploy.ts renews it on the same condition)
  if (guards.some((g) => g.kind === "razorpay" && restored.includes(g.service))) await renewRelayCredential(ctx, agent);
  const behind = [...statuses.entries()].filter(([kind, s]) => s.body?.policy?.digest !== fresh.guards[kind]?.digest);
  if (behind.length > 0) {
    // the restored store holds a policy of the same or a higher version than the deployed one (a server whose versions started again at 1): deploy above it
    for (const [kind, s] of behind) fresh.guards[kind] = { ...fresh.guards[kind], version: Math.max(fresh.guards[kind].version, Number(s.body?.policy?.version ?? 0)), contentHash: "restored" };
    const st = loadState(ctx.dir); st.agents![agent] = fresh; saveState(ctx.dir, st);
    const d = await deployAgent(ctx, agent);
    lines.push(`The ${behind.map(([k]) => k).join(" and ")} Guard kept the policy in its restored store, so ${agent} was deployed again over it: ${d.proven.line}.`);
  }
  const was = `${restored.length > 0 ? `its ${restored.map((s) => s.replace(`g-${agent}-`, "")).join(", ")} Guards' stores (every decision, approval and once-only entry up to then; the files they replaced are kept beside them, .before-restore-*), ` : ""}its record (up to entry #${got!.record?.lastSeq ?? 0}) and its key`;
  return [`${agent} is restored from the snapshot of ${got!.stamp}: ${was}.`,
    "What happened after the snapshot is in none of them: calls the agent made after it are not in the Guards or the record (Razorpay, the calendar and WhatsApp keep their own); a refund made after it is not known to Guard as made; approvals the owner gave after it are pending again, and holds made after it are gone.",
    ...lines.filter(Boolean)].join(" ");
}

/** The record from the snapshot put in place, with a `restored` entry after its last one. The file it replaces is kept beside it. Says what that means for numbers already handed out. */
function recordPutBack(ctx: Context, agent: string, from: string, got: { stamp: string; record: RecordFacts | null }, stamp: string): string {
  const path = recordFile(ctx.dir, agent);
  const before = loadRecord(ctx.dir, agent);
  const record = existsSync(from) ? (JSON.parse(readFileSync(from, "utf8")) as ReturnType<typeof loadRecord>) : { schema: 1 as const, entries: [], seen: {} };
  if (existsSync(path)) renameSync(path, `${path}.before-restore-${stamp}`);
  // the gap on the record, as a shop's runtime writes it after a restore (modules/runtime/restored.ts): an append like any other, never a rewrite
  const refs = { snapshot: got.stamp, restoredAt: ctx.now().toISOString(), idGap: "0" };
  const labelKey = parseKey(ensureAgentLabelKey(ctx.dir, agent), "The agent's label key");
  const entry: RecordEntry = { seq: record.entries.length + 1, time: refs.restoredAt, conversation: "agent", booking: null, action: "restored" as RecordEntry["action"], inputsDigest: keyedDigest(labelKey, canonicalJson(refs)), outcome: "confirmed", decisions: [], language: readAgent(ctx.dir, agent).settings?.languages[0] ?? "en", refs,
    notes: `This agent's Guards and record were put back from the nightly snapshot of ${got.stamp}, which ends at entry ${record.entries.length}. What the agent did after that snapshot is not in this record; Razorpay, the calendar and WhatsApp keep their own.` };
  record.entries.push(entry);
  ensureDir(join(serverPaths(ctx.dir).state, "records"));
  writeAtomic(path, `${JSON.stringify(record)}\n`, 0o600);
  return before.entries.length > record.entries.length - 1
    ? `The record had ${before.entries.length} entries; the next ones are numbered from #${record.entries.length + 1} again, so record files and reports already handed out carry other entries under those numbers (the old record is kept beside it, ${recordFile(ctx.dir, agent).split("/").at(-1)}.before-restore-${stamp}).`
    : "";
}

/** The agent's key from the snapshot put back, and its label key made again from it. It never throws: the Guards are already restored and running. */
function agentKeyPutBack(dir: string, agent: string, key: string | undefined, stamp: string): string {
  if (key === undefined) return "This snapshot holds no key for the agent, so it keeps the one it has.";
  try {
    const kept = restoreAgentKey(dir, agent, key, stamp);
    return kept ? `The agent's key was put back from the snapshot (its label key made again from it); the one it replaced is kept as ${kept}.` : "";
  } catch (e) { return `The agent's key could NOT be put back (${(e as Error).message}): open the snapshot with restore-snapshot.ts and put its person_key at secrets/person-keys/${agent}, mode 0600.`; }
}
