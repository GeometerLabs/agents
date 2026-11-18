// The shop's one stock count (modules/stock/stock.ts): who may write, that a sale, a delivery and a correction each count once however often they arrive, that a cancelled order puts its
// count back, that a count never goes below 0, that the low mark fires once per crossing, and that an item nobody counts is left alone. Written, not run, in the 18 Nov build stream:
// the lead's test pass runs it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ownerAuthority, panelAuthority } from "../../memory/memory.ts";
import {
  ackAlert, correct, countOf, emptyStock, leftFor, listingStockId, lowLines, lowRequestId, menuStockId, ownerRows, ownerSold, pendingAlerts, quantityOfListing, received, reconcileDeliveries,
  reconcileSales, sale, setLow, shopRecord, soldOutListings, startCounting, stopCounting, supplyStockId, unbookedHolds,
} from "../stock.ts";
import type { OrderFact } from "../stock.ts";

const NOW = 1_800_000_000_000;
const c = (n = 0) => ({ nowMs: NOW + n });
const owner = ownerAuthority("app");
const shop = shopRecord("orders");
const RICE = supplyStockId("rice25");
const THALI = menuStockId("thali");
const KITTEN = listingStockId("l-3");

function counted(id: string, count: number, extra: { low?: number; unit?: string; name?: string } = {}) {
  const s = emptyStock();
  const r = startCounting(s, owner, id, { count, ...extra }, c());
  assert.ok(r.ok, JSON.stringify(r));
  return s;
}

test("only the owner (or the panel's Operator or builder) starts, corrects or stops a count: a forged object or a customer's words cannot", () => {
  const s = emptyStock();
  const forged = { by: "owner", from: "app" } as never;
  assert.throws(() => startCounting(s, forged, THALI, { count: 5 }, c()));
  assert.throws(() => correct(s, forged, THALI, { to: 1, reqId: "r" }, c()));
  assert.throws(() => stopCounting(s, forged, THALI));
  assert.throws(() => ownerSold(s, forged, THALI, { qty: 1, reqId: "r" }, c()));
  assert.throws(() => setLow(s, undefined as never, THALI, 1, c()));
  assert.ok(startCounting(s, panelAuthority("operator"), THALI, { count: 5 }, c()).ok, "the Operator may, in the panel");
  assert.equal(s.lines.length, 1);
});

test("a sale or a delivery is written only through the shop's own record, never through anything a person can build", () => {
  const s = counted(THALI, 10);
  assert.throws(() => sale(s, { from: "orders" } as never, THALI, "sale:o-1:thali", 2, c()), "a plain object is not the shop's record");
  assert.throws(() => sale(s, "customer says 2" as never, THALI, "sale:o-1:thali", 2, c()));
  assert.throws(() => received(s, { from: "stock-orders" } as never, RICE, "delivery:po-1", 4, undefined, c()));
  assert.equal(countOf(s, THALI), 10);
  assert.ok(sale(s, shop, THALI, "sale:o-1:thali", 2, c()).ok);
  assert.equal(countOf(s, THALI), 8);
});

test("customer-facing code never imports the stock module: the only code that makes a shop record is the two agents' own reconcile step", () => {
  const root = join(import.meta.dirname, "..", "..", "..");
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === "test" || name.startsWith(".")) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out); else if (p.endsWith(".ts")) out.push(p);
    }
    return out;
  };
  const files = [...walk(join(root, "modules")), ...walk(join(root, "templates"))];
  const makers = files.filter((f) => /\bshopRecord\(/u.test(readFileSync(f, "utf8"))).map((f) => f.slice(root.length + 1)).sort();
  assert.deepEqual(makers, ["modules/stock/stock.ts", "templates/commerce/orders/src/agent.ts", "templates/commerce/stock-orders/src/agent.ts"]);
  // the code that reads a customer's, a guest's or a supplier's words has no import of the stock module
  const wordsReaders = files.filter((f) => /modules\/(understanding|language)\/|modules\/channels\/(chat|front-orders|order-page|api|mcp|events)|assistant\/talk-customer|supplier/u.test(f.slice(root.length)) && !/words|check|reading/u.test(f.split("/").pop() ?? "x"));
  for (const f of wordsReaders) assert.ok(!/stock\/stock\.ts|stock\/kit\.ts/u.test(readFileSync(f, "utf8")), `${f} reads someone's words and must not import the stock module`);
});

