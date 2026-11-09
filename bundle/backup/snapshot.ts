// The nightly snapshot, as it runs INSIDE a short-lived container started by the deployer (it has the volumes mounted, and the snapshot bucket's key).
// For each shop it makes a consistent copy of the runtime's SQLite file (VACUUM INTO on a read-only connection: SQLite's own copy, consistent while the runtime
// writes) and checks it (integrity_check), takes the Guards' own backups from where Guard wrote them (POST /admin/backup, run just before), and writes ONE object per
// database file: the runtime's copy, and each Guard's backup folder as one tar. Every object is gzipped (node:zlib) and then age-encrypted to the owner's public key;
// the secret half is kept OFF the server, so nothing on the server can open a snapshot. The plain text never leaves this container's memory and temp folder.
//
//   <shop>/<stamp>/runtime/agent.db.gz.age     the runtime's database
//   <shop>/<stamp>/guard-<kind>.tar.gz.age     one Guard's backup folder (its store, its evidence ledger, anchor and pack), as one tar
//   <shop>/<stamp>/manifest.json.gz.age        every file's size and sha256 (before compression), and the record's length and last entry
//
// What it hands back besides, in the clear, is the snapshot's SEAL: each object's key, size and sha256 as uploaded, and what the copy's record was (its length, last
// entry's digest and the head of its hash chain). No customer's words or numbers are in it. The weekly drill checks a snapshot with it, without the key (drill-check.ts).
//
// Old snapshots are deleted by the bucket's own lifecycle rule. Deleting them from here is only a fallback: a key that may not list or delete (a create-only one) is
// said beside the night's result ("pruning left to the bucket's lifecycle rule"), never a failed night.
//
// What one night costs in bucket operations, per shop, whatever the shop holds (bundle/test/backup-cost.test.ts): one PUT per database file (the runtime and each Guard)
// and one for the manifest; one LIST of the shop's folder (one page per 1,000 objects); and, when the key may delete and the keep period is full, one DELETE per object
// of the night that ages out. A Guard's evidence ledger grows by a file every 500 decisions, which is why its folder goes up as ONE tar.
// Snapshots written before 9 Nov 2026 have one plain `.age` object per file, not gzipped; restore-snapshot.ts opens both kinds, told apart by the name.
//
//   node bundle/backup/snapshot.ts /job/job.json
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join, relative } from "node:path";
import { gzipSync } from "node:zlib";
import { encrypt } from "./age.ts";
import { folderStore, s3Store } from "./store.ts";
import type { ObjectStore } from "./store.ts";
import { toTarGz } from "../export/tar.ts";
import { ledgerEntries } from "../../modules/record/ledger.ts";
import type { RecordEntry } from "../../modules/record/record.ts";

export interface SnapshotJob {
  stamp: string;
  keepDays: number;
  /** The owner's public key (geometer.json). Its secret half is not on the server. */
  recipient: string;
  target: { url: string; endpoint?: string; region?: string };
  shops: { name: string; runtimeDb: string; guards: { kind: string; dir: string }[] }[];
}

export interface RecordFacts { records: number; lastSeq: number | null; lastEntryDigest: string | null }
/** What the drill checks a snapshot by, without opening it: the objects as uploaded, and the copy's record (checked with integrity_check when it was made). */
export interface Seal { stamp: string; objects: { key: string; bytes: number; sha256: string }[]; record: (RecordFacts & { head: string | null }) | null }
export interface ShopSnapshot { name: string; ok: boolean; stamp: string; files: number; bytes: number; record?: RecordFacts; seal?: Seal; error?: string; /** Old snapshots were not deleted from here: the bucket's lifecycle rule does it. */ pruneError?: string }
/** One file of a snapshot, as it was before compression and encryption. `path` is relative to the snapshot's folder (runtime/agent.db, guard-razorpay/state.db). */
export interface ManifestFile { path: string; bytes: number; sha256: string }
export interface Manifest { format: 2; shop: string; stamp: string; files: ManifestFile[]; objects: { key: string; bytes: number }[]; runtime: RecordFacts | null }

export const RUNTIME_OBJECT = "runtime/agent.db.gz.age";
export const MANIFEST_OBJECT = "manifest.json.gz.age";

const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
/** A stamp (20261104T013000Z) as a time. */
export const stampMs = (stamp: string): number => Date.parse(stamp.replace(/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/u, "$1-$2-$3T$4:$5:$6Z"));
/** The stamp of an object key (<shop>/<stamp>/...), if it has one. */
export const stampOf = (key: string): string | undefined => /^[^/]+\/(\d{8}T\d{6}Z)\//u.exec(key)?.[1];

/** How many entries the record has, the last one's sequence number and a digest of its text: what two copies of a record are compared by. */
export function recordFacts(db: DatabaseSync): RecordFacts {
  const n = (db.prepare("SELECT count(*) AS n, max(seq) AS last FROM record").get() as { n: number; last: number | null });
  const row = n.last === null ? undefined : db.prepare("SELECT entry FROM record WHERE seq = ?").get(n.last) as { entry: string } | undefined;
  return { records: Number(n.n), lastSeq: n.last === null ? null : Number(n.last), lastEntryDigest: row ? sha256(row.entry) : null };
}

/** The record chained into its ledger (modules/record/ledger.ts, B28), as the daily fingerprint chains it. Throws if an entry cannot be chained. */
export function chainOf(db: DatabaseSync, tenant: string): ReturnType<typeof ledgerEntries> {
  const rows = db.prepare("SELECT entry FROM record ORDER BY seq").all() as { entry: string }[];
  return ledgerEntries(rows.map((r) => JSON.parse(r.entry) as RecordEntry), tenant);
}

