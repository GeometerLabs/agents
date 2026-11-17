// The entitlement ledger of monthly plans (17 Nov 2026): for every plan, every period it has been asked to pay for, and for every meal day in a period one state. This is
// the ONE source for what a customer is owed: the kitchen's count, the capacity of a slot, the credits and the report are all read from it, never kept as numbers beside it.
//
//   due -> delivered            the meal day's slot ended and the plan still stood
//   due -> skipped | paused     the customer asked before the cut-off (a day skipped and then paused is one day, not two)
//   due | paused -> cancelled   the plan was cancelled before the day's cut-off
//
// Everything here is pure over the plan it is given and says what it did as a Decision (the same shape as every limit), so the agent can write each one in the record. The
// rules, in plain words, and where each is held:
//   plan-cutoff                  a pause, a skip or a resume for a day whose cut-off has passed is refused, with that cut-off time
//   plan-no-charge-after-cancel  once cancelled, no new day is owed, no period is asked for and nothing is delivered beyond the days already closed
//   plan-one-renewal-per-period  one payment request for each period, however often the clock ticks or the customer is asked
//   plan-one-credit-per-period   the days not taken in a period are settled once, as carried OR refunded, never both
//   plan-credit-within-paid      a credit is never more than what was paid for the period
// It imports no disk and no database (the agent's graph feeds the browser demo) and, from order.ts, only types.
import { addDays, zonedToMs, parseClock, timeFromMinutes } from "../../../../../modules/core/time.ts";
import type { LocalDate } from "../../../../../modules/core/time.ts";
import { allow, block } from "../../../../../modules/limits/limits.ts";
import type { Decision } from "../../../../../modules/limits/limits.ts";
import type { Language } from "../../../../../modules/language/languages.ts";
import type { Cutoff } from "../settings.ts";
import { creditInr, dateOfKey, firstMealOnOrAfter, keyOf, mealDates, periodRange } from "./periods.ts";

export type DayState = "due" | "skipped" | "paused" | "delivered" | "cancelled";
/** A period is asked for (awaiting_payment), paid, or lapsed (the renewal was never paid before its first meal closed). */
export type PeriodState = "awaiting_payment" | "paid" | "lapsed";

export interface PlanPeriod {
  index: number;
  /** First and last day, as keys. */
  from: string;
  to: string;
  /** The plan's price for the period, and what was asked after the credit carried in: the payment is `dueInr`. */
  priceInr: number;
  dueInr: number;
  /** What was taken off the price from credits carried in (pieces of earlier periods, FIFO), kept so a renewal that lapses gives them back. */
  taken: BalancePiece[];
  /** The order whose payment link this period is paid with: the payment is matched to its period by this id. */
  orderId: string;
  days: Record<string, DayState>;
  state: PeriodState;
  /** A first period's hold: while it runs, the period's meals hold their places in the slot. */
  holdUntilMs?: number;
  paidAtMs?: number;
  /** Set once, when the period's days not taken are counted: carried to the balance or refunded. A period never has two. */
  settlement?: { kind: "carried" | "refunded" | "none"; amountInr: number; days: number; atMs: number };
}

/** Credit carried from a period's payment: `orderId` is the order that was paid, so the money can go back to it if the plan ends first. */
export interface BalancePiece { orderId: string; amountInr: number }

export interface Plan {
  /** "p-7", from the number of the order of its first period (so no counter of its own to lose in a restore). */
  id: string;
  customer: string;
  language: Language;
  typeId: string;
  slotId: string;
  mode: "pickup" | "delivery";
  /** A delivery plan's place on the shop's list and the address as the customer wrote it (kept for the owner while the plan stands). */
  area?: string;
  address?: string;
  /** awaiting_address: a delivery plan not yet started, its next plain message is the address. active. cancelled. lapsed: a renewal was not paid in time. */
  state: "awaiting_address" | "active" | "cancelled" | "lapsed";
  startKey: string;
  periods: PlanPeriod[];
  /** Pauses as asked: from a day, to a day before another (set when the customer resumes). Later periods are made with these applied. */
  pauses: { from: string; to?: string }[];
  /** Credit carried and not yet used, oldest first. */
  balance: BalancePiece[];
  cancelledAtMs?: number;
}

export interface PlansState { plans: Record<string, Plan> }

