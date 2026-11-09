// The dev harness: the Orders agent wired to the in-memory fakes, with a clock you can move and helpers that play the part of the customer, the payment provider's webhooks and
// the owner. The crash-test situations, the hand check and the walkthrough build on this.
import type { LicenceNow } from "../../../../modules/licence/rules.ts";
import type { OwedRefund, MarkedRequest } from "../../../../modules/payments/owner-marked/ledger.ts";
import { readFileSync } from "node:fs";
import { fakeClock } from "../../../../modules/core/clock.ts";
import type { FakeClock } from "../../../../modules/core/clock.ts";
import { zonedToMs } from "../../../../modules/core/time.ts";
import { LANGUAGES } from "../../../../modules/language/languages.ts";
import { createFakeMessaging } from "../../../../modules/messaging/messaging.ts";
import type { FakeMessaging, InboundMessage } from "../../../../modules/messaging/messaging.ts";
import { createGuardModel } from "../../../../modules/payments/guard-model.ts";
import type { GuardModel } from "../../../../modules/payments/guard-model.ts";
import { createFakePayments } from "../../../../modules/payments/payments.ts";
import type { FakePayments, FakePaymentsOptions, PaymentRequest } from "../../../../modules/payments/payments.ts";
import { createRecord } from "../../../../modules/record/record.ts";
import type { ActionRecord } from "../../../../modules/record/record.ts";
import type { AiPolicy } from "../../../../modules/understanding/ai-state.ts";
import { createAgent } from "./agent.ts";
import type { Agent } from "./agent.ts";
import { createRuleParser } from "./adapters/rule-parser.ts";
import type { IntentParser } from "./adapters/model.ts";
import { createStore } from "./order.ts";
import type { Order, Store } from "./order.ts";
import { razorpayLimitsSpec } from "./guard-limits.ts";
import { META_TEMPLATE_NAMES } from "./language/meta-templates.ts";
import { TEMPLATE_NAMES } from "./language/templates.ts";
import { parseSettings } from "./settings.ts";
import type { Settings } from "./settings.ts";

const example = (file: string): Settings => parseSettings(JSON.parse(readFileSync(new URL(`../settings/${file}`, import.meta.url), "utf8")));

/** Annapurna Tiffins, the example shop: a tiffin service that takes UPI (the usual for a partner shop), pickup and delivery. */
export const annapurna = (): Settings => example("annapurna-tiffins.example.json");
/** The same shop on Razorpay. */
export const annapurnaRazorpay = (): Settings => example("annapurna-tiffins-razorpay.example.json");
/** Sweet Crumbs Bakery, a second example: Malayalam and English, pickup only, the whole order paid in advance, on Razorpay. */
export const sweetCrumbs = (): Settings => example("sweet-crumbs.example.json");

/** Customers of the example shop. */
export const AMIT = "+919844444444"; // English
export const SUNITA = "+919811111111"; // Hindi
export const RAJESH = "+919833333333"; // English, a second customer for stock and the day's limit