const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);

export async function snapshotShop(shop: SnapshotJob["shops"][number], job: SnapshotJob, store: ObjectStore, scratch: string): Promise<ShopSnapshot> {
  const objects: { name: string; plain: Buffer }[] = [];
  const files: ManifestFile[] = [];
  const note = (path: string, data: Buffer) => files.push({ path, bytes: data.length, sha256: sha256(data) });
  let record: (RecordFacts & { head: string | null }) | undefined;
  if (existsSync(shop.runtimeDb)) {
    // a read-only connection and VACUUM INTO: a consistent copy while the runtime goes on writing, and nothing done to the live file
    mkdirSync(scratch, { recursive: true });
    const copy = join(scratch, `${shop.name}.db`);
    rmSync(copy, { force: true });
    const live = new DatabaseSync(shop.runtimeDb, { readOnly: true });
    try { live.exec("PRAGMA busy_timeout = 5000"); live.exec(`VACUUM INTO '${copy.replace(/'/gu, "''")}'`); } finally { live.close(); }
    const made = new DatabaseSync(copy, { readOnly: true });
    try {
      const check = (made.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check;
      if (check !== "ok") throw new Error(`the copy of the record failed its integrity check (${check})`);
      let head: string | null = null;
      try { head = chainOf(made, shop.name).at(-1)?.hash ?? null; } catch { head = null; } // the drill then says the record could not be chained
      record = { ...recordFacts(made), head };
    } finally { made.close(); }
    const data = readFileSync(copy);
    rmSync(copy, { force: true });
    note("runtime/agent.db", data);
    objects.push({ name: RUNTIME_OBJECT, plain: gzipSync(data) });
  }
  for (const g of shop.guards) {
    if (!existsSync(g.dir)) continue;
    const inside = new Map(walk(g.dir).map((f) => relative(g.dir, f)).sort().map((rel): [string, Buffer] => [rel, readFileSync(join(g.dir, rel))]));
    if (inside.size === 0) continue;
    for (const [rel, data] of inside) note(`guard-${g.kind}/${rel}`, data);
    objects.push({ name: `guard-${g.kind}.tar.gz.age`, plain: toTarGz(inside, stampMs(job.stamp)) });
  }
  if (objects.length === 0) return { name: shop.name, ok: false, stamp: job.stamp, files: 0, bytes: 0, error: "there was nothing to copy (no record yet, and no Guard backup)" };
  const folder = `${shop.name}/${job.stamp}/`;
  const sealed = objects.map((o) => ({ key: folder + o.name, data: encrypt(o.plain, job.recipient) }));
  const facts = record ? { records: record.records, lastSeq: record.lastSeq, lastEntryDigest: record.lastEntryDigest } : null;
  const manifest: Manifest = { format: 2, shop: shop.name, stamp: job.stamp, files, objects: sealed.map((o) => ({ key: o.key, bytes: o.data.length })), runtime: facts };
  sealed.push({ key: folder + MANIFEST_OBJECT, data: encrypt(gzipSync(Buffer.from(JSON.stringify(manifest, null, 2))), job.recipient) });
  let bytes = 0;
  for (const o of sealed) { await store.put(o.key, o.data); bytes += o.data.length; }
  for (const g of shop.guards) rmSync(g.dir, { recursive: true, force: true });
  const seal: Seal = { stamp: job.stamp, objects: sealed.map((o) => ({ key: o.key, bytes: o.data.length, sha256: sha256(o.data) })), record: record ?? null };
  // the fallback for a bucket with no lifecycle rule: keep `keepDays` days (the stamp is in the key, so the age never depends on a clock inside the bucket)
  const cutoff = stampMs(job.stamp) - job.keepDays * 86_400_000;
  let pruneError: string | undefined;
  try {
    for (const o of await store.list(`${shop.name}/`)) {
      const stamp = stampOf(o.key);
      if (stamp && stampMs(stamp) < cutoff) await store.delete(o.key);
    }
  } catch (e) { pruneError = (e as Error).message; }
  return { name: shop.name, ok: true, stamp: job.stamp, files: sealed.length, bytes, ...(facts ? { record: facts } : {}), seal, ...(pruneError ? { pruneError } : {}) };
}

export function storeFor(target: SnapshotJob["target"], keyText: string | undefined): ObjectStore {
  if (!target.url.startsWith("s3://")) return folderStore(target.url);
  const [accessKeyId, ...secret] = (keyText ?? "").trim().split(":");
  if (!accessKeyId || secret.length === 0) throw new Error("the snapshot bucket's key is missing (backup-key snapshots <file>)");
  return s3Store({ url: target.url, endpoint: target.endpoint, region: target.region, accessKeyId, secretAccessKey: secret.join(":") });
}

/** The snapshot bucket's key, where the job containers have it mounted. */
export const mountedKey = (): string | undefined => (existsSync("/run/secrets/snapshots") ? readFileSync("/run/secrets/snapshots", "utf8") : undefined);

if (import.meta.main) {
  const job = JSON.parse(readFileSync(process.argv[2], "utf8")) as SnapshotJob;
  const store = storeFor(job.target, mountedKey());
  const results: ShopSnapshot[] = [];
  for (const shop of job.shops) {
    try { results.push(await snapshotShop(shop, job, store, "/tmp/snap")); } catch (e) { results.push({ name: shop.name, ok: false, stamp: job.stamp, files: 0, bytes: 0, error: (e as Error).message }); }
  }
  console.log(JSON.stringify({ stamp: job.stamp, results }));
}
