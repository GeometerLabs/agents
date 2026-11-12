// A runtime on a temp directory, wired to the in-memory fakes and a fake clock, for the server tests. The fakes stand for the
// outside world (they keep their state when the runtime is "restarted"); everything the runtime owns lives in the directory.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakeCalendar } from "../src/adapters/calendar.ts";
import { createFakeMessaging } from "../../../../modules/messaging/messaging.ts";
import type { InboundMessage } from "../../../../modules/messaging/messaging.ts";
import { createRuleParser } from "../src/adapters/rule-parser.ts";
import { createFakePayments } from "../../../../modules/payments/payments.ts";
import type { PaymentRequest } from "../../../../modules/payments/payments.ts";
import { fakeClock } from "../../../../modules/core/clock.ts";
import { CUSTOMER, glowSalon } from "../src/harness.ts";
import { META_TEMPLATE_NAMES } from "../src/language/meta-templates.ts";
import { TEMPLATE_NAMES } from "../src/language/templates.ts";
import { LANGUAGES } from "../../../../modules/language/languages.ts";
import { zonedToMs } from "../../../../modules/core/time.ts";
import { createRuntime } from "../server/runtime.ts";
import type { Runtime, RuntimeOptions } from "../server/runtime.ts";
import { openStore } from "../server/store.ts";
import type { DurableStore } from "../server/store.ts";

export const START = zonedToMs({ year: 2026, month: 11, day: 3 }, { hour: 10, minute: 0 }, "Asia/Kolkata"); // Tue 3 Nov 2026, 10:00 in India

export interface Kit {
  dir: string;
  settings: ReturnType<typeof glowSalon>;
  clock: ReturnType<typeof fakeClock>;
  calendar: ReturnType<typeof createFakeCalendar>;
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

/** `notApproved`: template names Meta has not approved yet (a test of what happens until it does; approve them later with `kit.messaging.approve`). */
export function createKit(o: { notApproved?: readonly string[] } = {}): Kit {
  const dir = mkdtempSync(join(tmpdir(), "geo-runtime-"));
  const settings = glowSalon();
  const clock = fakeClock(START);
  const calendar = createFakeCalendar();
  const payments = createFakePayments(clock);
  const messaging = createFakeMessaging(clock);
  // Every template the shop submits to Meta is approved here, the generic ones and the specific ones (src/language/meta-templates.ts), as in src/harness.ts: outside
  // the 24-hour window the agent sends the specific one (deposit_refund_confirmed and the like), and a kit that approved only the generic three would refuse it.
  for (const name of [...Object.values(TEMPLATE_NAMES), ...META_TEMPLATE_NAMES]) if (!o.notApproved?.includes(name)) for (const language of LANGUAGES) messaging.approve(name, language);
  const opened: { runtime: Runtime; db: DurableStore }[] = [];
  let delivered = 0;

  const kit: Kit = {
    dir, settings, clock, calendar, payments, messaging,
    open(options = {}) {
      const db = openStore(join(dir, "data"));
      const runtime = createRuntime({ settings, store: db, clock, services: { calendar, payments, messaging }, parser: createRuleParser(), pathwayVersion: "0.1.0", retryDelaysMs: [0, 0, 0], ...options });
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
