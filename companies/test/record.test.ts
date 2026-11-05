// What a reviewer gets: the export of Guard's decisions in plain words, and the evidence pack that the open geo-verify checks against an anchor. The first part
// needs the real geo-guard; the check with geo-verify also needs geo-verify. Each says why it was skipped.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findVerifier } from "../guard-binary.ts";
import { exportRecord, lineOf, recordLines, summaryText, WINDOW } from "../export-record.ts";
import { skipWithoutGuard, tempDir } from "./helpers.ts";
import { startStack } from "./real-guard.ts";
import type { Stack } from "./real-guard.ts";

const VERIFIER = findVerifier();
const skipWithoutVerifier: string | false = skipWithoutGuard || (VERIFIER ? false : "geo-verify was not found (set GEO_VERIFY_BIN, put it beside geo-guard or on your PATH; it is built from the open geometer-verify repository)");

/** Eight calls with every kind of ending: sent, replayed, conflict, refused, held, unknown, held with nobody to approve, unlisted. */
async function story(s: Stack) {
  await s.call("POST", "/v1/refunds", { charge_id: "c1", amount: 5000 });
  await s.call("POST", "/v1/refunds", { charge_id: "c1", amount: 5000 });
  await s.call("POST", "/v1/refunds", { charge_id: "c1", amount: 4000 });
  await s.call("POST", "/v1/refunds", { charge_id: "c2", amount: 60000 });
  await s.call("POST", "/v1/refunds", { charge_id: "c3", amount: 20000 });
  s.api.loseReplyFor.add("c4");
  await s.call("POST", "/v1/refunds", { charge_id: "c4", amount: 2000 });
  await s.call("POST", "/v1/refunds", { charge_id: "c4", amount: 2000 });
  await s.call("GET", "/v1/customers/cu_1");
}

/** Every file under a folder, by its path inside it. */
const filesUnder = (dir: string): string[] => readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name).slice(dir.length + 1));

