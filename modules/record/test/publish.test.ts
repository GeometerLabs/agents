import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { generateKeyPairSync } from "node:crypto";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RecordEntry } from "../record.ts";
import { anchorOf, ledgerEntries } from "../ledger.ts";
import { lastPublished, publishFingerprint, readFingerprints } from "../publish.ts";
import type { Runner } from "../publish.ts";

const t0 = Date.UTC(2026, 10, 3, 4, 30);
const entry = (seq: number, outcome: RecordEntry["outcome"] = "confirmed"): RecordEntry => ({ seq, time: new Date(t0 + seq * 60_000).toISOString(), conversation: "+919800000001", booking: "b-1", action: "send_message", inputsDigest: "0123456789abcdef", outcome, decisions: [], language: "en", notes: "", refs: {} });
const ledgerOf = (n: number, tenant = "glow-salon") => ledgerEntries(Array.from({ length: n }, (_, i) => entry(i + 1)), tenant);
const scratch = () => mkdtempSync(join(tmpdir(), "geo-publish-"));
const git: Runner = (command, args, { cwd }) => { const r = spawnSync(command, args, { cwd, encoding: "utf8" }); return { code: r.status ?? -1, stdout: r.stdout, stderr: r.stderr }; };

test("one line a day, chained to the line before it; the shop's data is never in it", async () => {
  const dir = scratch();
  try {
    const file = join(dir, "glow-salon.jsonl");
    const a = await publishFingerprint({ file, ledger: ledgerOf(3), day: "2026-11-03", now: t0 });
    assert.equal(a.local, "written");
    assert.deepEqual(a.targets, { git: "off", opentimestamps: "off" });
    const again = await publishFingerprint({ file, ledger: ledgerOf(4), day: "2026-11-03", now: t0 + 1000 });
    assert.equal(again.local, "same-day");
    const b = await publishFingerprint({ file, ledger: ledgerOf(5), day: "2026-11-04", now: t0 + 86_400_000 });
    assert.equal(b.local, "written");
    const lines = readFingerprints(file);
    assert.equal(lines.length, 2);
    assert.equal(lines[0].prev, null);
    assert.match(lines[1].prev!, /^sha256:[0-9a-f]{64}$/);
    assert.equal(lastPublished(file, "glow-salon")!.seq, 5);
    const text = readFileSync(file, "utf8");
    assert.equal(/\+91|send_message|0123456789abcdef/.test(text), false, "only the head, the count and the day: never an entry");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a record changed or cut after its fingerprint was published is refused with an alert, and nothing is written", async () => {
  const dir = scratch();
  try {
    const file = join(dir, "glow-salon.jsonl");
    await publishFingerprint({ file, ledger: ledgerOf(4), day: "2026-11-03", now: t0 });
    const rewritten = ledgerEntries([entry(1), entry(2, "failed"), entry(3), entry(4), entry(5)], "glow-salon");
    const r = await publishFingerprint({ file, ledger: rewritten, day: "2026-11-04", now: t0 });
    assert.equal(r.local, "refused");
    assert.match(r.alert!, /changed after it was published/);
    const cut = await publishFingerprint({ file, ledger: ledgerOf(2), day: "2026-11-04", now: t0 });
    assert.equal(cut.local, "refused");
    assert.match(cut.alert!, /fewer than the 4 published/);
    assert.equal(readFingerprints(file).length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a fingerprint file edited by hand, or with a line taken out, is refused when it is read", async () => {
  const dir = scratch();
  try {
    const file = join(dir, "f.jsonl");
    for (const [n, day] of [[2, "2026-11-01"], [3, "2026-11-02"], [4, "2026-11-03"]] as const) await publishFingerprint({ file, ledger: ledgerOf(n), day, now: t0 });
    const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
    writeFileSync(file, `${lines[0]}\n${lines[2]}\n`);
    assert.throws(() => readFingerprints(file), /changed or a line was removed/);
    writeFileSync(file, `${lines[0].replace("\"seq\":2", "\"seq\":9")}\n`);
    assert.throws(() => readFingerprints(file), /changed or a line was removed|changed by hand/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the line can carry the signed anchor, so anyone who kept it can use it with geo-verify", async () => {
  const dir = scratch();
  try {
    const { privateKey } = generateKeyPairSync("ed25519");
    const ledger = ledgerOf(3);
    const r = await publishFingerprint({ file: join(dir, "f.jsonl"), ledger, day: "2026-11-03", now: t0, anchor: anchorOf(ledger, privateKey) });
    assert.equal(r.line!.anchor!.checkpoint.head, r.line!.head);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("git and the calendar stay off unless turned on AND the owner's yes is recorded", async () => {
  const dir = scratch();
  try {
    let called = 0;
    const run: Runner = () => { called++; return { code: 0, stdout: "", stderr: "" }; };
    const fetch = async () => { called++; return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(1) }; };
    const onNoYes = { git: { enabled: true, repo: dir }, opentimestamps: { enabled: true, calendars: ["http://127.0.0.1:1"] } };
    const r = await publishFingerprint({ file: join(dir, "f.jsonl"), ledger: ledgerOf(1), day: "2026-11-03", now: t0, targets: onNoYes, run, fetch });
    assert.match(r.targets.git, /waiting for the owner's yes/);
    assert.match(r.targets.opentimestamps, /waiting for the owner's yes/);
    const yesButOff = { git: { enabled: false, repo: dir, yes: { by: "Asha (owner)", at: "2026-11-02T10:00:00Z" } } };
    const r2 = await publishFingerprint({ file: join(dir, "g.jsonl"), ledger: ledgerOf(1), day: "2026-11-03", now: t0, targets: yesButOff, run, fetch });
    assert.equal(r2.targets.git, "off");
    assert.equal(called, 0, "nothing was run and nothing was sent");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("with the owner's yes: the line is pushed to a (local, fake) public repository and the digest stamped by a (local, fake) calendar", async () => {
  const dir = scratch();
  const seen: Buffer[] = [];
  const calendar = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => { seen.push(Buffer.concat(chunks)); res.writeHead(req.url === "/digest" && req.method === "POST" ? 200 : 404); res.end(Buffer.from([0x00, 0x4f, 0x70])); });
  });
  await new Promise<void>((r) => calendar.listen(0, "127.0.0.1", r));
  try {
    const remote = join(dir, "public.git");
    assert.equal(git("git", ["init", "-q", "--bare", remote], { cwd: dir }).code, 0);
    const work = join(dir, "work");
    assert.equal(git("git", ["clone", "-q", remote, work], { cwd: dir }).code, 0);
    appendFileSync(join(work, "README"), "fingerprints\n");
    git("git", ["add", "README"], { cwd: work });
    git("git", ["-c", "user.name=t", "-c", "user.email=t@localhost", "commit", "-q", "-m", "start"], { cwd: work });
    git("git", ["push", "-q", "origin", "HEAD"], { cwd: work });
    const port = (calendar.address() as { port: number }).port;
    const yes = { by: "Asha (owner)", at: "2026-11-02T10:00:00Z" };
    const targets = { git: { enabled: true, repo: work, yes }, opentimestamps: { enabled: true, calendars: [`http://127.0.0.1:${port}`], yes } };
    const file = join(dir, "log", "glow-salon.jsonl");
    const r = await publishFingerprint({ file, ledger: ledgerOf(3), day: "2026-11-03", now: t0, targets, run: git, fetch: globalThis.fetch as never });
    assert.equal(r.targets.git, "pushed");
    assert.match(r.targets.opentimestamps, /stamped/);
    const log = git("git", ["--git-dir", remote, "log", "--oneline"], { cwd: dir }).stdout;
    assert.match(log, /glow-salon 2026-11-03: entry 3/);
    const shown = git("git", ["--git-dir", remote, "show", "HEAD:fingerprints/glow-salon.jsonl"], { cwd: dir }).stdout;
    assert.equal(JSON.parse(shown).head, r.line!.head);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].length, 32, "the calendar is sent the 32-byte digest, nothing else");
    assert.ok(existsSync(join(dir, "log", "ots", "2026-11-03-glow-salon.ots")));
    assert.deepEqual(readdirSync(join(dir, "log", "ots")), ["2026-11-03-glow-salon.ots"]);
  } finally { calendar.close(); rmSync(dir, { recursive: true, force: true }); }
});
