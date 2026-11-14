// The nightly snapshot, as it runs INSIDE a short-lived container started by the deployer (it has the volumes mounted, and the snapshot bucket's key).
// For each shop it makes a consistent copy of the runtime's SQLite file (VACUUM INTO on a read-only connection: SQLite's own copy, consistent while the runtime
// writes) and checks it (integrity_check), takes the Guards' own backups from where Guard wrote them (POST /admin/backup, run just before), and writes ONE object per
// database file: the runtime's copy, and each Guard's backup folder as one tar. Every object is gzipped (node:zlib) and then age-encrypted to the owner's public key;
// the secret half is kept OFF the server, so nothing on the server can open a snapshot. The plain text never leaves this container's memory and temp folder.
//
//   <shop>/<stamp>/runtime/agent.db.gz.age     the runtime's database
//   <shop>/<stamp>/runtime/owner-keep.json.gz.age   the owner's passkeys (public keys) and alert subscriptions, from the two small files beside agent.db (owner-keep.ts); only when the
//                                              owner has set up either, so a shop without them makes no extra object
//   <shop>/<stamp>/guard-<kind>.tar.gz.age     one Guard's backup folder (its store, its evidence ledger, anchor and pack), as one tar
//   <shop>/<stamp>/manifest.json.gz.age        every file's size and sha256 (before compression), the record's length and last entry, and the shop's fingerprint key (B69)
//
// An agent someone else wrote (B51) has no runtime database: its record is the deployer's own file (state/records/<agent>.json, mounted read-only), checked the way the
// runtime's copy is (it must parse as a record, and is chained into its ledger) and written as one object in place of the runtime's. Its Guards and its key go in as a shop's do.
//
//   <agent>/<stamp>/record.json.gz.age         the agent's record (state/records/<agent>.json, the whole file: its entries, what it has seen, and its marks)
//   <agent>/<stamp>/desk.json.gz.age           an agent on the owner-marked desk (UPI, B71 part 2): the desk's ledger (desk.json in the relay's volume: the open requests,
//                                              the owner's marks and live codes, the refunds owed, its id counter), mounted read-only. Without it a lost volume would start
//                                              the desk's ids again, and the record, which keys the owner's marks by id, would take a new mark for one it already wrote.
//
// What it hands back besides, in the clear, is the snapshot's SEAL: each object's key, size and sha256 as uploaded, what the copy's record was (its length, last
// entry's digest and the head of its hash chain), and a one-way id of the fingerprint key the manifest holds. No customer's words or numbers are in it, and the id
// opens nothing. The weekly drill checks a snapshot with it, without the key (drill-check.ts).
//
// Old snapshots are deleted by the bucket's own lifecycle rule. Deleting them from here is only a fallback: a key that may not list or delete (a create-only one) is
// said beside the night's result ("pruning left to the bucket's lifecycle rule"), never a failed night.
//
// What one night costs in bucket operations, per shop or agent, whatever it holds (bundle/test/backup-cost.test.ts): one PUT per database file (the runtime or the agent's record, and each Guard)
// and one for the manifest; one LIST of the shop's folder (one page per 1,000 objects); and, when the key may delete and the keep period is full, one DELETE per object
// of the night that ages out. A Guard's evidence ledger grows by a file every 500 decisions, which is why its folder goes up as ONE tar.
// Snapshots written before 9 Nov 2026 have one plain `.age` object per file, not gzipped; restore-snapshot.ts opens both kinds, told apart by the name.
//
//   node bundle/backup/snapshot.ts /job/job.json
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join, relative } from "node:path";
import { gzipSync } from "node:zlib";
import { encrypt } from "./age.ts";
import { folderStore, s3Store } from "./store.ts";
import type { ObjectStore } from "./store.ts";
import { toTarGz } from "../export/tar.ts";
import { ledgerEntries } from "../../modules/record/ledger.ts";
import { canonicalJson } from "../../modules/record/record.ts";
import type { RecordEntry } from "../../modules/record/record.ts";
import { keyIdOf } from "../lib/secrets.ts";
import { OWNER_KEEP_FILE, OWNER_KEEP_OBJECT, readOwnerKeep } from "./owner-keep.ts";

