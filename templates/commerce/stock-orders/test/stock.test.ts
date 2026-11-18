// Stock orders and the shop's stock count (modules/stock), through the real agent on the example salon: goods the owner marks received are added to the count of a COUNTED item, once, by
// what they marked (a part delivery then the rest adds each piece once; a repeated mark and a wrong item add nothing); an item nobody counts is untouched; and a counted item that falls to its
// low mark starts ONE reorder through the existing flow (its card, its budget, the owner's yes), never an approval by itself. Written, not run, in the 18 Nov build stream: the lead's test
// pass runs it. Not tested on a real model or provider: the owner's words go through the rule reader and the supplier and messaging are the harness's fakes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { assistantOf } from "../../../../modules/assistant/state.ts";
import { ownerAuthority } from "../../../../modules/memory/memory.ts";
import { STOCK_ACTION, countOf, pendingAlerts, reconcileSales, shopRecord, startCounting, supplyStockId } from "../../../../modules/stock/stock.ts";
import { RAVI, createWorld } from "../src/harness.ts";
import type { World } from "../src/harness.ts";

const owner = ownerAuthority("app");
const count = (w: World, item: string, n: number, extra: { unit?: string; low?: number } = {}) => {
  const r = startCounting(assistantOf(w.store).stock ??= { lines: [], alerts: [] }, owner, supplyStockId(item), { count: n, ...extra }, { nowMs: w.clock.now() });
  assert.ok(r.ok, JSON.stringify(r));
};
const stockOfWorld = (w: World) => assistantOf(w.store).stock;

async function sentOrder(w: World): Promise<void> {
  await w.ownerSays("order 10 boxes of hair colour from Ravi Traders");
  await w.ownerSays(w.approveText());
  await w.supplierSays(RAVI, "ok");
}

test("goods marked received raise a counted item's count by what was marked: a part delivery, then the rest, each piece once", async () => {
  const w = createWorld();
  count(w, "hair-colour", 3, { unit: "box" });
  await sentOrder(w);
  assert.equal(countOf(stockOfWorld(w), supplyStockId("hair-colour")), 3, "an order that is only sent changes nothing");
  await w.ownerSays("received po-1 4");
  assert.equal(countOf(stockOfWorld(w), supplyStockId("hair-colour")), 7, "4 arrived");
  await w.tick();
  await w.tick();
  assert.equal(countOf(stockOfWorld(w), supplyStockId("hair-colour")), 7, "the next ticks add nothing");
  await w.ownerSays("received po-1");
  assert.equal(countOf(stockOfWorld(w), supplyStockId("hair-colour")), 13, "the 6 that were left arrive");
  await w.ownerSays("received po-1");
  assert.equal(countOf(stockOfWorld(w), supplyStockId("hair-colour")), 13, "a full order marked again adds nothing");
});

test("a delivery marked twice by a redelivered message adds once", async () => {
  const w = createWorld();
  count(w, "hair-colour", 0, { unit: "box" });
  await sentOrder(w);
  const m = await w.ownerSays("received po-1 4");
  await w.redeliver(m);
  assert.equal(countOf(stockOfWorld(w), supplyStockId("hair-colour")), 4);
});

test("a wrong item adds nothing beyond what was already marked received", async () => {
  const w = createWorld();
  count(w, "hair-colour", 1, { unit: "box" });
  await sentOrder(w);
  await w.ownerSays("received po-1 2");
  await w.ownerSays("wrong po-1");
  assert.equal(countOf(stockOfWorld(w), supplyStockId("hair-colour")), 3);
});

test("an item nobody counts is untouched: no stock state is made by a delivery or a tick", async () => {
  const w = createWorld();
  await sentOrder(w);
  await w.ownerSays("received po-1");
  await w.tick();
  assert.equal(w.store.assistant?.stock, undefined);
  assert.equal(w.record.entries().some((e) => e.action === STOCK_ACTION), false, "no stock line in the record for a shop that counts nothing");
});

test("a delivery in another unit than the count is not added, and the owner is told once in their app", async () => {
  const w = createWorld();
  count(w, "hair-colour", 5, { unit: "piece" });
  await sentOrder(w); // ordered by the box
  await w.ownerSays("received po-1 4");
  await w.tick();
  assert.equal(countOf(stockOfWorld(w), supplyStockId("hair-colour")), 5, "a box is never converted into pieces");
  const told = assistantOf(w.store).talk.filter((l) => l.from === "assistant" && /piece/u.test(l.text));
  assert.equal(told.length, 1, "said once, not on every tick");
  assert.equal(w.record.entries().filter((e) => e.action === STOCK_ACTION && e.outcome === "blocked").length, 1);
});

test("a counted item at its low mark starts one reorder through the existing flow: a card for the owner's yes, never an approval by itself", async () => {
  const w = createWorld();
  count(w, "hair-oil", 8, { low: 2, unit: "bottle" });
  const st = stockOfWorld(w)!;
  reconcileSales(st, shopRecord("orders"), [{ key: "sale:o-1:x", id: supplyStockId("hair-oil"), qty: 6, standing: true, cancelled: false, holding: false }], { nowMs: w.clock.now() }); // 2 left
  assert.equal(pendingAlerts(st, "supply").length, 1);
  await w.tick();
  assert.equal(pendingAlerts(st, "supply").length, 0, "the alert was taken off the queue");
  assert.equal(w.order("po-1")?.state, "awaiting_approval", "an order was proposed (the one line of hair oil, its own reorder quantity)");
  assert.equal(w.order("po-1")?.lowStock, true);
  assert.equal(w.order("po-1")?.qty, 6);
  assert.equal(w.orderMessagesTo("+919876500002").length, 0, "nothing is sent to the supplier before the owner says yes");
  assert.ok(assistantOf(w.store).talk.some((l) => /low/u.test(l.text)), "the owner's app says which item is low");
  await w.tick();
  await w.tick();
  assert.equal(w.orders().length, 1, "once per crossing: more ticks make no second order");
});

test("one crossing makes one reorder, even when the owner cancels it: the same crossing never makes a second", async () => {
  const w = createWorld();
  count(w, "hair-oil", 2, { low: 2, unit: "bottle" }); // starts at the mark: crossing 1
  await w.tick();
  assert.equal(w.orders().length, 1);
  await w.ownerSays("cancel po-1"); // the owner does not want it
  const st = stockOfWorld(w)!;
  assert.equal(pendingAlerts(st).length, 0);
  await w.tick();
  assert.equal(w.orders().length, 1, "still the same crossing: no new order");
});

test("an item with two suppliers asks which one, like the owner's own 'low shampoo'", async () => {
  const w = createWorld();
  count(w, "shampoo", 1, { low: 2, unit: "bottle" });
  await w.tick();
  assert.equal(w.orders().length, 0, "nothing is made until the owner picks a supplier");
  assert.equal(w.store.asking?.kind, "line");
  assert.equal(w.store.asking?.lowStock, true);
});
