// Which WhatsApp provider a shop's live runtime talks to, chosen by its runtime.json (services.messaging.provider). Every template's createLiveAdapters and the
// approvals relay call `createLiveMessaging`, so a provider is added here once. Meta direct is the default: a runtime.json that names no provider behaves exactly
// as before. Whichever is chosen, the base URL is a Guard in front of that provider and the provider's key is Guard's (no adapter here holds or sends one).
import type { Clock } from "../core/clock.ts";
import type { Messaging } from "./messaging.ts";
import { GUPSHUP_APP_ID, createGupshupMessaging } from "./gupshup.ts";
import { GUPSHUP_APP_NAME, GUPSHUP_SELFSERVE_APP_ID, GUPSHUP_SOURCE_NUMBER, createGupshupSelfServeMessaging } from "./gupshup-selfserve.ts";
import { createWhatsAppMessaging } from "./whatsapp.ts";
import type { WindowStore } from "./whatsapp.ts";

/**
 * "meta": Meta's Cloud API, direct (the default). "gupshup": Gupshup's partner v3 pass-through (gupshup.ts). "gupshup-selfserve": Gupshup's own customer API with the
 * shop's own app and key (gupshup-selfserve.ts), the pilot's route (decision 42).
 */
export const MESSAGING_PROVIDERS = ["meta", "gupshup", "gupshup-selfserve"] as const;
export type MessagingProvider = (typeof MESSAGING_PROVIDERS)[number];

/** services.messaging as the live adapters take it (the agent's Guard credential already read from its file). */
export interface LiveMessagingConfig {
  baseUrl: string;
  /** The number's id at Meta. Kept for every provider: the inbox matches webhooks by it, and Gupshup's callbacks carry it too (metadata.phone_number_id). */
  phoneNumberId: string;
  /** Left out: "meta". */
  provider?: MessagingProvider;
  /** Gupshup only: the shop's Gupshup app id (partner mode: needed; self-serve: optional, for the newer template list). */
  appId?: string;
  /** Gupshup self-serve only: the app's name and its number (digits with the country code), as Gupshup shows them. */
  appName?: string;
  sourceNumber?: string;
  agentToken?: string;
  timeoutMs?: number;
}

/** Why services.messaging's provider fields cannot be used, in plain words, or null. Read by runtime.json's check (modules/runtime/config.ts) and the bundle. */
export function messagingConfigProblem(c: { provider?: unknown; appId?: unknown; appName?: unknown; sourceNumber?: unknown }): string | null {
  if (c.provider !== undefined && !(MESSAGING_PROVIDERS as readonly unknown[]).includes(c.provider)) return `services.messaging.provider must be one of ${MESSAGING_PROVIDERS.map((p) => `"${p}"`).join(", ")} ("meta" when left out).`;
  if (c.provider === "gupshup" && (typeof c.appId !== "string" || !GUPSHUP_APP_ID.test(c.appId))) return 'services.messaging.appId is needed with "provider": "gupshup": the shop\'s Gupshup app id, as Gupshup shows it (letters, digits and hyphens).';
  if (c.provider === "gupshup-selfserve") {
    if (typeof c.appName !== "string" || !GUPSHUP_APP_NAME.test(c.appName)) return 'services.messaging.appName is needed with "provider": "gupshup-selfserve": the shop\'s Gupshup app name, as Gupshup shows it (letters, digits and underscores).';
    if (typeof c.sourceNumber !== "string" || !GUPSHUP_SOURCE_NUMBER.test(c.sourceNumber)) return 'services.messaging.sourceNumber is needed with "provider": "gupshup-selfserve": the app\'s WhatsApp number with its country code, digits only.';
    if (c.appId !== undefined && (typeof c.appId !== "string" || !GUPSHUP_SELFSERVE_APP_ID.test(c.appId))) return "services.messaging.appId, when given, must be the app's id as Gupshup shows it (letters, digits and hyphens).";
    return null;
  }
  if (c.appName !== undefined || c.sourceNumber !== undefined) return 'services.messaging.appName and sourceNumber are only for "provider": "gupshup-selfserve".';
  if (c.provider !== "gupshup" && c.appId !== undefined) return 'services.messaging.appId is only for "provider": "gupshup" (or, optionally, "gupshup-selfserve").';
  return null;
}

/** The live Messaging for this shop's provider. Throws, in plain words, for a config messagingConfigProblem refuses. */
export function createLiveMessaging(config: LiveMessagingConfig, deps: { clock: Clock; window: WindowStore }): Messaging {
  const problem = messagingConfigProblem(config);
  if (problem) throw new Error(problem);
  if (config.provider === "gupshup") return createGupshupMessaging({ baseUrl: config.baseUrl, appId: config.appId!, timeoutMs: config.timeoutMs, agentToken: config.agentToken }, deps);
  if (config.provider === "gupshup-selfserve") return createGupshupSelfServeMessaging({ baseUrl: config.baseUrl, appName: config.appName!, sourceNumber: config.sourceNumber!, appId: config.appId, timeoutMs: config.timeoutMs, agentToken: config.agentToken }, deps);
  return createWhatsAppMessaging({ baseUrl: config.baseUrl, phoneNumberId: config.phoneNumberId, timeoutMs: config.timeoutMs, agentToken: config.agentToken }, deps);
}