test("the export says in plain words what happened to each call, oldest first, and its manifest matches its files", { skip: skipWithoutGuard }, async () => {
  const s = await startStack();
  try {
    await story(s);
    const out = tempDir();
    const r = await exportRecord({ admin: s.adminUrl, token: s.adminToken, out });
    assert.equal(r.lines, 8);
    assert.equal(r.windowFull, false);
    const lines = readFileSync(join(out, "record.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(lines.map((l) => l.outcome), ["sent", "replayed", "refused", "refused", "held", "unknown", "held", "refused"]);
    assert.deepEqual(lines.map((l) => l.seq), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal(lines[0].status, 201);
    assert.equal(lines[0].agent, "support-bot");
    assert.deepEqual(lines[0].arguments, { amount: "5000", charge_id: "c1" });
    assert.equal(lines[3].rule, "create_refund-amount-bound");
    assert.match(lines[3].why, /above the highest allowed value, 50000/u);
    assert.match(lines[4].approval, /^ap-brightside-refunds-/u, "a held call names its approval");
    assert.equal(lines[6].approval, null, "the unknown-outcome hold has nothing to approve");
    assert.match(lines[7].why, /is not a route this policy covers/u);
    const summary = readFileSync(join(out, "summary.txt"), "utf8");
    assert.match(summary, /8 \(1 sent, 3 refused, 2 held, 1 answered from the record, 0 allowed but not sent, 1 with an unknown outcome\)/u);
    assert.match(summary, /does not read the API back/u);
    assert.match(summary, /No evidence pack was asked for \(--backup-dir\)/u);
    const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8")).files as Record<string, string>;
    assert.deepEqual(Object.keys(manifest).sort(), ["approvals.json", "decisions.json", "intents.json", "record.jsonl", "summary.txt"]);
    for (const [name, digest] of Object.entries(manifest)) assert.equal(digest, `sha256:${createHash("sha256").update(readFileSync(join(out, name))).digest("hex")}`, name);
    const intents = JSON.parse(readFileSync(join(out, "intents.json"), "utf8")).intents;
    assert.equal(intents.filter((i: any) => i.state === "outcome_unknown").length, 1);
  } finally { await s.stop(); }
});

test("a call the rules allowed but Guard could not send is 'not_sent' with Guard's reason, never 'replayed'", { skip: skipWithoutGuard }, async () => {
  const s = await startStack();
  try {
    await s.api.close(); // the API is down
    const r = await s.call("POST", "/v1/refunds", { charge_id: "c9", amount: 100 });
    assert.equal(r.status, 502);
    const out = tempDir();
    await exportRecord({ admin: s.adminUrl, token: s.adminToken, out });
    const [line] = readFileSync(join(out, "record.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(line.outcome, "not_sent");
    assert.match(line.why, /unreachable.*nothing was sent/u);
    assert.match(readFileSync(join(out, "summary.txt"), "utf8"), /1 allowed but not sent/u);
  } finally { await s.stop(); }
});

test("reviewers get the evidence pack and the anchor and nothing else of Guard's backup; geo-verify checks the pack, a later pack against an earlier anchor, and a changed pack fails", { skip: skipWithoutVerifier }, async () => {
  const s = await startStack();
  try {
    await story(s);
    const backups = join(tempDir(), "backups"), first = tempDir(), second = tempDir();
    await exportRecord({ admin: s.adminUrl, token: s.adminToken, out: first, backupDir: backups, stamp: "one" });
    // Guard's own backup (its store and its keys) stays where the operator keeps it. What the reviewers get is two files.
    assert.deepEqual(filesUnder(join(first, "evidence")).sort(), ["anchor.json", "evidence-pack.json"]);
    assert.ok(!filesUnder(first).some((f) => /\.secret$|state\.db|keys\//u.test(f)), "no key and no store in the review folder");
    assert.ok(filesUnder(join(backups, "backup-one")).some((f) => f.endsWith(".secret")), "the keys are in the operator's backup; this shows what was left out");
    const summary = readFileSync(join(first, "summary.txt"), "utf8");
    assert.match(summary, /evidence\/ holds Guard's evidence pack and anchor/u);
    assert.match(summary, /EARLIER export/u);
    assert.match(summary, /not part of this export/u);

    const pack = join(first, "evidence", "evidence-pack.json"), anchor = join(first, "evidence", "anchor.json");
    const check = (args: string[]) => spawnSync(VERIFIER!, args, { encoding: "utf8" });
    const good = check([pack, "--anchor", anchor]);
    assert.equal(good.status, 0, good.stdout + good.stderr);
    assert.match(good.stdout, /VERIFIED/u);
    const none = check([pack]);
    assert.equal(none.status, 3, "with no anchor it says so, rather than passing");
    assert.match(none.stdout, /UNVERIFIABLE/u);

    // a second export (a new subfolder: Guard refuses a backup into a folder that is not empty), after more calls
    await s.call("POST", "/v1/refunds", { charge_id: "c5", amount: 1000 });
    await exportRecord({ admin: s.adminUrl, token: s.adminToken, out: second, backupDir: backups, stamp: "two" });
    const laterPack = join(second, "evidence", "evidence-pack.json");
    const later = check([laterPack, "--anchor", anchor]);
    assert.equal(later.status, 0, "a later pack checks against the EARLIER anchor");
    assert.match(later.stdout, /verified: entries 1 to \d+ match the anchor/u);
    // an entry the earlier anchor covers is changed in the later pack
    const parsed = JSON.parse(readFileSync(laterPack, "utf8"));
    parsed.entries[2].at_ms = String(Number(parsed.entries[2].at_ms) + 1);
    const changed = join(second, "changed.json");
    writeFileSync(changed, JSON.stringify(parsed));
    const bad = check([changed, "--anchor", anchor]);
    assert.equal(bad.status, 1, bad.stdout + bad.stderr);
    assert.match(bad.stdout, /INVALID/u);
  } finally { await s.stop(); }
});

test("a backup folder this process cannot read is said so; the same folder under another name works with --backup-read-dir", { skip: skipWithoutGuard }, async () => {
  const s = await startStack();
  try {
    const guardSees = join(tempDir(), "guard-side"), out = tempDir();
    mkdirSync(guardSees);
    await assert.rejects(exportRecord({ admin: s.adminUrl, token: s.adminToken, out, backupDir: guardSees, backupReadDir: join(tempDir(), "nowhere"), stamp: "x" }), /cannot read evidence-pack\.json and anchor\.json at .*pass it as --backup-read-dir/u);
    const alias = join(tempDir(), "alias");
    symlinkSync(guardSees, alias);
    await exportRecord({ admin: s.adminUrl, token: s.adminToken, out, backupDir: guardSees, backupReadDir: alias, stamp: "y" });
    assert.ok(existsSync(join(out, "evidence", "anchor.json")));
    // an export is kept: a second one into the same folder is refused, because the old anchor is what a later pack is checked against
    await assert.rejects(exportRecord({ admin: s.adminUrl, token: s.adminToken, out }), /is not empty\. Each export goes in a new folder/u);
  } finally { await s.stop(); }
});

test("the plain-words line for each kind of decision, without a Guard", () => {
  const base = { at_ms: "1800000000000", call: "sha256:x", principal: { workload: "bot" }, operation: "create_refund", arguments: { amount: ["int", "5"] }, id: "gd-1" };
  assert.equal(lineOf({ ...base, outcome: "allow", dispatched: true, reasons: ["dispatched once; the provider answered 502"], evaluations: [] }, 1).status, 502, "a 5xx is still 'sent', with the API's status");
  assert.equal(lineOf({ ...base, outcome: "allow", dispatched: false, reasons: ["intent already confirmed: the recorded reply is returned"], evaluations: [] }, 1).outcome, "replayed");
  assert.equal(lineOf({ ...base, outcome: "allow", dispatched: false, reasons: ["the provider was unreachable (Connection refused): nothing was sent"], evaluations: [] }, 1).outcome, "not_sent");
  const refused = lineOf({ ...base, outcome: "deny", dispatched: false, reasons: ["x"], evaluations: [{ rule: "r1", decision: "deny", reason: "too big" }, { rule: "r2", decision: "hold", reason: "wait" }] }, 1);
  assert.deepEqual([refused.outcome, refused.rule, refused.why], ["refused", "r1", "too big"]);
  assert.equal(lineOf({ ...base, outcome: "hold", dispatched: false, approval: "ap-1", reasons: [], evaluations: [{ rule: "r2", decision: "hold", reason: "wait" }] }, 1).rule, "r2");
  // oldest first, whatever order Guard lists them in
  assert.deepEqual(recordLines([{ ...base, at_ms: "3", id: "c", outcome: "deny", reasons: [] }, { ...base, at_ms: "1", id: "a", outcome: "deny", reasons: [] }]).map((l) => l.seq + l.time), ["11970-01-01T00:00:00.001Z", "21970-01-01T00:00:00.003Z"]);
  // a full list says older decisions may exist
  assert.match(summaryText([], { approvals: [], intents: [], windowFull: true, evidence: true }), /most recent decisions, and this list is that long/u);
  assert.equal(WINDOW, 500);
});
