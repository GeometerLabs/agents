// Writes go/internal/stock/testdata/stock-vectors.json.gz: what modules/stock/stock.ts does, so the Go package (go/internal/stock, over listings.Stock) is proved equal to it, state member for
// member, on the SAME inputs. Run from the repository root:   node go/scripts/gen_stock_vectors.ts     (add --check to only compare with the committed file; words-fresh.test.ts calls `staleFiles`)
// Nothing is retyped as an expected value: each scenario is a list of steps that are RUN here through the real TypeScript (the starting state is made by the owner's own ops, so it is what
// the TypeScript really writes), and the step's return value and the whole state after it are recorded. The Go test replays the steps on the recorded starting state and compares.
// The scenarios take every case of modules/stock/test/stock.test.ts and templates/commerce/orders/test/stock.test.ts (the Orders ones read the facts from the real orderFacts over a real
// Store, so the key, the horizon and the item-on-two-lines rules are the Orders agent's own), and add: standing, completed, cancelled, held, expired, two lines of one item, 700 orders,
// counting started after a pickup, the horizon, low-mark crossings, deliveries in part and in full, units, aliases and the prune past 5000 keys (recorded as a digest: its state is too big).
// Step ops: sale, received, reconcileSales, reconcileDeliveries, unbookedHolds, leftFor, countOf, isCounted, pendingAlerts, lowLines, ackAlert, noteAsked, tidy (the shop's record and its
// reads); start, stop, correct, ownerSold, setLow (the owner's, which the listings package already has: they set up scenarios and the Go test runs them through listings).
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ownerAuthority } from "../../modules/memory/memory.ts";
import {
  FACT_HORIZON_MS, ackAlert, correct, countOf, emptyStock, isCounted, isStockId, kindOf, leftFor, listingStockId, lowLines, lowRequestId, menuStockId, noteAsked, ownerSold, pendingAlerts,
  received, reconcileDeliveries, reconcileSales, setLow, shopRecord, startCounting, stockRefs, stopCounting, supplyStockId, tidyStock, unbookedHolds, sale, STOCK_ACTION,
  MAX_APPLIED, SAFE_KEEP_MS, APPLIED_KEPT_MS,
} from "../../modules/stock/stock.ts";
import type { DeliveryFact, OrderFact, StockState } from "../../modules/stock/stock.ts";
import { createStore, newDraft, orderFacts, register } from "../../templates/commerce/orders/src/order.ts";
import type { Order, OrderState, Store } from "../../templates/commerce/orders/src/order.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const OUT = join(here, "..", "internal", "stock", "testdata");
const NOW = 1_800_000_000_000;
const DAY = 24 * 3_600_000;
const owner = ownerAuthority("app");
const shop = shopRecord("orders");
const RICE = supplyStockId("rice25"), THALI = menuStockId("thali"), KITTEN = listingStockId("l-3");
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const nul = (v: unknown): unknown => (v === undefined ? null : v);

type Step = { op: string; [k: string]: unknown };
interface Scenario { name: string; digest?: boolean; initial: StockState; steps: (Step & { result: unknown; state: unknown })[] }

