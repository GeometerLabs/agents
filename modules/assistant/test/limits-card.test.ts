// "Limits, tightened by a tap" on the assistant's side (modules/assistant/limits-card.ts): the rules read the limit and the value from the words, the backend checks the
// value is strictly tighter than the limit in force now (₹500 loosens ₹200; a pending change counts), the card's digest is void when the limit changed between card and
// tap, a tap makes a Pending change the runtime obeys at once, and the chat never loosens. The card binding itself is cards.ts's, used unchanged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { actionDigest, judgeCard, makeCard } from "../cards.ts";
import { createLimits, limitCardLine, limitCase, limitLine, looksLikeLimitRule, readLimitRequest, viewOf } from "../limits-card.ts";
import { readOwnerRules } from "../intents.ts";
import { emptyAssistantState } from "../state.ts";
import type { AssistantState, CardRecord } from "../state.ts";
import type { Proposal } from "../skill.ts";
import { Writer, write } from "../words.ts";
import { CHAT_LIMITS as ORDERS } from "../../../templates/commerce/orders/src/chat-limits.ts";
import { CHAT_LIMITS as BOOKINGS } from "../../../templates/commerce/bookings/src/chat-limits.ts";

const NOW = 1_800_000_000_000;
type Line = { action: string; outcome: string; refs: Record<string, string> };

/** A bookings-like shop: the refund limit at the given rupees, and a place for the assistant's state. */
function shop(refundLimitInr: number) {
  const settings = { cancellation: { refundLimitInr }, deposit: { amountInr: 2000 } };
  const store: { assistant?: AssistantState } = { assistant: emptyAssistantState() };
  const lines: Line[] = [];
  const limits = createLimits({ declared: BOOKINGS, settings, store, nowMs: () => NOW, log: (action, outcome, _i, refs) => lines.push({ action, outcome, refs }) });
  return { settings, store, lines, limits, state: store.assistant! };
}
const propose = (to: number): Proposal => ({ kind: "limit", case: limitCase("refund_limit"), to });
const tap = (s: ReturnType<typeof shop>, card: CardRecord) => judgeCard(card, "yes", NOW, (c) => { const p = s.limits.skill.prepare(c.proposal as unknown as Proposal); return p.ok ? { ok: true as const, action: p.action } : { ok: false as const, why: p.why }; });

test("the rules read which limit and what value from the words, in four languages; a model never writes the value", () => {
  const r = readLimitRequest("refunds above ₹500 need my OK", BOOKINGS);
  assert.deepEqual(r.kind === "ok" ? [r.limit.id, r.to] : r, ["refund_limit", 500]);
  const hi = readLimitRequest("500 रुपये से ऊपर के रिफंड मुझसे पूछो", BOOKINGS);
  assert.deepEqual(hi.kind === "ok" ? [hi.limit.id, hi.to] : hi, ["refund_limit", 500]);
  assert.equal(readLimitRequest("refunds above 500", BOOKINGS).kind, "need_value", "a bare number is never money");
  assert.equal(readLimitRequest("never book Priya after 6", BOOKINGS).kind, "which", "no declared limit: M1 saves it as a note");
  const orders = readLimitRequest("at most 20 orders a day", ORDERS);
  assert.deepEqual(orders.kind === "ok" ? [orders.limit.id, orders.to] : orders, ["orders_per_day", 20]);
  const big = readLimitRequest("orders above ₹3,000 need my OK", ORDERS);
  assert.deepEqual(big.kind === "ok" ? [big.limit.id, big.to] : big, ["big_order_limit", 3000]);
  // a talk model may name the limit by id (forced), still only among the declared ones, and the value still comes from the words
  const forced = readLimitRequest("make it ₹300", ORDERS, "refund_limit");
  assert.deepEqual(forced.kind === "ok" ? [forced.limit.id, forced.to] : forced, ["refund_limit", 300]);
  assert.equal(readLimitRequest("make it ₹300", ORDERS, "invented_limit").kind, "which");
});

test("a rule about a limit with no case reference is read as a limit, not as a refund or a list; a refund naming a booking still is a refund", () => {
  const context = { kinds: ["refund", "limit", "waiting"] as never, limitRule: (t: string) => looksLikeLimitRule(t, BOOKINGS) };
  assert.equal(readOwnerRules("refunds above ₹500 need my OK", context).kind, "limit");
  assert.equal(readOwnerRules("refund ₹500 to b-14", context).kind, "refund");
  assert.equal(readOwnerRules("what needs me", context).kind, "waiting");
  assert.equal(looksLikeLimitRule("refunds above ₹500 need my OK", []), false, "a shop with no declared limit reads nothing as one");
});

test("₹500 loosens a limit of ₹200: no card, and the words say how to loosen", () => {
  const s = shop(200);
  const read = s.limits.read("refunds above ₹500 need my OK");
  const say = s.limits.say(read);
  assert.equal(say?.what, "not_tighter");
  const prepared = s.limits.skill.prepare(propose(500));
  assert.deepEqual([prepared.ok, prepared.ok ? "" : prepared.why], [false, "limit_not_tighter"]);
  assert.match(limitLine(say!, "en", new Writer("en", "Asia/Kolkata")), /loosen it/);
  assert.equal(s.state.limitChanges.length, 0, "nothing was changed");
});

