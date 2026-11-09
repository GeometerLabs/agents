// Backups of an agent someone else wrote (B51): its Guards' stores, its record (state/records/<agent>.json) and its key, in the nightly snapshot, the weekly drill and
// `restore`. The snapshot and the drill run against real files and a folder store; the host side runs on the fake machine (test/world.ts), with the restore job itself run
// for real against a real snapshot, so what `restore` puts back is what the snapshot held.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateIdentity } from "../backup/age.ts";
import { drillShop } from "../backup/drill-check.ts";
import { restoreAgent, restoreShop, runBackup, runDrill, sealFile } from "../backup/jobs.ts";
import { fetchAgentSnapshot, runAgentRestoreJob } from "../backup/restore-snapshot.ts";
import type { RestoreJob } from "../backup/restore-snapshot.ts";
import { snapshotAgent, snapshotShop } from "../backup/snapshot.ts";
import type { SnapshotJob } from "../backup/snapshot.ts";
import { folderStore } from "../backup/store.ts";
import { addAgent, deployAgent } from "../agent/deploy.ts";
import type { AgentFlags } from "../agent/folder.ts";
import { loadRecord, recordFile } from "../agent/records.ts";
import { runDueJobs } from "../apply.ts";
import { AGENT_LABEL_KEY_FILE, derivedKey, keyIdOf, personKeyFile, secretFile, writeSecretFile } from "../lib/secrets.ts";
import { loadState, saveState } from "../lib/state.ts";
import { readStatus } from "../lib/status.ts";
import { ok } from "../lib/runner.ts";
import type { RunResult } from "../lib/runner.ts";
import { CALENDAR_ID, PHONE_NUMBER_ID } from "./helpers.ts";
import { secretsFor, world } from "./world.ts";
import type { World } from "./world.ts";

const NOW = new Date("2026-11-05T09:00:00Z");
const STAMP = "20261104T013000Z";
const AGENT = "my-agent";
/** The order the deployed agent's Guards are in on the server (its state keeps them by kind), which is the order the jobs walk them. */
const ON_SERVER = ["calendar", "razorpay", "whatsapp"];
const flags: AgentFlags = { "owner-whatsapp": "+919800000001", deposit: "200", "refund-limit": "100", "whatsapp-number-id": PHONE_NUMBER_ID, "calendar-id": CALENDAR_ID };
const agentSecrets = (): Record<string, string> => { const s = secretsFor("x"); return { razorpay_key: s.razorpay_key, whatsapp_token: s.whatsapp_token, whatsapp_app_secret: s.whatsapp_app_secret, whatsapp_verify_token: s.whatsapp_verify_token, "google_service_account.json": s["google_service_account.json"] }; };
const tmp = () => { const dir = mkdtempSync(join(tmpdir(), "geo-agent-backup-")); return { dir, done: () => rmSync(dir, { recursive: true, force: true }) }; };
const job = (recipient: string, stamp = STAMP): SnapshotJob => ({ stamp, keepDays: 30, recipient, target: { url: "x" }, shops: [] });

/** An agent's record as the deployer writes it, with `n` entries. */
function recordText(n: number): string {
  const entries = Array.from({ length: n }, (_, k) => ({ seq: k + 1, time: `2026-11-04T0${k % 10}:00:00.000Z`, conversation: "agent", booking: "b-1", action: k % 2 ? "refund" : "create_deposit_link", inputsDigest: `k-${k}`, outcome: "confirmed", decisions: [], language: "en", notes: "", refs: {} }));
  return `${JSON.stringify({ schema: 1, entries, seen: Object.fromEntries(entries.map((e) => [`gd-${e.seq}`, { seq: e.seq, outcome: "confirmed" }])), marks: { razorpay: 1 } })}\n`;
}
/** A Guard's backup folder as Guard writes it (backup.json names the tenant). */
function guardBackup(dir: string, kind: string, tenant = AGENT): string {
  const g = join(dir, kind); mkdirSync(join(g, "evidence"), { recursive: true });
  writeFileSync(join(g, "state.db"), `${kind}-store`); writeFileSync(join(g, "evidence", "seg-1.jsonl"), `${kind}-ledger`);
  writeFileSync(join(g, "backup.json"), JSON.stringify({ format: "geo-guard-backup/1", tenant, files: [] }));
  return g;
}

