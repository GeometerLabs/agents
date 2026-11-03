// Webhooks: checking who sent them, and reading them into the events the agent understands. Pure functions; the inbox (inbox/) uses them,
// and the stand-ins use the signing half to send what the providers send. The agent runtime never imports this: it never holds a webhook secret.
//
// Wire facts (read 3 Nov 2026):
//  - Razorpay signs the RAW body: header X-Razorpay-Signature is the hex HMAC-SHA256 of the body with the webhook secret. The event id is the
//    header x-razorpay-event-id (unique per event; the same event can arrive more than once). It is not in the body.
//    https://razorpay.com/docs/webhooks/validate-test/
//  - Meta signs the raw body too: header X-Hub-Signature-256 is "sha256=" and the hex HMAC-SHA256 of the payload with the App Secret.
//    https://developers.facebook.com/docs/graph-api/webhooks/getting-started
//  - Razorpay payload examples: https://razorpay.com/docs/webhooks/payloads/payment-links/ , /payments/ , /refunds/
//  - WhatsApp payload examples: https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages.md
//    (text.md, interactive.md, button.md, status.md next to it)
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { InboundMessage } from "../messaging.ts";
import type { PaymentEvent } from "../payments.ts";
import { asArray, isObject, num, str } from "./http.ts";

// ---- signatures --------------------------------------------------------------------------------------------------------------

const hmacHex = (rawBody: Buffer, secret: string) => createHmac("sha256", secret).update(rawBody).digest("hex");

/** Compare two hex strings in constant time. A missing, short, long or non-hex value is simply false. */
function sameHex(expected: string, given: string | undefined): boolean {
  if (typeof given !== "string" || given.length !== expected.length || !/^[0-9a-f]+$/iu.test(given)) return false;
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(given, "hex"));
}

/** The signature Razorpay would send for this body: what the stand-in sends. */
export const signRazorpay = (rawBody: Buffer, secret: string): string => hmacHex(rawBody, secret);

/** Is this body what Razorpay sent? An empty secret never verifies anything. */
export function verifyRazorpaySignature(rawBody: Buffer, header: string | undefined, secret: string): boolean {
  if (secret.length === 0) return false;
  return sameHex(hmacHex(rawBody, secret), header);
}

/** The X-Hub-Signature-256 value Meta would send for this body: what the stand-in sends. */
export const signMeta = (rawBody: Buffer, appSecret: string): string => `sha256=${hmacHex(rawBody, appSecret)}`;

/** Is this body what Meta sent? The header must be "sha256=" and the hex digest. */
export function verifyMetaSignature(rawBody: Buffer, header: string | undefined, appSecret: string): boolean {
  if (appSecret.length === 0 || typeof header !== "string" || !header.startsWith("sha256=")) return false;
  return sameHex(hmacHex(rawBody, appSecret), header.slice("sha256=".length));
}

// ---- Razorpay events ---------------------------------------------------------------------------------------------------------

/**
 * Read a Razorpay webhook into a PaymentEvent, or null for any event the agent does not use (payment_link.expired, payment.failed ...).
 * `eventId` is the x-razorpay-event-id header. Without it the id is a digest of the body, which a retry repeats exactly.
 *
 * A real `payment.captured` names the payment and its order, NOT its payment link, so `payment.link_id` is left out for it;
 * the agent asks the payments service which link the payment paid.
 */
export function parseRazorpayEvent(body: unknown, eventId?: string): PaymentEvent | null {
  if (!isObject(body) || !isObject(body.payload)) return null;
  const event = body.event;
  const entityOf = (name: string) => (isObject(body.payload) && isObject(body.payload[name]) && isObject(body.payload[name].entity) ? body.payload[name].entity as Record<string, unknown> : undefined);
  const id = eventId && eventId.length > 0 ? eventId : `evt_${createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 32)}`;
  const created_at = num(body.created_at) ?? 0;

  if (event === "payment_link.paid") {
    const link = entityOf("payment_link");
    const payment = entityOf("payment");
    const linkId = str(link?.id);
    if (!linkId) return null;
    const paymentId = str(payment?.id);
    return { id, event, created_at, payload: { payment_link: { id: linkId, reference_id: str(link?.reference_id) ?? "" }, ...(paymentId ? { payment: { id: paymentId, link_id: linkId } } : {}) } };
  }
  if (event === "payment.captured") {
    const paymentId = str(entityOf("payment")?.id);
    return paymentId ? { id, event, created_at, payload: { payment: { id: paymentId } } } : null;
  }
  if (event === "refund.processed") {
    const refund = entityOf("refund");
    const refundId = str(refund?.id);
    const paymentId = str(refund?.payment_id);
    return refundId && paymentId ? { id, event, created_at, payload: { refund: { id: refundId, payment_id: paymentId } } } : null;
  }
  return null;
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
    default: return undefined; // images, voice notes, locations ...: not understood yet (Deferred.md)
  }
}

/**
 * The customer messages in a WhatsApp webhook. Delivery statuses (sent, delivered, read, failed) are ignored for now (Deferred.md).
 * Messages with no id, no sender number or no words are left out. The timestamp is epoch seconds as a string; ours is milliseconds.
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
        const text = textOf(m);
        if (!id || !from || text === undefined || text.length === 0) continue;
        const seconds = Number(str(m.timestamp) ?? m.timestamp);
        out.push({ id, from, text, timestamp: Number.isFinite(seconds) ? seconds * 1000 : 0 });
      }
    }
  }
  return out;
}
