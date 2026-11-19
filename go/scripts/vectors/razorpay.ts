// Vector cases for go/internal/payments/razorpay: the live Razorpay client (modules/payments/providers/razorpay/api.ts) run through a Guard stand-in that answers from a script, and
// the webhook reader (webhook.ts). Every call's method, request target, headers and body bytes are written down, and every answer the TypeScript reads: a link, a refund, 202 held
// with an approval id, 409 already_done, any other 409, denied_by_approver, outcome_unknown, 429 and limit refusals, 5xx, timeouts.
import { createRazorpayPayments } from "../../../modules/payments/providers/razorpay/api.ts";
import { parseRazorpayEvent, signRazorpay, verifyRazorpaySignature } from "../../../modules/payments/providers/razorpay/webhook.ts";
import { recordCase } from "../lib/record.ts";
import type { Case, Scripted } from "../lib/record.ts";
import { fixture, guardNames, guardReply, ok, status } from "./fixtures.ts";

type Call = { op: string; args: any[] };

/** Run one client call against a script. `config` is what the Go test needs to rebuild the call. */
async function viaClient(name: string, replies: Scripted[], call: Call, opts: { agentToken?: string; baseSuffix?: string; closed?: boolean; timeoutMs?: number } = {}): Promise<Case> {
  return recordCase(name, replies, async (baseUrl) => {
    const client: any = createRazorpayPayments({ baseUrl, timeoutMs: opts.timeoutMs, ...(opts.agentToken ? { agentToken: opts.agentToken } : {}) });
    const r = await client[call.op](...call.args);
    return r === undefined ? null : r;
  }, { baseSuffix: opts.baseSuffix, closed: opts.closed, config: { call, agentToken: opts.agentToken ?? "", baseSuffix: opts.baseSuffix ?? "", closed: opts.closed ?? false, timeoutMs: opts.timeoutMs ?? 0 } });
}

const notExist = () => status(400, fixture("razorpay-error-not-exist.json"));
const linkCreate = () => ok(fixture("razorpay-payment-link-create.json"));
const linkFetch = () => ok(fixture("razorpay-payment-link-fetch.json"));
const payment = () => ok(fixture("razorpay-payment.json"));
const refundCreate = () => ok(fixture("razorpay-refund-create.json"));

