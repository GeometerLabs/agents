// The live services: the same Payments, Calendar and Messaging the agent already uses, over the real wire formats of Razorpay,
// Google Calendar and WhatsApp. They hold NO keys and send NO Authorization header. Each points at a base URL, which in production
// is a Guard instance in front of that one service (Guard adds the credential), and in a test or a demo is a stand-in
// (pathways/bookings/standins). Same code for all three; only the base URL changes.
import type { Clock } from "../../../../../modules/core/clock.ts";
import type { Calendar } from "../calendar.ts";
import type { Messaging } from "../../../../../modules/messaging/messaging.ts";
import type { Payments } from "../../../../../modules/payments/payments.ts";
import { DEFAULT_TIMEOUT_MS } from "../../../../../modules/core/http.ts";
import { createGoogleCalendar } from "./google-calendar.ts";
import { createRazorpayPayments } from "../../../../../modules/payments/razorpay.ts";
import { createWhatsAppMessaging } from "../../../../../modules/messaging/whatsapp.ts";
import type { WindowStore } from "../../../../../modules/messaging/whatsapp.ts";

export type { WindowStore } from "../../../../../modules/messaging/whatsapp.ts";

export interface LiveServices {
  // Each Guard may ask the agent for its own credential (`agentToken`: what Guard calls the agent's token, never a service key).
  payments: { baseUrl: string; agentToken?: string }; // Guard in front of Razorpay
  calendar: { baseUrl: string; calendarId: string; agentToken?: string }; // Guard in front of Google Calendar
  messaging: { baseUrl: string; phoneNumberId: string; agentToken?: string }; // Guard in front of the WhatsApp provider
  /** How long to wait for any one reply before treating it as lost. Default 10 seconds. */
  timeoutMs?: number;
}

export function createLiveAdapters(services: LiveServices, deps: { clock: Clock; window: WindowStore }): { payments: Payments; calendar: Calendar; messaging: Messaging } {
  const timeoutMs = services.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    payments: createRazorpayPayments({ baseUrl: services.payments.baseUrl, agentToken: services.payments.agentToken, timeoutMs }),
    calendar: createGoogleCalendar({ baseUrl: services.calendar.baseUrl, calendarId: services.calendar.calendarId, agentToken: services.calendar.agentToken, timeoutMs }),
    messaging: createWhatsAppMessaging({ baseUrl: services.messaging.baseUrl, phoneNumberId: services.messaging.phoneNumberId, agentToken: services.messaging.agentToken, timeoutMs }, deps),
  };
}