/** A recorder over one state: every call runs the real TypeScript and keeps what it answered and the whole state after. */
class Sc {
  s: StockState = emptyStock();
  initial: StockState = emptyStock();
  steps: Scenario["steps"] = [];
  digest = false;
  name: string;
  constructor(name: string) { this.name = name; }
  /** Make the starting state with the owner's own ops (not recorded as steps). */
  setup(f: (s: StockState) => void): this { f(this.s); this.initial = clone(this.s); return this; }
  count(id: string, count: number, extra: { low?: number; unit?: string; name?: string; aliases?: string[] } = {}): this {
    const r = startCounting(this.s, owner, id, { count, ...extra }, { nowMs: NOW });
    if (!r.ok) throw new Error(`setup ${this.name}: ${r.why}`);
    this.initial = clone(this.s);
    return this;
  }
  private rec(step: Step, result: unknown): this {
    this.steps.push({ ...step, result: clone(nul(result)), state: this.digest ? digestOf(this.s) : clone(this.s) });
    return this;
  }
  private res(r: { ok: boolean; why?: string; value?: unknown }): unknown { return r.ok ? { ok: true, line: r.value === undefined ? null : (r.value as { id: string }).id } : { ok: false, why: r.why }; }
  sale(id: string, key: string, qty: number, at = 0): this { return this.rec({ op: "sale", id, key, qty, nowMs: NOW + at }, this.res(sale(this.s, shop, id, key, qty, { nowMs: NOW + at }))); }
  received(id: string, key: string, cumulative: number, unit: string | null, at = 0): this {
    return this.rec({ op: "received", id, key, cumulative, unit, nowMs: NOW + at }, this.res(received(this.s, shop, id, key, cumulative, unit ?? undefined, { nowMs: NOW + at })));
  }
  reconcileSales(facts: OrderFact[], at = 0): this { return this.rec({ op: "reconcileSales", facts: clone(facts), nowMs: NOW + at }, reconcileSales(this.s, shop, facts, { nowMs: NOW + at })); }
  reconcileDeliveries(facts: DeliveryFact[], at = 0): this { return this.rec({ op: "reconcileDeliveries", facts: clone(facts), nowMs: NOW + at }, reconcileDeliveries(this.s, shop, facts, { nowMs: NOW + at })); }
  unbookedHolds(id: string, facts: OrderFact[], exceptKey = ""): this { return this.rec({ op: "unbookedHolds", id, facts: clone(facts), exceptKey }, unbookedHolds(this.s, id, facts, exceptKey)); }
  leftFor(id: string, held: number): this { return this.rec({ op: "leftFor", id, held }, leftFor(this.s, id, held)); }
  countOf(id: string): this { return this.rec({ op: "countOf", id }, countOf(this.s, id)); }
  isCounted(id: string): this { return this.rec({ op: "isCounted", id }, isCounted(this.s, id)); }
  pendingAlerts(kind?: string): this { return this.rec({ op: "pendingAlerts", kind: nul(kind) }, pendingAlerts(this.s, kind as never)); }
  lowLines(except?: string): this { return this.rec({ op: "lowLines", except: nul(except) }, lowLines(this.s, except as never).map((l) => l.id)); }
  ackAlert(line: string, crossing: number): this { return this.rec({ op: "ackAlert", line, crossing }, ackAlert(this.s, line, crossing)); }
  noteAsked(line: string, crossing: number): this { return this.rec({ op: "noteAsked", line, crossing }, noteAsked(this.s, line, crossing)); }
  tidy(at: number): this { tidyStock(this.s, NOW + at); return this.rec({ op: "tidy", nowMs: NOW + at }, null); }
  start(id: string, count: number, at = 0, extra: { name?: string; unit?: string; low?: number } = {}): this {
    return this.rec({ op: "start", id, count, ...extra, nowMs: NOW + at }, this.res(startCounting(this.s, owner, id, { count, ...extra }, { nowMs: NOW + at })));
  }
  stop(id: string): this { return this.rec({ op: "stop", id }, this.res(stopCounting(this.s, owner, id))); }
  correct(id: string, to: number, reqId: string, shown?: number, at = 0): this {
    return this.rec({ op: "correct", id, to, reqId, shown: nul(shown), nowMs: NOW + at }, this.res(correct(this.s, owner, id, { to, reqId, ...(shown !== undefined ? { shown } : {}) }, { nowMs: NOW + at })));
  }
  ownerSold(id: string, qty: number, reqId: string, at = 0): this { return this.rec({ op: "ownerSold", id, qty, reqId, nowMs: NOW + at }, this.res(ownerSold(this.s, owner, id, { qty, reqId }, { nowMs: NOW + at }))); }
  setLow(id: string, low: number | null, at = 0): this { return this.rec({ op: "setLow", id, low, nowMs: NOW + at }, this.res(setLow(this.s, owner, id, low, { nowMs: NOW + at }))); }
  /** Build a long run of steps with a loop. */
  also(f: (sc: Sc) => void): this { f(this); return this; }
  out(): Scenario { return { name: this.name, ...(this.digest ? { digest: true } : {}), initial: this.initial, steps: this.steps }; }
}

