// The data duties against real SQLite and the folder store: a nightly snapshot is consistent, gzipped and encrypted to the owner's key, complete, and pruned as a
// fallback; a snapshot from before the change still restores; the weekly drill checks a snapshot WITHOUT the key (read back, the copy's record against the live one and
// the fingerprints) and tells a good one from a bad one; `restore` takes the owner's key and puts the database back; the host side runs the right containers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { encrypt, generateIdentity } from "../backup/age.ts";
import { fetchSnapshot, openObject, restoreSnapshot, runRestoreJob } from "../backup/restore-snapshot.ts";
import { drillShop } from "../backup/drill-check.ts";
import type { PublishedLine } from "../backup/drill-check.ts";
import { ledgerEntries } from "../../modules/record/ledger.ts";
import type { RecordEntry } from "../../modules/record/record.ts";
import { restoreShop, runBackup, runDrill, sealFile } from "../backup/jobs.ts";
import { agentRecordOf, recordFacts, snapshotAgent, snapshotShop } from "../backup/snapshot.ts";
import type { SnapshotJob } from "../backup/snapshot.ts";
import { folderStore } from "../backup/store.ts";
import type { ObjectStore } from "../backup/store.ts";
import { openStore } from "../../templates/commerce/bookings/server/store.ts";
import { deploy } from "../deploy.ts";
import { loadState, saveState } from "../lib/state.ts";
import { readStatus } from "../lib/status.ts";
import { keyIdOf, writeSecretFile, secretFile } from "../lib/secrets.ts";
import { fakeRunner, ok } from "../lib/runner.ts";
import { parseServer, STREAM_NOTE } from "../lib/server.ts";
import { world } from "./world.ts";
import { panelRuntime } from "./helpers.ts";
import { buildHeartbeat } from "../services/heartbeat.ts";
import { readBackups } from "../services/ops.ts";

const tmp = () => { const dir = mkdtempSync(join(tmpdir(), "geo-backup-")); return { dir, done: () => rmSync(dir, { recursive: true, force: true }) }; };

/** A runtime database as the runtime itself makes it (WAL, the record table with its append-only triggers), with some entries (the same entries for the same count). */
function runtimeDb(dir: string, entries: number): string {
  const store = openStore(dir);
  for (let i = 1; i <= entries; i++) store.commitStep({ snapshot: "{}", entries: [{ seq: i, time: "2026-11-04T10:00:00Z", conversation: "c", booking: "b-1", action: "a", outcome: "confirmed" } as never], nowMs: Date.now() });
  store.close();
  return join(dir, "agent.db");
}
/** An agent's record as the deployer writes it (agent/records.ts: state/records/<agent>.json), with `entries` entries. */
function agentRecordFile(dir: string, agent: string, entries: number): string {
  mkdirSync(dir, { recursive: true });
  const list = Array.from({ length: entries }, (_, k) => ({ seq: k + 1, time: `2026-11-04T10:00:0${k % 10}.000Z`, conversation: "agent", booking: "b-1", action: "send_message", inputsDigest: "d", outcome: "confirmed", decisions: [], language: "en", notes: "", refs: {} }));
  const file = join(dir, `${agent}.json`);
  writeFileSync(file, `${JSON.stringify({ schema: 1, entries: list, seen: {}, marks: {} })}\n`);
  return file;
}
const sha = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");
const STAMP = "20261104T013000Z";
const job = (recipient: string, stamp = STAMP): SnapshotJob => ({ stamp, keepDays: 30, recipient, target: { url: "x" }, shops: [] });
const keysOf = async (store: ObjectStore, prefix: string) => (await store.list(prefix)).map((o) => o.key).sort();

/** A snapshot as the bundle wrote it before 9 Nov 2026: one plain `.age` object per file, not gzipped, and a manifest that names each file by its object's key. */
async function oldSnapshot(store: ObjectStore, shop: string, stamp: string, db: string, recipient: string): Promise<void> {
  const data = readFileSync(db);
  const live = new DatabaseSync(db, { readOnly: true });
  const facts = recordFacts(live); live.close();
  await store.put(`${shop}/${stamp}/runtime/agent.db.age`, encrypt(data, recipient));
  await store.put(`${shop}/${stamp}/guard-razorpay/state.db.age`, encrypt(Buffer.from("old-guard"), recipient));
  const manifest = { shop, stamp, files: [{ key: `${shop}/${stamp}/runtime/agent.db.age`, bytes: data.length, sha256: sha(data) }, { key: `${shop}/${stamp}/guard-razorpay/state.db.age`, bytes: 9, sha256: sha("old-guard") }], runtime: facts };
  await store.put(`${shop}/${stamp}/manifest.json.age`, encrypt(Buffer.from(JSON.stringify(manifest)), recipient));
}

