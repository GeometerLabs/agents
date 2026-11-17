// A runtime on a temp directory, wired to the in-memory fakes and a fake clock, for the tests that need the server and not only the agent (the real-Guard test). The fakes
// stand for the outside world (they keep their state when the runtime is "restarted"); everything the runtime owns lives in the directory. Same shape as Fees' kit.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeClock } from "../../../../modules/core/clock.ts";
import { zonedToMs } from "../../../../modules/core/time.ts";
import { LANGUAGES } from "../../../../modules/language/languages.ts";
import { createFakeMessaging } from "../../../../modules/messaging/messaging.ts";
import type { InboundMessage } from "../../../../modules/messaging/messaging.ts";
import { createGuardModel } from "../../../../modules/payments/guard-model.ts";
import { createFakePayments } from "../../../../modules/payments/payments.ts";
import type { PaymentRequest } from "../../../../modules/payments/payments.ts";
import { createRuleParser } from "../src/adapters/rule-parser.ts";
import { AMIT, HARNESS_GUARD, annapurnaRazorpay } from "../src/harness.ts";
import { gatewayLimitsSpec } from "../src/guard-limits.ts";
import { META_TEMPLATE_NAMES } from "../src/language/meta-templates.ts";
import { TEMPLATE_NAMES } from "../src/language/templates.ts";
import type { Settings } from "../src/settings.ts";
import { createRuntime } from "../server/runtime.ts";
import type { Runtime, RuntimeOptions } from "../server/runtime.ts";
import { openStore } from "../server/store.ts";
import type { DurableStore } from "../server/store.ts";

/** Mon 9 Nov 2026, 10:00 in India: today's lunch has closed (09:00), so an order for 10 Nov is well inside the six-hour cancellation window. */
export const START = zonedToMs({ year: 2026, month: 11, day: 9 }, { hour: 10, minute: 0 }, "Asia/Kolkata");
export const CUSTOMER = AMIT;

export interface Kit {
  dir: string;
  settings: Settings;
  clock: ReturnType<typeof fakeClock>;
  payments: ReturnType<typeof createFakePayments>;
  messaging: ReturnType<typeof createFakeMessaging>;
  /** Open the directory as a new runtime (not started). Everything opened is closed by `cleanup`. */
  open(options?: Partial<RuntimeOptions>): { runtime: Runtime; db: DurableStore };
  /** A customer writes: the message is saved, the queue runs, and this returns when it is idle. */
  say(runtime: Runtime, text: string, options?: { from?: string; id?: string }): Promise<InboundMessage>;
  /** The payment provider's webhooks that were not delivered yet reach the runtime, and it handles them. */
  deliverPaymentEvents(runtime: Runtime): Promise<void>;
  linkFor(ref: string): PaymentRequest | undefined;
  cleanup(): void;
}

/** `settings` is the Razorpay example unless the test gives its own (a lower refund limit, say). */
export function createKit(settings: Settings = annapurnaRazorpay()): Kit {
  const dir = mkdtempSync(join(tmpdir(), "geo-orders-runtime-"));
  const clock = fakeClock(START);
  const payments = createFakePayments(clock, { guard: createGuardModel(gatewayLimitsSpec(settings, HARNESS_GUARD), clock) });
  const messaging = createFakeMessaging(clock);
  for (const name of [...Object.values(TEMPLATE_NAMES), ...META_TEMPLATE_NAMES]) for (const language of LANGUAGES) messaging.approve(name, language);
  const opened: { runtime: Runtime; db: DurableStore }[] = [];
  let delivered = 0;

  const kit: Kit = {
    dir, settings, clock, payments, messaging,
    open(options = {}) {
      const db = openStore(join(dir, "data"));
      const runtime = createRuntime({ settings, store: db, clock, services: { payments, messaging }, parser: createRuleParser(), pathwayVersion: "0.1.0", retryDelaysMs: [0, 0, 0], ...options });
      const both = { runtime, db };
      opened.push(both);
      return both;
    },
    async say(runtime, text, o = {}) {
      const message = messaging.receive(o.from ?? CUSTOMER, text, o.id ? { id: o.id } : {});
      runtime.submit([{ kind: "message", message }]);
      runtime.kick();
      await runtime.idle();
      return message;
    },
    async deliverPaymentEvents(runtime) {
      const fresh = payments.events.slice(delivered);
      delivered = payments.events.length;
      runtime.submit(fresh.map((event) => ({ kind: "payment_event" as const, event })));
      runtime.kick();
      await runtime.idle();
    },
    linkFor: (ref) => payments.links().find((l) => l.reference_id === ref),
    cleanup() {
      for (const { db } of opened) db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
  return kit;
}
