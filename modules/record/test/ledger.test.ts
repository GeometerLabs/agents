import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson, createRecord } from "../record.ts";
import { fakeClock } from "../../core/clock.ts";
import { openStore } from "../../runtime/store.ts";
import type { RecordEntry } from "../record.ts";
import { BODY_TYPE, anchorOf, entryHash, evidencePack, genesisEvent, hashAt, headOf, ledgerBody, ledgerEntries, ledgerFile, ledgerHead, tenantOf } from "../ledger.ts";

// Vectors from geometer-verify's own fixture (crates/geo-verify/tests/fixtures/profile/pack.json, Apache-2.0; its keys are published test keys).
// If these hold, this file writes the bytes geometer-verify hashes and signs.
const FIXTURE_ENTRY_1 = { at_ms: "1792397322501", body: "{\"n\":1}", body_type: "Note", kind: "observed_fact", links: [], seq: "1", subject: "act-1", tenant: "acme", v: 1 };
const FIXTURE_ENTRY_2 = { at_ms: "1792397322507", body: "{\"n\":2}", body_type: "Note", kind: "observed_fact", links: [], prev: "sha256:fee410c6f8e2595cdb8e0d681c319e57cfafab087fe87ab4842f85df037e3a30", seq: "2", subject: "act-2", tenant: "acme", v: 1 };
const FIXTURE_CHECKPOINT = { at_ms: "1792397322540", count: "5", head: "sha256:78e960b7baab0fc34be7d13e63a561f6618f8bb0cdbedbff5d02e75ac75066d7", key: "key:73c4c5520504b46b763614889de36e510b64e40378ad41309235d02ca70c8fcf", key_log_seq: "1", seq: "5", sig: "8db10abb41bd9a9c256363325b4ccfb1b012da59547317afecbebe04c093a7e558f97daf564bf96acbb789b2d65e9f144b9df2b60cf55703bae69b994dd7ab03", tenant: "acme", v: 1 };
const FIXTURE_PUBLIC_KEY = "dcdbf9d5b17b71e1370bcd59b3912fc7ef28a5be050e316593fede0e1c7340a7";

const t0 = Date.UTC(2026, 10, 3, 4, 30);
function entry(seq: number, over: Partial<RecordEntry> = {}): RecordEntry {
  return { seq, time: new Date(t0 + seq * 60_000).toISOString(), conversation: "+919800000001", booking: "b-1", action: "send_message", inputsDigest: "0123456789abcdef", outcome: "confirmed", decisions: [], language: "hi", notes: "", refs: { to: "customer" }, ...over };
}
const record = (n: number) => Array.from({ length: n }, (_, i) => entry(i + 1));

test("the entry hash is geometer-verify's: its own fixture's entries hash to the hashes it wrote", () => {
  assert.equal(entryHash(FIXTURE_ENTRY_1 as never), "sha256:fee410c6f8e2595cdb8e0d681c319e57cfafab087fe87ab4842f85df037e3a30");
  assert.equal(entryHash(FIXTURE_ENTRY_2 as never), "sha256:61ce364e39be1b6674570254075bbbcbfe53b12866b63f4d8577628c3738fe00");
});

test("the checkpoint's signed bytes are geometer-verify's: its fixture's signature verifies over the bytes made here", () => {
  const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(FIXTURE_PUBLIC_KEY, "hex").toString("base64url") }, format: "jwk" });
  const message = Buffer.from(`geo-checkpoint/1\n${canonicalJson({ ...FIXTURE_CHECKPOINT, sig: "" })}`, "utf8");
  assert.ok(verify(null, message, key, Buffer.from(FIXTURE_CHECKPOINT.sig, "hex")));
});

test("each entry carries the previous entry's hash, and the head stands for the whole history", () => {
  const ledger = ledgerEntries(record(4), "glow-salon");
  assert.equal(ledger.length, 4);
  assert.equal("prev" in ledger[0], false, "the first entry has no prev key at all (absent, never null)");
  for (let i = 1; i < 4; i++) assert.equal(ledger[i].prev, ledger[i - 1].hash);
  for (const e of ledger) assert.equal(e.hash, entryHash(e));
  assert.deepEqual(ledgerHead(ledger), { ledger: "agent-record", tenant: "glow-salon", seq: 4, head: ledger[3].hash });
  assert.equal(hashAt(ledger, 2), ledger[1].hash);
  assert.equal(hashAt(ledger, 9), null);
  assert.equal(ledger[0].body_type, BODY_TYPE);
  assert.equal(ledger[0].seq, "1", "u64 fields are strings");
  assert.equal(ledger[0].at_ms, String(t0 + 60_000));
});