/** A shop's snapshot of this database, in its own folder store: the seal the drill checks it by, and the store. */
async function sealed(dir: string, name: string, db: string) {
  const store = folderStore(join(dir, `bucket-${name}`));
  const r = await snapshotShop({ name: "s", runtimeDb: db, guards: [] }, job(generateIdentity().recipient), store, join(dir, "scratch"));
  assert.equal(r.ok, true, r.error);
  return { seal: r.seal!, store };
}

test("a snapshot is one object per database file (the runtime's, each Guard's folder as one tar) and a manifest, gzipped then encrypted to the owner's key; its seal is in the clear", async () => {
  const t = tmp(); try {
    const db = runtimeDb(join(t.dir, "rt"), 5);
    const guardBackup = join(t.dir, "gs", "backups", STAMP); mkdirSync(join(guardBackup, "evidence"), { recursive: true });
    writeFileSync(join(guardBackup, "state.db"), "guard-state-bytes"); writeFileSync(join(guardBackup, "evidence", "seg-1.jsonl"), "ledger");
    const owner = generateIdentity();
    const store = folderStore(join(t.dir, "bucket"));
    const r = await snapshotShop({ name: "glow-salon", runtimeDb: db, guards: [{ kind: "razorpay", dir: guardBackup }] }, job(owner.recipient), store, join(t.dir, "scratch"));
    assert.deepEqual([r.ok, r.record?.records, r.record?.lastSeq, r.files, r.pruneError], [true, 5, 5, 3, undefined]);
    const keys = await keysOf(store, "glow-salon/");
    assert.deepEqual(keys, [`glow-salon/${STAMP}/guard-razorpay.tar.gz.age`, `glow-salon/${STAMP}/manifest.json.gz.age`, `glow-salon/${STAMP}/runtime/agent.db.gz.age`]);
    for (const k of keys) assert.ok((await store.get(k))!.toString("latin1").startsWith("age-encryption.org/v1"), k);
    // the owner's key opens it; the runtime's copy is a good database with the same record
    const runtimeObject = (await store.get(`glow-salon/${STAMP}/runtime/agent.db.gz.age`))!;
    const opened = openObject("runtime/agent.db.gz.age", runtimeObject, owner.identity);
    const restored = join(t.dir, "restored.db"); writeFileSync(restored, opened.get("runtime/agent.db")!);
    const copy = new DatabaseSync(restored, { readOnly: true });
    assert.deepEqual(recordFacts(copy), recordFacts(new DatabaseSync(db, { readOnly: true })));
    assert.equal((copy.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check, "ok");
    copy.close();
    assert.throws(() => openObject("runtime/agent.db.gz.age", runtimeObject, generateIdentity().identity), /cannot open/, "no other key opens it");
    const guard = openObject("guard-razorpay.tar.gz.age", (await store.get(`glow-salon/${STAMP}/guard-razorpay.tar.gz.age`))!, owner.identity);
    assert.deepEqual([...guard.keys()].sort(), ["guard-razorpay/evidence/seg-1.jsonl", "guard-razorpay/state.db"]);
    const manifest = JSON.parse(openObject("manifest.json.gz.age", (await store.get(`glow-salon/${STAMP}/manifest.json.gz.age`))!, owner.identity).get("manifest.json")!.toString());
    assert.equal(manifest.runtime.lastSeq, 5);
    assert.equal(manifest.files.find((f: { path: string }) => f.path === "guard-razorpay/state.db").sha256, sha("guard-state-bytes"), "digests are of the files before compression");
    // the seal: each object's sha256 as uploaded, and the copy's record with the head of its hash chain; no customer's words
    assert.deepEqual(r.seal!.objects.map((o) => o.key).sort(), keys);
    for (const o of r.seal!.objects) assert.equal(sha((await store.get(o.key))!), o.sha256);
    const rows = (new DatabaseSync(db, { readOnly: true }).prepare("SELECT entry FROM record ORDER BY seq").all() as { entry: string }[]).map((x) => JSON.parse(x.entry) as RecordEntry);
    assert.deepEqual(r.seal!.record, { ...recordFacts(new DatabaseSync(db, { readOnly: true })), head: ledgerEntries(rows, "glow-salon").at(-1)!.hash });
    assert.ok(!existsSync(guardBackup), "Guard's staging copy is removed once shipped");
    assert.ok(!existsSync(join(t.dir, "scratch", "glow-salon.db")), "no plain copy is left behind");
  } finally { t.done(); }
});

test("an agent someone else wrote: its record file is one object in place of the runtime's, then its Guards; the manifest holds its key, the seal only the key's id", async () => {
  const t = tmp(); try {
    const file = agentRecordFile(join(t.dir, "records"), "my-agent", 4);
    const guardBackup = join(t.dir, "gs", "backups", STAMP); mkdirSync(guardBackup, { recursive: true }); writeFileSync(join(guardBackup, "state.db"), "agent-guard-state");
    const keyFile = join(t.dir, "person-key"); const key = "ab".repeat(32); writeFileSync(keyFile, `${key}\n`);
    const owner = generateIdentity();
    const store = folderStore(join(t.dir, "bucket"));
    const r = await snapshotAgent({ name: "my-agent", recordFile: file, personKeyFile: keyFile, guards: [{ kind: "razorpay", dir: guardBackup }] }, job(owner.recipient), store);
    assert.deepEqual([r.ok, r.record?.records, r.record?.lastSeq, r.files], [true, 4, 4, 3]);
    const keys = await keysOf(store, "my-agent/");
    assert.deepEqual(keys, [`my-agent/${STAMP}/guard-razorpay.tar.gz.age`, `my-agent/${STAMP}/manifest.json.gz.age`, `my-agent/${STAMP}/record.json.gz.age`]);
    for (const k of keys) assert.ok((await store.get(k))!.toString("latin1").startsWith("age-encryption.org/v1"), k);
    assert.ok(!keys.some((k) => (readFileSync(join(t.dir, "bucket", k)).toString("latin1")).includes("send_message")), "no entry is readable in the bucket");
    // the owner's key opens the record, byte for byte the deployer's file
    const opened = openObject("record.json.gz.age", (await store.get(`my-agent/${STAMP}/record.json.gz.age`))!, owner.identity);
    assert.deepEqual(opened.get("record.json"), readFileSync(file));
    const manifest = JSON.parse(openObject("manifest.json.gz.age", (await store.get(`my-agent/${STAMP}/manifest.json.gz.age`))!, owner.identity).get("manifest.json")!.toString());
    assert.deepEqual([manifest.runtime, manifest.ownAgent.record.lastSeq, manifest.personKey], [null, 4, key]);
    // the seal: the record's facts as the drill computes them, the chain's head, and an id of the key that opens nothing
    const read = agentRecordOf(readFileSync(file, "utf8"), "my-agent");
    assert.deepEqual(r.seal!.record, { ...read.facts, head: ledgerEntries(read.entries, "my-agent").at(-1)!.hash });
    assert.equal(r.seal!.keyId, keyIdOf(key));
    assert.ok(!JSON.stringify(r.seal).includes(key), "the seal is kept in the clear: the key is not in it");
    assert.ok(!existsSync(guardBackup), "Guard's staging copy is removed once shipped");
    // a record file this bundle cannot read is not shipped as if it were one
    writeFileSync(file, "{\"schema\":2}");
    await assert.rejects(snapshotAgent({ name: "my-agent", recordFile: file, guards: [] }, job(owner.recipient, "20261105T013000Z"), store), /not one this bundle can read/);
  } finally { t.done(); }
});

test("a downloaded snapshot is opened with the owner's key into an empty folder, checked against its manifest; a file that starts like gzip comes back byte for byte", async () => {
  const t = tmp(); try {
    const db = runtimeDb(join(t.dir, "rt"), 4);
    const gz = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 1, 2, 3]); // a Guard file that happens to start with gzip's magic bytes is not mistaken for one
    const guard = join(t.dir, "g"); mkdirSync(guard); writeFileSync(join(guard, "anchor.json"), gz);
    const key = generateIdentity(); const store = folderStore(join(t.dir, "bucket"));
    await snapshotShop({ name: "s", runtimeDb: db, guards: [{ kind: "whatsapp", dir: guard }] }, job(key.recipient), store, join(t.dir, "scratch"));
    const files = restoreSnapshot(join(t.dir, "bucket", "s", STAMP), key.identity, join(t.dir, "open"));
    assert.deepEqual(files.map((f) => f.slice(join(t.dir, "open").length + 1)).sort(), ["guard-whatsapp/anchor.json", "manifest.json", "runtime/agent.db"]);
    assert.equal(recordFacts(new DatabaseSync(join(t.dir, "open", "runtime", "agent.db"), { readOnly: true })).lastSeq, 4);
    assert.deepEqual(readFileSync(join(t.dir, "open", "guard-whatsapp", "anchor.json")), gz);
    assert.throws(() => restoreSnapshot(join(t.dir, "bucket", "s", STAMP), key.identity, join(t.dir, "open")), /is not empty/);
    assert.throws(() => restoreSnapshot(join(t.dir, "bucket", "s", STAMP), generateIdentity().identity, join(t.dir, "other")), /cannot open/);
  } finally { t.done(); }
});

