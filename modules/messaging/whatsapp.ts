// Messaging over the WhatsApp Cloud API's wire format, mapped to the Messaging interface. Deliberately thin.
// No token, no Authorization header: the base URL is a Guard instance in front of the WhatsApp provider (or a stand-in).
//
// Providers (11 Nov 2026): Meta direct is this file. A provider that takes Meta's own bodies (Gupshup's v3 pass-through, the pilot's, decision 3)
// is one more small file beside it (gupshup.ts) that passes its own path, read and error reader through the seam below (CloudApiWire);
// providers.ts picks one from the shop's runtime.json, and every createLiveAdapters calls that. The bodies and the reply are the same code.
//
// Wire facts this file rests on (Meta's own docs; read 3 Nov 2026):
//  - send:    POST /{version}/{phone-number-id}/messages, body { messaging_product: "whatsapp", recipient_type: "individual", to, type, ... }.
//             Graph v26.0 is the newest version on https://developers.facebook.com/docs/graph-api/changelog/versions (v25.0 is also live).
//             https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages.md
//  - text:    type "text", text: { body, preview_url }.
//  - template: type "template", template: { name, language: { code }, components: [{ type: "body", parameters: [{ type: "text", text }] }] }.
//             https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview
//  - interactive: type "interactive", interactive: { type: "button", body: { text }, action: { buttons: [{ type: "reply", reply: { id, title } }] } } (1 to 3 buttons,
//             titles up to 20 characters), or { type: "list", body: { text }, action: { button, sections: [{ rows: [{ id, title, description }] }] } } (up to 10 rows in all,
//             titles up to 24, descriptions up to 72, the button up to 20). Free-form like text: only inside the 24-hour window.
//             https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/interactive-reply-buttons-messages.md and interactive-list-messages.md
//  - document: type "document", document: { link, filename, caption }. WhatsApp fetches the link itself (https, public) and takes PDF, plain text, Word, Excel and
//             PowerPoint, not HTML. A session message like text: only inside the 24-hour window.
//             https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/document-messages.md
//  - image:   type "image", image: { link, caption }. Like a document, WhatsApp fetches the link itself (https, public; PNG or JPEG, at most 5 MB) and it is a session
//             message: only inside the 24-hour window. Sending by `link` keeps the call one JSON body through Guard; an uploaded media id would need a second route.
//             https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/image-messages.md
//  - audio:   type "audio", audio: { link } (or { id }); Meta recommends an uploaded id but takes a link, as for the other media; MP3, AAC, M4A, AMR and Ogg Opus, at most
//             16 MB. `voice: true` (the voice-message bubble) needs Ogg Opus; a reply made as MP3 goes without it. A session message: only inside the 24-hour window.
//             https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/audio-messages.md (read 12 Nov 2026)
//  - reply:   { messaging_product, contacts: [{ input, wa_id }], messages: [{ id: "wamid...", message_status? }] }. It means the API
//             ACCEPTED the message. Delivery arrives later as a status webhook.
//  - errors:  { error: { message, type, code, error_data: { details }, fbtrace_id } }. Code 131047: more than 24 hours since the customer
//             last replied (send a template). 132001: no such template in that language. 132000: wrong number of parameters.
//             https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes.md
//  - the 24-hour window: opens when the customer writes and resets on each of their messages. There is no API that reports it.
//
// What "confirmed" can mean here: WhatsApp has NO endpoint to read a sent message back. getMessage returns the local copy of what the
// send call accepted, keyed by the id the reply gave. So a live "confirmed" is "WhatsApp accepted it", NOT "delivered". Delivered, read and
// failed arrive later as status webhooks: the inbox reads them (webhooks.ts parseWhatsAppStatuses) and the runtime records each against
// the message it sent (statuses.ts), in words that keep "accepted" and "delivered" apart.
import type { Clock } from "../core/clock.ts";
import { HOUR } from "../core/time.ts";
import { META_LANGUAGE } from "../language/meta-templates.ts";
import { ApiError, WindowClosedError } from "../core/faults.ts";
import { interactiveProblem, interactiveText } from "../language/interactive.ts";
import type { InteractiveMessage } from "../language/interactive.ts";
import { audioProblem, documentProblem, imageProblem } from "./messaging.ts";
import type { AudioMessage, DocumentMessage, ImageMessage, Messaging, OutboundMessage, TemplateMessage } from "./messaging.ts";
import { asArray, createHttp, isObject, num, str } from "../core/http.ts";
import type { Http, HttpReply, Json } from "../core/http.ts";