test("a sale lowers the count once: a retry, a duplicate event and a restart add nothing", () => {
  const s = counted(THALI, 10);
  assert.equal(sale(s, shop, THALI, "sale:o-1:thali", 3, c(1)).ok, true);
  assert.equal(countOf(s, THALI), 7);
  for (let i = 0; i < 5; i++) sale(s, shop, THALI, "sale:o-1:thali", 3, c(2 + i));
  assert.equal(countOf(s, THALI), 7, "the same key and quantity never counts again");
  const restarted = structuredClone(s); // the state is plain JSON: a restart loads exactly this
  sale(restarted, shop, THALI, "sale:o-1:thali", 3, c(9));
  assert.equal(countOf(restarted, THALI), 7);
  assert.equal(s.lines[0].moves.filter((m) => m.kind === "sold").length, 1, "one movement, not six");
});

test("a cancelled order puts back exactly what it took, once; cancelling an order that never took anything changes nothing", () => {
  const s = counted(THALI, 10);
  sale(s, shop, THALI, "sale:o-1:thali", 4, c());
  assert.equal(countOf(s, THALI), 6);
  sale(s, shop, THALI, "sale:o-1:thali", 0, c(1)); // target 0: the order was cancelled
  assert.equal(countOf(s, THALI), 10);
  sale(s, shop, THALI, "sale:o-1:thali", 0, c(2));
  assert.equal(countOf(s, THALI), 10, "a second cancel does not add again");
  sale(s, shop, THALI, "sale:o-2:thali", 0, c(3));
  assert.equal(countOf(s, THALI), 10, "an order that was never booked gives nothing back");
  // an order that stands again after a cancel (a late payment re-confirms it) takes its count again, once
  sale(s, shop, THALI, "sale:o-1:thali", 4, c(4));
  assert.equal(countOf(s, THALI), 6);
});

test("the count never goes below 0: a larger sale takes what is there, notes the shortfall, and a cancel returns only what was taken", () => {
  const s = counted(THALI, 3);
  sale(s, shop, THALI, "sale:o-1:thali", 5, c());
  assert.equal(countOf(s, THALI), 0);
  assert.equal(s.lines[0].moves.at(-1)?.short, 2);
  sale(s, shop, THALI, "sale:o-1:thali", 0, c(1));
  assert.equal(countOf(s, THALI), 3, "only the 3 that came off go back, not 5");
});

test("a delivery raises the count by what was received: a part delivery then the rest adds each piece once, and the same mark twice adds nothing", () => {
  const s = counted(RICE, 2, { unit: "bag" });
  received(s, shop, RICE, "delivery:po-1", 4, "bag", c(1)); // received 4 of 10
  assert.equal(countOf(s, RICE), 6);
  received(s, shop, RICE, "delivery:po-1", 4, "bag", c(2));
  assert.equal(countOf(s, RICE), 6, "the same mark again");
  received(s, shop, RICE, "delivery:po-1", 10, "bag", c(3)); // then received in full: 10 so far
  assert.equal(countOf(s, RICE), 12, "only the 6 more are added");
  received(s, shop, RICE, "delivery:po-1", 7, "bag", c(4));
  assert.equal(countOf(s, RICE), 12, "a smaller cumulative never takes goods away");
});

