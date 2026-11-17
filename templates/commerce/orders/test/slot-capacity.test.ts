// A slot's own limit of orders (17 Nov 2026, settings `maxOrders` on a slot): counted from the orders as the day's count is, checked in the same step as the order, not
// offered when full, free again when a hold runs out or an order is cancelled, and a shop that sets none behaves exactly as before. Uses the dev harness with the fakes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AMIT, RAJESH, SUNITA, createWorld } from "../src/harness.ts";
import type { World } from "../src/harness.ts";
import { parseSettings } from "../src/settings.ts";
import { orderOffer } from "../src/channel.ts";

const base = () => JSON.parse(readFileSync(new URL("../settings/annapurna-tiffins-razorpay.example.json", import.meta.url), "utf8")) as Record<string, any>;
/** The example shop with its pickup lunch slot limited to `max` orders a day. */
const limited = (max: number) => {
  const raw = base();
  raw.pickup.slots[0].maxOrders = max;
  return parseSettings(raw);
};
const LUNCH = "2 veg thali 10 nov 12:00 pm pickup";
const FULL = /^Sorry, the slot for .* is full\. Please pick another time or day\.$/u;
const inSlot = (w: World, slotId: string) => [...w.store.orders.values()].filter((o) => o.slotId === slotId && (o.state === "awaiting_advance" || o.state === "confirmed")).length;

test("the settings: maxOrders is a whole number from 1 on a slot, and a bad one is said plainly", () => {
  const raw = base();
  raw.pickup.slots[0].maxOrders = 0;
  assert.throws(() => parseSettings(raw), /maxOrders/u);
  raw.pickup.slots[0].maxOrders = 2.5;
  assert.throws(() => parseSettings(raw), /maxOrders/u);
  assert.equal(limited(3).pickup.slots[0].maxOrders, 3);
  assert.equal(parseSettings(base()).pickup.slots[0].maxOrders, undefined, "left out: no limit of its own, and the settings' bytes are as before");
});

test("the second order for a full slot is refused in the same step, nothing is held and no link is made; another slot is still open", async () => {
  const w = createWorld({ settings: limited(1) });
  await w.say(LUNCH, { from: AMIT });
  assert.equal(w.orderOf(AMIT)!.state, "awaiting_advance");
  await w.say(LUNCH, { from: RAJESH });
  assert.match(w.lastTextTo(RAJESH), FULL);
  assert.equal(w.orderOf(RAJESH)!.state, "enquiry");
  assert.equal(w.orderOf(RAJESH)!.slotId, undefined, "the slot is asked for again, as after a closed cut-off");
  assert.equal(w.payments.links().length, 1, "no link for the refused order");
  assert.equal(inSlot(w, "lunch"), 1);
  assert.ok(w.record.entries().some((e) => e.action === "check_order" && e.outcome === "blocked" && e.decisions.some((d) => d.ruleId === "within-day-cap" && /in the slot/u.test(d.reason))), "the record names the limit that stopped it");
  // the dinner slot has no limit of its own
  await w.say("2 veg thali 10 nov 7 pm pickup", { from: RAJESH });
  assert.equal(w.orderOf(RAJESH)!.state, "awaiting_advance");
});

test("a full slot is not offered in the list of slots, and when every open slot is full the customer is told it is full, not closed", async () => {
  const raw = base();
  raw.pickup.slots[0].maxOrders = 1;
  raw.pickup.slots[1].maxOrders = 1;
  const w = createWorld({ settings: parseSettings(raw) });
  await w.say(LUNCH, { from: AMIT });
  await w.say("2 veg thali 10 nov pickup", { from: RAJESH });
  const list = w.messaging.sentTo(RAJESH).filter((m) => m.interactive?.list).at(-1)!.interactive!.list!;
  assert.ok(!list.rows.some((r) => r.id === "slot:lunch"), "the full slot is not a row");
  assert.ok(list.rows.some((r) => r.id === "slot:dinner"));
  await w.say("2 veg thali 10 nov 7 pm pickup", { from: SUNITA });
  assert.equal(w.orderOf(SUNITA)!.state, "awaiting_advance");
  await w.say("2 veg thali 10 nov pickup", { from: RAJESH });
  assert.match(w.lastTextTo(RAJESH), FULL, "both slots of the day are full: it is not 'closed'");
});

test("the place is free again when the hold runs out, and when the order is cancelled", async () => {
  const w = createWorld({ settings: limited(1) });
  await w.say(LUNCH, { from: AMIT });
  await w.advance(31); // the hold is 30 minutes
  await w.say(LUNCH, { from: RAJESH });
  assert.equal(w.orderOf(RAJESH)!.state, "awaiting_advance", "the expired hold no longer holds the slot");
  await w.say("cancel", { from: RAJESH });
  await w.say(LUNCH, { from: SUNITA });
  assert.equal(w.orderOf(SUNITA)!.state, "awaiting_advance");
});

test("the page's offer shows a full slot as not open, and a shop with no limit shows what it always did", async () => {
  const w = createWorld({ settings: limited(1) });
  await w.say(LUNCH, { from: AMIT });
  const offer = orderOffer(w.settings, w.store, w.clock.now(), false);
  const day = offer.days.find((d) => d.date === "2026-11-10")!;
  assert.equal(day.slots.find((s) => s.id === "lunch")!.open, false);
  assert.equal(day.slots.find((s) => s.id === "dinner")!.open, true);
  const plain = createWorld();
  await plain.say(LUNCH, { from: AMIT });
  assert.equal(orderOffer(plain.settings, plain.store, plain.clock.now(), false).days.find((d) => d.date === "2026-11-10")!.slots.find((s) => s.id === "lunch")!.open, true);
});

test("a shop with no slot limit records nothing extra: the order's checks are the same as before", async () => {
  const w = createWorld({ settings: parseSettings(base()) });
  await w.say(LUNCH, { from: AMIT });
  const check = w.record.entries().find((e) => e.action === "hold_stock")!;
  assert.ok(check.decisions.every((d) => !/in the slot/u.test(d.reason)));
});
