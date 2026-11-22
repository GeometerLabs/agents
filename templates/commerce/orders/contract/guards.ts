// The FAKE GUARDS of the Orders contract (see README.md in this folder): the two services a deployed Orders shop calls (payments and WhatsApp; Orders has no calendar), as small
// HTTP servers the shop's runtime process reaches through its own runtime.json, exactly as it reaches a Guard in production. The recording reverse proxy, its fault plans and the
// captured Guard answers are the Bookings contract's (templates/commerce/bookings/contract/guards.ts `recorder` and `fixture`), reused here so both contracts hold a runtime to
// the same wire; only what stands behind them is Orders' own: its stand-ins (templates/commerce/orders/standins: the gateway's and WhatsApp's wire formats over the in-memory
// fakes, with Orders' approved message templates) and, in front of the refunds, the stub Guard (modules/standins/guard.ts) built from the limits spec the deployer generates
// from the shop's own settings (src/guard-limits.ts gatewayLimitsSpec). Nothing of the SHOP RUNTIME (server/, src/agent.ts) is imported.
import { randomBytes } from "node:crypto";
import { systemClock } from "../../../../modules/core/clock.ts";
import { startStubGuard } from "../../../../modules/standins/guard.ts";
import type { RunningStubGuard } from "../../../../modules/standins/guard.ts";
import { startStandins } from "../standins/server.ts";
import type { RunningStandins } from "../standins/server.ts";
import { gatewayLimitsSpec } from "../src/guard-limits.ts";
import type { Settings } from "../src/settings.ts";
import { razorpayWebhookBody } from "../../../../modules/payments/providers/razorpay/standin.ts";
import { parseRazorpayEvent } from "../../../../modules/payments/providers/razorpay/webhook.ts";
import type { PaymentEvent } from "../../../../modules/payments/payments.ts";
import { fixture, recorder } from "../../bookings/contract/guards.ts";
import type { GuardCall, Recorder } from "../../bookings/contract/guards.ts";

export { fixture };
export type { GuardCall, Recorder };
export type Service = "payments" | "messaging";

export interface FakeGuards {
  /** Every call to either service, oldest first. */
  calls: GuardCall[];
  payments: Recorder;
  messaging: Recorder;
  /** The credential the payments Guard wants from the runtime (runtime.json names its file). WhatsApp wants none. */
  agentToken: string;
  /** The in-memory services behind the recorders: the witnesses (what was paid and refunded) and the customer's side (a customer pays, a customer writes). */
  standins: RunningStandins;
  stub: RunningStubGuard;
  /** The WhatsApp number id the shop's runtime.json must name. */
  phoneNumberId: string;
  of(service: Service, method?: string, path?: RegExp): GuardCall[];
  /** The customer pays the payment link `linkId`; the provider's webhook events, read as the inbox reads them, are returned (post them to /internal/events). */
  pay(linkId: string, o?: { amountPaise?: number }): PaymentEvent[];
  /** Every provider webhook event that `pay` has not returned yet (a refund's, say), as the inbox reads them. */
  newPaymentEvents(): PaymentEvent[];
  close(): Promise<void>;
}

/**
 * Start the two fake Guards for a shop with these settings. The refund limit and the dearest order in the settings make the stub Guard's threshold and bounds, as the
 * deployer generates them, so a refund above the owner's limit is HELD and one above the dearest order is REFUSED.
 */
export async function startGuards(settings: Settings, o: { phoneNumberId?: string; approvalTtlSeconds?: number } = {}): Promise<FakeGuards> {
  const phoneNumberId = o.phoneNumberId ?? "100000000000002";
  const agentToken = randomBytes(16).toString("hex");
  const standins = await startStandins({ clock: systemClock, gatewayWebhookSecret: "contract-rzp", whatsappAppSecret: "contract-wa", phoneNumberId }, { port: 0 });
  const stub = await startStubGuard({
    clock: systemClock, upstreamUrl: standins.url, spec: gatewayLimitsSpec(settings, { tenant: "contract", version: 1, reviewedBy: "contract" }, o.approvalTtlSeconds !== undefined ? { approvalTtlSeconds: o.approvalTtlSeconds } : {}), agentToken,
    approver: { id: "owner-contract", secret: randomBytes(16).toString("hex") }, readToken: randomBytes(16).toString("hex"),
  });
  const calls: GuardCall[] = [];
  // the recorder's service names are Bookings' three; Orders uses two of them
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
