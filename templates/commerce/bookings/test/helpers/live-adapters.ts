// The TypeScript live clients of the stand-ins and of Guard's answers, for the tests of what stays TypeScript (the stand-ins, the dev forwarder, the inbox end to end, Guard's
// answers as an adapter reads them): Payments, Calendar and Messaging over the real wire formats, pointed at a base URL, holding no key and sending no Authorization header.
// Until 24 Nov 2026 this was src/adapters/live/index.ts, the TypeScript runtime's live mode; the runtime is the Go program now (go/internal/bookings), so only these tests use it.
import type { Clock } from "../../../../../modules/core/clock.ts";
import type { Calendar } from "../../src/adapters/calendar.ts";
import type { Messaging } from "../../../../../modules/messaging/messaging.ts";
import type { Payments } from "../../../../../modules/payments/payments.ts";
import { DEFAULT_TIMEOUT_MS } from "../../../../../modules/core/http.ts";
import { createGoogleCalendar } from "../../src/adapters/live/google-calendar.ts";
import { noGateway } from "../../../../../modules/payments/owner-marked/ledger.ts";
import { gatewayAdapter } from "../../../../../modules/payments/providers/runtime.ts";
import type { PaymentSettings } from "../../../../../modules/payments/providers/index.ts";
import { createLiveMessaging } from "../../../../../modules/messaging/providers.ts";
import type { MessagingProvider } from "../../../../../modules/messaging/providers.ts";
import type { WindowStore } from "../../../../../modules/messaging/whatsapp.ts";

export type { WindowStore } from "../../../../../modules/messaging/whatsapp.ts";

export interface LiveServices {
  // Each Guard may ask the agent for its own credential (`agentToken`: what Guard calls the agent's token, never a service key).
  payments?: { baseUrl: string; agentToken?: string }; // Guard in front of the shop's gateway; left out for a shop with none (UPI, B33/B71)
  calendar?: { baseUrl: string; calendarId: string; agentToken?: string }; // Guard in front of Google Calendar; left out for a shop with no Google Calendar (B72)
  // Guard in front of the WhatsApp provider (Meta unless runtime.json names another); item 11h: left out for a shop with no WhatsApp, which keeps working on its page
  messaging?: { baseUrl: string; phoneNumberId: string; agentToken?: string; provider?: MessagingProvider; appId?: string; appName?: string; sourceNumber?: string };
  /** How long to wait for any one reply before treating it as lost. Default 10 seconds. */
  timeoutMs?: number;
}

export function createLiveAdapters(services: LiveServices, deps: { clock: Clock; window: WindowStore; /** The shop's payment block: which gateway the payments service is (B71). */ payment?: PaymentSettings }): { payments: Payments; calendar?: Calendar; messaging?: Messaging } {
  const timeoutMs = services.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    // a UPI shop has no payment service: the agent keeps its own ledger of the owner's marks, and any call here would be a mistake, said plainly
    payments: services.payments ? gatewayAdapter(deps.payment, { baseUrl: services.payments.baseUrl, agentToken: services.payments.agentToken, timeoutMs }) : noGateway,
    // never a stand-in in live mode: no calendar service means the runtime keeps the shop's own booking list, which is saved
    ...(services.calendar ? { calendar: createGoogleCalendar({ baseUrl: services.calendar.baseUrl, calendarId: services.calendar.calendarId, agentToken: services.calendar.agentToken, timeoutMs }) } : {}),
    // the provider runtime.json names (modules/messaging/providers.ts); none for a shop with no WhatsApp (the start then gives the owner push alone)
    ...(services.messaging ? { messaging: createLiveMessaging({ ...services.messaging, timeoutMs }, deps) } : {}),
  };
}