/** What the ledger needs from the shop's settings. */
export interface PlanRules { timeZone: string; cutoff: Cutoff; weekdays: readonly number[]; credits: "carry" | "refund" }

export const plansOf = (state: PlansState | undefined): Plan[] => Object.values(state?.plans ?? {});

/** The moment a meal day closes for pausing and skipping. */
export const cutoffMsFor = (rules: PlanRules, key: string): number =>
  zonedToMs(addDays(dateOfKey(key), -rules.cutoff.daysBefore), timeFromMinutes(parseClock(rules.cutoff.time)!), rules.timeZone);

const open = (rules: PlanRules, key: string, nowMs: number): boolean => nowMs < cutoffMsFor(rules, key);

/** The plan a customer has now: the latest that is not over. */
export const planOfCustomer = (state: PlansState | undefined, customer: string): Plan | undefined =>
  plansOf(state).reverse().find((p) => p.customer === customer && (p.state === "active" || p.state === "awaiting_address"));

export const periodOfDay = (plan: Plan, key: string): PlanPeriod | undefined => plan.periods.find((p) => key >= p.from && key <= p.to);

/** The days of a period, made from the plan's weekdays: those a pause covers start as "paused", the others "due". */
export function newDays(plan: Plan, weekdays: readonly number[], startDate: LocalDate, index: number): { from: string; to: string; days: Record<string, DayState> } {
  const range = periodRange(startDate, index);
  const days: Record<string, DayState> = {};
  for (const d of mealDates(range, weekdays)) {
    const key = keyOf(d);
    days[key] = plan.pauses.some((p) => key >= p.from && (p.to === undefined || key <= p.to)) ? "paused" : "due";
  }
  return { from: keyOf(range.from), to: keyOf(range.to), days };
}

/** Does this period hold places in its slot? A paid one does; a renewal that is asked for does (a subscriber keeps their place); a first period does while its hold runs. */
export const holdsPlaces = (p: PlanPeriod, nowMs: number): boolean => p.state === "paid" || (p.state === "awaiting_payment" && (p.index > 0 || (p.holdUntilMs !== undefined && p.holdUntilMs > nowMs)));

/** The meals the kitchen makes on a day in a slot (a delivered meal still counts that day). The one number the slot's capacity, the owner and the report read. */
export function mealsOn(state: PlansState | undefined, key: string, slotId: string, nowMs: number): number {
  let n = 0;
  for (const plan of plansOf(state)) {
    if (plan.slotId !== slotId || plan.state === "lapsed") continue;
    const period = periodOfDay(plan, key);
    const day = period?.days[key];
    if (period && holdsPlaces(period, nowMs) && (day === "due" || day === "delivered")) n++;
  }
  return n;
}

/** The meals for a slot on a date, for the slot's capacity (src/order.ts ordersInSlot). `except` leaves one plan out (the one being checked). */
export function planMealsInSlot(state: PlansState | undefined, date: LocalDate, slotId: string, nowMs: number, except = ""): number {
  if (!state) return 0;
  const key = keyOf(date);
  let n = mealsOn(state, key, slotId, nowMs);
  const own = state.plans[except];
  if (own && own.slotId === slotId) { const p = periodOfDay(own, key); if (p && holdsPlaces(p, nowMs) && (p.days[key] === "due" || p.days[key] === "delivered")) n--; }
  return n;
}

// ---- what the customer asks: skip, pause, resume, cancel --------------------------------------------------------------------

export type Refusal = "no_meal" | "already" | "after_cutoff" | "cancelled";
export type Asked = { ok: true; decision: Decision; days: number } | { ok: false; why: Refusal; decision: Decision; cutoffMs?: number };

const refuse = (why: Refusal, rule: string, reason: string, cutoffMs?: number): Asked => ({ ok: false, why, decision: block(rule, reason), ...(cutoffMs !== undefined ? { cutoffMs } : {}) });

