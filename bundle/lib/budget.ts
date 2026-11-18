// A shop's model budget, read from the price list (decision 60, "caps everywhere"; modules/budget/README.md). The price list (prices/<date>.json) is the only place the numbers are
// written: `ai.budget.<plan>` is the month's rupees, `ai.daily.*` the daily cap on each feature. This turns them into the `budget` block of the shop's runtime.json (the shape
// modules/budget/budget.ts reads), for the shop's plan. It is given the list IN FORCE, never a proposal, so until the owner says yes to a new list no shop gets a budget; and a
// number the list does not have is never made up: with any needed entry missing the answer is "no budget", and the shop keeps fleet's cap alone.
import { wallProblems } from "../../modules/budget/budget.ts";
import { latestPriceList } from "../panel/cost.ts";
import type { BudgetConfig } from "../../modules/budget/budget.ts";
import { applyOverride } from "./budget-override.ts";
import type { BudgetOverride } from "./budget-override.ts";

/** The part of a price list this needs (bundle/panel/cost.ts PriceList satisfies it). */
export interface BudgetRates { rates: Record<string, { micro?: number; count?: number } | undefined> }

/** The plans that have a budget: the three paid plans, and the free listings-only shop (the listings-only stream names its plan with this id). */
export type BudgetPlan = "basic" | "business" | "operations" | "listings-only";

/** What else decides one shop's numbers besides its plan and the list. */
export interface BudgetExtras {
  /**
   * The extra messages this shop bought this month, as fleet's answer says (`bought`). Fleet's own wall grows with them (apps/fleet/src/aicap.ts: `ai.cap` x (allowance + bought) / 1,000),
   * so the shop's own budget grows the same way, or a busy shop that paid for more messages would be stopped by its own budget at the plan's number while fleet would still allow more.
   * Left out or 0: none. Not used by the listings-only plan (free, no messages bought).
   */
  bought?: number;
  /** The server admin's override for this one shop (budget-override.ts): it replaces the numbers it names, after the scaling above. */
  override?: BudgetOverride;
}

/**
 * The shop's budget for its plan, or undefined when the list has no budget for it (or the plan is not one).
 *
 * The scaling rule (the same one fleet's cap uses): with `messages = allowance + bought`,
 *   monthly = ai.budget.<plan> x messages / allowance, rounded UP;  customer_talk and router daily caps = (ai.daily.* per 1,000) x messages / 1,000, rounded up, at least 1.
 * With nothing bought, `messages` is the allowance and every number is exactly what the list says. Then the admin's override for the shop, if any, replaces the numbers it names.
 */
export function budgetFor(plan: string | null | undefined, list: BudgetRates, extras: BudgetExtras = {}): BudgetConfig | undefined {
  const base = planBudget(plan, list, extras.bought ?? 0);
  // the override is applied here, in the one function every caller goes through, so no caller can forget it and an agent shop and a listings-only shop cannot differ
  return applyOverride(base, extras.override);
}

/** The plan's own numbers (scaled by what was bought), before any override. Exported for `geometer shop budget`, which shows the plan's numbers next to the override. */
export function planBudget(plan: string | null | undefined, list: BudgetRates, bought = 0): BudgetConfig | undefined {
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
  if (allowance === undefined || allowance < 1 || owner === undefined || perThousandCustomer === undefined || perThousandRouter === undefined) return undefined;
  // messages bought are whole and never negative; anything else is ignored rather than guessed at
  const extra = Number.isSafeInteger(bought) && bought > 0 ? bought : 0;
  const messages = allowance + extra;
  const scaled = (perThousand: number) => Math.max(1, Math.ceil((perThousand * messages) / 1000));
  // monthly = the plan's budget x messages / allowance, rounded up: with nothing bought this is the list's number exactly (integer micro-rupees divide exactly)
  const scaledMonthly = extra === 0 ? monthly : Math.ceil((monthly * messages) / allowance);
  return { monthlyMicroInr: scaledMonthly, daily: { owner_talk: owner, listing_draft: draft, customer_talk: scaled(perThousandCustomer), router: scaled(perThousandRouter) } };
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

/**
 * The dearest single model call a feature makes, in micro-rupees, for the wall check below: the longest prompt (about 4,000 tokens: the notes, the sources and the last six lines)
 * and reply (1,200, TALK_MAX_TOKENS) at the standard DeepSeek V4.1 Flash rate in modules/understanding/rates/2026-11-07.json and INR 94 to the dollar is about INR 0.14; the number
 * here is double that, so the check errs towards a lower wall. Change it only with the rate table.
 */
export const WORST_CALL_MICRO_INR = 300_000;

/**
 * Plain-word notes about the model Guard's wall (`model.callsPerDay`, default 2,000 a day for the whole server) against the shops on the server: a wall that cannot pay for the
 * shops' own budgets stops them early, and one far above them protects nothing. `wallProblems` (modules/budget) says which; the deploy prints these and goes on.
 */
export function wallNotes(callsPerDay: number | undefined, shopBudgets: readonly (BudgetConfig | undefined)[]): string[] {
  const budgets = shopBudgets.filter((b): b is BudgetConfig => b !== undefined);
  if (budgets.length === 0) return [];
  return wallProblems({ callsPerDay: callsPerDay ?? 2000, shopBudgets: budgets, worstCallMicroInr: WORST_CALL_MICRO_INR });
}

/**
 * A deploy's note when the price list cannot be read at all (a missing or broken prices/ folder): `readShop` then quietly gives every shop NO budget, which is right for a list
 * with none in force but would hide a broken checkout. Empty when the list reads.
 */
export function priceListNotes(read: () => unknown = latestPriceList): string[] {
  try { read(); return []; } catch (e) { return [`the price list could not be read (${(e as Error).message}), so no shop was given a model budget: only fleet's cap limits their model spend. Check that prices/ is in this checkout.`]; }
}

/** The directory's credential at the model Guard: its own agent id, so the Guard knows it from every shop (its record, its own switch). */
export const DIRECTORY_AGENT_ID = "directory-assistant";

/**
 * The directory's buyer assistant for THIS server, or undefined (and the assistant is off): the server has the door and so the directory (pages domain and fleet), a model is
 * chosen, and the price list in force has the directory's budget (`discoveryBudgetFor`). One question for the config file, the compose file and the model Guard's agent list,
 * so the three can never disagree.
 */
export function directoryAssistant(server: { pages?: unknown; fleet?: unknown; model: { model: string } }, list?: BudgetRates): ReturnType<typeof discoveryBudgetFor> {
  if (!server.pages || !server.fleet || server.model.model === "") return undefined;
  if (list) return discoveryBudgetFor(list);
  try { return discoveryBudgetFor(latestPriceList()); } catch { return undefined; }
}
