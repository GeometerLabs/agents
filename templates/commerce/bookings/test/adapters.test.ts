import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeClock } from "../../../../modules/core/clock.ts";
import { createFakeCalendar } from "../src/adapters/calendar.ts";
import { createFakePayments } from "../../../../modules/payments/payments.ts";
import { createFakeMessaging } from "../../../../modules/messaging/messaging.ts";
import { ApiError, ConflictError, TimeoutError, WindowClosedError } from "../../../../modules/core/faults.ts";
import { HOUR } from "../../../../modules/core/time.ts";

const T0 = Date.UTC(2026, 10, 3, 4, 30);
const slot = { summary: "Haircut", start: T0 + HOUR, end: T0 + 2 * HOUR, status: "tentative" as const, bookingRef: "b1" };

// ---- calendar ----

test("calendar: insert, get, list, update, delete, free-busy and conflicts", async () => {
  const cal = createFakeCalendar();
  const e = await cal.insert(slot);
  assert.deepEqual(await cal.get(e.id), e);
  assert.equal((await cal.list({ bookingRef: "b1" })).length, 1);
  assert.equal((await cal.list({ bookingRef: "other" })).length, 0);
  assert.deepEqual(await cal.freeBusy(T0, T0 + 3 * HOUR), [{ start: slot.start, end: slot.end }]);
  assert.equal((await cal.conflicts(slot.start + 10, slot.end + 10)).length, 1);
  assert.equal((await cal.conflicts(slot.end, slot.end + HOUR)).length, 0); // touching is not overlapping
  const confirmed = await cal.update(e.id, { status: "confirmed" });
  assert.equal(confirmed.status, "confirmed");
  assert.equal((await cal.get(e.id))?.status, "confirmed");
  await cal.delete(e.id);
  assert.equal(await cal.get(e.id), null);
});

test("calendar silentFailure: answers ok, stores nothing", async () => {
  const cal = createFakeCalendar();
  cal.inject("insert", "silentFailure");
  const e = await cal.insert(slot);
  assert.ok(e.id);
  assert.equal(await cal.get(e.id), null);
  assert.equal(cal.events().length, 0);
});

test("calendar lostReply: stores, then times out", async () => {
  const cal = createFakeCalendar();
  cal.inject("insert", "lostReply");
  await assert.rejects(() => cal.insert(slot), TimeoutError);
  assert.equal(cal.events().length, 1);
  assert.equal((await cal.list({ bookingRef: "b1" })).length, 1);
});

test("calendar conflict: someone else's event appears and the insert is refused", async () => {
  const cal = createFakeCalendar();
  cal.inject("insert", "conflict");
  await assert.rejects(() => cal.insert(slot), ConflictError);
  assert.equal(cal.events().length, 1);
  assert.equal(cal.events()[0].bookingRef, "foreign");
});

test("calendar update silentFailure leaves the event as it was; faults are used once, in order", async () => {
  const cal = createFakeCalendar();
  const e = await cal.insert(slot);
  cal.inject("update", "silentFailure");
  const said = await cal.update(e.id, { status: "confirmed" });
  assert.equal(said.status, "confirmed");
  assert.equal((await cal.get(e.id))?.status, "tentative");
  const again = await cal.update(e.id, { status: "confirmed" }); // the fault was used up
  assert.equal(again.status, "confirmed");
  assert.equal((await cal.get(e.id))?.status, "confirmed");
});

// ---- payments ----

