// The shop's model budget (modules/budget/budget.ts), as pure functions over a store with an `ai` state and a clock the test hands in. What is proved: the one meter adds exact
// rupees (whole micro-rupees, so paise, never floats); each feature's daily cap stops that feature and no other; the month's budget stops every feature together and acts like
// fleet's AI cap; the 80% and the used-up notices are each handed out once; a new month and a new day start the right counts again; the same message is never paid for twice;
// and the model Guard's wall is checked against the budgets. Then the router's own reader: the language step is left out over a cap and counted when it is asked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { HOUR, DAY } from "../../core/time.ts";
import { fakeClock } from "../../core/clock.ts";
import { createReader } from "../../understanding/reader.ts";
import { stateFor } from "../../understanding/ai-state.ts";
import type { AiStore } from "../../understanding/ai-state.ts";
import { DEFAULT_UNPRICED_CALL_MICRO_INR, gate, isBudgetConfig, levelOf, modelOff, record, stateOf, summaryOf, takeDayNotice, takeNotices, usedMicroInr, wallProblems } from "../budget.ts";
import type { BudgetConfig } from "../budget.ts";
import { costMicroInr } from "../../understanding/rates.ts";

const TZ = "Asia/Kolkata";
const T0 = Date.parse("2026-11-10T10:00:00+05:30");
const RUPEE = 1_000_000;
const cfg = (more: Partial<BudgetConfig> = {}): BudgetConfig => ({ monthlyMicroInr: 20 * RUPEE, daily: { owner_talk: 3, listing_draft: 2, customer_talk: 5, router: 4 }, ...more });
/** What a call costs the meter: added where the call is metered (talk-run.ts, reader.ts), here by hand. */
const spend = (s: AiStore, micro: number, at = T0) => { stateFor(s, at, TZ).costMicroInr += micro; };

test("the meter adds exact rupees from token counts: whole micro-rupees, rounded up, so paise are integers", () => {
  // DeepSeek V4.1 Flash at the table's rate, a talk turn of 2,500 tokens in and 250 out: priced by rates.ts, an integer of micro-rupees
  const rate = { provider: "deepinfra", model: "deepseek", from: "2026-11-07", inputUsdPerMillion: 0.2, outputUsdPerMillion: 0.6, inrPerUsd: 94, source: "test" };
  const one = costMicroInr(rate, { inputTokens: 2500, outputTokens: 250 })!;
  assert.ok(Number.isInteger(one));
  assert.equal(one, Math.ceil((2500 * 0.2 + 250 * 0.6) * 94 - 1e-9), "tokens x dollars per million = millionths of a dollar, times the rupee rate");
  const s: AiStore = {};
  for (let i = 0; i < 3; i++) spend(s, one);
  assert.equal(usedMicroInr(s, cfg(), T0, TZ), 3 * one, "three calls add exactly three prices");
  assert.equal(Math.floor((3 * one) / 10_000) % 1, 0, "and the paise are whole");
});

test("a call with no price counts at the assumed price against the budget, never as free", () => {
  const s: AiStore = {};
  stateFor(s, T0, TZ).unpriced += 2;
  assert.equal(usedMicroInr(s, cfg(), T0, TZ), 2 * DEFAULT_UNPRICED_CALL_MICRO_INR);
  assert.equal(usedMicroInr(s, cfg({ unpricedCallMicroInr: 500_000 }), T0, TZ), 1_000_000);
});