/** A state too big to keep whole (the prune past 5000 keys): each line without its keys, plus the keys' count and a hash of every key and value in order. */
function digestOf(s: StockState): unknown {
  return {
    alerts: clone(s.alerts),
    lines: s.lines.map((l) => {
      const { applied, ...rest } = clone(l);
      const keys = Object.keys(applied);
      const h = createHash("sha256");
      for (const k of keys) h.update(`${k}|${applied[k].qty}|${applied[k].took}|${applied[k].atMs}\n`);
      return { ...rest, appliedCount: keys.length, appliedSha256: h.digest("hex") };
    }),
  };
}

const fact = (key: string, id: string, qty: number, over: Partial<OrderFact> = {}): OrderFact => ({ key, id, qty, standing: false, cancelled: false, holding: true, ...over });
const standing = (key: string, id: string, qty: number, over: Partial<OrderFact> = {}): OrderFact => fact(key, id, qty, { standing: true, holding: false, ...over });

// ---- Orders' own facts: real orders in a real Store, read by the real orderFacts ---------------------------------------------------------------------------

function order(store: Store, state: OrderState, lines: { itemId: string; qty: number }[], over: Partial<Order> = {}): Order {
  const o = newDraft("+919811111111", "en");
  o.state = state; o.lines = lines; Object.assign(o, over);
  return register(store, o);
}
/** A store with a counted menu item; the count is started by the owner at `startMs`. */
function withCount(store: Store, itemId: string, count: number, low?: number, startMs = NOW): void {
  store.assistant ??= { seq: 0, cards: [], refused: [], closedDays: [], undo: [], talk: [], limitChanges: [] };
  store.assistant.stock ??= emptyStock();
  const r = startCounting(store.assistant.stock, owner, menuStockId(itemId), { count, ...(low !== undefined ? { low } : {}) }, { nowMs: startMs });
  if (!r.ok) throw new Error("withCount");
}
const DAY_HOLD = (nowMs: number) => ({ holdExpiresAt: nowMs + 3_600_000 });

/** A scenario that starts from an Orders store: the stock state is the store's, the facts are what orderFacts reads at each call's time, and each reconcile/hold step carries them. */
function ordersScenario(name: string, build: (store: Store) => void, run: (sc: Sc, store: Store, facts: (at?: number) => OrderFact[]) => void): Scenario {
  const store = createStore();
  build(store);
  const sc = new Sc(name);
  sc.s = store.assistant?.stock ?? emptyStock();
  sc.initial = clone(sc.s);
  run(sc, store, (at = 0) => orderFacts(store, NOW + at) as OrderFact[]);
  return sc.out();
}

