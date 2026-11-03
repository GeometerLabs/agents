// The whole local chain as real servers in one process, each on a free port (scripts/local-stack.ts):
//
//   stand-ins (Razorpay, Google Calendar and WhatsApp wire formats) -> signed webhooks -> inbox (Meta signature mode, secrets from files)
//   -> runtime server in LIVE mode -> the agent -> the live adapters -> back to the stand-ins
//
// Guard will sit between the runtime and each service in production; here the base URLs point straight at the stand-ins. "Done" is judged from
// the stand-ins' own records (the calendar, the payments, the outbox), never from what the agent said.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SAYS } from "../crash-test/situations.ts";
import { signMeta, signRazorpay } from "../src/adapters/live/webhooks.ts";
import { fakeClock } from "../src/clock.ts";
import { CUSTOMER, glowSalon } from "../src/harness.ts";
import { languageOfScript } from "../src/language/format.ts";
import { zonedToMs } from "../src/time.ts";
import { PHONE_NUMBER_ID, startLocalStack } from "../scripts/local-stack.ts";
import type { LocalStack } from "../scripts/local-stack.ts";
import { whatsappWebhookBody } from "../standins/control.ts";

/** Tue 3 Nov 2026, 10:00 in India, for the stand-ins and the runtime alike, so "tomorrow" is a Wednesday whatever day this runs. */
const NOW = zonedToMs({ year: 2026, month: 11, day: 3 }, { hour: 10, minute: 0 }, glowSalon().timezone);
const BOOKED = /बुक हो गया!/u;

async function withStack(run: (s: LocalStack) => Promise<void>): Promise<void> {
  const stack = await startLocalStack({ clock: fakeClock(NOW) });
  try { await run(stack); } finally { await stack.stop(); }
}

/** A call to a stand-in control route (the customer writes, the customer pays, the provider sends its webhooks again). */
async function control(s: LocalStack, path: string, body?: unknown): Promise<any> {
  const reply = await fetch(s.standins.url + path, { method: body === undefined ? "GET" : "POST", body: body === undefined ? undefined : JSON.stringify(body) });
  return reply.json();
}
const statuses = (reply: { delivered: { status?: number }[] }) => reply.delivered.map((d) => d.status);

/** What the stand-ins hold. These are the witnesses. */
function witnesses(s: LocalStack) {
  const { calendar, payments, messaging } = s.standins.fakes;
  return {
    holds: calendar.events().filter((e) => e.bookingRef !== "foreign"),
    confirmed: calendar.events().filter((e) => e.status === "confirmed" && e.bookingRef !== "foreign"),
    links: payments.links(),
    captured: payments.links().flatMap((l) => l.payments).filter((p) => p.status === "captured"),
    refunds: payments.refunds(),
    toldBooked: (who: string) => messaging.sentTo(who).filter((m) => BOOKED.test(m.text)).length,
    // everything a repeat could change, in one value
    everything: () => JSON.stringify({ calendar: calendar.events(), links: payments.links(), refunds: payments.refunds(), outbox: messaging.outbox(), calls: [calendar.calls.length, payments.calls.length] }),
  };
}

/** The customer writes in Hindi, the runtime saves it and the agent answers: a held slot and a payment link. Returns the link. */
async function bookInHindi(s: LocalStack, id = "wamid.hindi-1") {
  const wrote = await control(s, "/_standin/whatsapp/inbound", { from: CUSTOMER, text: SAYS.hi.book, id });
  assert.deepEqual(statuses(wrote), [200], "the inbox took the signed webhook and the runtime saved it");
  await s.settle();
  const w = witnesses(s);
  assert.equal(w.holds.length, 1);
  assert.equal(w.holds[0].status, "tentative");
  assert.equal(w.links.length, 1);
  const [link] = w.links;
  assert.deepEqual([link.reference_id, link.amount, link.status], ["b-1", 20000, "created"]);
  const sent = s.standins.fakes.messaging.sentTo(CUSTOMER);
  assert.equal(sent.length, 1);
  assert.ok(sent[0].text.includes(link.short_url), sent[0].text);
  assert.equal(languageOfScript(sent[0].text), "hi");
  assert.equal(sent[0].kind, "text", "the customer wrote a moment ago, so a plain message is allowed");
  return link;
}

test("a customer books in Hindi and pays: the calendar, the payments and the outbox all show it, and the provider's repeat changes nothing", async () => {
  await withStack(async (s) => {
    const link = await bookInHindi(s);
    const paid = await control(s, "/_standin/razorpay/pay", { link_id: link.id });
    assert.deepEqual(paid.delivered.map((d: any) => [d.event, d.status]), [["payment.captured", 200], ["payment_link.paid", 200]]);
    await s.settle();

    const w = witnesses(s);
    assert.equal(w.confirmed.length, 1, "the calendar's own record shows the booking confirmed");
    assert.equal(w.holds.length, 1, "the hold became the booking; there is no second event");
    assert.equal(w.captured.length, 1);
    assert.equal(w.links[0].status, "paid");
    assert.equal(w.refunds.length, 0);
    assert.equal(w.toldBooked(CUSTOMER), 1);
    assert.equal(languageOfScript(s.standins.fakes.messaging.sentTo(CUSTOMER).at(-1)!.text), "hi");
    assert.equal(s.runtime!.runtime.status().bookings.confirmed, 1);
    assert.equal((await control(s, "/_standin/state")).authorizationSeen, 0, "no credential left the runtime: Guard holds those");

    // Razorpay sends the same two events again, as it does when it did not hear back in time. The runtime has them by id: nothing runs.
    const before = w.everything();
    assert.deepEqual(statuses(await control(s, "/_standin/razorpay/deliver", { all: true })), [200, 200]);
    await s.settle();
    assert.equal(witnesses(s).everything(), before, "no call reached the services, and nothing they hold moved");
    assert.deepEqual(s.runtime!.runtime.status().tasks, { pending: 0, done: 3, failed: 0 }); // the message and the two payment events, each once
  });
});

