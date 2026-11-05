// The dev harness: the agent wired to the in-memory fakes, with a clock you can move and helpers that play the part of
// the customer, the payment provider's webhooks and the owner. The crash-test situations and the hand check build on this.
import { readFileSync } from "node:fs";
import { createAgent } from "./agent.ts";
import type { Agent } from "./agent.ts";
import { createStore } from "./booking.ts";
import type { Store } from "./booking.ts";
import { fakeClock } from "../../../modules/core/clock.ts";
import type { FakeClock } from "../../../modules/core/clock.ts";
import { createFakeCalendar } from "./adapters/calendar.ts";
import type { FakeCalendar } from "./adapters/calendar.ts";
import { createFakeMessaging } from "../../../modules/messaging/messaging.ts";
import type { FakeMessaging, InboundMessage } from "../../../modules/messaging/messaging.ts";
import type { IntentParser } from "./adapters/model.ts";
import type { AiPolicy } from "../../../modules/understanding/ai-state.ts";
import { createGuardModel } from "../../../modules/payments/guard-model.ts";
import type { GuardModel } from "../../../modules/payments/guard-model.ts";
import { createFakePayments } from "../../../modules/payments/payments.ts";
import type { FakePayments, FakePaymentsOptions, PaymentLink } from "../../../modules/payments/payments.ts";
import { createRuleParser } from "./adapters/rule-parser.ts";
import { META_TEMPLATE_NAMES } from "./language/meta-templates.ts";
import { TEMPLATE_NAMES } from "./language/templates.ts";
import { razorpayLimitsSpec } from "./guard-limits.ts";
import { createRecord } from "../../../modules/record/record.ts";
import type { ActionRecord } from "../../../modules/record/record.ts";
import { parseSettings } from "./settings.ts";
import { LANGUAGES } from "../../../modules/language/languages.ts";
import type { Settings } from "./settings.ts";
import { zonedToMs } from "../../../modules/core/time.ts";

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
  /** The Guard in front of the refunds, as there is in production: built from the settings' own refund limit (src/guard-limits.ts). */
  guard: GuardModel;
  messaging: FakeMessaging;
  record: ActionRecord;
  store: Store;
  agent: Agent;
  owner: string;
  /** A customer sends a message and the agent handles it. Pass `id` to reuse a WhatsApp message id. */
  say(text: string, options?: { from?: string; id?: string }): Promise<InboundMessage>;
  /**
   * A customer taps a button or a list row of the newest interactive message the agent sent them that has that id, as WhatsApp would report it: the id and the row's
   * title. Throws if no such option was ever offered, so a test cannot tap something that was never on the screen.
   */
  tap(id: string, options?: { from?: string }): Promise<InboundMessage>;
  /** The provider delivers the same inbound message again. */
  redeliver(message: InboundMessage): Promise<void>;
  /** The payment provider's webhooks reach the agent: every event not delivered yet, once (or twice, with `twice`). */
  deliverPaymentEvents(options?: { twice?: boolean }): Promise<void>;
  /** Time passes: move the clock, then let the agent expire holds and send due reminders. */
  advance(minutes: number): Promise<void>;
  tick(): Promise<void>;
  /**
   * The owner answers a refund Guard is holding, as the approvals relay would carry it: Guard records the owner's decision (a signed
   * notification in production), then the relay tells the agent. Without an id it is the only refund waiting.
   */
  ownerAnswers(decision: "approve" | "deny", approval?: string): Promise<void>;
  /** The refunds Guard is holding for the owner right now: what the relay would ask about. */
  heldForOwner(): { id: string; amountPaise: number; paymentId: string; receipt: string }[];
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
  /** The monthly AI allowance and the outside switch (modules/understanding/ai-state.ts). */
  ai?: AiPolicy;
  /**
   * Whether the stand-in WhatsApp takes buttons and lists. Default true. False makes it a provider without them, so the agent sends the same words as plain text: for a
   * page that cannot draw buttons yet (the demo), and for the scripted month, which is about records and money and not about taps.
   */
  interactive?: boolean;
}

/** The tenant and builder named in the Guard spec the harness builds; they only label it. */
export const HARNESS_GUARD = { tenant: "glow-salon", version: 1, reviewedBy: "hand-check" } as const;

export function createWorld(options: WorldOptions = {}): World {
  const settings = options.settings ?? glowSalon();
  const clock = fakeClock(options.nowMs ?? zonedToMs({ year: 2026, month: 11, day: 3 }, { hour: 10, minute: 0 }, settings.timezone));
  const calendar = createFakeCalendar();
  const guard = createGuardModel(razorpayLimitsSpec(settings, HARNESS_GUARD), clock);
  const payments = createFakePayments(clock, { guard, ...options.payments });
  const messaging = createFakeMessaging(clock);
  for (const name of [...Object.values(TEMPLATE_NAMES), ...META_TEMPLATE_NAMES]) for (const language of LANGUAGES) messaging.approve(name, language);
  if (options.interactive === false) delete (messaging as { sendInteractive?: unknown }).sendInteractive;
  const record = createRecord(clock);
  const store = createStore();
  const agent = createAgent({ settings, clock, calendar, payments, messaging, parser: options.parser ?? createRuleParser(), record, store, ...(options.ai ? { ai: options.ai } : {}) });
  let deliveredEvents = 0;

  const world: World = {
    settings, clock, calendar, payments, guard, messaging, record, store, agent, owner: settings.owner.whatsapp,
    async say(text, o = {}) {
      const message = messaging.receive(o.from ?? CUSTOMER, text, o.id ? { id: o.id } : {});
      await agent.handle({ kind: "message", message });
      return message;
    },
    async tap(id, o = {}) {
      const from = o.from ?? CUSTOMER;
      // the newest message that has this option on it: a customer can scroll up and tap an older button
      const shown = messaging.sentTo(from).filter((m) => m.interactive).reverse().map((m) => m.interactive!).find((i) => [...(i.buttons ?? []), ...(i.list?.rows ?? [])].some((c) => c.id === id));
      const option = [...(shown?.buttons ?? []), ...(shown?.list?.rows ?? [])].find((c) => c.id === id);
      if (!shown || !option) throw new Error(`No buttons or list ${from} was sent have an option with the id "${id}".`);
      const message = messaging.receive(from, option.title, { reply: { id, kind: shown.buttons ? "button" : "list" } });
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
    async ownerAnswers(decision, approval) {
      const waiting = world.heldForOwner();
      const id = approval ?? (waiting.length === 1 ? waiting[0].id : undefined);
      if (!id) throw new Error(`ownerAnswers needs an approval id: ${waiting.length} refund(s) wait for the owner.`);
      const decided = guard.decide(id, decision === "approve", "owner");
      if (decided.status !== 200) throw new Error(`Guard would not record that: ${decided.error}`);
      await agent.handle({ kind: "approval_decision", approval: id, decision });
    },
    heldForOwner: () => guard.reviews("runtime-glow-salon", true).map((r) => ({ id: r.id, amountPaise: Number(r.amount), paymentId: r.arguments[1].payment_id[1], receipt: r.arguments[1].receipt?.[1] ?? "" })),
    textsTo: (number) => messaging.sentTo(number).map((m) => m.text),
    lastTextTo: (number) => messaging.sentTo(number).at(-1)?.text ?? "",
    linkFor: (ref) => payments.links().find((l) => l.reference_id === ref),
  };
  return world;
}