export interface SnapshotJob {
  stamp: string;
  keepDays: number;
  /** The owner's public key (geometer.json). Its secret half is not on the server. */
  recipient: string;
  target: { url: string; endpoint?: string; region?: string };
  /** `personKeyFile`: the shop's fingerprint key (B69), mounted read-only, so it travels in the manifest (encrypted to the age recipient). Left out: the manifest has no key. */
  shops: { name: string; runtimeDb: string; personKeyFile?: string; guards: { kind: string; dir: string }[] }[];
  /** Agents someone else wrote (B51): `recordFile` is the deployer's record of the agent (state/records/<agent>.json), mounted read-only. Left out: a job from before them. */
  agents?: { name: string; recordFile: string; personKeyFile?: string; /** The desk's ledger in the relay's volume, for an agent on the owner-marked desk (item 7's gap, 11 Nov); left out for one with none. */ deskFile?: string; guards: { kind: string; dir: string }[] }[];
}

export interface RecordFacts { records: number; lastSeq: number | null; lastEntryDigest: string | null }
/** What the drill checks a snapshot by, without opening it: the objects as uploaded, and the copy's record (checked with integrity_check when it was made). */
export interface Seal { stamp: string; objects: { key: string; bytes: number; sha256: string }[]; record: (RecordFacts & { head: string | null }) | null; /** A one-way id of the fingerprint key in the manifest (lib/secrets.ts, keyIdOf): the drill compares it with the live key's without seeing either key. Absent: the manifest holds no key. */ keyId?: string }
export interface ShopSnapshot { name: string; ok: boolean; stamp: string; files: number; bytes: number; record?: RecordFacts; seal?: Seal; error?: string; /** Old snapshots were not deleted from here: the bucket's lifecycle rule does it. */ pruneError?: string }
/** One file of a snapshot, as it was before compression and encryption. `path` is relative to the snapshot's folder (runtime/agent.db, guard-razorpay/state.db). */
export interface ManifestFile { path: string; bytes: number; sha256: string }
export interface Manifest {
  format: 2; shop: string; stamp: string; files: ManifestFile[]; objects: { key: string; bytes: number }[]; runtime: RecordFacts | null;
  /** The shop's fingerprint key (B69), so a restored shop can match its own people. The manifest is encrypted to the owner. */ personKey?: string;
  /** An agent someone else wrote (B51): `runtime` is then null and its record's facts are here. */ ownAgent?: { record: RecordFacts | null };
}

export const RUNTIME_OBJECT = "runtime/agent.db.gz.age";
export const MANIFEST_OBJECT = "manifest.json.gz.age";
/** An agent's record in its snapshot, and the file it opens to. */
export const AGENT_RECORD_OBJECT = "record.json.gz.age";
export const AGENT_RECORD_FILE = "record.json";
/** The owner-marked desk's ledger of an agent someone else wrote, in its snapshot (the relay's desk.json, byte for byte). */
export const AGENT_DESK_OBJECT = "desk.json.gz.age";
export const AGENT_DESK_FILE = "desk.json";
/** What the fingerprint key is called when a restore takes it out of the manifest. */
export const PERSON_KEY_OBJECT = "person_key";

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

/**
 * An agent's record file (agent/records.ts: `{ schema: 1, entries, seen, marks }`) as the snapshot and the drill read it: its facts are computed the same way on both sides,
 * so they compare. The last entry's digest is of its canonical JSON (keys sorted), so the file's spacing cannot change it. Throws if the file is not such a record: the
 * snapshot of it is then refused, as a runtime copy that fails its integrity check is. A record that will not chain gets a null head, and the drill says so.
 */
