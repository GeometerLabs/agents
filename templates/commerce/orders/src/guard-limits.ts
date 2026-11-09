// ONE settings value, two places that act on it. The agent's refund limit (settings.refund.limitInr, whole rupees) and Guard's `call_bound_approval` threshold (paise) must
// be the same number (modules/payments/guard-limits.ts says why). This file turns the Orders settings into the numbers of the shop's gateway limits spec (B71: the gateway it chose, modules/payments/providers); the spec itself is built by
// modules/payments/guard-limits.ts, the same generator Bookings and Fees use. The amounts in a gateway's call are JSON numbers, so the spec does not declare an encoding.
//
// What Guard can and cannot say here, plainly:
//  - A payment link: Guard bounds its amount to a RANGE, from ₹1 to the dearest order the shop can take (`order-amount`: the most items in one order, all of the dearest item).
//    It cannot be given a list of exact totals, because its rule for an exact value reads text, not a number. Which exact advance a given order owes is the agent's own check
//    (the advance it computes from the record), and the stock, the day's count and the cut-off are the agent's own checks too (limits.ts).
//  - A refund: Guard refuses one above that same highest amount (`refund-at-most-order`), holds one above the owner's limit for the owner (`refund-needs-owner`), allows one
//    refund per payment (`refund-once`), forbids payouts (`no-payouts`) and counts the day's refunds and the hour's links. "At most what THIS payment was" is the agent's own
//    check (`checkRefundLimit` with the payment's amount, read from the payments service), and the payments service refuses a refund above the payment.
import type { Settings } from "./settings.ts";
import { highestOrderInr, LOWEST_LINK_INR } from "./settings.ts";
import { approvalTtlFrom, capsFrom, paymentLimitsSpecFrom, rupeesToPaise } from "../../../../modules/payments/guard-limits.ts";
import type { LimitsSpec, LimitsSpecIdentity, PaymentCaps } from "../../../../modules/payments/guard-limits.ts";
import { gatewayGuardOf } from "../../../../modules/payments/providers/index.ts";
import type { GatewayGuard } from "../../../../modules/payments/providers/types.ts";

/** The refund amount (paise) above which Guard holds the call for the owner. The agent holds above `refund.limitInr`; the two are this one value. */
export const refundThresholdPaise = (settings: Settings): number => rupeesToPaise(settings.refund.limitInr);

/** The dearest amount any link or refund can be, in paise. */
export const highestPaise = (settings: Settings): number => rupeesToPaise(highestOrderInr(settings));

export interface PaymentNumbers {
  lowestLinkPaise: number;
  highestPaise: number;
  refundThresholdPaise: number;
  caps: PaymentCaps;
  approvalTtlSeconds: number;
}

export function paymentNumbers(settings: Settings, options: { caps?: Partial<PaymentCaps>; approvalTtlSeconds?: number } = {}): PaymentNumbers {
  const caps = capsFrom(options.caps);
  const approvalTtlSeconds = approvalTtlFrom(options.approvalTtlSeconds);
  const highest = highestPaise(settings);
  // A refund can be as large as the dearest order. If the day's cap is smaller than that, an approved refund would still be refused: say so now, not at the till.
  if (caps.refundPaisePerDay < highest) throw new Error(`The daily refund cap (${caps.refundPaisePerDay} paise) is smaller than the dearest order (${highest} paise), so an approved refund could still be refused. Raise the cap.`);
  return { lowestLinkPaise: rupeesToPaise(LOWEST_LINK_INR), highestPaise: highest, refundThresholdPaise: refundThresholdPaise(settings), caps, approvalTtlSeconds };
}

/** The limits spec of the gateway this shop chose (or `options.gateway`). Same settings, same bytes. */
export function gatewayLimitsSpec(settings: Settings, identity: LimitsSpecIdentity, options: { caps?: Partial<PaymentCaps>; approvalTtlSeconds?: number; gateway?: GatewayGuard } = {}): LimitsSpec {
  if (!Number.isInteger(identity.version) || identity.version < 1) throw new Error("The spec's version must be a whole number, 1 or more.");
  const n = paymentNumbers(settings, options);
  return paymentLimitsSpecFrom({
    identity, approvalTtlSeconds: n.approvalTtlSeconds, caps: n.caps,
    link: { ruleId: "order-amount", minPaise: n.lowestLinkPaise, maxPaise: n.highestPaise },
    refundBound: { ruleId: "refund-at-most-order", maxPaise: n.highestPaise },
    refundThresholdPaise: n.refundThresholdPaise,
  }, options.gateway ?? gatewayGuardOf(settings.payment));
}
