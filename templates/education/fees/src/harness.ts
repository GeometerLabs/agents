// The dev harness: the Fees agent wired to the in-memory fakes, with a clock you can move and helpers that play the part of the parent, the payment provider's
// webhooks and the owner. The crash-test situations, the hand check and the walkthrough build on this.
import type { LicenceNow } from "../../../../modules/licence/rules.ts";
import type { OwedRefund, UpiRequest } from "../../../../modules/payments/upi/ledger.ts";
import { readFileSync } from "node:fs";
import { fakeClock } from "../../../../modules/core/clock.ts";
import type { FakeClock } from "../../../../modules/core/clock.ts";
import { MINUTE, zonedToMs } from "../../../../modules/core/time.ts";
import { LANGUAGES } from "../../../../modules/language/languages.ts";
import { createFakeMessaging } from "../../../../modules/messaging/messaging.ts";
import type { FakeMessaging, InboundMessage } from "../../../../modules/messaging/messaging.ts";
import { createGuardModel } from "../../../../modules/payments/guard-model.ts";
import type { GuardModel } from "../../../../modules/payments/guard-model.ts";
import { createFakePayments } from "../../../../modules/payments/payments.ts";
import type { FakePayments, FakePaymentsOptions, PaymentLink } from "../../../../modules/payments/payments.ts";
import { createRecord } from "../../../../modules/record/record.ts";
import type { ActionRecord } from "../../../../modules/record/record.ts";
import type { AiPolicy } from "../../../../modules/understanding/ai-state.ts";
import { createAgent } from "./agent.ts";
import type { Agent } from "./agent.ts";
import { createRuleParser } from "./adapters/rule-parser.ts";
import type { IntentParser } from "./adapters/model.ts";
import { createStore } from "./due.ts";
import type { Due, Store } from "./due.ts";
import { razorpayLimitsSpec } from "./guard-limits.ts";
import { META_TEMPLATE_NAMES } from "./language/meta-templates.ts";
import { TEMPLATE_NAMES } from "./language/templates.ts";
import { parseSettings } from "./settings.ts";
import type { Settings } from "./settings.ts";

/** Bright Tuition Centre, the example centre. */
export function brightTuition(): Settings {
  return parseSettings(JSON.parse(readFileSync(new URL("../settings/bright-tuition.example.json", import.meta.url), "utf8")));
}

/** Parents of the example centre. Each has one child at the centre, except the Sharmas (two, a brother and a sister). */
export const ROHAN_PARENT = "+919844444444"; // English
export const MEERA_PARENT = "+919822222222"; // Malayalam
export const KIRAN_PARENT = "+919833333333"; // Kannada
export const SHARMA_PARENT = "+919811111111"; // Hindi, two children

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
  /** A parent sends a message and the agent handles it. Pass `id` to reuse a WhatsApp message id. */
  say(text: string, options?: { from?: string; id?: string; image?: boolean }): Promise<InboundMessage>;
  /** A parent taps a button of the newest interactive message the agent sent them that has that id, as WhatsApp would report it. Throws if no such option was ever offered. */
  tap(id: string, options?: { from?: string }): Promise<InboundMessage>;
  /** The owner sends a message ("approve q-1"). */
  ownerSays(text: string): Promise<InboundMessage>;
  /** The provider delivers the same inbound message again. */
  redeliver(message: InboundMessage): Promise<void>;
  /** The payment provider's webhooks reach the agent: every event not delivered yet, once (or twice, with `twice`). */
  deliverPaymentEvents(options?: { twice?: boolean }): Promise<void>;
  /** Time passes: move the clock, then let the agent open fees, add late fees and send due reminders. */
  advance(minutes: number): Promise<void>;
  /** Jump to a moment in the centre's time zone, then let the agent act. */
  goto(day: { year: number; month: number; day: number }, time?: { hour: number; minute: number }): Promise<void>;
  tick(): Promise<void>;
  /** The owner answers a refund Guard is holding, as the approvals relay would carry it. Without an id it is the only refund waiting. */
  ownerAnswers(decision: "approve" | "deny", approval?: string): Promise<void>;
  /** The refunds Guard is holding for the owner right now: what the relay would ask about. */
  heldForOwner(): { id: string; amountPaise: number; paymentId: string; receipt: string }[];
  /** What the messaging service's outbox holds for a number. */
  textsTo(number: string): string[];
  lastTextTo(number: string): string;
  /** The fee of a student, by name. */
  dueOf(student: string): Due | undefined;
  /** The payment link a parent should pay now for a student's fee, as the payments service holds it. */
  linkFor(student: string): PaymentLink | undefined;
  /** The parent pays the current link (all of it, or part). */
  pays(student: string, options?: { amountInr?: number }): void;
  /** UPI centres (B33): the student's fee's current request, as the agent's own ledger holds it (its code is the owner's, never the parent's). */
  upiRequest(student: string): UpiRequest | undefined;
  /** UPI: the refunds the owner owes for the student's fee. */
  upiRefunds(student: string): OwedRefund[];
  /** UPI: the owner marks money received on the student's current request (by tapping the newest "Received" button with `tap`), or another amount with `amountInr`. `code` replays a code. */
  ownerMarksReceived(student: string, options?: { amountInr?: number; code?: string; tap?: boolean }): Promise<InboundMessage>;
  /** UPI: the owner marks a refund they owe for the student's fee as sent. */
  ownerMarksRefund(student: string, options?: { code?: string; tap?: boolean }): Promise<InboundMessage>;
}

