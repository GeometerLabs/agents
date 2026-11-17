// The live service: the same Messaging the agent already uses, over the real WhatsApp wire format. It holds NO key and sends NO Authorization header of its own: its base
// URL is, in production, a Guard instance in front of WhatsApp (Guard adds the credential), and in a test or a demo a stand-in (modules/standins). Stock orders has no
// payments and no calendar.
import type { Clock } from "../../../../../../modules/core/clock.ts";
import type { Messaging } from "../../../../../../modules/messaging/messaging.ts";
import { DEFAULT_TIMEOUT_MS } from "../../../../../../modules/core/http.ts";
import { createLiveMessaging } from "../../../../../../modules/messaging/providers.ts";
import type { MessagingProvider } from "../../../../../../modules/messaging/providers.ts";
import type { WindowStore } from "../../../../../../modules/messaging/whatsapp.ts";

export type { WindowStore } from "../../../../../../modules/messaging/whatsapp.ts";

export interface LiveServices {
  /** Guard in front of the WhatsApp provider (Meta unless runtime.json names another). Required here: a supplier is reached on WhatsApp only. */
  messaging: { baseUrl: string; phoneNumberId: string; agentToken?: string; provider?: MessagingProvider; appId?: string; appName?: string; sourceNumber?: string };
  /** How long to wait for any one reply before treating it as lost. Default 10 seconds. */
  timeoutMs?: number;
}

export function createLiveAdapters(services: LiveServices, deps: { clock: Clock; window: WindowStore }): { messaging: Messaging } {
  const timeoutMs = services.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return { messaging: createLiveMessaging({ ...services.messaging, timeoutMs }, deps) };
}
