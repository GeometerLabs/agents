// The nightly snapshot, as it runs INSIDE a short-lived container started by the deployer (it has the volumes mounted, and the snapshot bucket's key).
// For each shop it makes a consistent copy of the runtime's SQLite file (VACUUM INTO, never touching the live file's checkpointing: Litestream owns that),
// takes the Guards' own backups from where Guard wrote them (POST /admin/backup, run just before), encrypts every file to the age recipient, uploads it, and
// deletes what is older than the keep period. The plain text never leaves this container's memory and temp folder.
//
//   node bundle/backup/snapshot.ts /job/job.json
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join, relative } from "node:path";
import { encrypt } from "./age.ts";
import { folderStore, s3Store } from "./store.ts";
import type { ObjectStore } from "./store.ts";

export interface SnapshotJob {
  stamp: string;
  keepDays: number;
  recipient: string;
  target: { url: string; endpoint?: string; region?: string };
  /** `personKeyFile`: the shop's fingerprint key (B69), mounted read-only, so it travels (encrypted to the age recipient) with the rest of the shop's backup. Left out by an older job: no key file is copied. */
  shops: { name: string; runtimeDb: string; personKeyFile?: string; guards: { kind: string; dir: string }[] }[];
}

export interface RecordFacts { records: number; lastSeq: number | null; lastEntryDigest: string | null }
export interface ShopSnapshot { name: string; ok: boolean; stamp: string; files: number; bytes: number; record?: RecordFacts; error?: string }

const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");

/** How many entries the record has, the last one's sequence number and a digest of its text: what two copies of a record are compared by. */
export function recordFacts(db: DatabaseSync): RecordFacts {
  const n = (db.prepare("SELECT count(*) AS n, max(seq) AS last FROM record").get() as { n: number; last: number | null });
  const row = n.last === null ? undefined : db.prepare("SELECT entry FROM record WHERE seq = ?").get(n.last) as { entry: string } | undefined;
  return { records: Number(n.n), lastSeq: n.last === null ? null : Number(n.last), lastEntryDigest: row ? sha256(row.entry) : null };
}

const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);

export async function snapshotShop(shop: SnapshotJob["shops"][number], job: SnapshotJob, store: ObjectStore, scratch: string): Promise<ShopSnapshot> {
  const files: { key: string; plain: Buffer }[] = [];
  let record: RecordFacts | undefined;
  if (existsSync(shop.runtimeDb)) {
    // a read-only connection and VACUUM INTO: a consistent copy, and no checkpoint of the live file (Litestream owns checkpointing)
    mkdirSync(scratch, { recursive: true });
    const copy = join(scratch, `${shop.name}.db`);
    rmSync(copy, { force: true });
    const live = new DatabaseSync(shop.runtimeDb, { readOnly: true });
    try { live.exec("PRAGMA busy_timeout = 5000"); live.exec(`VACUUM INTO '${copy.replace(/'/gu, "''")}'`); } finally { live.close(); }
    const made = new DatabaseSync(copy, { readOnly: true });
    try {
      const check = (made.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check;
      if (check !== "ok") throw new Error(`the copy of the record failed its integrity check (${check})`);
      record = recordFacts(made);
    } finally { made.close(); }
    files.push({ key: `${shop.name}/${job.stamp}/runtime/agent.db.age`, plain: readFileSync(copy) });
    rmSync(copy, { force: true });
  }
  if (shop.personKeyFile && existsSync(shop.personKeyFile)) files.push({ key: `${shop.name}/${job.stamp}/person_key.age`, plain: readFileSync(shop.personKeyFile) });
  for (const g of shop.guards) if (existsSync(g.dir)) for (const f of walk(g.dir)) files.push({ key: `${shop.name}/${job.stamp}/guard-${g.kind}/${relative(g.dir, f)}.age`, plain: readFileSync(f) });
  if (files.length === 0) return { name: shop.name, ok: false, stamp: job.stamp, files: 0, bytes: 0, error: "there was nothing to copy (no record yet, and no Guard backup)" };
  const manifest = Buffer.from(JSON.stringify({ shop: shop.name, stamp: job.stamp, files: files.map((f) => ({ key: f.key, bytes: f.plain.length, sha256: sha256(f.plain) })), runtime: record ?? null }, null, 2));
  let bytes = 0;
  for (const f of [...files, { key: `${shop.name}/${job.stamp}/manifest.json.age`, plain: manifest }]) { const sealed = encrypt(f.plain, job.recipient); await store.put(f.key, sealed); bytes += sealed.length; }
  for (const g of shop.guards) rmSync(g.dir, { recursive: true, force: true });
  // keep `keepDays` days: the stamp is in the key, so the age of a snapshot never depends on a clock inside the bucket
  const cutoff = Date.parse(job.stamp.replace(/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/u, "$1-$2-$3T$4:$5:$6Z")) - job.keepDays * 86_400_000;
  for (const o of await store.list(`${shop.name}/`)) {
    const stamp = /^[^/]+\/(\d{8}T\d{6}Z)\//u.exec(o.key)?.[1];
    if (stamp && Date.parse(stamp.replace(/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/u, "$1-$2-$3T$4:$5:$6Z")) < cutoff) await store.delete(o.key);
  }
  return { name: shop.name, ok: true, stamp: job.stamp, files: files.length + 1, bytes, ...(record ? { record } : {}) };
}

export function storeFor(job: SnapshotJob, keyText: string | undefined): ObjectStore {
  if (!job.target.url.startsWith("s3://")) return folderStore(job.target.url);
  const [accessKeyId, ...secret] = (keyText ?? "").trim().split(":");
  if (!accessKeyId || secret.length === 0) throw new Error("the snapshot bucket's key is missing (backup-key snapshots <file>)");
  return s3Store({ url: job.target.url, endpoint: job.target.endpoint, region: job.target.region, accessKeyId, secretAccessKey: secret.join(":") });
}

if (import.meta.main) {
  const job = JSON.parse(readFileSync(process.argv[2], "utf8")) as SnapshotJob;
  const store = storeFor(job, existsSync("/run/secrets/snapshots") ? readFileSync("/run/secrets/snapshots", "utf8") : undefined);
  const results: ShopSnapshot[] = [];
  for (const shop of job.shops) {
    try { results.push(await snapshotShop(shop, job, store, "/tmp/snap")); } catch (e) { results.push({ name: shop.name, ok: false, stamp: job.stamp, files: 0, bytes: 0, error: (e as Error).message }); }
  }
  console.log(JSON.stringify({ stamp: job.stamp, results }));
}
