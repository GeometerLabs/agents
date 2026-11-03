// Contract tests: the LIVE adapters run against the stand-ins over real HTTP, and must behave as the in-memory fakes do (test/adapters.test.ts),
// including when things go wrong (a lost reply, a calendar that saves nothing, a payment made twice, a key that expired).
// Then the real agent runs on top of them. The fakes behind the stand-ins are the witnesses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, ConflictError, TimeoutError, WindowClosedError } from "../src/adapters/faults.ts";
import { HOUR } from "../src/time.ts";
import { createLiveAdapters } from "../src/adapters/live/index.ts";
import { liveWorld, CUSTOMER, PHONE_NUMBER_ID } from "./helpers/live-world.ts";
import type { LiveWorld } from "./helpers/live-world.ts";

async function withWorld(run: (w: LiveWorld) => Promise<void>, options: Parameters<typeof liveWorld>[0] = {}) {
  const w = await liveWorld(options);
  try { await run(w); } finally { await w.close(); }
}

const PHONE = "+919800000911";
const T0 = Date.UTC(2026, 10, 3, 4, 30);
const slot = { summary: "Haircut", start: T0 + HOUR, end: T0 + 2 * HOUR, status: "tentative" as const, bookingRef: "b1", holdExpiresAt: T0 + 2 * HOUR };

// ---- calendar ----

test("calendar over HTTP: insert, get, list, update, delete, free-busy and conflicts", async () => {
  await withWorld(async ({ adapters: { calendar }, fakes }) => {
    const e = await calendar.insert(slot);
    assert.deepEqual(await calendar.get(e.id), e);
    assert.deepEqual(e, { ...slot, id: e.id });
    assert.equal(fakes.calendar.events().length, 1);
    assert.equal((await calendar.list({ bookingRef: "b1" })).length, 1);
    assert.equal((await calendar.list({ bookingRef: "other" })).length, 0);
    assert.deepEqual(await calendar.freeBusy(T0, T0 + 3 * HOUR), [{ start: slot.start, end: slot.end }]);
    assert.equal((await calendar.conflicts(slot.start + 10, slot.end + 10)).length, 1);
    assert.equal((await calendar.conflicts(slot.end, slot.end + HOUR)).length, 0); // touching is not overlapping
    const confirmed = await calendar.update(e.id, { status: "confirmed", holdExpiresAt: undefined });
    assert.equal(confirmed.status, "confirmed");
    assert.equal(confirmed.holdExpiresAt, undefined);
    assert.equal(fakes.calendar.events()[0].holdExpiresAt, undefined); // the hold really was cleared, not just hidden
    assert.equal(fakes.calendar.events()[0].bookingRef, "b1"); // and the booking id was kept
    await calendar.delete(e.id);
    assert.equal(await calendar.get(e.id), null);
    assert.equal(fakes.calendar.events().length, 0);
    await assert.rejects(() => calendar.update("ev_nope", { status: "confirmed" }), (e: any) => e instanceof ApiError && e.status === 404);
  });
});

test("calendar over HTTP: someone else's entry has no booking id, and a long list is read page by page", async () => {
  await withWorld(async ({ adapters: { calendar }, fakes }) => {
    fakes.calendar.addForeignEvent(slot.start, slot.end, "Dentist");
    for (let i = 0; i < 4; i++) await calendar.insert({ ...slot, bookingRef: `b${i}`, start: slot.start + (i + 1) * 3 * HOUR, end: slot.end + (i + 1) * 3 * HOUR });
    const all = await calendar.list();
    assert.equal(all.length, 5); // three pages of two
    assert.equal(all.filter((e) => e.bookingRef === "foreign").length, 1);
    assert.equal((await calendar.conflicts(slot.start, slot.end)).map((e) => e.summary).join(), "Dentist");
  }, { calendarPageSize: 2 });
});

test("calendar silentFailure: answers ok, stores nothing, and a read-back shows it", async () => {
  await withWorld(async ({ adapters: { calendar }, fakes, control }) => {
    await control("/_standin/fault", { service: "calendar", op: "insert", mode: "silentFailure" });
    const e = await calendar.insert(slot);
    assert.ok(e.id);
    assert.equal(await calendar.get(e.id), null);
    assert.equal(fakes.calendar.events().length, 0);
    assert.equal((await calendar.list({ bookingRef: "b1" })).length, 0);
  });
});

