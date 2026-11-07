// ONE settings value, two places that act on it. The agent's refund limit (settings.refund.limitInr, whole rupees) and Guard's `call_bound_approval` threshold
// (paise) must be the same number (modules/payments/guard-limits.ts says why). This file turns the Fees settings into the numbers of the Razorpay limits spec; the
// spec itself is built by modules/payments/guard-limits.ts, the same one Bookings uses.
//
// What Guard can and cannot say here, plainly:
//  - A payment link: Guard bounds its amount to a RANGE, from ₹1 to the dearest monthly fee with the late fee on top (`fee-amount`). It cannot be given a list of
//    exact fees, because its rule for an exact value reads text, not a number. Which exact amount a given student owes is the agent's own check
//    (`fee-link-matches-record`, in limits.ts), which reads the record.
//  - A refund: Guard refuses one above that same highest amount (`refund-at-most-fee-paid`), holds one above the owner's limit for the owner (`refund-needs-owner`),
//    allows one refund per payment (`refund-once`), forbids payouts (`no-payouts`) and counts the day's refunds and the hour's links. "At most what THIS payment was"
//    is the agent's own check (`checkRefundLimit` with the payment's amount, read from the payments service), and the payments service refuses a refund above the payment.
import type { Settings } from "./settings.ts";
import { highestDueInr, LOWEST_LINK_INR } from "./settings.ts";
import { approvalTtlFrom, capsFrom, razorpayLimitsSpecFrom, rupeesToPaise } from "../../../../modules/payments/guard-limits.ts";
import type { LimitsSpec, LimitsSpecIdentity, RazorpayCaps } from "../../../../modules/payments/guard-limits.ts";

/** The refund amount (paise) above which Guard holds the call for the owner. The agent holds above `refund.limitInr`; the two are this one value. */
export const refundThresholdPaise = (settings: Settings): number => rupeesToPaise(settings.refund.limitInr);

/** The dearest amount any link or refund can be, in paise. */
export const highestPaise = (settings: Settings): number => rupeesToPaise(highestDueInr(settings));

export interface RazorpayNumbers {
  lowestLinkPaise: number;
  highestPaise: number;
  refundThresholdPaise: number;
  caps: RazorpayCaps;
  approvalTtlSeconds: number;
}

export function razorpayNumbers(settings: Settings, options: { caps?: Partial<RazorpayCaps>; approvalTtlSeconds?: number } = {}): RazorpayNumbers {
  const caps = capsFrom(options.caps);
  const approvalTtlSeconds = approvalTtlFrom(options.approvalTtlSeconds);
  const highest = highestPaise(settings);
  // A refund can be as large as the dearest fee. If the day's cap is smaller than that, an approved refund would still be refused: say so now, not at the till.
  if (caps.refundPaisePerDay < highest) throw new Error(`The daily refund cap (${caps.refundPaisePerDay} paise) is smaller than the dearest fee (${highest} paise), so an approved refund could still be refused. Raise the cap.`);
  return { lowestLinkPaise: rupeesToPaise(LOWEST_LINK_INR), highestPaise: highest, refundThresholdPaise: refundThresholdPaise(settings), caps, approvalTtlSeconds };
}

/** The Razorpay limits spec for one centre. Same settings, same bytes. */
export function razorpayLimitsSpec(settings: Settings, identity: LimitsSpecIdentity, options: { caps?: Partial<RazorpayCaps>; approvalTtlSeconds?: number } = {}): LimitsSpec {
  if (!Number.isInteger(identity.version) || identity.version < 1) throw new Error("The spec's version must be a whole number, 1 or more.");
  const n = razorpayNumbers(settings, options);
  return razorpayLimitsSpecFrom({
    identity, approvalTtlSeconds: n.approvalTtlSeconds, caps: n.caps,
    link: { ruleId: "fee-amount", minPaise: n.lowestLinkPaise, maxPaise: n.highestPaise },
    refundBound: { ruleId: "refund-at-most-fee-paid", maxPaise: n.highestPaise },
    refundThresholdPaise: n.refundThresholdPaise,
  });
}
