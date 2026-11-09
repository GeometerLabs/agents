// The live services: the same Payments, Calendar and Messaging the agent already uses, over the real wire formats of Razorpay,
// Google Calendar and WhatsApp. They hold NO keys and send NO Authorization header. Each points at a base URL, which in production
// is a Guard instance in front of that one service (Guard adds the credential), and in a test or a demo is a stand-in
// (templates/commerce/bookings/standins). Same code for all three; only the base URL changes.
import type { Clock } from "../../../../../../modules/core/clock.ts";
import type { Calendar } from "../calendar.ts";
import type { Messaging } from "../../../../../../modules/messaging/messaging.ts";
import type { Payments } from "../../../../../../modules/payments/payments.ts";
import { DEFAULT_TIMEOUT_MS } from "../../../../../../modules/core/http.ts";
import { createGoogleCalendar } from "./google-calendar.ts";
import { noGateway } from "../../../../../../modules/payments/owner-marked/ledger.ts";
import { gatewayAdapter } from "../../../../../../modules/payments/providers/runtime.ts";
import type { PaymentSettings } from "../../../../../../modules/payments/providers/index.ts";
import { createWhatsAppMessaging } from "../../../../../../modules/messaging/whatsapp.ts";
import type { WindowStore } from "../../../../../../modules/messaging/whatsapp.ts";

export type { WindowStore } from "../../../../../../modules/messaging/whatsapp.ts";

export interface LiveServices {
  // Each Guard may ask the agent for its own credential (`agentToken`: what Guard calls the agent's token, never a service key).
  payments?: { baseUrl: string; agentToken?: string }; // Guard in front of the shop's gateway; left out for a shop with none (UPI, B33/B71)
  calendar: { baseUrl: string; calendarId: string; agentToken?: string }; // Guard in front of Google Calendar
  messaging: { baseUrl: string; phoneNumberId: string; agentToken?: string }; // Guard in front of the WhatsApp provider
  /** How long to wait for any one reply before treating it as lost. Default 10 seconds. */
  timeoutMs?: number;
}

export function createLiveAdapters(services: LiveServices, deps: { clock: Clock; window: WindowStore; /** The shop's payment block: which gateway the payments service is (B71). */ payment?: PaymentSettings }): { payments: Payments; calendar: Calendar; messaging: Messaging } {
  const timeoutMs = services.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    // a UPI shop has no payment service: the agent keeps its own ledger of the owner's marks, and any call here would be a mistake, said plainly
    payments: services.payments ? gatewayAdapter(deps.payment, { baseUrl: services.payments.baseUrl, agentToken: services.payments.agentToken, timeoutMs }) : noGateway,
    calendar: createGoogleCalendar({ baseUrl: services.calendar.baseUrl, calendarId: services.calendar.calendarId, agentToken: services.calendar.agentToken, timeoutMs }),
    messaging: createWhatsAppMessaging({ baseUrl: services.messaging.baseUrl, phoneNumberId: services.messaging.phoneNumberId, agentToken: services.messaging.agentToken, timeoutMs }, deps),
  };
}