test("calendar lostReply: stored, then the client sees a timeout; conflict: someone else's event appears and the insert is refused", async () => {
  await withWorld(async ({ adapters: { calendar }, fakes, control }) => {
    await control("/_standin/fault", { service: "calendar", op: "insert", mode: "lostReply" });
    await assert.rejects(() => calendar.insert(slot), TimeoutError);
    assert.equal(fakes.calendar.events().length, 1);
    assert.equal((await calendar.list({ bookingRef: "b1" })).length, 1);
    await control("/_standin/fault", { service: "calendar", op: "insert", mode: "conflict" });
    await assert.rejects(() => calendar.insert({ ...slot, bookingRef: "b2" }), ConflictError);
    assert.equal(fakes.calendar.events().filter((e) => e.bookingRef === "foreign").length, 1);
    await control("/_standin/fault", { service: "calendar", op: "list", mode: "error" });
    await assert.rejects(() => calendar.list(), (e: any) => e instanceof ApiError && e.status === 500);
  }, { timeoutMs: 300 });
});

test("calendar update silentFailure leaves the event as it was; faults are used once, in order", async () => {
  await withWorld(async ({ adapters: { calendar }, control }) => {
    const e = await calendar.insert(slot);
    await control("/_standin/fault", { service: "calendar", op: "update", mode: "silentFailure" });
    const said = await calendar.update(e.id, { status: "confirmed" });
    assert.equal(said.status, "confirmed");
    assert.equal((await calendar.get(e.id))?.status, "tentative");
    assert.equal((await calendar.update(e.id, { status: "confirmed" })).status, "confirmed");
    assert.equal((await calendar.get(e.id))?.status, "confirmed");
  });
});

// ---- payments ----

