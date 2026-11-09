// Razorpay's webhooks: checking that Razorpay sent one, and reading it into the neutral events (payments.ts). Pure functions; the inbox uses them through the
// provider's declaration, and the stand-in uses the signing half to send what Razorpay sends. The agent runtime never imports this: it never holds a webhook secret.
//
// Wire facts (read 3 Nov 2026):
//  - Razorpay signs the RAW body: header X-Razorpay-Signature is the hex HMAC-SHA256 of the body with the webhook secret. The event id is the
//    header x-razorpay-event-id (unique per event; the same event can arrive more than once). It is not in the body.
//    https://razorpay.com/docs/webhooks/validate-test/
//  - Payload examples: https://razorpay.com/docs/webhooks/payloads/payment-links/ , /payments/ , /refunds/
//  - Razorpay wants an answer within 5 seconds and retries for 24 hours: https://razorpay.com/docs/webhooks/best-practices.md
import { createHash } from "node:crypto";
import { hmacHex, sameHex } from "../../../messaging/webhooks.ts";
import type { PaymentEvent } from "../../payments.ts";
import { isObject, num, str } from "../../../core/http.ts";

export const SIGNATURE_HEADER = "x-razorpay-signature";
export const EVENT_ID_HEADER = "x-razorpay-event-id";

/** The signature Razorpay would send for this body: what the stand-in sends. */
export const signRazorpay = (rawBody: Buffer, secret: string): string => hmacHex(rawBody, secret);

/** Is this body what Razorpay sent? An empty secret never verifies anything. */
export function verifyRazorpaySignature(rawBody: Buffer, header: string | undefined, secret: string): boolean {
  if (secret.length === 0) return false;
  return sameHex(hmacHex(rawBody, secret), header);
}

/** The neutral events under Razorpay's own names, both ways: the reader below maps in, the stand-in maps out. */
export const RAZORPAY_EVENT = { "request.paid": "payment_link.paid", "payment.received": "payment.captured", "refund.done": "refund.processed" } as const;

/**
 * Read a Razorpay webhook into a PaymentEvent, or null for any event the agent does not use (payment_link.expired, payment.failed ...).
 * `eventId` is the x-razorpay-event-id header. Without it the id is a digest of the body, which a retry repeats exactly.
 *
 * Razorpay's event names become the neutral ones (payments.ts): payment_link.paid is request.paid, payment.captured is payment.received, refund.processed is refund.done.
 * A real `payment.captured` names the payment and its order, NOT its payment link, so `payment.request_id` is left out for it;
 * the agent asks the payments service which request the payment paid.
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
    return { id, event: "request.paid", created_at, payload: { request: { id: linkId, reference_id: str(link?.reference_id) ?? "" }, ...(paymentId ? { payment: { id: paymentId, request_id: linkId } } : {}) } };
  }
  if (event === "payment.captured") {
    const paymentId = str(entityOf("payment")?.id);
    return paymentId ? { id, event: "payment.received", created_at, payload: { payment: { id: paymentId } } } : null;
  }
  if (event === "refund.processed") {
    const refund = entityOf("refund");
    const refundId = str(refund?.id);
    const paymentId = str(refund?.payment_id);
    return refundId && paymentId ? { id, event: "refund.done", created_at, payload: { refund: { id: refundId, payment_id: paymentId } } } : null;
  }
  return null;
}
