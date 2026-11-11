// The shop's plan, as the shop page shows it (B48, B56): what fleet last said (fleet/<shop>.json) and, from the price list in force, what Geometer charges for it.
// No words in any language here: it returns facts, and views.ts says them in the shop's language. The charge is the same rule the running-cost line and the
// health page use (cost.ts chargeOf): the plan's fee on Geometer's server, the builder licence on a builder's own server.
import type { FleetAnswer, PlanName } from "./contract.ts";
import { chargeOf, paiseOf } from "./cost.ts";
import type { PriceList } from "./cost.ts";

export interface PlanView {
  plan: PlanName | null;
  /** Customer messages a month the plan includes. */
  allowance: number | null;
  /** The Innovator badge: one of the first builders and partners with a shop live. A badge, not a price. */
  innovator: boolean;
  buttons: boolean;
  /** Only with buttons: why, as fleet's code. */
  reason?: string;
  warn: string[];
  /** Whole paise, before GST, from the price list in force: the plan's fee, or the builder licence (`licence`) on a builder's own server. */
  price?: { paise: number; licence: boolean };
}

// Facts about a shop's plan from fleet's last answer and the price list; undefined when fleet has said nothing, so the page says "unknown" and never invents a plan. `builder` switches the charge to the builder licence on their own server.
export function planView(fleet: FleetAnswer | undefined, prices: PriceList | null, builder = false): PlanView | undefined {
  if (!fleet) return undefined;
  const charge = fleet.plan && prices ? chargeOf(prices, fleet.plan, builder) : null;
  const price = charge?.fee ? { paise: paiseOf(charge.fee.value), licence: charge.licence } : undefined;
  return { plan: fleet.plan, allowance: fleet.allowance, innovator: fleet.innovator, buttons: fleet.ai === "buttons", ...(fleet.reason ? { reason: fleet.reason } : {}), warn: fleet.warn, ...(price ? { price } : {}) };
}
