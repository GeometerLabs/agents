// Orders and the shop's stock count (modules/stock): Orders stays the source for what an order HOLDS; the count falls only for an order that stands (confirmed or completed), a cancelled
// order puts its count back, what other orders hold that is not yet in the count is taken off what is left (so two holds cannot both take the last one), and a menu item nobody counts is not
// touched at all (no stock state is made, the day's own stock is the only limit). Written, not run, in the 18 Nov build stream: the lead's test pass runs it. The agent's own call of this
// (reconcileStock, the shelf check in `availability`) is exercised through the same functions on the same Store.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ownerAuthority } from "../../../../modules/memory/memory.ts";
import { emptyStock, countOf, menuStockId, reconcileSales, shopRecord, startCounting, pendingAlerts } from "../../../../modules/stock/stock.ts";
import { checkStock } from "../src/limits.ts";
import { countedLeft, createStore, newDraft, orderFacts, register } from "../src/order.ts";
import type { Order, OrderState, Store } from "../src/order.ts";
import { orderOffer } from "../src/channel.ts";
import { annapurnaRazorpay } from "../src/harness.ts";

const NOW = 1_800_000_000_000;
const shop = shopRecord("orders");

function order(store: Store, state: OrderState, lines: { itemId: string; qty: number }[], over: Partial<Order> = {}): Order {
  const o = newDraft("+919811111111", "en");
  o.state = state;
  o.lines = lines;
  Object.assign(o, over);
  return register(store, o);
}
const withCount = (store: Store, itemId: string, count: number, low?: number) => {
  store.assistant ??= { seq: 0, cards: [], refused: [], closedDays: [], undo: [], talk: [], limitChanges: [] };
  store.assistant.stock ??= emptyStock();
  const r = startCounting(store.assistant.stock, ownerAuthority("app"), menuStockId(itemId), { count, ...(low !== undefined ? { low } : {}) }, { nowMs: NOW });
  assert.ok(r.ok);
};
const reconcile = (store: Store, nowMs = NOW) => reconcileSales(store.assistant!.stock!, shop, orderFacts(store, nowMs), { nowMs });
const hold = (nowMs = NOW) => ({ holdExpiresAt: nowMs + 3_600_000 });

test("an order that stands takes its count once; the same facts again take nothing more", () => {
  const store = createStore();
  withCount(store, "thali", 10);
  order(store, "confirmed", [{ itemId: "thali", qty: 3 }]);
  assert.equal(reconcile(store), 1);
  assert.equal(countOf(store.assistant!.stock, menuStockId("thali")), 7);
  for (let i = 0; i < 4; i++) assert.equal(reconcile(store), 0);
  assert.equal(countOf(store.assistant!.stock, menuStockId("thali")), 7, "a retry, a restart or the next tick never counts it twice");
});

test("an order completed after it was booked does not take its count a second time", () => {
  const store = createStore();
  withCount(store, "thali", 10);
  const o = order(store, "confirmed", [{ itemId: "thali", qty: 2 }]);
  reconcile(store);
  o.state = "completed";
  reconcile(store);
  assert.equal(countOf(store.assistant!.stock, menuStockId("thali")), 8);
});

test("a cancelled order gives its count back exactly once", () => {
  const store = createStore();
  withCount(store, "thali", 10);
  const o = order(store, "confirmed", [{ itemId: "thali", qty: 4 }]);
  reconcile(store);
  o.state = "cancelled";
  reconcile(store);
  reconcile(store);
  assert.equal(countOf(store.assistant!.stock, menuStockId("thali")), 10);
});

test("an order that waits for its advance holds stock but does not lower the count, and what it holds is taken off what is left for the next order", () => {
  const store = createStore();
  withCount(store, "thali", 1);
  const held = order(store, "awaiting_advance", [{ itemId: "thali", qty: 1 }], hold());
  reconcile(store);
  assert.equal(countOf(store.assistant!.stock, menuStockId("thali")), 1, "a hold is not a sale");
  assert.equal(countedLeft(store, "thali", NOW), 0, "the one thali is held, so a second customer gets sold out");
  assert.equal(countedLeft(store, "thali", NOW, held.id), 1, "the holder itself still sees it, so its own advance can confirm it");
  held.state = "confirmed";
  assert.equal(countedLeft(store, "thali", NOW), 0, "once confirmed but before the next reconcile it still counts once, not twice");
  reconcile(store);
  assert.equal(countOf(store.assistant!.stock, menuStockId("thali")), 0);
  assert.equal(countedLeft(store, "thali", NOW), 0);
});

test("an expired hold frees the shelf again: nothing was ever taken, nothing is held", () => {
  const store = createStore();
  withCount(store, "thali", 1);
  order(store, "awaiting_advance", [{ itemId: "thali", qty: 1 }], { holdExpiresAt: NOW - 1 });
  assert.equal(countedLeft(store, "thali", NOW), 1);
});

