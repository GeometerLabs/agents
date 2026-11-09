// Open a nightly snapshot, with the owner's key (the secret half is kept OFF the server: a person brings it). Two callers:
//   - a person, on their own machine, from one snapshot's folder as downloaded from the bucket: the full restore test, monthly (bundle/README.md, "Backups"):
//       node bundle/backup/restore-snapshot.ts <folder> --identity <key file> --out <empty folder>
//     The runtime's database comes out as `runtime/agent.db`, each Guard's backup as `guard-<kind>/...`, and every file is checked against `manifest.json` first.
//   - `geometer restore <shop> [--at TIME] --identity <key file>` on the server: the deployer runs this file in a short-lived container with a job file (`--job`) and
//     the key file mounted read-only; it fetches the newest snapshot at or before the time and writes the runtime's database and a `restored.json` note into a folder
//     the deployer then puts in place.
// Each object is opened by its name: `.tar.gz.age` is a folder (a Guard's backup), `.gz.age` one gzipped file, and a plain `.age` one file as snapshots before
// 9 Nov 2026 were written (not gzipped).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join, relative, resolve, sep } from "node:path";
import { gunzipSync } from "node:zlib";
import { decrypt } from "./age.ts";
import { fromTarGz } from "../export/tar.ts";
import { mountedKey, recordFacts, stampMs, stampOf, storeFor } from "./snapshot.ts";
import type { RecordFacts, SnapshotJob } from "./snapshot.ts";
import type { ObjectStore } from "./store.ts";
import { RESTORE_NOTE } from "../../modules/runtime/restored.ts";

const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));

/** One object of a snapshot, opened: its files by their path in the snapshot's folder. `name` is the object's name inside that folder (runtime/agent.db.gz.age). */
export function openObject(name: string, sealed: Uint8Array, identity: string): Map<string, Buffer> {
  const plain = decrypt(sealed, identity);
  if (name.endsWith(".tar.gz.age")) { const dir = name.slice(0, -".tar.gz.age".length); return new Map([...fromTarGz(plain)].map(([p, d]): [string, Buffer] => [`${dir}/${p}`, d])); }
  if (name.endsWith(".gz.age")) return new Map([[name.slice(0, -".gz.age".length), gunzipSync(plain)]]);
  if (name.endsWith(".age")) return new Map([[name.slice(0, -".age".length), plain]]);
  throw new Error(`${name} is not part of a snapshot (every object's name ends in .age)`);
}