export interface World {
  settings: Settings;
  clock: FakeClock;
  payments: FakePayments;
  /** The Guard in front of the payments service, as there is in production: built from the settings' own limits (src/guard-limits.ts). */
  guard: GuardModel;
  messaging: FakeMessaging;
  record: ActionRecord;
  store: Store;
  agent: Agent;
  owner: string;
  /** A customer sends a message and the agent handles it. Pass `id` to reuse a WhatsApp message id. */
  say(text: string, options?: { from?: string; id?: string; image?: boolean }): Promise<InboundMessage>;
  /** A customer taps a button of the newest interactive message the agent sent them that has that id, as WhatsApp would report it. Throws if no such option was ever offered. */
  tap(id: string, options?: { from?: string }): Promise<InboundMessage>;
  /** The owner sends a message ("approve o-1"). */
  ownerSays(text: string): Promise<InboundMessage>;
  /** The provider delivers the same inbound message again. */
  redeliver(message: InboundMessage): Promise<void>;
  /** The payment provider's webhooks reach the agent: every event not delivered yet, once (or twice, with `twice`). */
  deliverPaymentEvents(options?: { twice?: boolean }): Promise<void>;
  /** Time passes: move the clock, then let the agent expire holds and finish orders. */
  advance(minutes: number): Promise<void>;
  /** Jump to a moment in the shop's time zone, then let the agent act. */
  goto(day: { year: number; month: number; day: number }, time?: { hour: number; minute: number }): Promise<void>;
  tick(): Promise<void>;
  /** The owner answers a refund Guard is holding, as the approvals relay would carry it. Without an id it is the only refund waiting. */
  ownerAnswers(decision: "approve" | "deny", approval?: string): Promise<void>;
  /** The refunds Guard is holding for the owner right now: what the relay would ask about. */
  heldForOwner(): { id: string; amountPaise: number; paymentId: string; receipt: string }[];
  /** What the messaging service's outbox holds for a number. */
  textsTo(number: string): string[];
  lastTextTo(number: string): string;
  /** A customer's latest order. */
  orderOf(customer: string): Order | undefined;
  /** The payment link a customer should pay now, as the payments service holds it. */
  linkFor(customer: string): PaymentRequest | undefined;
  /** The customer pays the current link (all of it, or an amount). */
  pays(customer: string, options?: { amountInr?: number }): void;
  /** UPI shops (B33): the order's current request, as the agent's own ledger holds it (its code is the owner's, never the customer's). */
  upiRequest(customer: string): MarkedRequest | undefined;
  /** UPI: the refunds the owner owes for the customer's latest order. */
  upiRefunds(customer: string): OwedRefund[];
  /** UPI: the owner marks money received on the customer's current request (by tapping the newest "Received" button with `tap`), or another amount with `amountInr`. `code` replays a code. */
  ownerMarksReceived(customer: string, options?: { amountInr?: number; code?: string; tap?: boolean }): Promise<InboundMessage>;
  /** UPI: the owner marks a refund they owe for the customer's order as sent. */
  ownerMarksRefund(customer: string, options?: { code?: string; tap?: boolean }): Promise<InboundMessage>;
}

export interface WorldOptions {
  settings?: Settings;
  /** The moment the world starts; default Mon 9 Nov 2026, 10:00 in India: today's lunch slot has closed (09:00), today's dinner slot has not (15:00). */
  nowMs?: number;
  parser?: IntentParser;
  payments?: FakePaymentsOptions;
  /** The monthly AI allowance and the outside switch (modules/understanding/ai-state.ts). */
  ai?: AiPolicy;
  /** Whether the stand-in WhatsApp takes buttons. Default true. */
  interactive?: boolean;
  /** A UPI shop: where the QR pictures go (modules/payments/owner-marked/qr-image.ts memoryQrImages). Left out: no picture, the words alone. */
  qrImage?: (text: string) => Promise<string | null>;
  /** The licence right now (modules/licence): a test sets it to the wind-down or the final stop. Left out: never restricted. */
  licence?: () => LicenceNow;
}

/** The tenant and builder named in the Guard spec the harness builds; they only label it. */
export const HARNESS_GUARD = { tenant: "annapurna", version: 1, reviewedBy: "hand-check" } as const;