export async function cases(): Promise<Case[]> {
  const out: Case[] = [];
  const add = async (...a: Parameters<typeof viaClient>) => { out.push(await viaClient(...a)); };
  const tok = { agentToken: "agent-token-1" };

  // ---- createRequest
  await add("createRequest: a link, with the agent token", [linkCreate()], { op: "createRequest", args: [{ amount: 60000, reference_id: "b-3", description: "Deposit for Haircut on Sat 21 Nov, 11:00" }] }, tok);
  await add("createRequest: no token sends no Authorization", [linkCreate()], { op: "createRequest", args: [{ amount: 60000, reference_id: "b-3", description: "Deposit" }] });
  await add("createRequest: awkward description bytes", [linkCreate()], { op: "createRequest", args: [{ amount: 100, reference_id: "b-4", description: "Cut & colour <deposit> é 日本   \"q\" \\ \t" }] });
  await add("createRequest: part payments with a minimum", [linkFetch()], { op: "createRequest", args: [{ amount: 100000, reference_id: "b-5", description: "Deposit", part_payments: true, min_first_payment: 25000 }] });
  await add("createRequest: part payments, default minimum 100", [linkFetch()], { op: "createRequest", args: [{ amount: 100000, reference_id: "b-5", description: "Deposit", part_payments: true }] });
  await add("createRequest: a reference already used is an ApiError", [status(400, { error: { code: "BAD_REQUEST_ERROR", description: "Payment link creation with reference ID already attempted" } })], { op: "createRequest", args: [{ amount: 100, reference_id: "b-1", description: "d" }] });
  await add("createRequest: an error body that is not Razorpay's", [status(500, { oops: true })], { op: "createRequest", args: [{ amount: 100, reference_id: "b-1", description: "d" }] });
  await add("createRequest: a body that is not a record", [{ status: 200, text: "[1]" }], { op: "createRequest", args: [{ amount: 100, reference_id: "b-1", description: "d" }] });
  await add("createRequest: a record with no short_url", [ok({ ...fixture("razorpay-payment-link-create.json"), short_url: undefined })], { op: "createRequest", args: [{ amount: 100, reference_id: "b-1", description: "d" }] });
  await add("createRequest: a record in USD", [ok({ ...fixture("razorpay-payment-link-create.json"), currency: "USD" })], { op: "createRequest", args: [{ amount: 100, reference_id: "b-1", description: "d" }] });
  await add("createRequest: no currency at all", [ok({ ...fixture("razorpay-payment-link-create.json"), currency: undefined })], { op: "createRequest", args: [{ amount: 100, reference_id: "b-1", description: "d" }] });
  await add("createRequest: an unknown link status", [ok({ ...fixture("razorpay-payment-link-create.json"), status: "weird" })], { op: "createRequest", args: [{ amount: 100, reference_id: "b-1", description: "d" }] });
  await add("createRequest: an expired link reads as cancelled", [ok({ ...fixture("razorpay-payment-link-create.json"), status: "expired" })], { op: "createRequest", args: [{ amount: 100, reference_id: "b-1", description: "d" }] });
  await add("createRequest: Guard refuses the amount (a rule)", [guardReply("refused_rule")], { op: "createRequest", args: [{ amount: 300000, reference_id: "b-6", description: "d" }] });
  await add("createRequest: Guard says the licence is suspended", [guardReply("suspended")], { op: "createRequest", args: [{ amount: 60000, reference_id: "b-6", description: "d" }] });
  await add("createRequest: Guard is busy", [guardReply("busy")], { op: "createRequest", args: [{ amount: 60000, reference_id: "b-6", description: "d" }] });
  await add("createRequest: no reply is a timeout", [{ hang: true }], { op: "createRequest", args: [{ amount: 60000, reference_id: "b-6", description: "d" }] }, { timeoutMs: 150 });
  await add("createRequest: nothing listens", [], { op: "createRequest", args: [{ amount: 60000, reference_id: "b-6", description: "d" }] }, { closed: true });
  await add("createRequest: a path prefix on the base URL", [linkCreate()], { op: "createRequest", args: [{ amount: 60000, reference_id: "b-3", description: "d" }] }, { baseSuffix: "/razorpay" });

  // ---- fetchRequest
  await add("fetchRequest: a paid link reads each payment's own record", [linkFetch(), payment()], { op: "fetchRequest", args: ["plink_KBnb7I424Rc1R9"] });
  await add("fetchRequest: an id that needs escaping", [linkFetch(), payment()], { op: "fetchRequest", args: ["plink/a b@c:d~e"] });
  await add("fetchRequest: a missing link is null", [notExist()], { op: "fetchRequest", args: ["plink_none"] });
  await add("fetchRequest: a payment that does not exist keeps the link's thin one", [linkFetch(), notExist()], { op: "fetchRequest", args: ["plink_x"] });
  await add("fetchRequest: a payment that cannot be read (500) keeps the thin one", [linkFetch(), guardReply("provider_500")], { op: "fetchRequest", args: ["plink_x"] });
  await add("fetchRequest: a payment that is not captured is dropped from the full record's place", [linkFetch(), ok({ ...fixture("razorpay-payment.json"), captured: false, status: "failed" })], { op: "fetchRequest", args: ["plink_x"] });
  await add("fetchRequest: Guard cannot answer the payment read, which is raised", [linkFetch(), guardReply("busy")], { op: "fetchRequest", args: ["plink_x"] });
  await add("fetchRequest: a payment read that times out keeps the thin one", [linkFetch(), { cut: true }], { op: "fetchRequest", args: ["plink_x"] });
  await add("fetchRequest: a link with an authorised (not captured) payment", [ok({ ...fixture("razorpay-payment-link-fetch.json"), payments: [{ payment_id: "pay_a", amount: 5, status: "authorized" }, { payment_id: "pay_b", amount: 7, created_at: 9 }, "junk"] }), notExist()], { op: "fetchRequest", args: ["plink_x"] });
  await add("fetchRequest: a refunded payment still counts", [linkFetch(), ok({ ...fixture("razorpay-payment.json"), status: "refunded", amount_refunded: 100 })], { op: "fetchRequest", args: ["plink_x"] });
  await add("fetchRequest: Guard refuses with the owner's no", [guardReply("denied_by_approver")], { op: "fetchRequest", args: ["plink_x"] });

  // ---- listRequests
  await add("listRequests: by reference", [ok(fixture("razorpay-payment-links-list.json"))], { op: "listRequests", args: [{ reference_id: "b-3" }] });
  await add("listRequests: by payment", [ok(fixture("razorpay-payment-links-list.json"))], { op: "listRequests", args: [{ payment_id: "pay_1" }] });
  await add("listRequests: by both", [ok(fixture("razorpay-payment-links-list.json"))], { op: "listRequests", args: [{ reference_id: "b-3", payment_id: "pay_1" }] });
  await add("listRequests: none given", [ok({ payment_links: [] })], { op: "listRequests", args: [] });
  await add("listRequests: reference with characters to encode", [ok({ payment_links: [] })], { op: "listRequests", args: [{ reference_id: "b 3&x=é" }] });
  await add("listRequests: a list with thin payments and an odd item", [ok({ payment_links: [{ ...fixture("razorpay-payment-link-create.json"), payments: [{ payment_id: "pay_1", amount: 100, status: "captured", created_at: 5 }, { payment_id: "pay_2", amount: 100, status: "failed" }] }, "junk", 5] })], { op: "listRequests", args: [{ reference_id: "b-3" }] });
  await add("listRequests: payment_links is not a list", [ok({ payment_links: "none" })], { op: "listRequests", args: [{ reference_id: "b-3" }] });
  await add("listRequests: one bad link spoils the list", [ok({ payment_links: [{ id: "plink_1" }] })], { op: "listRequests", args: [{ reference_id: "b-3" }] });
  await add("listRequests: a 500", [status(500, { error: { description: "boom" } })], { op: "listRequests", args: [{ reference_id: "b-3" }] });
  await add("listRequests: 429", [{ status: 429, body: { error: { description: "Too many requests" } } }], { op: "listRequests", args: [{ reference_id: "b-3" }] });
  await add("listRequests: Guard refuses by a limit", [guardReply("refused_limit")], { op: "listRequests", args: [{ reference_id: "b-3" }] });
  await add("listRequests: Guard refuses an unlisted route", [guardReply("refused_unlisted")], { op: "listRequests", args: [{ reference_id: "b-3" }] });

  // ---- cancelRequest
  await add("cancelRequest: a link", [ok({ ...fixture("razorpay-payment-link-create.json"), status: "cancelled" })], { op: "cancelRequest", args: ["plink_KBnb7I424Rc1R9"] });
  await add("cancelRequest: a link with payments", [linkFetch(), payment()], { op: "cancelRequest", args: ["plink_x"] });
  await add("cancelRequest: missing", [notExist()], { op: "cancelRequest", args: ["plink_none"] });
  await add("cancelRequest: a link not in the state created", [status(400, { error: { description: "Payment link cannot be cancelled" } })], { op: "cancelRequest", args: ["plink_x"] });

  // ---- fetchPayment
  await add("fetchPayment: a payment", [payment()], { op: "fetchPayment", args: ["pay_DG4ZdRK8ZnXC3k"] });
  await add("fetchPayment: missing (400 does not exist)", [notExist()], { op: "fetchPayment", args: ["pay_none"] });
  await add("fetchPayment: missing (404 does not exist)", [status(404, fixture("razorpay-error-not-exist.json"))], { op: "fetchPayment", args: ["pay_none"] });
  await add("fetchPayment: authorised only, not a deposit", [ok({ ...fixture("razorpay-payment.json"), captured: false, status: "authorized" })], { op: "fetchPayment", args: ["pay_a"] });
  await add("fetchPayment: in USD", [ok({ ...fixture("razorpay-payment.json"), currency: "USD" })], { op: "fetchPayment", args: ["pay_a"] });
  await add("fetchPayment: a 400 that is not 'does not exist'", [status(400, { error: { description: "Bad thing" } })], { op: "fetchPayment", args: ["pay_a"] });
  await add("fetchPayment: no amount", [ok({ ...fixture("razorpay-payment.json"), amount: undefined })], { op: "fetchPayment", args: ["pay_a"] });
  await add("fetchPayment: no created_at", [ok({ ...fixture("razorpay-payment.json"), created_at: undefined })], { op: "fetchPayment", args: ["pay_a"] });

  // ---- refund: the request, and every answer
  await add("refund: made, with the receipt and the agent token", [refundCreate()], { op: "refund", args: ["pay_29QQoUBi66xm2f", { amount: 60000, receipt: "b-3:pay_29QQoUBi66xm2f" }] }, tok);
  await add("refund: no receipt is left out of the body", [refundCreate()], { op: "refund", args: ["pay_1", { amount: 60000 }] });
  await add("refund: an empty receipt is sent", [refundCreate()], { op: "refund", args: ["pay_1", { amount: 60000, receipt: "" }] });
  await add("refund: who asked goes in Geo-Requested-By", [refundCreate()], { op: "refund", args: ["pay_1", { amount: 60000, receipt: "b-3:pay_1", requestedBy: ["owner", "op:7"] }] });
  await add("refund: an empty requestedBy sends no header", [refundCreate()], { op: "refund", args: ["pay_1", { amount: 60000, receipt: "b-3:pay_1", requestedBy: [] }] });
  await add("refund: pending", [ok({ ...fixture("razorpay-refund-create.json"), status: "pending" })], { op: "refund", args: ["pay_1", { amount: 100, receipt: "r" }] });
  await add("refund: the provider's failed status is an error", [ok({ ...fixture("razorpay-refund-create.json"), status: "failed" })], { op: "refund", args: ["pay_1", { amount: 100, receipt: "r" }] });
  await add("refund: payment id missing at Razorpay", [notExist()], { op: "refund", args: ["pay_none", { amount: 100, receipt: "r" }] });
  await add("refund: payment id to escape", [refundCreate()], { op: "refund", args: ["pay/ 1@", { amount: 100, receipt: "r" }] });
  await add("refund: Guard answered from its record (replayed)", [guardReply("replayed")], { op: "refund", args: ["pay_Nx1", { amount: 60000, receipt: "b-1:pay_Nx1" }] });
  await add("refund: a 400 from Razorpay, more than is left", [status(400, { error: { code: "BAD_REQUEST_ERROR", description: "The refund amount provided is greater than amount captured" } })], { op: "refund", args: ["pay_1", { amount: 99999999, receipt: "r" }] });
  await add("refund: a record with no id", [ok({ ...fixture("razorpay-refund-create.json"), id: undefined })], { op: "refund", args: ["pay_1", { amount: 100, receipt: "r" }] });
  for (const n of guardNames) await add(`refund: Guard answer ${n}`, [guardReply(n)], { op: "refund", args: ["pay_Nx1", { amount: 60000, receipt: "b-1:pay_Nx1" }] });
  await add("refund: 429 from the service", [{ status: 429, body: { error: { description: "Too many requests" } } }], { op: "refund", args: ["pay_1", { amount: 100, receipt: "r" }] });
  await add("refund: a reply that never comes", [{ hang: true }], { op: "refund", args: ["pay_1", { amount: 100, receipt: "r" }] }, { timeoutMs: 150 });
  await add("refund: a connection cut", [{ cut: true }], { op: "refund", args: ["pay_1", { amount: 100, receipt: "r" }] });
  await add("refund: nothing listens", [], { op: "refund", args: ["pay_1", { amount: 100, receipt: "r" }] }, { closed: true });

  // ---- resendRefund: the held bytes untouched
  const held = JSON.stringify({ amount: 60000, receipt: "b-3:pay_Nx1" });
  await add("resendRefund: the held bytes are sent as they were", [refundCreate()], { op: "resendRefund", args: ["pay_Nx1", held] }, tok);
  await add("resendRefund: odd bytes (spaces, a string amount) stay", [refundCreate()], { op: "resendRefund", args: ["pay_Nx1", "{ \"amount\": \"60000\", \"receipt\":\"b-3:pay_Nx1\" }\n"] });
  await add("resendRefund: with who asked", [refundCreate()], { op: "resendRefund", args: ["pay_Nx1", held, ["owner"]] });
  await add("resendRefund: held again under the same approval", [guardReply("held")], { op: "resendRefund", args: ["pay_Nx1", held] });
  await add("resendRefund: the owner's no on record", [guardReply("denied_by_approver")], { op: "resendRefund", args: ["pay_Nx1", held] });
  await add("resendRefund: already done by a person", [guardReply("already_done")], { op: "resendRefund", args: ["pay_Nx1", held] });
  await add("resendRefund: outcome unknown", [guardReply("outcome_unknown")], { op: "resendRefund", args: ["pay_Nx1", held] });

  // ---- listRefunds
  await add("listRefunds: a list, failed ones left out", [ok({ entity: "collection", count: 3, items: [{ ...fixture("razorpay-refund-create.json") }, { ...fixture("razorpay-refund-create.json"), id: "rfnd_2", status: "failed" }, { ...fixture("razorpay-refund-create.json"), id: "rfnd_3", status: "pending", receipt: undefined }, "junk"] })], { op: "listRefunds", args: ["pay_29QQoUBi66xm2f"] });
  await add("listRefunds: asks for 100", [ok({ items: [] })], { op: "listRefunds", args: ["pay_1"] });
  await add("listRefunds: missing payment is an empty list", [notExist()], { op: "listRefunds", args: ["pay_none"] });
  await add("listRefunds: a refund with no amount spoils the list", [ok({ items: [{ id: "r", payment_id: "p", created_at: 1 }] })], { op: "listRefunds", args: ["pay_1"] });
  await add("listRefunds: a 500", [status(500, { error: { description: "boom" } })], { op: "listRefunds", args: ["pay_1"] });
  await add("listRefunds: Guard busy", [guardReply("busy")], { op: "listRefunds", args: ["pay_1"] });
  await add("listRefunds: a cut connection", [{ cut: true }], { op: "listRefunds", args: ["pay_1"] });

  // ---- readSettlements: the whole day, page by page
  const row = (i: number, extra: Record<string, unknown> = {}) => ({ entity_id: `pay_${i}`, type: "payment", amount: 10000 + i, fee: 200, tax: 36, debit: 0, credit: 9764, on_hold: false, settled: true, settlement_id: "setl_1", settlement_utr: "UTR1", settled_at: 1793700000, currency: "INR", ...extra });
  await add("readSettlements: three pages of two", [ok({ items: [row(1), row(2)] }), ok({ items: [row(3, { type: "refund", payment_id: "pay_1" }), row(4, { type: "mystery" })] }), ok({ items: [row(5, { on_hold: true, settled: false, settlement_id: null, settlement_utr: null, settled_at: null })] })], { op: "readSettlements", args: [{ year: 2026, month: 11, day: 15 }, { pageSize: 2 }] });
  await add("readSettlements: the default page size, one short page", [ok({ items: [row(1)] })], { op: "readSettlements", args: [{ year: 2026, month: 1, day: 2 }] });
  await add("readSettlements: an empty day", [ok({ items: [] })], { op: "readSettlements", args: [{ year: 2026, month: 11, day: 15 }] });
  await add("readSettlements: the second page fails", [ok({ items: [row(1), row(2)] }), guardReply("busy")], { op: "readSettlements", args: [{ year: 2026, month: 11, day: 15 }, { pageSize: 2 }] });
  await add("readSettlements: a row in another currency", [ok({ items: [row(1, { currency: "USD" })] })], { op: "readSettlements", args: [{ year: 2026, month: 11, day: 15 }] });
  await add("readSettlements: a row with no id", [ok({ items: [row(1, { entity_id: undefined })] })], { op: "readSettlements", args: [{ year: 2026, month: 11, day: 15 }] });
  await add("readSettlements: a row with no payment_id or type", [ok({ items: [{ entity_id: "x1", currency: null }] })], { op: "readSettlements", args: [{ year: 2026, month: 11, day: 15 }] });
  await add("readSettlements: a page that never ends", Array.from({ length: 200 }, () => ok({ items: [{ entity_id: "p" }] })), { op: "readSettlements", args: [{ year: 2026, month: 11, day: 15 }, { pageSize: 1 }] });
  return out;
}

