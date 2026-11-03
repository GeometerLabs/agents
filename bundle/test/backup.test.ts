// The data duties against real SQLite and the folder store: a nightly snapshot is consistent, encrypted, complete and pruned at 30 days; the drill tells a good
// copy from a bad one; the host side runs the right containers with the right mounts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { decrypt, generateIdentity } from "../backup/age.ts";
import { restoreSnapshot } from "../backup/restore-snapshot.ts";
import { drillShop } from "../backup/drill-check.ts";
import { runBackup, runDrill } from "../backup/jobs.ts";
import { recordFacts, snapshotShop } from "../backup/snapshot.ts";
import type { SnapshotJob } from "../backup/snapshot.ts";
import { folderStore } from "../backup/store.ts";
import { litestreamConfig } from "../generate/litestream.ts";
import { openStore } from "../../pathways/bookings/server/store.ts";
import { deploy } from "../deploy.ts";
import { loadState } from "../lib/state.ts";
import { readStatus } from "../lib/status.ts";
import { writeSecretFile, secretFile } from "../lib/secrets.ts";
import { fakeRunner, ok } from "../lib/runner.ts";
import { world } from "./world.ts";

const tmp = () => { const dir = mkdtempSync(join(tmpdir(), "geo-backup-")); return { dir, done: () => rmSync(dir, { recursive: true, force: true }) }; };

/** A runtime database as the runtime itself makes it (WAL, the record table with its append-only triggers), with some entries. */
function runtimeDb(dir: string, entries: number): string {
  const store = openStore(dir);
  for (let i = 1; i <= entries; i++) store.commitStep({ snapshot: "{}", entries: [{ seq: i, time: "2026-11-04T10:00:00Z", conversation: "c", booking: "b-1", action: "a", outcome: "confirmed" } as never], nowMs: Date.now() });
  store.close();
  return join(dir, "agent.db");
}
const sha = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");

