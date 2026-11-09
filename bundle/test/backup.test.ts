// The data duties against real SQLite and the folder store: a nightly snapshot is consistent, gzipped and encrypted, complete and pruned at 30 days; a snapshot from
// before the change still restores; the drill restores the newest snapshot and tells a good copy from a bad one; `restore` puts it back; the host side runs the right
// containers with the right mounts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { encrypt, generateIdentity } from "../backup/age.ts";
import { fetchSnapshot, openObject, restoreSnapshot, runRestoreJob } from "../backup/restore-snapshot.ts";
import { drillFromSnapshot, drillShop } from "../backup/drill-check.ts";
import { ledgerEntries } from "../../modules/record/ledger.ts";
import type { RecordEntry } from "../../modules/record/record.ts";
import { drillKeyFile, restoreShop, runBackup, runDrill } from "../backup/jobs.ts";
import { recordFacts, snapshotShop } from "../backup/snapshot.ts";
import type { SnapshotJob } from "../backup/snapshot.ts";
import { folderStore } from "../backup/store.ts";
import type { ObjectStore } from "../backup/store.ts";
import { openStore } from "../../templates/commerce/bookings/server/store.ts";
import { deploy } from "../deploy.ts";
import { loadState } from "../lib/state.ts";
import { readStatus } from "../lib/status.ts";
import { readSecretFile, writeSecretFile, secretFile } from "../lib/secrets.ts";
import { fakeRunner, ok } from "../lib/runner.ts";
import { parseServer, STREAM_NOTE } from "../lib/server.ts";
import { world } from "./world.ts";
import { panelRuntime } from "./helpers.ts";
import { buildHeartbeat } from "../services/heartbeat.ts";
import { readBackups } from "../services/ops.ts";

const tmp = () => { const dir = mkdtempSync(join(tmpdir(), "geo-backup-")); return { dir, done: () => rmSync(dir, { recursive: true, force: true }) }; };

/** A runtime database as the runtime itself makes it (WAL, the record table with its append-only triggers), with some entries. */
function runtimeDb(dir: string, entries: number): string {
  const store = openStore(dir);
  for (let i = 1; i <= entries; i++) store.commitStep({ snapshot: "{}", entries: [{ seq: i, time: "2026-11-04T10:00:00Z", conversation: "c", booking: "b-1", action: "a", outcome: "confirmed" } as never], nowMs: Date.now() });
  store.close();
  return join(dir, "agent.db");
}
const sha = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");
const job = (recipients: string[], stamp = "20261104T013000Z"): SnapshotJob => ({ stamp, keepDays: 30, recipients, target: { url: "x" }, shops: [] });
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