// ---- the webhook reader ------------------------------------------------------------------------------------------------------------

export function webhookVectors(): unknown {
  const names = ["payment.captured", "payment_link.expired", "payment_link.paid", "refund.processed"];
  const bodies: [string, unknown][] = names.map((n) => [n, fixture(`razorpay-webhook-${n}.json`)]);
  bodies.push(["not an object", [1]], ["no payload", { event: "payment.captured" }], ["payment.failed", { event: "payment.failed", payload: {}, created_at: 5 }],
    ["paid, no link id", { event: "payment_link.paid", payload: { payment_link: { entity: {} } } }],
    ["paid, no payment", { event: "payment_link.paid", created_at: 7, payload: { payment_link: { entity: { id: "plink_1", reference_id: "b-1" } } } }],
    ["captured, no payment id", { event: "payment.captured", payload: { payment: { entity: {} } } }],
    ["refund, no payment id", { event: "refund.processed", payload: { refund: { entity: { id: "rfnd_1" } } } }]);
  const secret = "whsec_test_1";
  const parse = bodies.flatMap(([label, body]) => [{ label, body, eventId: "evt_header_1", out: parseRazorpayEvent(body, "evt_header_1") }, { label, body, out: parseRazorpayEvent(body) }]);
  const raw = Buffer.from(JSON.stringify(fixture("razorpay-webhook-payment.captured.json")));
  const good = signRazorpay(raw, secret);
  return {
    parse,
    secret, raw: raw.toString("utf8"), good,
    verify: [
      { header: good, secret, ok: verifyRazorpaySignature(raw, good, secret) },
      { header: good.toUpperCase(), secret, ok: verifyRazorpaySignature(raw, good.toUpperCase(), secret) },
      { header: good, secret: "", ok: verifyRazorpaySignature(raw, good, "") },
      { header: undefined, secret, ok: verifyRazorpaySignature(raw, undefined, secret) },
      { header: "zz", secret, ok: verifyRazorpaySignature(raw, "zz", secret) },
      { header: good.slice(0, 10), secret, ok: verifyRazorpaySignature(raw, good.slice(0, 10), secret) },
      { header: good, secret: "other", ok: verifyRazorpaySignature(raw, good, "other") },
    ],
  };
}

export async function files(): Promise<[string, unknown][]> {
  return [["payments/razorpay/testdata/razorpay-vectors.json", { cases: await cases() }], ["payments/razorpay/testdata/webhook-vectors.json", webhookVectors()]];
}