test("each daily cap stops its own feature and no other, and starts again the next day", () => {
  const s: AiStore = {};
  const c = cfg();
  for (let i = 0; i < 3; i++) { assert.deepEqual(gate(s, c, "owner_talk", T0, TZ), { ok: true }); record(s, c, "owner_talk", { costMicroInr: 50_000 }, T0, TZ); }
  assert.deepEqual(gate(s, c, "owner_talk", T0, TZ), { ok: false, why: "day" }, "the owner's talk is at its 3 a day");
  assert.deepEqual(gate(s, c, "listing_draft", T0, TZ), { ok: true }, "a draft is still allowed");
  for (let i = 0; i < 2; i++) record(s, c, "listing_draft", { costMicroInr: 90_000 }, T0, TZ);
  assert.deepEqual(gate(s, c, "listing_draft", T0, TZ), { ok: false, why: "day" });
  for (let i = 0; i < 5; i++) record(s, c, "customer_talk", { costMicroInr: 40_000 }, T0, TZ);
  assert.deepEqual(gate(s, c, "customer_talk", T0, TZ), { ok: false, why: "day" });
  for (let i = 0; i < 4; i++) record(s, c, "router", { costMicroInr: 10_000 }, T0, TZ);
  assert.deepEqual(gate(s, c, "router", T0, TZ), { ok: false, why: "day" });
  assert.deepEqual(gate(s, c, "buyer", T0, TZ), { ok: true }, "a feature with no daily cap is not stopped by the others");
  // the next local day: counts start again
  const tomorrow = T0 + DAY;
  for (const f of ["owner_talk", "listing_draft", "customer_talk", "router"] as const) assert.deepEqual(gate(s, c, f, tomorrow, TZ), { ok: true }, f);
  assert.deepEqual(stateOf(s, tomorrow, TZ).today, {});
});

test("the day is the shop's own day, not UTC's", () => {
  const s: AiStore = {};
  const c = cfg({ daily: { owner_talk: 1 } });
  const lateEvening = Date.parse("2026-11-10T23:30:00+05:30"); // 18:00 UTC the same day
  record(s, c, "owner_talk", { costMicroInr: 1 }, lateEvening, TZ);
  // time only moves forward: the state keeps one day, so asking about an earlier moment after a later one would (rightly) start that earlier day's counts again
  assert.equal(gate(s, c, "owner_talk", lateEvening + 10 * 60_000, TZ).ok, false, "ten minutes later, still the same day");
  assert.equal(gate(s, c, "owner_talk", lateEvening + HOUR, TZ).ok, true, "half past midnight at the shop is a new day (still 19:00 UTC of the old one)");
});

test("the month's budget stops every feature together, as fleet's AI cap does, and a new month resets it", () => {
  const s: AiStore = {};
  const c = cfg();
  spend(s, 19 * RUPEE);
  assert.equal(modelOff(s, { budget: c }, T0, TZ), null);
  assert.equal(gate(s, c, "owner_talk", T0, TZ).ok, true);
  spend(s, 1 * RUPEE); // exactly the budget
  assert.equal(modelOff(s, { budget: c }, T0, TZ), "budget");
  for (const f of ["owner_talk", "customer_talk", "listing_draft", "router", "buyer"] as const) assert.deepEqual(gate(s, c, f, T0, TZ), { ok: false, why: "month" }, f);
  assert.equal(modelOff(s, { budget: c, model: () => "off" }, T0, TZ), "fleet", "fleet's own word is named first when both hold");
  assert.equal(modelOff(s, {}, T0, TZ), null, "no budget, no fleet cap: never off");
  const december = Date.parse("2026-12-01T09:00:00+05:30");
  assert.equal(levelOf(s, c, december, TZ).level, "ok", "a new month starts the meter again");
  assert.equal(gate(s, c, "owner_talk", december, TZ).ok, true);
});

test("no budget at all is today's behaviour: every gate says yes and nothing is kept in the store", () => {
  const s: AiStore = {};
  assert.deepEqual(gate(s, undefined, "owner_talk", T0, TZ), { ok: true });
  record(s, undefined, "owner_talk", { costMicroInr: 1 }, T0, TZ);
  assert.equal(takeNotices(s, undefined, T0, TZ).length, 0);
  assert.equal(summaryOf(s, undefined, T0, TZ), null);
  assert.equal(s.ai, undefined, "a shop with no budget saves the same bytes as before");
});

test("the budget across features: the shared meter is judged, and the breakdown says who spent it", () => {
  const s: AiStore = {};
  const c = cfg();
  const calls: [Parameters<typeof record>[2], number][] = [["owner_talk", 6 * RUPEE], ["customer_talk", 5 * RUPEE], ["listing_draft", 3 * RUPEE], ["router", 2 * RUPEE]];
  for (const [f, micro] of calls) { spend(s, micro); record(s, c, f, { costMicroInr: micro }, T0, TZ); }
  const sum = summaryOf(s, c, T0, TZ)!;
  assert.equal(sum.usedMicroInr, 16 * RUPEE);
  assert.equal(sum.basisPoints, 8000);
  assert.equal(sum.level, "warn");
  assert.deepEqual([sum.features.owner_talk.micro, sum.features.customer_talk.micro, sum.features.listing_draft.micro, sum.features.router.micro], [6 * RUPEE, 5 * RUPEE, 3 * RUPEE, 2 * RUPEE]);
  assert.deepEqual([sum.features.owner_talk.today, sum.features.owner_talk.cap, sum.features.buyer.cap], [1, 3, null]);
});

