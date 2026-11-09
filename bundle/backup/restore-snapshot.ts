// Open a nightly snapshot, with the owner's key (the secret half is kept OFF the server: a person brings it). Two callers:
//   - a person, on their own machine, from one snapshot's folder as downloaded from the bucket: the full restore test, monthly (bundle/README.md, "Backups"):
//       node bundle/backup/restore-snapshot.ts <folder> --identity <key file> --out <empty folder>
//     The runtime's database comes out as `runtime/agent.db`, each Guard's backup as `guard-<kind>/...`, and every file is checked against `manifest.json` first. The shop's
//     fingerprint key (B69) comes out as `person_key`: on a new machine put it at `secrets/person-keys/<shop>` (mode 0600), or `geometer restore` does that for you.
//   - `geometer restore <shop> [--at TIME] --identity <key file>` on the server: the deployer runs this file in a short-lived container with a job file (`--job`) and
//     the key file mounted read-only; it fetches the newest snapshot at or before the time and writes the runtime's database and a `restored.json` note into a folder
//     the deployer then puts in place. For an agent someone else wrote (B51) it writes the agent's record, its key and every Guard's backup folder instead.
// Each object is opened by its name: `.tar.gz.age` is a folder (a Guard's backup), `.gz.age` one gzipped file, and a plain `.age` one file as snapshots before
// 9 Nov 2026 were written (not gzipped).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join, relative, resolve, sep } from "node:path";
import { gunzipSync } from "node:zlib";
import { decrypt } from "./age.ts";
import { fromTarGz } from "../export/tar.ts";
import { AGENT_RECORD_FILE, PERSON_KEY_OBJECT, agentRecordOf, mountedKey, recordFacts, stampMs, stampOf, storeFor } from "./snapshot.ts";
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
  if (manifest) {
    const m = JSON.parse(manifest.toString("utf8")) as { personKey?: string; files?: { path?: string; key?: string; sha256: string }[] };
    check(files, m);
    // as a file of its own, so the person restoring by hand can copy it into place rather than pick it out of the manifest
    if (m.personKey) files.set(PERSON_KEY_OBJECT, Buffer.from(`${m.personKey}\n`));
  }
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

export interface Fetched { stamp: string; db: Buffer; record: RecordFacts | null; /** The shop's fingerprint key, from the manifest (B69). A snapshot older than the key has none. */ personKey?: string }

/**
 * The runtime's database from the newest whole snapshot of a shop (one whose manifest was written: it is written last), at or before `atMs` if given. Only the database
 * and the manifest are fetched: a LIST and two GETs. The database is checked against the manifest's digest.
 */
const MANIFEST_KEY = /\/manifest\.json(\.gz)?\.age$/u;

/** The newest whole snapshot of a shop or agent (one whose manifest was written: it is written last), at or before `atMs` if given: its stamp and its objects' keys. One LIST. */
async function newestWhole(store: ObjectStore, name: string, atMs?: number): Promise<[string, string[]]> {
  const all = await snapshotsOf(store, name);
  const whole = [...all.entries()].filter(([stamp, keys]) => (atMs === undefined || stampMs(stamp) <= atMs) && keys.some((k) => MANIFEST_KEY.test(k))).sort(([a], [b]) => (a < b ? -1 : 1));
  if (whole.length === 0) throw new Error(atMs === undefined ? `there is no snapshot of ${name} in the snapshot place yet` : `there is no snapshot of ${name} from ${new Date(atMs).toISOString()} or before`);
  return whole.at(-1)!;
}

/** Fetch and open these objects of one snapshot (one GET each), saying plainly when the key is not the owner's. */
async function openAll(store: ObjectStore, folder: string, stamp: string, keys: string[], identity: string): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  for (const key of keys) {
    const sealed = await store.get(key);
    if (!sealed) throw new Error(`${key} was listed but could not be read`);
    let opened: Map<string, Buffer>;
    try { opened = openObject(key.slice(folder.length), sealed, identity); } catch (e) {
      if (/cannot open/u.test((e as Error).message)) throw new Error(`the snapshot of ${stamp} cannot be opened with this key: it opens with the owner's age key whose public half is in geometer.json`);
      throw e;
    }
    for (const [p, d] of opened) files.set(p, d);
  }
  return files;
}

export async function fetchSnapshot(store: ObjectStore, shop: string, identity: string, atMs?: number): Promise<Fetched> {
  const [stamp, keys] = await newestWhole(store, shop, atMs);
  const folder = `${shop}/${stamp}/`;
  const runtimeKey = keys.find((k) => /\/runtime\/agent\.db(\.gz)?\.age$/u.test(k));
  if (!runtimeKey) throw new Error(`the snapshot of ${stamp} has no runtime database (the shop had no record yet that night)`);
  const files = await openAll(store, folder, stamp, [keys.find((k) => MANIFEST_KEY.test(k))!, runtimeKey], identity);
  const manifest = JSON.parse(files.get("manifest.json")!.toString("utf8")) as { files?: { path?: string; key?: string; sha256: string }[]; runtime?: RecordFacts | null; personKey?: string };
  check(files, manifest);
  if (!digests(manifest).has("runtime/agent.db")) throw new Error(`the snapshot of ${stamp}'s manifest does not describe its runtime database`);
  return { stamp, db: files.get("runtime/agent.db")!, record: manifest.runtime ?? null, ...(manifest.personKey ? { personKey: manifest.personKey } : {}) };
}

export interface FetchedAgent {
  stamp: string;
  /** Every file of the snapshot, each checked against the manifest: `record.json` (when the agent had a record that night) and each Guard's backup folder as `guard-<kind>/...`. */
  files: Map<string, Buffer>;
  record: RecordFacts | null;
  personKey?: string;
  /** The Guards whose backup folder the snapshot holds, each checked to be this agent's (its backup.json names the agent as its tenant). */
  guards: string[];
}

