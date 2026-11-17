// The deployer's carrying of a limit change (bundle/lib/limit-changes.ts), on fakes: no Docker, no network. It checks the change again against the settings FILE, writes the
// one number (the old file kept), deploys, reads the limit back from the Guards and the runtime, and settles Active, or on any failure puts the file back and settles failed
// so the runtime drops its tighter value. One change at a time per shop; safe to stop and start at any step.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MOST_WAITS, limitStep, syncLimitChanges } from "../lib/limit-changes.ts";
import type { LimitIO } from "../lib/limit-changes.ts";
import { KINDS } from "../lib/kinds.ts";
import { serverPaths } from "../lib/server.ts";
import { saveState } from "../lib/state.ts";
import { readStatus } from "../lib/status.ts";
import type { LimitChange } from "../../modules/limits/chat-limits.ts";
import type { LimitsView } from "../../modules/limits/runtime-limits.ts";
import { CHAT_LIMITS } from "../../templates/commerce/bookings/src/chat-limits.ts";

const EXAMPLE = readFileSync(new URL("../../templates/commerce/bookings/settings/glow-salon.example.json", import.meta.url), "utf8");
const SHOP = "glow-salon";
const change = (o: Partial<LimitChange> = {}): LimitChange => ({ id: "l-1", limit: "refund_limit", path: "cancellation.refundLimitInr", from: 200, to: 100, direction: "tighten", by: "owner_chat", state: "pending", atMs: 1_800_000_000_000, ...o });

