// Razorpay: a gateway for a shop that has, or wants, its own Razorpay account (B33, B71: added only when a shop or builder needs it; UPI is the default). The shop
// opens the account itself; Geometer never holds its money or its key, which only the shop's Razorpay Guard reads. Everything Razorpay-shaped is in this folder:
//   api.ts      the wire format mapped onto the neutral Payments (payments.ts)
//   webhook.ts  the signature and the events, read into the neutral events
//   guard.ts    the routes and operations the neutral Guard rules (guard-limits.ts) are written for
//   standin.ts  the stand-in every crash test runs against, and the webhook bodies it sends
//   words.ts    what a person reads about Razorpay, in four languages
//   SIGNUP.md   what a shop must open, and what it costs
import { isObject, str } from "../../../core/http.ts";
import type { PaymentProvider } from "../types.ts";
import { createRazorpayPayments } from "./api.ts";
import { RAZORPAY_GUARD } from "./guard.ts";
import { razorpayStandin, razorpayWebhookBody } from "./standin.ts";
import { EVENT_ID_HEADER, SIGNATURE_HEADER, parseRazorpayEvent, signRazorpay, verifyRazorpaySignature } from "./webhook.ts";
import { RAZORPAY_WORDS } from "./words.ts";

/** A Razorpay key id: rzp_live_... or rzp_test_..., which also says the key's mode. It is public; the key secret is not. */
const KEY_ID = /^rzp_(live|test)_[A-Za-z0-9]{6,40}$/u;
const NO_SPACE = (min: number, max: number) => new RegExp(`^[^\\s]{${min},${max}}$`, "u");

export const razorpay: PaymentProvider = {
  id: "razorpay",
  displayName: "Razorpay",
  // Razorpay's own record says when money arrives (a signed webhook, read back), refunds go through it behind Guard, a payment link can stay open for the rest of
  // a part payment, and a link can be cancelled so it can no longer be paid.
  capabilities: { confirmsAutomatically: true, refundsAutomatically: true, takesPartPayments: true, cancels: true, readsBack: true },
  example: "{\"module\": \"razorpay\"}",
  readSettings(v, errors) {
    for (const key of Object.keys(v)) if (key !== "module" && key !== "upi") errors.push(`I don't know what "${key}" means in the payment module. Allowed: module, upi.`);
    if (v.upi !== undefined) { errors.push("A Razorpay shop has no UPI ID in its settings: take out \"payment.upi\", or set \"payment.module\" to \"upi\"."); return undefined; }
    return { module: "razorpay" };
  },
  gateway: {
    guard: RAZORPAY_GUARD,
    adapter: (config) => createRazorpayPayments(config),
    webhook: {
      signatureHeader: SIGNATURE_HEADER, eventIdHeader: EVENT_ID_HEADER, sign: signRazorpay, verify: verifyRazorpaySignature, read: parseRazorpayEvent,
      // 256 KB is far above any Razorpay event; Razorpay waits 5 seconds for an answer (the inbox answers within 4).
      maxBodyBytes: 256 * 1024, answerWithinMs: 5_000,
    },
    setup: {
      secrets: { key: "razorpay_key", webhook: "razorpay_webhook_secret" },
      keyId: KEY_ID,
      keyExample: "rzp_test_...:...",
      modeOf: (keyId) => (KEY_ID.exec(keyId)?.[1] as "live" | "test" | undefined),
      // "<key id>:<key secret>" on one line, which is what the deployer turns into the Basic credential Guard holds.
      checkKey(text) {
        const v = text.trim();
        const i = v.indexOf(":");
        return i > 0 && KEY_ID.test(v.slice(0, i)) && NO_SPACE(10, 100).test(v.slice(i + 1)) && !v.slice(i + 1).includes(":");
      },
      checkWebhookSecret: (text) => NO_SPACE(8, 200).test(text.trim()),
      authorization: (text) => `Basic ${Buffer.from(text.trim()).toString("base64")}`,
      // A reference nobody has: a good key answers with an empty list. Razorpay documents no call that tells an ordinary merchant key its own account, so whose
      // account it is cannot be checked here (the panel says so; the id is pinned from the first signed webhook, which carries account_id).
      probe: { path: "/v1/payment_links", query: { reference_id: "geometer-connection-check" }, looksRight: (body) => isObject(body) && Array.isArray(body.payment_links) },
      words: RAZORPAY_WORDS,
    },
    standin: { handler: razorpayStandin, webhookBody: razorpayWebhookBody },
    // The price list's ids for Razorpay's fee on a payment (prices/): 2% and 18% GST on it, not returned on a refund.
    feeRates: ["razorpay.platform-fee", "razorpay.gst-on-fee"],
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
  },
  signup: "modules/payments/providers/razorpay/SIGNUP.md",
};