/** The digest of each file, as the manifest wrote it: by `path` (from 9 Nov 2026), or by the object's `key` (before: <shop>/<stamp>/<path>.age). */
function digests(manifest: { files?: { path?: string; key?: string; sha256: string }[] }): Map<string, string> {
  return new Map((manifest.files ?? []).map((f) => [f.path ?? (f.key ?? "").replace(/^[^/]+\/[^/]+\//u, "").replace(/\.age$/u, ""), f.sha256]));
}
/** Every file that the manifest names must match its digest. */
function check(files: ReadonlyMap<string, Buffer>, manifest: { files?: { path?: string; key?: string; sha256: string }[] }): void {
  for (const [path, want] of digests(manifest)) {
    const got = files.get(path);
    if (got && sha256(got) !== want) throw new Error(`${path} is not the file the snapshot's manifest describes (its sha256 differs): the copy was damaged or changed`);
  }
}

/** A downloaded snapshot folder, opened into an empty folder. Returns the paths written. */
export function restoreSnapshot(from: string, identity: string, out: string): string[] {
  if (existsSync(out) && readdirSync(out).length > 0) throw new Error(`${out} is not empty: a restore goes into a new folder.`);
  const files = new Map<string, Buffer>();
  for (const file of walk(from).filter((f) => f.endsWith(".age"))) for (const [p, d] of openObject(relative(from, file).split(sep).join("/"), readFileSync(file), identity)) files.set(p, d);
  if (files.size === 0) throw new Error(`There are no .age files under ${from}.`);
  const manifest = files.get("manifest.json");
  if (manifest) check(files, JSON.parse(manifest.toString("utf8")));
  const written: string[] = [];
  for (const [p, d] of files) {
    const target = resolve(out, p);
    if (!target.startsWith(resolve(out) + sep)) throw new Error(`${p} would be written outside ${out}`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, d);
    written.push(target);
  }
  return written;
}

/** The snapshots in the bucket for a shop: stamp to its objects' keys. */
export async function snapshotsOf(store: ObjectStore, shop: string): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (const o of await store.list(`${shop}/`)) { const stamp = stampOf(o.key); if (stamp) out.set(stamp, [...(out.get(stamp) ?? []), o.key]); }
  return out;
}

export interface Fetched { stamp: string; db: Buffer; record: RecordFacts | null }

/**
 * The runtime's database from the newest whole snapshot of a shop (one whose manifest was written: it is written last), at or before `atMs` if given. Only the database
 * and the manifest are fetched: a LIST and two GETs. The database is checked against the manifest's digest.
 */
export async function fetchSnapshot(store: ObjectStore, shop: string, identity: string, atMs?: number): Promise<Fetched> {
  const all = await snapshotsOf(store, shop);
  const whole = [...all.entries()].filter(([stamp, keys]) => (atMs === undefined || stampMs(stamp) <= atMs) && keys.some((k) => /\/manifest\.json(\.gz)?\.age$/u.test(k))).sort(([a], [b]) => (a < b ? -1 : 1));
  if (whole.length === 0) throw new Error(atMs === undefined ? `there is no snapshot of ${shop} in the snapshot place yet` : `there is no snapshot of ${shop} from ${new Date(atMs).toISOString()} or before`);
  const [stamp, keys] = whole.at(-1)!;
  const folder = `${shop}/${stamp}/`;
  const runtimeKey = keys.find((k) => /\/runtime\/agent\.db(\.gz)?\.age$/u.test(k));
  if (!runtimeKey) throw new Error(`the snapshot of ${stamp} has no runtime database (the shop had no record yet that night)`);
  const files = new Map<string, Buffer>();
  for (const key of [keys.find((k) => /\/manifest\.json(\.gz)?\.age$/u.test(k))!, runtimeKey]) {
    const sealed = await store.get(key);
    if (!sealed) throw new Error(`${key} was listed but could not be read`);
    let opened: Map<string, Buffer>;
    try { opened = openObject(key.slice(folder.length), sealed, identity); } catch (e) {
      if (/cannot open/u.test((e as Error).message)) throw new Error(`the snapshot of ${stamp} cannot be opened with this key: it opens with the owner's age key whose public half is in geometer.json`);
      throw e;
    }
    for (const [p, d] of opened) files.set(p, d);
  }
  const manifest = JSON.parse(files.get("manifest.json")!.toString("utf8")) as { files?: { path?: string; key?: string; sha256: string }[]; runtime?: RecordFacts | null };
  check(files, manifest);
  if (!digests(manifest).has("runtime/agent.db")) throw new Error(`the snapshot of ${stamp}'s manifest does not describe its runtime database`);
  return { stamp, db: files.get("runtime/agent.db")!, record: manifest.runtime ?? null };
}

/** What `geometer restore` hands the restore container. */
export interface RestoreJob { target: SnapshotJob["target"]; shop: string; atMs?: number; identityFile: string; out: string; nowIso: string }

/**
 * Fetch, check and write the database and the note the runtime reads at its next start (`restored.json`: it moves the shop's ids on so none used after the snapshot comes
 * back, and writes a `restored` entry to the record). The deployer puts both in the shop's volume with the runtime stopped.
 */
export async function runRestoreJob(job: RestoreJob, store: ObjectStore): Promise<{ ok: true; stamp: string; record: RecordFacts }> {
  const got = await fetchSnapshot(store, job.shop, readFileSync(job.identityFile, "utf8"), job.atMs);
  mkdirSync(job.out, { recursive: true });
  const file = join(job.out, "agent.db");
  writeFileSync(file, got.db, { mode: 0o644 });
  const db = new DatabaseSync(file, { readOnly: true });
  let record: RecordFacts;
  try {
    const integrity = (db.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check;
    if (integrity !== "ok") throw new Error(`the database in the snapshot of ${got.stamp} failed its integrity check (${integrity})`);
    record = recordFacts(db);
  } finally { db.close(); }
  writeFileSync(join(job.out, RESTORE_NOTE), `${JSON.stringify({ snapshot: got.stamp, restoredAt: job.nowIso, lastSeq: record.lastSeq })}\n`, { mode: 0o644 });
  return { ok: true, stamp: got.stamp, record };
}

if (import.meta.main) {
  const a = process.argv.slice(2);
  const at = (flag: string) => a[a.indexOf(flag) + 1];
  if (a[0] === "--job") {
    const job = JSON.parse(readFileSync(a[1], "utf8")) as RestoreJob;
    try { console.log(JSON.stringify(await runRestoreJob(job, storeFor(job.target, mountedKey())))); } catch (e) { console.log(JSON.stringify({ ok: false, error: (e as Error).message })); process.exit(1); }
  } else {
    if (a.length < 5 || !a.includes("--identity") || !a.includes("--out")) { console.error("usage: restore-snapshot.ts <folder> --identity <key file> --out <empty folder>"); process.exit(2); }
    try { const files = restoreSnapshot(resolve(a[0]), readFileSync(at("--identity"), "utf8"), resolve(at("--out"))); console.log(`${files.length} files opened under ${resolve(at("--out"))}, each checked against the manifest`); } catch (e) { console.error((e as Error).message); process.exit(1); }
  }
}
