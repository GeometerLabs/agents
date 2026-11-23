// The FAKE GUARDS of the Fees contract (see README.md in this folder): the two services a deployed Fees centre calls (payments, WhatsApp), as small HTTP servers the centre's
// runtime process reaches through its own runtime.json, exactly as it reaches a Guard in production. Fees has no calendar. The recording proxy is the Bookings contract's
// (templates/commerce/bookings/contract/guards.ts `recorder`, which records every request and can make a Guard slow, down or wrong), so the two contracts hold a Go runtime
// to the same wire.
//
// Behind the recorders: Fees' own stand-ins (standins/server.ts: the Razorpay and WhatsApp wire formats over the in-memory fakes, with the fee and report templates
// approved) and, in front of the payments, the stub Guard (modules/standins/guard.ts) built from the limits spec the deployer generates from the centre's own settings
// (src/guard-limits.ts gatewayLimitsSpec): a refund above `refund.limitInr` is HELD for the owner. Nothing of the centre's RUNTIME (server/, src/agent.ts) is imported.
import { randomBytes } from "node:crypto";
import { systemClock } from "../../../../modules/core/clock.ts";
import { startStubGuard } from "../../../../modules/standins/guard.ts";
import type { RunningStubGuard } from "../../../../modules/standins/guard.ts";
import { razorpayWebhookBody } from "../../../../modules/payments/providers/razorpay/standin.ts";
import { parseRazorpayEvent } from "../../../../modules/payments/providers/razorpay/webhook.ts";
import type { PaymentEvent } from "../../../../modules/payments/payments.ts";
import { recorder } from "../../../commerce/bookings/contract/guards.ts";
import type { GuardCall, Recorder } from "../../../commerce/bookings/contract/guards.ts";
import { startStandins } from "../standins/server.ts";
import type { RunningStandins } from "../standins/server.ts";
import { gatewayLimitsSpec, highestPaise } from "../src/guard-limits.ts";
import { DEFAULT_CAPS } from "../../../../modules/payments/guard-limits.ts";
import type { Settings } from "../src/settings.ts";

export type { GuardCall, Recorder };

export interface FeesGuards {
  calls: GuardCall[];
  payments: Recorder;
  messaging: Recorder;
  /** The credential the payments Guard wants from the runtime (runtime.json names its file). WhatsApp wants none. */
  agentToken: string;
  standins: RunningStandins;
  stub: RunningStubGuard;
  phoneNumberId: string;
  of(service: "payments" | "messaging", method?: string, path?: RegExp): GuardCall[];
  /** A parent pays the payment link `linkId` (the money moves at the provider); the provider's webhook events, read as the inbox reads them, are returned. */
  pay(linkId: string, o?: { amountPaise?: number }): PaymentEvent[];
  /** Every provider event not returned yet, as the inbox reads them. */
  newPaymentEvents(): PaymentEvent[];
  close(): Promise<void>;
}

/** Start the two fake Guards for a centre with these settings (the refund limit makes the stub Guard's threshold, as the deployer generates it). */
export async function startFeesGuards(settings: Settings, o: { approvalTtlSeconds?: number } = {}): Promise<FeesGuards> {
  const phoneNumberId = "100000000000002";
  const agentToken = randomBytes(16).toString("hex");
  const standins = await startStandins({ clock: systemClock, gatewayWebhookSecret: "contract-rzp", whatsappAppSecret: "contract-wa", phoneNumberId }, { port: 0 });
  const stub = await startStubGuard({
    // the day's refund cap is at least the dearest amount (a credit book's account may show ₹50,000, above the default cap; paymentNumbers refuses a cap below it, as a deployer
    // of a gateway credit shop must raise it): for every other centre of this contract the default cap stands, so their specs are as they were
    clock: systemClock, upstreamUrl: standins.url, spec: gatewayLimitsSpec(settings, { tenant: "contract", version: 1, reviewedBy: "contract" }, { ...(o.approvalTtlSeconds !== undefined ? { approvalTtlSeconds: o.approvalTtlSeconds } : {}), caps: { refundPaisePerDay: Math.max(DEFAULT_CAPS.refundPaisePerDay, highestPaise(settings)) } }), agentToken,
    approver: { id: "owner-contract", secret: randomBytes(16).toString("hex") }, readToken: randomBytes(16).toString("hex"),
  });
  const calls: GuardCall[] = [];
  const payments = await recorder("payments", stub.agentUrl, calls);
  const messaging = await recorder("messaging", standins.url, calls);
  let delivered = 0;
  const newPaymentEvents = (): PaymentEvent[] => {
    const fresh = standins.fakes.payments.events.slice(delivered);
    delivered = standins.fakes.payments.events.length;
    // as the inbox reads a Razorpay webhook (it checked the signature; the runtime never holds the secret): the provider's body, then the neutral event
    return fresh.flatMap((e) => { const p = parseRazorpayEvent(JSON.parse(razorpayWebhookBody(e, standins.fakes.payments)), e.id); return p ? [p] : []; });
  };
  return {
    calls, payments, messaging, agentToken, standins, stub, phoneNumberId,
    of: (service, method, path) => calls.filter((c) => c.service === service && (!method || c.method === method) && (!path || path.test(c.path))),
    pay(linkId, po = {}) { standins.fakes.payments.customerPays(linkId, po.amountPaise !== undefined ? { amount: po.amountPaise } : {}); return newPaymentEvents(); },
    newPaymentEvents,
    async close() { for (const r of [payments, messaging]) await r.close(); await stub.close(); await standins.close(); },
  };
}