function scenarios(): Scenario[] {
  const out: Scenario[] = [];
  const add = (sc: Sc): void => { out.push(sc.out()); };

  // modules/stock/test/stock.test.ts
  add(new Sc("a sale lowers the count once; a retry and a restart add nothing").count(THALI, 10).sale(THALI, "sale:o-1:thali", 3, 1)
    .sale(THALI, "sale:o-1:thali", 3, 2).sale(THALI, "sale:o-1:thali", 3, 3).sale(THALI, "sale:o-1:thali", 3, 9).countOf(THALI));
  add(new Sc("a cancelled order puts back exactly what it took, once").count(THALI, 10).sale(THALI, "sale:o-1:thali", 4).sale(THALI, "sale:o-1:thali", 0, 1).sale(THALI, "sale:o-1:thali", 0, 2)
    .sale(THALI, "sale:o-2:thali", 0, 3).sale(THALI, "sale:o-1:thali", 4, 4).countOf(THALI));
  add(new Sc("the count never goes below 0; a cancel returns only what was taken").count(THALI, 3).sale(THALI, "sale:o-1:thali", 5).sale(THALI, "sale:o-1:thali", 0, 1)
    .sale(THALI, "sale:o-3:thali", 2, 2).sale(THALI, "sale:o-3:thali", 6, 3).sale(THALI, "sale:o-3:thali", 1, 4));
  add(new Sc("a delivery in part then in full adds each piece once").count(RICE, 2, { unit: "bag" }).received(RICE, "delivery:po-1", 4, "bag", 1).received(RICE, "delivery:po-1", 4, "bag", 2)
    .received(RICE, "delivery:po-1", 10, "bag", 3).received(RICE, "delivery:po-1", 7, "bag", 4).received(RICE, "delivery:po-1", 10, null, 5));
  add(new Sc("a delivery in another unit is refused, never converted, and said once").count(RICE, 2, { unit: "bag" }).received(RICE, "delivery:po-2", 3, "box")
    .reconcileDeliveries([{ key: "delivery:po-2", id: RICE, cumulative: 3, unit: "box" }], 1).reconcileDeliveries([{ key: "delivery:po-2", id: RICE, cumulative: 3, unit: "box" }], 2)
    .reconcileDeliveries([{ key: "delivery:po-2", id: RICE, cumulative: 4, unit: "box" }], 3).reconcileDeliveries([{ key: "delivery:po-2", id: RICE, cumulative: 4, unit: "bag" }], 4));
  add(new Sc("an item nobody counts is left alone").sale(THALI, "sale:o-1:thali", 2).received(RICE, "delivery:po-1", 4, "bag").countOf(THALI).leftFor(THALI, 3).isCounted(THALI)
    .reconcileSales([standing("sale:o-1:thali", THALI, 2)]).reconcileDeliveries([{ key: "delivery:po-1", id: RICE, cumulative: 4 }]).unbookedHolds(THALI, [fact("sale:o-1:thali", THALI, 1)]));
  add(new Sc("the owner's correction, a retry, a stale one and bad numbers").count(RICE, 8).correct(RICE, 5, "r-1", 8, 1).sale(RICE, "sale:o-9:x", 1, 2).correct(RICE, 9, "r-2", 5, 3)
    .correct(RICE, 5, "r-1", 8, 4).correct(RICE, -1, "r-3", undefined, 5).correct(RICE, 1.5, "r-4", undefined, 5).correct("menu:nothing", 1, "r-5", undefined, 5));
  add(new Sc("the owner's 'sold 2' counts once per request").count(KITTEN, 3).ownerSold(KITTEN, 2, "q-1", 1).ownerSold(KITTEN, 2, "q-1", 2).ownerSold(KITTEN, 1, "q-2", 3).ownerSold(KITTEN, 0, "q-3", 4));
  add(new Sc("low mark: once per crossing, clears above the mark, fires again at the next fall").count(RICE, 8, { low: 3 }).sale(RICE, "sale:o-1:x", 4, 1).pendingAlerts().sale(RICE, "sale:o-2:x", 1, 2)
    .pendingAlerts().sale(RICE, "sale:o-3:x", 1, 3).sale(RICE, "sale:o-3:x", 1, 4).pendingAlerts().lowLines().ackAlert(RICE, 1).ackAlert(RICE, 1).received(RICE, "delivery:po-1", 10, null, 5).lowLines()
    .sale(RICE, "sale:o-4:x", 10, 6).pendingAlerts().pendingAlerts("supply").pendingAlerts("menu").lowLines().lowLines("supply").noteAsked(RICE, 2).noteAsked(RICE, 2).noteAsked(RICE, 9));
  add(new Sc("a count that starts at its low mark is one crossing; setting or clearing the mark follows").count(RICE, 2, { low: 2 }).pendingAlerts().setLow(RICE, null, 1).pendingAlerts().lowLines().setLow(RICE, 5, 2).pendingAlerts()
    .setLow(RICE, -1, 3).setLow("menu:none", 1, 3));
  add(new Sc("many alerts: more than 50 keep the last 50").count(RICE, 100000, { low: 99999 }).also((sc) => {
    for (let i = 0; i < 60; i++) sc.sale(RICE, `sale:o-${i}:x`, 1, i * 3).received(RICE, `delivery:p-${i}`, 5, null, i * 3 + 1);
  }));
  add(new Sc("holds: what is held but not booked is taken off what is left, and a booked order is not counted twice").count(THALI, 1).unbookedHolds(THALI, [fact("sale:o-1:thali", THALI, 1)])
    .leftFor(THALI, 1).unbookedHolds(THALI, [fact("sale:o-1:thali", THALI, 1)], "sale:o-1:thali").reconcileSales([standing("sale:o-1:thali", THALI, 1)])
    .unbookedHolds(THALI, [standing("sale:o-1:thali", THALI, 1)]).leftFor(THALI, 0).reconcileSales([standing("sale:o-1:thali", THALI, 1)], 1)
    .reconcileSales([fact("sale:o-1:thali", THALI, 1, { holding: false, cancelled: true })], 2).countOf(THALI).leftFor(THALI, 5).leftFor("menu:none", 1));
  add(new Sc("reconcile never touches an order absent from the facts, and ignores orders that merely wait").count(THALI, 10).reconcileSales([standing("sale:o-1:thali", THALI, 3)]).reconcileSales([], 1)
    .reconcileSales([fact("sale:o-2:thali", THALI, 3)], 2).countOf(THALI));
  add(new Sc("an alias reads and writes the same line").count(RICE, 5, { aliases: [listingStockId("l-7")] }).ownerSold(listingStockId("l-7"), 2, "a", 1).countOf(RICE).countOf(listingStockId("l-7"))
    .sale(listingStockId("l-7"), "sale:o-1:x", 1, 2).received(listingStockId("l-7"), "delivery:p-1", 3, null, 3).isCounted(listingStockId("l-7")).leftFor(listingStockId("l-7"), 1)
    .unbookedHolds(listingStockId("l-7"), [fact("sale:o-5:x", listingStockId("l-7"), 2, { id: listingStockId("l-7") })]));
  add(new Sc("counting started after an order was completed: that order is history").count(THALI, 10).reconcileSales([standing("sale:o-1:thali", THALI, 4, { endedMs: NOW - DAY })], 1)
    .unbookedHolds(THALI, [standing("sale:o-1:thali", THALI, 4, { endedMs: NOW - DAY })]).reconcileSales([standing("sale:o-1:thali", THALI, 4, { endedMs: NOW - DAY }), standing("sale:o-2:thali", THALI, 1, { endedMs: NOW + DAY })], 2)
    .reconcileSales([standing("sale:o-3:thali", THALI, 2, { endedMs: NOW })], 3).reconcileSales([standing("sale:o-4:thali", THALI, 2, { endedMs: NOW + 1 })], 4));
  add(new Sc("stop counting then start again: the second line does not replay the first one's orders").count(THALI, 10).reconcileSales([standing("sale:o-1:thali", THALI, 3, { endedMs: NOW + 1000 })], 1).stop(THALI)
    .start(THALI, 20, 10).reconcileSales([standing("sale:o-1:thali", THALI, 3, { endedMs: NOW + 5 })], 11).countOf(THALI));
  add(new Sc("a history order the line already booked can still be cancelled").count(THALI, 10).reconcileSales([standing("sale:o-1:thali", THALI, 3, { endedMs: NOW + 5 })], 1)
    .reconcileSales([standing("sale:o-1:thali", THALI, 3, { endedMs: NOW - 5, standing: false, cancelled: true, holding: false })], 2).countOf(THALI));
  add(new Sc("a delivery marked before counting began moves nothing; a later mark adds the difference").count(RICE, 5, { unit: "bag" })
    .reconcileDeliveries([{ key: "delivery:po-1", id: RICE, cumulative: 4, unit: "bag", atMs: NOW - DAY }], 1).countOf(RICE)
    .reconcileDeliveries([{ key: "delivery:po-1", id: RICE, cumulative: 10, unit: "bag", atMs: NOW + 5 }], 6).countOf(RICE)
    .reconcileDeliveries([{ key: "delivery:po-2", id: RICE, cumulative: 3, unit: "bag", atMs: NOW }], 7).reconcileDeliveries([{ key: "delivery:po-3", id: RICE, cumulative: 2, unit: "bag", atMs: NOW - 1 }], 8)
    .reconcileDeliveries([{ key: "delivery:po-4", id: RICE, cumulative: 2, unit: "bag" }, { key: "delivery:po-5", id: "supply:other", cumulative: 2 }], 9));
  add(new Sc("a key outlives every fact that names it; the tidy forgets it after 120 days and the count stays").count(THALI, 10).reconcileSales([standing("sale:o-1:thali", THALI, 3, { endedMs: NOW + DAY })], 1)
    .tidy(100 * DAY).tidy(130 * DAY).countOf(THALI).received(THALI, "delivery:p-1", 1, null, 131 * DAY).tidy(131 * DAY + 119 * DAY));
  add(new Sc("tidy drops alerts older than 30 days").count(RICE, 5, { low: 5 }).tidy(29 * DAY).tidy(30 * DAY).pendingAlerts());
  const many = new Sc("more than 400 orders of one item all keep their keys (700, one reconcile, then again)").count(THALI, 1_000_000);
  const facts700: OrderFact[] = Array.from({ length: 700 }, (_, i) => standing(`sale:o-${i}:thali`, THALI, 1, { endedMs: NOW + DAY }));
  add(many.reconcileSales(facts700, 1).reconcileSales(facts700, 2).countOf(THALI));
  add(new Sc("a line started with no unit takes the unit of its first delivery").count(RICE, 0).received(RICE, "delivery:po-1", 3, "box", 1).received(RICE, "delivery:po-2", 5, "piece", 2).countOf(RICE)
    .received(RICE, "delivery:po-3", 2_000_000, "box", 3).received(RICE, "delivery:po-3", -1, "box", 3));
  add(new Sc("bad numbers on the shop's record").count(THALI, 5).sale(THALI, "sale:o-1:thali", -1).sale(THALI, "sale:o-1:thali", 1_000_001).sale(THALI, "sale:o-1:thali", 2).received(THALI, "delivery:p", 1.5 as number, null)
    .sale(THALI, "sale:o-2:thali", 1_000_000));
  add(new Sc("the count is capped at one million on a return and a delivery").count(THALI, 999_999).received(THALI, "delivery:p-1", 5, null, 1).sale(THALI, "sale:o-1:thali", 3, 2).received(THALI, "delivery:p-2", 5, null, 3)
    .sale(THALI, "sale:o-1:thali", 0, 4).countOf(THALI));

  // the prune past 5000 keys: the old keys (older than 45 days) go oldest first, a young key never does
  {
    const sc = new Sc("more than 5000 keys: only keys older than 45 days are dropped, oldest first").count(THALI, 1_000_000);
    sc.setup(() => {
      const l = sc.s.lines[0];
      for (let i = 0; i < 5003; i++) l.applied[`sale:old-${i}:thali`] = { qty: 1, took: 1, atMs: NOW - 200 * DAY + ((i * 7919) % 5003) };
      for (let i = 0; i < 4; i++) l.applied[`sale:young-${i}:thali`] = { qty: 1, took: 1, atMs: NOW - 10 * DAY };
    });
    sc.digest = true;
    sc.sale(THALI, "sale:new-1:thali", 1, 1).sale(THALI, "sale:new-2:thali", 2, 2).received(THALI, "delivery:p-1", 3, null, 3).correct(THALI, 7, "fix", undefined, 4);
    out.push(sc.out());
  }
  {
    const sc = new Sc("more than 5000 young keys: none is dropped").count(THALI, 1_000_000);
    sc.setup(() => { const l = sc.s.lines[0]; for (let i = 0; i < 5010; i++) l.applied[`sale:y-${i}:thali`] = { qty: 1, took: 1, atMs: NOW - 5 * DAY }; });
    sc.digest = true;
    sc.sale(THALI, "sale:new-1:thali", 1, 1);
    out.push(sc.out());
  }

  // templates/commerce/orders/test/stock.test.ts: real orders, real facts
  out.push(ordersScenario("orders: an order that stands takes its count once", (st) => { withCount(st, "thali", 10); order(st, "confirmed", [{ itemId: "thali", qty: 3 }]); },
    (sc, _st, facts) => { sc.reconcileSales(facts()); for (let i = 0; i < 4; i++) sc.reconcileSales(facts(), i + 1); sc.countOf(THALI); }));
  out.push(ordersScenario("orders: an order completed after it was booked does not take its count again", (st) => withCount(st, "thali", 10),
    (sc, st, facts) => { const o = order(st, "confirmed", [{ itemId: "thali", qty: 2 }]); sc.reconcileSales(facts()); o.state = "completed"; sc.reconcileSales(facts(), 1).countOf(THALI); }));
  out.push(ordersScenario("orders: a cancelled order gives its count back exactly once", (st) => withCount(st, "thali", 10),
    (sc, st, facts) => { const o = order(st, "confirmed", [{ itemId: "thali", qty: 4 }]); sc.reconcileSales(facts()); o.state = "cancelled"; sc.reconcileSales(facts(), 1).reconcileSales(facts(), 2).countOf(THALI); }));
  out.push(ordersScenario("orders: a held order is not a sale; what it holds is taken off what is left; confirmed, it counts once", (st) => withCount(st, "thali", 1),
    (sc, st, facts) => {
      const held = order(st, "awaiting_advance", [{ itemId: "thali", qty: 1 }], DAY_HOLD(NOW));
      sc.reconcileSales(facts()).countOf(THALI).unbookedHolds(THALI, facts()).leftFor(THALI, unbookedHolds(sc.s, THALI, facts()));
      sc.unbookedHolds(THALI, facts(), `sale:${held.id}:thali`);
      held.state = "confirmed";
      sc.unbookedHolds(THALI, facts()).reconcileSales(facts(), 1).countOf(THALI).unbookedHolds(THALI, facts());
    }));
  out.push(ordersScenario("orders: an expired hold frees the shelf", (st) => { withCount(st, "thali", 1); order(st, "awaiting_advance", [{ itemId: "thali", qty: 1 }], { holdExpiresAt: NOW - 1 }); },
    (sc, _st, facts) => { sc.unbookedHolds(THALI, facts()).reconcileSales(facts()).leftFor(THALI, 0); }));
  out.push(ordersScenario("orders: counting started after an order was picked up", (st) => { order(st, "completed", [{ itemId: "thali", qty: 6 }], { slotEndMs: NOW - DAY }); withCount(st, "thali", 10); },
    (sc, _st, facts) => { sc.reconcileSales(facts()).unbookedHolds(THALI, facts()).countOf(THALI); }));
  out.push(ordersScenario("orders: confirmed before counting but still to be picked up is booked", (st) => { order(st, "confirmed", [{ itemId: "thali", qty: 2 }], { slotEndMs: NOW + DAY }); withCount(st, "thali", 10); },
    (sc, _st, facts) => { sc.unbookedHolds(THALI, facts()).reconcileSales(facts()).countOf(THALI); }));
  out.push(ordersScenario("orders: the 30-day horizon; two lines of one item; a plan's meals are skipped", (st) => {
    withCount(st, "thali", 100, 98);
    order(st, "completed", [{ itemId: "thali", qty: 1 }], { slotEndMs: NOW - 31 * DAY });
    order(st, "cancelled", [{ itemId: "thali", qty: 1 }], { slotEndMs: NOW - 31 * DAY });
    order(st, "completed", [{ itemId: "thali", qty: 1 }], { slotEndMs: NOW - 29 * DAY });
    order(st, "confirmed", [{ itemId: "thali", qty: 1 }, { itemId: "thali", qty: 2 }, { itemId: "lassi", qty: 1 }], { slotEndMs: NOW + DAY });
    order(st, "confirmed", [{ itemId: "thali", qty: 9 }], { slotEndMs: NOW + DAY, plan: { id: "p-1", period: 1, typeId: "monthly" } });
  }, (sc, _st, facts) => { sc.reconcileSales(facts(), 1).reconcileSales(facts(), 2).countOf(THALI).pendingAlerts("menu"); }));
  out.push(ordersScenario("orders: 500 confirmed orders are booked once", (st) => { withCount(st, "thali", 100_000); for (let i = 0; i < 500; i++) order(st, "confirmed", [{ itemId: "thali", qty: 1 }], { slotEndMs: NOW + DAY }); },
    (sc, _st, facts) => { sc.reconcileSales(facts()).reconcileSales(facts(1000), 1000).countOf(THALI); }));
  out.push(ordersScenario("orders: a counted item that reaches its low mark by a sale queues one alert", (st) => { withCount(st, "thali", 5, 2); order(st, "confirmed", [{ itemId: "thali", qty: 3 }]); },
    (sc, _st, facts) => { sc.reconcileSales(facts()).reconcileSales(facts(), 1).pendingAlerts(); }));
  out.push(ordersScenario("orders: the left of a counted item is the count less its unbooked holds", (st) => { withCount(st, "thali", 5); order(st, "awaiting_advance", [{ itemId: "thali", qty: 2 }], DAY_HOLD(NOW)); },
    (sc, _st, facts) => { sc.unbookedHolds(THALI, facts()).leftFor(THALI, unbookedHolds(sc.s, THALI, facts())).leftFor(THALI, 9); }));
  return out;
}

