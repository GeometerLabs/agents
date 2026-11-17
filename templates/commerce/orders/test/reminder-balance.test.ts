// Two things an order does after it is confirmed (17 Nov 2026): the reminder before its slot (settings `reminder`), and the balance paid when it is collected or delivered
// (the owner's "balance o-1 cash|upi|link"). The reminder is one message, only for an order that still stands, and none at all in a shop that did not ask for it. The balance
// is its own record, never part of "advance collected", marked only by the owner or by the payments service's own list. Uses the dev harness with the fakes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { monthRange } from "../../../../modules/report/months.ts";
import { AMIT, createWorld } from "../src/harness.ts";
import type { World } from "../src/harness.ts";
import { parseSettings } from "../src/settings.ts";
import { buildOrdersReport } from "../report/data.ts";
import { reportPage } from "../report/html.ts";
import { ownerText } from "../report/text.ts";
import { seal } from "../../../../modules/report/sign.ts";

const raw = (file: string) => JSON.parse(readFileSync(new URL(`../settings/${file}.example.json`, import.meta.url), "utf8")) as Record<string, unknown>;
const razorpay = (extra: Record<string, unknown> = {}) => createWorld({ settings: parseSettings({ ...raw("annapurna-tiffins-razorpay"), ...extra }) });
const LUNCH = "2 veg thali 10 nov 12:00 pm pickup"; // Tue 10 Nov, 12:00; the world starts Mon 9 Nov, 10:00
const DAY = { year: 2026, month: 11, day: 10 };
const REMINDER = /^Reminder: your order \(2 × .*\) is for .*, pickup\. ₹120 is to pay on pickup\.$/u;

async function confirmed(w: World): Promise<void> {
  await w.say(LUNCH);
  if (w.settings.payment.module === "upi") await w.ownerMarksReceived(AMIT);
  else { w.pays(AMIT); await w.deliverPaymentEvents(); }
  assert.equal(w.orderOf(AMIT)!.state, "confirmed");
}

// ---- the reminder ----

test("the settings: reminder.hoursBefore is a whole number of hours; left out, the shop has none", () => {
  assert.equal(parseSettings({ ...raw("annapurna-tiffins-razorpay"), reminder: { hoursBefore: 2 } }).reminder?.hoursBefore, 2);
  assert.equal(parseSettings(raw("annapurna-tiffins-razorpay")).reminder, undefined);
  assert.throws(() => parseSettings({ ...raw("annapurna-tiffins-razorpay"), reminder: { hoursBefore: 0 } }), /reminder\.hoursBefore/u);
  assert.throws(() => parseSettings({ ...raw("annapurna-tiffins-razorpay"), reminder: { hours: 2 } }), /reminder/u);
});

test("a confirmed order is reminded once, two hours before its slot, and not before", async () => {
  const w = razorpay({ reminder: { hoursBefore: 2 } });
  await confirmed(w);
  const sent = w.textsTo(AMIT).length;
  await w.goto(DAY, { hour: 9, minute: 0 }); // three hours before
  assert.equal(w.textsTo(AMIT).length, sent, "too early");
  await w.goto(DAY, { hour: 10, minute: 5 });
  assert.equal(w.textsTo(AMIT).length, sent + 1);
  assert.match(w.lastTextTo(AMIT), REMINDER);
  await w.goto(DAY, { hour: 11, minute: 0 });
  assert.equal(w.textsTo(AMIT).length, sent + 1, "once");
});

test("a cancelled order is not reminded, and a moment that has already passed is never scheduled", async () => {
  const w = razorpay({ reminder: { hoursBefore: 2 } });
  await confirmed(w);
  await w.say("cancel");
  const sent = w.textsTo(AMIT).length;
  await w.goto(DAY, { hour: 10, minute: 5 });
  assert.equal(w.textsTo(AMIT).length, sent);
  assert.equal(w.orderOf(AMIT)!.reminders, undefined, "cleared with the order's end");
  // a moment already past when the order is confirmed (30 hours before a slot that is 26 hours away) is never scheduled, so nothing is sent late
  const late = razorpay({ reminder: { hoursBefore: 30 } });
  await confirmed(late);
  assert.deepEqual(late.orderOf(AMIT)!.reminders, []);
  const sentLate = late.textsTo(AMIT).length;
  await late.goto(DAY, { hour: 10, minute: 5 });
  assert.equal(late.textsTo(AMIT).length, sentLate);
});

test("a shop with no reminder setting sends none, whatever the hour", async () => {
  const w = razorpay();
  await confirmed(w);
  const sent = w.textsTo(AMIT).length;
  await w.goto(DAY, { hour: 10, minute: 5 });
  assert.equal(w.textsTo(AMIT).length, sent);
  assert.equal(w.orderOf(AMIT)!.reminders, undefined);
});

test("a customer who sent STOP is not reminded", async () => {
  const w = razorpay({ reminder: { hoursBefore: 2 } });
  await confirmed(w);
  await w.say("STOP");
  const sent = w.textsTo(AMIT).length;
  await w.goto(DAY, { hour: 10, minute: 5 });
  assert.equal(w.textsTo(AMIT).length, sent);
});

