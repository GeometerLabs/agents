// The approvals relay's world: the Bookings agent (src/harness.ts createWorld, the same agent the demo runs) behind an in-process stand-in for the runtime's two routes the
// relay calls (the refund's context and the owner's decision, `runtimeClient` below), a stub Guard speaking Guard's admin routes over HTTP, the real approvals relay, and a fake
// WhatsApp, all sharing one clock and one Guard model. The shop's refund limit is ₹100 and its deposit ₹200, so cancelling a paid booking in time is a refund Guard holds for
// the owner. Tests drive it as the customer, the owner and the clock do; nothing here leaves this computer.
// Until 24 Nov 2026 the runtime here was the TypeScript server (server/runtime.ts over HTTP). That runtime was deleted when the shops moved to the Go program (decision 61);
// the Go runtime's side of these two routes is held by contract/limits-approvals.contract.test.ts, so this world keeps only what the relay needs of a runtime: the agent's
// own handling of each event (deduplicated by the runtime's event key, as the runtime saved each once) and the refund context the runtime read from the agent's store.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGuardModel } from "../../../../../modules/payments/guard-model.ts";
import type { GuardModel } from "../../../../../modules/payments/guard-model.ts";
import { createFakeMessaging } from "../../../../../modules/messaging/messaging.ts";
import type { FakeMessaging } from "../../../../../modules/messaging/messaging.ts";
import type { FakePayments } from "../../../../../modules/payments/payments.ts";
import type { FakeClock } from "../../../../../modules/core/clock.ts";
import { createWorld, glowSalon, HARNESS_GUARD } from "../../src/harness.ts";
import type { World } from "../../src/harness.ts";
import { serviceName } from "../../src/settings.ts";
import { createGuardClient } from "../../../../../modules/approvals/clients.ts";
import type { GuardClient, RefundContext, RuntimeClient } from "../../../../../modules/approvals/clients.ts";
import type { IncomingEvent } from "../../../../../modules/runtime/events.ts";
import { agentRuntime, countRefunds, inProcessRuntimeClient } from "../../../../../modules/test/agent-runtime.ts";
import { createAgent } from "../../src/agent.ts";
import { createRuleParser } from "../../src/adapters/rule-parser.ts";
import { createFakeCalendar } from "../../src/adapters/calendar.ts";
import { createStore } from "../../src/booking.ts";
import { createRecord } from "../../../../../modules/record/record.ts";
import { fakeClock } from "../../../../../modules/core/clock.ts";
import { zonedToMs } from "../../../../../modules/core/time.ts";
import type { Payments } from "../../../../../modules/payments/payments.ts";
import type { AgentRuntime, RefundCounts } from "../../../../../modules/test/agent-runtime.ts";
import type { RecordEntry } from "../../../../../modules/record/record.ts";
import { gatewayLimitsSpec } from "../../src/guard-limits.ts";
import { META_TEMPLATE_NAMES } from "../../src/language/meta-templates.ts";
import { TEMPLATE_NAMES } from "../../src/language/templates.ts";
import { parseSettings } from "../../src/settings.ts";
import { LANGUAGES } from "../../../../../modules/language/languages.ts";
import type { Settings } from "../../src/settings.ts";
import { startStubGuard } from "../../../../../modules/standins/guard.ts";
import type { RunningStubGuard } from "../../../../../modules/standins/guard.ts";
import { createRelay } from "../../approvals/relay.ts";
import type { Relay } from "../../../../../modules/approvals/relay.ts";
import type { RelayOptions } from "../../approvals/relay.ts";
import { openRelayStore } from "../../../../../modules/approvals/store.ts";
import type { RelayStore } from "../../../../../modules/approvals/store.ts";

export const INTERNAL_TOKEN = "internal-token-0123456789abcdef";
export const READ_TOKEN = "gg_reading-credential-0123456789";
export const OWNER_SECRET = "owner-notify-secret-0123456789abcdef";
export const APPROVER_ID = "owner-glow-salon";
export const AGENT_ID = "runtime-glow-salon";