export interface WorldOptions {
  settings?: Settings;
  /** The moment the world starts; default Mon 2 Nov 2026, 09:00 in India: the day before the first reminder of November's fees (due on the 5th, reminders from the 2nd). */
  nowMs?: number;
  parser?: IntentParser;
  payments?: FakePaymentsOptions;
  /** The monthly AI allowance and the outside switch (modules/understanding/ai-state.ts). */
  ai?: AiPolicy;
  /** Whether the stand-in WhatsApp takes buttons. Default true. */
  interactive?: boolean;
  /** A UPI centre: where the QR pictures go (modules/payments/upi/qr-image.ts memoryQrImages). Left out: no picture, the words alone. */
  qrImage?: (text: string) => Promise<string | null>;
  /** The licence right now (modules/licence): a test sets it to the wind-down or the final stop. Left out: never restricted. */
  licence?: () => LicenceNow;
}

/** The tenant and builder named in the Guard spec the harness builds; they only label it. */
export const HARNESS_GUARD = { tenant: "bright-tuition", version: 1, reviewedBy: "hand-check" } as const;

export function createWorld(options: WorldOptions = {}): World {
  const settings = options.settings ?? brightTuition();
  const clock = fakeClock(options.nowMs ?? zonedToMs({ year: 2026, month: 11, day: 2 }, { hour: 9, minute: 0 }, settings.timezone));
  const guard = createGuardModel(razorpayLimitsSpec(settings, HARNESS_GUARD), clock);
  const payments = createFakePayments(clock, { guard, ...options.payments });
  const messaging = createFakeMessaging(clock);
  for (const name of [...Object.values(TEMPLATE_NAMES), ...META_TEMPLATE_NAMES]) for (const language of LANGUAGES) messaging.approve(name, language);
  if (options.interactive === false) delete (messaging as { sendInteractive?: unknown }).sendInteractive;
  const record = createRecord(clock);
  const store = createStore();
  const agent = createAgent({ settings, clock, payments, messaging, parser: options.parser ?? createRuleParser(), record, store, ...(options.ai ? { ai: options.ai } : {}), ...(options.qrImage ? { qrImage: options.qrImage } : {}), ...(options.licence ? { licence: options.licence } : {}) });
  let deliveredEvents = 0;
  const PARENT = ROHAN_PARENT;

  const world: World = {
    settings, clock, payments, guard, messaging, record, store, agent, owner: settings.owner.whatsapp,
    async say(text, o = {}) {
      const message = messaging.receive(o.from ?? PARENT, text, { ...(o.id ? { id: o.id } : {}), ...(o.image ? { image: true } : {}) });
      await agent.handle({ kind: "message", message });
      return message;
    },
    async tap(id, o = {}) {
      const from = o.from ?? PARENT;
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
    heldForOwner: () => guard.reviews("runtime-bright-tuition", true).map((r) => ({ id: r.id, amountPaise: Number(r.amount), paymentId: r.arguments[1].payment_id[1], receipt: r.arguments[1].receipt?.[1] ?? "" })),
    textsTo: (number) => messaging.sentTo(number).map((m) => m.text),
    lastTextTo: (number) => messaging.sentTo(number).at(-1)?.text ?? "",
    dueOf: (student) => [...store.dues.values()].reverse().find((d) => d.studentName === student),
    linkFor: (student) => {
      const due = world.dueOf(student);
      return due?.currentLinkId ? payments.links().find((l) => l.id === due.currentLinkId) : undefined;
    },
    pays(student, o = {}) {
      const link = world.linkFor(student);
      if (!link) throw new Error(`${student} has no payment link to pay.`);
      payments.customerPays(link.id, o.amountInr !== undefined ? { amount: o.amountInr * 100 } : {});
    },
    upiRequest: (student) => { const due = world.dueOf(student); return due?.currentLinkId ? store.upi?.requests.find((r) => r.id === due.currentLinkId) : undefined; },
    upiRefunds: (student) => { const due = world.dueOf(student); return store.upi?.refunds.filter((r) => r.caseId === due?.id) ?? []; },
    async ownerMarksReceived(student, o = {}) {
      const request = world.upiRequest(student);
      const code = o.code ?? request?.code ?? request?.usedCodes.at(-1);
      if (!code) throw new Error(`No UPI request for ${student}.`);
      if (o.tap) return world.tap(`upi-received:${code}`, { from: world.owner });
      return world.ownerSays(o.amountInr !== undefined ? `received ${code} ${o.amountInr}` : `received ${code}`);
    },
    async ownerMarksRefund(student, o = {}) {
      const refunds = world.upiRefunds(student);
      const refund = refunds.find((r) => r.code !== null) ?? refunds.at(-1);
      const code = o.code ?? refund?.code ?? refund?.usedCodes.at(-1);
      if (!code) throw new Error(`No refund owed for ${student}.`);
      if (o.tap) return world.tap(`upi-refunded:${code}`, { from: world.owner });
      return world.ownerSays(`refunded ${code}`);
    },
  };
  void MINUTE;
  return world;
}
