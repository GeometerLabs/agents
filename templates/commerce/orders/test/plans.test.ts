// Monthly plans (17 Nov 2026): the settings block, the period dates, the entitlement ledger's rules (cut-off, one credit, one renewal, nothing after a cancel, credit within what was
// paid) and the agent end to end on the in-memory fakes: subscribe, pay by the owner's UPI mark, skip, refused after the cut-off, pause across a renewal, renewal and carried credit,
// a renewal paid twice, a cancel while a reminder is queued, capacity shared with one-off orders, and a shop without plans unchanged. Written, not run, on 17 Nov.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AMIT, RAJESH, annapurna, annapurnaPlans, createWorld } from "../src/harness.ts";
import { parseSettings, validateSettings } from "../src/settings.ts";
import type { Settings } from "../src/settings.ts";
import { addMonths, creditInr, keyOf, mealDates, periodRange } from "../src/plans/periods.ts";
import { cancelPlan, cutoffMsFor, newDays, pauseFrom, resumeFrom, settle, skipDay } from "../src/plans/ledger.ts";
import type { Plan, PlanPeriod, PlanRules } from "../src/plans/ledger.ts";
import { readPlanIntent } from "../src/plans/words.ts";
import { zonedToMs } from "../../../../modules/core/time.ts";

const raw = (name = "annapurna-tiffins-plans") => JSON.parse(readFileSync(new URL(`../settings/${name}.example.json`, import.meta.url), "utf8")) as Record<string, any>;
const IST = "Asia/Kolkata";
const at = (month: number, day: number, hour = 10, minute = 0) => zonedToMs({ year: 2026, month, day }, { hour, minute }, IST);
const rules = (credits: "carry" | "refund" = "carry"): PlanRules => ({ timeZone: IST, cutoff: { daysBefore: 1, time: "20:00" }, weekdays: [1, 2, 3, 4, 5], credits });

/** A plan with one paid month starting Tue 10 Nov 2026 (22 weekday meals), for the ledger's own rules. */
function paidPlan(credits: "carry" | "refund" = "carry"): { plan: Plan; period: PlanPeriod } {
  const plan: Plan = { id: "p-1", customer: "+910", language: "en", typeId: "lunch-weekdays", slotId: "lunch", mode: "pickup", state: "active", startKey: "2026-11-10", periods: [], pauses: [], balance: [] };
  const made = newDays(plan, rules(credits).weekdays, { year: 2026, month: 11, day: 10 }, 0);
  const period: PlanPeriod = { index: 0, from: made.from, to: made.to, priceInr: 2400, dueInr: 2400, taken: [], orderId: "o-1", days: made.days, state: "paid" };
  plan.periods.push(period);
  return { plan, period };
}

// ---- settings ------------------------------------------------------------------------------------------------------------------

test("the settings: a plans block is read, a bad one is said in plain words, and a shop without one has none", () => {
  const s = parseSettings(raw());
  assert.equal(s.plans?.types.length, 2);
  assert.equal(s.plans?.credits, "carry");
  assert.deepEqual(s.plans?.cutoff, { daysBefore: 1, time: "20:00" });
  assert.equal(parseSettings(raw("annapurna-tiffins")).plans, undefined, "left out: no plans, as before");
  const bad = raw();
  bad.plans.types[0].slotId = "nowhere";
  bad.plans.types[1].weekdays = [1, 9];
  bad.plans.credits = "both";
  const result = validateSettings(bad);
  assert.equal(result.ok, false);
  if (!result.ok) { const text = result.errors.join("\n"); assert.match(text, /slotId/u); assert.match(text, /not a day of the week/u); assert.match(text, /plans\.credits/u); }
  const dear = raw();
  dear.plans.types[0].priceInr = 99_999;
  assert.equal(validateSettings(dear).ok, false, "a month dearer than the day's refund cap is refused");
});

// ---- periods -----------------------------------------------------------------------------------------------------------------------

