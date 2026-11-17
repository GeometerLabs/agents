// The owner cancels an order, or refunds an advance, from the chat (17 Nov 2026), on an Orders shop with the assistant on. The skill's acts are the agent's own paths
// (src/assistant.ts OrdersActs, src/agent.ts): a card shows the exact change, nothing happens before the tap, the tap refunds exactly what the card showed (through the same
// limit and Guard as "approve o-1"), a second tap does nothing. Same shape as Bookings' tests (templates/commerce/bookings/test/assistant.test.ts). Fakes, no outside service.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AMIT, createWorld } from "../src/harness.ts";
import type { World } from "../src/harness.ts";
import { parseSettings } from "../src/settings.ts";
import { ordersSkill } from "../src/assistant.ts";
import { newDraft, register } from "../src/order.ts";

const raw = (file = "annapurna-tiffins-razorpay") => JSON.parse(readFileSync(new URL(`../settings/${file}.example.json`, import.meta.url), "utf8")) as Record<string, unknown>;
const razorpay = (extra: Record<string, unknown> = {}) => createWorld({ settings: parseSettings({ ...raw(), assistant: {}, ...extra }) });
const upi = () => createWorld({ settings: parseSettings({ ...raw("annapurna-tiffins"), assistant: {} }) });
const LUNCH = "2 veg thali 10 nov 12:00 pm pickup"; // the world starts Mon 9 Nov, 10:00: well inside the six-hour window
const owner = (w: World, text: string) => w.say(text, { from: w.owner });

async function orderAndPay(w: World): Promise<void> {
  await w.say(LUNCH);
  w.pays(AMIT);
  await w.deliverPaymentEvents();
  assert.equal(w.orderOf(AMIT)!.state, "confirmed");
}
/** The yes and no ids of the newest card the owner was sent. */
function lastCard(w: World): { yes: string; no?: string; text: string } {
  const card = w.messaging.sentTo(w.owner).filter((m) => m.interactive?.buttons?.some((b) => b.id.startsWith("card-"))).at(-1);
  assert.ok(card, "a card was sent to the owner");
  const buttons = card.interactive!.buttons!;
  return { yes: buttons[0].id, no: buttons[1]?.id, text: card.text };
}
const tapOwner = (w: World, id: string) => w.tap(id, { from: w.owner });
const recordOf = (w: World, action: string) => w.record.entries().filter((e) => e.action === action);

test("cancel a paid order: a card with the exact change; nothing happens before the tap; the tap refunds exactly the amount shown, once, and the customer is told", async () => {
  const w = razorpay();
  await orderAndPay(w);
  await owner(w, "cancel o-1");
  const card = lastCard(w);
  assert.match(card.text, /^Cancel order o-1 \(\+919844444444, .*\) and refund the ₹120 advance\?/u);
  assert.equal(w.orderOf(AMIT)!.state, "confirmed", "nothing changes before the tap");
  assert.equal(w.payments.refunds().length, 0);
  await tapOwner(w, card.yes);
  assert.equal(w.orderOf(AMIT)!.state, "cancelled");
  assert.deepEqual(w.payments.refunds().map((r) => r.amount), [12_000], "the amount sent is the amount shown");
  assert.match(w.lastTextTo(w.owner), /^Done: ₹120 is on its way back to \+919844444444 \(o-1\)\.$/u);
  assert.match(w.lastTextTo(AMIT), /is cancelled\. Your ₹120 advance is being refunded\./u);
  const done = recordOf(w, "owner_card").filter((e) => e.outcome === "confirmed");
  assert.equal(done.length, 1);
  assert.equal(done[0].refs.skill, "orders", "the record says which skill acted");
  assert.ok(recordOf(w, "cancel_order").some((e) => e.refs.by === "owner" && e.refs.via === "assistant"));
  await tapOwner(w, card.yes);
  assert.equal(w.payments.refunds().length, 1, "a second tap does nothing");
  // the stock is free at once: the same slot can be ordered again
  await w.say(LUNCH, { from: "+919833333333" });
  assert.equal(w.orderOf("+919833333333")!.state, "awaiting_advance");
});

