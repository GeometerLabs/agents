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
import { gatewayLimitsSpec } from "../src/guard-limits.ts";
import { META_TEMPLATE_NAMES } from "../src/language/meta-templates.ts";
import { TEMPLATE_NAMES } from "../src/language/templates.ts";
import { compactFinishedOrders, takenOf } from "../src/order.ts";
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
    const payments = createFakePayments(clock, { guard: createGuardModel(gatewayLimitsSpec(settings, HARNESS_GUARD), clock) });
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

test("a delivery address, as the customer wrote it, is taken off an order that is over and whose slot ended before the cutoff; its place on the list stays", () => {
  const order = (id: string, state: string, slotEndMs: number | undefined) => ({ id, customer: AMIT, language: "en", state, lines: [], dateNeedsConfirmation: false, awaitingAddress: false, handledPayments: [], pending: [], area: "Indiranagar", address: "12, 3rd Cross, Indiranagar", ...(slotEndMs !== undefined ? { slotEndMs } : {}) });
  const store = { orders: new Map([["o-1", order("o-1", "completed", 1_000)], ["o-2", order("o-2", "confirmed", 1_000)], ["o-3", order("o-3", "cancelled", 5_000)], ["o-4", order("o-4", "expired", 1_000)], ["o-5", order("o-5", "completed", undefined)]]) } as never;
  assert.equal(compactFinishedOrders(store, 2_000), 2);
  const left = [...(store as { orders: Map<string, { id: string; address?: string; area?: string }> }).orders.values()].map((o) => [o.id, o.address !== undefined, o.area]);
  assert.deepEqual(left, [["o-1", false, "Indiranagar"], ["o-2", true, "Indiranagar"], ["o-3", true, "Indiranagar"], ["o-4", false, "Indiranagar"], ["o-5", true, "Indiranagar"]], "an order still being done, one whose slot is recent, and one with no slot keep it");
  assert.equal(compactFinishedOrders(store, 2_000), 0, "nothing twice");
});

// Item 11h touched the refund context (a page order names the number its customer typed): every field the approvals relay words its ask with must still be there.
test("a refund Guard holds is found from its receipt with the shop's zone, the owner's language and the customer's number", async () => {
  const dir = mkdtempSync(join(tmpdir(), "geo-orders-refund-context-"));
  const db = openStore(join(dir, "data"));
  try {
    const clock = fakeClock(START);
    const guard = createGuardModel(gatewayLimitsSpec(settings, HARNESS_GUARD), clock);
    const payments = createFakePayments(clock, { guard });
    const messaging = createFakeMessaging(clock);
    for (const name of [...Object.values(TEMPLATE_NAMES), ...META_TEMPLATE_NAMES]) for (const l of LANGUAGES) messaging.approve(name, l);
    const runtime = createRuntime({ settings, store: db, clock, services: { payments, messaging }, parser: createRuleParser(), pathwayVersion: "0.1.0", retryDelaysMs: [0, 0, 0] });
    const say = async (text: string) => { runtime.submit([{ kind: "message", message: messaging.receive(AMIT, text) }]); runtime.kick(); await runtime.idle(); };
    await say("4 chicken meal 10 nov 12:00 pm pickup");
    payments.customerPays(payments.links()[0].id);
    runtime.submit(payments.events.map((event) => ({ kind: "payment_event" as const, event })));
    runtime.kick();
    await runtime.idle();
    assert.deepEqual(runtime.status().orders, { confirmed: 1 });
    await say("cancel");
    const held = guard.reviews(`runtime-${HARNESS_GUARD.tenant}`, true);
    assert.equal(held.length, 1, "the advance is above the shop's refund limit, so Guard holds its refund for the owner");
    const receipt = held[0].arguments[1].receipt?.[1] as string;
    const context = runtime.refundContext(receipt);
    assert.ok(context);
    assert.equal(context.timeZone, settings.timezone);
    assert.equal(context.ownerLanguage, settings.owner.language);
    assert.equal(context.customerPhone, AMIT, "a WhatsApp order's customer is their number");
    assert.equal(context.amountPaise, Number(held[0].amount));
    await runtime.close();
  } finally { try { db.close(); } catch { /* closed with the runtime */ } rmSync(dir, { recursive: true, force: true }); }
});