test("periods: counted from the start day, contiguous, the 31st never drifts, and a credit is rounded down within the price", () => {
  assert.deepEqual(addMonths({ year: 2026, month: 1, day: 31 }, 1), { year: 2026, month: 2, day: 28 });
  assert.deepEqual(addMonths({ year: 2026, month: 1, day: 31 }, 2), { year: 2026, month: 3, day: 31 });
  const a = periodRange({ year: 2026, month: 1, day: 31 }, 0);
  const b = periodRange({ year: 2026, month: 1, day: 31 }, 1);
  assert.equal(keyOf(a.to), "2026-02-27");
  assert.equal(keyOf(b.from), "2026-02-28");
  assert.equal(mealDates(periodRange({ year: 2026, month: 11, day: 10 }, 0), [1, 2, 3, 4, 5]).length, 22);
  assert.equal(creditInr(2400, 22, 1), 109);
  assert.equal(creditInr(2400, 22, 22), 2400, "all the days are worth the price and no more");
  assert.equal(creditInr(2400, 22, 3, 100), 100, "never more than was paid for the period");
  assert.ok(22 * creditInr(2400, 22, 1) <= 2400, "the credits of every day never add up to more than the price");
});

// ---- the ledger's rules ----------------------------------------------------------------------------------------------------------

test("skip: before the cut-off it is recorded; after it, it is refused with the cut-off time; the same day twice is one day", () => {
  const { plan } = paidPlan();
  const r = rules();
  assert.equal(cutoffMsFor(r, "2026-11-12"), at(11, 11, 20));
  const ok = skipDay(plan, "2026-11-12", r, at(11, 11, 19, 59));
  assert.equal(ok.ok, true);
  const again = skipDay(plan, "2026-11-12", r, at(11, 11, 19, 59));
  assert.equal(again.ok, false);
  const late = skipDay(plan, "2026-11-13", r, at(11, 12, 20, 0)); // the moment itself is too late
  assert.ok(!late.ok && late.why === "after_cutoff" && late.cutoffMs === at(11, 12, 20, 0));
  assert.equal(plan.periods[0].days["2026-11-13"], "due", "a refused skip changes nothing");
  const weekend = skipDay(plan, "2026-11-14", r, at(11, 10));
  assert.ok(!weekend.ok && weekend.why === "no_meal");
});

test("a pause that spans the renewal date: each day is credited once, in its own period, and nothing is credited twice", () => {
  const { plan, period } = paidPlan();
  const r = rules("carry");
  assert.equal(skipDay(plan, "2026-12-01", r, at(11, 20)).ok, true);
  assert.equal(pauseFrom(plan, "2026-12-01", r, at(11, 20)).ok, true); // 1 Dec was skipped: pausing from it must not count it again
  assert.equal(period.days["2026-12-01"], "skipped");
  assert.equal(period.days["2026-12-02"], "paused");
  const next = newDays(plan, r.weekdays, { year: 2026, month: 11, day: 10 }, 1);
  assert.ok(Object.values(next.days).every((s) => s === "paused"), "the next month, made later, starts paused: the pause is the plan's");
  const s = settle(plan, period, r, at(12, 8, 21));
  const days = Object.values(period.days).filter((d) => d === "skipped" || d === "paused").length;
  assert.equal(s.amountInr, creditInr(2400, 22, days));
  assert.equal(plan.balance.length, 1);
  const second = settle(plan, period, r, at(12, 8, 22));
  assert.equal(second.decision.verdict, "block", "one credit per period");
  assert.equal(plan.balance.reduce((n, p) => n + p.amountInr, 0), s.amountInr, "the balance did not grow");
  const back = resumeFrom(plan, "2026-12-14", r, at(12, 9));
  assert.equal(back.ok, true);
  assert.equal(plan.pauses[0].to, "2026-12-13");
});

test("a credit and a refund for the same day: a day is skipped, paused or cancelled once, and a settled period is never settled again as the other kind", () => {
  const { plan, period } = paidPlan("refund");
  const r = rules("refund");
  assert.equal(skipDay(plan, "2026-11-20", r, at(11, 10)).ok, true);
  const first = settle(plan, period, r, at(12, 9));
  assert.equal(first.kind, "refunded");
  assert.equal(plan.balance.length, 0, "refunded, so nothing is carried: never both");
  const { decision } = cancelPlan(plan, r, at(12, 9));
  assert.equal(decision.verdict, "allow");
  const again = settle(plan, period, r, at(12, 9, 1));
  assert.equal(again.decision.verdict, "block");
  assert.equal(plan.balance.length, 0);
  assert.equal(period.settlement?.kind, "refunded");
});