test("cancel above the shop's refund limit: the tap sends the same refund Guard holds for the owner's second yes, exactly as 'approve' does", async () => {
  const w = razorpay({ refund: { limitInr: 100 } });
  await orderAndPay(w);
  await owner(w, "cancel o-1");
  await tapOwner(w, lastCard(w).yes);
  assert.equal(w.orderOf(AMIT)!.state, "cancelled");
  assert.equal(w.payments.refunds().length, 0, "held, not sent");
  assert.equal(w.heldForOwner().length, 1);
  assert.equal(w.heldForOwner()[0].amountPaise, 12_000);
  await w.ownerAnswers("approve");
  assert.deepEqual(w.payments.refunds().map((r) => r.amount), [12_000]);
});

test("cancel an order still waiting for its advance: no money moves, the link is closed, the customer is told", async () => {
  const w = razorpay();
  await w.say(LUNCH);
  assert.equal(w.orderOf(AMIT)!.state, "awaiting_advance");
  await owner(w, "cancel o-1");
  const card = lastCard(w);
  assert.match(card.text, /^Cancel order o-1 \(\+919844444444, .*\)\? No advance was paid\./u);
  await tapOwner(w, card.yes);
  assert.equal(w.orderOf(AMIT)!.state, "cancelled");
  assert.equal(w.payments.refunds().length, 0);
  assert.equal(w.payments.links()[0].status, "cancelled");
  assert.match(w.lastTextTo(AMIT), /is cancelled\. Nothing was charged\./u);
});

test("cancel a big order waiting for the owner's yes: it ends, nothing was held", async () => {
  const w = razorpay();
  const o = register(w.store, newDraft(AMIT, "en"));
  o.lines = [{ itemId: w.settings.menu[0].id, qty: 4 }];
  o.totalInr = w.settings.menu[0].priceInr * 4;
  o.date = { year: 2026, month: 11, day: 10 };
  o.state = "awaiting_owner";
  o.pending.push({ kind: "big_order", totalInr: o.totalInr, askedAtMs: w.clock.now() });
  await owner(w, "cancel o-1");
  await tapOwner(w, lastCard(w).yes);
  assert.equal(o.state, "cancelled");
  assert.deepEqual(o.pending, []);
});

test("a refund of an advance the owner kept: a card with the amount, the tap refunds exactly it; and a refund of an order that still stands asks to cancel it", async () => {
  const w = razorpay();
  await orderAndPay(w);
  await owner(w, "refund o-1");
  assert.match(w.lastTextTo(w.owner), /cancel o-1/u, "an order that stands is cancelled, with its own card");
  // the customer cancels late (under six hours before), and the owner declines the refund: the advance is still the shop's
  await w.goto({ year: 2026, month: 11, day: 10 }, { hour: 7, minute: 0 });
  await w.say("cancel");
  await owner(w, "deny o-1");
  assert.equal(w.payments.refunds().length, 0);
  await owner(w, "refund o-1");
  const card = lastCard(w);
  assert.match(card.text, /^Refund ₹120 to \+919844444444 for o-1\?/u);
  await tapOwner(w, card.yes);
  assert.deepEqual(w.payments.refunds().map((r) => r.amount), [12_000]);
});

test("a UPI shop: the owner's cancel of a paid order makes the owner owe the refund (the agent never sends money), and the customer hears it will come from the owner", async () => {
  const w = upi();
  await w.say(LUNCH);
  await w.ownerMarksReceived(AMIT);
  assert.equal(w.orderOf(AMIT)!.state, "confirmed");
  await owner(w, "cancel o-1");
  await tapOwner(w, lastCard(w).yes);
  assert.equal(w.orderOf(AMIT)!.state, "cancelled");
  assert.equal(w.upiRefunds(AMIT).length, 1);
  assert.equal(w.upiRefunds(AMIT)[0].amountPaise, 12_000);
  assert.match(w.lastTextTo(AMIT), /will send/u, "the owner sends it: the customer is told so");
});

test("the skill without acts only reads: a cancel is prepared as a card but nothing can execute it (the morning line, the owner's app)", async () => {
  const w = razorpay();
  await orderAndPay(w);
  const skill = ordersSkill({ settings: w.settings, store: w.store, nowMs: () => w.clock.now(), optedOut: () => false });
  const prepared = skill.prepare({ kind: "cancel", case: "o-1" });
  assert.equal(prepared.ok, true);
  if (prepared.ok) assert.deepEqual(await skill.execute(prepared.action), { ok: false, note: "failed" });
  assert.equal(w.orderOf(AMIT)!.state, "confirmed");
});