/**
 * The newest whole snapshot of an agent someone else wrote (B51), at or before `atMs`: its record, its key and every Guard's backup folder. All of it is fetched (one LIST and
 * one GET per object: the manifest, the record and one tar per Guard) because a restore puts all of it back, and all of it is checked here, before anything is stopped:
 * every file the manifest names must be there with its digest, the record must be a record, and each Guard folder must be a Guard backup of this agent.
 */
export async function fetchAgentSnapshot(store: ObjectStore, agent: string, identity: string, atMs?: number): Promise<FetchedAgent> {
  const [stamp, keys] = await newestWhole(store, agent, atMs);
  const files = await openAll(store, `${agent}/${stamp}/`, stamp, [keys.find((k) => MANIFEST_KEY.test(k))!, ...keys.filter((k) => !MANIFEST_KEY.test(k))], identity);
  const manifest = JSON.parse(files.get("manifest.json")!.toString("utf8")) as { files?: { path?: string; key?: string; sha256: string }[]; ownAgent?: { record: RecordFacts | null }; personKey?: string };
  if (!manifest.ownAgent) throw new Error(`the snapshot of ${stamp} is not of an agent someone else wrote (it holds a shop's runtime)`);
  check(files, manifest);
  for (const path of digests(manifest).keys()) if (!files.has(path)) throw new Error(`the snapshot of ${stamp} is missing ${path}, which its manifest names`);
  files.delete("manifest.json");
  if (files.has(AGENT_RECORD_FILE)) agentRecordOf(files.get(AGENT_RECORD_FILE)!.toString("utf8"), agent);
  const guards = [...files.keys()].flatMap((p) => /^guard-([a-z]+)\/backup\.json$/u.exec(p)?.[1] ?? []).sort();
  for (const kind of guards) {
    let tenant: unknown;
    try { tenant = (JSON.parse(files.get(`guard-${kind}/backup.json`)!.toString("utf8")) as { tenant?: unknown }).tenant; } catch { tenant = undefined; }
    // the Guard's own restore refuses another tenant's backup too, but only once its Guard is stopped: this says so while everything still runs
    if (tenant !== agent) throw new Error(`the ${kind} Guard's backup in the snapshot of ${stamp} is not ${agent}'s (it names ${String(tenant)})`);
  }
  return { stamp, files, record: manifest.ownAgent.record, guards, ...(manifest.personKey ? { personKey: manifest.personKey } : {}) };
}

/** What `geometer restore` hands the restore container. `ownAgent`: the name is an agent someone else wrote, and everything of its snapshot is written out. */
export interface RestoreJob { target: SnapshotJob["target"]; shop: string; atMs?: number; identityFile: string; out: string; nowIso: string; ownAgent?: boolean }

/** The agent's snapshot, checked, written into the folder the deployer then puts in place: `record.json`, `person_key` and `guard-<kind>/...`. Readable by the Guard's own user, which restores from it. */
export async function runAgentRestoreJob(job: RestoreJob, store: ObjectStore): Promise<{ ok: true; stamp: string; record: RecordFacts | null; guards: string[]; ownAgent: true }> {
  const got = await fetchAgentSnapshot(store, job.shop, readFileSync(job.identityFile, "utf8"), job.atMs);
  mkdirSync(job.out, { recursive: true, mode: 0o755 });
  for (const [p, d] of got.files) {
    const target = resolve(job.out, p);
    if (!target.startsWith(resolve(job.out) + sep)) throw new Error(`${p} would be written outside ${job.out}`);
    mkdirSync(dirname(target), { recursive: true, mode: 0o755 });
    writeFileSync(target, d, { mode: 0o644 });
  }
  if (got.personKey) writeFileSync(join(job.out, PERSON_KEY_OBJECT), `${got.personKey}\n`, { mode: 0o644 });
  return { ok: true, stamp: got.stamp, record: got.record, guards: got.guards, ownAgent: true };
}

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
  // for the deployer, which runs as another user and takes it from here: the folder holds the whole database too, and it removes the folder when the restore is done
  if (got.personKey) writeFileSync(join(job.out, PERSON_KEY_OBJECT), `${got.personKey}\n`, { mode: 0o644 });
  writeFileSync(join(job.out, RESTORE_NOTE), `${JSON.stringify({ snapshot: got.stamp, restoredAt: job.nowIso, lastSeq: record.lastSeq })}\n`, { mode: 0o644 });
  return { ok: true, stamp: got.stamp, record };
}

if (import.meta.main) {
  const a = process.argv.slice(2);
  const at = (flag: string) => a[a.indexOf(flag) + 1];
  if (a[0] === "--job") {
    const job = JSON.parse(readFileSync(a[1], "utf8")) as RestoreJob;
    try { const store = storeFor(job.target, mountedKey()); console.log(JSON.stringify(job.ownAgent ? await runAgentRestoreJob(job, store) : await runRestoreJob(job, store))); } catch (e) { console.log(JSON.stringify({ ok: false, error: (e as Error).message })); process.exit(1); }
  } else {
    if (a.length < 5 || !a.includes("--identity") || !a.includes("--out")) { console.error("usage: restore-snapshot.ts <folder> --identity <key file> --out <empty folder>"); process.exit(2); }
    try { const files = restoreSnapshot(resolve(a[0]), readFileSync(at("--identity"), "utf8"), resolve(at("--out"))); console.log(`${files.length} files opened under ${resolve(at("--out"))}, each checked against the manifest`); } catch (e) { console.error((e as Error).message); process.exit(1); }
  }
}