/** What the tests ask of the agent's side, in the words the TypeScript runtime had: a customer's words, the messages the agent sent, its calendar. */
export interface AgentKit {
  /** A customer (or the owner) writes to the shop's number and the agent handles it (`runtime` is the world's runtime, as before). */
  say(runtime: WorldRuntime, text: string, options?: { from?: string }): Promise<void>;
  messaging: World["messaging"];
  calendar: World["calendar"];
}

/** The runtime as these tests drive it (modules/test/agent-runtime.ts), with the refund counts its /status gave. */
export interface WorldRuntime extends AgentRuntime { status(): { refunds: RefundCounts } }

export interface ApprovalsWorld {
  kit: AgentKit;
  agent: World;
  settings: Settings;
  clock: FakeClock;
  owner: string;
  model: GuardModel;
  payments: FakePayments;
  runtime: WorldRuntime;
  guard: RunningStubGuard;
  guardClient: GuardClient;
  runtimeClient: RuntimeClient;
  whatsapp: FakeMessaging;
  store: RelayStore;
  relay: Relay;
  lines: string[];
  /** The agent's action record. */
  record(): readonly RecordEntry[];
  /** The relay, restarted over the same data (a crash and a start). */
  restartRelay(more?: Partial<RelayOptions>): Relay;
  /** A customer books, pays and cancels in time: a ₹200 refund, above the ₹100 limit, which Guard holds. Returns the approval's id. */
  heldRefund(who?: string): Promise<string>;
  /** The owner writes to the number: the inbox gives the relay its copy and the runtime its copy, as it does. */
  ownerWrites(text: string, options?: { id?: string; from?: string }): Promise<void>;
  /** Everything the owner has been sent, oldest first. */
  toOwner(): { kind: string; templateName?: string; text: string }[];
  /** This world's payment webhooks reach the runtime (the kit's own `deliverPaymentEvents` delivers the kit's fake's, not this world's). */
  deliverPayments(): Promise<void>;
  /** B37: one of the other approvers writes from their own number (to the relay and the runtime, as the inbox gives both a copy). */
  personWrites(id: string, text: string, options?: { from?: string }): Promise<void>;
  /** B37: everything that person has been sent. */
  toPerson(id: string): { kind: string; templateName?: string; text: string }[];
  close(): Promise<void>;
}

let nextId = 1;

/** B37: the shop's other approvers for a world that has them: Ravi (Hindi) and Meena (English), and above ₹150 two different people must approve. */
export const RAVI = { id: "ravi", whatsapp: "+919800000002", language: "hi" as const };
export const MEENA = { id: "meena", whatsapp: "+919800000003", language: "en" as const };
export const SECRET_OF: Record<string, string> = { ravi: "ravi-notify-secret-0123456789abcdef", meena: "meena-notify-secret-0123456789abcdef" };
export const READER_ID = "relay-glow-salon";

