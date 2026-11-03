// A runtime on a temp directory, wired to the in-memory fakes and a fake clock, for the server tests. The fakes stand for the
// outside world (they keep their state when the runtime is "restarted"); everything the runtime owns lives in the directory.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakeCalendar } from "../src/adapters/calendar.ts";
import { createFakeMessaging } from "../src/adapters/messaging.ts";
import type { InboundMessage } from "../src/adapters/messaging.ts";
import { createRuleParser } from "../src/adapters/rule-parser.ts";
import { createFakePayments } from "../src/adapters/payments.ts";
import type { PaymentLink } from "../src/adapters/payments.ts";
import { fakeClock } from "../src/clock.ts";
import { CUSTOMER, glowSalon } from "../src/harness.ts";
import { TEMPLATE_NAMES } from "../src/language/templates.ts";
import { LANGUAGES } from "../src/settings.ts";
import { zonedToMs } from "../src/time.ts";
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
  linkFor(ref: string): PaymentLink | undefined;
  cleanup(): void;
}

export function createKit(): Kit {
  const dir = mkdtempSync(join(tmpdir(), "geo-runtime-"));
  const settings = glowSalon();
  const clock = fakeClock(START);
  const calendar = createFakeCalendar();
  const payments = createFakePayments(clock);
  const messaging = createFakeMessaging(clock);
  for (const name of Object.values(TEMPLATE_NAMES)) for (const language of LANGUAGES) messaging.approve(name, language);
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