test("a delivery in another unit than the count is refused, never converted, and said once", () => {
  const s = counted(RICE, 2, { unit: "bag" });
  const r = received(s, shop, RICE, "delivery:po-2", 3, "box", c());
  assert.deepEqual(r, { ok: false, why: "unit" });
  assert.equal(countOf(s, RICE), 2);
  const facts = [{ key: "delivery:po-2", id: RICE, cumulative: 3, unit: "box" }];
  assert.equal(reconcileDeliveries(s, shop, facts, c(1)).length, 1, "the first time the owner is told");
  assert.equal(reconcileDeliveries(s, shop, facts, c(2)).length, 0, "and not again on the next tick");
  assert.equal(countOf(s, RICE), 2);
});

test("an item nobody counts is left alone: no line is made, nothing is changed, the answer is 'not counted'", () => {
  const s = emptyStock();
  const r = sale(s, shop, THALI, "sale:o-1:thali", 2, c());
  assert.deepEqual(r, { ok: true, value: undefined });
  assert.deepEqual(received(s, shop, RICE, "delivery:po-1", 4, "bag", c()), { ok: true, value: undefined });
  assert.deepEqual(s, emptyStock());
  assert.equal(countOf(s, THALI), undefined);
  assert.equal(leftFor(s, THALI, 3), undefined, "the caller's own limits stand as they were");
  assert.equal(leftFor(undefined, THALI), undefined);
  assert.equal(quantityOfListing(undefined, "l-3"), undefined);
  assert.equal(reconcileSales(s, shop, [{ key: "sale:o-1:thali", id: THALI, qty: 2, standing: true, cancelled: false, holding: false }], c()), 0);
  assert.equal(s.lines.length, 0);
});

test("the owner's correction: set a count, a retry with the same request does nothing, a stale correction is refused", () => {
  const s = counted(RICE, 8);
  assert.ok(correct(s, owner, RICE, { to: 5, reqId: "r-1", shown: 8 }, c(1)).ok);
  assert.equal(countOf(s, RICE), 5);
  sale(s, shop, RICE, "sale:o-9:x", 1, c(2)); // a sale came in while the owner looked at 5
  assert.deepEqual(correct(s, owner, RICE, { to: 9, reqId: "r-2", shown: 5 }, c(3)), { ok: false, why: "stale" });
  assert.equal(countOf(s, RICE), 4, "the sale was not overwritten");
  correct(s, owner, RICE, { to: 5, reqId: "r-1", shown: 8 }, c(4));
  assert.equal(countOf(s, RICE), 4, "a retried request is the same request");
  assert.deepEqual(correct(s, owner, RICE, { to: -1, reqId: "r-3" }, c(5)), { ok: false, why: "bad_count" });
  assert.deepEqual(correct(s, owner, RICE, { to: 1.5, reqId: "r-4" }, c(5)), { ok: false, why: "bad_count" });
  assert.deepEqual(correct(s, owner, "menu:nothing", { to: 1, reqId: "r-5" }, c(5)), { ok: false, why: "no_such_line" });
});

test("the owner's 'sold 2' counts once per request", () => {
  const s = counted(KITTEN, 3);
  ownerSold(s, owner, KITTEN, { qty: 2, reqId: "q-1" }, c(1));
  ownerSold(s, owner, KITTEN, { qty: 2, reqId: "q-1" }, c(2));
  assert.equal(countOf(s, KITTEN), 1);
  ownerSold(s, owner, KITTEN, { qty: 1, reqId: "q-2" }, c(3));
  assert.equal(countOf(s, KITTEN), 0);
  assert.deepEqual(ownerSold(s, owner, KITTEN, { qty: 0, reqId: "q-3" }, c(4)), { ok: false, why: "bad_count" });
});