/** Skip one meal day. It must be a meal day of a paid period, still due, and before that day's cut-off. */
export function skipDay(plan: Plan, key: string, rules: PlanRules, nowMs: number): Asked {
  if (plan.state !== "active") return refuse("cancelled", "plan-no-charge-after-cancel", "The plan is not running, so there is no meal to skip.");
  const period = periodOfDay(plan, key);
  const day = period?.days[key];
  if (!period || period.state !== "paid" || day === undefined) return refuse("no_meal", "plan-cutoff", "There is no paid meal that day.");
  if (day !== "due") return refuse("already", "plan-one-credit-per-period", `That day is already ${day}: it is counted once.`);
  const cut = cutoffMsFor(rules, key);
  if (nowMs >= cut) return refuse("after_cutoff", "plan-cutoff", "The cut-off for that meal day has passed.", cut);
  period.days[key] = "skipped";
  return { ok: true, decision: allow("plan-cutoff", "The cut-off for that meal day has not passed."), days: 1 };
}

/** Pause from a day (open-ended until the customer resumes). The first meal day on or after it must still be before its cut-off. */
export function pauseFrom(plan: Plan, fromKey: string, rules: PlanRules, nowMs: number): Asked {
  if (plan.state !== "active") return refuse("cancelled", "plan-no-charge-after-cancel", "The plan is not running, so there is nothing to pause.");
  const first = keyOf(firstMealOnOrAfter(dateOfKey(fromKey), rules.weekdays));
  const cut = cutoffMsFor(rules, first);
  if (nowMs >= cut) return refuse("after_cutoff", "plan-cutoff", "The cut-off for the first meal day of the pause has passed.", cut);
  if (plan.pauses.some((p) => p.to === undefined && p.from <= fromKey)) return refuse("already", "plan-one-credit-per-period", "The plan is already paused from before that day.");
  plan.pauses = [...plan.pauses.filter((p) => p.from < fromKey || p.to !== undefined), { from: fromKey }];
  let days = 0;
  for (const p of plan.periods) if (p.state !== "lapsed") for (const [k, s] of Object.entries(p.days)) if (k >= fromKey && s === "due") { p.days[k] = "paused"; days++; }
  return { ok: true, decision: allow("plan-cutoff", "The cut-off for the first paused meal day has not passed."), days };
}

/** Resume from a day: the pause ends the day before; days from then on that were only paused are due again. Refused after the cut-off of the first meal day, like a pause. */
export function resumeFrom(plan: Plan, fromKey: string, rules: PlanRules, nowMs: number): Asked {
  if (plan.state !== "active") return refuse("cancelled", "plan-no-charge-after-cancel", "The plan is not running, so there is nothing to resume.");
  const covering = plan.pauses.filter((p) => p.to === undefined || p.to >= fromKey);
  if (covering.length === 0) return refuse("no_meal", "plan-cutoff", "The plan is not paused from that day.");
  const first = keyOf(firstMealOnOrAfter(dateOfKey(fromKey), rules.weekdays));
  const cut = cutoffMsFor(rules, first);
  if (nowMs >= cut) return refuse("after_cutoff", "plan-cutoff", "The cut-off for the first meal day after the pause has passed.", cut);
  const dayBefore = keyOf(addDays(dateOfKey(fromKey), -1));
  plan.pauses = plan.pauses.flatMap((p) => (p.to !== undefined && p.to < fromKey ? [p] : p.from >= fromKey ? [] : [{ from: p.from, to: dayBefore }]));
  let days = 0;
  for (const p of plan.periods) if (p.state !== "lapsed") for (const [k, s] of Object.entries(p.days)) if (k >= fromKey && s === "paused" && !plan.pauses.some((q) => k >= q.from && (q.to === undefined || k <= q.to))) { p.days[k] = "due"; days++; }
  return { ok: true, decision: allow("plan-cutoff", "The cut-off for the first meal day after the pause has not passed."), days };
}

/** Cancel the plan: every day whose cut-off is still ahead is cancelled; days already closed stay due (the kitchen has made them). Returns the days cancelled. */
export function cancelPlan(plan: Plan, rules: PlanRules, nowMs: number): { days: number; decision: Decision } {
  plan.state = "cancelled";
  plan.cancelledAtMs = nowMs;
  let days = 0;
  for (const p of plan.periods) if (p.state !== "lapsed") for (const [k, s] of Object.entries(p.days)) if ((s === "due" || s === "paused") && open(rules, k, nowMs)) { p.days[k] = "cancelled"; days++; }
  return { days, decision: allow("plan-no-charge-after-cancel", "No meal is sent or charged for a day whose cut-off is after the cancellation.") };
}

// ---- time passing: delivery, the moment to ask for the renewal, settlement -----------------------------------------------------