export function agentRecordOf(text: string, agent: string): { entries: RecordEntry[]; facts: RecordFacts; head: string | null } {
  let parsed: { schema?: unknown; entries?: unknown };
  try { parsed = JSON.parse(text) as typeof parsed; } catch { throw new Error("the agent's record is not JSON"); }
  if (parsed.schema !== 1 || !Array.isArray(parsed.entries)) throw new Error("the agent's record is not one this bundle can read (schema 1, with its entries)");
  const entries = parsed.entries as RecordEntry[];
  const last = entries.at(-1);
  let head: string | null = null;
  try { head = ledgerEntries(entries, agent).at(-1)?.hash ?? null; } catch { head = null; }
  return { entries, facts: { records: entries.length, lastSeq: last ? Number(last.seq) : null, lastEntryDigest: last ? sha256(canonicalJson(last)) : null }, head };
}

const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);

// Takes one shop's nightly snapshot: a consistent copy of its database, encrypted to the owner's public key and uploaded, with a seal the drill later checks. The live files are only read.
export async function snapshotShop(shop: SnapshotJob["shops"][number], job: SnapshotJob, store: ObjectStore, scratch: string): Promise<ShopSnapshot> {
  const objects: { name: string; plain: Buffer }[] = [];
  const files: ManifestFile[] = [];
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
    files.push({ path: "runtime/agent.db", bytes: data.length, sha256: sha256(data) });
    objects.push({ name: RUNTIME_OBJECT, plain: gzipSync(data) });
    // the owner's passkeys and alert subscriptions live in files of their own beside agent.db: without them a restore signs the owner out and turns their alerts off
    const keep = readOwnerKeep(dirname(shop.runtimeDb));
    if (keep) {
      const text = Buffer.from(JSON.stringify(keep));
      files.push({ path: OWNER_KEEP_FILE, bytes: text.length, sha256: sha256(text) });
      objects.push({ name: OWNER_KEEP_OBJECT, plain: gzipSync(text) });
    }
  }
  return sealAndPut(shop, job, store, { objects, files, record, empty: "there was nothing to copy (no record yet, and no Guard backup)" });
}

/**
 * An agent someone else wrote: its record file in place of the runtime's database, then its Guards and its key as a shop's. The file is read once (the deployer replaces it
 * whole, by a rename, so one read sees one version), checked, and written as it was: a restored file is byte for byte the one the deployer had.
 */
export async function snapshotAgent(agent: NonNullable<SnapshotJob["agents"]>[number], job: SnapshotJob, store: ObjectStore): Promise<ShopSnapshot> {
  const objects: { name: string; plain: Buffer }[] = [];
  const files: ManifestFile[] = [];
  let record: (RecordFacts & { head: string | null }) | undefined;
  if (existsSync(agent.recordFile)) {
    const data = readFileSync(agent.recordFile);
    const read = agentRecordOf(data.toString("utf8"), agent.name);
    record = { ...read.facts, head: read.head };
    files.push({ path: AGENT_RECORD_FILE, bytes: data.length, sha256: sha256(data) });
    objects.push({ name: AGENT_RECORD_OBJECT, plain: gzipSync(data) });
  }
  // the desk's ledger: written whole by a rename (services/desk.ts), so one read sees one version; taken as it is, and checked when it is put back (restore-snapshot.ts)
  if (agent.deskFile && existsSync(agent.deskFile)) {
    const data = readFileSync(agent.deskFile);
    files.push({ path: AGENT_DESK_FILE, bytes: data.length, sha256: sha256(data) });
    objects.push({ name: AGENT_DESK_OBJECT, plain: gzipSync(data) });
  }
  return sealAndPut(agent, job, store, { objects, files, record, ownAgent: true, empty: "there was nothing to copy (no record of the agent yet, and no Guard backup)" });
}

/**
 * What a shop and an agent share: each Guard's backup folder as one tar, the manifest with the fingerprint key, everything encrypted and put, the Guards' backup folders
 * removed, and the fallback pruning. One path for both, so a night costs the same constant for each (bundle/test/backup-cost.test.ts).
 */
