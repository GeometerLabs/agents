// The shop's plan, as the shop page shows it (B48, B56): what fleet last said (fleet/<shop>.json) and, from the price list in force, what the plan costs.
// No words in any language here: it returns facts, and views.ts says them in the shop's language. The prices are the same list the running-cost line reads.
import type { FleetAnswer, PlanName } from "./contract.ts";
import { paiseOf } from "./cost.ts";
import type { PriceList } from "./cost.ts";

export interface PlanView {
  plan: PlanName | null;
  /** Customer messages a month the plan includes. */
  allowance: number | null;
  innovator: boolean;
  buttons: boolean;
  /** Only with buttons: why, as fleet's code. */
  reason?: string;
  warn: string[];
  /** Whole paise, before GST, from the price list in force: the plan's price, and what this shop's partner pays after the Innovator discount (the same when there is none). */
  price?: { listPaise: number; yoursPaise: number };
}

export function planView(fleet: FleetAnswer | undefined, prices: PriceList | null): PlanView | undefined {
  if (!fleet) return undefined;
  const fee = fleet.plan && prices ? prices.rates[`plan.${fleet.plan}.fee`] : undefined;
  const discount = prices?.rates["innovator.discount"]?.basisPoints;
  let price: PlanView["price"];
  if (fee?.micro !== undefined && fee.currency === "INR") {
    const list = BigInt(fee.micro) * 100n; // micropaise
    const yours = fleet.innovator && discount !== undefined ? (list * BigInt(10_000 - discount)) / 10_000n : list;
    price = { listPaise: paiseOf(list), yoursPaise: paiseOf(yours) };
  }
  return { plan: fleet.plan, allowance: fleet.allowance, innovator: fleet.innovator, buttons: fleet.ai === "buttons", ...(fleet.reason ? { reason: fleet.reason } : {}), warn: fleet.warn, ...(price ? { price } : {}) };
}
