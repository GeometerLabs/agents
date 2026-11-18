// A shop's model budget (decision 60, "caps everywhere", 18 Nov 2026): ONE monthly budget in rupees for everything a shop asks a model, and a daily cap on each feature inside it,
// so one feature cannot use up the month and nothing can run away.
//
// WHAT IS NEW AND WHAT IS NOT. There is still ONE meter: the month's spend in `ai.costMicroInr` (understanding/ai-state.ts), which every model call already adds to (the router, the
// owner's talk, a customer's question, a listing draft, a voice note), priced from the dated rate table with the token counts the model Guard returns. This file adds no second
// meter. It reads that one against a budget, counts calls per feature per day, remembers which notices were sent, and says yes or no BEFORE a call. A call whose price is unknown
// is counted at `unpricedCallMicroInr` for the budget (never as free), so a missing rate cannot hide a spend.
//
// WHEN THE MONTH'S BUDGET IS REACHED it acts exactly like the AI cap fleet already sets (`model: "off"`): the language model is left out everywhere (the owner's talk, customers'
// questions, drafts, the router's language step, voice), and the rules, the buttons and the decision model keep answering. It never means silence: each feature has a fallback
// (README.md). The owner is told once at 80% and once more when it is used up; fleet's own cap stays as the outer wall.
//
// THE BOUND. A call is allowed when the budget is not yet used, so one call can pass the line: a shop may overshoot by at most the calls that were already running (one per
// talk turn, drafts and reading are one at a time per shop). The daily count is of CALLS ASKED, whether or not the answer was usable, because a refused draft still cost tokens: a
// retry therefore spends a count, and `key` (below) stops the same message being paid for twice.
//
// Pure: no disk, no network, no database, so an agent may import it (the browser demo is built from the agent). The values come from the price list through the bundle (README.md).
import { dayLocal, stateFor } from "../understanding/ai-state.ts";
import type { AiPolicy, AiStore } from "../understanding/ai-state.ts";

/** What can spend. `buyer` is the directory's buyer assistant (a later stream wires it); the others are built. */
export const FEATURES = ["owner_talk", "customer_talk", "listing_draft", "router", "buyer"] as const;
export type Feature = (typeof FEATURES)[number];

/** What a shop's budget is, in numbers. Read from the price list by the bundle and written into runtime.json (`budget`); never typed by a person in a template. */
export interface BudgetConfig {
  /** The month's most model spend, in micro-rupees (1,000,000 = one rupee), for every feature together. */
  monthlyMicroInr: number;
  /** The most calls a day for each feature, for the whole shop (a customer's own daily turns are the chat's: channels/chat.ts). A feature left out has no daily cap. */
  daily: Partial<Record<Feature, number>>;
  /** What a call with no price in the rate table counts as against the budget. Default `DEFAULT_UNPRICED_CALL_MICRO_INR`. */
  unpricedCallMicroInr?: number;
  /** Where the first notice is sent, in basis points of the budget (10,000 = all of it). Default 8,000. */
  warnBasisPoints?: number;
}

export const DEFAULT_UNPRICED_CALL_MICRO_INR = 100_000; // 10 paise: a little above a typical priced call
export const DEFAULT_WARN_BASIS_POINTS = 8_000;
/** The calls remembered by key (the same message asked twice is paid once). */
export const KEYS_KEPT = 60;

/** The budget's own memory, kept in the shop's store as `ai.budget`. Counts, amounts and moments only, never a word of a message. A new month starts it again (ai-state.ts). */
export interface BudgetState {
  /** The shop's local day `today` is for. */
  day: string;
  /** Calls asked today, by feature. */
  today: Partial<Record<Feature, number>>;
  /** This month's calls and spend by feature: for the owner's and the Operator's view. The budget is judged on the one meter, not on this. */
  by: Partial<Record<Feature, { calls: number; micro: number }>>;
  /** Notices already sent, so each is sent once: the month for the 80% and the used-up notices, the day for each feature's daily one. */
  told: { warn?: string; full?: string; days?: Partial<Record<Feature, string>> };
  /** The keys of calls already paid for this month, newest last. */
  keys?: string[];
}

export type Refusal = "month" | "day" | "again";
export type Gate = { ok: true } | { ok: false; why: Refusal };

