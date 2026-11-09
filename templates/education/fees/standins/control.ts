// The stand-ins' control routes, /_standin/...: how a test or a person plays the parent and the provider, and makes things go wrong. A parent writes (the stand-in then
// delivers a SIGNED webhook to the inbox, as WhatsApp would), a parent pays a link (a signed Razorpay webhook follows), a fault is planned, and the outbox, events and
// links can be read. These routes exist only here, never on a real service, and the stand-ins listen on 127.0.0.1 only. Fees has no calendar.
//
// The two functions that write a provider's webhook body are Bookings' (templates/commerce/bookings/standins/control.ts). They are imported from there, by a test and dev support
// file that no runtime loads, until the shared stand-ins (modules/standins) carry them.
import type { FakeMessaging } from "../../../../modules/messaging/messaging.ts";
import type { FakePayments } from "../../../../modules/payments/payments.ts";
import { signMeta } from "../../../../modules/messaging/webhooks.ts";
import { signRazorpay } from "../../../../modules/payments/providers/razorpay/webhook.ts";
import { ok } from "../../../../modules/standins/http.ts";
import type { Handler, StandinReply } from "../../../../modules/standins/http.ts";
import { whatsappWebhookBody } from "../../../commerce/bookings/standins/control.ts";
import { razorpayWebhookBody } from "../../../../modules/payments/providers/razorpay/standin.ts";

export { razorpayWebhookBody, whatsappWebhookBody };

export interface Fakes { payments: FakePayments; messaging: FakeMessaging }

export interface ControlConfig {
  fakes: Fakes;
  /** Where signed webhooks go, for example http://127.0.0.1:8788. Without it, nothing is delivered (the reply says so). */
  inboxUrl?: string;
  razorpayWebhookSecret: string;
  whatsappAppSecret: string;
  /** The phone number id the webhooks come "from". */
  phoneNumberId?: string;
  /** How many requests carried an Authorization header: a live adapter must never send one. */
  authorizationSeen(): number;
}

const bad = (message: string): StandinReply => ({ status: 400, body: { error: message } });

export function controlStandin(config: ControlConfig): Handler {
  const { fakes } = config;
  const phoneNumberId = config.phoneNumberId ?? "100000000000001";
  let deliveredEvents = 0;

  async function deliver(path: string, headers: Record<string, string>, body: string): Promise<{ status?: number; error?: string }> {
    if (!config.inboxUrl) return { error: "no inbox URL is configured, so nothing was delivered" };
    try {
      const r = await fetch(config.inboxUrl.replace(/\/+$/u, "") + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body, signal: AbortSignal.timeout(10_000) });
      await r.arrayBuffer().catch(() => undefined);
      return { status: r.status };
    } catch (e) {
      return { error: `could not reach the inbox: ${(e as Error).message}` };
    }
  }

  /**
   * Send every Razorpay event not yet sent, in order, each signed; once, or twice when `twice` (a duplicate delivery). With `all`, every event so far goes again, which
   * is what a provider does when it retries something the receiver did not accept (or sends a late repeat).
   */
  async function deliverPaymentEvents(twice: boolean, all = false): Promise<unknown[]> {
    const pending = fakes.payments.events.slice(all ? 0 : deliveredEvents);
    deliveredEvents = fakes.payments.events.length;
    const results: unknown[] = [];
    for (const event of pending) {
      const body = razorpayWebhookBody(event, fakes.payments);
      const headers = { "x-razorpay-signature": signRazorpay(Buffer.from(body), config.razorpayWebhookSecret), "x-razorpay-event-id": event.id };
      for (let i = 0; i < (twice ? 2 : 1); i++) results.push({ event: event.event, id: event.id, ...(await deliver("/webhooks/razorpay", headers, body)) });
    }
    return results;
  }

  return async ({ method, path, body }) => {
    if (!path.startsWith("/_standin/")) return undefined;

    if (path === "/_standin/whatsapp/inbound" && method === "POST") {
      if (typeof body?.from !== "string" || typeof body?.text !== "string") return bad("send { from, text } (and optionally id, twice, deliver)");
      const message = fakes.messaging.receive(body.from, body.text, body.id ? { id: String(body.id) } : {});
      if (body.deliver === false) return ok({ message, delivered: [] });
      const wire = whatsappWebhookBody(message, phoneNumberId);
      const headers = { "x-hub-signature-256": signMeta(Buffer.from(wire), config.whatsappAppSecret) };
      const delivered = [];
      for (let i = 0; i < (body.twice ? 2 : 1); i++) delivered.push(await deliver("/webhooks/whatsapp", headers, wire));
      return ok({ message, delivered });
    }

    if (path === "/_standin/razorpay/pay" && method === "POST") {
      if (typeof body?.request_id !== "string") return bad("send { request_id } (and optionally amount, twice, deliver)");
      let payment;
      try { payment = fakes.payments.customerPays(body.request_id, typeof body.amount === "number" ? { amount: body.amount } : {}); } catch (e) { return bad((e as Error).message); }
      return ok({ payment, delivered: body.deliver === false ? [] : await deliverPaymentEvents(body.twice === true) });
    }

    if (path === "/_standin/razorpay/deliver" && method === "POST") return ok({ delivered: await deliverPaymentEvents(body?.twice === true, body?.all === true) });

    if (path === "/_standin/fault" && method === "POST") {
      const target = body?.service === "payments" ? fakes.payments : body?.service === "messaging" ? fakes.messaging : undefined;
      if (!target || typeof body.op !== "string" || typeof body.mode !== "string") return bad("send { service: payments|messaging, op, mode } (and optionally times, after)");
      (target.inject as (op: string, mode: string, options?: { times?: number; after?: number }) => void)(body.op, body.mode, { times: body.times, after: body.after });
      return ok({ planned: { service: body.service, op: body.op, mode: body.mode, times: body.times ?? 1, after: body.after ?? 0 } });
    }

    if (path === "/_standin/state" && method === "GET") {
      return ok({ outbox: fakes.messaging.outbox(), links: fakes.payments.links(), refunds: fakes.payments.refunds(), events: fakes.payments.events, calls: { payments: fakes.payments.calls }, authorizationSeen: config.authorizationSeen() });
    }

    return { status: 404, body: { error: "no such control route" } };
  };
}
