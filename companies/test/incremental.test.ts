// The incremental export: each run writes only what is new, says plainly when calls fell out of Guard's list of 500 between two runs, and never writes a
// decision twice. The first group needs no Guard (a stand-in admin port that lists decisions the way Guard does, newest first); the last one runs the real geo-guard.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { WINDOW, readWindow, windowOf } from "../decision-window.ts";
import { exportRecord } from "../export-record.ts";
import { skipWithoutGuard, tempDir } from "./helpers.ts";
import { startStack } from "./real-guard.ts";

type Obj = Record<string, any>;
const decision = (n: number, at: number): Obj => ({ id: `d${String(n).padStart(5, "0")}`, at_ms: String(at), outcome: "deny", dispatched: false, operation: "x", call: `call-${n}`, principal: { workload: "bot" }, reasons: ["no"], evaluations: [], arguments: {} });

/** An admin port that lists whatever decisions it holds, newest first, at most `limit`, the way Guard does. */
async function standIn() {
  const all: Obj[] = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url!, "http://x");
    const body = url.pathname === "/admin/decisions" ? { decisions: [...all].sort((a, b) => Number(b.at_ms) - Number(a.at_ms) || (a.id < b.id ? 1 : -1)).slice(0, Number(url.searchParams.get("limit") ?? 50)) } : url.pathname === "/admin/approvals" ? { approvals: [] } : { intents: [] };
    res.setHeader("content-type", "application/json"); res.end(JSON.stringify(body));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const admin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { all, admin, close: () => new Promise<void>((r) => server.close(() => r())) };
}
const lines = (out: string): Obj[] => readFileSync(join(out, "record.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

test("readWindow: no mark means no gap; a full list whose oldest is newer than the mark is a gap; the mark never goes back", () => {
  const full = { count: WINDOW, full: true, oldestAtMs: 5000, newestAtMs: 9000 };
  assert.equal(readWindow(undefined, full, "Guard").gap, undefined);
  assert.equal(readWindow(undefined, full, "Guard").mark, 9000);
  const g = readWindow(1000, full, "Guard");
  assert.equal(g.gap!.fromMs, 1000); assert.equal(g.gap!.toMs, 5000);
  assert.match(g.gap!.message, /^Guard lists only its 500 most recent decisions.*fell out of the list before they were read/u);
  assert.equal(readWindow(5000, full, "Guard").gap, undefined, "the oldest shown is the mark itself: nothing between");
  assert.equal(readWindow(1000, { ...full, full: false, count: 40 }, "Guard").gap, undefined, "a list that is not full reaches back as far as Guard goes");
  assert.equal(readWindow(20_000, full, "Guard").mark, 20_000);
  assert.deepEqual(windowOf([{ at_ms: "30" }, { at_ms: 10 }, { at_ms: "nope" }], 3), { count: 3, full: true, oldestAtMs: 10, newestAtMs: 30 });
});

test("two exports: the second holds only what is new, seq carries on, and nothing is repeated", async () => {
  const g = await standIn();
  try {
    const state = join(tempDir(), "state.json");
    for (let i = 1; i <= 3; i++) g.all.push(decision(i, 1000 + i));
    const a = tempDir();
    const r1 = await exportRecord({ admin: g.admin, token: "t", out: a, stateFile: state });
    assert.equal(r1.lines, 3); assert.equal(r1.gap, undefined);
    for (let i = 4; i <= 6; i++) g.all.push(decision(i, 1000 + i));
    const b = tempDir();
    const r2 = await exportRecord({ admin: g.admin, token: "t", out: b, stateFile: state });
    assert.equal(r2.lines, 3);
    assert.deepEqual(lines(a).map((l) => l.seq), [1, 2, 3]);
    assert.deepEqual(lines(b).map((l) => l.seq), [4, 5, 6]);
    assert.deepEqual(lines(b).map((l) => l.call), ["call-4", "call-5", "call-6"]);
    assert.deepEqual(JSON.parse(readFileSync(join(b, "decisions.json"), "utf8")).decisions.map((d: Obj) => d.id), ["d00006", "d00005", "d00004"], "decisions.json keeps Guard's own order, newest first");
    assert.match(readFileSync(join(b, "summary.txt"), "utf8"), /incremental export: it holds only decisions after 1970-01-01T00:00:01\.003Z/u);
    // nothing new: an empty export, still not a gap, and the next number is still 7
    const c = tempDir();
    assert.equal((await exportRecord({ admin: g.admin, token: "t", out: c, stateFile: state })).lines, 0);
    g.all.push(decision(7, 1007));
    const d = tempDir();
    await exportRecord({ admin: g.admin, token: "t", out: d, stateFile: state });
    assert.deepEqual(lines(d).map((l) => l.seq), [7]);
  } finally { await g.close(); }
});

test("decisions in the same millisecond as the mark are neither skipped nor read twice", async () => {
  const g = await standIn();
  try {
    const state = join(tempDir(), "state.json");
    g.all.push(decision(1, 2000), decision(2, 2000));
    const a = tempDir(), b = tempDir();
    await exportRecord({ admin: g.admin, token: "t", out: a, stateFile: state });
    g.all.push(decision(3, 2000), decision(4, 2001));
    await exportRecord({ admin: g.admin, token: "t", out: b, stateFile: state });
    assert.deepEqual(lines(a).map((l) => l.call), ["call-1", "call-2"]);
    assert.deepEqual(lines(b).map((l) => l.call), ["call-3", "call-4"]);
  } finally { await g.close(); }
});

test("more than 500 decisions between two exports: a record_gap line names what is lost, the summary says so, and no decision is repeated", async () => {
  const g = await standIn();
  try {
    const state = join(tempDir(), "state.json");
    for (let i = 1; i <= 10; i++) g.all.push(decision(i, 1000 + i));
    const a = tempDir();
    await exportRecord({ admin: g.admin, token: "t", out: a, stateFile: state });
    for (let i = 11; i <= 700; i++) g.all.push(decision(i, 1000 + i)); // 690 more: the 500 newest are listed, 190 fell out
    const b = tempDir();
    const r = await exportRecord({ admin: g.admin, token: "t", out: b, stateFile: state });
    assert.ok(r.gap);
    const second = lines(b);
    assert.equal(second.length, 501, "the gap line, then the 500 decisions Guard still lists");
    assert.equal(second[0]!.outcome, "record_gap");
    assert.equal(second[0]!.seq, 11);
    assert.match(second[0]!.why, /lists only its 500 most recent decisions.*\(1970-01-01T00:00:01\.201Z\) is newer than the last this record had read \(1970-01-01T00:00:01\.010Z\).*missing from the record/u);
    assert.equal(second[0]!.arguments.last_read, "1970-01-01T00:00:01.010Z");
    assert.equal(second[1]!.call, "call-201");
    const summary = readFileSync(join(b, "summary.txt"), "utf8");
    assert.match(summary, /MISSING CALLS: Guard lists only its 500 most recent decisions/u);
    assert.match(summary, /Guard's decisions: 500 /u, "the gap line is not counted as a decision");
    // a third export with a few new calls: no gap, no repeat
    for (let i = 701; i <= 705; i++) g.all.push(decision(i, 1000 + i));
    const c = tempDir();
    const r3 = await exportRecord({ admin: g.admin, token: "t", out: c, stateFile: state });
    assert.equal(r3.gap, undefined);
    assert.deepEqual(lines(c).map((l) => l.call), ["call-701", "call-702", "call-703", "call-704", "call-705"]);
    assert.equal(lines(c)[0]!.seq, 512);
    const calls = [...lines(a), ...second, ...lines(c)].map((l) => l.call).filter(Boolean);
    assert.equal(new Set(calls).size, calls.length, "no decision is written in two exports");
  } finally { await g.close(); }
});

test("a failed export does not move the mark, and a damaged state file is refused", async () => {
  const g = await standIn();
  try {
    const dir = tempDir();
    const state = join(dir, "state.json");
    g.all.push(decision(1, 1001));
    await assert.rejects(exportRecord({ admin: g.admin, token: "t", out: tempDir(), stateFile: state, backupDir: "/nonexistent-for-guard", backupReadDir: join(dir, "none") }));
    assert.equal(existsSync(state), false, "nothing was written, so the decision is read again next time");
    await exportRecord({ admin: g.admin, token: "t", out: tempDir(), stateFile: state });
    const { writeFileSync } = await import("node:fs");
    writeFileSync(state, "{ not json");
    await assert.rejects(exportRecord({ admin: g.admin, token: "t", out: tempDir(), stateFile: state }), /not readable as an export state file/u);
  } finally { await g.close(); }
});

test("through the real Guard: calls between two exports are written once, and 500+ calls leave a gap line", { skip: skipWithoutGuard, timeout: 300_000 }, async () => {
  const s = await startStack();
  try {
    const state = join(tempDir(), "state.json");
    for (let i = 0; i < 3; i++) await s.call("GET", "/v1/customers/cu_1");
    const a = tempDir();
    assert.equal((await exportRecord({ admin: s.adminUrl, token: s.adminToken, out: a, stateFile: state })).lines, 3);
    await s.call("GET", "/v1/customers/cu_1");
    const b = tempDir();
    assert.equal((await exportRecord({ admin: s.adminUrl, token: s.adminToken, out: b, stateFile: state })).lines, 1);
    for (let i = 0; i < WINDOW + 20; i++) await s.call("GET", "/v1/customers/cu_1");
    const c = tempDir();
    const r = await exportRecord({ admin: s.adminUrl, token: s.adminToken, out: c, stateFile: state });
    assert.ok(r.gap, "Guard decided more than it lists, so the export says calls are missing");
    const third = lines(c);
    assert.equal(third[0]!.outcome, "record_gap");
    assert.equal(third.length, WINDOW + 1);
    assert.deepEqual(third.map((l) => l.seq), Array.from({ length: WINDOW + 1 }, (_, i) => 5 + i));
    const ids = [a, b, c].flatMap((o) => JSON.parse(readFileSync(join(o, "decisions.json"), "utf8")).decisions.map((d: Obj) => d.id));
    assert.equal(new Set(ids).size, ids.length, "no decision is in two exports");
  } finally { await s.stop(); }
});
