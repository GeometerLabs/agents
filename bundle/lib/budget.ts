// A shop's model budget, read from the price list (decision 60, "caps everywhere"; modules/budget/README.md). The price list (prices/<date>.json) is the only place the numbers are
// written: `ai.budget.<plan>` is the month's rupees, `ai.daily.*` the daily cap on each feature. This turns them into the `budget` block of the shop's runtime.json (the shape
// modules/budget/budget.ts reads), for the shop's plan. It is given the list IN FORCE, never a proposal, so until the owner says yes to a new list no shop gets a budget; and a
// number the list does not have is never made up: with any needed entry missing the answer is "no budget", and the shop keeps fleet's cap alone.
import type { BudgetConfig } from "../../modules/budget/budget.ts";

/** The part of a price list this needs (bundle/panel/cost.ts PriceList satisfies it). */
export interface BudgetRates { rates: Record<string, { micro?: number; count?: number } | undefined> }

/** The plans that have a budget: the three paid plans, and the free listings-only shop (the listings-only stream names its plan with this id). */
export type BudgetPlan = "basic" | "business" | "operations" | "listings-only";

/** The shop's budget for its plan, or undefined when the list has no budget for it (or the plan is not one). */
export function budgetFor(plan: string | null | undefined, list: BudgetRates): BudgetConfig | undefined {
  if (plan !== "basic" && plan !== "business" && plan !== "operations" && plan !== "listings-only") return undefined;
  const micro = (id: string) => list.rates[id]?.micro;
  const count = (id: string) => list.rates[id]?.count;
  const monthly = micro(`ai.budget.${plan}`);
  const draft = count("ai.daily.listing-draft");
  if (monthly === undefined || draft === undefined) return undefined;
  if (plan === "listings-only") {
    const owner = count("ai.daily.listings-only.owner-talk");
    const customer = count("ai.daily.listings-only.customer-talk");
    if (owner === undefined || customer === undefined) return undefined;
    return { monthlyMicroInr: monthly, daily: { owner_talk: owner, listing_draft: draft, customer_talk: customer } };
  }
  // the customer-facing caps scale with the plan's messages: "per 1,000 messages of the allowance", rounded up so a small plan never rounds to zero
  const allowance = count(`plan.${plan}.allowance`);
  const owner = count("ai.daily.owner-talk");
  const perThousandCustomer = count("ai.daily.customer-talk");
  const perThousandRouter = count("ai.daily.router");
  if (allowance === undefined || owner === undefined || perThousandCustomer === undefined || perThousandRouter === undefined) return undefined;
  const scaled = (perThousand: number) => Math.max(1, Math.ceil((perThousand * allowance) / 1000));
  return { monthlyMicroInr: monthly, daily: { owner_talk: owner, listing_draft: draft, customer_talk: scaled(perThousandCustomer), router: scaled(perThousandRouter) } };
}

/**
 * The directory's buyer assistant's budget (the discovery stream wires it): the month's rupees and the calls a day for every buyer together, and each buyer's own daily
 * questions. Undefined with any entry missing.
 */
export function discoveryBudgetFor(list: BudgetRates): (BudgetConfig & { perBuyerPerDay: number }) | undefined {
  const monthly = list.rates["ai.budget.discovery"]?.micro;
  const daily = list.rates["ai.daily.discovery"]?.count;
  const perBuyer = list.rates["ai.daily.discovery.per-buyer"]?.count;
  if (monthly === undefined || daily === undefined || perBuyer === undefined) return undefined;
  return { monthlyMicroInr: monthly, daily: { buyer: daily }, perBuyerPerDay: perBuyer };
}