test("a cancelled plan: days whose cut-off is ahead are cancelled, days already closed stay, and no skip or pause is taken after", () => {
  const { plan, period } = paidPlan();
  const r = rules();
  cancelPlan(plan, r, at(11, 12, 10));
  assert.equal(period.days["2026-11-12"], "due", "its cut-off (11 Nov 8 pm) has passed: the kitchen made it");
  assert.equal(period.days["2026-11-13"], "cancelled");
  assert.equal(skipDay(plan, "2026-11-16", r, at(11, 12, 11)).ok, false);
  assert.equal(pauseFrom(plan, "2026-11-16", r, at(11, 12, 11)).ok, false);
});

test("the words: a plan is read only where a plan is meant", () => {
  const types = parseSettings(raw()).plans!.types;
  const read = (t: string, has: boolean) => readPlanIntent(t, has, types, ["en", "hi"])?.kind;
  assert.equal(read("2 veg thali tomorrow lunch pickup", false), undefined);
  assert.equal(read("cancel", true), undefined, "a bare cancel is about an order");
  assert.equal(read("I want the monthly lunch plan", false), "subscribe");
  assert.equal(read("skip tomorrow", true), "skip");
  assert.equal(read("skip tomorrow", false), undefined);
  assert.equal(read("pause from monday", true), "pause");
  assert.equal(read("resume from 25 nov", true), "resume");
  assert.equal(read("cancel my plan", true), "cancel_plan");
});

// ---- the agent ---------------------------------------------------------------------------------------------------------------------

const planOf = (w: ReturnType<typeof createWorld>) => Object.values(w.store.plans?.plans ?? {}).find((p) => !p.id.startsWith("pending"))!;
async function subscribed(settings: Settings = annapurnaPlans()) {
  const w = createWorld({ settings });
  await w.say("I want the monthly lunch plan", { from: AMIT });
  assert.match(w.lastTextTo(AMIT), /lunch.*plan: 22 meals from Tue 10 Nov to Wed 9 Dec/su);
  const upi = settings.payment.module === "upi";
  if (upi) await w.ownerMarksReceived(AMIT); else { w.pays(AMIT); await w.deliverPaymentEvents(); }
  return w;
}

test("subscribe, pay by the owner's mark: the plan is on, the owner is told, the period's order is a record and never a meal order", async () => {
  const w = await subscribed();
  const plan = planOf(w);
  assert.equal(plan.periods[0].state, "paid");
  assert.match(w.lastTextTo(AMIT), /plan is on: 22 meals/u);
  assert.ok(w.textsTo(w.owner).some((t) => /New monthly plan p-1/u.test(t)));
  const o = w.store.orders.get(plan.periods[0].orderId)!;
  assert.equal(o.state, "completed");
  assert.equal(o.date, undefined, "no day and no slot: it never counts as an order in a slot");
  assert.equal(w.record.entries().filter((e) => e.action === "confirm_order").length, 0, "a plan's payment is not an order confirmed");
});

test("skip before the cut-off is a credit; after it the customer is told the cut-off time and nothing changes", async () => {
  const w = await subscribed();
  await w.say("skip tomorrow", { from: AMIT });
  assert.match(w.lastTextTo(AMIT), /Skipped: no .* meal on Tue 10 Nov/u);
  assert.equal(planOf(w).periods[0].days["2026-11-10"], "skipped");
  await w.goto({ year: 2026, month: 11, day: 10 }, { hour: 21, minute: 0 }); // Tue 9 pm: Wed's cut-off was Tue 8 pm
  await w.say("skip tomorrow", { from: AMIT });
  assert.match(w.lastTextTo(AMIT), /too late for Wed 11 Nov: that day closed at Tue 10 Nov, 8:00 pm/u);
  assert.equal(planOf(w).periods[0].days["2026-11-11"], "due");
});

test("the renewal: asked once, with the credit taken off, paid by a mark, matched to its period; a month's credit is carried, not refunded", async () => {
  const w = await subscribed();
  await w.say("skip 12 nov", { from: AMIT });
  await w.goto({ year: 2026, month: 12, day: 8 }, { hour: 21, minute: 0 });
  const plan = planOf(w);
  assert.equal(plan.periods.length, 2);
  assert.equal(plan.periods[0].settlement?.kind, "carried");
  assert.equal(plan.periods[1].dueInr, 2400 - plan.periods[0].settlement!.amountInr);
  assert.match(w.lastTextTo(AMIT), /plan renews from Thu 10 Dec/u);
  await w.tick();
  await w.tick();
  assert.equal(plan.periods.length, 2, "ticking again never asks for the same period twice");
  assert.equal(w.store.upi!.requests.filter((r) => r.reference === plan.periods[1].orderId).length, 1);
  await w.ownerMarksReceived(AMIT);
  assert.equal(plan.periods[1].state, "paid");
  assert.equal(w.upiRefunds(AMIT).length, 0, "nothing refunded: the credit was carried");
});

