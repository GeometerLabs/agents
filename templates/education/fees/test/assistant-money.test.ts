// Cancel and refund from the owner's chat on a Fees centre (17 Nov 2026): the shop's assistant takes the agent's own paths as `acts` (src/assistant.ts, src/agent.ts
// feesActs), with the same card binding as Bookings: nothing happens before the tap, the amount sent is the amount bound, a change since voids the card, one refund for a
// payment, cash is never refunded through a payments service, and a skill with no acts still says it cannot be done here. Dev harness with the in-memory fakes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ROHAN_PARENT, createWorld } from "../src/harness.ts";
import type { World } from "../src/harness.ts";
import { parseSettings } from "../src/settings.ts";
import { feesSkill } from "../src/assistant.ts";

const bright = () => JSON.parse(readFileSync(new URL("../settings/bright-tuition.example.json", import.meta.url), "utf8")) as Record<string, unknown>;
const withAssistant = () => createWorld({ settings: parseSettings({ ...bright(), assistant: {} }) });
const cards = (w: World) => w.messaging.sentTo(w.owner).filter((m) => m.interactive?.buttons?.some((b) => b.id.startsWith("card-")));
const lastCard = (w: World) => cards(w).at(-1)!.interactive!.buttons!;
const owner = (w: World, text: string) => w.ownerSays(text);

/** The month opened and reminded; Rohan Mehta's fee (class 10, ₹1,800) is the one we work on. */
async function opened(w: World) {
  await w.advance(61);
  return w.dueOf("Rohan Mehta")!;
}

test("cancel: a card; nothing happens before the tap; the tap takes off exactly the balance and closes the fee; a second tap does nothing", async () => {
  const w = withAssistant();
  const due = await opened(w);
  await owner(w, `cancel ${due.id}`);
  const buttons = lastCard(w);
  // the card shows the balance it waives, and that no money moves (it read "Nothing is owed." before 23 Nov 2026)
  assert.match(cards(w).at(-1)!.text, /and waive the ₹1,800 balance\? No money moves\./u);
  assert.equal(due.state, "open", "nothing changes before the tap");
  assert.equal(due.waivedInr, 0);
  await w.tap(buttons[0].id, { from: w.owner });
  assert.equal(due.state, "closed");
  assert.equal(due.waivedInr, 1800, "exactly the balance the card was bound to");
  assert.equal(w.payments.refunds().length, 0, "a cancel refunds nothing");
  assert.ok(w.messaging.sentTo(w.owner).some((m) => m.text === `Cancelled ${due.id}.`), "and the owner is told it was cancelled, not that money is on its way back");
  assert.ok(w.record.entries().some((e) => e.action === "waive_fee" && e.refs.by === "owner"));
  const before = cards(w).length;
  await w.tap(buttons[0].id, { from: w.owner });
  assert.equal(due.waivedInr, 1800, "a second tap does nothing");
  assert.equal(cards(w).length, before);
});

test("cancel: a card made before a payment is void on its tap", async () => {
  const w = withAssistant();
  const due = await opened(w);
  await owner(w, `cancel ${due.id}`);
  const buttons = lastCard(w);
  w.pays("Rohan Mehta", { amountInr: 900 });
  await w.deliverPaymentEvents();
  await w.tap(buttons[0].id, { from: w.owner });
  assert.equal(due.state, "open", "the balance changed, so the old card did nothing");
  assert.equal(due.waivedInr, 0);
});

test("a fee that is not open cannot be cancelled, and an open fee has nothing to refund", async () => {
  const w = withAssistant();
  const due = await opened(w);
  const skill = feesSkill({ settings: w.settings, store: w.store, nowMs: () => w.clock.now(), optedOut: () => false, entries: () => w.record.entries(), acts: { owner: w.owner, ownerRefunds: false, cancelFee: async () => false, refund: async () => "denied" } });
  assert.deepEqual(skill.prepare({ kind: "refund", case: due.id }), { ok: false, why: "nothing_paid" });
  w.pays("Rohan Mehta");
  await w.deliverPaymentEvents();
  assert.equal(due.state, "paid");
  assert.deepEqual(skill.prepare({ kind: "cancel", case: due.id }), { ok: false, why: "not_live" });
});

