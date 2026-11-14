// Razorpay's wire format in front of createFakePayments(): the stand-in every crash test of a Razorpay shop runs against. The paths and bodies are the ones the
// live adapter speaks (see api.ts beside this file for the docs they come from), and the webhook bodies are the ones Razorpay sends.
//
// Where this stand-in is deliberately as awkward as the real thing, so the agent is tested against that:
//  - the payment link list shows `payments: []` even on a paid link (the docs' own examples do), the single fetch has the payments;
//  - a payment in a link carries `payment_id`, not `id`, and no refund figures (those are on the payment);
//  - a missing id is HTTP 400 "The id provided does not exist", not 404;
//  - a second link with the same reference_id is 400 "payment link creation with reference ID already attempted".
//
// The settlement recon (GET /v1/settlements/recon/combined) is served for the fake's own payments and refunds so the books have something real-shaped to read. It is
// written from Razorpay's documents and is NOT a copy of a real account's answer (none was available): a payment settles two days after it was taken (a calendar day
// in India, not working days), at a fee of 2% with 18% GST on the fee, in whole paise rounded as integers; a refund is a debit row of its own amount the same way. The
// documents do not say whether the recon `fee` includes its `tax`, so the stand-in can serve either (`feeIncludesTax`), and it can hold a row (`hold`), which Razorpay
// does when it sees risk. Pages are count and skip, 10 a page when no count is given.
import { ApiError, TimeoutError } from "../../../core/faults.ts";
import { localParts } from "../../../core/time.ts";
import type { FakePayments, Payment, PaymentEvent, PaymentRequest, Refund } from "../../payments.ts";
import { RAZORPAY_EVENT } from "./webhook.ts";
import { LostReply, ok } from "../../../standins/http.ts";
import type { Handler, StandinReply } from "../../../standins/http.ts";

const error = (status: number, description: string): StandinReply => ({
  status, body: { error: { code: "BAD_REQUEST_ERROR", description, source: "NA", step: "NA", reason: "NA", metadata: {} } },
});
const notFound = () => error(400, "The id provided does not exist");

/** The fake's complaint in Razorpay's words. A cut reply is not an answer at all. */
function fromError(e: unknown): StandinReply {
  if (e instanceof TimeoutError) throw new LostReply();
  if (e instanceof ApiError) {
    if (e.status === 404) return notFound();
    if (/already exists/u.test(e.message)) return error(400, "payment link creation with reference ID already attempted");
    if (e.status === 401) return error(401, "Authentication failed");
    return error(e.status, e.message);
  }
  throw e;
}

/** A payment as Razorpay's payments record shows it. */
export function wirePayment(p: Payment): Record<string, unknown> {
  const refunded = p.amount_refunded;
  return {
    id: p.id, entity: "payment", amount: p.amount, currency: p.currency, status: refunded >= p.amount ? "refunded" : "captured", order_id: `order_${p.request_id}`,
    invoice_id: null, international: false, method: "upi", amount_refunded: refunded, refund_status: refunded === 0 ? null : refunded >= p.amount ? "full" : "partial",
    captured: true, description: null, email: null, contact: "+919800000000", notes: [], error_code: null, created_at: p.created_at,
  };
}

/** A payment link. `payments` is what the single fetch shows; a list and a create show less (see the top of this file). */
export function wireLink(l: PaymentRequest, payments: "full" | "empty" | "null"): Record<string, unknown> {
  return {
    accept_partial: l.part_payments === true, amount: l.amount, amount_paid: l.amount_paid, cancelled_at: l.status === "cancelled" ? l.created_at : 0, created_at: l.created_at, currency: l.currency,
    customer: [], description: l.description, expire_by: 0, expired_at: 0, first_min_partial_amount: l.min_first_payment ?? 0, id: l.id, notes: null, notify: { email: false, sms: false },
    order_id: `order_${l.id}`,
    payments: payments === "null" ? null : payments === "empty" ? [] : l.payments.map((p) => ({ amount: p.amount, created_at: p.created_at, method: "upi", payment_id: p.id, plink_id: l.id, status: "captured" })),
    reference_id: l.reference_id, reminder_enable: false, reminders: [], short_url: l.pay_url, status: l.status, updated_at: l.created_at, upi_link: false, user_id: "",
  };
}