/** Is a value a usable budget? Whole non-negative numbers; the daily caps at least 1 (a feature is switched off in the plan, not by a zero). */
export function isBudgetConfig(v: unknown): v is BudgetConfig {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  const whole = (n: unknown, min: number) => typeof n === "number" && Number.isSafeInteger(n) && n >= min;
  if (!whole(o.monthlyMicroInr, 0)) return false;
  if (typeof o.daily !== "object" || o.daily === null || Array.isArray(o.daily)) return false;
  for (const [k, n] of Object.entries(o.daily)) if (!(FEATURES as readonly string[]).includes(k) || !whole(n, 1)) return false;
  if (o.unpricedCallMicroInr !== undefined && !whole(o.unpricedCallMicroInr, 0)) return false;
  if (o.warnBasisPoints !== undefined && !(whole(o.warnBasisPoints, 1) && (o.warnBasisPoints as number) <= 10_000)) return false;
  return Object.keys(o).every((k) => ["monthlyMicroInr", "daily", "unpricedCallMicroInr", "warnBasisPoints"].includes(k));
}

/** The budget's state for now: this month's (ai-state.ts starts a month), and today's counts, started again when the day changed. Created on first use. */
export function stateOf(store: AiStore, nowMs: number, timeZone: string): BudgetState {
  const ai = stateFor(store, nowMs, timeZone);
  const day = dayLocal(nowMs, timeZone);
  const b = (ai.budget ??= { day, today: {}, by: {}, told: {} });
  if (b.day !== day) { b.day = day; b.today = {}; }
  return b;
}

/** What the month has cost against the budget, in micro-rupees: the one meter, plus an assumed price for each call that had none. */
export function usedMicroInr(store: AiStore, cfg: BudgetConfig, nowMs: number, timeZone: string): number {
  const ai = stateFor(store, nowMs, timeZone);
  return ai.costMicroInr + ai.unpriced * (cfg.unpricedCallMicroInr ?? DEFAULT_UNPRICED_CALL_MICRO_INR);
}

export type Level = "ok" | "warn" | "full";

/** How much of the month's budget is used, and the level that means. Basis points are rounded down, so "full" is only said when the whole budget is used. */
export function levelOf(store: AiStore, cfg: BudgetConfig | undefined, nowMs: number, timeZone: string): { used: number; limit: number; basisPoints: number; level: Level } {
  if (!cfg) return { used: 0, limit: 0, basisPoints: 0, level: "ok" };
  const used = usedMicroInr(store, cfg, nowMs, timeZone);
  const limit = cfg.monthlyMicroInr;
  const basisPoints = limit <= 0 ? 10_000 : Math.floor((used * 10_000) / limit);
  const level: Level = used >= limit ? "full" : basisPoints >= (cfg.warnBasisPoints ?? DEFAULT_WARN_BASIS_POINTS) ? "warn" : "ok";
  return { used, limit, basisPoints: Math.min(basisPoints, 10_000), level };
}

/** Is the month's budget used up? When it is, the language model is left out everywhere, as under fleet's AI cap. No budget: never. */
export const budgetFull = (store: AiStore, cfg: BudgetConfig | undefined, nowMs: number, timeZone: string): boolean => levelOf(store, cfg, nowMs, timeZone).level === "full";

/**
 * Is the language model left out for this shop right now? Either fleet says so (`model: "off"`, the outer wall, price list `ai.cap`) or the shop's own month budget is used up.
 * ONE question for every place that asks (the talk, the router's language step, voice, the notices), so the two ways of being off can never disagree.
 */
export function modelOff(store: AiStore, policy: Pick<AiPolicy, "model" | "budget">, nowMs: number, timeZone: string): "fleet" | "budget" | null {
  if (policy.model?.() === "off") return "fleet";
  return budgetFull(store, policy.budget, nowMs, timeZone) ? "budget" : null;
}

/**
 * May this feature ask a model now? Before the call. "month": the budget is used up. "day": the feature's daily cap is reached. "again": `key` (the message, so a redelivery or a
 * retry) was already paid for this month, so the call is not made a second time. No budget: always yes.
 */
export function gate(store: AiStore, cfg: BudgetConfig | undefined, feature: Feature, nowMs: number, timeZone: string, key?: string): Gate {
  if (!cfg) return { ok: true };
  if (budgetFull(store, cfg, nowMs, timeZone)) return { ok: false, why: "month" };
  const b = stateOf(store, nowMs, timeZone);
  if (key !== undefined && b.keys?.includes(key)) return { ok: false, why: "again" };
  const cap = cfg.daily[feature];
  if (cap !== undefined && (b.today[feature] ?? 0) >= cap) return { ok: false, why: "day" };
  return { ok: true };
}

/**
 * A model call was made (whatever came of it): count it for today and for the month's breakdown, and remember its key. The spend itself is already in the one meter
 * (`ai.costMicroInr`, added where the call is metered), so this never adds to it: `costMicroInr` here is only for the breakdown (null: an unpriced call, shown at the assumed price).
 */
