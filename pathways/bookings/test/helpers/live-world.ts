// The real agent wired to the LIVE adapters, which talk real HTTP to the stand-ins, which sit in front of the in-memory fakes.
// Customer messages and payment events reach the agent the way they do in production: as the providers' webhook bodies, read by the
// webhook parsers. The fakes (world.fakes) are the witnesses: "done" is judged from what they hold, never from what the agent said.
import { createAgent } from "../../src/agent.ts";
import type { AgentEvent } from "../../src/agent.ts";
import { createStore } from "../../src/booking.ts";
import { fakeClock } from "../../src/clock.ts";
import type { FakeClock } from "../../src/clock.ts";
import { createFakePayments } from "../../src/adapters/payments.ts";
import type { FakePaymentsOptions } from "../../src/adapters/payments.ts";
import { createFakeMessaging } from "../../src/adapters/messaging.ts";
import { createFakeCalendar } from "../../src/adapters/calendar.ts";
import { createLiveAdapters } from "../../src/adapters/live/index.ts";
import { parseRazorpayEvent, parseWhatsAppWebhook } from "../../src/adapters/live/webhooks.ts";
import { createRuleParser } from "../../src/adapters/rule-parser.ts";
import { createRecord } from "../../src/record.ts";
import { glowSalon } from "../../src/harness.ts";
import { startStandins } from "../../standins/server.ts";
import type { RunningStandins } from "../../standins/server.ts";
import { razorpayWebhookBody, whatsappWebhookBody } from "../../standins/control.ts";
import { zonedToMs } from "../../src/time.ts";

export const SECRETS = { razorpayWebhookSecret: "standin-rzp-secret", whatsappAppSecret: "standin-wa-secret" };
export const PHONE_NUMBER_ID = "100000000000001";
export const CUSTOMER = "+919811111111";

export async function liveWorld(options: { timeoutMs?: number; calendarPageSize?: number; payments?: FakePaymentsOptions; inboxUrl?: string } = {}) {
  const settings = glowSalon();
  const clock: FakeClock = fakeClock(zonedToMs({ year: 2026, month: 11, day: 3 }, { hour: 10, minute: 0 }, settings.timezone));
  const fakes = { payments: createFakePayments(clock, options.payments), calendar: createFakeCalendar(), messaging: createFakeMessaging(clock) };
  const standins: RunningStandins = await startStandins({ clock, fakes, ...SECRETS, phoneNumberId: PHONE_NUMBER_ID, inboxUrl: options.inboxUrl, calendarPageSize: options.calendarPageSize }, { port: 0 });

  // the runtime's own knowledge of when each customer last wrote
  const lastInbound = new Map<string, number>();
  const window = { lastInboundAt: (phone: string) => lastInbound.get(phone) };
  const adapters = createLiveAdapters(
    { payments: { baseUrl: standins.url }, calendar: { baseUrl: standins.url, calendarId: "shop@example.com" }, messaging: { baseUrl: standins.url, phoneNumberId: PHONE_NUMBER_ID }, timeoutMs: options.timeoutMs ?? 2000 },
    { clock, window },
  );
  const record = createRecord(clock);
  const store = createStore();
  const agent = createAgent({ settings, clock, ...adapters, parser: createRuleParser(), record, store });

  /** Call a control route on the stand-ins. */
  async function control(path: string, body?: unknown, method = body === undefined ? "GET" : "POST"): Promise<any> {
    const r = await fetch(standins.url + path, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "content-type": "application/json" } });
    return r.json();
  }

  let deliveredEvents = 0;
  const world = {
    settings, clock, fakes, standins, adapters, agent, record, store, window, control, owner: settings.owner.whatsapp,
    /** The customer writes. The webhook body is read by the parser, and the runtime notes the time (as it does when it saves an event). */
    async say(text: string, from = CUSTOMER, options: { id?: string } = {}) {
      const message = fakes.messaging.receive(from, text, options.id ? { id: options.id } : {});
      const [parsed] = parseWhatsAppWebhook(JSON.parse(whatsappWebhookBody(message, PHONE_NUMBER_ID)));
      lastInbound.set(parsed.from, parsed.timestamp);
      await agent.handle({ kind: "message", message: parsed });
      return parsed;
    },
    /** Someone writes to the number and the runtime notes the time, but the agent is not asked to answer (this opens their 24-hour window). */
    listen(from: string, text = "hello") {
      const message = fakes.messaging.receive(from, text);
      lastInbound.set(from, message.timestamp);
      return message;
    },
    /** The provider's webhooks: every payment event not yet delivered, read from the real wire shape (once, or twice). */
    async deliverPaymentEvents(o: { twice?: boolean } = {}) {
      const pending = fakes.payments.events.slice(deliveredEvents);
      deliveredEvents = fakes.payments.events.length;
      for (const event of pending) {
        const parsed = parseRazorpayEvent(JSON.parse(razorpayWebhookBody(event, fakes.payments)), event.id);
        if (!parsed) continue;
        const e: AgentEvent = { kind: "payment_event", event: parsed };
        await agent.handle(e);
        if (o.twice) await agent.handle(e);
      }
    },
    async advance(minutes: number) { clock.advanceMinutes(minutes); await agent.handle({ kind: "tick" }); },
    textsTo: (number: string) => fakes.messaging.sentTo(number).map((m) => m.text),
    linkFor: (ref: string) => fakes.payments.links().find((l) => l.reference_id === ref),
    confirmedEvents: () => fakes.calendar.events().filter((e) => e.status === "confirmed" && e.bookingRef !== "foreign"),
    close: () => standins.close(),
  };
  return world;
}
export type LiveWorld = Awaited<ReturnType<typeof liveWorld>>;