test("a snapshot is one object per database file (the runtime's, each Guard's folder as one tar) and a manifest, gzipped then encrypted to both keys; the plain database is not in the bucket", async () => {
  const t = tmp(); try {
    const db = runtimeDb(join(t.dir, "rt"), 5);
    const guardBackup = join(t.dir, "gs", "backups", "20261104T013000Z"); mkdirSync(join(guardBackup, "evidence"), { recursive: true });
    writeFileSync(join(guardBackup, "state.db"), "guard-state-bytes"); writeFileSync(join(guardBackup, "evidence", "seg-1.jsonl"), "ledger");
    const owner = generateIdentity(); const drill = generateIdentity();
    const store = folderStore(join(t.dir, "bucket"));
    const r = await snapshotShop({ name: "glow-salon", runtimeDb: db, guards: [{ kind: "razorpay", dir: guardBackup }] }, job([owner.recipient, drill.recipient]), store, join(t.dir, "scratch"));
    assert.deepEqual([r.ok, r.record?.records, r.record?.lastSeq, r.files, r.pruneError], [true, 5, 5, 3, undefined]);
    const keys = await keysOf(store, "glow-salon/");
    assert.deepEqual(keys, ["glow-salon/20261104T013000Z/guard-razorpay.tar.gz.age", "glow-salon/20261104T013000Z/manifest.json.gz.age", "glow-salon/20261104T013000Z/runtime/agent.db.gz.age"]);
    for (const k of keys) assert.ok((await store.get(k))!.toString("latin1").startsWith("age-encryption.org/v1"), k);
    // either key opens it; the runtime's copy is a good database with the same record
    for (const identity of [owner.identity, drill.identity]) {
      const opened = openObject("runtime/agent.db.gz.age", (await store.get("glow-salon/20261104T013000Z/runtime/agent.db.gz.age"))!, identity);
      const restored = join(t.dir, `restored-${identity.slice(-6)}.db`); writeFileSync(restored, opened.get("runtime/agent.db")!);
      const copy = new DatabaseSync(restored, { readOnly: true });
      assert.deepEqual(recordFacts(copy), recordFacts(new DatabaseSync(db, { readOnly: true })));
      assert.equal((copy.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check, "ok");
      copy.close();
    }
    const guard = openObject("guard-razorpay.tar.gz.age", (await store.get("glow-salon/20261104T013000Z/guard-razorpay.tar.gz.age"))!, owner.identity);
    assert.deepEqual([...guard.keys()].sort(), ["guard-razorpay/evidence/seg-1.jsonl", "guard-razorpay/state.db"]);
    const manifest = JSON.parse(openObject("manifest.json.gz.age", (await store.get("glow-salon/20261104T013000Z/manifest.json.gz.age"))!, owner.identity).get("manifest.json")!.toString());
    assert.equal(manifest.runtime.lastSeq, 5);
    assert.equal(manifest.files.find((f: { path: string }) => f.path === "guard-razorpay/state.db").sha256, sha("guard-state-bytes"), "digests are of the files before compression");
    assert.ok(!existsSync(guardBackup), "Guard's staging copy is removed once shipped");
    assert.ok(!existsSync(join(t.dir, "scratch", "glow-salon.db")), "no plain copy is left behind");
  } finally { t.done(); }
});

test("a downloaded snapshot is opened with the owner's key into an empty folder, checked against its manifest; a file that starts like gzip comes back byte for byte", async () => {
  const t = tmp(); try {
    const db = runtimeDb(join(t.dir, "rt"), 4);
    const gz = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 1, 2, 3]); // a Guard file that happens to start with gzip's magic bytes is not mistaken for one
    const guard = join(t.dir, "g"); mkdirSync(guard); writeFileSync(join(guard, "anchor.json"), gz);
    const key = generateIdentity(); const store = folderStore(join(t.dir, "bucket"));
    await snapshotShop({ name: "s", runtimeDb: db, guards: [{ kind: "whatsapp", dir: guard }] }, job([key.recipient]), store, join(t.dir, "scratch"));
    const files = restoreSnapshot(join(t.dir, "bucket", "s", "20261104T013000Z"), key.identity, join(t.dir, "open"));
    assert.deepEqual(files.map((f) => f.slice(join(t.dir, "open").length + 1)).sort(), ["guard-whatsapp/anchor.json", "manifest.json", "runtime/agent.db"]);
    assert.equal(recordFacts(new DatabaseSync(join(t.dir, "open", "runtime", "agent.db"), { readOnly: true })).lastSeq, 4);
    assert.deepEqual(readFileSync(join(t.dir, "open", "guard-whatsapp", "anchor.json")), gz);
    assert.throws(() => restoreSnapshot(join(t.dir, "bucket", "s", "20261104T013000Z"), key.identity, join(t.dir, "open")), /is not empty/);
    assert.throws(() => restoreSnapshot(join(t.dir, "bucket", "s", "20261104T013000Z"), generateIdentity().identity, join(t.dir, "other")), /cannot open/);
  } finally { t.done(); }
});

