// The agent, one conversation at a time on the in-memory fakes (the situations, which try the rules under stress, are in situations.test.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { AMIT, RAJESH, SUNITA, annapurna, annapurnaRazorpay, createWorld, sweetCrumbs } from "../src/harness.ts";
import { takenOf } from "../src/order.ts";

const ORDER = "2 veg thali 10 nov 12:00 pm pickup";

test("an order is understood from one sentence, held, quoted at the menu price, and confirmed only by the payment record (Razorpay)", async () => {
  const w = createWorld({ settings: annapurnaRazorpay() });
  await w.say(ORDER);
  const o = w.orderOf(AMIT)!;
  assert.deepEqual([o.state, o.totalInr, o.advanceInr], ["awaiting_advance", 240, 120]);
  assert.equal(w.linkFor(AMIT)!.amount, 12000);
  assert.match(w.lastTextTo(AMIT), /2 × veg thali for Tue 10 Nov, 12:00 pm to 1:00 pm, pickup\. Total ₹240/);
  assert.equal(takenOf(w.store, o.date!, "veg-thali", w.clock.now()), 2);
  await w.say("I have paid");
  assert.equal(w.orderOf(AMIT)!.state, "awaiting_advance", "a word is not a payment");
  w.pays(AMIT);
  await w.deliverPaymentEvents();
  assert.equal(w.orderOf(AMIT)!.state, "confirmed");
  assert.match(w.textsTo(AMIT).at(-1)!, /Confirmed!.*₹120 is to pay on pickup/);
  assert.match(w.textsTo(w.owner).at(-1)!, /New order o-1 from \+919844444444/);
});

test("the slot is found by its name, its time or the list, and the way by a word or a button", async () => {
  const w = createWorld({ settings: annapurnaRazorpay() });
  await w.say("1 veg thali 10 nov lunch");
  assert.equal(w.orderOf(AMIT)!.state, "enquiry", "the shop delivers: pickup or delivery is asked");
  await w.tap("pickup");
  assert.equal(w.orderOf(AMIT)!.slotId, "lunch");
  assert.equal(w.orderOf(AMIT)!.state, "awaiting_advance");
  const v = createWorld({ settings: annapurnaRazorpay() });
  await v.say("1 chicken meal 10 nov delivery");
  await v.tap("slot:dinner-home");
  assert.equal(v.orderOf(AMIT)!.awaitingAddress, true);
  await v.say("Flat 2, Infopark road");
  assert.equal(v.orderOf(AMIT)!.area, "Infopark");
  assert.equal(v.orderOf(AMIT)!.state, "awaiting_advance");
});

test("the weekday is read back before anything is held", async () => {
  const w = createWorld({ settings: annapurnaRazorpay() });
  await w.say("2 veg thali tuesday 12 pm pickup");
  assert.equal(w.orderOf(AMIT)!.dateNeedsConfirmation, true);
  assert.equal(w.payments.links().length, 0);
  await w.say("yes");
  assert.equal(w.orderOf(AMIT)!.state, "awaiting_advance");
});

test("Hindi: the order, the quote and the confirmation are in Hindi", async () => {
  const w = createWorld({ settings: annapurnaRazorpay() });
  await w.say("2 वेज थाली 10 nov 12:00 pm पिकअप", { from: SUNITA });
  assert.match(w.lastTextTo(SUNITA), /कुल ₹240/);
  assert.equal(w.orderOf(SUNITA)!.language, "hi");
});

test("a customer who writes again while an order is held gets the same link; a changed order replaces it and frees the old stock", async () => {
  const w = createWorld({ settings: annapurnaRazorpay() });
  await w.say(ORDER);
  await w.say(ORDER);
  assert.equal(w.payments.links().length, 1);
  await w.say("3 veg thali 10 nov 12:00 pm pickup");
  assert.equal(w.payments.links().filter((l) => l.status !== "cancelled").length, 1);
  assert.equal(takenOf(w.store, w.orderOf(AMIT)!.date!, "veg-thali", w.clock.now()), 3, "the first order's 2 are free again, the new order holds 3");
});

test("a bakery that takes the whole order up front asks for all of it, and pickup is the only way", async () => {
  const w = createWorld({ settings: sweetCrumbs() });
  await w.say("2 plum cake 12 nov 10:00 am");
  assert.equal(w.orderOf(AMIT)!.advanceInr, 900);
  assert.equal(w.linkFor(AMIT)!.amount, 90000);
  w.pays(AMIT);
  await w.deliverPaymentEvents();
  assert.match(w.textsTo(AMIT).at(-1)!, /Paid in full/);
});

test("the owner's UPI mark confirms, and a different amount does not", async () => {
  const w = createWorld({ settings: annapurna() });
  await w.say(ORDER);
  assert.equal(w.store.upi!.requests[0].amountPaise, 12000);
  await w.say("", { image: true });
  assert.equal(w.orderOf(AMIT)!.state, "awaiting_advance");
  await w.ownerSays(`received ${w.upiRequest(AMIT)!.code} 50`);
  assert.equal(w.orderOf(AMIT)!.state, "awaiting_advance");
  await w.ownerMarksReceived(AMIT, { tap: true });
  assert.equal(w.orderOf(AMIT)!.state, "confirmed");
});

test("two customers, one stock: the second is told how many are left", async () => {
  const w = createWorld({ settings: annapurnaRazorpay() });
  await w.say("8 veg thali 10 nov 12:00 pm pickup");
  await w.say("5 veg thali 10 nov 12:00 pm pickup", { from: RAJESH });
  assert.match(w.lastTextTo(RAJESH), /only 4 veg thali left/);
  assert.equal(w.payments.links().length, 1);
});

test("a voice note is answered with 'please type'; STOP is final", async () => {
  const w = createWorld({ settings: annapurnaRazorpay() });
  w.messaging.receive(AMIT, "", { voiceNote: true });
  await w.agent.handle({ kind: "message", message: w.messaging.receive(AMIT, "", { voiceNote: true }) });
  assert.match(w.lastTextTo(AMIT), /type your message/);
  await w.say("STOP");
  const n = w.textsTo(AMIT).length;
  await w.say(ORDER);
  assert.equal(w.textsTo(AMIT).length, n);
});