/** Meals whose slot has ended become delivered. Returns the days, so each is written in the record once (a delivered day is never delivered again). */
export function deliverDue(plan: Plan, slotEndMsOf: (key: string) => number, nowMs: number): string[] {
  const out: string[] = [];
  for (const p of plan.periods) if (p.state === "paid") for (const [k, s] of Object.entries(p.days)) if (s === "due" && slotEndMsOf(k) <= nowMs) { p.days[k] = "delivered"; out.push(k); }
  return out.sort();
}

/** The days of a period not taken: skipped, paused or cancelled. */
export const creditDays = (p: PlanPeriod): number => Object.values(p.days).filter((s) => s === "skipped" || s === "paused" || s === "cancelled").length;

/** The last moment anything can still change a paid period's days: the cut-off of its last meal day. After it the period's credit is final and the next period is asked for. */
export function settledAfterMs(p: PlanPeriod, rules: PlanRules): number {
  const keys = Object.keys(p.days).sort();
  return keys.length === 0 ? 0 : cutoffMsFor(rules, keys[keys.length - 1]);
}

/** Is the plan due to ask for its next period now? Active, its last period paid, no next period yet, and the last period's credit final. */
export function renewalDue(plan: Plan, rules: PlanRules, nowMs: number): boolean {
  if (plan.state !== "active") return false;
  const last = plan.periods[plan.periods.length - 1];
  return last !== undefined && last.state === "paid" && nowMs >= settledAfterMs(last, rules);
}

/** The renewal is refused if the next period already exists: one request for each period. */
export function checkOneRenewal(plan: Plan, nextIndex: number): Decision {
  return plan.periods.some((p) => p.index === nextIndex)
    ? block("plan-one-renewal-per-period", `Period ${nextIndex + 1} was already asked for, so it is not asked for again.`)
    : allow("plan-one-renewal-per-period", `Period ${nextIndex + 1} has not been asked for.`);
}

/**
 * Count a paid period's days not taken, once. The credit is worth `price / meals` a day rounded down, never more than was paid for the period. Under "refund" the amount is
 * refunded and under "carry" it joins the plan's balance (and a cancelled plan refunds either way, as there is no next payment to take it off). `done` is the settlement
 * written on the period; if it already has one the answer is a block and nothing changes: a period's days are never credited twice.
 */
export function settle(plan: Plan, period: PlanPeriod, rules: PlanRules, nowMs: number): { decision: Decision; amountInr: number; kind: "carried" | "refunded" | "none" } {
  if (period.settlement) return { decision: block("plan-one-credit-per-period", `Period ${period.index + 1} was already settled (${period.settlement.kind}), so its days are not credited again.`), amountInr: 0, kind: period.settlement.kind };
  const days = creditDays(period);
  const meals = Object.keys(period.days).length;
  const amountInr = creditInr(period.priceInr, meals, days, period.dueInr);
  const kind = amountInr === 0 ? "none" : rules.credits === "refund" || plan.state !== "active" ? "refunded" : "carried";
  period.settlement = { kind, amountInr, days, atMs: nowMs };
  if (kind === "carried") plan.balance.push({ orderId: period.orderId, amountInr });
  return { decision: allow("plan-credit-within-paid", `${days} of ${meals} meals not taken, worth ${amountInr} of the ${period.dueInr} paid.`), amountInr, kind };
}

/** Take credit off a new payment, oldest first. Returns what was taken; the balance is reduced by it. */
export function takeBalance(plan: Plan, maxInr: number): BalancePiece[] {
  const taken: BalancePiece[] = [];
  let left = maxInr;
  while (left > 0 && plan.balance.length > 0) {
    const piece = plan.balance[0];
    const use = Math.min(piece.amountInr, left);
    taken.push({ orderId: piece.orderId, amountInr: use });
    left -= use;
    if (use === piece.amountInr) plan.balance.shift(); else piece.amountInr -= use;
  }
  return taken;
}

/** Give credit back to the balance (a renewal that was not paid): the pieces go to the front, in the order they were taken. */
export function returnBalance(plan: Plan, pieces: BalancePiece[]): void {
  for (const piece of [...pieces].reverse()) {
    const front = plan.balance[0];
    if (front && front.orderId === piece.orderId) front.amountInr += piece.amountInr; else plan.balance.unshift({ ...piece });
  }
}