/** Pure functions of ids, words and horizons. */
function pureVectors(): unknown {
  const ids = ["thali", "cat:x", "menu:", "menu:a b", "menu:../x", "menu:" + "x".repeat(70), "menu:" + "x".repeat(64), "listing:l-3", "menu:thali", "supply:rice25", "supply:a.b_c-d", "", "menu:é", "Menu:x", "menu:x\n"];
  return {
    ids: ids.map((id) => ({ id, isStockId: isStockId(id), kindOf: nul(kindOf(id)) })),
    builders: ["thali", "l-3", "rice25", ""].map((x) => ({ in: x, menu: menuStockId(x), supply: supplyStockId(x), listing: listingStockId(x) })),
    refs: [[THALI, "booked_sale", "shop"], [RICE, "received", "shop"], [KITTEN, "sold", "owner"], ["nonsense", "low", "x"]].map(([id, change, by]) => ({ id, change, by, refs: stockRefs(id, change as never, by) })),
    lowRequestIds: [[RICE, 1], [RICE, 12], [THALI, 0]].map(([line, crossing]) => ({ line, crossing, id: lowRequestId({ line: line as string, crossing: crossing as number }) })),
    constants: { FACT_HORIZON_MS, SAFE_KEEP_MS, APPLIED_KEPT_MS, MAX_APPLIED, STOCK_ACTION },
  };
}