test("a snapshot is a consistent copy, encrypted to the recipient, with a manifest that says what the record held; the plain database is not in the bucket", async () => {
  const t = tmp(); try {
    const db = runtimeDb(join(t.dir, "rt"), 5);
    const guardBackup = join(t.dir, "gs", "backups", "20261104T013000Z"); mkdirSync(join(guardBackup, "evidence"), { recursive: true });
    writeFileSync(join(guardBackup, "state.db"), "guard-state-bytes"); writeFileSync(join(guardBackup, "evidence", "ledger.log"), "ledger");
    const key = generateIdentity();
    const job: SnapshotJob = { stamp: "20261104T013000Z", keepDays: 30, recipient: key.recipient, target: { url: join(t.dir, "bucket") }, shops: [] };
    const store = folderStore(join(t.dir, "bucket"));
    const r = await snapshotShop({ name: "glow-salon", runtimeDb: db, guards: [{ kind: "razorpay", dir: guardBackup }] }, job, store, join(t.dir, "scratch"));
    assert.deepEqual([r.ok, r.record?.records, r.record?.lastSeq, r.files], [true, 5, 5, 4]);
    const keys = (await store.list("glow-salon/")).map((o) => o.key).sort();
    assert.deepEqual(keys, ["glow-salon/20261104T013000Z/guard-razorpay/evidence/ledger.log.age", "glow-salon/20261104T013000Z/guard-razorpay/state.db.age", "glow-salon/20261104T013000Z/manifest.json.age", "glow-salon/20261104T013000Z/runtime/agent.db.age"]);
    for (const k of keys) assert.ok((await store.get(k))!.toString("latin1").startsWith("age-encryption.org/v1"), k);
    // opened with the identity, the copy is a good database with the same record
    const restored = join(t.dir, "restored.db"); writeFileSync(restored, decrypt((await store.get("glow-salon/20261104T013000Z/runtime/agent.db.age"))!, key.identity));
    const copy = new DatabaseSync(restored, { readOnly: true });
    assert.deepEqual(recordFacts(copy), recordFacts(new DatabaseSync(db, { readOnly: true })));
    assert.equal((copy.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check, "ok");
    const manifest = JSON.parse(decrypt((await store.get("glow-salon/20261104T013000Z/manifest.json.age"))!, key.identity).toString());
    assert.equal(manifest.runtime.lastSeq, 5);
    assert.equal(manifest.files.find((f: { key: string }) => f.key.endsWith("state.db.age")).sha256, sha("guard-state-bytes"));
    assert.ok(!existsSync(guardBackup), "Guard's staging copy is removed once shipped");
    assert.ok(!existsSync(join(t.dir, "scratch", "glow-salon.db")), "no plain copy is left behind");
  } finally { t.done(); }
});

test("a downloaded snapshot is opened with the identity into an empty folder, and the database in it is the one that was copied", async () => {
  const t = tmp(); try {
    const db = runtimeDb(join(t.dir, "rt"), 4);
    const key = generateIdentity(); const store = folderStore(join(t.dir, "bucket"));
    await snapshotShop({ name: "s", runtimeDb: db, guards: [] }, { stamp: "20261104T013000Z", keepDays: 30, recipient: key.recipient, target: { url: "x" }, shops: [] }, store, join(t.dir, "scratch"));
    const files = restoreSnapshot(join(t.dir, "bucket", "s", "20261104T013000Z"), key.identity, join(t.dir, "open"));
    assert.deepEqual(files.map((f) => f.slice(join(t.dir, "open").length + 1)).sort(), ["manifest.json", "runtime/agent.db"]);
    assert.equal(recordFacts(new DatabaseSync(join(t.dir, "open", "runtime", "agent.db"), { readOnly: true })).lastSeq, 4);
    assert.throws(() => restoreSnapshot(join(t.dir, "bucket", "s", "20261104T013000Z"), key.identity, join(t.dir, "open")), /is not empty/);
    assert.throws(() => restoreSnapshot(join(t.dir, "bucket", "s", "20261104T013000Z"), generateIdentity().identity, join(t.dir, "other")), /cannot open/);
  } finally { t.done(); }
});

test("snapshots older than the keep period are deleted, newer ones kept, and a shop with nothing to copy says so", async () => {
  const t = tmp(); try {
    const db = runtimeDb(join(t.dir, "rt"), 1);
    const key = generateIdentity(); const store = folderStore(join(t.dir, "bucket"));
    for (const stamp of ["20261001T013000Z", "20261010T013000Z", "20261103T013000Z"]) await store.put(`glow-salon/${stamp}/manifest.json.age`, Buffer.from("x"));
    const job: SnapshotJob = { stamp: "20261104T013000Z", keepDays: 30, recipient: key.recipient, target: { url: "x" }, shops: [] };
    await snapshotShop({ name: "glow-salon", runtimeDb: db, guards: [] }, job, store, join(t.dir, "s"));
    const left = new Set((await store.list("glow-salon/")).map((o) => o.key.split("/")[1]));
    assert.deepEqual([...left].sort(), ["20261010T013000Z", "20261103T013000Z", "20261104T013000Z"], "Oct 1 is 34 days old, Oct 10 is 25");
    const none = await snapshotShop({ name: "new-shop", runtimeDb: join(t.dir, "absent.db"), guards: [] }, job, store, join(t.dir, "s"));
    assert.equal(none.ok, false); assert.match(none.error!, /nothing to copy/);
  } finally { t.done(); }
});

test("the drill passes a good copy and says exactly what is wrong with a bad one", () => {
  const t = tmp(); try {
    const live = runtimeDb(join(t.dir, "live"), 10);
    const copyOf = (name: string, entries: number) => runtimeDb(join(t.dir, name), entries);
    assert.deepEqual(drillShop({ name: "s", restored: copyOf("a", 10), live }, 100), { name: "s", ok: true, detail: "restored 10 entries, integrity ok, last entry #10 matches the live record" });
    const behind = drillShop({ name: "s", restored: copyOf("b", 8), live }, 100);
    assert.equal(behind.ok, true); assert.match(behind.detail, /2 newer entries not yet copied/);
    assert.match(drillShop({ name: "s", restored: copyOf("c", 8), live }, 1).detail, /2 entries behind the live record \(more than 1\)/);
    const different = runtimeDb(join(t.dir, "d"), 10);
    const d = new DatabaseSync(different); d.exec("DROP TRIGGER record_no_update; UPDATE record SET entry = 'tampered' WHERE seq = 10"); d.close();
    const wrong = drillShop({ name: "s", restored: different, live }, 100);
    assert.equal(wrong.ok, false); assert.match(wrong.detail, /last entry \(#10\) is not the live record's entry #10/);
    assert.match(drillShop({ name: "s", restored: join(t.dir, "missing.db"), live }, 100).detail, /nothing was restored/);
    writeFileSync(join(t.dir, "junk.db"), "not a database at all, just text, long enough to look like a file".repeat(100));
    assert.equal(drillShop({ name: "s", restored: join(t.dir, "junk.db"), live }, 100).ok, false);
    assert.equal(drillShop({ name: "s", restored: copyOf("e", 0), live }, 100).ok, false, "an empty copy of a live record is a failure");
  } finally { t.done(); }
});

test("Litestream streams only the runtime databases, one replica per shop, with the bucket's key in the config (which is a secret file, not a generated one)", () => {
  const yml = litestreamConfig({ stream: { url: "s3://geo-stream/acme", endpoint: "http://minio:9000", region: "ap-south-1" }, snapshots: { url: "s3://geo-snaps" }, ageRecipient: "age1" + "q".repeat(58) }, ["glow-salon", "bright-tuition"], { accessKeyId: "AKID", secretAccessKey: "SECRET" });
  assert.match(yml, /- path: "\/data\/glow-salon\/data\/agent\.db"\n    replica:\n      url: "s3:\/\/geo-stream\/acme\/glow-salon"\n      endpoint: "http:\/\/minio:9000"/);
  assert.equal(yml.match(/path:/gu)!.length, 2);
  assert.ok(!/state\.db|geo-guard/.test(yml), "no Guard store is streamed");
});

test("the runtime never checkpoints by hand: Litestream owns checkpointing of what it streams", () => {
  const source = readFileSync(new URL("../../pathways/bookings/server/store.ts", import.meta.url), "utf8");
  const code = source.replace(/\/\/.*$/gmu, "");
  assert.ok(!/wal_checkpoint|wal_autocheckpoint/iu.test(code), "store.ts checkpoints by hand");
  assert.deepEqual([...code.matchAll(/journal_mode\s*=\s*(\w+)/gu)].map((m) => m[1]), ["WAL"], "the only journal mode it sets is WAL");
  assert.match(source, /PRAGMA journal_mode = WAL/);
  assert.match(source, /PRAGMA busy_timeout = 5000/);
});

test("`backup now` has each Guard make its own backup, then runs ONE snapshot container with the shops' volumes and the bucket key, and records the time", async () => {
  const w = world({ "glow-salon": undefined as never }, { backup: { stream: { url: "s3://stream/a", endpoint: "http://minio:9000" }, snapshots: { url: "s3://snaps/a", endpoint: "http://minio:9000" }, ageRecipient: generateIdentity().recipient } });
  try {
    (await import("../lib/secrets.ts")).writeSecretFile(secretFile(w.root, "backup", "stream"), "AKID:SECRET"); writeSecretFile(secretFile(w.root, "backup", "snapshots"), "AKID2:SECRET2");
    // reuse the standard shop
    const { panelRuntime } = await import("./helpers.ts");
    writeFileSync(join(w.paths.shop("glow-salon"), "runtime.json"), JSON.stringify(panelRuntime()));
    w.handIn("glow-salon");
    await deploy(w.ctx);
    assert.ok(existsSync(secretFile(w.root, "litestream", "litestream.yml")));
    w.admin.length = 0; w.calls.length = 0;
    const jobs: string[][] = [];
    w.ctx.runner = fakeRunner((_c, args) => {
      if (args[0] === "run") { jobs.push(args); return ok(JSON.stringify({ stamp: "x", results: [{ name: "glow-salon", ok: true, stamp: "20261104T100000Z", files: 4, bytes: 999, record: { records: 3, lastSeq: 3, lastEntryDigest: "d" } }] })); }
      return ok(JSON.stringify({ status: 200, body: {} }));
    });
    const r = await runBackup(w.ctx);
    assert.equal(r.ok, true);
    assert.deepEqual(w.admin, [], "(the fake runner above answers the backup calls)");
    assert.equal(jobs.length, 1);
    const flags = jobs[0].join(" ");
    assert.match(flags, /--cap-drop ALL/); assert.match(flags, /--network geometer-acme-vps-1_egress/); assert.match(flags, /-v .*\/\.\.\/|\/app:ro/);
    assert.match(flags, /geometer-acme-vps-1_rt-data-glow-salon:\/v\/rt-data-glow-salon/);
    assert.match(flags, /geometer-acme-vps-1_gs-glow-salon-razorpay:\/v\/gs-glow-salon-razorpay/);
    assert.match(flags, /:\/run\/secrets\/snapshots:ro/);
    assert.ok(!jobs[0].some((a) => a.includes("SECRET2")), "the bucket key is a mounted file, never an argument");
    assert.equal(readStatus(w.root, "glow-salon")!.backups!.lastCopyAt, "2026-11-04T10:00:00.000Z");
    assert.equal(loadState(w.root).shops["glow-salon"].lastBackupAt, "2026-11-04T10:00:00.000Z");
  } finally { w.done(); }
});

test("a failed drill is written where the panel and `status` show it, with the reason", async () => {
  const w = world({ "glow-salon": undefined as never }, { backup: { stream: { url: "s3://stream/a" }, snapshots: { url: "s3://snaps/a" }, ageRecipient: generateIdentity().recipient } });
  try {
    const { panelRuntime } = await import("./helpers.ts");
    writeSecretFile(secretFile(w.root, "backup", "stream"), "A:B"); writeSecretFile(secretFile(w.root, "backup", "snapshots"), "A:B");
    writeFileSync(join(w.paths.shop("glow-salon"), "runtime.json"), JSON.stringify(panelRuntime()));
    w.handIn("glow-salon"); await deploy(w.ctx);
    w.ctx.runner = fakeRunner((_c, args) => (args.includes("restore") ? { code: 1, stdout: "", stderr: "litestream: no snapshots found" } : ok("{}")));
    const r = await runDrill(w.ctx);
    assert.equal(r.ok, false);
    assert.match(r.lines[0], /glow-salon: restore drill FAILED: the continuous copy could not be restored: litestream: no snapshots found/);
    const s = readStatus(w.root, "glow-salon")!.backups!;
    assert.deepEqual([s.drillOk, s.lastDrillAt, s.drillDetail], [false, "2026-11-04T10:00:00.000Z", "the continuous copy could not be restored: litestream: no snapshots found"]);
    assert.equal(loadState(w.root).shops["glow-salon"].lastDrill?.ok, false);
    w.ctx.runner = fakeRunner((_c, args) => args.includes("restore") ? ok() : ok(JSON.stringify({ results: [{ name: "glow-salon", ok: true, detail: "restored 3 entries, integrity ok, last entry #3 matches the live record" }] })));
    assert.equal((await runDrill(w.ctx)).ok, true);
    assert.equal(readStatus(w.root, "glow-salon")!.backups!.drillOk, true);
  } finally { w.done(); }
});