export function record(store: AiStore, cfg: BudgetConfig | undefined, feature: Feature, call: { costMicroInr: number | null; key?: string }, nowMs: number, timeZone: string): void {
  if (!cfg) return;
  const b = stateOf(store, nowMs, timeZone);
  b.today[feature] = (b.today[feature] ?? 0) + 1;
  const row = (b.by[feature] ??= { calls: 0, micro: 0 });
  row.calls += 1;
  row.micro += call.costMicroInr ?? cfg.unpricedCallMicroInr ?? DEFAULT_UNPRICED_CALL_MICRO_INR;
  if (call.key !== undefined) b.keys = [...(b.keys ?? []), call.key].slice(-KEYS_KEPT);
}

/** The owner's month notices that are due now, each once a month: "warn" at the warning line, "full" when the budget is used up (a month that jumps past both says both, in order). Marks them told. */
export function takeNotices(store: AiStore, cfg: BudgetConfig | undefined, nowMs: number, timeZone: string): ("warn" | "full")[] {
  const { level } = levelOf(store, cfg, nowMs, timeZone);
  if (level === "ok") return [];
  const b = stateOf(store, nowMs, timeZone);
  const month = stateFor(store, nowMs, timeZone).month;
  const out: ("warn" | "full")[] = [];
  if (b.told.warn !== month) { b.told.warn = month; out.push("warn"); }
  if (level === "full" && b.told.full !== month) { b.told.full = month; out.push("full"); }
  return out;
}

/** Should the owner be told, once today, that this feature's daily cap was reached? True the first time it is asked on a day. */
export function takeDayNotice(store: AiStore, feature: Feature, nowMs: number, timeZone: string): boolean {
  const b = stateOf(store, nowMs, timeZone);
  const day = dayLocal(nowMs, timeZone);
  if (b.told.days?.[feature] === day) return false;
  b.told.days = { ...b.told.days, [feature]: day };
  return true;
}

/** What the runtime's status, the owner's view and the Operator's panel read: counts and amounts only. */
export interface BudgetSummary {
  monthlyMicroInr: number;
  usedMicroInr: number;
  basisPoints: number;
  level: Level;
  /** Calls asked today and this month, by feature, with the daily cap each has (null: none). */
  features: Record<Feature, { today: number; cap: number | null; calls: number; micro: number }>;
}

export function summaryOf(store: AiStore, cfg: BudgetConfig | undefined, nowMs: number, timeZone: string): BudgetSummary | null {
  if (!cfg) return null;
  const { used, limit, basisPoints, level } = levelOf(store, cfg, nowMs, timeZone);
  const b = stateOf(store, nowMs, timeZone);
  const features = Object.fromEntries(FEATURES.map((f) => [f, { today: b.today[f] ?? 0, cap: cfg.daily[f] ?? null, calls: b.by[f]?.calls ?? 0, micro: b.by[f]?.micro ?? 0 }])) as BudgetSummary["features"];
  return { monthlyMicroInr: limit, usedMicroInr: used, basisPoints, level, features };
}

/**
 * The model Guard's outer wall, checked against the shops' budgets and the server's own monthly total. The wall (bundle/generate/guards.ts `modelSpec`: `model-calls-per-day`) is a
 * COUNT of calls a day for every shop on the server together, not rupees, so its worst monthly cost is `callsPerDay x 31 x worstCallMicroInr` (`worstCallMicroInr`: the dearest call a
 * feature can make, its longest prompt and reply priced). Two readings, both returned as plain words (none: fine):
 *   - the wall must sit BELOW the server's monthly total (`serverMonthlyMicroInr`, what Geometer is willing to spend on one server's model a month), or it would let spend pass it;
 *   - the wall should sit ABOVE what the shops' budgets add up to, or it stops shops before their own budgets do and the budgets mean nothing.
 * It never blocks a deploy; the bundle prints the words.
 */
export function wallProblems(a: { callsPerDay: number; shopBudgets: readonly BudgetConfig[]; worstCallMicroInr: number; serverMonthlyMicroInr?: number }): string[] {
  const out: string[] = [];
  const budgets = a.shopBudgets.reduce((n, b) => n + b.monthlyMicroInr, 0);
  const wall = a.callsPerDay * 31 * a.worstCallMicroInr;
  const rupees = (micro: number) => `₹${Math.round(micro / 1e6)}`;
  if (a.serverMonthlyMicroInr !== undefined && wall > a.serverMonthlyMicroInr) out.push(`The model Guard allows ${a.callsPerDay} calls a day, which at the dearest call could cost about ${rupees(wall)} a month: more than the server's total of ${rupees(a.serverMonthlyMicroInr)}. Lower the daily count.`);
  if (wall < budgets) out.push(`The model Guard's wall (${a.callsPerDay} calls a day) could pay for about ${rupees(wall)} a month at the dearest call, less than the shops' budgets add up to (${rupees(budgets)}): the wall would stop shops before their own budgets do. Raise the count or lower a budget.`);
  return out;
}