test("a snapshot written before the change (plain .age per file, not gzipped) still restores, by the folder and from the bucket; a damaged copy is refused by its manifest", async () => {
  const t = tmp(); try {
    const db = runtimeDb(join(t.dir, "rt"), 3);
    const owner = generateIdentity(); const store = folderStore(join(t.dir, "bucket"));
    await oldSnapshot(store, "s", "20261101T013000Z", db, owner.recipient);
    const files = restoreSnapshot(join(t.dir, "bucket", "s", "20261101T013000Z"), owner.identity, join(t.dir, "open"));
    assert.deepEqual(files.map((f) => f.slice(join(t.dir, "open").length + 1)).sort(), ["guard-razorpay/state.db", "manifest.json", "runtime/agent.db"]);
    assert.equal(recordFacts(new DatabaseSync(join(t.dir, "open", "runtime", "agent.db"), { readOnly: true })).lastSeq, 3);
    const got = await fetchSnapshot(store, "s", owner.identity);
    assert.deepEqual([got.stamp, got.record?.lastSeq, sha(got.db)], ["20261101T013000Z", 3, sha(readFileSync(db))]);
    await assert.rejects(fetchSnapshot(store, "s", generateIdentity().identity), /cannot be opened with this key: it opens with the owner's age key/);
    writeFileSync(join(t.dir, "bucket", "s", "20261101T013000Z", "runtime", "agent.db.age"), encrypt(Buffer.from("not the same file"), owner.recipient));
    await assert.rejects(fetchSnapshot(store, "s", owner.identity), /sha256 differs/);
  } finally { t.done(); }
});

test("old snapshots are deleted from here only as a fallback: a key that may not list or delete leaves pruning to the bucket's lifecycle rule, and the night is not a failure", async () => {
  const t = tmp(); try {
    const db = runtimeDb(join(t.dir, "rt"), 1);
    const key = generateIdentity(); const store = folderStore(join(t.dir, "bucket"));
    for (const stamp of ["20261001T013000Z", "20261010T013000Z", "20261103T013000Z"]) await store.put(`glow-salon/${stamp}/manifest.json.age`, Buffer.from("x"));
    await snapshotShop({ name: "glow-salon", runtimeDb: db, guards: [] }, job(key.recipient), store, join(t.dir, "s"));
    const left = new Set((await store.list("glow-salon/")).map((o) => o.key.split("/")[1]));
    assert.deepEqual([...left].sort(), ["20261010T013000Z", "20261103T013000Z", STAMP], "Oct 1 is 34 days old, Oct 10 is 25");
    const createOnly: ObjectStore = { ...store, list: async () => { throw new Error("could not list the bucket: the bucket answered 403"); }, delete: async () => { throw new Error("could not delete: the bucket answered 403"); } };
    const night = await snapshotShop({ name: "glow-salon", runtimeDb: db, guards: [] }, job(key.recipient, "20261105T013000Z"), createOnly, join(t.dir, "s"));
    assert.deepEqual([night.ok, night.pruneError], [true, "could not list the bucket: the bucket answered 403"]);
    const none = await snapshotShop({ name: "new-shop", runtimeDb: join(t.dir, "absent.db"), guards: [] }, job(key.recipient), store, join(t.dir, "s"));
    assert.equal(none.ok, false); assert.match(none.error!, /nothing to copy/);
  } finally { t.done(); }
});

test("the drill, without the key: every object read back unchanged, the copy's record the start of the live one, its chain against the published fingerprints", async () => {
  const t = tmp(); try {
    const live = runtimeDb(join(t.dir, "live"), 10);
    const rows = (file: string) => { const db = new DatabaseSync(file, { readOnly: true }); try { return (db.prepare("SELECT entry FROM record ORDER BY seq").all() as { entry: string }[]).map((r) => JSON.parse(r.entry) as RecordEntry); } finally { db.close(); } };
    const chain = ledgerEntries(rows(live), "s");
    const before = (seq: number, day = "2026-11-03"): PublishedLine => ({ seq, head: chain[seq - 1].hash, day, at: `${day}T06:00:00Z` });
    const full = await sealed(t.dir, "full", runtimeDb(join(t.dir, "a"), 10));
    const good = await drillShop({ name: "s", live, seal: full.seal, published: [before(8)] }, full.store);
    assert.equal(good.ok, true, good.detail);
    assert.match(good.detail, /^snapshot 20261104T013000Z: its 2 objects read back unchanged; a sound database of 10 entries \(integrity checked when it was made\), the start of the live record \(the chain matches at #10\); its chain matches the fingerprint published on 2026-11-03 \(entry 8\)$/);
    // a copy behind the live record is good when it is its start; a fingerprint published AFTER the snapshot is newer than the copy, which is how a nightly copy is
    const part = await sealed(t.dir, "part", runtimeDb(join(t.dir, "b"), 5));
    const behind = await drillShop({ name: "s", live, seal: part.seal, published: [before(4, "2026-11-02"), before(8, "2026-11-04")] }, part.store);
    assert.equal(behind.ok, true, behind.detail);
    assert.match(behind.detail, /\(the chain matches at #5; 5 newer entries since\); its chain matches the fingerprint published on 2026-11-02 \(entry 4\)/);
    assert.match((await drillShop({ name: "s", live, seal: part.seal, published: [before(8)] }, part.store)).detail, /the snapshot has 5 entries, fewer than the 8 its fingerprint of 2026-11-03 covers/);
    // the live record's last-but-one entry was rewritten after the snapshot: the digests at #10 agree, the chains do not
    const rewritten = runtimeDb(join(t.dir, "c"), 10);
    const d = new DatabaseSync(rewritten); d.exec("DROP TRIGGER record_no_update; UPDATE record SET entry = json_set(entry, '$.outcome', 'failed') WHERE seq = 3"); d.close();
    const chainBad = await drillShop({ name: "s", live: rewritten, seal: full.seal }, full.store);
    assert.deepEqual([chainBad.ok, chainBad.detail], [false, "snapshot 20261104T013000Z: the snapshot's record is not the start of the live record: their hash chains differ before entry #10"]);
    const both = await sealed(t.dir, "both", rewritten);
    assert.match((await drillShop({ name: "s", live: rewritten, seal: both.seal, published: [before(8)] }, both.store)).detail, /does not match the fingerprint published on 2026-11-03 \(entry 8\): it was changed after that fingerprint/);
    const tampered = runtimeDb(join(t.dir, "e"), 10);
    const e = new DatabaseSync(tampered); e.exec("DROP TRIGGER record_no_update; UPDATE record SET entry = 'tampered' WHERE seq = 10"); e.close();
    assert.match((await drillShop({ name: "s", live: tampered, seal: full.seal }, full.store)).detail, /the snapshot's last entry \(#10\) is not the live record's entry #10/);
    const empty = await sealed(t.dir, "empty", runtimeDb(join(t.dir, "f"), 0));
    assert.equal((await drillShop({ name: "s", live, seal: empty.seal }, empty.store)).ok, true, "made before the first entry: good");
    assert.match((await drillShop({ name: "s", live, seal: empty.seal, published: [before(8)] }, empty.store)).detail, /fewer than the 8/);
  } finally { t.done(); }
});

test("the drill reads every object back: one changed, one gone, or a store that refuses the read is a drill that failed or could not complete, with the reason", async () => {
  const t = tmp(); try {
    const live = runtimeDb(join(t.dir, "live"), 3);
    const s = await sealed(t.dir, "x", runtimeDb(join(t.dir, "a"), 3));
    const [first, second] = s.seal.objects;
    assert.match((await drillShop({ name: "s", live }, s.store)).detail, /no snapshot of this shop has been made yet/);
    const refusing: ObjectStore = { ...s.store, get: async () => { throw new Error("could not read s/x: the bucket answered 403"); } };
    assert.deepEqual(await drillShop({ name: "s", live, seal: s.seal }, refusing), { name: "s", ok: false, stamp: STAMP, detail: `the drill could not complete: the snapshot place would not let it read ${first.key} back (could not read s/x: the bucket answered 403)` });
    await s.store.put(second.key, Buffer.from("changed"));
    assert.match((await drillShop({ name: "s", live, seal: s.seal }, s.store)).detail, /is not the object that was written \(its sha256 differs\)/);
    await s.store.delete(second.key);
    assert.match((await drillShop({ name: "s", live, seal: s.seal }, s.store)).detail, /of the snapshot of 20261104T013000Z is not in the snapshot place/);
  } finally { t.done(); }
});

test("the restore job takes the newest snapshot at or before the time asked, checks it, and writes the database and the note the runtime reads at its start", async () => {
  const t = tmp(); try {
    const key = generateIdentity(); const store = folderStore(join(t.dir, "bucket"));
    for (const [stamp, n] of [["20261102T013000Z", 2], ["20261103T013000Z", 3], [STAMP, 4]] as const) await snapshotShop({ name: "s", runtimeDb: runtimeDb(join(t.dir, stamp), n), guards: [] }, job(key.recipient, stamp), store, join(t.dir, "x"));
    writeFileSync(join(t.dir, "identity"), key.identity);
    const base = { target: { url: join(t.dir, "bucket") }, shop: "s", identityFile: join(t.dir, "identity"), nowIso: "2026-11-04T12:00:00.000Z" };
    const at = await runRestoreJob({ ...base, atMs: Date.parse("2026-11-03T20:00:00Z"), out: join(t.dir, "out1") }, store);
    assert.deepEqual([at.stamp, at.record.lastSeq], ["20261103T013000Z", 3]);
    assert.equal(recordFacts(new DatabaseSync(join(t.dir, "out1", "agent.db"), { readOnly: true })).lastSeq, 3);
    assert.deepEqual(JSON.parse(readFileSync(join(t.dir, "out1", "restored.json"), "utf8")), { snapshot: "20261103T013000Z", restoredAt: "2026-11-04T12:00:00.000Z", lastSeq: 3 });
    assert.equal((await runRestoreJob({ ...base, out: join(t.dir, "out2") }, store)).stamp, STAMP, "no time: the newest");
    await assert.rejects(runRestoreJob({ ...base, atMs: Date.parse("2026-11-01T00:00:00Z"), out: join(t.dir, "out3") }, store), /no snapshot of s from 2026-11-01T00:00:00.000Z or before/);
  } finally { t.done(); }
});

test("the runtime leaves checkpoints to SQLite: nothing turns the automatic WAL checkpoint off", () => {
  const t = tmp(); try {
    const source = readFileSync(new URL("../../modules/runtime/store.ts", import.meta.url), "utf8").replace(/\/\/.*$/gmu, "");
    assert.ok(!/wal_autocheckpoint\s*=\s*0/iu.test(source), "store.ts turns the automatic checkpoint off");
    const store = openStore(t.dir); store.close();
    const db = new DatabaseSync(join(t.dir, "agent.db"));
    assert.ok(Number((db.prepare("PRAGMA wal_autocheckpoint").get() as { wal_autocheckpoint: number }).wal_autocheckpoint) > 0, "SQLite's automatic checkpoint is on");
    assert.equal((db.prepare("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode, "wal");
    db.close();
  } finally { t.done(); }
});

test("`backup now` has each Guard make its own backup, then runs ONE snapshot container with the shops' volumes and the bucket key, encrypting to the owner's key; the seal is kept for the drill", async () => {
  const owner = generateIdentity();
  const w = world({ "glow-salon": undefined as never }, { backup: { snapshots: { url: "s3://snaps/a", endpoint: "http://minio:9000" }, ageRecipient: owner.recipient } });
  try {
    writeSecretFile(secretFile(w.root, "backup", "snapshots"), "AKID2:SECRET2");
    // a server upgraded from the continuous copy still has its files: the deploy removes them, and the compose file has no such service
    writeSecretFile(secretFile(w.root, "litestream", "litestream.yml"), "access-key-id: OLD"); writeSecretFile(secretFile(w.root, "backup", "stream"), "OLD:KEY");
    writeFileSync(join(w.paths.shop("glow-salon"), "runtime.json"), JSON.stringify(panelRuntime()));
    w.handIn("glow-salon");
    await deploy(w.ctx);
    assert.ok(!existsSync(secretFile(w.root, "litestream")) && !existsSync(secretFile(w.root, "backup", "stream")), "the old copy's key is not kept");
    assert.ok(!readFileSync(join(w.paths.generated, "compose.yaml"), "utf8").includes("litestream"));
    w.admin.length = 0; w.calls.length = 0;
    const jobs: string[][] = [];
    let recipient = "";
    const seal = { stamp: "20261104T100000Z", objects: [{ key: "glow-salon/20261104T100000Z/runtime/agent.db.gz.age", bytes: 9, sha256: "a".repeat(64) }], record: { records: 3, lastSeq: 3, lastEntryDigest: "d", head: "sha256:h" } };
    w.ctx.runner = fakeRunner((_c, args) => {
      if (args[0] === "run") {
        jobs.push(args);
        recipient = JSON.parse(readFileSync(args.find((a) => a.endsWith(":/job/job.json:ro"))!.split(":")[0], "utf8")).recipient;
        return ok(JSON.stringify({ stamp: "x", results: [{ name: "glow-salon", ok: true, stamp: "20261104T100000Z", files: 4, bytes: 999, record: { records: 3, lastSeq: 3, lastEntryDigest: "d" }, seal, pruneError: "could not list the bucket: the bucket answered 403" }] }));
      }
      return ok(JSON.stringify({ status: 200, body: {} }));
    });
    const r = await runBackup(w.ctx);
    assert.equal(r.ok, true, "a key that may not prune does not fail the night");
    assert.match(r.lines.join("\n"), /glow-salon: snapshot 20261104T100000Z written .*; pruning left to the bucket's lifecycle rule \(this key may not list or delete: could not list the bucket: the bucket answered 403\)/);
    assert.equal(jobs.length, 1);
    const flags = jobs[0].join(" ");
    assert.match(flags, /--cap-drop ALL/); assert.match(flags, /--network geometer-acme-vps-1_egress/); assert.match(flags, /-v .*\/\.\.\/|\/app:ro/);
    assert.match(flags, /geometer-acme-vps-1_rt-data-glow-salon:\/v\/rt-data-glow-salon/);
    assert.match(flags, /geometer-acme-vps-1_gs-glow-salon-razorpay:\/v\/gs-glow-salon-razorpay/);
    assert.match(flags, /:\/run\/secrets\/snapshots:ro/);
    assert.ok(!flags.includes("identity"), "no secret key is on the server or in the job");
    assert.ok(!jobs[0].some((a) => a.includes("SECRET2")), "the bucket key is a mounted file, never an argument");
    assert.equal(recipient, owner.recipient);
    assert.deepEqual(JSON.parse(readFileSync(sealFile(w.root, "glow-salon"), "utf8")), seal);
    assert.equal(readStatus(w.root, "glow-salon")!.backups!.lastCopyAt, "2026-11-04T10:00:00.000Z");
    assert.equal(loadState(w.root).shops["glow-salon"].lastBackupAt, "2026-11-04T10:00:00.000Z");
  } finally { w.done(); }
});

test("a failed drill is written where the panel and `status` show it, with the reason; the drill container has the bucket key and the shop's seal, and no secret key", async () => {
  const w = world({ "glow-salon": undefined as never }, { backup: { snapshots: { url: "s3://snaps/a" }, ageRecipient: generateIdentity().recipient } });
  try {
    writeSecretFile(secretFile(w.root, "backup", "snapshots"), "A:B");
    writeFileSync(join(w.paths.shop("glow-salon"), "runtime.json"), JSON.stringify(panelRuntime()));
    w.handIn("glow-salon"); await deploy(w.ctx);
    // no snapshot yet: nothing to drill, no verdict (fleet reads "absent"), and no container
    const idle: string[][] = [];
    w.ctx.runner = fakeRunner((_c, args) => { idle.push(args); return ok("{}"); });
    assert.deepEqual(await runDrill(w.ctx), { ok: true, lines: ["glow-salon: no snapshot of it yet, so no drill this time"] });
    assert.deepEqual(idle, []);
    assert.equal(readStatus(w.root, "glow-salon")?.backups?.lastDrillAt ?? null, null);
    mkdirSync(join(w.paths.state, "snapshots"), { recursive: true });
    writeFileSync(sealFile(w.root, "glow-salon"), JSON.stringify({ stamp: STAMP, objects: [], record: null }));
    const reason = `snapshot ${STAMP}: the drill could not complete: the snapshot place would not let it read glow-salon/${STAMP}/runtime/agent.db.gz.age back (could not read: the bucket answered 403)`;
    const runs: string[][] = [];
    let drillJob: { shops: { name: string; seal?: unknown }[] } | undefined;
    w.ctx.runner = fakeRunner((_c, args) => {
      runs.push(args);
      if (!args.includes("/app/bundle/backup/drill-check.ts")) return ok("{}");
      drillJob = JSON.parse(readFileSync(args.find((a) => a.endsWith(":/job/job.json:ro"))!.split(":")[0], "utf8"));
      return ok(JSON.stringify({ results: [{ name: "glow-salon", ok: false, detail: reason }] }));
    });
    const r = await runDrill(w.ctx);
    assert.equal(r.ok, false);
    assert.equal(r.lines[0], `glow-salon: restore drill FAILED: ${reason}`);
    const flags = runs.find((a) => a.includes("/app/bundle/backup/drill-check.ts"))!.join(" ");
    assert.match(flags, /:\/run\/secrets\/snapshots:ro/); assert.match(flags, /--network geometer-acme-vps-1_egress/);
    assert.ok(!flags.includes("identity"), "the drill has no key that opens a snapshot");
    assert.deepEqual(drillJob!.shops[0].seal, { stamp: STAMP, objects: [], record: null });
    const s = readStatus(w.root, "glow-salon")!.backups!;
    assert.deepEqual([s.drillOk, s.lastDrillAt, s.drillDetail], [false, "2026-11-04T10:00:00.000Z", reason]);
    assert.equal(loadState(w.root).shops["glow-salon"].lastDrill?.ok, false);
    // ... and from there to the heartbeat: the drill's time and verdict travel as an age and a flag, the reason stays on the server, and the shop is still ready
    const heartbeatAt = (iso: string) => buildHeartbeat({ deploymentId: "acme-vps-1", bundleVersion: "0.1.0", now: new Date(iso), baseline: {}, shops: [{ id: "glow-salon", pathway: "bookings", pathwayVersion: "0.1.0", up: true, ready: true, status: null, guards: [], backups: readBackups(w.paths.statusFile("glow-salon")) }] }).body;
    const agent = (heartbeatAt("2026-11-04T10:30:00.000Z").agents as Record<string, any>[])[0];
    assert.deepEqual(agent.drill, { age_s: 1800, ok: false });
    assert.equal(agent.backup_age_s, undefined, "no snapshot has been made on this server yet: nothing is sent, not 0");
    assert.equal(agent.runtime.ready, true);
    assert.doesNotMatch(JSON.stringify(heartbeatAt("2026-11-04T10:30:00.000Z")), /snapshot place|could not complete/u);
    w.ctx.runner = fakeRunner(() => ok(JSON.stringify({ results: [{ name: "glow-salon", ok: true, detail: `snapshot ${STAMP}: its 2 objects read back unchanged` }] })));
    assert.equal((await runDrill(w.ctx)).ok, true);
    assert.equal(readStatus(w.root, "glow-salon")!.backups!.drillOk, true);
  } finally { w.done(); }
});

test("`restore` takes the owner's key from the person restoring, fetches the snapshot while the shop runs, then stops only the runtime, swaps the file in with the note, and starts it", async () => {
  const w = world({ "glow-salon": undefined as never }, { backup: { snapshots: { url: "s3://snaps/a" }, ageRecipient: generateIdentity().recipient } });
  try {
    writeSecretFile(secretFile(w.root, "backup", "snapshots"), "A:B");
    writeFileSync(join(w.paths.shop("glow-salon"), "runtime.json"), JSON.stringify(panelRuntime()));
    w.handIn("glow-salon"); await deploy(w.ctx);
    const seen: string[][] = [];
    w.ctx.runner = fakeRunner((_c, args) => { seen.push(args); return args.includes("--job") ? ok(JSON.stringify({ ok: true, stamp: STAMP, record: { records: 7, lastSeq: 7, lastEntryDigest: "d" } })) : ok(""); });
    await assert.rejects(restoreShop(w.ctx, "glow-salon", {}), /opens only with the owner's age key, which is kept off this server: .*--identity <key file>/);
    assert.deepEqual(seen, [], "nothing was run without the key");
    const key = join(w.root, "owner-key"); writeFileSync(key, "AGE-SECRET-KEY-1X");
    const said = await restoreShop(w.ctx, "glow-salon", { at: "2026-11-04T09:00:00Z", identity: key });
    assert.match(said, /restored from the snapshot of 20261104T013000Z \(record up to entry #7\)/);
    assert.match(said, /moves its ids on, writes a "restored" entry, and looks at the payment service and the calendar before it sends anything again/);
    const order = seen.map((a) => (a.includes("--job") ? "fetch" : a.includes("stop") ? `stop ${a.at(-1)}` : a.includes("start") ? `start ${a.at(-1)}` : a.includes("busybox:1.37.0") ? "swap" : "other")).filter((x) => x !== "other");
    assert.deepEqual(order, ["fetch", "stop rt-glow-salon", "swap", "start rt-glow-salon"]);
    assert.match(seen.find((a) => a.includes("--job"))!.join(" "), /owner-key:\/run\/secrets\/identity:ro/);
    const swap = seen.find((a) => a.includes("busybox:1.37.0"))!;
    assert.deepEqual(swap.slice(swap.indexOf("--user"), swap.indexOf("--user") + 2), ["--user", "1000:1000"]);
    assert.match(swap.at(-1)!, /mv agent\.db agent\.db\.before-restore-20261104T100000Z.*cp \/in\/restored\.json restored\.json/);
    // a missing snapshot leaves the shop running and untouched
    seen.length = 0;
    w.ctx.runner = fakeRunner((_c, args) => { seen.push(args); return args.includes("--job") ? { code: 1, stdout: JSON.stringify({ ok: false, error: "there is no snapshot of glow-salon from 2026-10-01T00:00:00.000Z or before" }), stderr: "" } : ok(""); });
    await assert.rejects(restoreShop(w.ctx, "glow-salon", { at: "2026-10-01T00:00:00Z", identity: key }), /No snapshot was restored; the shop was not touched and is still running\. there is no snapshot of glow-salon from 2026-10-01/);
    assert.ok(seen.every((a) => !a.includes("stop")), "nothing was stopped");
    await assert.rejects(restoreShop(w.ctx, "glow-salon", { fromSnapshot: "x" }), /--from-snapshot is gone/);
    // a shop pinned to a version from before the restored mode would ignore the note and reuse ids: refused before anything is fetched or stopped
    const old = join(w.root, "templates", "commerce", "bookings@0.0.9"); mkdirSync(old, { recursive: true }); writeFileSync(join(old, "package.json"), JSON.stringify({ version: "0.0.9" }));
    mkdirSync(join(w.root, "modules", "runtime"), { recursive: true });
    const state = loadState(w.root); state.shops["glow-salon"].applied = { ...state.shops["glow-salon"].applied!, pathway: "bookings@0.0.9", pathwayDir: old }; saveState(w.root, state);
    seen.length = 0;
    await assert.rejects(restoreShop(w.ctx, "glow-salon", { identity: key }), /glow-salon runs bookings@0\.0\.9, whose runtime does not know a restore.*geometer update --shops glow-salon.*Nothing was touched/su);
    assert.deepEqual(seen, [], "nothing was run");
  } finally { w.done(); }
});

test("a geometer.json that still names the continuous copy's bucket loads, with a plain note; it is never silently ignored", () => {
  const recipient = generateIdentity().recipient;
  const base = { schema: 1, id: "acme-vps-1", domain: "shops.example.com", reviewedBy: "b", model: { wire: "openai", model: "m" } };
  const old = parseServer({ ...base, backup: { stream: { url: "s3://stream/a" }, snapshots: { url: "s3://snaps/a" }, ageRecipient: recipient } });
  assert.deepEqual([old.errors, old.notes], [[], [STREAM_NOTE]]);
  assert.equal((old.config.backup as unknown as Record<string, unknown>).stream, undefined);
  assert.deepEqual(parseServer({ ...base, backup: { snapshots: { url: "s3://snaps/a" }, ageRecipient: recipient } }).notes, []);
});
