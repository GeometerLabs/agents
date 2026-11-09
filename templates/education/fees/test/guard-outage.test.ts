// A Guard down under the Fees agent, through the real runtime: a parent's payment waits for the Razorpay Guard and is counted once when it is back; a parent's question waits
// for the WhatsApp Guard and is answered once. The rule itself is tried in modules/runtime/test/guard-wait.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { zonedToMs } from "../../../../modules/core/time.ts";
import { GUARD_WAIT_MS } from "../../../../modules/runtime/guard-wait.ts";
import { outage } from "../../../../modules/runtime/test/outage.ts";
import { PARENT, createKit } from "./runtime-kit.ts";

function outageKit() {
  const kit = createKit();
  const payments = outage(kit.payments, "Razorpay");
  const messaging = outage(kit.messaging, "WhatsApp");
  const { runtime, db } = kit.open({ services: { payments: payments.service, messaging: messaging.service }, guardLookAgainMs: [1_000] });
  const run = async (advanceMs = 1_000) => { kit.clock.advance(advanceMs); runtime.kick(); await runtime.idle(); };
  return { kit, runtime, db, payments, messaging, run };
}

/** Reminder time on the 2nd: the fees exist and their links are out. */
async function remindersOut(o: ReturnType<typeof outageKit>) {
  await o.runtime.tick();
  o.kit.clock.set(zonedToMs({ year: 2026, month: 11, day: 2 }, { hour: 10, minute: 0 }, "Asia/Kolkata"));
  await o.runtime.tick();
}

test("the Razorpay Guard down when a fee is paid: the payment's work waits, and the fee is counted and the parent thanked once when it is back", async () => {
  const o = outageKit();
  try {
    await remindersOut(o);
    const before = o.kit.messaging.outbox().length;
    const link = o.kit.payments.links()[0];
    o.kit.payments.customerPays(link.id);
    o.payments.down();
    await o.kit.deliverPaymentEvents(o.runtime);
    assert.ok(o.runtime.status().tasks.pending >= 1, "the payment's work waits");
    assert.equal(o.kit.messaging.outbox().length, before, "no receipt on an unread payment");
    o.payments.up();
    await o.run();
    await o.run();
    assert.equal(o.runtime.status().tasks.pending, 0);
    assert.equal(o.kit.messaging.outbox().length, before + 1, "one receipt");
    assert.equal(o.runtime.status().tasks.failed, 0);
  } finally { await o.runtime.close(); o.kit.cleanup(); }
});

test("the WhatsApp Guard down when a parent writes: answered once when it is back, and past the bound the parent is not left to a later outage", async () => {
  const o = outageKit();
  try {
    await remindersOut(o);
    const before = o.kit.messaging.outbox().length;
    o.messaging.down();
    await o.kit.say(o.runtime, "hello", { id: "wamid.waits" });
    assert.equal(o.kit.messaging.outbox().length, before);
    assert.equal(o.runtime.status().tasks.pending, 1);
    o.messaging.up();
    await o.run();
    assert.equal(o.kit.messaging.outbox().length, before + 1, "answered once");
    assert.equal(o.kit.messaging.sentTo(PARENT).length >= 1, true);

    o.messaging.down();
    await o.kit.say(o.runtime, "hello again", { id: "wamid.gone" });
    await o.run(GUARD_WAIT_MS);
    assert.equal(o.runtime.status().tasks.pending, 0, "the bound ends the wait");
    assert.equal(o.kit.messaging.outbox().length, before + 1, "and with WhatsApp down nothing reached the parent");
  } finally { await o.runtime.close(); o.kit.cleanup(); }
});