/** The Graph API version in every path. One place to change it. */
export const GRAPH_VERSION = "v26.0";

/** The runtime's own knowledge of when each customer last wrote. WhatsApp has no API for the 24-hour window. */
export interface WindowStore { lastInboundAt(phone: string): number | undefined }

export interface WhatsAppConfig { baseUrl: string; phoneNumberId: string; timeoutMs?: number; /** Guard's credential for this agent (never a WhatsApp token). Left out, no Authorization header is sent. */ agentToken?: string }

const WINDOW_CLOSED_CODE = 131047;
const KEPT_MESSAGES = 1000; // the local copy is for the read-back right after a send; it does not grow without end

/** Meta's refusal in plain words, and its error code (131047 is the closed 24-hour window). A provider that passes Meta's errors on reads them with this too. */
export function describeMetaError(reply: HttpReply): { message: string; code?: number } {
  const e = isObject(reply.body) && isObject(reply.body.error) ? reply.body.error : undefined;
  const details = e && isObject(e.error_data) ? str(e.error_data.details) : undefined;
  return { message: details ?? str(e?.message) ?? `WhatsApp answered ${reply.status}.`, code: num(e?.code) };
}

/**
 * What differs between Meta direct and a provider that takes Meta's own bodies and answers with Meta's own reply (Gupshup's v3 pass-through): where a send goes,
 * where the cheap read for guard-wait.ts goes, and how a refusal reads. Everything else (the bodies, the 24-hour window, the read-back copy) is the same code.
 */
