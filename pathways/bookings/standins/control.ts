// The stand-ins' control routes, /_standin/...: how a test or a person plays the customer and the provider, and makes things go wrong.
// A customer writes (the stand-in then delivers a SIGNED webhook to the inbox, as WhatsApp would), a customer pays a link (a signed Razorpay
// webhook follows), a fault is planned, and the outbox, events, links and calendar can be read. These routes exist only here, never on a real
// service, and the stand-ins listen on 127.0.0.1 only.
import type { FakeCalendar } from "../src/adapters/calendar.ts";
import type { FakeMessaging } from "../src/adapters/messaging.ts";
import type { FakePayments, PaymentEvent } from "../src/adapters/payments.ts";
import { signMeta, signRazorpay } from "../src/adapters/live/webhooks.ts";
import { ok } from "./http.ts";
import type { Handler, StandinReply } from "./http.ts";
import { wireLink, wirePayment, wireRefund } from "./razorpay.ts";

export interface Fakes { payments: FakePayments; calendar: FakeCalendar; messaging: FakeMessaging }

export interface ControlConfig {
  fakes: Fakes;
  /** Where signed webhooks go, for example http://127.0.0.1:8788. Without it, nothing is delivered (the reply says so). */
  inboxUrl?: string;
  razorpayWebhookSecret: string;
  whatsappAppSecret: string;
  /** The phone number id and display number the webhooks come "from". */
  phoneNumberId?: string;
  /** How many requests carried an Authorization header: a live adapter must never send one. */
  authorizationSeen(): number;
}

const bad = (message: string): StandinReply => ({ status: 400, body: { error: message } });

// ---- the webhooks the providers would send ----------------------------------------------------------------------------------

/** A Razorpay webhook body for an event the fake emitted. `payment.captured` names the payment and its order but not its link, as the real one does. */
export function razorpayWebhookBody(event: PaymentEvent, payments: FakePayments): string {
  const links = payments.links();
  const payment = (id: string | undefined) => links.flatMap((l) => l.payments).find((p) => p.id === id);
  const head = { account_id: "acc_standin", created_at: event.created_at, entity: "event", event: event.event };
  let contains: string[];
  let payload: Record<string, unknown>;
  if (event.event === "payment_link.paid") {
    const link = links.find((l) => l.id === event.payload.payment_link?.id)!;
    contains = ["payment_link", "payment"];
    payload = { payment_link: { entity: wireLink(link, "full") }, payment: { entity: wirePayment(payment(event.payload.payment?.id)!) } };
  } else if (event.event === "payment.captured") {
    contains = ["payment"];
    payload = { payment: { entity: wirePayment(payment(event.payload.payment?.id)!) } };
  } else {
    const refund = payments.refunds().find((r) => r.id === event.payload.refund?.id)!;
    contains = ["refund", "payment"];
    payload = { refund: { entity: wireRefund(refund) }, payment: { entity: wirePayment(payment(refund.payment_id)!) } };
  }
  return JSON.stringify({ ...head, contains, payload });
}

/** A WhatsApp webhook body for one customer text. `from` has no plus and the time is epoch seconds as a string, as Meta writes them. */
export function whatsappWebhookBody(message: { id: string; from: string; text: string; timestamp: number }, phoneNumberId: string): string {
  const digits = message.from.replace(/^\+/u, "");
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ id: "standin-waba", changes: [{ field: "messages", value: {
      messaging_product: "whatsapp", metadata: { display_phone_number: "15550000000", phone_number_id: phoneNumberId },
      contacts: [{ profile: { name: "Stand-in customer" }, wa_id: digits }],
      messages: [{ from: digits, id: message.id, timestamp: String(Math.floor(message.timestamp / 1000)), type: "text", text: { body: message.text } }],
    } }] }],
  });
}

// ---- the routes ---------------------------------------------------------------------------------------------------------------

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

  /** Send every Razorpay event not yet sent, in order, each signed; once, or twice when `twice` (a duplicate delivery). */
  async function deliverPaymentEvents(twice: boolean): Promise<unknown[]> {
    const pending = fakes.payments.events.slice(deliveredEvents);
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
      if (typeof body?.link_id !== "string") return bad("send { link_id } (and optionally amount, twice, deliver)");
      let payment;
      try { payment = fakes.payments.customerPays(body.link_id, typeof body.amount === "number" ? { amount: body.amount } : {}); } catch (e) { return bad((e as Error).message); }
      return ok({ payment, delivered: body.deliver === false ? [] : await deliverPaymentEvents(body.twice === true) });
    }

    if (path === "/_standin/razorpay/deliver" && method === "POST") return ok({ delivered: await deliverPaymentEvents(body?.twice === true) });

    if (path === "/_standin/fault" && method === "POST") {
      const target = body?.service === "payments" ? fakes.payments : body?.service === "calendar" ? fakes.calendar : body?.service === "messaging" ? fakes.messaging : undefined;
      if (!target || typeof body.op !== "string" || typeof body.mode !== "string") return bad("send { service: payments|calendar|messaging, op, mode } (and optionally times, after)");
      (target.inject as (op: string, mode: string, options?: { times?: number; after?: number }) => void)(body.op, body.mode, { times: body.times, after: body.after });
      return ok({ planned: { service: body.service, op: body.op, mode: body.mode, times: body.times ?? 1, after: body.after ?? 0 } });
    }

    if (path === "/_standin/state" && method === "GET") {
      return ok({
        outbox: fakes.messaging.outbox(), links: fakes.payments.links(), refunds: fakes.payments.refunds(), events: fakes.payments.events, calendar: fakes.calendar.events(),
        calls: { payments: fakes.payments.calls, calendar: fakes.calendar.calls }, authorizationSeen: config.authorizationSeen(),
      });
    }

    return { status: 404, body: { error: "no such control route" } };
  };
}