// Shaped like Razorpay's refund object so the live adapter's parser is exercised by the same bytes it would get in production.
export function wireRefund(r: Refund): Record<string, unknown> {
  return { id: r.id, entity: "refund", amount: r.amount, currency: "INR", payment_id: r.payment_id, notes: {}, receipt: r.receipt ?? null, acquirer_data: { arn: null }, created_at: r.created_at, batch_id: null, status: r.status, speed_processed: "normal" };
}

export interface StandinOptions {
  /** Serve `fee` with the GST in it (credit = amount - fee), not without (credit = amount - fee - tax). Default: without. */
  feeIncludesTax?: boolean;
  /** Payment or refund ids whose row Razorpay holds: `on_hold` true, not settled, no UTR. */
  hold?: ReadonlySet<string>;
}

const SETTLES_AFTER_DAYS = 2;
const FEE_PERCENT = 2;
const GST_PERCENT = 18;
const DAY_MS = 86_400_000;
const IST = "Asia/Kolkata";

/** The recon rows of the fake's payments and refunds, each with the India day it settles on (a UTC-midnight stamp of that day, for comparing days). */
function reconRows(payments: FakePayments, o: StandinOptions): { dayMs: number; at: number; row: Record<string, unknown> }[] {
  const out: { dayMs: number; at: number; row: Record<string, unknown> }[] = [];
  const settlesOn = (createdAt: number): { dayMs: number; yyyymmdd: string; at: number } => {
    const p = localParts(createdAt * 1000, IST);
    const dayMs = Date.UTC(p.year, p.month - 1, p.day) + SETTLES_AFTER_DAYS * DAY_MS;
    const d = new Date(dayMs);
    return { dayMs, yyyymmdd: `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`, at: Math.floor(dayMs / 1000) };
  };
  const common = (s: ReturnType<typeof settlesOn>, id: string) => {
    const held = o.hold?.has(id) === true;
    return { currency: "INR", on_hold: held, settled: !held, settlement_id: `setl_${s.yyyymmdd}`, settlement_utr: held ? null : `UTR${s.yyyymmdd}`, settled_at: held ? null : s.at, notes: [], description: null, order_id: null, method: "upi" };
  };
  for (const p of payments.links().flatMap((l) => l.payments)) {
    const s = settlesOn(p.created_at);
    const fee = Math.round((p.amount * FEE_PERCENT) / 100);
    const tax = Math.round((fee * GST_PERCENT) / 100);
    const feeShown = o.feeIncludesTax ? fee + tax : fee;
    out.push({ dayMs: s.dayMs, at: p.created_at, row: { entity_id: p.id, type: "payment", debit: 0, credit: p.amount - fee - tax, amount: p.amount, fee: feeShown, tax, created_at: p.created_at, payment_id: null, ...common(s, p.id) } });
  }
  for (const r of payments.refunds()) {
    if (r.status !== "processed") continue;
    const s = settlesOn(r.created_at);
    out.push({ dayMs: s.dayMs, at: r.created_at, row: { entity_id: r.id, type: "refund", debit: r.amount, credit: 0, amount: r.amount, fee: 0, tax: 0, created_at: r.created_at, payment_id: r.payment_id, ...common(s, r.id) } });
  }
  return out.sort((a, b) => a.at - b.at || String(a.row.entity_id).localeCompare(String(b.row.entity_id)));
}

