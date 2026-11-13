// The live services: the same Payments and Messaging the agent already uses, over the real wire formats of the shop's gateway (its folder's runtime.ts) and WhatsApp. They hold NO keys and send NO
// Authorization header. Each points at a base URL, which in production is a Guard instance in front of that one service (Guard adds the credential), and in a test or a
// demo is a stand-in (modules/standins). Fees has no calendar. Same code for both services; only the base URL changes.
import type { Clock } from "../../../../../../modules/core/clock.ts";
import type { Messaging } from "../../../../../../modules/messaging/messaging.ts";
import type { Payments } from "../../../../../../modules/payments/payments.ts";
import { DEFAULT_TIMEOUT_MS } from "../../../../../../modules/core/http.ts";
import { noGateway } from "../../../../../../modules/payments/owner-marked/ledger.ts";
import { gatewayAdapter } from "../../../../../../modules/payments/providers/runtime.ts";
import type { PaymentSettings } from "../../../../../../modules/payments/providers/index.ts";
import { createLiveMessaging } from "../../../../../../modules/messaging/providers.ts";
import type { MessagingProvider } from "../../../../../../modules/messaging/providers.ts";
import type { WindowStore } from "../../../../../../modules/messaging/whatsapp.ts";

export type { WindowStore } from "../../../../../../modules/messaging/whatsapp.ts";

export interface LiveServices {
  // Each Guard may ask the agent for its own credential (`agentToken`: what Guard calls the agent's token, never a service key).
  payments?: { baseUrl: string; agentToken?: string }; // Guard in front of the shop's gateway; left out for a shop with none (UPI, B33/B71)
  // Guard in front of the WhatsApp provider (Meta unless runtime.json names another); item 11h: left out for a shop with no WhatsApp, which keeps working on its page
  messaging?: { baseUrl: string; phoneNumberId: string; agentToken?: string; provider?: MessagingProvider; appId?: string; appName?: string; sourceNumber?: string };
  /** How long to wait for any one reply before treating it as lost. Default 10 seconds. */
  timeoutMs?: number;
}

export function createLiveAdapters(services: LiveServices, deps: { clock: Clock; window: WindowStore; /** The shop's payment block: which gateway the payments service is (B71). */ payment?: PaymentSettings }): { payments: Payments; messaging?: Messaging } {
  const timeoutMs = services.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    // a UPI shop has no payment service: the agent keeps its own ledger of the owner's marks, and any call here would be a mistake, said plainly
    payments: services.payments ? gatewayAdapter(deps.payment, { baseUrl: services.payments.baseUrl, agentToken: services.payments.agentToken, timeoutMs }) : noGateway,
    // the provider runtime.json names (modules/messaging/providers.ts); none for a shop with no WhatsApp (the start then gives the owner push alone)
    ...(services.messaging ? { messaging: createLiveMessaging({ ...services.messaging, timeoutMs }, deps) } : {}),
  };
}
