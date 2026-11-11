// Messaging through Gupshup, the pilot's WhatsApp provider (decision 3; B49 stage 1). Used by providers.ts when a shop's runtime.json says
// "provider": "gupshup"; the Guard generator (bundle/generate/guards.ts) reads the host and the route shapes from here, so Guard and adapter cannot disagree.
//
// Which Gupshup API, and why (read 11 Nov 2026):
//  - Gupshup's Partner API "v3" pass-through takes Meta's own Cloud API bodies and answers with Meta's own reply, so whatsapp.ts's bodies are reused whole and
//    only the path, the cheap read and the error shape differ (this file). https://partner-docs.gupshup.io/docs/whatsapp-passthrough-apis-for-partners
//    (updated 21 Jul 2026): "raw passthrough APIs which will imitate Meta's format".
//  - send:   POST https://partner.gupshup.io/partner/app/{appId}/v3/message, JSON, header `Authorization: {PARTNER_APP_TOKEN}` (the token as it is, no "Bearer").
//            text, template, interactive, image and document pages, each read 11 Nov 2026:
//            https://partner-docs.gupshup.io/reference/post_partner-app-appid-v3-text-message (template: .../post_partner-app-appid-v3-message-14, updated 14 Oct 2026,
//            whose body is { name, language: { code }, components }, exactly templateBody; interactive: .../post_partner-app-appid-v3-interactive-message;
//            image: .../post_partner-app-appid-v3-image-message; document: .../senddocumentmessage). Each takes a `link` for media, as whatsapp.ts sends.
//  - reply:  { messages: [{ id: "GUPSHUP_MESSAGE_ID" }], messaging_product, contacts } (a Gupshup id, not a wamid). It means GUPSHUP took the message: the send is
//            processed later, so even Meta's refusals (131047, the closed window) arrive afterwards as a "failed" status (webhooks.ts parseWhatsAppStatuses).
//  - errors: { status: "error", message } (401 "Authentication Failed"; 400 "Callback Billing must be enabled for this API"; 400 "Invalid App Details").
//  - read:   GET /partner/app/{appId}/health, `Authorization: {PARTNER_APP_TOKEN}`, answers { status: "success", healthy: "true" }; 10 calls a minute at most.
//            https://partner-docs.gupshup.io/reference/get_partner-app-appid-health
//
// The key: this file holds none and sends none. The base URL is a Guard in front of partner.gupshup.io, and Guard adds the Authorization header from its own file
// (bundle/lib/secrets.ts `gupshup_authorization`). `agentToken` is Guard's credential for this agent, as for every live adapter. Not touched against the real service.
import type { Clock } from "../core/clock.ts";
import { createHttp, isObject, num, str } from "../core/http.ts";
import type { HttpReply } from "../core/http.ts";
import type { Messaging } from "./messaging.ts";
import { createCloudApiMessaging, describeMetaError } from "./whatsapp.ts";
import type { WindowStore } from "./whatsapp.ts";

/** Gupshup's partner API host, as a Guard's upstream (host:port). */
export const GUPSHUP_UPSTREAM = "partner.gupshup.io:443";

/** The two routes, with `{app_id}` where the shop's app id goes: the shapes Guard's spec lists (bundle/generate/guards.ts) and this adapter fills in. */
export const GUPSHUP_ROUTES = { send: "/partner/app/{app_id}/v3/message", read: "/partner/app/{app_id}/health" } as const;

/** A Gupshup app id: Gupshup writes them as UUIDs (07c7c72d-20e3-4ff9-a5a1-14d1186eeec8); anything that could change the path is refused. */
export const GUPSHUP_APP_ID = /^[A-Za-z0-9][A-Za-z0-9-]{7,63}$/u;

export interface GupshupConfig { baseUrl: string; appId: string; timeoutMs?: number; /** Guard's credential for this agent (never a Gupshup token). */ agentToken?: string }

/** The path of a route for this app. */
export const gupshupPath = (route: keyof typeof GUPSHUP_ROUTES, appId: string): string => GUPSHUP_ROUTES[route].replace("{app_id}", encodeURIComponent(appId));

/**
 * Gupshup's refusal in plain words. Its own errors are { status: "error", message }; an error Meta gave and Gupshup passed on keeps Meta's shape (and its code, so
 * 131047 still means the window is closed).
 */
export function describeGupshupError(reply: HttpReply): { message: string; code?: number } {
  const b = reply.body;
  if (isObject(b) && isObject(b.error)) return describeMetaError(reply);
  const message = isObject(b) ? str(b.message) : undefined;
  return { message: message ? `Gupshup: ${message}` : `Gupshup answered ${reply.status}.`, ...(isObject(b) && num(b.code) !== undefined ? { code: num(b.code) } : {}) };
}

/** WhatsApp through Gupshup's v3 pass-through: Meta's bodies to /partner/app/{appId}/v3/message. */
export function createGupshupMessaging(config: GupshupConfig, deps: { clock: Clock; window: WindowStore }): Messaging {
  if (!GUPSHUP_APP_ID.test(config.appId)) throw new Error("The Gupshup app id must be the app's id as Gupshup shows it (letters, digits and hyphens).");
  return createCloudApiMessaging(createHttp(config.baseUrl, "Gupshup", config.timeoutMs, config.agentToken), {
    name: "Gupshup", sendPath: gupshupPath("send", config.appId), pingPath: gupshupPath("read", config.appId), describeError: describeGupshupError,
  }, deps);
}