// Translates Razorpay paths into calls on the fake payments, so crash tests run the real adapter against a fake that can fail on demand.
export function razorpayStandin(payments: FakePayments, options: StandinOptions = {}): Handler {
  return async ({ method, path, query, body }) => {
    if (path === "/v1/settlements/recon/combined" && method === "GET") {
      const year = Number(query.get("year"));
      const month = Number(query.get("month"));
      const dayText = query.get("day");
      const day = dayText === null ? undefined : Number(dayText);
      if (!Number.isInteger(year) || !Number.isInteger(month) || (day !== undefined && !Number.isInteger(day))) return error(400, "year and month are required, as whole numbers");
      const count = Number(query.get("count") ?? 10);
      const skip = Number(query.get("skip") ?? 0);
      if (!Number.isInteger(count) || count < 1 || count > 1000 || !Number.isInteger(skip) || skip < 0) return error(400, "count must be 1 to 1000 and skip 0 or more");
      const all = reconRows(payments, options).filter((r) => { const d = new Date(r.dayMs); return d.getUTCFullYear() === year && d.getUTCMonth() + 1 === month && (day === undefined || d.getUTCDate() === day); });
      const items = all.slice(skip, skip + count).map((r) => r.row);
      return ok({ entity: "collection", count: items.length, items });
    }
    if (!path.startsWith("/v1/payment_links") && !path.startsWith("/v1/payments/")) return undefined;
    try {
      if (path === "/v1/payment_links" && method === "POST") {
        const link = await payments.createRequest({ amount: body?.amount, reference_id: body?.reference_id, description: body?.description ?? "", ...(body?.accept_partial === true ? { part_payments: true, min_first_payment: body?.first_min_partial_amount } : {}) });
        return ok(wireLink(link, "null"));
      }
      if (path === "/v1/payment_links" && method === "GET") {
        const links = await payments.listRequests({ reference_id: query.get("reference_id") ?? undefined, payment_id: query.get("payment_id") ?? undefined });
        return ok({ payment_links: links.map((l) => wireLink(l, "empty")) });
      }
      let m = /^\/v1\/payment_links\/([^/]+)$/u.exec(path);
      if (m && method === "GET") {
        const link = await payments.fetchRequest(decodeURIComponent(m[1]));
        return link ? ok(wireLink(link, "full")) : notFound();
      }
      m = /^\/v1\/payment_links\/([^/]+)\/cancel$/u.exec(path);
      if (m && method === "POST") {
        const link = await payments.cancelRequest(decodeURIComponent(m[1]));
        return link.status === "cancelled" ? ok(wireLink(link, "full")) : error(400, "Cannot cancel or expire an already paid/partially paid link");
      }
      m = /^\/v1\/payments\/([^/]+)$/u.exec(path);
      if (m && method === "GET") {
        const payment = await payments.fetchPayment(decodeURIComponent(m[1]));
        return payment ? ok(wirePayment(payment)) : notFound();
      }
      m = /^\/v1\/payments\/([^/]+)\/refund$/u.exec(path);
      if (m && method === "POST") {
        if (typeof body?.amount !== "number") return error(400, "This stand-in refunds a stated amount only.");
        return ok(wireRefund(await payments.refund(decodeURIComponent(m[1]), { amount: body.amount, receipt: body.receipt ?? undefined })));
      }
      m = /^\/v1\/payments\/([^/]+)\/refunds$/u.exec(path);
      if (m && method === "GET") {
        const items = (await payments.listRefunds(decodeURIComponent(m[1]))).map(wireRefund);
        return ok({ entity: "collection", count: items.length, items });
      }
      return undefined;
    } catch (e) {
      return fromError(e);
    }
  };
}

/** A Razorpay webhook body for an event the fake emitted. `payment.captured` names the payment and its order but not its link, as the real one does. */
export function razorpayWebhookBody(event: PaymentEvent, payments: FakePayments): string {
  const links = payments.links();
  const payment = (id: string | undefined) => links.flatMap((l) => l.payments).find((p) => p.id === id);
  const head = { account_id: "acc_standin", created_at: event.created_at, entity: "event", event: RAZORPAY_EVENT[event.event] };
  let contains: string[];
  let payload: Record<string, unknown>;
  if (event.event === "request.paid") {
    const link = links.find((l) => l.id === event.payload.request?.id)!;
    contains = ["payment_link", "payment"];
    payload = { payment_link: { entity: wireLink(link, "full") }, payment: { entity: wirePayment(payment(event.payload.payment?.id)!) } };
  } else if (event.event === "payment.received") {
    contains = ["payment"];
    payload = { payment: { entity: wirePayment(payment(event.payload.payment?.id)!) } };
  } else {
    const refund = payments.refunds().find((r) => r.id === event.payload.refund?.id)!;
    contains = ["refund", "payment"];
    payload = { refund: { entity: wireRefund(refund) }, payment: { entity: wirePayment(payment(refund.payment_id)!) } };
  }
  return JSON.stringify({ ...head, contains, payload });
}
