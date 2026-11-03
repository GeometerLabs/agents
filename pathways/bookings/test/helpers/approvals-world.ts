// A runtime (the real server over the fakes), a stub Guard speaking Guard's admin routes over HTTP, the real approvals relay, and a fake WhatsApp, all
// sharing one clock and one Guard model. The shop's refund limit is ₹100 and its deposit ₹200, so cancelling a paid booking in time is a refund
// Guard holds for the owner. Tests drive it as the customer, the owner and the clock do; nothing here leaves this computer.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGuardModel } from "../../src/adapters/guard-model.ts";
import type { GuardModel } from "../../src/adapters/guard-model.ts";
import { createFakeMessaging } from "../../src/adapters/messaging.ts";
import type { FakeMessaging } from "../../src/adapters/messaging.ts";
import { createFakePayments } from "../../src/adapters/payments.ts";
import type { FakePayments } from "../../src/adapters/payments.ts";
import { fakeClock } from "../../src/clock.ts";
import type { FakeClock } from "../../src/clock.ts";
import { glowSalon, HARNESS_GUARD } from "../../src/harness.ts";
import type { RecordEntry } from "../../src/record.ts";
import { razorpayLimitsSpec } from "../../src/guard-limits.ts";
import { META_TEMPLATE_NAMES } from "../../src/language/meta-templates.ts";
import { TEMPLATE_NAMES } from "../../src/language/templates.ts";
import { LANGUAGES, parseSettings } from "../../src/settings.ts";
import type { Settings } from "../../src/settings.ts";
import { startServer } from "../../server/server.ts";
import type { RunningServer } from "../../server/server.ts";
import type { Runtime } from "../../server/runtime.ts";
import { startStubGuard } from "../../standins/guard.ts";
import type { RunningStubGuard } from "../../standins/guard.ts";
import { createGuardClient, createRuntimeClient } from "../../approvals/clients.ts";
import type { GuardClient, RuntimeClient } from "../../approvals/clients.ts";
import { createRelay } from "../../approvals/relay.ts";
import type { Relay, RelayOptions } from "../../approvals/relay.ts";
import { openRelayStore } from "../../approvals/store.ts";
import type { RelayStore } from "../../approvals/store.ts";
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
  close(): Promise<void>;
}

let nextId = 1;

export async function startApprovalsWorld(options: { refundLimitInr?: number; approvalTtlSeconds?: number; relay?: Partial<RelayOptions>; ownerLanguage?: "en" | "hi" | "ml" | "kn" } = {}): Promise<ApprovalsWorld> {
  const base = JSON.parse(JSON.stringify(glowSalon()));
  const settings = parseSettings({ ...base, cancellation: { windowHours: 24, refundLimitInr: options.refundLimitInr ?? 100 }, owner: { ...base.owner, language: options.ownerLanguage ?? base.owner.language } });
  const kit = createKit();
  const clock = kit.clock;
  const spec = razorpayLimitsSpec(settings, HARNESS_GUARD, options.approvalTtlSeconds !== undefined ? { approvalTtlSeconds: options.approvalTtlSeconds } : {});
  const model = createGuardModel(spec, clock);
  const payments = createFakePayments(clock, { guard: model });
  const lines: string[] = [];
  const { runtime, db } = kit.open({ settings, services: { calendar: kit.calendar, payments, messaging: kit.messaging }, log: (l) => lines.push(`runtime: ${l}`) });
  const runtimeServer = await startServer(runtime, { token: INTERNAL_TOKEN, port: 0 });
  const guard = await startStubGuard({ clock, upstreamUrl: "http://127.0.0.1:1", spec, model, agentId: AGENT_ID, approver: { id: APPROVER_ID, secret: OWNER_SECRET }, readToken: READ_TOKEN });
  const guardClient = createGuardClient({ adminUrl: guard.adminUrl, readToken: READ_TOKEN, approverId: APPROVER_ID, approverSecret: OWNER_SECRET, now: () => clock.now() });
  const runtimeClient = createRuntimeClient({ url: runtimeServer.url, token: INTERNAL_TOKEN });
  const whatsapp = createFakeMessaging(clock);
  for (const name of [...Object.values(TEMPLATE_NAMES), ...META_TEMPLATE_NAMES]) for (const language of LANGUAGES) whatsapp.approve(name, language);
  const dir = mkdtempSync(join(tmpdir(), "geo-relay-"));
  const owner = settings.owner.whatsapp;
  const stores: RelayStore[] = [];
  const relays: Relay[] = [];

  function makeRelay(more: Partial<RelayOptions> = {}): Relay {
    const store = openRelayStore(dir);
    stores.push(store);
    const relay = createRelay({
      clock, store, guard: guardClient, runtime: runtimeClient, messaging: whatsapp, ownerWhatsapp: owner, expectedAgent: AGENT_ID,
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
