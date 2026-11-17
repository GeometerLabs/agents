// The runtime core's part of "limits, tightened by a tap" (modules/limits/runtime-limits.ts): a settle makes a change Active or Failed once, a failure drops the runtime's
// tighter value, a redelivery changes nothing, and the owner's own limits page decides the direction from the numbers and stays inside the hard bounds.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeClock } from "../../core/clock.ts";
import { createRecord } from "../../record/record.ts";
import { emptyAssistantState } from "../../assistant/state.ts";
import type { AssistantState } from "../../assistant/state.ts";
import { checkOwnerLimit, checkSettled, createLimitsKit, limitsEventKey } from "../runtime-limits.ts";
import { CHAT_LIMITS } from "../../../templates/commerce/orders/src/chat-limits.ts";

const owner = { whatsapp: "+919811111111", language: "en" as const };
function kit() {
  const settings = { owner: { approveOverInr: 0 }, refund: { limitInr: 1000 }, orders: { maxPerDay: 30 } };
  const clock = fakeClock(1_800_000_000_000);
  const k = createLimitsKit<{ assistant?: AssistantState }>({ declared: CHAT_LIMITS, settings, clock, owner });
  const store: { assistant?: AssistantState } = { assistant: emptyAssistantState() };
  const record = createRecord(clock);
  return { k, settings, store, record, ctx: { store, record } };
}
const pending = (store: { assistant?: AssistantState }, to: number) => store.assistant!.limitChanges.push({ id: "l-1", limit: "refund_limit", path: "refund.limitInr", from: 1000, to, direction: "tighten", by: "owner_chat", state: "pending", atMs: 1 });

test("a pending tightening is applied to the settings before the step; a failure puts the previous limit back", () => {
  const { k, settings, store, ctx } = kit();
  pending(store, 300);
  k.apply(store);
  assert.equal(settings.refund.limitInr, 300);
  k.run({ kind: "limit_settled", id: "r-1", change: "l-1", result: "failed", why: "the deploy did not go through" }, ctx);
  assert.equal(store.assistant!.limitChanges[0].state, "failed");
  assert.equal(settings.refund.limitInr, 1000, "the runtime dropped its tighter value in the same step");
  const line = ctx.record.entries().at(-1)!;
  assert.deepEqual([line.action, line.outcome, line.refs.state], ["limit_change", "failed", "failed"]);
});

test("active settles once; a redelivery or a word about no change does nothing but say so in the record", () => {
  const { k, settings, store, ctx } = kit();
  pending(store, 300);
  k.run({ kind: "limit_settled", id: "r-2", change: "l-1", result: "active" }, ctx);
  assert.equal(store.assistant!.limitChanges[0].state, "active");
  assert.equal(typeof store.assistant!.limitChanges[0].settledAtMs, "number");
  assert.equal(settings.refund.limitInr, 300, "an active change whose file the runtime has not read yet still counts");
  k.run({ kind: "limit_settled", id: "r-3", change: "l-1", result: "failed" }, ctx);
  assert.equal(store.assistant!.limitChanges[0].state, "active", "a settled change is not unsettled");
  k.run({ kind: "limit_settled", id: "r-4", change: "l-77", result: "active" }, ctx);
  assert.deepEqual(ctx.record.entries().slice(-2).map((e) => e.outcome), ["blocked", "blocked"]);
});

test("the owner's own page: a loosening within the bounds is Pending (not in force until Active); out of bounds or no change is refused in the record", () => {
  const { k, settings, store, ctx } = kit();
  k.run({ kind: "owner_limit", id: "o-1", limit: "refund_limit", to: 1500 }, ctx);
  const c = store.assistant!.limitChanges[0];
  assert.deepEqual([c.direction, c.by, c.state, c.from, c.to], ["loosen", "owner_app", "pending", 1000, 1500]);
  assert.equal(settings.refund.limitInr, 1000, "a loosening is in force only when Guard has it");
  k.run({ kind: "owner_limit", id: "o-2", limit: "refund_limit", to: 1800 }, ctx);
  assert.equal(store.assistant!.limitChanges.length, 1, "another change to it waits until the first settles");
  k.run({ kind: "owner_limit", id: "o-3", limit: "orders_per_day", to: 20000 }, ctx);
  k.run({ kind: "owner_limit", id: "o-4", limit: "not_a_limit", to: 5 }, ctx);
  assert.equal(store.assistant!.limitChanges.length, 1);
  assert.equal(ctx.record.entries().filter((e) => e.outcome === "blocked").length, 2);
  k.run({ kind: "limit_settled", id: "r-5", change: "l-2", result: "active" }, ctx);
  k.run({ kind: "limit_settled", id: "r-6", change: "l-1", result: "active" }, ctx);
  k.apply(store);
  assert.equal(settings.refund.limitInr, 1500);
});

test("the owner's page tightening is a tightening, decided by the numbers; the same value is nothing", () => {
  const { k, store, ctx } = kit();
  k.run({ kind: "owner_limit", id: "o-1", limit: "refund_limit", to: 400 }, ctx);
  assert.equal(store.assistant!.limitChanges[0].direction, "tighten");
  k.run({ kind: "owner_limit", id: "o-2", limit: "refund_limit", to: 400 }, ctx);
  assert.equal(store.assistant!.limitChanges.length, 1);
  const view = k.view(store);
  assert.deepEqual(view.limits.map((l) => [l.id, l.inForce, l.file]), [["big_order_limit", 0, 0], ["refund_limit", 400, 1000], ["orders_per_day", 30, 30]]);
});

test("the events' shapes are checked, and a redelivery has the same key", () => {
  assert.equal(checkSettled({ id: "r-1", change: "l-3", result: "active" }).ok, true);
  assert.equal(checkSettled({ id: "r-1", change: "../x", result: "active" }).ok, false);
  assert.equal(checkSettled({ id: "r-1", change: "l-3", result: "maybe" }).ok, false);
  const long = checkSettled({ id: "r-1", change: "l-3", result: "failed", why: "x".repeat(500) });
  assert.equal(long.ok && long.event.why?.length, 160);
  assert.equal(checkOwnerLimit({ id: "o-1", limit: "refund_limit", to: 5.5 }).ok, false);
  assert.equal(checkOwnerLimit({ id: "o-1", limit: "refund_limit", to: 500 }).ok, true);
  assert.equal(limitsEventKey({ kind: "owner_limit", id: "o-1", limit: "x", to: 1 }), "owner_limit:o-1");
});