test("the 80% notice and the used-up notice are each handed out once a month, in order, and again in a new month", () => {
  const s: AiStore = {};
  const c = cfg();
  spend(s, 15 * RUPEE);
  assert.deepEqual(takeNotices(s, c, T0, TZ), [], "75%: nothing yet");
  spend(s, 1 * RUPEE); // 80%
  assert.deepEqual(takeNotices(s, c, T0, TZ), ["warn"]);
  assert.deepEqual(takeNotices(s, c, T0 + HOUR, TZ), [], "told once");
  spend(s, 4 * RUPEE);
  assert.deepEqual(takeNotices(s, c, T0 + 2 * HOUR, TZ), ["full"]);
  assert.deepEqual(takeNotices(s, c, T0 + 3 * HOUR, TZ), [], "told once");
  // a month that jumps from fine to full says both, in order
  const j: AiStore = {};
  spend(j, 25 * RUPEE);
  assert.deepEqual(takeNotices(j, c, T0, TZ), ["warn", "full"]);
  // a new month: used again, told again
  const december = Date.parse("2026-12-02T09:00:00+05:30");
  spend(s, 17 * RUPEE, december);
  assert.deepEqual(takeNotices(s, c, december, TZ), ["warn"]);
});

test("a feature's daily notice is handed out once a day", () => {
  const s: AiStore = {};
  record(s, cfg(), "owner_talk", { costMicroInr: 1 }, T0, TZ);
  assert.equal(takeDayNotice(s, "owner_talk", T0, TZ), true);
  assert.equal(takeDayNotice(s, "owner_talk", T0 + HOUR, TZ), false);
  assert.equal(takeDayNotice(s, "listing_draft", T0, TZ), true, "each feature has its own");
  assert.equal(takeDayNotice(s, "owner_talk", T0 + DAY, TZ), true, "and again tomorrow");
});

test("a retry does not double count: a message paid for is not asked again, and the keys are bounded", () => {
  const s: AiStore = {};
  const c = cfg({ daily: { owner_talk: 100 } });
  assert.equal(gate(s, c, "owner_talk", T0, TZ, "o:m1").ok, true);
  record(s, c, "owner_talk", { costMicroInr: 50_000, key: "o:m1" }, T0, TZ);
  assert.deepEqual(gate(s, c, "owner_talk", T0, TZ, "o:m1"), { ok: false, why: "again" }, "the same message again: no second call");
  assert.equal(gate(s, c, "owner_talk", T0, TZ, "o:m2").ok, true, "another message is another call");
  assert.equal(stateOf(s, T0, TZ).today.owner_talk, 1, "and the day's count is one, not two");
  for (let i = 0; i < 100; i++) record(s, c, "owner_talk", { costMicroInr: 1, key: `o:x${i}` }, T0, TZ);
  assert.ok(stateOf(s, T0, TZ).keys!.length <= 60, "the keys kept are bounded");
});

test("a bad budget is refused: whole numbers only, known features, a cap of at least one", () => {
  assert.equal(isBudgetConfig(cfg()), true);
  assert.equal(isBudgetConfig({ monthlyMicroInr: 1.5, daily: {} }), false);
  assert.equal(isBudgetConfig({ monthlyMicroInr: -1, daily: {} }), false);
  assert.equal(isBudgetConfig({ monthlyMicroInr: 1, daily: { owner_talk: 0 } }), false);
  assert.equal(isBudgetConfig({ monthlyMicroInr: 1, daily: { telepathy: 5 } }), false);
  assert.equal(isBudgetConfig({ monthlyMicroInr: 1, daily: {}, extra: 1 }), false);
  assert.equal(isBudgetConfig({ monthlyMicroInr: 1, daily: {}, warnBasisPoints: 10_001 }), false);
  assert.equal(isBudgetConfig(null), false);
});