test("payments over HTTP: a link with a reference id; a second link with the same reference is refused, and the first is found by reference or by payment", async () => {
  await withWorld(async ({ adapters: { payments }, fakes, control }) => {
    const link = await payments.createPaymentLink({ amount: 20000, reference_id: "b1", description: "Deposit" });
    assert.match(link.short_url, /^https:\/\/rzp\.io\/l\//);
    assert.equal(link.amount, 20000);
    assert.equal(link.status, "created");
    assert.equal((await payments.listPaymentLinks({ reference_id: "b1" })).length, 1);
    assert.equal((await payments.listPaymentLinks({ reference_id: "b2" })).length, 0);
    await assert.rejects(() => payments.createPaymentLink({ amount: 20000, reference_id: "b1", description: "Deposit" }), (e: any) => e instanceof ApiError && e.status === 400 && /already attempted/.test(e.message));
    const paid = await control("/_standin/razorpay/pay", { link_id: link.id, deliver: false });
    assert.equal((await payments.listPaymentLinks({ payment_id: paid.payment.id }))[0]?.id, link.id);
    assert.equal((await payments.listPaymentLinks({ payment_id: "pay_nope" })).length, 0);
    assert.equal(fakes.payments.links().length, 1);
  });
  await withWorld(async ({ adapters: { payments }, fakes }) => {
    await payments.createPaymentLink({ amount: 1, reference_id: "b1", description: "x" });
    await payments.createPaymentLink({ amount: 1, reference_id: "b1", description: "x" });
    assert.equal(fakes.payments.links().length, 2);
  }, { payments: { enforceUniqueReference: false } });
});

test("payments lostReply on create: the link exists although the client saw a timeout", async () => {
  await withWorld(async ({ adapters: { payments }, fakes, control }) => {
    await control("/_standin/fault", { service: "payments", op: "createPaymentLink", mode: "lostReply" });
    await assert.rejects(() => payments.createPaymentLink({ amount: 20000, reference_id: "b1", description: "Deposit" }), TimeoutError);
    assert.equal(fakes.payments.links().length, 1);
    assert.equal((await payments.listPaymentLinks({ reference_id: "b1" })).length, 1); // the look-before-retry finds it
  }, { timeoutMs: 300 });
});

test("payments: one link paid twice shows two payments on a fetch (not on a list); the events carry no link id; refunds are bounded and show on the payment and on the link", async () => {
  await withWorld(async ({ adapters: { payments }, fakes, control }) => {
    const link = await payments.createPaymentLink({ amount: 20000, reference_id: "b1", description: "Deposit" });
    const p1 = (await control("/_standin/razorpay/pay", { link_id: link.id, deliver: false })).payment;
    const p2 = (await control("/_standin/razorpay/pay", { link_id: link.id, deliver: false })).payment;
    const fetched = await payments.fetchPaymentLink(link.id);
    assert.equal(fetched?.status, "paid");
    assert.deepEqual(fetched?.payments.map((p) => [p.id, p.link_id, p.amount]), [[p1.id, link.id, 20000], [p2.id, link.id, 20000]]);
    assert.equal(fetched?.amount_paid, 40000);
    assert.deepEqual((await payments.listPaymentLinks({ reference_id: "b1" }))[0].payments, []); // as the docs' own list example shows
    assert.deepEqual(fakes.payments.events.map((e) => e.event), ["payment.captured", "payment_link.paid", "payment.captured"]);
    await payments.refund(p2.id, { amount: 15000, receipt: "r1" });
    await assert.rejects(() => payments.refund(p2.id, { amount: 6000 }), (e: any) => e instanceof ApiError && /more than what is left/.test(e.message));
    await payments.refund(p2.id, { amount: 5000, receipt: "r2" });
    assert.equal((await payments.fetchPayment(p2.id))?.amount_refunded, 20000);
    assert.deepEqual((await payments.listRefunds(p2.id)).map((r) => [r.amount, r.receipt, r.status]), [[15000, "r1", "processed"], [5000, "r2", "processed"]]);
    assert.equal((await payments.fetchPaymentLink(link.id))?.payments.find((p) => p.id === p2.id)?.amount_refunded, 20000);
    assert.equal(fakes.payments.events.filter((e) => e.event === "refund.processed").length, 2);
  });
});

test("payments: a missing link or payment is null (Razorpay answers 400), a paid link cannot be cancelled, a cancelled link cannot be paid, and an expired key refuses with 401 until it works again", async () => {
  await withWorld(async ({ adapters: { payments }, control }) => {
    assert.equal(await payments.fetchPaymentLink("plink_nope"), null);
    assert.equal(await payments.fetchPayment("pay_nope"), null);
    await assert.rejects(() => payments.cancelPaymentLink("plink_nope"), (e: any) => e.status === 404);
    const a = await payments.createPaymentLink({ amount: 20000, reference_id: "a", description: "x" });
    const b = await payments.createPaymentLink({ amount: 20000, reference_id: "b", description: "x" });
    await control("/_standin/razorpay/pay", { link_id: a.id, deliver: false });
    await assert.rejects(() => payments.cancelPaymentLink(a.id), (e: any) => e instanceof ApiError && e.status === 400 && /already paid/.test(e.message));
    assert.equal((await payments.cancelPaymentLink(b.id)).status, "cancelled");
    assert.match((await control("/_standin/razorpay/pay", { link_id: b.id })).error, /cancelled/);
    await control("/_standin/fault", { service: "payments", op: "createPaymentLink", mode: "error", times: 2 });
    for (let i = 0; i < 2; i++) await assert.rejects(() => payments.createPaymentLink({ amount: 1, reference_id: "c", description: "x" }), (e: any) => e instanceof ApiError && e.status === 401);
    await payments.createPaymentLink({ amount: 1, reference_id: "c", description: "x" }); // the key works again
  });
});

// ---- messaging ----

test("messaging: free text only while the 24-hour window is open (the runtime's own record of it); an unknown template, a wrong parameter count and an approved template", async () => {
  await withWorld(async (w) => {
    const { messaging } = w.adapters;
    await assert.rejects(() => messaging.sendText(PHONE, "hello"), WindowClosedError); // they never wrote to us
    w.listen(PHONE, "hi");
    assert.equal(await messaging.isWindowOpen(PHONE), true);
    const sent = await messaging.sendText(PHONE, "hello");
    assert.equal((await messaging.getMessage(sent.id))?.text, "hello");
    assert.equal(w.fakes.messaging.outbox()[0].id, sent.id); // the wamid the stand-in gave is the one we kept
    w.clock.advance(25 * HOUR);
    assert.equal(await messaging.isWindowOpen(PHONE), false);
    await assert.rejects(() => messaging.sendText(PHONE, "hello again"), WindowClosedError);
    await assert.rejects(() => messaging.sendTemplate(PHONE, { name: "booking_update", language: "en", text: "x" }), (e: any) => e instanceof ApiError && e.status === 404);
    await assert.rejects(() => messaging.sendTemplate(PHONE, { name: "booking_reminder", language: "en", text: "x", parameters: ["only one"] }), (e: any) => e instanceof ApiError && e.status === 400);
    const t = await messaging.sendTemplate(PHONE, { name: "booking_reminder", language: "en", text: "ignored", parameters: ["haircut", "Glow Salon", "Tue 10 Nov, 6:00 pm"] });
    assert.equal(t.kind, "template");
    // what the customer would read is the approved wording filled in, not the text we passed along
    assert.equal(w.fakes.messaging.outbox().at(-1)!.text, "Reminder: your haircut at Glow Salon is on Tue 10 Nov, 6:00 pm.");
    assert.equal(w.fakes.messaging.outbox().at(-1)!.templateName, "booking_reminder");
  });
});

test("messaging: the stand-in's own window can disagree with the runtime's, and Meta's refusal (131047) is a WindowClosedError", async () => {
  await withWorld(async (w) => {
    // the runtime believes this person wrote just now; the provider has never heard from them
    const lastInbound = new Map<string, number>([[PHONE, w.clock.now()]]);
    const optimistic = createLiveAdapters({ payments: { baseUrl: w.standins.url }, calendar: { baseUrl: w.standins.url, calendarId: "c" }, messaging: { baseUrl: w.standins.url, phoneNumberId: PHONE_NUMBER_ID } }, { clock: w.clock, window: { lastInboundAt: (p) => lastInbound.get(p) } }).messaging;
    assert.equal(await optimistic.isWindowOpen(PHONE), true);
    await assert.rejects(() => optimistic.sendText(PHONE, "hi"), WindowClosedError);
    assert.equal(w.fakes.messaging.outbox().length, 0);
  });
});

test("messaging lostReply: the message went out although the client saw a timeout; STOP is noticed by the provider, and a send after it is flagged", async () => {
  await withWorld(async (w) => {
    w.listen(PHONE, "hi");
    await w.control("/_standin/fault", { service: "messaging", op: "sendText", mode: "lostReply" });
    await assert.rejects(() => w.adapters.messaging.sendText(PHONE, "hello"), TimeoutError);
    assert.equal(w.fakes.messaging.sentTo(PHONE).length, 1);
    w.listen(PHONE, "STOP");
    await w.adapters.messaging.sendText(PHONE, "after");
    assert.deepEqual(w.fakes.messaging.sentTo(PHONE).map((m) => m.afterOptOut), [false, true]);
  }, { timeoutMs: 300 });
});

test("a live adapter never sends an Authorization header, whatever it calls", async () => {
  await withWorld(async (w) => {
    await w.adapters.payments.listPaymentLinks();
    await w.adapters.calendar.list();
    w.listen(PHONE, "hi");
    await w.adapters.messaging.sendText(PHONE, "hello");
    assert.equal((await w.control("/_standin/state")).authorizationSeen, 0);
  });
});

// ---- the real agent on top of the live adapters ----

const BOOK = "haircut tomorrow at 6pm";

test("a normal booking over HTTP: held, link sent, paid, confirmed in the calendar, and the customer told, judged from the fakes", async () => {
  await withWorld(async (w) => {
    await w.say(BOOK);
    assert.equal(w.fakes.calendar.events().length, 1);
    assert.equal(w.fakes.calendar.events()[0].status, "tentative");
    const link = w.linkFor("b-1")!;
    assert.match(w.textsTo(CUSTOMER).at(-1)!, new RegExp(link.short_url.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")));
    await w.control("/_standin/razorpay/pay", { link_id: link.id, deliver: false });
    await w.deliverPaymentEvents();
    assert.equal(w.confirmedEvents().length, 1);
    assert.equal(w.linkFor("b-1")!.payments.length, 1);
    assert.match(w.textsTo(CUSTOMER).at(-1)!, /Booked!/);
    assert.equal(w.fakes.payments.refunds().length, 0);
    await w.deliverPaymentEvents({ twice: true }); // the same events again change nothing
    assert.equal(w.textsTo(CUSTOMER).filter((t) => /Booked!/.test(t)).length, 1);
  });
});

test("lost reply on the payment link: exactly one link exists and the agent asked to create it once (it looked before it retried)", async () => {
  await withWorld(async (w) => {
    await w.control("/_standin/fault", { service: "payments", op: "createPaymentLink", mode: "lostReply" });
    await w.say(BOOK);
    assert.equal(w.fakes.payments.links().length, 1);
    assert.equal(w.fakes.payments.calls.filter((c) => c.op === "createPaymentLink").length, 1);
    assert.match(w.textsTo(CUSTOMER).at(-1)!, /rzp\.io/);
  }, { timeoutMs: 300 });
});

test("the calendar saves nothing: the agent does not say booked, and tells the owner", async () => {
  await withWorld(async (w) => {
    w.listen(w.owner); // the owner wrote to the number today, so a plain message can reach them
    await w.say(BOOK);
    const link = w.linkFor("b-1")!;
    await w.control("/_standin/fault", { service: "calendar", op: "update", mode: "silentFailure", times: 3 });
    await w.control("/_standin/razorpay/pay", { link_id: link.id, deliver: false });
    await w.deliverPaymentEvents();
    assert.equal(w.confirmedEvents().length, 0);
    assert.ok(!w.textsTo(CUSTOMER).some((t) => /Booked!/.test(t)), w.textsTo(CUSTOMER).join(" | "));
    assert.ok(w.textsTo(w.owner).some((t) => /NOT booked/.test(t)), w.textsTo(w.owner).join(" | "));
  });
});

test("a deposit paid twice: the second payment is refunded once, even though a real payment.captured does not say which link it paid", async () => {
  await withWorld(async (w) => {
    await w.say(BOOK);
    const id = w.linkFor("b-1")!.id;
    const first = (await w.control("/_standin/razorpay/pay", { link_id: id, deliver: false })).payment;
    const second = (await w.control("/_standin/razorpay/pay", { link_id: id, deliver: false })).payment;
    await w.deliverPaymentEvents();
    const refunds = w.fakes.payments.refunds();
    assert.equal(w.linkFor("b-1")!.payments.length, 2);
    assert.deepEqual(refunds.map((r) => [r.payment_id, r.amount]), [[second.id, 20000]]);
    assert.ok(refunds.every((r) => r.payment_id !== first.id));
    assert.equal(w.confirmedEvents().length, 1);
    await w.deliverPaymentEvents({ twice: true });
    assert.equal(w.fakes.payments.refunds().length, 1);
  });
});

test("an expired Razorpay key: no link is made, nothing is held, and the customer and owner are told", async () => {
  await withWorld(async (w) => {
    w.listen(w.owner);
    await w.control("/_standin/fault", { service: "payments", op: "createPaymentLink", mode: "error", times: 10 });
    await w.say(BOOK);
    assert.equal(w.fakes.payments.links().length, 0);
    assert.equal(w.fakes.calendar.events().length, 0, "the hold was given back");
    assert.ok(w.textsTo(w.owner).length > 0);
    assert.ok(w.textsTo(CUSTOMER).some((t) => /nothing is booked/.test(t)));
  });
});

test("a refund whose reply is lost is looked up by its receipt, not made twice", async () => {
  await withWorld(async (w) => {
    await w.say(BOOK);
    const id = w.linkFor("b-1")!.id;
    await w.control("/_standin/razorpay/pay", { link_id: id, deliver: false });
    await w.control("/_standin/razorpay/pay", { link_id: id, deliver: false });
    await w.control("/_standin/fault", { service: "payments", op: "refund", mode: "lostReply" });
    await w.deliverPaymentEvents();
    assert.equal(w.fakes.payments.refunds().length, 1);
    assert.equal(w.fakes.payments.calls.filter((c) => c.op === "refund").length, 1);
  }, { timeoutMs: 300 });
});

test("a reminder sent after the 24-hour window goes as the real template, over HTTP, with the approved wording as the outbox text", async () => {
  await withWorld(async (w) => {
    await w.say(BOOK);
    await w.control("/_standin/razorpay/pay", { link_id: w.linkFor("b-1")!.id, deliver: false });
    await w.deliverPaymentEvents();
    await w.advance(24 * 60 + 5);
    const last = w.fakes.messaging.sentTo(CUSTOMER).at(-1)!;
    assert.equal(last.kind, "template");
    assert.equal(last.templateName, "booking_reminder");
    assert.equal(last.text, "Reminder: your haircut at Glow Salon is on Wed 4 Nov, 6:00 pm.");
  });
});

test("an owner who has not written in 24 hours is told by the real template, over HTTP: the notice is accepted, read back as sent, and holds the approved wording", async () => {
  await withWorld(async (w) => {
    await w.control("/_standin/fault", { service: "payments", op: "createPaymentLink", mode: "error", times: 10 });
    await w.say(BOOK); // the owner has not written to the number, so a plain message cannot reach them
    const told = w.fakes.messaging.sentTo(w.owner);
    assert.equal(told.length, 1);
    assert.deepEqual([told[0].kind, told[0].templateName, told[0].language], ["template", "owner_not_booked", "en"]);
    assert.equal(told[0].text, `Could not set up ${CUSTOMER}'s haircut on Wed 4 Nov, 6:00 pm: the calendar or the payment link did not work. Nothing is booked.`);
    assert.ok(w.record.entries().some((e) => e.action === "send_message" && e.outcome === "confirmed" && e.refs.messageId === told[0].id), "read back as sent");
    assert.deepEqual(w.record.entries().filter((e) => e.action === "send_message" && e.outcome !== "confirmed").map((e) => [e.outcome, e.notes]), [], "it used to be recorded as failed: the provider did not know the generic template");
    assert.ok(w.textsTo(CUSTOMER).some((t) => /nothing is booked/.test(t)), "the customer is told as before");
  });
});
