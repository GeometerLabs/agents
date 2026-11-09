// A real Razorpay payment.captured names the payment and its order, not the payment link. The agent must still find the booking.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld } from "../src/harness.ts";
import type { PaymentEvent } from "../../../../modules/payments/payments.ts";

test("a payment.captured with no link id still reaches its booking (and a second payment on a paid link is refunded)", async () => {
  const w = createWorld();
  await w.say("haircut tomorrow at 6pm");
  const linkId = w.linkFor("b-1")!.id;
  const first = w.payments.customerPays(linkId);
  const second = w.payments.customerPays(linkId);
  // what a real webhook says: the payment id only
  const captured = (id: string, paymentId: string): PaymentEvent => ({ id, event: "payment.received", created_at: 1, payload: { payment: { id: paymentId } } });
  await w.agent.handle({ kind: "payment_event", event: captured("evt_a", first.id) });
  assert.equal(w.calendar.events().filter((e) => e.status === "confirmed").length, 1, "the first payment books it");
  await w.agent.handle({ kind: "payment_event", event: captured("evt_b", second.id) });
  assert.deepEqual(w.payments.refunds().map((r) => [r.payment_id, r.amount]), [[second.id, 20000]], "the second payment is refunded");
});

test("a payment.captured for a payment on no link of ours is ignored, not matched to some booking without a link", async () => {
  const w = createWorld();
  await w.say("hello"); // a customer with no booking yet
  await w.agent.handle({ kind: "payment_event", event: { id: "evt_x", event: "payment.received", created_at: 1, payload: { payment: { id: "pay_other_business" } } } });
  assert.equal(w.payments.refunds().length, 0);
  assert.ok(w.record.entries().some((e) => e.action === "receive_payment_event" && e.outcome === "blocked"));
});