async function sealAndPut(who: { name: string; personKeyFile?: string; guards: { kind: string; dir: string }[] }, job: SnapshotJob, store: ObjectStore,
  main: { objects: { name: string; plain: Buffer }[]; files: ManifestFile[]; record: (RecordFacts & { head: string | null }) | undefined; ownAgent?: boolean; empty: string }): Promise<ShopSnapshot> {
  const { objects, files, record } = main;
  for (const g of who.guards) {
    if (!existsSync(g.dir)) continue;
    const inside = new Map(walk(g.dir).map((f) => relative(g.dir, f)).sort().map((rel): [string, Buffer] => [rel, readFileSync(join(g.dir, rel))]));
    if (inside.size === 0) continue;
    for (const [rel, data] of inside) files.push({ path: `guard-${g.kind}/${rel}`, bytes: data.length, sha256: sha256(data) });
    objects.push({ name: `guard-${g.kind}.tar.gz.age`, plain: toTarGz(inside, stampMs(job.stamp)) });
  }
  if (objects.length === 0) return { name: who.name, ok: false, stamp: job.stamp, files: 0, bytes: 0, error: main.empty };
  const folder = `${who.name}/${job.stamp}/`;
  const sealed = objects.map((o) => ({ key: folder + o.name, data: encrypt(o.plain, job.recipient) }));
  const facts = record ? { records: record.records, lastSeq: record.lastSeq, lastEntryDigest: record.lastEntryDigest } : null;
  // B69: the fingerprint key rides in the manifest: encrypted to the owner like everything here, no extra object, and `restore` reads the manifest anyway
  const personKey = who.personKeyFile && existsSync(who.personKeyFile) ? readFileSync(who.personKeyFile, "utf8").trim() : undefined;
  const manifest: Manifest = { format: 2, shop: who.name, stamp: job.stamp, files, objects: sealed.map((o) => ({ key: o.key, bytes: o.data.length })), runtime: main.ownAgent ? null : facts, ...(personKey ? { personKey } : {}), ...(main.ownAgent ? { ownAgent: { record: facts } } : {}) };
  sealed.push({ key: folder + MANIFEST_OBJECT, data: encrypt(gzipSync(Buffer.from(JSON.stringify(manifest, null, 2))), job.recipient) });
  let bytes = 0;
  for (const o of sealed) { await store.put(o.key, o.data); bytes += o.data.length; }
  for (const g of who.guards) rmSync(g.dir, { recursive: true, force: true });
  // the key's id, never the key: the seal is kept in the clear on the server, and the drill must say "the manifest holds this server's key" without opening anything
  const keyId = personKey ? keyIdOf(personKey) : undefined;
  const seal: Seal = { stamp: job.stamp, objects: sealed.map((o) => ({ key: o.key, bytes: o.data.length, sha256: sha256(o.data) })), record: record ?? null, ...(keyId ? { keyId } : {}) };
  // the fallback for a bucket with no lifecycle rule: keep `keepDays` days (the stamp is in the key, so the age never depends on a clock inside the bucket)
  const cutoff = stampMs(job.stamp) - job.keepDays * 86_400_000;
  let pruneError: string | undefined;
  try {
    for (const o of await store.list(`${who.name}/`)) {
      const stamp = stampOf(o.key);
      if (stamp && stampMs(stamp) < cutoff) await store.delete(o.key);
    }
  } catch (e) { pruneError = (e as Error).message; }
  return { name: who.name, ok: true, stamp: job.stamp, files: sealed.length, bytes, ...(facts ? { record: facts } : {}), seal, ...(pruneError ? { pruneError } : {}) };
}

// Chooses the place snapshots go from the configured URL: a bucket (needs the key file) or a folder on this machine. Fails early with a plain message when the key is missing.
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
  for (const agent of job.agents ?? []) {
    try { results.push(await snapshotAgent(agent, job, store)); } catch (e) { results.push({ name: agent.name, ok: false, stamp: job.stamp, files: 0, bytes: 0, error: (e as Error).message }); }
  }
  console.log(JSON.stringify({ stamp: job.stamp, results }));
}
