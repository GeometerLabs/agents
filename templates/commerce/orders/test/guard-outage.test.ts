// A Guard down under the Orders agent, through the real runtime. Orders has no stand-ins, so the fakes play the providers and `outage` plays the stopped Guard: the same
// decisions run, because each step's services are watched whether they are live or fake. The rule itself is tried in modules/runtime/test/guard-wait.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeClock } from "../../../../modules/core/clock.ts";
import { zonedToMs } from "../../../../modules/core/time.ts";
import { LANGUAGES } from "../../../../modules/language/languages.ts";
import { createFakeMessaging } from "../../../../modules/messaging/messaging.ts";
import { createGuardModel } from "../../../../modules/payments/guard-model.ts";
import { createFakePayments } from "../../../../modules/payments/payments.ts";
import { GUARD_WAIT_MS } from "../../../../modules/runtime/guard-wait.ts";
import { outage } from "../../../../modules/runtime/test/outage.ts";
import { createRuleParser } from "../src/adapters/rule-parser.ts";
import { AMIT, HARNESS_GUARD, annapurnaRazorpay } from "../src/harness.ts";
import { razorpayLimitsSpec } from "../src/guard-limits.ts";
import { META_TEMPLATE_NAMES } from "../src/language/meta-templates.ts";
import { TEMPLATE_NAMES } from "../src/language/templates.ts";
import { createRuntime } from "../server/runtime.ts";
import { openStore } from "../server/store.ts";

const settings = annapurnaRazorpay();
const START = zonedToMs({ year: 2026, month: 11, day: 9 }, { hour: 10, minute: 0 }, settings.timezone);
const ORDER = "2 veg thali 10 nov 12:00 pm pickup";

function world() {
  const dir = mkdtempSync(join(tmpdir(), "geo-orders-outage-"));
  const clock = fakeClock(START);
  const payments = createFakePayments(clock, { guard: createGuardModel(razorpayLimitsSpec(settings, HARNESS_GUARD), clock) });
  const messaging = createFakeMessaging(clock);
  for (const name of [...Object.values(TEMPLATE_NAMES), ...META_TEMPLATE_NAMES]) for (const l of LANGUAGES) messaging.approve(name, l);
  const paymentsOut = outage(payments, "Razorpay");
  const messagingOut = outage(messaging, "WhatsApp");
  const db = openStore(join(dir, "data"));
  const runtime = createRuntime({ settings, store: db, clock, services: { payments: paymentsOut.service, messaging: messagingOut.service }, parser: createRuleParser(), pathwayVersion: "0.1.0", retryDelaysMs: [0, 0, 0], guardLookAgainMs: [1_000] });
  const say = async (text: string) => { runtime.submit([{ kind: "message", message: messaging.receive(AMIT, text) }]); runtime.kick(); await runtime.idle(); };
  const run = async (advanceMs = 1_000) => { clock.advance(advanceMs); runtime.kick(); await runtime.idle(); };
  return { clock, payments, messaging, paymentsOut, messagingOut, runtime, db, say, run, cleanup: async () => { await runtime.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test("the Razorpay Guard down while a customer orders: nothing is said, and when it is back there is one link and one answer", async () => {
  const w = world();
  try {
    w.paymentsOut.down();
    await w.say(ORDER);
    assert.equal(w.messaging.sentTo(AMIT).length, 0);
    assert.equal(w.runtime.status().tasks.pending, 1);
    w.paymentsOut.up();
    await w.run();
    assert.equal(w.payments.links().length, 1);
    assert.equal(w.messaging.sentTo(AMIT).length, 1, "answered once");
    assert.deepEqual(w.runtime.status().tasks, { pending: 0, done: 1, failed: 0 });
  } finally { await w.cleanup(); }
});

test("the WhatsApp Guard down when the payment comes in: the order is confirmed once and the customer told once when it is back", async () => {
  const w = world();
  try {
    await w.say(ORDER);
    w.payments.customerPays(w.payments.links()[0].id);
    w.messagingOut.down();
    w.runtime.submit(w.payments.events.map((event) => ({ kind: "payment_event" as const, event })));
    w.runtime.kick();
    await w.runtime.idle();
    assert.ok(w.runtime.status().tasks.pending >= 1, "the work waits (Razorpay sends a payment two events)");
    assert.equal(w.messaging.sentTo(AMIT).length, 1, "the quote only");
    w.messagingOut.up();
    await w.run();
    assert.deepEqual(w.runtime.status().orders, { confirmed: 1 });
    assert.equal(w.messaging.sentTo(AMIT).length, 2, "the quote, then confirmed, once");
    assert.deepEqual([w.runtime.status().tasks.pending, w.runtime.status().tasks.failed], [0, 0]);
  } finally { await w.cleanup(); }
});

test("the Razorpay Guard down past the bound: the customer gets the shop's words for it, once", async () => {
  const w = world();
  try {
    w.paymentsOut.down();
    await w.say(ORDER);
    await w.run(GUARD_WAIT_MS);
    assert.equal(w.runtime.status().tasks.pending, 0);
    assert.equal(w.messaging.sentTo(AMIT).length, 1, "told once");
    assert.match(w.messaging.sentTo(AMIT)[0].text, /Sorry|माफ़/u);
  } finally { await w.cleanup(); }
});
