// Two customers for the last item at the same moment: only one may get it (plan checkpoint item 8, 11 Nov 2026; docs/product/intent-and-outcomes.md, "Candidate failure
// tests"). Orders already holds stock in its own saved state: what is left of an item is worked out from the orders that hold it (src/order.ts, takenOf), and an order
// waiting for its advance holds its share until its hold ends. The runtime runs one step of a shop at a time (modules/runtime/tasks.ts), so the look at what is left and
// the hold are never split by another customer's step. These tests pin both, through the real runtime, with a menu that has one veg thali left.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeClock } from "../../../../modules/core/clock.ts";
import { LANGUAGES } from "../../../../modules/language/languages.ts";
import { createFakeMessaging } from "../../../../modules/messaging/messaging.ts";
import { createGuardModel } from "../../../../modules/payments/guard-model.ts";
import { createFakePayments } from "../../../../modules/payments/payments.ts";
import type { RuntimeEvent } from "../../../../modules/runtime/events.ts";
import { zonedToMs } from "../../../../modules/core/time.ts";
import { createRuleParser } from "../src/adapters/rule-parser.ts";
import { AMIT, HARNESS_GUARD, RAJESH, annapurnaRazorpay } from "../src/harness.ts";
import { gatewayLimitsSpec } from "../src/guard-limits.ts";
import { META_TEMPLATE_NAMES } from "../src/language/meta-templates.ts";
import { TEMPLATE_NAMES } from "../src/language/templates.ts";
import { createRuntime } from "../server/runtime.ts";
import type { RuntimeOptions } from "../server/runtime.ts";
import { openStore } from "../server/store.ts";

const ORDER = "1 veg thali 10 nov 12:00 pm pickup";

/** A runtime over the in-memory services, for a shop whose veg thali has one left for the day. */
function shop(options: Partial<RuntimeOptions> = {}) {
  const base = annapurnaRazorpay();
  const settings = { ...base, menu: base.menu.map((item) => (item.id === "veg-thali" ? { ...item, dailyStock: 1 } : item)) };
  const dir = mkdtempSync(join(tmpdir(), "geo-orders-last-"));
  const clock = fakeClock(zonedToMs({ year: 2026, month: 11, day: 9 }, { hour: 10, minute: 0 }, settings.timezone));
  const payments = createFakePayments(clock, { guard: createGuardModel(gatewayLimitsSpec(settings, HARNESS_GUARD), clock) });
  const messaging = createFakeMessaging(clock);
  for (const name of [...Object.values(TEMPLATE_NAMES), ...META_TEMPLATE_NAMES]) for (const l of LANGUAGES) messaging.approve(name, l);
  const db = openStore(join(dir, "data"));
  const runtime = createRuntime({ settings, store: db, clock, services: { payments, messaging }, parser: createRuleParser(), pathwayVersion: "0.1.0", retryDelaysMs: [0, 0, 0], ...options });
  const say = async (from: string) => { runtime.submit([{ kind: "message", message: messaging.receive(from, ORDER) }]); runtime.kick(); await runtime.idle(); };
  const told = (phone: string) => messaging.sentTo(phone).map((m) => m.text).join("\n");
  const close = async () => { await runtime.close(); db.close(); rmSync(dir, { recursive: true, force: true }); };
  return { runtime, db, clock, payments, messaging, say, told, close };
}

test("one message at a time: while one customer's step is half-way, the other customer's step has not started", async () => {
  let started = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const s = shop({
    async aroundStep(event: RuntimeEvent, run) {
      if (event.kind !== "message") return run();
      started++;
      if (started === 1) await held; // the first customer's step stops here, before it has worked out what is left
      return run();
    },
  });
  try {
    s.runtime.submit([{ kind: "message", message: s.messaging.receive(AMIT, ORDER) }, { kind: "message", message: s.messaging.receive(RAJESH, ORDER) }]);
    s.runtime.kick();
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
    assert.equal(started, 1, "the second step waits for the first to end");
    release();
    await s.runtime.idle();
    assert.equal(started, 2);
  } finally { await s.close(); }
});

test("two customers order the last veg thali at the same moment: one holds it, the other is told it is sold out", async () => {
  const s = shop();
  try {
    await Promise.all([s.say(AMIT), s.say(RAJESH)]);
    assert.deepEqual(s.runtime.status().orders, { awaiting_advance: 1, enquiry: 1 });
    assert.equal(s.payments.links().length, 1, "one advance link");
    assert.match(s.told(AMIT), /₹/u, "the first asked gets the quote and the link");
    assert.match(s.told(RAJESH), /sold out/u);
    const holds = s.db.loadState().record.filter((e) => e.action === "hold_stock" && e.outcome === "confirmed");
    assert.equal(holds.length, 1, "the record shows one hold of the stock");
  } finally { await s.close(); }
});

test("a hold nobody pays ends by itself: the last veg thali is free again for the next customer", async () => {
  const s = shop();
  try {
    await s.say(AMIT);
    s.clock.advance(31 * 60_000); // the advance's hold is 30 minutes
    await s.runtime.tick();
    assert.equal(s.runtime.status().orders.expired, 1);
    await s.say(RAJESH);
    assert.equal(s.runtime.status().orders.awaiting_advance, 1, "the next customer holds it");
    assert.doesNotMatch(s.told(RAJESH), /sold out/u);
  } finally { await s.close(); }
});