/** A server folder with one deployed Bookings shop whose settings file is the example (refund limit 200), and fakes for everything outside. */
function world() {
  const dir = mkdtempSync(join(tmpdir(), "limit-changes-"));
  const shopDir = serverPaths(dir).shop(SHOP);
  mkdirSync(shopDir, { recursive: true });
  writeFileSync(join(shopDir, "settings.json"), EXAMPLE);
  saveState(dir, { schema: 1, shops: { [SHOP]: { index: 1, guards: {}, lockHistory: [], applied: { pathway: "bookings@0.1.0", guards: {} } as never } } });
  const changes: LimitChange[] = [];
  /** What the runtime reports as the file's value: it follows the settings file once a deploy has "restarted" it. */
  const s = { file: 200, restarted: true, answer: true, settled: [] as string[], deploys: 0, deployError: undefined as Error | undefined, guardsOk: true, settleOk: true };
  const fileValue = () => (JSON.parse(readFileSync(join(shopDir, "settings.json"), "utf8")) as { cancellation: { refundLimitInr: number } }).cancellation.refundLimitInr;
  const io: LimitIO = {
    async read() {
      if (!s.answer) return undefined;
      const view: LimitsView = { limits: [{ id: "refund_limit", path: "cancellation.refundLimitInr", unit: "inr", tighter: "lower", zeroIsOff: false, name: CHAT_LIMITS[0].name, rule: CHAT_LIMITS[0].rule, inForce: s.file, file: s.file, bounds: { min: 0, max: 2000 } }], changes: changes.map((c) => ({ ...c })) };
      return view;
    },
    async settle(_shop, requestId, id, result, why) {
      s.settled.push(`${requestId}:${result}${why ? `:${why}` : ""}`);
      if (!s.settleOk) return false;
      const c = changes.find((x) => x.id === id);
      if (c && c.state === "pending") { c.state = result; if (why) c.why = why; }
      return true;
    },
    async deploy() { s.deploys++; if (s.deployError) throw s.deployError; if (s.restarted) s.file = fileValue(); },
    async guardsMatch() { return s.guardsOk ? { ok: true as const } : { ok: false as const, why: "guard-razorpay does not report the policy that was checked for the new limit" }; },
  };
  const logs: string[] = [];
  const ctx = { dir, now: () => new Date("2026-11-17T10:00:00Z"), log: (l: string) => logs.push(l) };
  return { dir, shopDir, changes, s, io, ctx, logs, fileValue, kind: KINDS.bookings, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test("a pending tightening is written to the settings file, deployed, read back and settled Active; the old file is kept", async () => {
  const w = world();
  try {
    w.changes.push(change());
    const lines = await limitStep(w.ctx, w.io, SHOP, w.kind);
    assert.equal(w.fileValue(), 100, "the one number is in the file Guard's spec is made from");
    assert.equal(JSON.parse(readFileSync(join(w.shopDir, "settings.json"), "utf8")).deposit.amountInr, 200, "nothing else changed");
    assert.ok(readdirSync(join(serverPaths(w.dir).state, "limit-changes", SHOP)).some((f) => f.endsWith(".settings.before.json") || f === "l-1.json"));
    assert.equal(w.s.deploys, 1);
    assert.deepEqual(w.s.settled, [`${SHOP}-l-1-active`]);
    assert.equal(w.changes[0].state, "active");
    assert.ok(lines.some((l) => /is Active/u.test(l)));
    assert.ok(!existsSync(join(serverPaths(w.dir).state, "limit-changes", SHOP, "l-1.json")), "the journal is done with");
    assert.deepEqual(readStatus(w.dir, SHOP)?.limitChanges?.map((c) => [c.id, c.state]), [["l-1", "pending"]], "the panel was shown the change from the moment it was Pending");
  } finally { w.done(); }
});

test("the check is made again against the FILE: a value no tighter than the file's is refused and the previous limit stands", async () => {
  const w = world();
  try {
    w.changes.push(change({ from: 400, to: 300 })); // the runtime thought 400 was in force; the file says 200, so 300 would loosen it
    await limitStep(w.ctx, w.io, SHOP, w.kind);
    assert.equal(w.fileValue(), 200, "the file is untouched");
    assert.equal(w.s.deploys, 0);
    assert.match(w.s.settled[0], /failed:the settings already hold 200, which is as tight or tighter/u);
    assert.equal(w.changes[0].state, "failed");
  } finally { w.done(); }
});

test("a refused or failed deploy puts the file back and tells the runtime failed", async () => {
  const w = world();
  try {
    w.changes.push(change());
    w.s.deployError = Object.assign(new Error("refused"), { problems: [{ rule: "x", message: "the Guard did not compile" }] });
    await limitStep(w.ctx, w.io, SHOP, w.kind);
    assert.equal(w.fileValue(), 200, "the previous limit is back in the file");
    assert.match(w.s.settled[0], /failed:the deploy did not go through \(the Guard did not compile\)/u);
    assert.equal(w.changes[0].state, "failed");
    assert.ok(!existsSync(join(serverPaths(w.dir).state, "limit-changes", SHOP, "l-1.json")));
  } finally { w.done(); }
});

test("a running Guard that does not report the checked policy is a failure, and the file goes back", async () => {
  const w = world();
  try {
    w.changes.push(change());
    w.s.guardsOk = false;
    await limitStep(w.ctx, w.io, SHOP, w.kind);
    assert.equal(w.fileValue(), 200);
    assert.match(w.s.settled[0], /failed:guard-razorpay does not report/u);
  } finally { w.done(); }
});

test("a runtime that has not restarted is waited for, then given up on; and a runtime that is down changes nothing", async () => {
  const w = world();
  try {
    w.changes.push(change());
    w.s.restarted = false;
    await limitStep(w.ctx, w.io, SHOP, w.kind);
    assert.deepEqual(w.s.settled, [], "not Active until the runtime reports the value");
    assert.equal(w.changes[0].state, "pending");
    for (let i = 0; i < MOST_WAITS; i++) await limitStep(w.ctx, w.io, SHOP, w.kind);
    assert.equal(w.s.deploys, 1, "waiting does not deploy again");
    assert.match(w.s.settled.at(-1)!, /failed:the shop's runtime did not report the new value in time/u);
    assert.equal(w.fileValue(), 200, "put back");
    w.changes[0].state = "pending"; w.changes[0].why = undefined; w.s.answer = false; w.s.settled.length = 0;
    assert.deepEqual(await limitStep(w.ctx, w.io, SHOP, w.kind), []);
    assert.deepEqual(w.s.settled, []);
  } finally { w.done(); }
});

test("the deployer restarting in the middle: a journal that says written is not written or tightened twice, and Active is told once even if told again", async () => {
  const w = world();
  try {
    w.changes.push(change());
    w.s.settleOk = false; // the runtime could not be told: everything else was done
    await limitStep(w.ctx, w.io, SHOP, w.kind);
    assert.equal(w.changes[0].state, "pending");
    assert.equal(w.s.deploys, 1);
    // "restart": the next pass finds the journal (phase deployed) and only tells the runtime
    w.s.settleOk = true;
    await limitStep(w.ctx, w.io, SHOP, w.kind);
    assert.equal(w.s.deploys, 1, "no second deploy");
    assert.equal(w.changes[0].state, "active");
    assert.equal(w.fileValue(), 100);
    assert.deepEqual(w.s.settled, [`${SHOP}-l-1-active`, `${SHOP}-l-1-active`], "the same request id both times, so the runtime takes it as one");
  } finally { w.done(); }
});

test("a stop between the journal and the write is picked up: the number is written then", async () => {
  const w = world();
  try {
    w.changes.push(change());
    mkdirSync(join(serverPaths(w.dir).state, "limit-changes", SHOP), { recursive: true });
    writeFileSync(join(serverPaths(w.dir).state, "limit-changes", SHOP, "l-1.json"), JSON.stringify({ change: "l-1", limit: "refund_limit", from: 200, to: 100, direction: "tighten", startedAt: "2026-11-17T09:59:00Z", waits: 0, phase: "writing" }));
    await limitStep(w.ctx, w.io, SHOP, w.kind);
    assert.equal(w.fileValue(), 100);
    assert.equal(w.changes[0].state, "active");
  } finally { w.done(); }
});

test("a loosening from the owner's app inside the bounds goes the same way; above the template's bound it is refused against the template, not the runtime's word", async () => {
  const w = world();
  try {
    // the file holds ₹100 (the owner tightened it earlier); the Bookings bound is the deposit, ₹200
    writeFileSync(join(w.shopDir, "settings.json"), EXAMPLE.replace('"refundLimitInr": 200', '"refundLimitInr": 100'));
    w.s.file = 100;
    w.changes.push(change({ from: 100, to: 200, direction: "loosen", by: "owner_app" }));
    await limitStep(w.ctx, w.io, SHOP, w.kind);
    assert.equal(w.fileValue(), 200);
    assert.equal(w.changes[0].state, "active");
    w.changes.push(change({ id: "l-2", from: 200, to: 900, direction: "loosen", by: "owner_app" }));
    await limitStep(w.ctx, w.io, SHOP, w.kind);
    assert.equal(w.changes[1].state, "failed");
    assert.match(w.s.settled.at(-1)!, /not a looser value inside this template's bounds/u);
    assert.equal(w.fileValue(), 200);
  } finally { w.done(); }
});

test("one change at a time per shop: the oldest first; and a change to something that is not a declared limit is refused", async () => {
  const w = world();
  try {
    w.changes.push(change({ id: "l-2", from: 100, to: 50 }), change({ id: "l-1", from: 200, to: 100 }));
    await limitStep(w.ctx, w.io, SHOP, w.kind);
    assert.deepEqual(w.changes.map((c) => [c.id, c.state]), [["l-2", "pending"], ["l-1", "active"]], "l-1 went first, l-2 waits for the next pass");
    await limitStep(w.ctx, w.io, SHOP, w.kind);
    assert.equal(w.fileValue(), 50);
    w.changes.push(change({ id: "l-3", limit: "deposit", path: "deposit.amountInr", from: 200, to: 100 }));
    await limitStep(w.ctx, w.io, SHOP, w.kind);
    assert.equal(w.changes[2].state, "failed", "the deployer writes only declared paths");
    assert.equal(JSON.parse(readFileSync(join(w.shopDir, "settings.json"), "utf8")).deposit.amountInr, 200);
  } finally { w.done(); }
});

test("syncLimitChanges walks the deployed shops and never lets one shop's trouble stop the others", async () => {
  const w = world();
  try {
    w.changes.push(change());
    const lines = await syncLimitChanges(w.ctx, w.io, [SHOP, "not-deployed"]);
    assert.ok(lines.some((l) => /Active/u.test(l)));
    assert.equal(w.logs.length, lines.length);
  } finally { w.done(); }
});