test("a renewal not paid before its first meal closes lapses, charges nothing, and gives the credit back", async () => {
  const w = await subscribed();
  await w.say("skip 12 nov", { from: AMIT });
  await w.goto({ year: 2026, month: 12, day: 8 }, { hour: 21, minute: 0 });
  const plan = planOf(w);
  const carried = plan.periods[0].settlement!.amountInr;
  assert.equal(plan.balance.length, 0, "taken for the renewal while it waits");
  await w.goto({ year: 2026, month: 12, day: 9 }, { hour: 21, minute: 0 }); // the cut-off of the first meal day, 10 Dec, was 9 Dec 8 pm
  assert.equal(plan.state, "lapsed");
  assert.equal(plan.periods[1].state, "lapsed");
  assert.equal(plan.balance.reduce((n, p) => n + p.amountInr, 0), carried);
  assert.match(w.lastTextTo(AMIT), /was not renewed in time/u);
});

test("a cancel while the renewal's reminder is queued: the reminder never goes out and nothing more is delivered or charged", async () => {
  const w = await subscribed();
  await w.goto({ year: 2026, month: 12, day: 8 }, { hour: 21, minute: 0 });
  const plan = planOf(w);
  assert.ok(plan.periods[1].reminders && plan.periods[1].reminders.length === 1, "one reminder is queued for the day before the pay-by time");
  await w.say("cancel my plan", { from: AMIT });
  assert.equal(plan.state, "cancelled");
  assert.equal(plan.periods[1].reminders, undefined);
  await w.goto({ year: 2026, month: 12, day: 9 }, { hour: 21, minute: 0 });
  assert.equal(w.textsTo(AMIT).filter((t) => /renews from/u.test(t)).length, 1, "only the first renewal message; no reminder after the cancel");
  assert.equal(plan.periods[1].state, "lapsed");
  assert.equal(Object.values(plan.periods[1].days).filter((d) => d === "delivered").length, 0, "no delivery in the cancelled renewal");
});

test("a renewal paid twice on a gateway shop: the second payment is refunded, the period is paid once", async () => {
  const r = raw("annapurna-tiffins-razorpay");
  r.plans = raw().plans;
  r.pickup.slots[0].maxOrders = 14;
  const w = await subscribed(parseSettings(r));
  await w.say("skip 12 nov", { from: AMIT });
  await w.goto({ year: 2026, month: 12, day: 8 }, { hour: 21, minute: 0 });
  const plan = planOf(w);
  w.pays(AMIT);
  w.pays(AMIT);
  await w.deliverPaymentEvents();
  assert.equal(plan.periods[1].state, "paid");
  assert.equal(plan.periods.filter((p) => p.state === "paid").length, 2);
  assert.ok(w.payments.refunds().length + w.heldForOwner().length >= 1, "the extra payment goes back through the refund path");
});

test("capacity: a plan's meals hold places in the slot, so a one-off order for a full day is refused and a second plan is not started", async () => {
  const r = raw();
  r.pickup.slots[0].maxOrders = 1;
  const w = await subscribed(parseSettings(r));
  await w.say("2 veg thali 10 nov 12:00 pm pickup", { from: RAJESH });
  assert.match(w.lastTextTo(RAJESH), /slot for .* is full/u);
  await w.say("I want the monthly lunch plan", { from: RAJESH });
  assert.match(w.lastTextTo(RAJESH), /slot is full for the days you asked/u);
  assert.equal(Object.keys(w.store.plans!.plans).length, 1);
  await w.say("skip 10 nov", { from: AMIT });
  await w.say("2 veg thali 10 nov 12:00 pm pickup", { from: RAJESH });
  assert.equal(w.orderOf(RAJESH)!.state, "awaiting_advance", "a skipped day gives the place back");
});

test("a shop without plans: a message about a plan is just a message, and its store has no plans", async () => {
  const w = createWorld({ settings: annapurna() });
  await w.say("I want the monthly plan", { from: AMIT });
  assert.equal(w.store.plans, undefined);
  assert.equal(w.record.entries().filter((e) => e.action.startsWith("plan_")).length, 0);
});
