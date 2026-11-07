// ONE settings value, two places that act on it. The agent's refund limit (settings.cancellation.refundLimitInr, whole rupees) and Guard's
// `call_bound_approval` threshold (paise) must be the same number (modules/payments/guard-limits.ts says why). This file turns the Bookings settings into the
// numbers of the Razorpay limits spec; the spec itself is built by modules/payments/guard-limits.ts.
import type { Settings } from "./settings.ts";
import { approvalTtlFrom, capsFrom, razorpayLimitsSpecFrom, rupeesToPaise } from "../../../../modules/payments/guard-limits.ts";
import type { LimitsSpec, LimitsSpecIdentity, RazorpayCaps } from "../../../../modules/payments/guard-limits.ts";

/** The refund amount (paise) above which Guard holds the call for the owner. The agent holds above `refundLimitInr`; the two are this one value. */
export const refundThresholdPaise = (settings: Settings): number => rupeesToPaise(settings.cancellation.refundLimitInr);

/** The deposit, in paise: the only amount a payment link may be created for. */
export const depositPaise = (settings: Settings): number => rupeesToPaise(settings.deposit.amountInr);

export interface RazorpayNumbers {
  depositPaise: number;
  refundThresholdPaise: number;
  caps: RazorpayCaps;
  approvalTtlSeconds: number;
}

export function razorpayNumbers(settings: Settings, options: { caps?: Partial<RazorpayCaps>; approvalTtlSeconds?: number } = {}): RazorpayNumbers {
  const caps = capsFrom(options.caps);
  const approvalTtlSeconds = approvalTtlFrom(options.approvalTtlSeconds);
  const deposit = depositPaise(settings);
  if (deposit < 1) throw new Error("The deposit must be at least 1 rupee for Guard to allow a payment link.");
  // A refund can be as large as a deposit. If the day's cap is smaller than that, an approved refund would still be refused: say so now, not at the till.
  if (caps.refundPaisePerDay < deposit) throw new Error(`The daily refund cap (${caps.refundPaisePerDay} paise) is smaller than one deposit (${deposit} paise), so an approved refund could still be refused. Raise the cap.`);
  return { depositPaise: deposit, refundThresholdPaise: refundThresholdPaise(settings), caps, approvalTtlSeconds };
}

/** The Razorpay limits spec for one client. A deposit is the only amount a link may be for, and a refund is never more than one deposit. Same settings, same bytes. */
export function razorpayLimitsSpec(settings: Settings, identity: LimitsSpecIdentity, options: { caps?: Partial<RazorpayCaps>; approvalTtlSeconds?: number } = {}): LimitsSpec {
  if (!Number.isInteger(identity.version) || identity.version < 1) throw new Error("The spec's version must be a whole number, 1 or more.");
  const n = razorpayNumbers(settings, options);
  return razorpayLimitsSpecFrom({
    identity, approvalTtlSeconds: n.approvalTtlSeconds, caps: n.caps,
    link: { ruleId: "deposit-amount", minPaise: n.depositPaise, maxPaise: n.depositPaise },
    refundBound: { ruleId: "refund-at-most-deposit", maxPaise: n.depositPaise },
    refundThresholdPaise: n.refundThresholdPaise,
  });
}