test("changing any chained field of an old entry changes the head; the number, the note and a page's secret address are not chained", () => {
  const base = headOf(record(5), "s")!.head;
  const changed = (over: Partial<RecordEntry>) => { const r = record(5); r[1] = entry(2, over); return headOf(r, "s")!.head; };
  for (const over of [{ outcome: "failed" as const }, { refs: { to: "owner" } }, { action: "refund" }, { time: new Date(t0).toISOString() }, { decisions: [{ ruleId: "refund-limit", verdict: "block" as const, reason: "x" }] }, { inputsDigest: "ffffffffffffffff" }, { booking: "b-2" }]) {
    assert.notEqual(changed(over), base, JSON.stringify(over));
  }
  assert.equal(changed({ conversation: "c-0123456789ab" }), base);
  assert.equal(changed({ notes: "the fee for s-0123456789ab, 2026-11, is open" }), base);
  assert.equal(changed({ refs: { to: "customer", page: "0f".repeat(16) } }), base);
  const body = JSON.parse(ledgerEntries([entry(1, { refs: { to: "owner", page: "secret" }, notes: "Rohan" })], "s")[0].body);
  assert.equal(JSON.stringify(body).includes("secret") || JSON.stringify(body).includes("Rohan") || JSON.stringify(body).includes("+91"), false);
  assert.deepEqual(Object.keys(ledgerBody(entry(1))).sort(), ["action", "booking", "decisions", "inputsDigest", "language", "outcome", "refs", "seq", "time"]);
});

