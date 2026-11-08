// Payments over Razorpay's wire format (Payment Links API v1, Payments, Refunds), mapped to the Payments interface.
// No key, no Authorization header: the base URL is a Guard instance in front of https://api.razorpay.com (or a stand-in).
// Paths therefore start at /v1/...
//
// Wire facts this file rests on (Razorpay's own docs; read 3 Nov 2026):
//  - create:  POST /v1/payment_links, amount in paise, reference_id up to 40 characters and unique.
//             https://razorpay.com/docs/api/payments/payment-links/create-standard/
//  - fetch:   GET  /v1/payment_links/{id}; its `payments` items are { payment_id, amount, method, status: "captured", created_at },
//             not our Payment shape, and carry no amount_refunded.
//             https://razorpay.com/docs/api/payments/payment-links/fetch-id-standard/
//  - list:    GET  /v1/payment_links?reference_id=&payment_id=  ->  { payment_links: [...] }. The docs' examples show `payments: []`
//             even on paid links, so the agent never reads payments from a list.
//             https://razorpay.com/docs/api/payments/payment-links/fetch-all-standard/
//  - cancel:  POST /v1/payment_links/{id}/cancel (only a link in state "created").
//             https://razorpay.com/docs/api/payments/payment-links/cancel-standard/
//  - payment: GET  /v1/payments/{id}  (amount_refunded lives here).  https://razorpay.com/docs/api/payments/fetch-with-id/
//  - refund:  POST /v1/payments/{id}/refund { amount, receipt }; receipt is an idempotency key.
//             https://razorpay.com/docs/api/refunds/create-normal/
//  - refunds: GET  /v1/payments/{id}/refunds?count=100 -> { entity: "collection", count, items: [...] }.
//             https://razorpay.com/docs/api/refunds/fetch-multiple-refund-payment/
//  - a missing id is HTTP 400 "The id provided does not exist", not 404.
//  - errors: { error: { code, description, source, step, reason, metadata } }.
import { ApiError, GuardError } from "../core/faults.ts";
import type { NewPaymentLink, Payment, PaymentLink, Payments, Refund } from "./payments.ts";
import { asArray, createHttp, isObject, num, str } from "../core/http.ts";
import type { Http, HttpReply, Json } from "../core/http.ts";

export interface RazorpayConfig { baseUrl: string; timeoutMs?: number; /** Guard's credential for this agent (never a Razorpay key). Left out, no Authorization header is sent. */ agentToken?: string }

// ---- wire -> our types (pure, exported so the tests can read them against the docs' own samples) -----------------------------

/** Razorpay's words for what went wrong, or a plain sentence when the body is not theirs. */
export function describeError(reply: HttpReply): string {
  const b = reply.body;
  const d = isObject(b) && isObject(b.error) ? str(b.error.description) : undefined;
  return d ?? `Razorpay answered ${reply.status}.`;
}

const isMissing = (reply: HttpReply) => (reply.status === 400 || reply.status === 404) && /does not exist/iu.test(describeError(reply));

function expectOk(reply: HttpReply): Json {
  if (reply.status < 200 || reply.status >= 300) throw new ApiError(reply.status, describeError(reply));
  if (!isObject(reply.body)) throw new ApiError(502, "Razorpay answered with something that is not a record.");
  return reply.body;
}

function needNum(v: unknown, what: string): number {
  const n = num(v);
  if (n === undefined) throw new ApiError(502, `Razorpay's record has no ${what}.`);
  return n;
}
function needStr(v: unknown, what: string): string {
  const s = str(v);
  if (s === undefined) throw new ApiError(502, `Razorpay's record has no ${what}.`);
  return s;
}
function needInr(v: unknown): "INR" {
  if (v !== "INR") throw new ApiError(502, `Razorpay's record is in ${String(v)}, and only INR is handled.`);
  return "INR";
}