test("a snapshot written before the change (plain .age per file, not gzipped) still restores, by the folder and from the bucket; the drill key cannot open it and says why", async () => {
  const t = tmp(); try {
    const db = runtimeDb(join(t.dir, "rt"), 3);
    const owner = generateIdentity(); const store = folderStore(join(t.dir, "bucket"));
    await oldSnapshot(store, "s", "20261101T013000Z", db, owner.recipient);
    const files = restoreSnapshot(join(t.dir, "bucket", "s", "20261101T013000Z"), owner.identity, join(t.dir, "open"));
    assert.deepEqual(files.map((f) => f.slice(join(t.dir, "open").length + 1)).sort(), ["guard-razorpay/state.db", "manifest.json", "runtime/agent.db"]);
    assert.equal(recordFacts(new DatabaseSync(join(t.dir, "open", "runtime", "agent.db"), { readOnly: true })).lastSeq, 3);
    const got = await fetchSnapshot(store, "s", owner.identity);
    assert.deepEqual([got.stamp, got.record?.lastSeq, sha(got.db)], ["20261101T013000Z", 3, sha(readFileSync(db))]);
    await assert.rejects(fetchSnapshot(store, "s", generateIdentity().identity), /made before the server had its drill key \(9 Nov 2026\) opens only with the owner's key/);
    // a damaged copy is refused by its manifest
    writeFileSync(join(t.dir, "bucket", "s", "20261101T013000Z", "runtime", "agent.db.age"), encrypt(Buffer.from("not the same file"), owner.recipient));
    await assert.rejects(fetchSnapshot(store, "s", owner.identity), /sha256 differs/);
  } finally { t.done(); }
});

test("snapshots older than the keep period are deleted, newer ones kept; a bucket key that may not list or delete does not fail the night; a shop with nothing to copy says so", async () => {
  const t = tmp(); try {
    const db = runtimeDb(join(t.dir, "rt"), 1);
    const key = generateIdentity(); const store = folderStore(join(t.dir, "bucket"));
    for (const stamp of ["20261001T013000Z", "20261010T013000Z", "20261103T013000Z"]) await store.put(`glow-salon/${stamp}/manifest.json.age`, Buffer.from("x"));
    await snapshotShop({ name: "glow-salon", runtimeDb: db, guards: [] }, job([key.recipient]), store, join(t.dir, "s"));
    const left = new Set((await store.list("glow-salon/")).map((o) => o.key.split("/")[1]));
    assert.deepEqual([...left].sort(), ["20261010T013000Z", "20261103T013000Z", "20261104T013000Z"], "Oct 1 is 34 days old, Oct 10 is 25");
    const writeOnly: ObjectStore = { ...store, list: async () => { throw new Error("could not list the bucket: the bucket answered 403"); } };
    const night = await snapshotShop({ name: "glow-salon", runtimeDb: db, guards: [] }, job([key.recipient], "20261105T013000Z"), writeOnly, join(t.dir, "s"));
    assert.deepEqual([night.ok, night.pruneError], [true, "could not list the bucket: the bucket answered 403"]);
    const none = await snapshotShop({ name: "new-shop", runtimeDb: join(t.dir, "absent.db"), guards: [] }, job([key.recipient]), store, join(t.dir, "s"));
    assert.equal(none.ok, false); assert.match(none.error!, /nothing to copy/);
  } finally { t.done(); }
});

test("the drill compares the restored record's chain with the published fingerprints (B28): a match passes, a rewritten copy fails, a copy shorter than a fingerprint published before it fails", () => {
  const t = tmp(); try {
    const live = runtimeDb(join(t.dir, "live"), 10);
    const rows = (file: string) => { const db = new DatabaseSync(file, { readOnly: true }); try { return (db.prepare("SELECT entry FROM record ORDER BY seq").all() as { entry: string }[]).map((r) => JSON.parse(r.entry) as RecordEntry); } finally { db.close(); } };
    const chain = ledgerEntries(rows(live), "s");
    const snapAt = Date.parse("2026-11-04T01:30:00Z");
    const published = [{ seq: 8, head: chain[7].hash, day: "2026-11-03", at: "2026-11-03T06:00:00Z" }];
    const good = drillShop({ name: "s", restored: runtimeDb(join(t.dir, "a"), 10), live, published }, snapAt);
    assert.equal(good.ok, true, good.detail);
    assert.match(good.detail, /its chain matches the fingerprint published on 2026-11-03 \(entry 8\)/);
    const rewritten = runtimeDb(join(t.dir, "b"), 10);
    const d = new DatabaseSync(rewritten); d.exec("DROP TRIGGER record_no_update; UPDATE record SET entry = json_set(entry, '$.outcome', 'failed') WHERE seq = 3"); d.close();
    const bad = drillShop({ name: "s", restored: rewritten, live: rewritten, published }, snapAt);
    assert.equal(bad.ok, false);
    assert.match(bad.detail, /does not match the fingerprint published on 2026-11-03 \(entry 8\): it was changed after that fingerprint/);
    const short = drillShop({ name: "s", restored: runtimeDb(join(t.dir, "c"), 5), live, published }, snapAt);
    assert.equal(short.ok, false);
    assert.match(short.detail, /fewer than the 8 its fingerprint of 2026-11-03 covers/);
    // a fingerprint published AFTER the snapshot was taken is newer than the copy: that is how a nightly snapshot is, not a fault; the older one it holds is compared
    const later = [{ seq: 4, head: chain[3].hash, day: "2026-11-02", at: "2026-11-02T06:00:00Z" }, { seq: 8, head: chain[7].hash, day: "2026-11-04", at: "2026-11-04T06:00:00Z" }];
    const behind = drillShop({ name: "s", restored: runtimeDb(join(t.dir, "f"), 5), live, published: later }, snapAt);
    assert.equal(behind.ok, true, behind.detail);
    assert.match(behind.detail, /\(5 newer entries since the snapshot\); its chain matches the fingerprint published on 2026-11-02 \(entry 4\)/);
    const gone = drillShop({ name: "s", restored: runtimeDb(join(t.dir, "e"), 0), live: runtimeDb(join(t.dir, "e2"), 0), published }, snapAt);
    assert.equal(gone.ok, false, "both empty, but something was published: the record is gone");
  } finally { t.done(); }
});

test("the drill passes a good copy and says exactly what is wrong with a bad one; a copy behind the live record is good when it is its start", () => {
  const t = tmp(); try {
    const live = runtimeDb(join(t.dir, "live"), 10);
    const copyOf = (name: string, entries: number) => runtimeDb(join(t.dir, name), entries);
    assert.deepEqual(drillShop({ name: "s", restored: copyOf("a", 10), live }), { name: "s", ok: true, detail: "restored 10 entries, integrity ok, last entry #10 matches the live record; no fingerprint of its record has been published yet, so none was compared" });
    const behind = drillShop({ name: "s", restored: copyOf("b", 8), live });
    assert.equal(behind.ok, true); assert.match(behind.detail, /2 newer entries since the snapshot/);
    const different = runtimeDb(join(t.dir, "d"), 10);
    const d = new DatabaseSync(different); d.exec("DROP TRIGGER record_no_update; UPDATE record SET entry = 'tampered' WHERE seq = 10"); d.close();
    const wrong = drillShop({ name: "s", restored: different, live });
    assert.equal(wrong.ok, false); assert.match(wrong.detail, /last entry \(#10\) is not the live record's entry #10/);
    assert.match(drillShop({ name: "s", restored: join(t.dir, "missing.db"), live }).detail, /nothing was restored/);
    writeFileSync(join(t.dir, "junk.db"), "not a database at all, just text, long enough to look like a file".repeat(100));
    assert.equal(drillShop({ name: "s", restored: join(t.dir, "junk.db"), live }).ok, false);
    assert.equal(drillShop({ name: "s", restored: copyOf("e", 0), live }).ok, false, "an empty copy of a live record is a failure");
  } finally { t.done(); }
});

test("the drill restores the NEWEST snapshot from the snapshot place with the drill key, and says which one; with no snapshot, or the wrong key, it fails in plain words", async () => {
  const t = tmp(); try {
    const owner = generateIdentity(); const drill = generateIdentity(); const store = folderStore(join(t.dir, "bucket"));
    await snapshotShop({ name: "s", runtimeDb: runtimeDb(join(t.dir, "old"), 2), guards: [] }, job([owner.recipient, drill.recipient], "20261103T013000Z"), store, join(t.dir, "x"));
    const live = runtimeDb(join(t.dir, "live"), 6);
    await snapshotShop({ name: "s", runtimeDb: live, guards: [] }, job([owner.recipient, drill.recipient], "20261104T013000Z"), store, join(t.dir, "x"));
    const r = await drillFromSnapshot({ name: "s", restored: join(t.dir, "scratch", "s", "agent.db"), live }, store, drill.identity);
    assert.equal(r.ok, true, r.detail);
    assert.equal(r.stamp, "20261104T013000Z");
    assert.match(r.detail, /^snapshot 20261104T013000Z: restored 6 entries, integrity ok, last entry #6 matches the live record/);
    const none = await drillFromSnapshot({ name: "other", restored: join(t.dir, "scratch", "o", "agent.db"), live }, store, drill.identity);
    assert.deepEqual([none.ok, none.detail], [false, "the newest snapshot could not be restored: there is no snapshot of other in the snapshot place yet"]);
    assert.equal((await drillFromSnapshot({ name: "s", restored: join(t.dir, "scratch", "w", "agent.db"), live }, store, generateIdentity().identity)).ok, false);
  } finally { t.done(); }
});

test("the restore job takes the newest snapshot at or before the time asked, checks it, and writes the database and the note the runtime reads at its start", async () => {
  const t = tmp(); try {
    const key = generateIdentity(); const store = folderStore(join(t.dir, "bucket"));
    for (const [stamp, n] of [["20261102T013000Z", 2], ["20261103T013000Z", 3], ["20261104T013000Z", 4]] as const) await snapshotShop({ name: "s", runtimeDb: runtimeDb(join(t.dir, stamp), n), guards: [] }, job([key.recipient], stamp), store, join(t.dir, "x"));
    writeFileSync(join(t.dir, "identity"), key.identity);
    const base = { target: { url: join(t.dir, "bucket") }, shop: "s", identityFile: join(t.dir, "identity"), nowIso: "2026-11-04T12:00:00.000Z" };
    const at = await runRestoreJob({ ...base, atMs: Date.parse("2026-11-03T20:00:00Z"), out: join(t.dir, "out1") }, store);
    assert.deepEqual([at.stamp, at.record.lastSeq], ["20261103T013000Z", 3]);
    assert.equal(recordFacts(new DatabaseSync(join(t.dir, "out1", "agent.db"), { readOnly: true })).lastSeq, 3);
    assert.deepEqual(JSON.parse(readFileSync(join(t.dir, "out1", "restored.json"), "utf8")), { snapshot: "20261103T013000Z", restoredAt: "2026-11-04T12:00:00.000Z", lastSeq: 3 });
    assert.equal((await runRestoreJob({ ...base, out: join(t.dir, "out2") }, store)).stamp, "20261104T013000Z", "no time: the newest");
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

test("`backup now` has each Guard make its own backup, then runs ONE snapshot container with the shops' volumes and the bucket key, encrypting to the owner's key and the drill key", async () => {
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
    let recipients: string[] = [];
    w.ctx.runner = fakeRunner((_c, args) => {
      if (args[0] === "run") {
        jobs.push(args);
        recipients = JSON.parse(readFileSync(args.find((a) => a.endsWith(":/job/job.json:ro"))!.split(":")[0], "utf8")).recipients;
        return ok(JSON.stringify({ stamp: "x", results: [{ name: "glow-salon", ok: true, stamp: "20261104T100000Z", files: 4, bytes: 999, record: { records: 3, lastSeq: 3, lastEntryDigest: "d" } }] }));
      }
      return ok(JSON.stringify({ status: 200, body: {} }));
    });
    const r = await runBackup(w.ctx);
    assert.equal(r.ok, true);
    assert.equal(jobs.length, 1);
    const flags = jobs[0].join(" ");
    assert.match(flags, /--cap-drop ALL/); assert.match(flags, /--network geometer-acme-vps-1_egress/); assert.match(flags, /-v .*\/\.\.\/|\/app:ro/);
    assert.match(flags, /geometer-acme-vps-1_rt-data-glow-salon:\/v\/rt-data-glow-salon/);
    assert.match(flags, /geometer-acme-vps-1_gs-glow-salon-razorpay:\/v\/gs-glow-salon-razorpay/);
    assert.match(flags, /:\/run\/secrets\/snapshots:ro/);
    assert.ok(!flags.includes("drill_identity"), "the snapshot job needs only the public halves");
    assert.ok(!jobs[0].some((a) => a.includes("SECRET2")), "the bucket key is a mounted file, never an argument");
    assert.equal(recipients.length, 2); assert.equal(recipients[0], owner.recipient);
    assert.match(readSecretFile(drillKeyFile(w.root))!, /^AGE-SECRET-KEY-1/);
    assert.equal(readStatus(w.root, "glow-salon")!.backups!.lastCopyAt, "2026-11-04T10:00:00.000Z");
    assert.equal(loadState(w.root).shops["glow-salon"].lastBackupAt, "2026-11-04T10:00:00.000Z");
  } finally { w.done(); }
});

test("a failed drill is written where the panel and `status` show it, with the reason; the drill container has the drill key and the bucket key, read-only", async () => {
  const w = world({ "glow-salon": undefined as never }, { backup: { snapshots: { url: "s3://snaps/a" }, ageRecipient: generateIdentity().recipient } });
  try {
    writeSecretFile(secretFile(w.root, "backup", "snapshots"), "A:B");
    writeFileSync(join(w.paths.shop("glow-salon"), "runtime.json"), JSON.stringify(panelRuntime()));
    w.handIn("glow-salon"); await deploy(w.ctx);
    const reason = "the newest snapshot could not be restored: there is no snapshot of glow-salon in the snapshot place yet";
    const runs: string[][] = [];
    w.ctx.runner = fakeRunner((_c, args) => { runs.push(args); return args.includes("/app/bundle/backup/drill-check.ts") ? ok(JSON.stringify({ results: [{ name: "glow-salon", ok: false, detail: reason }] })) : ok("{}"); });
    const r = await runDrill(w.ctx);
    assert.equal(r.ok, false);
    assert.equal(r.lines[0], `glow-salon: restore drill FAILED: ${reason}`);
    const flags = runs.find((a) => a.includes("/app/bundle/backup/drill-check.ts"))!.join(" ");
    assert.match(flags, /drill_identity:\/run\/secrets\/identity:ro/); assert.match(flags, /:\/run\/secrets\/snapshots:ro/); assert.match(flags, /--network geometer-acme-vps-1_egress/);
    const s = readStatus(w.root, "glow-salon")!.backups!;
    assert.deepEqual([s.drillOk, s.lastDrillAt, s.drillDetail], [false, "2026-11-04T10:00:00.000Z", reason]);
    assert.equal(loadState(w.root).shops["glow-salon"].lastDrill?.ok, false);
    // ... and from there to the heartbeat: the drill's time and verdict travel as an age and a flag, the reason stays on the server, and the shop is still ready
    const heartbeatAt = (iso: string) => buildHeartbeat({ deploymentId: "acme-vps-1", bundleVersion: "0.1.0", now: new Date(iso), baseline: {}, shops: [{ id: "glow-salon", pathway: "bookings", pathwayVersion: "0.1.0", up: true, ready: true, status: null, guards: [], backups: readBackups(w.paths.statusFile("glow-salon")) }] }).body;
    const agent = (heartbeatAt("2026-11-04T10:30:00.000Z").agents as Record<string, any>[])[0];
    assert.deepEqual(agent.drill, { age_s: 1800, ok: false });
    assert.equal(agent.backup_age_s, undefined, "no snapshot has been made on this server yet: nothing is sent, not 0");
    assert.equal(agent.runtime.ready, true);
    assert.doesNotMatch(JSON.stringify(heartbeatAt("2026-11-04T10:30:00.000Z")), /snapshot place|no snapshot/u);
    w.ctx.runner = fakeRunner(() => ok(JSON.stringify({ results: [{ name: "glow-salon", ok: true, detail: "snapshot 20261104T013000Z: restored 3 entries, integrity ok, last entry #3 matches the live record" }] })));
    assert.equal((await runDrill(w.ctx)).ok, true);
    assert.equal(readStatus(w.root, "glow-salon")!.backups!.drillOk, true);
  } finally { w.done(); }
});

test("`restore` fetches the snapshot while the shop runs, then stops only the runtime, swaps the file in as the runtime's user with the note beside it, and starts it", async () => {
  const w = world({ "glow-salon": undefined as never }, { backup: { snapshots: { url: "s3://snaps/a" }, ageRecipient: generateIdentity().recipient } });
  try {
    writeSecretFile(secretFile(w.root, "backup", "snapshots"), "A:B");
    writeFileSync(join(w.paths.shop("glow-salon"), "runtime.json"), JSON.stringify(panelRuntime()));
    w.handIn("glow-salon"); await deploy(w.ctx);
    const seen: string[][] = [];
    w.ctx.runner = fakeRunner((_c, args) => { seen.push(args); return args.includes("--job") ? ok(JSON.stringify({ ok: true, stamp: "20261104T013000Z", record: { records: 7, lastSeq: 7, lastEntryDigest: "d" } })) : ok(""); });
    const said = await restoreShop(w.ctx, "glow-salon", { at: "2026-11-04T09:00:00Z" });
    assert.match(said, /restored from the snapshot of 20261104T013000Z \(record up to entry #7\)/);
    assert.match(said, /moves its ids on, writes a "restored" entry, and looks at the payment service and the calendar before it sends anything again/);
    const order = seen.map((a) => (a.includes("--job") ? "fetch" : a.includes("stop") ? `stop ${a.at(-1)}` : a.includes("start") ? `start ${a.at(-1)}` : a.includes("busybox:1.37.0") ? "swap" : "other")).filter((x) => x !== "other");
    assert.deepEqual(order, ["fetch", "stop rt-glow-salon", "swap", "start rt-glow-salon"]);
    const fetch = seen.find((a) => a.includes("--job"))!;
    assert.match(fetch.join(" "), /drill_identity:\/run\/secrets\/identity:ro/);
    const swap = seen.find((a) => a.includes("busybox:1.37.0"))!;
    assert.deepEqual(swap.slice(swap.indexOf("--user"), swap.indexOf("--user") + 2), ["--user", "1000:1000"]);
    assert.match(swap.at(-1)!, /mv agent\.db agent\.db\.before-restore-20261104T100000Z.*cp \/in\/restored\.json restored\.json/);
    // the owner's key, for an old snapshot or a new server; a missing snapshot leaves the shop running and untouched
    writeFileSync(join(w.root, "owner-key"), "AGE-SECRET-KEY-1X");
    seen.length = 0;
    w.ctx.runner = fakeRunner((_c, args) => { seen.push(args); return args.includes("--job") ? { code: 1, stdout: JSON.stringify({ ok: false, error: "there is no snapshot of glow-salon from 2026-10-01T00:00:00.000Z or before" }), stderr: "" } : ok(""); });
    await assert.rejects(restoreShop(w.ctx, "glow-salon", { at: "2026-10-01T00:00:00Z", identity: join(w.root, "owner-key") }), /No snapshot was restored; the shop was not touched and is still running\. there is no snapshot of glow-salon from 2026-10-01/);
    assert.ok(seen.every((a) => !a.includes("stop")), "nothing was stopped");
    assert.match(seen[0].join(" "), /owner-key:\/run\/secrets\/identity:ro/);
    await assert.rejects(restoreShop(w.ctx, "glow-salon", { fromSnapshot: "x" }), /--from-snapshot is gone/);
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
