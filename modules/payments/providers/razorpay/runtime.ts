// Razorpay's wire code as one GatewayRuntime: the live adapter, the webhook reader, the stand-in, and the read of a payment's own record for the approvals relay of an
// agent we did not write. Node only: the runtime, the inbox, the relay, the crash tests and the contract test load it through providers/runtime.ts; the agent's
// own import graph never does (it reads the plain declaration in index.ts).
import { isObject, str } from "../../../core/http.ts";
import type { GatewayRuntime } from "../types.ts";
import { createRazorpayPayments } from "./api.ts";
import { razorpayStandin, razorpayWebhookBody } from "./standin.ts";
import { EVENT_ID_HEADER, SIGNATURE_HEADER, parseRazorpayEvent, signRazorpay, verifyRazorpaySignature } from "./webhook.ts";

export const razorpayRuntime: GatewayRuntime = {
  adapter: (config) => createRazorpayPayments(config),
  webhook: {
    signatureHeader: SIGNATURE_HEADER, eventIdHeader: EVENT_ID_HEADER, sign: signRazorpay, verify: verifyRazorpaySignature, read: parseRazorpayEvent,
    // 256 KB is far above any Razorpay event; Razorpay waits 5 seconds for an answer (the inbox answers within 4).
    maxBodyBytes: 256 * 1024, answerWithinMs: 5_000,
  },
  standin: { handler: razorpayStandin, webhookBody: razorpayWebhookBody },
  async paymentContext(baseUrl, token, paymentId, fetchFn, timeoutMs) {
    try {
      const r = await fetchFn(`${baseUrl.replace(/\/+$/u, "")}/v1/payments/${encodeURIComponent(paymentId)}`, { headers: { authorization: `Bearer ${token}`, accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
      const text = await r.text();
      if (r.status === 400 || r.status === 404) return { kind: "missing" }; // Razorpay says it has no such payment
      if (r.status !== 200) return { kind: "error", error: `Razorpay answered ${r.status} when asked about the payment` };
      const p = JSON.parse(text) as { contact?: unknown; created_at?: unknown };
      const atMs = typeof p.created_at === "number" ? p.created_at * 1000 : NaN;
      if (!Number.isFinite(atMs)) return { kind: "error", error: "Razorpay's record of the payment has no time" };
      // who paid, as Razorpay has it: the number the customer gave when paying, when it shows one
      const contact = isObject(p) ? str(p.contact)?.trim() : undefined;
      return { kind: "found", ...(contact ? { customer: contact } : {}), atMs };
    } catch (e) { return { kind: "error", error: `Razorpay could not be asked (${(e as { cause?: { code?: string } })?.cause?.code ?? (e as Error)?.name ?? "error"})` }; }
  },
};