export function createWorld(options: WorldOptions = {}): World {
  const settings = options.settings ?? annapurna();
  const clock = fakeClock(options.nowMs ?? zonedToMs({ year: 2026, month: 11, day: 9 }, { hour: 10, minute: 0 }, settings.timezone));
  const guard = createGuardModel(razorpayLimitsSpec(settings, HARNESS_GUARD), clock);
  const payments = createFakePayments(clock, { guard, ...options.payments });
  const messaging = createFakeMessaging(clock);
  for (const name of [...Object.values(TEMPLATE_NAMES), ...META_TEMPLATE_NAMES]) for (const language of LANGUAGES) messaging.approve(name, language);
  if (options.interactive === false) delete (messaging as { sendInteractive?: unknown }).sendInteractive;
  const record = createRecord(clock);
  const store = createStore();
  const agent = createAgent({ settings, clock, payments, messaging, parser: options.parser ?? createRuleParser(), record, store, ...(options.ai ? { ai: options.ai } : {}), ...(options.qrImage ? { qrImage: options.qrImage } : {}), ...(options.licence ? { licence: options.licence } : {}) });
  let deliveredEvents = 0;
  const CUSTOMER = AMIT;

  const world: World = {
    settings, clock, payments, guard, messaging, record, store, agent, owner: settings.owner.whatsapp,
    async say(text, o = {}) {
      const message = messaging.receive(o.from ?? CUSTOMER, text, { ...(o.id ? { id: o.id } : {}), ...(o.image ? { image: true } : {}) });
      await agent.handle({ kind: "message", message });
      return message;
    },
    async tap(id, o = {}) {
      const from = o.from ?? CUSTOMER;
      const shown = messaging.sentTo(from).filter((m) => m.interactive).reverse().map((m) => m.interactive!).find((i) => [...(i.buttons ?? []), ...(i.list?.rows ?? [])].some((c) => c.id === id));
      const option = [...(shown?.buttons ?? []), ...(shown?.list?.rows ?? [])].find((c) => c.id === id);
      if (!shown || !option) throw new Error(`No buttons ${from} was sent have an option with the id "${id}".`);
      const message = messaging.receive(from, option.title, { reply: { id, kind: shown.buttons ? "button" : "list" } });
      await agent.handle({ kind: "message", message });
      return message;
    },
    async ownerSays(text) {
      const message = messaging.receive(settings.owner.whatsapp, text);
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
    async goto(day, time = { hour: 10, minute: 0 }) {
      clock.set(zonedToMs(day, time, settings.timezone));
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
    heldForOwner: () => guard.reviews(`runtime-${HARNESS_GUARD.tenant}`, true).map((r) => ({ id: r.id, amountPaise: Number(r.amount), paymentId: r.arguments[1].payment_id[1], receipt: r.arguments[1].receipt?.[1] ?? "" })),
    textsTo: (number) => messaging.sentTo(number).map((m) => m.text),
    lastTextTo: (number) => messaging.sentTo(number).at(-1)?.text ?? "",
    orderOf: (customer) => [...store.orders.values()].reverse().find((o) => o.customer === customer),
    linkFor: (customer) => {
      const o = world.orderOf(customer);
      return o?.linkId ? payments.links().find((l) => l.id === o.linkId) : undefined;
    },
    pays(customer, o = {}) {
      const link = world.linkFor(customer);
      if (!link) throw new Error(`${customer} has no payment link to pay.`);
      payments.customerPays(link.id, o.amountInr !== undefined ? { amount: o.amountInr * 100 } : {});
    },
    upiRequest: (customer) => { const o = world.orderOf(customer); return o?.linkId ? store.upi?.requests.find((r) => r.id === o.linkId) : undefined; },
    upiRefunds: (customer) => { const o = world.orderOf(customer); return store.upi?.refunds.filter((r) => r.caseId === o?.id) ?? []; },
    async ownerMarksReceived(customer, o = {}) {
      const request = world.upiRequest(customer);
      const code = o.code ?? request?.code ?? request?.usedCodes.at(-1);
      if (!code) throw new Error(`No UPI request for ${customer}.`);
      if (o.tap) return world.tap(`upi-received:${code}`, { from: world.owner });
      return world.ownerSays(o.amountInr !== undefined ? `received ${code} ${o.amountInr}` : `received ${code}`);
    },
    async ownerMarksRefund(customer, o = {}) {
      const refunds = world.upiRefunds(customer);
      const refund = refunds.find((r) => r.code !== null) ?? refunds.at(-1);
      const code = o.code ?? refund?.code ?? refund?.usedCodes.at(-1);
      if (!code) throw new Error(`No refund owed for ${customer}.`);
      if (o.tap) return world.tap(`upi-refunded:${code}`, { from: world.owner });
      return world.ownerSays(`refunded ${code}`);
    },
  };
  return world;
}
