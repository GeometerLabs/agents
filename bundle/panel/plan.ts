// The shop's plan, as the shop page shows it (B48, B56): what fleet last said (fleet/<shop>.json) and, from the price list in force, what Geometer charges for it.
// No words in any language here: it returns facts, and views.ts says them in the shop's language. The charge is the same rule the running-cost line and the
// health page use (cost.ts chargeOf): the plan's fee on Geometer's server, the builder licence on a builder's own server.
import type { FleetAnswer, PlanName } from "./contract.ts";
import { chargeOf, paiseOf } from "./cost.ts";
import type { PriceList } from "./cost.ts";
import type { BudgetOverride } from "../lib/budget-override.ts";

export interface PlanView {
  plan: PlanName | null;
  /** Customer messages a month the plan includes. */
  allowance: number | null;
  /** The Innovator badge: one of the first builders and Operators with a shop live. A badge, not a price. */
  innovator: boolean;
  buttons: boolean;
  /** Only with buttons: why, as fleet's code. */
  reason?: string;
  warn: string[];
  /** The shop's own model budget (decision 60), only while most of it or all of it is used: from the runtime's status, in whole paise. */
  budget?: { level: "warn" | "full"; usedPaise: number; limitPaise: number };
  /**
   * The server admin's own model budget for this shop (shops/<shop>/budget-override.json), shown READ-ONLY so the Operator knows why this shop's budget is not its plan's. Nothing in
   * the panel can change it: on Geometer's own Operator server Geometer pays for the model, so an Operator must never raise it.
   */
  ownBudget?: { monthlyPaise: number; date: string; reason: string };
  /** Whole paise, before GST, from the price list in force: the plan's fee, or the builder licence (`licence`) on a builder's own server. */
  price?: { paise: number; licence: boolean };
}

// Facts about a shop's plan from fleet's last answer and the price list; undefined when fleet has said nothing, so the page says "unknown" and never invents a plan. `builder` switches the charge to the builder licence on their own server.
export function planView(fleet: FleetAnswer | undefined, prices: PriceList | null, builder = false, budget?: unknown, override?: BudgetOverride): PlanView | undefined {
  if (!fleet) return undefined;
  const charge = fleet.plan && prices ? chargeOf(prices, fleet.plan, builder) : null;
  const price = charge?.fee ? { paise: paiseOf(charge.fee.value), licence: charge.licence } : undefined;
  return { plan: fleet.plan, allowance: fleet.allowance, innovator: fleet.innovator, buttons: fleet.ai === "buttons", ...(fleet.reason ? { reason: fleet.reason } : {}), warn: fleet.warn, ...(price ? { price } : {}), ...(budgetOf(budget) ? { budget: budgetOf(budget)! } : {}), ...(override ? { ownBudget: { monthlyPaise: override.monthlyInr * 100, date: override.date, reason: override.reason } } : {}) };
}

/**
 * The runtime's budget summary (`/status` `ai.budget`, modules/budget/budget.ts), read field by field: a wrong or missing field is no budget line, never a guess. Only the two
 * levels that need the Operator's eye are returned; the amounts are whole paise (the summary is in micro-rupees).
 */
export function budgetOf(raw: unknown): PlanView["budget"] | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const b = raw as Record<string, unknown>;
  const whole = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
  if ((b.level !== "warn" && b.level !== "full") || !whole(b.usedMicroInr) || !whole(b.monthlyMicroInr)) return undefined;
  return { level: b.level, usedPaise: Math.floor(b.usedMicroInr / 10_000), limitPaise: Math.floor(b.monthlyMicroInr / 10_000) };
}