test("the drill, without the key: an agent's objects read back, its record the start of the live record file, and the key the manifest holds is the one in use", async () => {
  const t = tmp(); try {
    const live = join(t.dir, "live.json"); writeFileSync(live, recordText(6));
    const atSnapshot = join(t.dir, "then.json"); writeFileSync(atSnapshot, recordText(4));
    const key = "cd".repeat(32); const keyFile = join(t.dir, "key"); writeFileSync(keyFile, key);
    const store = folderStore(join(t.dir, "bucket"));
    const r = await snapshotAgent({ name: AGENT, recordFile: atSnapshot, personKeyFile: keyFile, guards: [{ kind: "razorpay", dir: guardBackup(join(t.dir, "g"), "razorpay") }] }, job(generateIdentity().recipient), store);
    const good = await drillShop({ name: AGENT, live, ownAgent: true, seal: r.seal, keyId: keyIdOf(key) }, store);
    assert.equal(good.ok, true, good.detail);
    assert.equal(good.detail, `snapshot ${STAMP}: its 3 objects read back unchanged; a sound record of 4 entries (read and checked when it was made), the start of the live record (the chain matches at #4; 2 newer entries since); no fingerprint is published for an agent's record, so none was compared; its manifest holds the fingerprint key this server uses`);
    // the key: another on the server now, or none, fails the drill; a seal from before it named the key is only said
    assert.match((await drillShop({ name: AGENT, live, ownAgent: true, seal: r.seal, keyId: keyIdOf("ef".repeat(32)) }, store)).detail, /a fingerprint key other than the one this server uses/);
    assert.equal((await drillShop({ name: AGENT, live, ownAgent: true, seal: r.seal }, store)).ok, false, "the server has lost the key");
    const old = { ...r.seal!, keyId: undefined };
    const older = await drillShop({ name: AGENT, live, ownAgent: true, seal: old, keyId: keyIdOf(key) }, store);
    assert.deepEqual([older.ok, /its seal does not say which fingerprint key/.test(older.detail)], [true, true]);
    // the live record was changed under the snapshot's last entry: the digests differ
    const changed = JSON.parse(readFileSync(live, "utf8")); changed.entries[3].outcome = "failed"; writeFileSync(live, JSON.stringify(changed));
    assert.equal((await drillShop({ name: AGENT, live, ownAgent: true, seal: r.seal, keyId: keyIdOf(key) }, store)).detail, `snapshot ${STAMP}: the snapshot's last entry (#4) is not the live record's entry #4`);
    // an earlier entry rewritten: the last entries agree, the chains do not
    writeFileSync(live, recordText(6)); const early = JSON.parse(readFileSync(live, "utf8")); early.entries[1].outcome = "failed"; writeFileSync(live, JSON.stringify(early));
    assert.match((await drillShop({ name: AGENT, live, ownAgent: true, seal: r.seal }, store)).detail, /their hash chains differ before entry #4/);
    // the record file is gone from the server, but the snapshot has entries
    rmSync(live);
    assert.match((await drillShop({ name: AGENT, live, ownAgent: true, seal: r.seal }, store)).detail, /the live record is missing but the snapshot's has entries/);
    assert.match((await drillShop({ name: AGENT, live, ownAgent: true }, store)).detail, /no snapshot of this agent has been made yet/);
  } finally { t.done(); }
});

test("an agent's restore job fetches everything of the newest snapshot at or before the time, checks it, and writes the record, the key and each Guard's backup folder", async () => {
  const t = tmp(); try {
    const owner = generateIdentity(); const store = folderStore(join(t.dir, "bucket"));
    const keyFile = join(t.dir, "key"); writeFileSync(keyFile, "ab".repeat(32));
    for (const [stamp, n] of [["20261102T013000Z", 2], ["20261103T013000Z", 3], [STAMP, 5]] as const) {
      const f = join(t.dir, `r-${stamp}.json`); writeFileSync(f, recordText(n));
      await snapshotAgent({ name: AGENT, recordFile: f, personKeyFile: keyFile, guards: ["razorpay", "whatsapp", "calendar"].map((k) => ({ kind: k, dir: guardBackup(join(t.dir, `g-${stamp}`), k) })) }, job(owner.recipient, stamp), store);
    }
    writeFileSync(join(t.dir, "identity"), owner.identity);
    const base: RestoreJob = { target: { url: join(t.dir, "bucket") }, shop: AGENT, identityFile: join(t.dir, "identity"), out: join(t.dir, "out"), nowIso: "2026-11-04T12:00:00.000Z", ownAgent: true };
    const got = await runAgentRestoreJob({ ...base, atMs: Date.parse("2026-11-03T20:00:00Z") }, store);
    assert.deepEqual([got.stamp, got.record?.lastSeq, got.guards], ["20261103T013000Z", 3, ["calendar", "razorpay", "whatsapp"]]);
    assert.equal(readFileSync(join(t.dir, "out", "record.json"), "utf8"), recordText(3), "the record file, byte for byte");
    assert.equal(readFileSync(join(t.dir, "out", "person_key"), "utf8"), `${"ab".repeat(32)}\n`);
    assert.equal(readFileSync(join(t.dir, "out", "guard-razorpay", "evidence", "seg-1.jsonl"), "utf8"), "razorpay-ledger");
    assert.ok(!existsSync(join(t.dir, "out", "manifest.json")), "the manifest is read, not handed on");
    // a Guard folder of another tenant is refused before anything is stopped
    const other = folderStore(join(t.dir, "other"));
    const f = join(t.dir, "r.json"); writeFileSync(f, recordText(1));
    await snapshotAgent({ name: AGENT, recordFile: f, guards: [{ kind: "razorpay", dir: guardBackup(join(t.dir, "g-other"), "razorpay", "glow-salon") }] }, job(owner.recipient), other);
    await assert.rejects(fetchAgentSnapshot(other, AGENT, owner.identity), /the razorpay Guard's backup in the snapshot of 20261104T013000Z is not my-agent's \(it names glow-salon\)/);
    // a shop's snapshot under the name is not taken for an agent's
    const shops = folderStore(join(t.dir, "shops"));
    await snapshotShop({ name: AGENT, runtimeDb: join(t.dir, "none.db"), guards: [{ kind: "razorpay", dir: guardBackup(join(t.dir, "g-shop"), "razorpay") }] }, job(owner.recipient), shops, join(t.dir, "scratch"));
    await assert.rejects(fetchAgentSnapshot(shops, AGENT, owner.identity), /is not of an agent someone else wrote/);
    await assert.rejects(fetchAgentSnapshot(store, AGENT, generateIdentity().identity), /cannot be opened with this key/);
  } finally { t.done(); }
});

// ---- on the server: the snapshot job, the drill and `restore` ------------------------------------------------------------------------------------

/** A server with one deployed agent, its snapshots in a folder. */
async function agentServer(): Promise<{ w: World; owner: ReturnType<typeof generateIdentity>; bucket: string }> {
  const owner = generateIdentity();
  const bucketDir = mkdtempSync(join(tmpdir(), "geo-agent-bucket-"));
  const w = world({}, { backup: { snapshots: { url: bucketDir }, ageRecipient: owner.recipient } });
  addAgent(w.root, AGENT, flags, () => { throw new Error("no file"); }, NOW);
  w.handIn(AGENT, agentSecrets());
  await deployAgent(w.ctx, AGENT);
  return { w, owner, bucket: bucketDir };
}
const flagsOf = (w: World, script: string) => w.calls.find((c) => c.args.includes(script))?.args ?? [];

test("`backup now` takes an agent's Guards' own backups and its record in the same snapshot container, with the records folder read-only; its drill reads that folder", async () => {
  const { w, bucket } = await agentServer();
  try {
    w.admin.length = 0; w.calls.length = 0;
    const seal = { stamp: STAMP, objects: [{ key: `${AGENT}/${STAMP}/record.json.gz.age`, bytes: 9, sha256: "a".repeat(64) }], record: { records: 2, lastSeq: 2, lastEntryDigest: "d", head: "sha256:h" }, keyId: "0123456789abcdef" };
    let snapJob: { shops: unknown[]; agents: { name: string; recordFile: string; personKeyFile: string; guards: { kind: string; dir: string }[] }[] } | undefined;
    const base = w.ctx.runner;
    w.ctx.runner = { run: (command, args, o) => {
      if (args.includes("/app/bundle/backup/snapshot.ts")) {
        w.calls.push({ command, args });
        snapJob = JSON.parse(readFileSync(args.find((a) => a.endsWith(":/job/job.json:ro"))!.split(":")[0], "utf8"));
        return Promise.resolve(ok(JSON.stringify({ stamp: STAMP, results: [{ name: AGENT, ok: true, stamp: STAMP, files: 5, bytes: 999, record: seal.record, seal }] })));
      }
      return base.run(command, args, o);
    } };
    const r = await runBackup(w.ctx);
    assert.equal(r.ok, true, r.lines.join("\n"));
    assert.match(r.lines.join("\n"), new RegExp(`${AGENT}: snapshot ${STAMP} written \\(5 objects`));
    assert.deepEqual(w.admin.filter((a) => a.includes("/admin/backup")), ON_SERVER.map((k) => `g-${AGENT}-${k} POST /admin/backup`), "each of its Guards makes its own backup first");
    assert.deepEqual(snapJob!.shops, []);
    assert.deepEqual(snapJob!.agents.map((a) => [a.name, a.recordFile, a.personKeyFile, a.guards.map((g) => g.dir)]), [[AGENT, `/run/records/${AGENT}.json`, `/run/person-keys/${AGENT}`, ON_SERVER.map((k) => `/v/gs-${AGENT}-${k}/backups/20261104T100000Z`)]]);
    const flags = flagsOf(w, "/app/bundle/backup/snapshot.ts").join(" ");
    for (const k of ["razorpay", "whatsapp", "calendar"]) assert.match(flags, new RegExp(`geometer-acme-vps-1_gs-${AGENT}-${k}:/v/gs-${AGENT}-${k}`));
    assert.match(flags, /\/state\/records:\/run\/records:ro/, "the records FOLDER, read-only");
    assert.ok(existsSync(join(w.paths.state, "records")) && !existsSync(join(w.paths.state, "records", `${AGENT}.json`)), "the folder is made first, so no mount makes a directory where the record file will be");
    assert.match(flags, new RegExp(`${bucket}:${bucket}`), "a folder snapshot place is mounted as itself");
    assert.ok(!flags.includes("identity"), "no key that opens a snapshot is on the server or in the job");
    assert.deepEqual(JSON.parse(readFileSync(sealFile(w.root, AGENT), "utf8")), seal);
    assert.equal(loadState(w.root).agents![AGENT].lastBackupAt, "2026-11-04T10:00:00.000Z");
    assert.equal(readStatus(w.root, AGENT)!.backups!.lastCopyAt, loadState(w.root).agents![AGENT].lastBackupAt);
    // the drill: the record file as the live record, the key's id (never the key), and the verdict where `status` and the heartbeat read it
    let drillJob: { shops: { name: string; live: string; ownAgent?: boolean; keyId?: string }[] } | undefined;
    w.ctx.runner = { run: (command, args, o) => {
      if (args.includes("/app/bundle/backup/drill-check.ts")) { w.calls.push({ command, args }); drillJob = JSON.parse(readFileSync(args.find((a) => a.endsWith(":/job/job.json:ro"))!.split(":")[0], "utf8")); return Promise.resolve(ok(JSON.stringify({ results: [{ name: AGENT, ok: false, detail: "snapshot x: the live record is missing but the snapshot's has entries" }] }))); }
      return base.run(command, args, o);
    } };
    const d = await runDrill(w.ctx);
    assert.equal(d.ok, false);
    const key = readFileSync(personKeyFile(w.root, AGENT), "utf8").trim();
    assert.deepEqual(drillJob!.shops.map((s) => [s.name, s.live, s.ownAgent, s.keyId]), [[AGENT, `/run/records/${AGENT}.json`, true, keyIdOf(key)]]);
    assert.ok(!JSON.stringify(drillJob).includes(key), "the drill is never handed the key");
    assert.match(flagsOf(w, "/app/bundle/backup/drill-check.ts").join(" "), /\/state\/records:\/run\/records:ro/);
    assert.deepEqual([loadState(w.root).agents![AGENT].lastDrill?.ok, readStatus(w.root, AGENT)!.backups!.drillOk], [false, false]);
  } finally { w.done(); rmSync(bucket, { recursive: true, force: true }); }
});

test("a server with only an agent someone else wrote still takes the nightly snapshot and the weekly drill", async () => {
  const { w, bucket } = await agentServer();
  try {
    const scripts: string[] = [];
    const base = w.ctx.runner;
    // 4 am on this computer's clock: the deployer takes the snapshot after 2 and the drill after 3, local time
    const ctx = { ...w.ctx, now: () => new Date(2026, 10, 5, 4, 0), runner: { run: (command: string, args: string[], o?: Parameters<typeof base.run>[2]) => {
      const s = args.find((a) => a.startsWith("/app/bundle/backup/"));
      if (s) { scripts.push(s); return Promise.resolve(ok(JSON.stringify({ stamp: STAMP, results: [] }))); }
      return base.run(command, args, o);
    } } };
    const ran = await runDueJobs(ctx);
    assert.ok(ran.includes("snapshot") && ran.some((r) => r.startsWith("drill")), ran.join(", "));
    assert.ok(!ran.includes("exports") && !ran.some((r) => r.startsWith("fingerprints")), "the exports and fingerprints are a shop runtime's: none here");
    assert.ok(scripts.includes("/app/bundle/backup/snapshot.ts"));
  } finally { w.done(); rmSync(bucket, { recursive: true, force: true }); }
});

/** The fake machine, with the restore job run FOR REAL against the bucket (a folder), and Guard's own restore answered as Guard does. */
function restoringRunner(w: World, bucket: string, identityFile: string, o: { failTrial?: string } = {}) {
  const seen: string[] = [];
  const base = w.ctx.runner;
  w.ctx.runner = { run: async (command, args, opts): Promise<RunResult> => {
    if (args.includes("/app/bundle/backup/restore-snapshot.ts")) {
      seen.push("fetch");
      const work = args.find((a) => a.endsWith(":/out"))!.slice(0, -":/out".length);
      const j = JSON.parse(readFileSync(join(work, "job.json"), "utf8")) as RestoreJob;
      try { return ok(JSON.stringify(await runAgentRestoreJob({ ...j, identityFile, out: join(work, "files") }, folderStore(bucket)))); } catch (e) { return { code: 1, stdout: JSON.stringify({ ok: false, error: (e as Error).message }), stderr: "" }; }
    }
    const c = args.indexOf("compose") === 0 ? args.slice(args.indexOf("--project-directory") + 2) : [];
    if (c[0] === "run" && c.includes("restore")) {
      const service = c[c.indexOf("restore") - 1];
      const trial = c.includes("/trial/guard.toml");
      if (trial) {
        const dir = c.find((a) => a.endsWith(":/trial"))!.slice(0, -":/trial".length);
        const toml = readFileSync(join(dir, "guard.toml"), "utf8");
        assert.match(toml, /^state = "\/trial\/scratch\/state\.db"$/mu); assert.match(toml, /^admin_listen = "127\.0\.0\.1:65534"$/mu);
        assert.ok(existsSync(join(c.find((a) => a.endsWith(":/in:ro"))!.slice(0, -":/in:ro".length), "backup.json")), "the Guard's folder from the snapshot");
      }
      seen.push(`${trial ? "try" : "restore"} ${service}`);
      if (trial && o.failTrial === service) return { code: 1, stdout: "", stderr: "refused: the restored store does not open: schema 9 is newer than this Guard knows" };
      return ok(JSON.stringify({ verification: { result: "VERIFIED" } }));
    }
    if (c[0] === "stop" || c[0] === "start") seen.push(`${c[0]} ${c.slice(1).join(" ")}`);
    return base.run(command, args, opts);
  } };
  return seen;
}

test("`restore <agent>` checks and tries everything while the agent runs, then stops only its Guards, puts back their stores, its record and its key, and starts them", async () => {
  const { w, owner, bucket } = await agentServer();
  try {
    // last night's snapshot, made by the real snapshot code from this server's own files: the record, the key, and each Guard's backup
    const key = readFileSync(personKeyFile(w.root, AGENT), "utf8").trim();
    const nightly = join(w.root, "nightly.json"); writeFileSync(nightly, recordText(3));
    const guardsAt = join(w.root, "guard-backups");
    await snapshotAgent({ name: AGENT, recordFile: nightly, personKeyFile: personKeyFile(w.root, AGENT), guards: ["razorpay", "whatsapp", "calendar"].map((k) => ({ kind: k, dir: guardBackup(guardsAt, k) })) }, job(owner.recipient), folderStore(bucket));
    // since then: the live record went on to 5 entries, and on this server another key was made (as a new machine's first deploy would)
    mkdirSync(join(w.paths.state, "records"), { recursive: true }); writeFileSync(recordFile(w.root, AGENT), recordText(5));
    writeSecretFile(personKeyFile(w.root, AGENT), "ef".repeat(32), 0o600);
    const identityFile = join(w.root, "owner-key"); writeFileSync(identityFile, owner.identity);
    // without the owner's key nothing is run
    const seen = restoringRunner(w, bucket, identityFile);
    await assert.rejects(restoreAgent(w.ctx, AGENT, {}), /opens only with the owner's age key/);
    assert.deepEqual(seen, []);
    w.admin.length = 0;
    const said = await restoreAgent(w.ctx, AGENT, { identity: identityFile });
    const guards = ON_SERVER.map((k) => `g-${AGENT}-${k}`);
    assert.deepEqual(seen, ["fetch", ...guards.map((g) => `try ${g}`), `stop ${guards.join(" ")}`, ...guards.map((g) => `restore ${g}`), `start ${guards.join(" ")}`]);
    assert.match(said, new RegExp(`^${AGENT} is restored from the snapshot of ${STAMP}: its calendar, razorpay, whatsapp Guards' stores .*, its record \\(up to entry #3\\) and its key\\.`));
    assert.match(said, /What happened after the snapshot is in none of them: calls the agent made after it are not in the Guards or the record/);
    assert.match(said, /The record had 5 entries; the next ones are numbered from #5 again/);
    // the record: the snapshot's three entries as they were, then a `restored` entry; the one it replaced is kept beside it
    const record = loadRecord(w.root, AGENT);
    assert.deepEqual(record.entries.slice(0, 3), JSON.parse(recordText(3)).entries);
    assert.deepEqual([record.entries[3].seq, record.entries[3].action, record.entries[3].refs.snapshot], [4, "restored", STAMP]);
    assert.equal(readFileSync(`${recordFile(w.root, AGENT)}.before-restore-20261104T100000Z`, "utf8"), recordText(5));
    // the key: the snapshot's back in place, the new one kept beside, and the label key made again from the snapshot's
    assert.equal(readFileSync(personKeyFile(w.root, AGENT), "utf8").trim(), key);
    assert.equal(readFileSync(`${personKeyFile(w.root, AGENT)}.before-restore-20261104T100000Z`, "utf8").trim(), "ef".repeat(32));
    assert.equal(readFileSync(secretFile(w.root, "ops", AGENT, AGENT_LABEL_KEY_FILE), "utf8").trim(), derivedKey(key, "label"));
    assert.ok(!existsSync(secretFile(w.root, `rt-${AGENT}`)), "no runtime copy is made for an agent");
    // what the snapshot cannot hold: the relay's reading credential is renewed; nothing is stopped that was not
    assert.ok(w.calls.some((c) => c.args.includes("issue-approver") && c.args.includes(AGENT)), "the relay's credential, renewed");
    assert.ok(!w.admin.some((a) => a.startsWith("stop")), "the agent was not stopped, so its kill switch is left alone");
    assert.deepEqual(readdirSync(join(w.paths.state, "work")).filter((n) => n.startsWith("restore-")), [], "the opened snapshot is not left on the server");
  } finally { w.done(); rmSync(bucket, { recursive: true, force: true }); }
});

test("`restore <agent>` refuses, with nothing stopped, when the Guard image it is pinned to cannot take the snapshot's store; a stopped agent stays stopped after a restore", async () => {
  const { w, owner, bucket } = await agentServer();
  try {
    const f = join(w.root, "n.json"); writeFileSync(f, recordText(2));
    await snapshotAgent({ name: AGENT, recordFile: f, personKeyFile: personKeyFile(w.root, AGENT), guards: ["razorpay", "whatsapp", "calendar"].map((k) => ({ kind: k, dir: guardBackup(join(w.root, "gb"), k) })) }, job(owner.recipient), folderStore(bucket));
    const identityFile = join(w.root, "owner-key"); writeFileSync(identityFile, owner.identity);
    const seen = restoringRunner(w, bucket, identityFile, { failTrial: `g-${AGENT}-whatsapp` });
    await assert.rejects(restoreAgent(w.ctx, AGENT, { identity: identityFile }), /No snapshot was restored; my-agent was not touched and its Guards still run\. The whatsapp Guard's backup could not be restored by the Guard image my-agent runs .*schema 9 is newer than this Guard knows.*restore again/su);
    assert.ok(!seen.some((s) => s.startsWith("stop") || s.startsWith("restore")), seen.join(", "));
    assert.ok(!existsSync(recordFile(w.root, AGENT)), "the record was not touched");
    // a shop's restore is not an agent's: the name decides, and a shop's `restore` does not take an agent
    await assert.rejects(restoreShop(w.ctx, AGENT, { identity: identityFile }), /has not been deployed/);
    // an agent stopped on this server is stopped again after its Guards' stores come back
    const s = loadState(w.root); s.agents![AGENT].stopped = { by: "asha@example.com", at: "2026-11-04T09:00:00Z", reason: "owner asked" }; saveState(w.root, s);
    const again = restoringRunner(w, bucket, identityFile);
    w.admin.length = 0;
    await restoreAgent(w.ctx, AGENT, { identity: identityFile });
    assert.ok(again.includes(`start g-${AGENT}-calendar g-${AGENT}-razorpay g-${AGENT}-whatsapp`));
    assert.ok(w.admin.some((a) => a === `stop ${AGENT} on - owner asked`), w.admin.join(" | "));
  } finally { w.done(); rmSync(bucket, { recursive: true, force: true }); }
});

test("a restored Guard that kept the policy in its store (a newer version than the one deployed here) is deployed again over it", async () => {
  const { w, owner, bucket } = await agentServer();
  try {
    const f = join(w.root, "n.json"); writeFileSync(f, recordText(1));
    await snapshotAgent({ name: AGENT, recordFile: f, personKeyFile: personKeyFile(w.root, AGENT), guards: [{ kind: "razorpay", dir: guardBackup(join(w.root, "gb"), "razorpay") }] }, job(owner.recipient), folderStore(bucket));
    const identityFile = join(w.root, "owner-key"); writeFileSync(identityFile, owner.identity);
    restoringRunner(w, bucket, identityFile);
    const before = loadState(w.root).agents![AGENT].guards.razorpay;
    // the restored store's policy answers, until the deploy that follows brings the deployed one in at a higher version
    w.runningDigest.set(`g-${AGENT}-razorpay`, "sha256:from-the-snapshot");
    const base = w.ctx.runner;
    w.ctx.runner = { run: (command, args, o) => { if (args[0] === "compose" && args.includes("up")) w.runningDigest.clear(); return base.run(command, args, o); } };
    const said = await restoreAgent(w.ctx, AGENT, { identity: identityFile });
    assert.match(said, /The snapshot holds no backup of the whatsapp Guard .* keeps the store it has/);
    assert.match(said, /The razorpay Guard kept the policy in its restored store, so my-agent was deployed again over it: 12 of 12 limits proven to bite/);
    assert.equal(loadState(w.root).agents![AGENT].guards.razorpay.version, before.version + 1);
  } finally { w.done(); rmSync(bucket, { recursive: true, force: true }); }
});