test("the runtime stops after the link and before the payment: the inbox says 503, the provider sends again after the restart, and the booking completes once", async () => {
  await withStack(async (s) => {
    const link = await bookInHindi(s);
    await s.stopRuntime();

    // The customer pays while the runtime is down. The money is at the provider; the inbox cannot hand the events on, so it refuses them.
    const paid = await control(s, "/_standin/razorpay/pay", { link_id: link.id });
    assert.deepEqual(statuses(paid), [503, 503]);
    let w = witnesses(s);
    assert.equal(w.captured.length, 1, "the payment is real at the provider");
    assert.equal(w.confirmed.length, 0, "but nothing has confirmed the booking yet");
    assert.equal(w.toldBooked(CUSTOMER), 0);

    // A new runtime on the same data folder (and port). The provider delivers again what was not accepted.
    await s.startRuntime();
    assert.deepEqual(s.runtime!.runtime.status().tasks, { pending: 0, done: 1, failed: 0 }, "it remembers the first message from before the stop");
    assert.deepEqual(statuses(await control(s, "/_standin/razorpay/deliver", { all: true })), [200, 200]);
    await s.settle();
    w = witnesses(s);
    assert.equal(w.confirmed.length, 1);
    assert.equal(w.holds.length, 1);
    assert.equal(w.captured.length, 1);
    assert.equal(w.refunds.length, 0);
    assert.equal(w.toldBooked(CUSTOMER), 1, "exactly one 'booked'");
    assert.equal(s.standins.fakes.calendar.calls.filter((c) => c.op === "insert").length, 1, "one hold was ever made");

    // Meta also sends the very first WhatsApp message again (its retry reached the old process too). The saved id makes it a no-op.
    const before = w.everything();
    assert.deepEqual(statuses(await control(s, "/_standin/whatsapp/inbound", { from: CUSTOMER, text: SAYS.hi.book, id: "wamid.hindi-1" })), [200]);
    await s.settle();
    assert.equal(witnesses(s).everything(), before);
    assert.deepEqual(s.runtime!.runtime.status().tasks, { pending: 0, done: 3, failed: 0 });
  });
});

test("a webhook with a bad signature changes nothing: a forged payment does not confirm a booking and a forged message does not cancel one", async () => {
  await withStack(async (s) => {
    const link = await bookInHindi(s);
    const before = witnesses(s).everything();

    const paidBody = JSON.stringify({ event: "payment_link.paid", created_at: 1, payload: { payment_link: { entity: { id: link.id, reference_id: "b-1" } }, payment: { entity: { id: "pay_forged" } } } });
    const forgedPayment = await fetch(`${s.inbox.url}/webhooks/razorpay`, {
      method: "POST", body: paidBody, headers: { "x-razorpay-signature": signRazorpay(Buffer.from(paidBody), "a secret the forger guessed"), "x-razorpay-event-id": "evt_forged" },
    });
    assert.equal(forgedPayment.status, 401);
    const unsigned = await fetch(`${s.inbox.url}/webhooks/razorpay`, { method: "POST", body: paidBody, headers: { "x-razorpay-event-id": "evt_forged_2" } });
    assert.equal(unsigned.status, 401);

    const cancelBody = whatsappWebhookBody({ id: "wamid.forged", from: CUSTOMER, text: SAYS.hi.cancel, timestamp: NOW }, PHONE_NUMBER_ID);
    const forgedMessage = await fetch(`${s.inbox.url}/webhooks/whatsapp`, { method: "POST", body: cancelBody, headers: { "x-hub-signature-256": signMeta(Buffer.from(cancelBody), "a secret the forger guessed") } });
    assert.equal(forgedMessage.status, 401);

    await s.settle();
    assert.equal(witnesses(s).everything(), before, "nothing the services hold moved, and no call was made");
    assert.deepEqual(s.runtime!.runtime.status().tasks, { pending: 0, done: 1, failed: 0 }, "the runtime never heard of them");
    assert.equal(witnesses(s).confirmed.length, 0);

    // The real payment afterwards still confirms the booking.
    assert.deepEqual(statuses(await control(s, "/_standin/razorpay/pay", { link_id: link.id })), [200, 200]);
    await s.settle();
    assert.equal(witnesses(s).confirmed.length, 1);
    assert.equal(witnesses(s).toldBooked(CUSTOMER), 1);
  });
});
