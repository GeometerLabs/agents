// What a reviewer gets: the export of Guard's decisions in plain words, and the evidence pack that the open geo-verify checks against an anchor. The first part
// needs the real geo-guard; the check with geo-verify also needs geo-verify. Each says why it was skipped.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findVerifier } from "../guard-binary.ts";
import { exportRecord, lineOf, recordLines, summaryText, WINDOW } from "../export-record.ts";
import { skipWithoutGuard, tempDir } from "./helpers.ts";
import { startStack } from "./real-guard.ts";
import type { Stack } from "./real-guard.ts";

const VERIFIER = findVerifier();
const skipWithoutVerifier: string | false = skipWithoutGuard || (VERIFIER ? false : "geo-verify was not found (set GEO_VERIFY_BIN, put it beside geo-guard or on your PATH; it is built from the open geometer-verify repository)");

/** Seven calls with every kind of ending: sent, replayed, conflict, refused, held, unknown, held with nobody to approve, unlisted. */
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
    assert.match(summary, /8 \(1 sent, 3 refused, 2 held, 1 answered from the record, 1 with an unknown outcome\)/u);
    assert.match(summary, /does not read the API back/u);
    assert.match(summary, /No evidence pack was asked for/u);
    const manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8")).files as Record<string, string>;
    assert.deepEqual(Object.keys(manifest).sort(), ["approvals.json", "decisions.json", "intents.json", "record.jsonl", "summary.txt"]);
    for (const [name, digest] of Object.entries(manifest)) assert.equal(digest, `sha256:${createHash("sha256").update(readFileSync(join(out, name))).digest("hex")}`, name);
    const intents = JSON.parse(readFileSync(join(out, "intents.json"), "utf8")).intents;
    assert.equal(intents.filter((i: any) => i.state === "outcome_unknown").length, 1);
  } finally { await s.stop(); }
});

test("the evidence pack Guard writes is checked by the open geo-verify against an anchor, and a changed pack is not", { skip: skipWithoutVerifier }, async () => {
  const s = await startStack();
  try {
    await story(s);
    const out = tempDir(), evidence = join(tempDir(), "evidence");
    await exportRecord({ admin: s.adminUrl, token: s.adminToken, out, evidenceDir: evidence });
    assert.match(readFileSync(join(out, "summary.txt"), "utf8"), /evidence pack and anchor are in the evidence folder/u);
    const pack = join(evidence, "evidence-pack.json"), anchor = join(evidence, "anchor.json");
    assert.ok(existsSync(pack) && existsSync(anchor));
    const check = (args: string[]) => spawnSync(VERIFIER!, args, { encoding: "utf8" });
    const good = check([pack, "--anchor", anchor]);
    assert.equal(good.status, 0, good.stdout + good.stderr);
    assert.match(good.stdout, /VERIFIED/u);
    // with no anchor it says so, rather than passing
    const none = check([pack]);
    assert.equal(none.status, 3);
    assert.match(none.stdout, /UNVERIFIABLE/u);
    // an entry changed after the anchor was saved
    const parsed = JSON.parse(readFileSync(pack, "utf8"));
    parsed.entries[2].at_ms = String(Number(parsed.entries[2].at_ms) + 1);
    const changed = join(evidence, "changed.json");
    writeFileSync(changed, JSON.stringify(parsed));
    const bad = check([changed, "--anchor", anchor]);
    assert.equal(bad.status, 1, bad.stdout + bad.stderr);
    assert.match(bad.stdout, /INVALID/u);
  } finally { await s.stop(); }
});

test("the plain-words line for each kind of decision, without a Guard", () => {
  const base = { at_ms: "1800000000000", call: "sha256:x", principal: { workload: "bot" }, operation: "create_refund", arguments: { amount: ["int", "5"] }, id: "gd-1" };
  assert.equal(lineOf({ ...base, outcome: "allow", dispatched: true, reasons: ["dispatched once; the provider answered 502"], evaluations: [] }, 1).status, 502, "a 5xx is still 'sent', with the API's status");
  assert.equal(lineOf({ ...base, outcome: "allow", dispatched: false, reasons: ["intent already confirmed: the recorded reply is returned"], evaluations: [] }, 1).outcome, "replayed");
  const refused = lineOf({ ...base, outcome: "deny", dispatched: false, reasons: ["x"], evaluations: [{ rule: "r1", decision: "deny", reason: "too big" }, { rule: "r2", decision: "hold", reason: "wait" }] }, 1);
  assert.deepEqual([refused.outcome, refused.rule, refused.why], ["refused", "r1", "too big"]);
  assert.equal(lineOf({ ...base, outcome: "hold", dispatched: false, approval: "ap-1", reasons: [], evaluations: [{ rule: "r2", decision: "hold", reason: "wait" }] }, 1).rule, "r2");
  // oldest first, whatever order Guard lists them in
  assert.deepEqual(recordLines([{ ...base, at_ms: "3", id: "c", outcome: "deny", reasons: [] }, { ...base, at_ms: "1", id: "a", outcome: "deny", reasons: [] }]).map((l) => l.seq + l.time), ["11970-01-01T00:00:00.001Z", "21970-01-01T00:00:00.003Z"]);
  // a full list says older decisions may exist
  assert.match(summaryText([], { approvals: [], intents: [], windowFull: true, evidence: true }), new RegExp(`most recent decisions, and this list is that long`, "u"));
  assert.equal(WINDOW, 500);
});
