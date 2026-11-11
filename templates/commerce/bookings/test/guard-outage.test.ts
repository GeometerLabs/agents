// A Guard down under the Bookings agent, through the real runtime: the customer's message and the payment wait, nothing reaches a provider twice, and past the bound the
// customer is told once and the owner's list has it. The rule itself is tried in modules/runtime/test/guard-wait.test.ts; what is Bookings' own is the calendar's hold.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CUSTOMER } from "../src/harness.ts";
import { GUARD_WAIT_MS } from "../../../../modules/runtime/guard-wait.ts";
import { outage } from "../../../../modules/runtime/test/outage.ts";
import { obligations, DEFAULT_OPTIONS } from "../../../../modules/unfinished/index.ts";
import { createKit } from "./runtime-kit.ts";

const BOOK = "I want a haircut tomorrow at 6pm";

function outageKit() {
  const kit = createKit();
  const calendar = outage(kit.calendar, "Google Calendar");
  const payments = outage(kit.payments, "Razorpay");
  const messaging = outage(kit.messaging, "WhatsApp");
  const { runtime, db } = kit.open({ services: { calendar: calendar.service, payments: payments.service, messaging: messaging.service }, guardLookAgainMs: [1_000] });
  const toCustomer = () => kit.messaging.sentTo(CUSTOMER);
  const run = async (advanceMs = 1_000) => { kit.clock.advance(advanceMs); runtime.kick(); await runtime.idle(); };
  return { kit, runtime, db, calendar, payments, messaging, toCustomer, run };
}

test("the Razorpay Guard down while a customer books: nothing is said, and when it is back there is one hold, one link and one answer", async () => {
  const o = outageKit();
  try {
    o.payments.down();
    await o.kit.say(o.runtime, BOOK);
    assert.equal(o.toCustomer().length, 0, "not told the link failed");
    assert.equal(o.runtime.status().tasks.pending, 1);
    assert.equal(o.db.loadState().record.length, 0, "nothing of the step was saved");
    assert.equal(o.kit.calendar.events().length, 1, "the hold the first try made is the only one");
    o.payments.up();
    await o.run();
    assert.equal(o.kit.calendar.events().length, 1, "found again, not made twice");
    assert.equal(o.kit.payments.links().length, 1);
    assert.equal(o.toCustomer().length, 1, "answered once");
    assert.match(o.toCustomer()[0].text, /₹/u);
    assert.deepEqual(o.runtime.status().tasks, { pending: 0, done: 1, failed: 0 });
  } finally { await o.runtime.close(); o.kit.cleanup(); }
});

test("a rerun finds its hold and writes the booking's new end to the calendar, so nobody else can take the time meanwhile", async () => {
  const o = outageKit();
  try {
    o.payments.down();
    await o.kit.say(o.runtime, BOOK);
    const first = o.kit.calendar.events()[0].holdExpiresAt!;
    o.payments.up();
    await o.run(5 * 60_000);
    const event = o.kit.calendar.events()[0];
    assert.equal(event.holdExpiresAt, o.kit.clock.now() + 15 * 60_000);
    assert.notEqual(event.holdExpiresAt, first);
  } finally { await o.runtime.close(); o.kit.cleanup(); }
});

test("the Calendar Guard down while a payment comes in: the deposit waits, and when it is back the booking is confirmed once and the customer told once", async () => {
  const o = outageKit();
  try {
    await o.kit.say(o.runtime, BOOK);
    o.kit.payments.customerPays(o.kit.linkFor("b-1")!.id);
    o.calendar.down();
    await o.kit.deliverPaymentEvents(o.runtime);
    assert.ok(o.runtime.status().tasks.pending >= 1, "the payment's work waits (Razorpay sends a payment two events)");
    assert.equal(o.kit.messaging.sentTo(CUSTOMER).length, 1, "the quote only");
    o.calendar.up();
    await o.run();
    assert.equal(o.kit.calendar.events().filter((e) => e.status === "confirmed").length, 1);
    assert.equal(o.toCustomer().length, 2, "the quote, then booked, once");
    assert.equal(o.runtime.status().bookings.confirmed, 1);
    assert.deepEqual([o.runtime.status().tasks.pending, o.runtime.status().tasks.failed], [0, 0]);
  } finally { await o.runtime.close(); o.kit.cleanup(); }
});

test("the WhatsApp Guard down past the bound: no reply can reach the customer, so the owner's list says so, once", async () => {
  const o = outageKit();
  try {
    o.messaging.down();
    await o.kit.say(o.runtime, BOOK);
    await o.run(GUARD_WAIT_MS);
    assert.equal(o.toCustomer().length, 0);
    assert.equal(o.runtime.status().tasks.pending, 0);
    const found = obligations.detect({ template: "bookings", entries: o.db.loadState().record, cases: [], nowMs: o.kit.clock.now(), options: DEFAULT_OPTIONS }).found.filter((f) => f.kind === "message_unanswered");
    assert.equal(found.length, 1, "one item");
  } finally { await o.runtime.close(); o.kit.cleanup(); }
});

test("the Calendar Guard down past the bound: the customer is told the request was not finished and where it went, once, and the owner's list has it", async () => {
  const o = outageKit();
  try {
    o.calendar.down();
    await o.kit.say(o.runtime, BOOK);
    await o.run(GUARD_WAIT_MS);
    assert.equal(o.toCustomer().length, 1);
    // the words of their own (11 Nov): what happened, where the message is, what to do; never that the owner was told or will write, which the code does not do
    assert.equal(o.toCustomer()[0].text, `Sorry, I could not finish your request: the booking system is not answering just now. Your message is on the owner's to-do list. Please write again later, or contact ${o.kit.settings.name} directly.`);
    assert.deepEqual(o.runtime.status().tasks, { pending: 0, done: 0, failed: 1 });
    const found = obligations.detect({ template: "bookings", entries: o.db.loadState().record, cases: [], nowMs: o.kit.clock.now(), options: DEFAULT_OPTIONS }).found.filter((f) => f.kind === "message_unanswered");
    assert.equal(found.length, 1, "the to-do item the words name is there");
  } finally { await o.runtime.close(); o.kit.cleanup(); }
});
