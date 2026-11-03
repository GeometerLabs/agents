// The dev harness: the agent wired to the in-memory fakes, with a clock you can move and helpers that play the part of
// the customer, the payment provider's webhooks and the owner. The crash-test situations and the hand check build on this.
import { readFileSync } from "node:fs";
import { createAgent } from "./agent.ts";
import type { Agent } from "./agent.ts";
import { createStore } from "./booking.ts";
import type { Store } from "./booking.ts";
import { fakeClock } from "./clock.ts";
import type { FakeClock } from "./clock.ts";
import { createFakeCalendar } from "./adapters/calendar.ts";
import type { FakeCalendar } from "./adapters/calendar.ts";
import { createFakeMessaging } from "./adapters/messaging.ts";
import type { FakeMessaging, InboundMessage } from "./adapters/messaging.ts";
import type { IntentParser } from "./adapters/model.ts";
import { createFakePayments } from "./adapters/payments.ts";
import type { FakePayments, FakePaymentsOptions, PaymentLink } from "./adapters/payments.ts";
import { createRuleParser } from "./adapters/rule-parser.ts";
import { META_TEMPLATE_NAMES } from "./language/meta-templates.ts";
import { TEMPLATE_NAMES } from "./language/templates.ts";
import { createRecord } from "./record.ts";
import type { ActionRecord } from "./record.ts";
import { LANGUAGES, parseSettings } from "./settings.ts";
import type { Settings } from "./settings.ts";
import { zonedToMs } from "./time.ts";

/** Glow Salon, the example business. */
export function glowSalon(): Settings {
  return parseSettings(JSON.parse(readFileSync(new URL("../settings/glow-salon.example.json", import.meta.url), "utf8")));
}

export const CUSTOMER = "+919811111111";
export const OTHER_CUSTOMER = "+919822222222";

export interface World {
  settings: Settings;
  clock: FakeClock;
  calendar: FakeCalendar;
  payments: FakePayments;
  messaging: FakeMessaging;
  record: ActionRecord;
  store: Store;
  agent: Agent;
  owner: string;
  /** A customer sends a message and the agent handles it. Pass `id` to reuse a WhatsApp message id. */
  say(text: string, options?: { from?: string; id?: string }): Promise<InboundMessage>;
  /** The provider delivers the same inbound message again. */
  redeliver(message: InboundMessage): Promise<void>;
  /** The payment provider's webhooks reach the agent: every event not delivered yet, once (or twice, with `twice`). */
  deliverPaymentEvents(options?: { twice?: boolean }): Promise<void>;
  /** Time passes: move the clock, then let the agent expire holds and send due reminders. */
  advance(minutes: number): Promise<void>;
  tick(): Promise<void>;
  /** What the messaging service's outbox holds for a number. */
  textsTo(number: string): string[];
  lastTextTo(number: string): string;
  /** The payment link for a booking, as the payments service holds it. */
  linkFor(bookingRef: string): PaymentLink | undefined;
}

export interface WorldOptions {
  settings?: Settings;
  /** The moment the world starts; default Tue 3 Nov 2026, 10:00 in India. */
  nowMs?: number;
  parser?: IntentParser;
  payments?: FakePaymentsOptions;
}

export function createWorld(options: WorldOptions = {}): World {
  const settings = options.settings ?? glowSalon();
  const clock = fakeClock(options.nowMs ?? zonedToMs({ year: 2026, month: 11, day: 3 }, { hour: 10, minute: 0 }, settings.timezone));
  const calendar = createFakeCalendar();
  const payments = createFakePayments(clock, options.payments);
  const messaging = createFakeMessaging(clock);
  for (const name of [...Object.values(TEMPLATE_NAMES), ...META_TEMPLATE_NAMES]) for (const language of LANGUAGES) messaging.approve(name, language);
  const record = createRecord(clock);
  const store = createStore();
  const agent = createAgent({ settings, clock, calendar, payments, messaging, parser: options.parser ?? createRuleParser(), record, store });
  let deliveredEvents = 0;

  const world: World = {
    settings, clock, calendar, payments, messaging, record, store, agent, owner: settings.owner.whatsapp,
    async say(text, o = {}) {
      const message = messaging.receive(o.from ?? CUSTOMER, text, o.id ? { id: o.id } : {});
      await agent.handle({ kind: "message", message });
      return message;
    },
    async redeliver(message) {
      await agent.handle({ kind: "message", message });
    },
    async deliverPaymentEvents(o = {}) {
      const pending = payments.events.slice(deliveredEvents);
      deliveredEvents = payments.events.length;
      for (const event of pending) {
        await agent.handle({ kind: "payment_event", event });
        if (o.twice) await agent.handle({ kind: "payment_event", event });
      }
    },
    async advance(minutes) {
      clock.advanceMinutes(minutes);
      await agent.handle({ kind: "tick" });
    },
    tick: () => agent.handle({ kind: "tick" }),
    textsTo: (number) => messaging.sentTo(number).map((m) => m.text),
    lastTextTo: (number) => messaging.sentTo(number).at(-1)?.text ?? "",
    linkFor: (ref) => payments.links().find((l) => l.reference_id === ref),
  };
  return world;
}