test("payments: a link with a reference id; a second link with the same reference is refused", async () => {
  const pay = createFakePayments(fakeClock(T0));
  const link = await pay.createRequest({ amount: 20000, reference_id: "b1", description: "Deposit" });
  assert.match(link.pay_url, /^https:\/\/rzp\.io\/l\//);
  assert.equal((await pay.listRequests({ reference_id: "b1" })).length, 1);
  await assert.rejects(() => pay.createRequest({ amount: 20000, reference_id: "b1", description: "Deposit" }), ApiError);
  const lax = createFakePayments(fakeClock(T0), { enforceUniqueReference: false });
  await lax.createRequest({ amount: 1, reference_id: "b1", description: "x" });
  await lax.createRequest({ amount: 1, reference_id: "b1", description: "x" });
  assert.equal(lax.links().length, 2);
});

test("payments lostReply on create: the link exists although the client saw a timeout", async () => {
  const pay = createFakePayments(fakeClock(T0));
  pay.inject("createRequest", "lostReply");
  await assert.rejects(() => pay.createRequest({ amount: 20000, reference_id: "b1", description: "Deposit" }), TimeoutError);
  assert.equal(pay.links().length, 1);
});

test("payments: one link can be paid twice; events are emitted but not delivered", async () => {
  const pay = createFakePayments(fakeClock(T0));
  const link = await pay.createRequest({ amount: 20000, reference_id: "b1", description: "Deposit" });
  const p1 = pay.customerPays(link.id);
  const p2 = pay.customerPays(link.id);
  const fetched = await pay.fetchRequest(link.id);
  assert.equal(fetched?.status, "paid");
  assert.equal(fetched?.payments.length, 2);
  assert.equal(fetched?.amount_paid, 40000);
  assert.deepEqual(pay.events.map((e) => e.event), ["payment.received", "request.paid", "payment.received"]);
  assert.notEqual(p1.id, p2.id);
});

test("payments: a refund cannot be more than what is left on the payment", async () => {
  const pay = createFakePayments(fakeClock(T0));
  const link = await pay.createRequest({ amount: 20000, reference_id: "b1", description: "Deposit" });
  const p = pay.customerPays(link.id);
  await pay.refund(p.id, { amount: 15000 });
  await assert.rejects(() => pay.refund(p.id, { amount: 6000 }), /more than what is left/);
  await pay.refund(p.id, { amount: 5000 });
  assert.equal((await pay.fetchPayment(p.id))?.amount_refunded, 20000);
  assert.equal((await pay.listRefunds(p.id)).length, 2);
  assert.equal(pay.events.filter((e) => e.event === "refund.done").length, 2);
});

test("payments: a cancelled link cannot be paid; an expired key refuses every call", async () => {
  const pay = createFakePayments(fakeClock(T0));
  const link = await pay.createRequest({ amount: 20000, reference_id: "b1", description: "Deposit" });
  await pay.cancelRequest(link.id);
  assert.throws(() => pay.customerPays(link.id), /cancelled/);
  pay.inject("createRequest", "error", { times: 2 });
  await assert.rejects(() => pay.createRequest({ amount: 1, reference_id: "b2", description: "x" }), (e: any) => e.status === 401);
  await assert.rejects(() => pay.createRequest({ amount: 1, reference_id: "b2", description: "x" }), (e: any) => e.status === 401);
  await pay.createRequest({ amount: 1, reference_id: "b2", description: "x" }); // the key works again
});

// ---- messaging ----

test("messaging: free text only while the 24-hour window is open; templates need approval", async () => {
  const clock = fakeClock(T0);
  const wa = createFakeMessaging(clock);
  await assert.rejects(() => wa.sendText("+911", "hello"), WindowClosedError); // they never wrote to us
  wa.receive("+911", "hi");
  assert.equal(await wa.isWindowOpen("+911"), true);
  await wa.sendText("+911", "hello");
  clock.advance(25 * HOUR);
  assert.equal(await wa.isWindowOpen("+911"), false);
  await assert.rejects(() => wa.sendText("+911", "hello again"), WindowClosedError);
  await assert.rejects(() => wa.sendTemplate("+911", { name: "booking_reminder", language: "en", text: "Reminder" }), /not approved/);
  wa.approve("booking_reminder", "en");
  const sent = await wa.sendTemplate("+911", { name: "booking_reminder", language: "en", text: "Reminder" });
  assert.equal(sent.kind, "template");
  assert.equal(wa.outbox().length, 2);
});

test("messaging: STOP is noticed, and anything sent afterwards is flagged in the outbox", async () => {
  const wa = createFakeMessaging(fakeClock(T0));
  wa.receive("+911", "hi");
  await wa.sendText("+911", "before");
  wa.receive("+911", "STOP");
  assert.equal(wa.isOptedOut("+911"), true);
  await wa.sendText("+911", "after");
  assert.deepEqual(wa.sentTo("+911").map((m) => m.afterOptOut), [false, true]);
});

test("messaging: an inbound message keeps its id, so a duplicate delivery is visible as the same id", () => {
  const wa = createFakeMessaging(fakeClock(T0));
  const a = wa.receive("+911", "haircut tomorrow 6pm");
  const again = wa.receive("+911", "haircut tomorrow 6pm", { id: a.id });
  assert.equal(a.id, again.id);
});

test("messaging lostReply: the message went out although the client saw a timeout", async () => {
  const wa = createFakeMessaging(fakeClock(T0));
  wa.receive("+911", "hi");
  wa.inject("sendText", "lostReply");
  await assert.rejects(() => wa.sendText("+911", "hello"), TimeoutError);
  assert.equal(wa.sentTo("+911").length, 1);
});