test("a counted listing at 0 is sold out by itself, with nothing written to the listing; an uncounted one is never hidden by this", () => {
  const s = counted(KITTEN, 1);
  assert.equal(quantityOfListing(s, "l-3"), 1);
  assert.equal(soldOutListings(s).has("l-3"), false);
  ownerSold(s, owner, KITTEN, { qty: 1, reqId: "q-1" }, c());
  assert.equal(quantityOfListing(s, "l-3"), 0);
  assert.deepEqual([...soldOutListings(s)], ["l-3"]);
  assert.equal(soldOutListings(s).has("l-4"), false, "another listing nobody counts");
  correct(s, owner, KITTEN, { to: 2, reqId: "fix" }, c(1)); // "Still have it? Yes": the owner's count brings it back
  assert.equal(soldOutListings(s).size, 0);
});

test("the low mark fires once per crossing, clears when the count rises above it, and fires again at the next fall", () => {
  const s = counted(RICE, 8, { low: 3 });
  sale(s, shop, RICE, "sale:o-1:x", 4, c(1)); // 4 left
  assert.equal(pendingAlerts(s).length, 0);
  sale(s, shop, RICE, "sale:o-2:x", 1, c(2)); // 3 left: at the mark
  assert.equal(pendingAlerts(s).length, 1);
  assert.deepEqual(pendingAlerts(s)[0], { line: RICE, crossing: 1, count: 3, atMs: NOW + 2 });
  sale(s, shop, RICE, "sale:o-3:x", 1, c(3)); // 2 left: still low, no second alert
  sale(s, shop, RICE, "sale:o-3:x", 1, c(4));
  assert.equal(pendingAlerts(s).length, 1, "one alert for the whole time it stays low");
  assert.equal(lowLines(s).length, 1);
  assert.equal(ackAlert(s, RICE, 1), true);
  assert.equal(ackAlert(s, RICE, 1), false, "taking it off twice finds nothing");
  received(s, shop, RICE, "delivery:po-1", 10, undefined, c(5)); // 12 left: above the mark
  assert.equal(lowLines(s).length, 0);
  sale(s, shop, RICE, "sale:o-4:x", 10, c(6)); // down to 2 again
  assert.equal(pendingAlerts(s).length, 1);
  assert.equal(pendingAlerts(s)[0].crossing, 2);
  assert.notEqual(lowRequestId({ line: RICE, crossing: 1 }), lowRequestId({ line: RICE, crossing: 2 }), "one reorder request per crossing");
});

test("a count that starts at or under its low mark is one crossing; setting or clearing the mark follows the same rule", () => {
  const s = counted(RICE, 2, { low: 2 });
  assert.equal(pendingAlerts(s).length, 1);
  setLow(s, owner, RICE, null, c(1));
  assert.equal(pendingAlerts(s).length, 0, "no mark, no alert");
  assert.equal(lowLines(s).length, 0);
  setLow(s, owner, RICE, 5, c(2));
  assert.equal(pendingAlerts(s).length, 1);
});

test("orders hold stock that is not yet in the count: what is left takes them off, so two holds cannot both take the last one, and a booked order is not counted twice", () => {
  const s = counted(THALI, 1);
  const fact = (key: string, qty: number, over: Partial<OrderFact> = {}): OrderFact => ({ key, id: THALI, qty, standing: false, cancelled: false, holding: true, ...over });
  const holds = [fact("sale:o-1:thali", 1)];
  assert.equal(unbookedHolds(s, THALI, holds), 1);
  assert.equal(leftFor(s, THALI, unbookedHolds(s, THALI, holds)), 0, "the one thali is held, so nothing is left for another order");
  assert.equal(unbookedHolds(s, THALI, holds, "sale:o-1:thali"), 0, "the order being checked does not count against itself");
  const confirmed = [fact("sale:o-1:thali", 1, { standing: true })];
  assert.equal(reconcileSales(s, shop, confirmed, c()), 1);
  assert.equal(countOf(s, THALI), 0);
  assert.equal(unbookedHolds(s, THALI, confirmed), 0, "booked in the count, so not also a hold");
  assert.equal(leftFor(s, THALI, unbookedHolds(s, THALI, confirmed)), 0);
  assert.equal(reconcileSales(s, shop, confirmed, c(1)), 0, "reconcile twice, same result");
  assert.equal(reconcileSales(s, shop, [fact("sale:o-1:thali", 1, { standing: false, cancelled: true, holding: false })], c(2)), 1);
  assert.equal(countOf(s, THALI), 1);
});