/** `olderGuard`: the stand-in behaves as a Guard from before 12 Nov 2026, holding the identical call again after a no (guard-model.ts). */
export async function startApprovalsWorld(options: { refundLimitInr?: number; approvalTtlSeconds?: number; relay?: Partial<RelayOptions>; ownerLanguage?: "en" | "hi" | "ml" | "kn"; group?: { people?: typeof RAVI[]; twoAboveInr?: number }; olderGuard?: boolean } = {}): Promise<ApprovalsWorld> {
  const base = JSON.parse(JSON.stringify(glowSalon()));
  const people = options.group ? options.group.people ?? [RAVI, MEENA] : [];
  const approvers = options.group ? { approvers: { people, ...(options.group.twoAboveInr !== undefined ? { twoAboveInr: options.group.twoAboveInr } : {}) } } : {};
  const settings = parseSettings({ ...base, cancellation: { windowHours: 24, refundLimitInr: options.refundLimitInr ?? 100 }, owner: { ...base.owner, language: options.ownerLanguage ?? base.owner.language }, ...approvers });
  // the model and the agent share the world's clock; the agent's world is made after the model, so the model reads the clock through it
  const clockOf = { now: () => agent.clock.now() };
  const spec = gatewayLimitsSpec(settings, HARNESS_GUARD, options.approvalTtlSeconds !== undefined ? { approvalTtlSeconds: options.approvalTtlSeconds } : {});
  // with other approvers the owner is `owner` in Guard's directory (bundle/generate/shop.ts ownerApproverId), as the runtime names them in Geo-Requested-By
  const ownerId = options.group ? "owner" : APPROVER_ID;
  const model = createGuardModel(spec, clockOf, { ...(options.group ? { approvers: { owner: ownerId, people: people.map((p) => p.id), ...(options.group.twoAboveInr !== undefined ? { twoAbovePaise: options.group.twoAboveInr * 100 } : {}), reader: READER_ID } } : {}), ...(options.olderGuard ? { olderGuard: true } : {}) });
  const agent: World = createWorld({ settings, payments: { guard: model } });
  const clock = agent.clock;
  const payments = agent.payments;
  const lines: string[] = [];
  // the queue calls whichever agent is current (renew() makes it again, as the runtime made it afresh for every step)
  const runtime: WorldRuntime = { ...agentRuntime({ handle: (e) => agent.agent.handle(e) }), status: () => ({ refunds: countRefunds(agent.store.bookings.values()) }) };
  const kit: AgentKit = {
    async say(rt, text, o = {}) { rt.submit([{ kind: "message", message: agent.messaging.receive(o.from ?? "+919811111111", text) }]); rt.kick(); await rt.idle(); },
    messaging: agent.messaging, calendar: agent.calendar,
  };
  // the two routes the relay calls, as the runtime answered them: the context of a held refund (from the agent's store) and the owner's decision (one more event)
  const runtimeClient = inProcessRuntimeClient(runtime, (receipt) => bookingsRefundContext(agent.settings, agent.store, receipt));
  const guard = await startStubGuard({ clock, upstreamUrl: "http://127.0.0.1:1", spec, model, agentId: AGENT_ID, approver: { id: ownerId, secret: OWNER_SECRET }, readToken: READ_TOKEN, others: people.map((p) => ({ id: p.id, secret: SECRET_OF[p.id]! })) });
  const guardClient = createGuardClient({ adminUrl: guard.adminUrl, readToken: READ_TOKEN, approverId: ownerId, approverSecret: OWNER_SECRET, now: () => clock.now(), ...(options.group ? { secretOf: (id: string) => SECRET_OF[id] } : {}) });
  const whatsapp = createFakeMessaging(clock);
  for (const name of [...Object.values(TEMPLATE_NAMES), ...META_TEMPLATE_NAMES]) for (const language of LANGUAGES) whatsapp.approve(name, language);
  const dir = mkdtempSync(join(tmpdir(), "geo-relay-"));
  const owner = settings.owner.whatsapp;
  const stores: RelayStore[] = [];
  const relays: Relay[] = [];
  let delivered = 0;

  function makeRelay(more: Partial<RelayOptions> = {}): Relay {
    const store = openRelayStore(dir);
    stores.push(store);
    const relay = createRelay({
      clock, store, guard: guardClient, runtime: runtimeClient, messaging: whatsapp, ownerWhatsapp: owner, expectedAgent: AGENT_ID,
      ...(options.group ? { approvers: people, ownerApproverId: ownerId } : {}),
      log: (l) => lines.push(`relay: ${l}`), ...options.relay, ...more,
    });
    relays.push(relay);
    world.store = store;
    return relay;
  }

  const world: ApprovalsWorld = {
    kit, agent, settings, clock, owner, model, payments, runtime, guard, guardClient, runtimeClient, whatsapp, lines, record: () => agent.record.entries(),
    store: undefined as unknown as RelayStore, relay: undefined as unknown as Relay,
    restartRelay(more) { world.relay = makeRelay(more); return world.relay; },
    async heldRefund(who = "+919811111111") {
      await kit.say(runtime, "haircut day after tomorrow at 6pm", { from: who });
      const link = payments.links().at(-1)!;
      payments.customerPays(link.id);
      await world.deliverPayments();
      await kit.say(runtime, "cancel my booking", { from: who });
      const held = model.reviews(AGENT_ID, true).at(-1);
      if (!held) throw new Error("the refund was not held");
      return held.id;
    },
    async ownerWrites(text, o = {}) {
      const message = whatsapp.receive(o.from ?? owner, text, { id: o.id ?? `wamid.owner-${nextId++}` });
      world.relay.receive([message]);
      runtime.submit([{ kind: "message", message }]); // the inbox gives the runtime its copy too
      runtime.kick();
      await world.relay.idle();
      await runtime.idle();
    },
    toOwner: () => whatsapp.sentTo(owner).map((m) => ({ kind: m.kind, templateName: m.templateName, text: m.text })),
    async deliverPayments() {
      const fresh = payments.events.slice(delivered);
      delivered = payments.events.length;
      runtime.submit(fresh.map((event) => ({ kind: "payment_event" as const, event } as IncomingEvent)));
      runtime.kick();
      await runtime.idle();
    },
    async personWrites(id, text, o = {}) {
      const person = people.find((p) => p.id === id);
      if (!person) throw new Error(`no approver ${id} in this world`);
      const message = whatsapp.receive(o.from ?? person.whatsapp, text, { id: `wamid.${id}-${nextId++}` });
      world.relay.receive([message]);
      runtime.submit([{ kind: "message", message }]);
      runtime.kick();
      await world.relay.idle();
      await runtime.idle();
    },
    toPerson: (id) => whatsapp.sentTo(people.find((p) => p.id === id)!.whatsapp).map((m) => ({ kind: m.kind, templateName: m.templateName, text: m.text })),
    async close() {
      for (const r of relays) await r.stop();
      for (const s of stores) s.close();
      await guard.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
  world.relay = makeRelay();
  return world;
}

/** What the Bookings runtime's /internal/refund-context answered for a held refund (the Go runtime's answer is held by contract/limits-approvals.contract.test.ts): the booking
 * behind the receipt, the service in the owner's language, the slot, and the hold's payment, amount, approval and expiry. */
export function bookingsRefundContext(settings: Settings, store: World["store"], receipt: string): RefundContext | null {
  const match = /^(b-\d+):/u.exec(receipt);
  const b = match ? store.bookings.get(match[1]) : undefined;
  const hold = b?.pending.find((p) => p.kind === "guard_hold" && p.receipt === receipt);
  if (!b || !hold || hold.kind !== "guard_hold" || b.startMs === undefined) return null;
  const service = settings.services.find((x) => x.id === b.serviceId);
  if (!service) return null;
  return {
    booking: b.id, customerPhone: b.contact?.phone ?? b.customer, businessName: settings.name, timeZone: settings.timezone,
    ownerLanguage: settings.owner.language, serviceName: serviceName(service, settings.owner.language), slotMs: b.startMs,
    paymentId: hold.paymentId, amountPaise: hold.amountInr * 100, approval: hold.approval, expiresAtMs: hold.expiresAtMs, ...(hold.requestedBy ? { requestedBy: hold.requestedBy } : {}),
  };
}

/** The Bookings agent over the fake calendar and WhatsApp on its own fake days (Tue 3 Nov 2026, 10:00), with `payments` (the live Razorpay adapter through the real Guard,
 * in the tests that run geo-guard), behind the runtime's queue, with the runtime's /status counts and the relay's two calls answered in process. */
export function bookingsAgent(settings: Settings, payments: Payments) {
  const clock = fakeClock(zonedToMs({ year: 2026, month: 11, day: 3 }, { hour: 10, minute: 0 }, settings.timezone));
  const messaging = createFakeMessaging(clock);
  for (const name of [...Object.values(TEMPLATE_NAMES), ...META_TEMPLATE_NAMES]) for (const language of LANGUAGES) messaging.approve(name, language);
  const store = createStore();
  const calendar = createFakeCalendar();
  const agent = createAgent({ settings, clock, calendar, payments, messaging, parser: createRuleParser(), record: createRecord(clock), store });
  const queue = agentRuntime(agent);
  const runtime = { ...queue, status: () => ({ bookings: { confirmed: [...store.bookings.values()].filter((b) => b.state === "confirmed").length }, refunds: countRefunds(store.bookings.values()) }) };
  const say = async (_r: unknown, text: string, o: { from?: string } = {}) => { runtime.submit([{ kind: "message", message: messaging.receive(o.from ?? "+919811111111", text) }]); runtime.kick(); await runtime.idle(); };
  return { clock, messaging, calendar, runtime, say, client: inProcessRuntimeClient(runtime, (receipt) => bookingsRefundContext(settings, store, receipt)) }
}
