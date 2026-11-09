// Webhooks: checking who sent them, and reading them into the events the agent understands. Pure functions; the inbox (inbox/) uses them,
// and the stand-ins use the signing half to send what the providers send. The agent runtime never imports this: it never holds a webhook secret.
// A payment provider's webhook is in its own folder (modules/payments/providers/<name>/webhook.ts) and uses the signing helpers here.
//
// Wire facts (read 3 Nov 2026):
//  - Meta signs the raw body: header X-Hub-Signature-256 is "sha256=" and the hex HMAC-SHA256 of the payload with the App Secret.
//    https://developers.facebook.com/docs/graph-api/webhooks/getting-started
//  - WhatsApp payload examples: https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages.md
//    (text.md, interactive.md, button.md, audio.md, status.md next to it)
import { createHmac, timingSafeEqual } from "node:crypto";
import type { InboundMessage } from "./messaging.ts";
import { asArray, isObject, str } from "../core/http.ts";

// ---- signatures --------------------------------------------------------------------------------------------------------------

/** The hex HMAC-SHA256 of a raw body: how Meta and most payment providers sign a webhook. */
export const hmacHex = (rawBody: Buffer, secret: string) => createHmac("sha256", secret).update(rawBody).digest("hex");

/** Compare two hex strings in constant time. A missing, short, long or non-hex value is simply false. */
export function sameHex(expected: string, given: string | undefined): boolean {
  if (typeof given !== "string" || given.length !== expected.length || !/^[0-9a-f]+$/iu.test(given)) return false;
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(given, "hex"));
}

/** The X-Hub-Signature-256 value Meta would send for this body: what the stand-in sends. */
export const signMeta = (rawBody: Buffer, appSecret: string): string => `sha256=${hmacHex(rawBody, appSecret)}`;

/** Is this body what Meta sent? The header must be "sha256=" and the hex digest. */
export function verifyMetaSignature(rawBody: Buffer, header: string | undefined, appSecret: string): boolean {
  if (appSecret.length === 0 || typeof header !== "string" || !header.startsWith("sha256=")) return false;
  return sameHex(hmacHex(rawBody, appSecret), header.slice("sha256=".length));
}

// ---- WhatsApp messages -------------------------------------------------------------------------------------------------------

/** Our numbers are E.164 with a plus. Meta writes `from` as digits only, so the plus is put back; anything that is not a number is not ours to answer. */
export function toE164(from: unknown): string | undefined {
  const digits = typeof from === "string" ? from.replace(/^\+/u, "") : "";
  return /^\d{6,15}$/u.test(digits) ? `+${digits}` : undefined;
}

/** What the customer wrote, as text: the words of a text message, or the label of the button or list row they tapped. */
function textOf(message: Record<string, unknown>): string | undefined {
  switch (message.type) {
    case "text": return isObject(message.text) ? str(message.text.body) : undefined;
    case "interactive": {
      const i = message.interactive;
      if (!isObject(i)) return undefined;
      const reply = isObject(i.button_reply) ? i.button_reply : isObject(i.list_reply) ? i.list_reply : undefined;
      return str(reply?.title);
    }
    case "button": return isObject(message.button) ? str(message.button.text) ?? str(message.button.payload) : undefined; // a template's quick-reply button
    default: return undefined; // locations, stickers ...: not understood yet (Deferred.md). A voice note and a picture are not text, but they are answered: see parseWhatsAppWebhook
  }
}

/** The id of the button or list row the customer tapped, and which kind it was. The id is one we made (language/interactive.ts); anything that is not a short plain id is dropped, and the title is read as words. */
function replyOf(message: Record<string, unknown>): InboundMessage["reply"] {
  if (message.type !== "interactive" || !isObject(message.interactive)) return undefined;
  const i = message.interactive;
  const kind = isObject(i.button_reply) ? "button" : isObject(i.list_reply) ? "list" : undefined;
  const id = str(isObject(i.button_reply) ? i.button_reply.id : isObject(i.list_reply) ? i.list_reply.id : undefined);
  return kind && id && /^[A-Za-z0-9:_.-]{1,200}$/u.test(id) ? { id, kind } : undefined;
}

/**
 * The customer messages in a WhatsApp webhook. Delivery statuses (sent, delivered, read, failed) are ignored for now (Deferred.md).
 * Messages with no id, no sender number or no words are left out. The timestamp is epoch seconds as a string; ours is milliseconds.
 *
 * A voice note or an audio file (`type: "audio"`; Meta marks a recorded voice note with `audio.voice: true`) has no words, but the person
 * is waiting, so it becomes a message with empty text and `voiceNote: true`. Nothing else of it is read: the media id and the file type in
 * the `audio` object are left behind on purpose, so the audio can never reach the agent, the saved events or the record.
 *
 * A picture (`type: "image"`, a screenshot of a payment, say) is the same: empty text and `image: true`, and nothing of the picture or its caption is kept. The agent
 * decides what to say (a screenshot is never proof of a payment: with UPI the owner confirms). Before UPI (B33) pictures were left out here.
 */
export function parseWhatsAppWebhook(body: unknown): InboundMessage[] {
  if (!isObject(body)) return [];
  const out: InboundMessage[] = [];
  for (const entry of asArray(body.entry).filter(isObject)) {
    for (const change of asArray(entry.changes).filter(isObject)) {
      if (change.field !== "messages" || !isObject(change.value)) continue;
      for (const m of asArray(change.value.messages).filter(isObject)) {
        const id = str(m.id);
        const from = toE164(m.from);
        const voiceNote = m.type === "audio";
        const image = m.type === "image";
        const text = voiceNote || image ? "" : textOf(m);
        if (!id || !from || text === undefined || (text.length === 0 && !voiceNote && !image)) continue;
        const seconds = Number(str(m.timestamp) ?? m.timestamp);
        const reply = replyOf(m);
        out.push({ id, from, text, timestamp: Number.isFinite(seconds) ? seconds * 1000 : 0, ...(voiceNote ? { voiceNote: true as const } : {}), ...(image ? { image: true as const } : {}), ...(reply ? { reply } : {}) });
      }
    }
  }
  return out;
}
