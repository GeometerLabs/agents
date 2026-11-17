// The pure rules of "limits, tightened by a tap": strictly tighter than the limit IN FORCE now (₹500 loosens ₹200), a pending change counted as in force, the hard
// bounds, and what a failed or loosening change does not do. Every template's declarations are checked here too, against the settings they name.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyInForce, baseValues, compactChanges, getAt, inForce, isStrictlyTighter, judgeChange, setAt, withinBounds } from "../chat-limits.ts";
import type { LimitChange } from "../chat-limits.ts";
import { bigOrderLimit, ordersPerDayLimit, refundLimit } from "../chat-limit-kinds.ts";

const refund = refundLimit("cancellation.refundLimitInr", () => ({ min: 0, max: 5000 }));
const big = bigOrderLimit("owner.approveOverInr", () => ({ min: 0, max: 100000 }));
const perDay = ordersPerDayLimit("orders.maxPerDay", () => ({ min: 1, max: 100 }));
const change = (o: Partial<LimitChange>): LimitChange => ({ id: "l-1", limit: "refund_limit", path: "cancellation.refundLimitInr", from: 1000, to: 200, direction: "tighten", by: "owner_chat", state: "pending", atMs: 1, ...o });

test("a lower amount is tighter, and the same or a higher one is not: ₹500 loosens a limit of ₹200", () => {
  assert.equal(isStrictlyTighter(refund, 1000, 500), true);
  assert.equal(isStrictlyTighter(refund, 200, 500), false, "the owner's words said 'refunds above 500' but that is looser than 200");
  assert.equal(isStrictlyTighter(refund, 200, 200), false, "nothing is offered that changes nothing");
  assert.equal(isStrictlyTighter(refund, 200, 0), true, "0 asks about every refund: the tightest");
  assert.equal(isStrictlyTighter(refund, 200, 150.5), false, "not a whole number");
});

test("for the big-order amount 0 means never, which is the loosest: any other number is tighter", () => {
  assert.equal(isStrictlyTighter(big, 0, 5000), true);
  assert.equal(isStrictlyTighter(big, 5000, 0), false);
  assert.equal(isStrictlyTighter(big, 5000, 3000), true);
});

test("a pending tightening counts as in force at once; a pending loosening, a failed change and an unrelated limit do not", () => {
  assert.equal(inForce(refund, 1000, [change({ to: 200 })]), 200);
  assert.equal(inForce(refund, 1000, [change({ to: 200, state: "failed" })]), 1000, "a failure leaves the previous limit");
  assert.equal(inForce(refund, 200, [change({ from: 200, to: 800, direction: "loosen", state: "pending" })]), 200, "a loosening is in force only when Guard has it");
  assert.equal(inForce(refund, 1000, [change({ limit: "orders_per_day", to: 3 })]), 1000);
  // two pending tightenings: the tighter wins whatever the order
  assert.equal(inForce(refund, 1000, [change({ id: "l-1", to: 300 }), change({ id: "l-2", from: 300, to: 100 })]), 100);
});

test("an active change whose file has not caught up counts; one the file has moved past does not", () => {
  assert.equal(inForce(refund, 1000, [change({ state: "active", to: 200 })]), 200, "the file is written but the runtime has not restarted");
  assert.equal(inForce(refund, 700, [change({ state: "active", from: 1000, to: 200 })]), 700, "the panel changed the file another way: the file wins");
  assert.equal(inForce(refund, 200, [change({ state: "active", from: 1000, to: 200 })]), 200, "after the restart the file says it");
});