test("the shelf count is a second limit with the day's rule id: more than is left is blocked, the day's own stock still applies", () => {
  const store = createStore();
  withCount(store, "thali", 2);
  const left = countedLeft(store, "thali", NOW)!;
  const blocked = checkStock({ itemName: "veg thali", wanted: 3, taken: 0, dailyStock: left });
  assert.equal(blocked.verdict, "block");
  assert.equal(blocked.ruleId, "within-stock", "the same rule id as the day's stock, so a report's table of what was stopped is unchanged");
  assert.equal(checkStock({ itemName: "veg thali", wanted: 2, taken: 0, dailyStock: left }).verdict, "allow");
});

test("a menu item nobody counts is untouched: no stock state is made, nothing is held back, every answer is 'not counted'", () => {
  const store = createStore();
  order(store, "confirmed", [{ itemId: "thali", qty: 5 }]);
  order(store, "awaiting_advance", [{ itemId: "thali", qty: 1 }], hold());
  assert.equal(countedLeft(store, "thali", NOW), undefined);
  assert.equal(store.assistant, undefined, "reading made no assistant state");
  withCount(store, "other", 5);
  assert.equal(countedLeft(store, "thali", NOW), undefined, "another item's count does not count this one");
  assert.equal(reconcile(store), 0, "the other item has no orders");
  assert.equal(countOf(store.assistant!.stock, menuStockId("thali")), undefined);
});

test("the shop's page shows what is left as the smaller of the day's stock and the shelf count", () => {
  const settings = annapurnaRazorpay();
  const store = createStore();
  const item = settings.menu[0];
  const before = orderOffer(settings, store, NOW, false).days[0].left[item.id];
  assert.equal(before, item.dailyStock, "uncounted: exactly the day's stock, as before");
  withCount(store, item.id, 2);
  const after = orderOffer(settings, store, NOW, false).days[0].left[item.id];
  assert.equal(after, Math.min(2, item.dailyStock));
});

test("a plan's meals and an order with the item on two lines: one fact per order and item, quantities added; plan orders are skipped", () => {
  const store = createStore();
  order(store, "confirmed", [{ itemId: "thali", qty: 1 }, { itemId: "thali", qty: 2 }, { itemId: "lassi", qty: 1 }]);
  order(store, "confirmed", [{ itemId: "thali", qty: 9 }], { plan: { id: "p-1", period: 1, typeId: "monthly" } });
  const facts = orderFacts(store, NOW);
  assert.deepEqual(facts.map((f) => [f.key, f.qty]).sort(), [["sale:o-1:lassi", 1], ["sale:o-1:thali", 3]]);
});

test("a counted item that reaches its low mark by a sale queues one alert, once", () => {
  const store = createStore();
  withCount(store, "thali", 5, 2);
  order(store, "confirmed", [{ itemId: "thali", qty: 3 }]);
  reconcile(store);
  reconcile(store);
  assert.equal(pendingAlerts(store.assistant!.stock).length, 1);
});

// ---- history and the horizon ------------------------------------------------------------------------------------------------------------------------

const DAY = 24 * 3_600_000;

test("counting started after an order was picked up: that order never moves the count and is not a hold", () => {
  const store = createStore();
  order(store, "completed", [{ itemId: "thali", qty: 6 }], { slotEndMs: NOW - DAY });
  withCount(store, "thali", 10); // the owner counts 10 on the shelf, started at NOW
  assert.equal(reconcile(store), 0);
  assert.equal(countOf(store.assistant!.stock, menuStockId("thali")), 10);
  assert.equal(countedLeft(store, "thali", NOW), 10, "the finished order is not held against the count");
});

test("an order confirmed before counting began but still to be picked up is booked, since its goods are promised", () => {
  const store = createStore();
  order(store, "confirmed", [{ itemId: "thali", qty: 2 }], { slotEndMs: NOW + DAY });
  withCount(store, "thali", 10);
  assert.equal(countedLeft(store, "thali", NOW), 8, "held until it is booked");
  reconcile(store);
  assert.equal(countOf(store.assistant!.stock, menuStockId("thali")), 8);
});

test("orders that finished long ago are no longer passed to the stock, so their forgotten keys can never book them twice", () => {
  const store = createStore();
  order(store, "completed", [{ itemId: "thali", qty: 1 }], { slotEndMs: NOW - 31 * DAY });
  order(store, "cancelled", [{ itemId: "thali", qty: 1 }], { slotEndMs: NOW - 31 * DAY });
  order(store, "completed", [{ itemId: "thali", qty: 1 }], { slotEndMs: NOW - 29 * DAY });
  assert.deepEqual(orderFacts(store, NOW).map((f) => f.key), ["sale:o-3:thali"], "only the one inside the 30-day horizon");
});

test("more than 400 orders of one item: every one is booked once and the next reconcile books nothing", () => {
  const store = createStore();
  for (let i = 0; i < 500; i++) order(store, "confirmed", [{ itemId: "thali", qty: 1 }], { slotEndMs: NOW + DAY });
  withCount(store, "thali", 100_000);
  assert.equal(reconcile(store), 500);
  assert.equal(countOf(store.assistant!.stock, menuStockId("thali")), 100_000 - 500);
  assert.equal(reconcile(store, NOW + 1000), 0);
});