export interface CloudApiWire {
  /** The service's name in errors: "WhatsApp", "Gupshup". */
  name: string;
  sendPath: string;
  /** A read that reaches this service's Guard and changes nothing (Messaging.ping). */
  pingPath: string;
  describeError(reply: HttpReply): { message: string; code?: number };
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

/** The wire body for a reply-buttons or list message. Exported so the tests (and the stand-in) can read it. */
export function interactiveBody(to: string, message: InteractiveMessage): Json {
  const action: Json = message.buttons
    ? { buttons: message.buttons.map((b) => ({ type: "reply", reply: { id: b.id, title: b.title } })) }
    : { button: message.list!.button, sections: [{ rows: message.list!.rows.map((r) => ({ id: r.id, title: r.title, ...(r.description ? { description: r.description } : {}) })) }] };
  return { messaging_product: "whatsapp", recipient_type: "individual", to, type: "interactive", interactive: { type: message.buttons ? "button" : "list", body: { text: message.body }, action } };
}

/** The wire body for a document sent by its address. Exported so the tests (and the stand-in) can read it. */
export function documentBody(to: string, doc: DocumentMessage): Json {
  return { messaging_product: "whatsapp", recipient_type: "individual", to, type: "document", document: { link: doc.link, filename: doc.filename, ...(doc.caption ? { caption: doc.caption } : {}) } };
}

/** The wire body for an image sent by its address. Exported so the tests (and the stand-in) can read it. */
export function imageBody(to: string, image: ImageMessage): Json {
  return { messaging_product: "whatsapp", recipient_type: "individual", to, type: "image", image: { link: image.link, ...(image.caption ? { caption: image.caption } : {}) } };
}

/** The wire body for a spoken reply sent by its address (an audio message: `link`, plus `voice: true` only for an Ogg Opus reply, which is what WhatsApp needs to show the voice-note bubble; an MP3 reply goes without it). */
export function audioBody(to: string, audio: AudioMessage): Json {
  return { messaging_product: "whatsapp", recipient_type: "individual", to, type: "audio", audio: { link: audio.link, ...(audio.voice ? { voice: true } : {}) } };
}

/** Meta's Cloud API, direct (or through Meta's own test number): the default provider. */
export function createWhatsAppMessaging(config: WhatsAppConfig, deps: { clock: Clock; window: WindowStore }): Messaging {
  const number = `/${GRAPH_VERSION}/${encodeURIComponent(config.phoneNumberId)}`;
  return createCloudApiMessaging(createHttp(config.baseUrl, "WhatsApp", config.timeoutMs, config.agentToken), { name: "WhatsApp", sendPath: `${number}/messages`, pingPath: number, describeError: describeMetaError }, deps);
}

/**
 * The Messaging interface over Meta's Cloud API bodies, sent to `wire.sendPath` on `http` (a Guard in front of the provider: `http` carries only the agent's credential
 * for that Guard, never the provider's key). Exported for a provider file like gupshup.ts; a template uses providers.ts.
 */
export function createCloudApiMessaging(http: Http, wire: CloudApiWire, deps: { clock: Clock; window: WindowStore }): Messaging {
  const path = wire.sendPath;
  const sent = new Map<string, OutboundMessage>();

  const windowOpen = (to: string) => {
    const last = deps.window.lastInboundAt(to);
    return last !== undefined && deps.clock.now() - last < 24 * HOUR;
  };

  /** Send, and keep what the provider accepted. */
  async function send(body: Json, copy: Omit<OutboundMessage, "id" | "sentAt" | "afterOptOut" | "acceptedAs">): Promise<OutboundMessage> {
    const reply = await http.request("POST", path, { body });
    if (reply.status < 200 || reply.status >= 300) {
      const { message, code } = wire.describeError(reply);
      if (code === WINDOW_CLOSED_CODE) throw new WindowClosedError();
      throw new ApiError(reply.status, message);
    }
    const first = isObject(reply.body) ? asArray(reply.body.messages).find(isObject) : undefined;
    const id = str(first?.id);
    if (!id) throw new ApiError(502, `${wire.name} accepted the call but gave no message id.`);
    const acceptedAs = str(first?.message_status) ?? "accepted";
    if (acceptedAs === "paused") throw new ApiError(503, `${wire.name} has paused sending, so the message will not go out.`);
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

    async sendInteractive(to, message) {
      if (!windowOpen(to)) throw new WindowClosedError(); // like free text, WhatsApp would refuse (131047)
      const problem = interactiveProblem(message);
      if (problem) throw new ApiError(400, `The message cannot be sent as buttons or a list: ${problem}.`); // never sent: the agent sends the same words as plain text
      return send(interactiveBody(to, message), { to, kind: "interactive", text: interactiveText(message), interactive: structuredClone(message) });
    },

    async sendDocument(to, doc) {
      if (!windowOpen(to)) throw new WindowClosedError(); // a file is a session message too (131047 otherwise)
      const problem = documentProblem(doc);
      if (problem) throw new ApiError(400, `The document cannot be sent: ${problem}.`);
      return send(documentBody(to, doc), { to, kind: "document", text: doc.caption ?? doc.filename, document: { ...doc } });
    },

    async sendImage(to, image) {
      if (!windowOpen(to)) throw new WindowClosedError(); // a picture is a session message too (131047 otherwise)
      const problem = imageProblem(image);
      if (problem) throw new ApiError(400, `The image cannot be sent: ${problem}.`);
      return send(imageBody(to, image), { to, kind: "image", text: image.caption ?? "", image: { ...image } });
    },

    async sendAudio(to, audio) {
      if (!windowOpen(to)) throw new WindowClosedError(); // a spoken reply is a session message too (131047 otherwise)
      const problem = audioProblem(audio);
      if (problem) throw new ApiError(400, `The audio cannot be sent: ${problem}.`);
      return send(audioBody(to, audio), { to, kind: "audio", text: audio.text, audio: { ...audio } });
    },

    async sendTemplate(to, template) {
      return send(templateBody(to, template), { to, kind: "template", text: template.text, templateName: template.name, language: template.language });
    },

    async isWindowOpen(to) { return windowOpen(to); },

    async ping() { return http.request("GET", wire.pingPath); },

    /** Not a read from WhatsApp (there is none): the copy of what the send call accepted. Null after a restart. */
    async getMessage(id) {
      const m = sent.get(id);
      return m ? { ...m } : null;
    },
  };
}
