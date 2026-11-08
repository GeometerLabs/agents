// The Orders runtime keeps the agent honest across restarts: steps are saved whole and picked up again after a restart, and the order store round-trips. The shared parts (the
// queue, the retries) are tried through Bookings and Fees; what is Orders' own is tried here: a store of orders, the stock worked out from them, and the status counts.
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
import { createRuleParser } from "../src/adapters/rule-parser.ts";
import { AMIT, HARNESS_GUARD, annapurnaRazorpay, createWorld } from "../src/harness.ts";
import { razorpayLimitsSpec } from "../src/guard-limits.ts";
import { META_TEMPLATE_NAMES } from "../src/language/meta-templates.ts";
import { TEMPLATE_NAMES } from "../src/language/templates.ts";
import { takenOf } from "../src/order.ts";
import { createRuntime } from "../server/runtime.ts";
import { openStore } from "../server/store.ts";
import { parseStore, serializeStore } from "../server/snapshot.ts";
import { zonedToMs } from "../../../../modules/core/time.ts";

const settings = annapurnaRazorpay();
const START = zonedToMs({ year: 2026, month: 11, day: 9 }, { hour: 10, minute: 0 }, settings.timezone);

test("an order paid after a restart ends exactly as it does in the in-memory harness; the stock is worked out from the saved orders", async () => {
  const dir = mkdtempSync(join(tmpdir(), "geo-orders-runtime-"));
  const opened: ReturnType<typeof openStore>[] = [];
  try {
    const clock = fakeClock(START);
    const payments = createFakePayments(clock, { guard: createGuardModel(razorpayLimitsSpec(settings, HARNESS_GUARD), clock) });
    const messaging = createFakeMessaging(clock);
    for (const name of [...Object.values(TEMPLATE_NAMES), ...META_TEMPLATE_NAMES]) for (const l of LANGUAGES) messaging.approve(name, l);
    const open = () => { const db = openStore(join(dir, "data")); opened.push(db); return { db, runtime: createRuntime({ settings, store: db, clock, services: { payments, messaging }, parser: createRuleParser(), pathwayVersion: "0.1.0", retryDelaysMs: [0, 0, 0] }) }; };
    const say = async (runtime: ReturnType<typeof open>["runtime"], text: string) => { runtime.submit([{ kind: "message", message: messaging.receive(AMIT, text) }]); runtime.kick(); await runtime.idle(); };

    const first = open();
    await say(first.runtime, "2 veg thali 10 nov 12:00 pm pickup");
    assert.deepEqual(first.runtime.status().orders, { awaiting_advance: 1 });
    first.db.close(); // the process is gone

    const second = open();
    payments.customerPays(payments.links()[0].id);
    second.runtime.submit(payments.events.map((event) => ({ kind: "payment_event" as const, event })));
    second.runtime.kick();
    await second.runtime.idle();
    assert.deepEqual(second.runtime.status().orders, { confirmed: 1 });

    const w = createWorld({ settings });
    await w.say("2 veg thali 10 nov 12:00 pm pickup");
    w.pays(AMIT);
    await w.deliverPaymentEvents();
    const saved = second.db.loadState();
    assert.deepEqual(saved.record, w.record.entries());
    assert.equal(saved.snapshot, serializeStore(w.store));
    assert.deepEqual(messaging.outbox(), w.messaging.outbox());
    const restored = parseStore(saved.snapshot);
    assert.equal(takenOf(restored, w.orderOf(AMIT)!.date!, "veg-thali", START), 2, "stock comes from the orders, so nothing can drift on a restart");
  } finally { for (const db of opened) { try { db.close(); } catch { /* already closed */ } } rmSync(dir, { recursive: true, force: true }); }
});

test("the order store round-trips every field, and a UPI shop's ledger with it", async () => {
  const w = createWorld();
  await w.say("2 veg thali 10 nov 12:00 pm pickup");
  const again = parseStore(serializeStore(w.store));
  assert.deepEqual(JSON.parse(JSON.stringify([...again.orders])), JSON.parse(JSON.stringify([...w.store.orders])), "every field a saved order has comes back");
  assert.equal(again.nextOrder, w.store.nextOrder);
  assert.deepEqual(again.upi, w.store.upi);
});