test("judgeChange: a second tap is compared with a pending change, not with the older file", () => {
  const settings = {};
  const pending = [change({ to: 200 })];
  assert.deepEqual(judgeChange(refund, { settings, base: 1000, changes: pending, to: 300, direction: "tighten" }), { ok: false, why: "not_tighter", from: 200 });
  assert.deepEqual(judgeChange(refund, { settings, base: 1000, changes: pending, to: 100, direction: "tighten" }), { ok: true, from: 200 });
  assert.deepEqual(judgeChange(refund, { settings, base: 1000, changes: [], to: 500, direction: "tighten" }), { ok: true, from: 1000 });
  assert.equal(judgeChange(refund, { settings, base: 200, changes: [], to: 500, direction: "tighten" }).ok, false, "₹500 vs ₹200");
  assert.equal(judgeChange(refund, { settings, base: 1000, changes: [], to: -5, direction: "tighten" }).ok, false);
});

test("loosening is looser than now, inside the hard bounds, and not while another change to it is being applied", () => {
  const settings = {};
  assert.deepEqual(judgeChange(refund, { settings, base: 200, changes: [], to: 800, direction: "loosen" }), { ok: true, from: 200 });
  assert.equal(judgeChange(refund, { settings, base: 200, changes: [], to: 6000, direction: "loosen" }).ok, false, "above the template's hard bound");
  assert.equal(judgeChange(refund, { settings, base: 200, changes: [], to: 100, direction: "loosen" }).ok, false, "that is tighter, not looser");
  const busy = judgeChange(refund, { settings, base: 200, changes: [change({ from: 1000, to: 200 })], to: 800, direction: "loosen" });
  assert.deepEqual([busy.ok, busy.ok ? "" : busy.why], [false, "busy"]);
  assert.equal(judgeChange(perDay, { settings, base: 10, changes: [], to: 0, direction: "tighten" }).ok, false, "below the bound of 1");
  assert.equal(judgeChange(big, { settings, base: 5000, changes: [], to: 0, direction: "loosen" }).ok, true, "turning the big-order check off is a loosening, allowed in the app");
});

test("the overlay puts what is in force into the settings the agent reads, and takes it away on a failure", () => {
  const settings = { cancellation: { refundLimitInr: 1000 } };
  const base = baseValues([refund], settings);
  assert.deepEqual(base, { refund_limit: 1000 });
  assert.deepEqual(applyInForce([refund], settings, base, [change({ to: 200 })]), ["refund_limit"]);
  assert.equal(getAt(settings, "cancellation.refundLimitInr"), 200);
  assert.deepEqual(applyInForce([refund], settings, base, [change({ to: 200, state: "failed" })]), ["refund_limit"]);
  assert.equal(getAt(settings, "cancellation.refundLimitInr"), 1000, "the previous limit is in force again");
  assert.equal(setAt(settings, "cancellation.notThere", 1), false, "a change never adds a field");
  assert.equal(withinBounds(refund, settings, 5000), true);
  assert.equal(withinBounds(refund, settings, 5001), false);
});

test("settled changes are trimmed to the newest, a pending one never", () => {
  const list: LimitChange[] = [change({ id: "l-0" }), ...Array.from({ length: 35 }, (_, i) => change({ id: `l-${i + 1}`, state: "active" }))];
  const gone = compactChanges(list);
  assert.equal(gone, 5);
  assert.ok(list.some((c) => c.id === "l-0" && c.state === "pending"));
  assert.equal(list.length, 31);
});

test("a tightening is fenced only at the tight end: a limit above its hard bound can still be tightened, a loosening cannot go past the bound", () => {
  const bounded = refundLimit("cancellation.refundLimitInr", () => ({ min: 0, max: 200 })); // a ₹200 deposit: the bound
  assert.equal(judgeChange(bounded, { settings: {}, base: 1000, changes: [], to: 500, direction: "tighten" }).ok, true, "₹1,000 to ₹500 is tighter, though ₹500 is above the bound");
  assert.equal(judgeChange(bounded, { settings: {}, base: 1000, changes: [], to: -1, direction: "tighten" }).ok, false);
  assert.equal(judgeChange(bounded, { settings: {}, base: 100, changes: [], to: 500, direction: "loosen" }).ok, false, "a loosening may not pass the bound");
  assert.equal(judgeChange(bounded, { settings: {}, base: 100, changes: [], to: 200, direction: "loosen" }).ok, true);
});