test("the card shows the current and proposed rule; the tap makes a Pending change, which the runtime obeys at once", async () => {
  const s = shop(1000);
  assert.equal(s.limits.say(s.limits.read("refunds above ₹500 need my OK")), undefined, "a tightening becomes a card");
  const prepared = s.limits.skill.prepare(propose(500));
  assert.ok(prepared.ok);
  if (!prepared.ok) return;
  const view = prepared.shown.limit!;
  assert.deepEqual([view.now, view.to], [1000, 500]);
  const text = write("card", { kind: "limit", who: "", ref: "limit:refund_limit", what: "refund_limit", amountPaise: 50_000, code: "K7M2QX", hasNo: true, limit: view }, "en", "Asia/Kolkata").text;
  assert.match(text, /Refunds above ₹500 need your approval\. Now: ₹1,000\./);
  const { card } = makeCard(s.state, prepared.action, propose(500) as never, NOW);
  assert.equal(s.state.limitChanges.length, 0, "nothing changes before the tap");
  const v = tap(s, card);
  assert.equal(v.verdict, "do");
  const done = await s.limits.skill.execute(card.action);
  assert.equal(done.ok, true);
  assert.deepEqual(s.state.limitChanges.map((c) => [c.id, c.limit, c.from, c.to, c.state, c.by, c.direction]), [["l-2", "refund_limit", 1000, 500, "pending", "owner_chat", "tighten"]]);
  assert.equal((s.settings as { cancellation: { refundLimitInr: number } }).cancellation.refundLimitInr, 500, "the runtime's own checks use the tighter value at once");
  assert.deepEqual(s.lines.map((l) => [l.action, l.outcome, l.refs.state]), [["limit_change", "unconfirmed", "pending"]]);
});

test("the card's digest is void when the limit changed between the card and the tap; the second change is compared with the first", async () => {
  const s = shop(1000);
  const p = s.limits.skill.prepare(propose(500));
  assert.ok(p.ok);
  if (!p.ok) return;
  const { card } = makeCard(s.state, p.action, propose(500) as never, NOW);
  // another change landed first: the limit in force is now 300, so 500 is no longer tighter
  s.state.limitChanges.push({ id: "l-9", limit: "refund_limit", path: "cancellation.refundLimitInr", from: 1000, to: 300, direction: "tighten", by: "owner_app", state: "pending", atMs: NOW });
  const v = tap(s, card);
  assert.equal(v.verdict, "gone", "500 no longer tightens 300: nothing is done");
  // and if it still tightened, the digest differs because the value now differs
  const p2 = s.limits.skill.prepare(propose(100));
  assert.ok(p2.ok);
  if (p2.ok) assert.notEqual(actionDigest(p2.action), actionDigest(p.action));
  const forged = await s.limits.skill.execute(card.action);
  assert.equal(forged.ok, false, "even a saved action is checked again where it is done");
  assert.equal(s.state.limitChanges.length, 1);
});

test("a settled change is told to the owner once: Active, or failed with the previous limit still in force", () => {
  const s = shop(1000);
  s.state.limitChanges.push({ id: "l-1", limit: "refund_limit", path: "cancellation.refundLimitInr", from: 1000, to: 500, direction: "tighten", by: "owner_chat", state: "active", atMs: NOW });
  s.state.limitChanges.push({ id: "l-2", limit: "refund_limit", path: "cancellation.refundLimitInr", from: 500, to: 200, direction: "tighten", by: "owner_chat", state: "failed", atMs: NOW, why: "the deploy did not go through" });
  s.state.limitChanges.push({ id: "l-3", limit: "refund_limit", path: "cancellation.refundLimitInr", from: 500, to: 100, direction: "tighten", by: "owner_chat", state: "pending", atMs: NOW });
  const told = s.limits.unannounced();
  assert.deepEqual(told.map((t) => t.say.what), ["active", "failed"]);
  const w = new Writer("en", "Asia/Kolkata");
  assert.match(limitLine(told[0].say, "en", w), /^Active: Refunds above ₹500 need your approval\./);
  assert.match(limitLine(told[1].say, "en", new Writer("en", "Asia/Kolkata")), /previous limit is still in force: Refunds above ₹500/);
  assert.deepEqual(s.limits.unannounced(), [], "said once");
  assert.equal(s.state.limitChanges.find((c) => c.id === "l-3")?.told, undefined, "a pending one is not announced");
});

test("the words exist in four languages for the card and every message, and use no word the product never says", () => {
  const view = { ...viewOf(ORDERS[0]), now: 0, to: 5000 };
  for (const language of ["en", "hi", "ml", "kn"] as const) {
    const w = new Writer(language, "Asia/Kolkata");
    const lines = [limitCardLine(view, language, w), ...[
      { what: "pending", limit: viewOf(ORDERS[1]), to: 300 }, { what: "active", limit: viewOf(ORDERS[2]), to: 20 }, { what: "failed", limit: viewOf(ORDERS[1]), from: 500 }, { what: "need_value", limit: viewOf(ORDERS[1]) },
      { what: "which", limits: ORDERS.map(viewOf) }, { what: "loosen_app" }, { what: "not_tighter", limit: viewOf(ORDERS[1]), now: 200, to: 500 },
    ].map((s) => limitLine(s as never, language, new Writer(language, "Asia/Kolkata")))];
    for (const l of lines) { assert.ok(l.length > 10, l); assert.doesNotMatch(l, /\b(safe|guaranteed|proves|certified|earn|income|bot|founder)\b|100%/iu); }
  }
  assert.match(limitCardLine(view, "en", new Writer("en", "Asia/Kolkata")), /Now: never/, "a big-order amount of 0 is never");
});