/**
 * A payment as Razorpay's payments record holds it. A refunded payment keeps `captured: true` (its status turns "refunded"), so it
 * still counts as captured here; a payment that was only authorised, or failed, is not a deposit and is not returned.
 */
export function toPayment(raw: Json, linkId: string): Payment | null {
  const captured = raw.captured === true || raw.status === "captured" || raw.status === "refunded";
  if (!captured) return null;
  return {
    id: needStr(raw.id, "payment id"), link_id: linkId, amount: needNum(raw.amount, "payment amount"), currency: needInr(raw.currency),
    status: "captured", amount_refunded: num(raw.amount_refunded) ?? 0, created_at: needNum(raw.created_at, "payment time"),
  };
}

/** The `payments` items inside a payment link are thinner than a payment: no refunds on them. */
function embeddedPayment(raw: Json, linkId: string): Payment | null {
  if (raw.status !== undefined && raw.status !== "captured") return null;
  return {
    id: needStr(raw.payment_id, "payment id"), link_id: linkId, amount: needNum(raw.amount, "payment amount"), currency: "INR",
    status: "captured", amount_refunded: 0, created_at: num(raw.created_at) ?? 0,
  };
}

/** Razorpay's link statuses: created, partially_paid, expired, cancelled, paid. An expired link can no longer be paid, so it reads as cancelled. */
function linkStatus(raw: unknown): PaymentLink["status"] {
  switch (raw) {
    case "created": return "created";
    case "partially_paid": return "partially_paid";
    case "paid": return "paid";
    case "cancelled": case "expired": return "cancelled";
    default: throw new ApiError(502, `Razorpay's record has a link status this code does not know: ${String(raw)}.`);
  }
}

export function toPaymentLink(raw: Json, payments: Payment[]): PaymentLink {
  return {
    id: needStr(raw.id, "link id"), reference_id: str(raw.reference_id) ?? "", amount: needNum(raw.amount, "link amount"), currency: needInr(raw.currency),
    description: str(raw.description) ?? "", status: linkStatus(raw.status), short_url: needStr(raw.short_url, "short_url"),
    amount_paid: num(raw.amount_paid) ?? 0, payments, created_at: needNum(raw.created_at, "link time"),
    ...(raw.accept_partial === true ? { accept_partial: true, first_min_partial_amount: num(raw.first_min_partial_amount) ?? 0 } : {}),
  };
}

/** A refund; null for one that failed (Razorpay lists failed refunds too, but no money moved). */
export function toRefund(raw: Json): Refund | null {
  if (raw.status === "failed") return null;
  return {
    id: needStr(raw.id, "refund id"), payment_id: needStr(raw.payment_id, "refund payment id"), amount: needNum(raw.amount, "refund amount"),
    status: raw.status === "pending" ? "pending" : "processed", receipt: str(raw.receipt), created_at: needNum(raw.created_at, "refund time"),
  };
}

// ---- the adapter ------------------------------------------------------------------------------------------------------------

