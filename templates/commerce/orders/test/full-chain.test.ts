// The whole local chain as real servers in one process, each on a free port (scripts/local-stack.ts):
//
//   stand-ins (Razorpay and WhatsApp wire formats) -> signed webhooks -> inbox (Meta signature mode, secrets from files)
//   -> Orders runtime server in LIVE mode -> the agent -> the live adapters -> back to the stand-ins
//
// Guard will sit between the runtime and each service in production; here the WhatsApp URL points straight at the stand-in and the refunds go through a stub Guard (the
// approvals relay beside it is the Orders one). "Done" is judged from the stand-ins' own records (the payment links, the payments, the outbox), never from what the agent said.
// It needs no Docker and no outside service.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeClock } from "../../../../modules/core/clock.ts";
import { zonedToMs } from "../../../../modules/core/time.ts";
import { AMIT, annapurnaRazorpay } from "../src/harness.ts";
import { startLocalStack } from "../scripts/local-stack.ts";
import type { LocalStack } from "../scripts/local-stack.ts";

const settings = annapurnaRazorpay();
/** Mon 9 Nov 2026, 10:00 in India: an order for the next day's lunch is well inside the six-hour cancellation window. */
const MORNING = zonedToMs({ year: 2026, month: 11, day: 9 }, { hour: 10, minute: 0 }, settings.timezone);
const ORDER = "2 veg thali 10 nov 12:00 pm pickup";

async function withStack(run: (s: LocalStack) => Promise<void>, options: { refundLimitInr?: number } = {}): Promise<void> {
  const stack = await startLocalStack({ clock: fakeClock(MORNING), ...options });
  try { await run(stack); } finally { await stack.stop(); }
}

/** A call to a stand-in control route (the customer writes, the customer pays). */
async function control(s: LocalStack, path: string, body?: unknown): Promise<any> {
  const reply = await fetch(s.standins.url + path, { method: body === undefined ? "GET" : "POST", body: body === undefined ? undefined : JSON.stringify(body) });
  return reply.json();
}
const statuses = (reply: { delivered: { status?: number }[] }) => reply.delivered.map((d) => d.status);

/** What the stand-ins hold. These are the witnesses. */
const witnesses = (s: LocalStack) => {
  const { payments, messaging } = s.standins.fakes;
  return { links: payments.links(), captured: payments.links().flatMap((l) => l.payments).filter((p) => p.status === "received"), refunds: payments.refunds(), sentTo: (who: string) => messaging.sentTo(who) };
};

test("an order travels the whole chain: the customer writes, the advance link is made at the stand-in, the customer pays it, and the order is confirmed from the payment record", async () => {
  await withStack(async (s) => {
    assert.deepEqual(statuses(await control(s, "/_standin/whatsapp/inbound", { from: AMIT, text: ORDER, id: "wamid.order-1" })), [200]);
    await s.settle();
    const link = witnesses(s).links.find((l) => l.reference_id === "o-1")!;
    assert.ok(link, "the agent made the advance link at the stand-in");
    assert.equal(link.amount, 12_000, "two veg thali at ₹120 is ₹240, and the advance is half");
    assert.deepEqual(s.runtime!.runtime.status().orders, { awaiting_advance: 1 });
    assert.deepEqual(statuses(await control(s, "/_standin/razorpay/pay", { request_id: link.id })), [200]);
    await s.settle();
    assert.equal(witnesses(s).captured.length, 1);
    assert.deepEqual(s.runtime!.runtime.status().orders, { confirmed: 1 });
    assert.ok(witnesses(s).sentTo(s.owner).length >= 1, "the owner was told what to prepare");
    // the same payment webhook delivered again changes nothing
    await control(s, "/_standin/razorpay/deliver", { all: true });
    await s.settle();
    assert.equal(witnesses(s).captured.length, 1);
    assert.deepEqual(s.runtime!.runtime.status().orders, { confirmed: 1 });
  });
});

test("a refund above the limit: the stub Guard holds it, the relay asks the owner once on WhatsApp, the owner's reply reaches the relay from the inbox, and the refund is made once", async () => {
  await withStack(async (s) => {
    await control(s, "/_standin/whatsapp/inbound", { from: AMIT, text: ORDER, id: "wamid.order-1" });
    await s.settle();
    await control(s, "/_standin/razorpay/pay", { request_id: witnesses(s).links.find((l) => l.reference_id === "o-1")!.id });
    await s.settle();
    assert.deepEqual(s.runtime!.runtime.status().orders, { confirmed: 1 });

    // the customer cancels inside the window: the whole ₹120 advance is to go back, above the ₹100 limit, so the refund is held (and the agent does not ask the owner itself)
    await control(s, "/_standin/whatsapp/inbound", { from: AMIT, text: "cancel", id: "wamid.cancel-1" });
    await s.settle();
    const owner = () => s.standins.fakes.messaging.sentTo(s.owner).filter((m) => m.templateName === "owner_order_refund_approval");
    assert.equal(witnesses(s).refunds.length, 0, "held, not sent");
    assert.equal(s.guard.model.reviews("x", true).length, 1);
    assert.equal(owner().length, 0, "the relay has not asked yet");

    // the relay reads the stub Guard, asks the runtime what the refund is about, and asks the owner, once
    await s.pollRelay(); await s.pollRelay();
    assert.equal(owner().length, 1);
    const code = /"approve ([A-Z0-9]{6})"/u.exec(owner()[0].text)![1];

    // another number sends the code: nothing. The owner sends it: the inbox gives it to the runtime AND the relay, and the refund goes once.
    await control(s, "/_standin/whatsapp/inbound", { from: "+919899999999", text: `approve ${code}`, id: "wamid.forged-1" });
    await s.settle(); await s.relay.idle();
    assert.equal(witnesses(s).refunds.length, 0);
    assert.deepEqual(statuses(await control(s, "/_standin/whatsapp/inbound", { from: s.owner, text: `approve ${code}`, id: "wamid.owner-1" })), [200]);
    await s.settle(); await s.relay.idle(); await s.settle();
    const w = witnesses(s);
    assert.equal(w.refunds.length, 1);
    assert.equal(w.refunds[0].amount, 12_000);
    assert.equal(w.refunds[0].receipt, `o-1:${w.captured[0].id}`);
    assert.equal(s.guard.accepted.length, 1);
    assert.equal(owner().length, 1, "asked exactly once");
    // the same webhook delivered again, and time, change nothing
    await control(s, "/_standin/whatsapp/inbound", { from: s.owner, text: `approve ${code}`, id: "wamid.owner-1" });
    await s.pollRelay();
    assert.equal(witnesses(s).refunds.length, 1);
  }, { refundLimitInr: 100 });
});

test("the runtime stopped and started again continues on the same data: the held order is still there", async () => {
  await withStack(async (s) => {
    await control(s, "/_standin/whatsapp/inbound", { from: AMIT, text: ORDER, id: "wamid.order-1" });
    await s.settle();
    assert.deepEqual(s.runtime!.runtime.status().orders, { awaiting_advance: 1 });
    await s.stopRuntime();
    await s.startRuntime();
    assert.deepEqual(s.runtime!.runtime.status().orders, { awaiting_advance: 1 });
    await control(s, "/_standin/razorpay/pay", { request_id: witnesses(s).links.find((l) => l.reference_id === "o-1")!.id });
    await s.settle();
    assert.deepEqual(s.runtime!.runtime.status().orders, { confirmed: 1 });
  });
});