/** The words, as functions, for sample values in every language (the Go words are substituted from words.json and must say the same). */
async function wordVectors(): Promise<unknown> {
  const { STOCK_LINE_WORDS } = await import("../../modules/stock/words.ts");
  const out: unknown[] = [];
  for (const lang of Object.keys(STOCK_LINE_WORDS) as (keyof typeof STOCK_LINE_WORDS)[]) {
    const w = STOCK_LINE_WORDS[lang];
    out.push({
      lang, left: [w.left(12), w.left(0, "kg"), w.left(3, "bag")], lowMark: w.lowMark(3), short: w.short(2), runningLow: w.runningLow("Rice 5 kg", 3), reorderAsk: w.reorderAsk("Rice 5 kg", 3, "Ravi Traders"),
      morningLow: w.morningLow("2"), unitRefused: w.unitRefused("Rice 5 kg", "bag"), title: w.title, notices: w.notices, moves: w.moves, kinds: w.kinds, saved: w.saved,
      slotLike: w.runningLow("{name} {n}", 1),
    });
  }
  return out;
}

/** One gzipped file (node's gzip writes no time stamp, so the bytes are the same every run); the Go test unzips it. */
export async function generate(): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  files.set("stock-vectors.json.gz", gzipSync(Buffer.from(JSON.stringify({ scenarios: scenarios(), pure: pureVectors(), words: await wordVectors() }) + "\n"), { level: 9 }));
  return files;
}

/** The files in `dir` that differ from a fresh render (or are missing). */
export async function staleFiles(dir: string): Promise<string[]> {
  const stale: string[] = [];
  for (const [name, text] of await generate()) if (!existsSync(join(dir, name)) || !readFileSync(join(dir, name)).equals(text)) stale.push(name);
  return stale;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes("--check")) {
    const stale = await staleFiles(OUT);
    if (stale.length > 0) { console.error(`out of date: ${stale.join(", ")}  (run: node go/scripts/gen_stock_vectors.ts)`); process.exit(1); }
    console.log("the stock vectors are fresh");
  } else {
    mkdirSync(OUT, { recursive: true });
    for (const [name, text] of await generate()) writeFileSync(join(OUT, name), text);
    console.log(`wrote ${OUT}/stock-vectors.json.gz`);
  }
}