export function createRazorpayPayments(config: RazorpayConfig): Payments {
  const http: Http = createHttp(config.baseUrl, "Razorpay", config.timeoutMs, config.agentToken);

  /** A link's payments come from the payments record, so their refunds are known. A payment that cannot be read keeps what the link says. */
  async function paymentsOf(link: Json): Promise<Payment[]> {
    const out: Payment[] = [];
    for (const item of asArray(link.payments)) {
      if (!isObject(item)) continue;
      const thin = embeddedPayment(item, String(link.id));
      if (!thin) continue;
      // A payment that cannot be read keeps what the link says. A Guard that refuses or cannot answer is not "cannot be read": that is raised.
      const full = await fetchPaymentRecord(thin.id).catch((e) => { if (e instanceof GuardError) throw e; return null; });
      out.push(full ? { ...full, link_id: thin.link_id } : thin);
    }
    return out;
  }

  /** A payment record does not name the link it paid (link_id is ""); null when Razorpay has no such payment or it never captured. */
  async function fetchPaymentRecord(id: string): Promise<Payment | null> {
    const reply = await http.request("GET", `/v1/payments/${encodeURIComponent(id)}`);
    if (isMissing(reply)) return null;
    return toPayment(expectOk(reply), "");
  }

  const refundPath = (paymentId: string) => `/v1/payments/${encodeURIComponent(paymentId)}/refund`;
  function refundReply(reply: HttpReply): Refund {
    if (isMissing(reply)) throw new ApiError(404, "No such payment.");
    const refund = toRefund(expectOk(reply));
    if (!refund) throw new ApiError(502, "Razorpay accepted the refund but reports it as failed.");
    return reply.replayed ? { ...refund, replayed: true } : refund;
  }

  return {
    async createPaymentLink(request: NewPaymentLink) {
      const reply = await http.request("POST", "/v1/payment_links", {
        body: { amount: request.amount, currency: "INR", reference_id: request.reference_id, description: request.description, accept_partial: request.accept_partial === true, ...(request.accept_partial ? { first_min_partial_amount: request.first_min_partial_amount ?? 100 } : {}), notify: { sms: false, email: false }, reminder_enable: false },
      });
      // A reference_id used before answers 400 "payment link creation with reference ID already attempted": an ApiError, and the agent looks the link up before it tries again.
      const raw = expectOk(reply);
      return toPaymentLink(raw, []);
    },

    async fetchPaymentLink(id) {
      const reply = await http.request("GET", `/v1/payment_links/${encodeURIComponent(id)}`);
      if (isMissing(reply)) return null;
      const raw = expectOk(reply);
      return toPaymentLink(raw, await paymentsOf(raw));
    },

    async listPaymentLinks(query = {}) {
      const reply = await http.request("GET", "/v1/payment_links", { query: { reference_id: query.reference_id, payment_id: query.payment_id } });
      const raw = expectOk(reply);
      // Payments inside a list are as thin as the docs show them (often empty): they are passed on without refund figures. fetchPaymentLink has the full record.
      return asArray(raw.payment_links).filter(isObject).map((l) => toPaymentLink(l, asArray(l.payments).filter(isObject).map((p) => embeddedPayment(p, String(l.id))).filter((p): p is Payment => p !== null)));
    },

    async cancelPaymentLink(id) {
      const reply = await http.request("POST", `/v1/payment_links/${encodeURIComponent(id)}/cancel`);
      if (isMissing(reply)) throw new ApiError(404, "No such payment link.");
      const raw = expectOk(reply);
      return toPaymentLink(raw, await paymentsOf(raw));
    },

    fetchPayment: fetchPaymentRecord,

    async refund(paymentId, request) {
      // B37: who asked for it, for Guard alone (it strips the header and keeps it out of the call's digest). The body is the same bytes either way.
      const asked = request.requestedBy && request.requestedBy.length > 0 ? { headers: { "Geo-Requested-By": request.requestedBy.join(",") } } : {};
      return refundReply(await http.request("POST", refundPath(paymentId), { body: { amount: request.amount, receipt: request.receipt }, ...asked }));
    },

    /** The bytes of a call Guard held, sent again exactly as they were: Guard releases a call only if it is the same call. */
    async resendRefund(paymentId, body, requestedBy) {
      return refundReply(await http.request("POST", refundPath(paymentId), { rawBody: body, ...(requestedBy && requestedBy.length > 0 ? { headers: { "Geo-Requested-By": requestedBy.join(",") } } : {}) }));
    },

    async listRefunds(paymentId) {
      const reply = await http.request("GET", `/v1/payments/${encodeURIComponent(paymentId)}/refunds`, { query: { count: 100 } });
      if (isMissing(reply)) return [];
      const raw = expectOk(reply);
      return asArray(raw.items).filter(isObject).map(toRefund).filter((r): r is Refund => r !== null);
    },
  };
}
