// Messaging over the WhatsApp Cloud API's wire format, mapped to the Messaging interface. Deliberately thin.
// No token, no Authorization header: the base URL is a Guard instance in front of the WhatsApp provider (or a stand-in).
//
// THE PROVIDER IS NOT CHOSEN YET. Gupshup, AiSensy, Interakt or 360dialog sit in front of Meta's API and each has its own paths and
// bodies (360dialog is closest to Meta's). This file speaks Meta's Cloud API shape; a provider is added as one more small file that
// builds its own request and reads its own reply, and createLiveAdapters picks it. Nothing else here would change.
//
// Wire facts this file rests on (Meta's own docs; read 3 Nov 2026):
//  - send:    POST /{version}/{phone-number-id}/messages, body { messaging_product: "whatsapp", recipient_type: "individual", to, type, ... }.
//             Graph v26.0 is the newest version on https://developers.facebook.com/docs/graph-api/changelog/versions (v25.0 is also live).
//             https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages.md
//  - text:    type "text", text: { body, preview_url }.
//  - template: type "template", template: { name, language: { code }, components: [{ type: "body", parameters: [{ type: "text", text }] }] }.
//             https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview
//  - reply:   { messaging_product, contacts: [{ input, wa_id }], messages: [{ id: "wamid...", message_status? }] }. It means the API
//             ACCEPTED the message. Delivery arrives later as a status webhook.
//  - errors:  { error: { message, type, code, error_data: { details }, fbtrace_id } }. Code 131047: more than 24 hours since the customer
//             last replied (send a template). 132001: no such template in that language. 132000: wrong number of parameters.
//             https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes.md
//  - the 24-hour window: opens when the customer writes and resets on each of their messages. There is no API that reports it.
//
// What "confirmed" can mean here: WhatsApp has NO endpoint to read a sent message back. getMessage returns the local copy of what the
// send call accepted, keyed by the wamid. So a live "confirmed" is "WhatsApp accepted it", NOT "delivered". Delivered, read and
// failed come from status webhooks, which are not handled yet (Deferred.md).
import type { Clock } from "../../clock.ts";
import { HOUR } from "../../time.ts";
import type { Language } from "../../settings.ts";
import { ApiError, WindowClosedError } from "../faults.ts";
import type { Messaging, OutboundMessage, TemplateMessage } from "../messaging.ts";
import { asArray, createHttp, isObject, num, str } from "./http.ts";
import type { Http, HttpReply, Json } from "./http.ts";

/** The Graph API version in every path. One place to change it. */
export const GRAPH_VERSION = "v26.0";

/** The runtime's own knowledge of when each customer last wrote. WhatsApp has no API for the 24-hour window. */
export interface WindowStore { lastInboundAt(phone: string): number | undefined }

export interface WhatsAppConfig { baseUrl: string; phoneNumberId: string; timeoutMs?: number }

/** Our languages as Meta's template language codes. */
export const META_LANGUAGE: Record<Language, string> = { en: "en", hi: "hi", ml: "ml", kn: "kn" };

const WINDOW_CLOSED_CODE = 131047;
const KEPT_MESSAGES = 1000; // the local copy is for the read-back right after a send; it does not grow without end

function describeError(reply: HttpReply): { message: string; code?: number } {
  const e = isObject(reply.body) && isObject(reply.body.error) ? reply.body.error : undefined;
  const details = e && isObject(e.error_data) ? str(e.error_data.details) : undefined;
  return { message: details ?? str(e?.message) ?? `WhatsApp answered ${reply.status}.`, code: num(e?.code) };
}

/** A template value may not hold line breaks, tabs or runs of spaces; the record's values never do, so this only guards. */
export const cleanParameter = (value: string): string => value.replace(/\s+/gu, " ").trim();

/** The wire body for a template message. Exported so the tests (and the stand-in) can read it. */
export function templateBody(to: string, template: TemplateMessage): Json {
  const parameters = template.parameters ?? [];
  return {
    messaging_product: "whatsapp", recipient_type: "individual", to, type: "template",
    template: {
      name: template.name, language: { code: META_LANGUAGE[template.language] },
      ...(parameters.length > 0 ? { components: [{ type: "body", parameters: parameters.map((p) => ({ type: "text", text: cleanParameter(p) })) }] } : {}),
    },
  };
}

export function createWhatsAppMessaging(config: WhatsAppConfig, deps: { clock: Clock; window: WindowStore }): Messaging {
  const http: Http = createHttp(config.baseUrl, "WhatsApp", config.timeoutMs);
  const path = `/${GRAPH_VERSION}/${encodeURIComponent(config.phoneNumberId)}/messages`;
  const sent = new Map<string, OutboundMessage>();

  const windowOpen = (to: string) => {
    const last = deps.window.lastInboundAt(to);
    return last !== undefined && deps.clock.now() - last < 24 * HOUR;
  };

  /** Send, and keep what the provider accepted. */
  async function send(body: Json, copy: Omit<OutboundMessage, "id" | "sentAt" | "afterOptOut" | "acceptedAs">): Promise<OutboundMessage> {
    const reply = await http.request("POST", path, { body });
    if (reply.status < 200 || reply.status >= 300) {
      const { message, code } = describeError(reply);
      if (code === WINDOW_CLOSED_CODE) throw new WindowClosedError();
      throw new ApiError(reply.status, message);
    }
    const first = isObject(reply.body) ? asArray(reply.body.messages).find(isObject) : undefined;
    const id = str(first?.id);
    if (!id) throw new ApiError(502, "WhatsApp accepted the call but gave no message id.");
    const acceptedAs = str(first?.message_status) ?? "accepted";
    if (acceptedAs === "paused") throw new ApiError(503, "WhatsApp has paused sending, so the message will not go out.");
    // sentAt is when we handed it over. afterOptOut is not knowable here: the agent's own STOP gate is the guard.
    const message: OutboundMessage = { ...copy, id, sentAt: deps.clock.now(), afterOptOut: false, acceptedAs };
    sent.set(id, message);
    if (sent.size > KEPT_MESSAGES) sent.delete(sent.keys().next().value as string);
    return { ...message };
  }

  return {
    async sendText(to, text) {
      if (!windowOpen(to)) throw new WindowClosedError(); // WhatsApp would refuse (131047); no need to ask
      return send({ messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { body: text, preview_url: false } }, { to, kind: "text", text });
    },

    async sendTemplate(to, template) {
      return send(templateBody(to, template), { to, kind: "template", text: template.text, templateName: template.name, language: template.language });
    },

    async isWindowOpen(to) { return windowOpen(to); },

    /** Not a read from WhatsApp (there is none): the copy of what the send call accepted. Null after a restart. */
    async getMessage(id) {
      const m = sent.get(id);
      return m ? { ...m } : null;
    },
  };
}