test("reconcile never touches an order that is absent from the facts, and ignores orders that merely wait", () => {
  const s = counted(THALI, 10);
  reconcileSales(s, shop, [{ key: "sale:o-1:thali", id: THALI, qty: 3, standing: true, cancelled: false, holding: false }], c());
  assert.equal(countOf(s, THALI), 7);
  reconcileSales(s, shop, [], c(1)); // the agent no longer keeps that old order
  assert.equal(countOf(s, THALI), 7, "absent is not cancelled");
  reconcileSales(s, shop, [{ key: "sale:o-2:thali", id: THALI, qty: 3, standing: false, cancelled: false, holding: true }], c(2));
  assert.equal(countOf(s, THALI), 7, "a hold is not a sale");
});

test("an alias reads and writes the same line: a listing and a Stock orders item for the same rice share one count", () => {
  const s = emptyStock();
  assert.ok(startCounting(s, owner, RICE, { count: 5, aliases: [listingStockId("l-7")] }, c()).ok);
  ownerSold(s, owner, listingStockId("l-7"), { qty: 2, reqId: "a" }, c(1));
  assert.equal(countOf(s, RICE), 3);
  assert.equal(quantityOfListing(s, "l-7"), 3);
  assert.deepEqual(startCounting(s, owner, listingStockId("l-7"), { count: 1 }, c(2)), { ok: false, why: "exists" });
});

test("ids and numbers are checked: unknown kinds, odd characters, fractions and huge counts are refused", () => {
  const s = emptyStock();
  for (const id of ["thali", "cat:x", "menu:", "menu:a b", "menu:../x", "menu:" + "x".repeat(70)]) assert.deepEqual(startCounting(s, owner, id, { count: 1 }, c()), { ok: false, why: "bad_id" }, id);
  assert.deepEqual(startCounting(s, owner, THALI, { count: 1.5 }, c()), { ok: false, why: "bad_count" });
  assert.deepEqual(startCounting(s, owner, THALI, { count: -1 }, c()), { ok: false, why: "bad_count" });
  assert.deepEqual(startCounting(s, owner, THALI, { count: 2_000_000 }, c()), { ok: false, why: "bad_count" });
  assert.deepEqual(startCounting(s, owner, THALI, { count: 1, low: -1 }, c()), { ok: false, why: "bad_low" });
  assert.deepEqual(startCounting(s, owner, THALI, { count: 1, name: "x".repeat(61) }, c()), { ok: false, why: "bad_text" });
  assert.equal(s.lines.length, 0);
});

test("stopping the count makes the item behave as uncounted again", () => {
  const s = counted(KITTEN, 0);
  assert.equal(soldOutListings(s).size, 1);
  assert.ok(stopCounting(s, owner, KITTEN).ok);
  assert.equal(soldOutListings(s).size, 0);
  assert.equal(countOf(s, KITTEN), undefined);
  assert.deepEqual(stopCounting(s, owner, KITTEN), { ok: false, why: "no_such_line" });
});

test("the owner's rows put sold-out and low items first, then by name", () => {
  const s = emptyStock();
  startCounting(s, owner, menuStockId("b"), { count: 9, name: "Bread" }, c());
  startCounting(s, owner, menuStockId("a"), { count: 9, name: "Apple" }, c());
  startCounting(s, owner, menuStockId("c"), { count: 1, low: 2, name: "Curd" }, c());
  startCounting(s, owner, menuStockId("d"), { count: 0, name: "Dates" }, c());
  assert.deepEqual(ownerRows(s).map((r) => r.name), ["Dates", "Curd", "Apple", "Bread"]);
});
