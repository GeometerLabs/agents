// A runtime (the real server over the fakes), a stub Guard speaking Guard's admin routes over HTTP, the real approvals relay, and a fake WhatsApp, all
// sharing one clock and one Guard model. The shop's refund limit is ₹100 and its deposit ₹200, so cancelling a paid booking in time is a refund
// Guard holds for the owner. Tests drive it as the customer, the owner and the clock do; nothing here leaves this computer.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGuardModel } from "../../../../../modules/payments/guard-model.ts";
import type { GuardModel } from "../../../../../modules/payments/guard-model.ts";
import { createFakeMessaging } from "../../../../../modules/messaging/messaging.ts";
import type { FakeMessaging } from "../../../../../modules/messaging/messaging.ts";
import { createFakePayments } from "../../../../../modules/payments/payments.ts";
import type { FakePayments } from "../../../../../modules/payments/payments.ts";
import { fakeClock } from "../../../../../modules/core/clock.ts";
import type { FakeClock } from "../../../../../modules/core/clock.ts";
import { glowSalon, HARNESS_GUARD } from "../../src/harness.ts";
import type { RecordEntry } from "../../../../../modules/record/record.ts";
import { gatewayLimitsSpec } from "../../src/guard-limits.ts";
import { META_TEMPLATE_NAMES } from "../../src/language/meta-templates.ts";
import { TEMPLATE_NAMES } from "../../src/language/templates.ts";
import { parseSettings } from "../../src/settings.ts";
import { LANGUAGES } from "../../../../../modules/language/languages.ts";
import type { Settings } from "../../src/settings.ts";
import { startServer } from "../../server/server.ts";
import type { RunningServer } from "../../server/server.ts";
import type { Runtime } from "../../server/runtime.ts";
import { startStubGuard } from "../../../../../modules/standins/guard.ts";
import type { RunningStubGuard } from "../../../../../modules/standins/guard.ts";
import { createGuardClient, createRuntimeClient } from "../../../../../modules/approvals/clients.ts";
import type { GuardClient, RuntimeClient } from "../../../../../modules/approvals/clients.ts";
import { createRelay } from "../../approvals/relay.ts";
import type { Relay } from "../../../../../modules/approvals/relay.ts";
import type { RelayOptions } from "../../approvals/relay.ts";
import { openRelayStore } from "../../../../../modules/approvals/store.ts";
import type { RelayStore } from "../../../../../modules/approvals/store.ts";
import { createKit } from "../runtime-kit.ts";
import type { Kit } from "../runtime-kit.ts";

export const INTERNAL_TOKEN = "internal-token-0123456789abcdef";
export const READ_TOKEN = "gg_reading-credential-0123456789";
export const OWNER_SECRET = "owner-notify-secret-0123456789abcdef";
export const APPROVER_ID = "owner-glow-salon";
export const AGENT_ID = "runtime-glow-salon";

export interface ApprovalsWorld {
  kit: Kit;
  settings: Settings;
  clock: FakeClock;
  owner: string;
  model: GuardModel;
  payments: FakePayments;
  runtime: Runtime;
  runtimeServer: RunningServer;
  guard: RunningStubGuard;
  guardClient: GuardClient;
  runtimeClient: RuntimeClient;
  whatsapp: FakeMessaging;
  store: RelayStore;
  relay: Relay;
  lines: string[];
  /** The runtime's action record, as last saved. */
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

export async function startApprovalsWorld(options: { refundLimitInr?: number; approvalTtlSeconds?: number; relay?: Partial<RelayOptions>; ownerLanguage?: "en" | "hi" | "ml" | "kn"; group?: { people?: typeof RAVI[]; twoAboveInr?: number } } = {}): Promise<ApprovalsWorld> {
  const base = JSON.parse(JSON.stringify(glowSalon()));
  const people = options.group ? options.group.people ?? [RAVI, MEENA] : [];
  const approvers = options.group ? { approvers: { people, ...(options.group.twoAboveInr !== undefined ? { twoAboveInr: options.group.twoAboveInr } : {}) } } : {};
  const settings = parseSettings({ ...base, cancellation: { windowHours: 24, refundLimitInr: options.refundLimitInr ?? 100 }, owner: { ...base.owner, language: options.ownerLanguage ?? base.owner.language }, ...approvers });
  const kit = createKit();
  const clock = kit.clock;
  const spec = gatewayLimitsSpec(settings, HARNESS_GUARD, options.approvalTtlSeconds !== undefined ? { approvalTtlSeconds: options.approvalTtlSeconds } : {});
  // with other approvers the owner is `owner` in Guard's directory (bundle/generate/shop.ts ownerApproverId), as the runtime names them in Geo-Requested-By
  const ownerId = options.group ? "owner" : APPROVER_ID;
  const model = createGuardModel(spec, clock, options.group ? { approvers: { owner: ownerId, people: people.map((p) => p.id), ...(options.group.twoAboveInr !== undefined ? { twoAbovePaise: options.group.twoAboveInr * 100 } : {}), reader: READER_ID } } : {});
  const payments = createFakePayments(clock, { guard: model });
  const lines: string[] = [];
  const { runtime, db } = kit.open({ settings, services: { calendar: kit.calendar, payments, messaging: kit.messaging }, log: (l) => lines.push(`runtime: ${l}`) });
  const runtimeServer = await startServer(runtime, { token: INTERNAL_TOKEN, port: 0 });
  const guard = await startStubGuard({ clock, upstreamUrl: "http://127.0.0.1:1", spec, model, agentId: AGENT_ID, approver: { id: ownerId, secret: OWNER_SECRET }, readToken: READ_TOKEN, others: people.map((p) => ({ id: p.id, secret: SECRET_OF[p.id]! })) });
  const guardClient = createGuardClient({ adminUrl: guard.adminUrl, readToken: READ_TOKEN, approverId: ownerId, approverSecret: OWNER_SECRET, now: () => clock.now(), ...(options.group ? { secretOf: (id: string) => SECRET_OF[id] } : {}) });
  const runtimeClient = createRuntimeClient({ url: runtimeServer.url, token: INTERNAL_TOKEN });
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
    kit, settings, clock, owner, model, payments, runtime, runtimeServer, guard, guardClient, runtimeClient, whatsapp, lines, record: () => db.loadState().record,
    store: undefined as unknown as RelayStore, relay: undefined as unknown as Relay,
    restartRelay(more) { world.relay = makeRelay(more); return world.relay; },
    async heldRefund(who = "+919811111111") {
      await kit.say(runtime, "haircut day after tomorrow at 6pm", { from: who });
      const link = payments.links().at(-1)!;
      payments.customerPays(link.id);
      await kit.deliverPaymentEvents(runtime);
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
      runtime.submit(fresh.map((event) => ({ kind: "payment_event" as const, event })));
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
      await runtimeServer.close();
      await runtime.close();
      kit.cleanup();
      rmSync(dir, { recursive: true, force: true });
    },
  };
  world.relay = makeRelay();
  return world;
}
