// The stand-ins' control routes, /_standin/...: how a test or a person plays the customer (or parent) and the provider, and makes things go wrong. A customer writes (the
// stand-in then delivers a SIGNED webhook to the inbox, as WhatsApp would), a customer pays a link (a signed webhook of the shop's gateway follows), a fault is planned, and the outbox,
// events and links can be read. These routes exist only here, never on a real service, and the stand-ins listen on 127.0.0.1 only. It is shared by the templates that have
// payments and messages but no calendar (Fees, Orders); Bookings' own control adds the calendar. One copy, so a fix lands once.
import type { FakeMessaging } from "../messaging/messaging.ts";
import type { FakePayments } from "../payments/payments.ts";
import { signMeta } from "../messaging/webhooks.ts";
import { GATEWAYS } from "../payments/providers/index.ts";
import { gatewayRuntime } from "../payments/providers/runtime.ts";
import { ok } from "./http.ts";
import type { Handler, StandinReply } from "./http.ts";
import { whatsappWebhookBody } from "./whatsapp.ts";

export interface Fakes { payments: FakePayments; messaging: FakeMessaging }

export interface ControlConfig {
  fakes: Fakes;
  /** Where signed webhooks go, for example http://127.0.0.1:8788. Without it, nothing is delivered (the reply says so). */
  inboxUrl?: string;
  /** The id of the gateway these stand-ins play (the registry's); with one gateway there is no need to say. It also names the control routes: /_standin/<id>/pay. */
  gateway?: string;
  /** The secret the stand-in signs the gateway's webhooks with. */
  gatewayWebhookSecret: string;
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
  // The gateway's wire code comes from the registry, never from a provider's folder (modules/payments/providers/test/names.test.ts): its webhook body, signature and headers.
  const gatewayId = config.gateway ?? GATEWAYS[0].id;
  const { standin, webhook } = gatewayRuntime(gatewayId);

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
   * Send every payment event not yet sent, in order, each signed; once, or twice when `twice` (a duplicate delivery). With `all`, every event so far goes again, which
   * is what a provider does when it retries something the receiver did not accept (or sends a late repeat).
   */
  async function deliverPaymentEvents(twice: boolean, all = false): Promise<unknown[]> {
    const pending = fakes.payments.events.slice(all ? 0 : deliveredEvents);
    deliveredEvents = fakes.payments.events.length;
    const results: unknown[] = [];
    for (const event of pending) {
      const body = standin.webhookBody(event, fakes.payments);
      const headers: Record<string, string> = { [webhook.signatureHeader]: webhook.sign(Buffer.from(body), config.gatewayWebhookSecret) };
      if (webhook.eventIdHeader) headers[webhook.eventIdHeader] = event.id;
      for (let i = 0; i < (twice ? 2 : 1); i++) results.push({ event: event.event, id: event.id, ...(await deliver(`/webhooks/${gatewayId}`, headers, body)) });
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

    if (path === `/_standin/${gatewayId}/pay` && method === "POST") {
      if (typeof body?.request_id !== "string") return bad("send { request_id } (and optionally amount, twice, deliver)");
      let payment;
      try { payment = fakes.payments.customerPays(body.request_id, typeof body.amount === "number" ? { amount: body.amount } : {}); } catch (e) { return bad((e as Error).message); }
      return ok({ payment, delivered: body.deliver === false ? [] : await deliverPaymentEvents(body.twice === true) });
    }

    if (path === `/_standin/${gatewayId}/deliver` && method === "POST") return ok({ delivered: await deliverPaymentEvents(body?.twice === true, body?.all === true) });

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