test("refund: of a paid fee, above the refund limit Guard holds it for the owner; the amount sent is the amount bound; one refund for a payment", async () => {
  const w = withAssistant();
  const due = await opened(w);
  w.pays("Rohan Mehta");
  await w.deliverPaymentEvents();
  await owner(w, `refund ${due.id}`);
  const buttons = lastCard(w);
  assert.equal(w.payments.refunds().length, 0, "nothing before the tap");
  await w.tap(buttons[0].id, { from: w.owner });
  assert.equal(w.heldForOwner().length, 1, "₹1,800 is above the ₹500 limit: Guard holds it for the owner's own approval");
  assert.equal(w.heldForOwner()[0].amountPaise, 180_000);
  await w.ownerAnswers("approve");
  assert.deepEqual(w.payments.refunds().map((r) => r.amount), [180_000]);
  const before = cards(w).length;
  await owner(w, `refund ${due.id}`);
  assert.equal(cards(w).length, before, "the payment is already refunded: no second card");
  assert.equal(w.payments.refunds().length, 1);
});

test("refund: whole rupees only, never above the payment, and never of money the owner marked received by hand", async () => {
  const w = withAssistant();
  const due = await opened(w);
  w.pays("Rohan Mehta");
  await w.deliverPaymentEvents();
  const skill = feesSkill({ settings: w.settings, store: w.store, nowMs: () => w.clock.now(), optedOut: () => false, entries: () => w.record.entries(), acts: { owner: w.owner, ownerRefunds: false, cancelFee: async () => false, refund: async () => "denied" } });
  assert.equal(skill.prepare({ kind: "refund", case: due.id, amountPaise: 30_000 }).ok, true);
  // the refusal carries the payment, for the owner's words ("more than was paid on f-2 (₹1,800)"; it said ₹0 before 23 Nov 2026)
  assert.deepEqual(skill.prepare({ kind: "refund", case: due.id, amountPaise: 30_050 }), { ok: false, why: "too_much", paidPaise: 180_000 });
  assert.deepEqual(skill.prepare({ kind: "refund", case: due.id, amountPaise: 200_000 }), { ok: false, why: "too_much", paidPaise: 180_000 });
  // a payment the owner marked by hand has no payments service behind it
  due.payments = [{ id: "cash-1", amountPaise: 180_000, linkId: "cash" }];
  assert.deepEqual(skill.prepare({ kind: "refund", case: due.id }), { ok: false, why: "nothing_paid" });
});

test("a refund or a cancel is not offered while the fee has something waiting for the owner", async () => {
  const w = withAssistant();
  const due = await opened(w);
  due.pending.push({ kind: "waiver", id: "q-1", amountInr: 900, balanceAtAskInr: 1800, askedAtMs: w.clock.now() });
  const skill = feesSkill({ settings: w.settings, store: w.store, nowMs: () => w.clock.now(), optedOut: () => false, entries: () => w.record.entries(), acts: { owner: w.owner, ownerRefunds: false, cancelFee: async () => false, refund: async () => "denied" } });
  assert.deepEqual(skill.prepare({ kind: "cancel", case: due.id }), { ok: false, why: "busy" });
});

test("a skill with no acts (the morning line, the owner's app) still says cancel and refund are not done from here", async () => {
  const w = withAssistant();
  const due = await opened(w);
  const skill = feesSkill({ settings: w.settings, store: w.store, nowMs: () => w.clock.now(), optedOut: () => false });
  assert.deepEqual(skill.prepare({ kind: "cancel", case: due.id }), { ok: false, why: "not_here" });
  assert.deepEqual(skill.prepare({ kind: "refund", case: due.id }), { ok: false, why: "not_here" });
  void ROHAN_PARENT;
});