test("the model Guard's wall is checked against the budgets and the server's total", () => {
  const shops = Array.from({ length: 50 }, () => cfg({ monthlyMicroInr: 60 * RUPEE }));
  assert.deepEqual(wallProblems({ callsPerDay: 2000, shopBudgets: shops, worstCallMicroInr: 300_000 }), [], "2,000 a day at the dearest call could pay for ₹18,600 a month: above 50 budgets of ₹60");
  const low = wallProblems({ callsPerDay: 100, shopBudgets: shops, worstCallMicroInr: 300_000 });
  assert.equal(low.length, 1);
  assert.match(low[0], /stop shops before their own budgets do/u);
  const high = wallProblems({ callsPerDay: 2000, shopBudgets: shops, worstCallMicroInr: 300_000, serverMonthlyMicroInr: 5000 * RUPEE });
  assert.equal(high.length, 1);
  assert.match(high[0], /more than the server's total of ₹5000/u);
});

// ---- the router's reader: the language step is a feature of the budget ----------------------------------------------------------------------------------

function readerWorld(budget: BudgetConfig | undefined, fleetOff = false) {
  const clock = fakeClock(T0);
  const store: AiStore = {};
  const asked: (readonly string[])[] = [];
  const parser = {
    async parse() { return { kind: "x" }; },
    async parseDetailed(_text: string, _ctx: unknown, options?: { skipSteps?: readonly string[] }) {
      asked.push(options?.skipSteps ?? []);
      const skipped = options?.skipSteps?.includes("model");
      const understood = skipped
        ? { step: "rules" as const, provider: "rules", model: "rule-parser", inputTokens: 0, outputTokens: 0, costMicroInr: 0, rateDate: null, tried: ["rules" as const], failed: [] }
        : { step: "model" as const, provider: "fake", model: "m", inputTokens: 100, outputTokens: 20, costMicroInr: 4 * RUPEE, rateDate: "2026-11-07", tried: ["rules" as const, "model" as const], failed: [] };
      return { intent: { kind: "x" }, understood };
    },
  };
  const logged: string[] = [];
  const reader = createReader({
    parser: parser as never, context: {}, coerce: (r: unknown) => r as { kind: string }, policy: { ...(budget ? { budget } : {}), ...(fleetOff ? { model: () => "off" as const } : {}) }, store, clock, timeZone: TZ,
    log: (_a, _o, _i, more) => { logged.push(more.refs.mode ?? more.refs.reason ?? ""); }, tellOwner: async () => {},
  });
  const read = async () => { const r = await reader.readIntent("hello", {}); reader.countUnderstood(r.understood); return r; };
  return { reader, store, asked, read, logged, clock };
}

test("the router's language step is asked until its daily cap, then left out; the call is counted in the budget's breakdown", async () => {
  const w = readerWorld(cfg({ daily: { router: 2 }, monthlyMicroInr: 1000 * RUPEE }));
  await w.read(); await w.read();
  assert.deepEqual(w.asked, [[], []], "the first two reads may ask the language step");
  assert.equal(stateOf(w.store, T0, TZ).today.router, 2);
  await w.read();
  assert.deepEqual(w.asked[2], ["model"], "the third is read without it");
  assert.equal(stateOf(w.store, T0, TZ).today.router, 2, "and a call that was not made is not counted");
});

test("the month's budget leaves the router's language step out and says so once in the record; voice stops with it; fleet's cap does the same", async () => {
  const w = readerWorld(cfg({ monthlyMicroInr: 5 * RUPEE, daily: { router: 50 } }));
  await w.read(); // 4 rupees
  assert.equal(w.reader.voiceAllowed(), true);
  await w.read(); // 8 rupees: over
  assert.equal(w.reader.voiceAllowed(), false, "a voice note is model spend too");
  await w.read();
  assert.deepEqual(w.asked.at(-1), ["model"]);
  await w.reader.announceButtonMode();
  await w.reader.announceButtonMode();
  assert.equal(w.logged.filter((m) => m === "model_off").length, 1, "one line a month");
  const fleet = readerWorld(undefined, true);
  await fleet.read();
  assert.deepEqual(fleet.asked[0], ["model"], "fleet's cap still works with no budget at all");
});