test("the head the runtime works out from its record in memory is the head of the same record saved in its database and read back", () => {
  const dir = mkdtempSync(join(tmpdir(), "geo-ledger-db-"));
  try {
    const record = createRecord(fakeClock(t0));
    record.append({ conversation: "+919800000001", booking: "b-1", action: "refund", inputs: { amountInr: 300 }, outcome: "held_for_owner", decisions: [{ ruleId: "refund-limit", verdict: "hold_for_owner", reason: "above the limit" }], language: "kn", notes: "Guard is holding it", refs: { paymentId: "pmt_1", approval: undefined as unknown as string, amountPaise: "30000" } });
    record.append({ conversation: "+919800009999", booking: null, action: "owner_decision", inputs: { command: "approve" }, outcome: "confirmed", language: "kn" });
    const db = openStore(dir);
    db.commitStep({ snapshot: "{}", entries: record.entries(), nowMs: t0 });
    const saved = db.loadState().record;
    db.close();
    assert.equal(headOf(saved, "glow-salon")!.head, headOf(record.entries(), "glow-salon")!.head);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a record with a gap or a repeat is refused, the tenant follows geometer-verify's id rule, and an empty record has no head", () => {
  assert.throws(() => ledgerEntries([entry(1), entry(3)], "s"), /gap or a repeat/);
  assert.throws(() => ledgerEntries([entry(1), entry(1)], "s"), /gap or a repeat/);
  assert.equal(tenantOf("glow-salon"), "glow-salon");
  assert.equal(tenantOf("Glow Salon & Spa"), "glow-salon-spa");
  assert.throws(() => tenantOf("ಸಲೂನ್"), /cannot be turned/);
  assert.equal(headOf([], "s"), null);
});

test("the key log and the anchor come out the same every time for the same head", () => {
  const { privateKey } = generateKeyPairSync("ed25519");
  const ledger = ledgerEntries(record(3), "glow-salon");
  assert.equal(ledgerFile(anchorOf(ledger, privateKey)), ledgerFile(anchorOf(ledger, privateKey)));
  const g = genesisEvent(privateKey, 5);
  assert.equal(g.kind, "genesis");
  assert.match(g.key, /^key:[0-9a-f]{64}$/);
  const anchor = anchorOf(ledger, privateKey);
  assert.equal(anchor.checkpoint.head, ledger[2].hash);
  assert.equal(anchor.checkpoint.count, "3");
  assert.equal(anchor.key_log_head, genesisEvent(privateKey, Number(ledger[0].at_ms)).hash);
  const pack = evidencePack(ledger, { tenant: "glow-salon", now: t0, key: privateKey });
  assert.equal(pack.key_log[0].hash, anchor.key_log_head);
  assert.equal(pack.to_seq, "3");
  assert.equal(Object.keys(pack.coverage).length, 7);
  assert.equal(evidencePack([], { tenant: "glow-salon", now: t0 }).to_seq, "0");
});

// ---- geometer-verify's own checker, when it is built ----------------------------------------------------------------------------------
// Build it in the geometer-verify repository (cargo build --locked --release -p geo-verify) and point GEO_VERIFY_BIN at target/release/geo-verify.
function findVerifier(): string | undefined {
  const named = process.env.GEO_VERIFY_BIN;
  if (named) return existsSync(named) ? named : undefined;
  try { return execFileSync("sh", ["-c", "command -v geo-verify"], { encoding: "utf8" }).trim() || undefined; } catch { return undefined; }
}
const VERIFIER = findVerifier();
const skip = VERIFIER ? false : "geo-verify was not found: build it in the geometer-verify repository and set GEO_VERIFY_BIN";

function run(files: Record<string, string>, args: string[]): { code: number; report: any } {
  const dir = mkdtempSync(join(tmpdir(), "geo-ledger-"));
  try {
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
    const r = spawnSync(VERIFIER as string, [...args.map((a) => (a in files ? join(dir, a) : a)), "--json"], { encoding: "utf8" });
    let report: any = null;
    try { report = JSON.parse(r.stdout); } catch { report = { raw: r.stdout, err: r.stderr }; }
    return { code: r.status ?? -1, report };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("geo-verify reads the pack: verified 1 to N against the anchor, invalid when an entry is edited, unverifiable without an anchor, invalid when cut short", { skip }, () => {
  const { privateKey } = generateKeyPairSync("ed25519");
  const entries = [...record(6), entry(7, { action: "owner_decision", refs: { command: "approve" } }), entry(8, { booking: null, action: "receive_message", decisions: [{ ruleId: "opt-out", verdict: "allow", reason: "ಸರಿ, ठीक है" }] })];
  const ledger = ledgerEntries(entries, "glow-salon");
  const pack = ledgerFile(evidencePack(ledger, { tenant: "glow-salon", now: t0, key: privateKey }));
  const anchor = ledgerFile(anchorOf(ledger, privateKey));

  const ok = run({ "pack.json": pack, "anchor.json": anchor }, ["pack.json", "--anchor", "anchor.json"]);
  assert.equal(ok.code, 0, JSON.stringify(ok.report));
  assert.equal(ok.report.state, "verified_against_checkpoint");
  assert.deepEqual(ok.report.verified, { from: 1, to: 8 });
  assert.deepEqual(ok.report.unverifiable, []);
  assert.deepEqual(ok.report.invalid, []);

  const edited = JSON.parse(pack);
  edited.entries[2].body = edited.entries[2].body.replace("\"confirmed\"", "\"failed\"");
  const bad = run({ "pack.json": `${JSON.stringify(edited)}\n`, "anchor.json": anchor }, ["pack.json", "--anchor", "anchor.json"]);
  assert.equal(bad.code, 1);
  assert.ok(bad.report.invalid.some((f: any) => f.code === "edited" && f.seq === 3), JSON.stringify(bad.report.invalid));

  const none = run({ "pack.json": pack }, ["pack.json"]);
  assert.equal(none.code, 3);
  assert.equal(none.report.state, "unverifiable");

  const shortLedger = ledger.slice(0, 5);
  const cut = run({ "pack.json": ledgerFile(evidencePack(shortLedger, { tenant: "glow-salon", now: t0, key: privateKey })), "anchor.json": anchor }, ["pack.json", "--anchor", "anchor.json"]);
  assert.equal(cut.code, 1);
  assert.ok(cut.report.invalid.some((f: any) => f.code === "truncated"), JSON.stringify(cut.report.invalid));

  // an anchor saved when the record was 5 entries long still verifies 1 to 5 of today's pack, and says the rest is not covered yet
  const older = run({ "pack.json": pack, "anchor.json": ledgerFile(anchorOf(shortLedger, privateKey)) }, ["pack.json", "--anchor", "anchor.json"]);
  assert.equal(older.code, 0);
  assert.deepEqual(older.report.verified, { from: 1, to: 5 });
  assert.deepEqual(older.report.unverifiable, [{ from: 6, to: 8 }]);

  // someone else's key: the anchor does not fit the pack's key log
  const other = generateKeyPairSync("ed25519").privateKey;
  const foreign = run({ "pack.json": pack, "anchor.json": ledgerFile(anchorOf(ledger, other)) }, ["pack.json", "--anchor", "anchor.json"]);
  assert.equal(foreign.code, 1);
});
