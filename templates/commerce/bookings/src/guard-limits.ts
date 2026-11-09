// ONE settings value, two places that act on it. The agent's refund limit (settings.cancellation.refundLimitInr, whole rupees) and Guard's
// `call_bound_approval` threshold (paise) must be the same number (modules/payments/guard-limits.ts says why). This file turns the Bookings settings into the
// numbers of the gateway limits spec (for the gateway the shop chose); the spec itself is built by modules/payments/guard-limits.ts.
import type { Settings } from "./settings.ts";
import { approvalTtlFrom, capsFrom, paymentLimitsSpecFrom, rupeesToPaise } from "../../../../modules/payments/guard-limits.ts";
import type { LimitsSpec, LimitsSpecIdentity, PaymentCaps } from "../../../../modules/payments/guard-limits.ts";
import { gatewayGuardOf } from "../../../../modules/payments/providers/index.ts";
import type { GatewayGuard } from "../../../../modules/payments/providers/types.ts";

/** The refund amount (paise) above which Guard holds the call for the owner. The agent holds above `refundLimitInr`; the two are this one value. */
export const refundThresholdPaise = (settings: Settings): number => rupeesToPaise(settings.cancellation.refundLimitInr);

/** The deposit, in paise: the only amount a payment link may be created for. */
export const depositPaise = (settings: Settings): number => rupeesToPaise(settings.deposit.amountInr);

export interface PaymentNumbers {
  depositPaise: number;
  refundThresholdPaise: number;
  caps: PaymentCaps;
  approvalTtlSeconds: number;
}

export function paymentNumbers(settings: Settings, options: { caps?: Partial<PaymentCaps>; approvalTtlSeconds?: number } = {}): PaymentNumbers {
  const caps = capsFrom(options.caps);
  const approvalTtlSeconds = approvalTtlFrom(options.approvalTtlSeconds);
  const deposit = depositPaise(settings);
  if (deposit < 1) throw new Error("The deposit must be at least 1 rupee for Guard to allow a payment link.");
  // A refund can be as large as a deposit. If the day's cap is smaller than that, an approved refund would still be refused: say so now, not at the till.
  if (caps.refundPaisePerDay < deposit) throw new Error(`The daily refund cap (${caps.refundPaisePerDay} paise) is smaller than one deposit (${deposit} paise), so an approved refund could still be refused. Raise the cap.`);
  return { depositPaise: deposit, refundThresholdPaise: refundThresholdPaise(settings), caps, approvalTtlSeconds };
}

/** The limits spec of the gateway this client chose (or `options.gateway`). A deposit is the only amount a link may be for, and a refund is never more than one deposit. Same settings, same bytes. */
export function gatewayLimitsSpec(settings: Settings, identity: LimitsSpecIdentity, options: { caps?: Partial<PaymentCaps>; approvalTtlSeconds?: number; gateway?: GatewayGuard } = {}): LimitsSpec {
  if (!Number.isInteger(identity.version) || identity.version < 1) throw new Error("The spec's version must be a whole number, 1 or more.");
  const n = paymentNumbers(settings, options);
  return paymentLimitsSpecFrom({
    identity, approvalTtlSeconds: n.approvalTtlSeconds, caps: n.caps,
    link: { ruleId: "deposit-amount", minPaise: n.depositPaise, maxPaise: n.depositPaise },
    refundBound: { ruleId: "refund-at-most-deposit", maxPaise: n.depositPaise },
    refundThresholdPaise: n.refundThresholdPaise,
  }, options.gateway ?? gatewayGuardOf(settings.payment));
}