// ---- the balance ----

test("the owner marks the balance received in cash: its own record, thanks to the customer, and only once", async () => {
  const w = razorpay();
  await confirmed(w);
  await w.ownerSays("balance o-1 cash");
  assert.equal(w.orderOf(AMIT)!.balance?.paid?.by, "cash");
  assert.match(w.lastTextTo(AMIT), /^Thank you! The balance of ₹120 for your order o-1 \(.*\) is received\. Nothing more to pay\.$/u);
  assert.equal(w.lastTextTo(w.owner), "Noted: the balance ₹120 for order o-1 from +919844444444 is recorded as received.");
  const lines = w.record.entries().filter((e) => e.action === "record_balance" && e.outcome === "confirmed");
  assert.equal(lines.length, 1);
  assert.equal(lines[0].refs.balancePaise, "12000");
  assert.equal(lines[0].refs.by, "cash");
  await w.ownerSays("balance o-1 upi");
  assert.match(w.lastTextTo(w.owner), /no balance to mark/u);
  assert.equal(w.record.entries().filter((e) => e.action === "record_balance" && e.outcome === "confirmed").length, 1, "never twice");
});

test("a customer cannot mark the balance, and nor can a word on an order with nothing left to pay", async () => {
  const w = razorpay();
  await confirmed(w);
  await w.say("balance o-1 cash");
  assert.equal(w.orderOf(AMIT)!.balance, undefined);
  const full = razorpay({ advance: { mode: "full", percent: 100, holdMinutes: 30 } });
  await confirmed(full);
  await full.ownerSays("balance o-1 cash");
  assert.match(full.lastTextTo(full.owner), /no balance to mark/u);
});

test("the balance can be marked after the slot, on a finished order; a UPI shop marks it too, and cannot ask for a link", async () => {
  const w = createWorld({ settings: parseSettings(raw("annapurna-tiffins")) });
  await confirmed(w);
  await w.goto(DAY, { hour: 14, minute: 0 });
  assert.equal(w.orderOf(AMIT)!.state, "completed");
  await w.ownerSays("balance o-1 link");
  assert.match(w.lastTextTo(w.owner), /no balance to mark/u, "a UPI shop has no payment link of its own to send");
  await w.ownerSays("balance o-1 upi");
  assert.equal(w.orderOf(AMIT)!.balance?.paid?.by, "upi");
});

test("a gateway shop's owner asks for a link; the payments service's own list shows it paid; the balance is then recorded, as the provider's, and nothing is refunded", async () => {
  const w = razorpay();
  await confirmed(w);
  await w.ownerSays("balance o-1 link");
  const link = w.payments.links().find((l) => l.reference_id === "o-1.b");
  assert.ok(link, "a link for the balance");
  assert.equal(link.amount, 12_000);
  assert.match(w.lastTextTo(AMIT), /^The balance for your order \(.*\) is ₹120\. You can pay it here: https?:\/\/\S+$/u);
  assert.equal(w.orderOf(AMIT)!.balance?.paid, undefined, "a link is not a payment");
  w.payments.customerPays(link.id);
  await w.deliverPaymentEvents();
  assert.equal(w.orderOf(AMIT)!.balance?.paid?.by, "provider");
  assert.equal(w.orderOf(AMIT)!.advancePaymentId !== undefined && w.orderOf(AMIT)!.state, "confirmed", "the advance is as it was");
  assert.equal(w.payments.refunds().length, 0, "the balance is not read as a second advance");
  assert.match(w.lastTextTo(AMIT), /^Thank you! The balance of ₹120/u);
  const line = w.record.entries().find((e) => e.action === "record_balance" && e.outcome === "confirmed")!;
  assert.equal(line.refs.by, "provider");
  assert.ok(line.refs.paymentId);
});

test("the report shows the advance and the balance as two figures; the balance is not in 'advance collected' and no longer 'to collect'", async () => {
  const w = razorpay();
  await confirmed(w);
  const make = () => buildOrdersReport({ settings: w.settings, entries: w.record.entries(), orders: [...w.store.orders.values()], ...monthRange("2026-11", w.settings.timezone), source: "stand-in", madeAt: Date.UTC(2026, 10, 30) });
  const before = make();
  assert.equal(before.money.balanceCollected, undefined, "no balance, no field: the bytes of an older report are kept");
  assert.deepEqual(before.sold.toCollect, { count: 1, paise: 12_000 });
  await w.ownerSays("balance o-1 cash");
  const after = make();
  assert.deepEqual(after.money.collected, before.money.collected, "the advance is the advance");
  assert.deepEqual(after.money.balanceCollected, { count: 1, paise: 12_000 });
  assert.deepEqual(after.sold.toCollect, { count: 0, paise: 0 });
  assert.match(ownerText(after, "en"), /Balance collected at pickup: ₹120/u);
  const html = reportPage(seal(after), "en");
  assert.match(html, /Balance collected at pickup/u);
});
