// Writes go/internal/stock/testdata/stock-vectors.json: scenarios of the shop's one stock count RUN on the TypeScript (modules/stock/stock.ts), step by step, with what each step
// answered and the whole state after it, so the Go twin (go/internal/stock) is proved to do the same on every rule: the owner's acts (start, correct with a stale count, sold, the
// low mark, stop), the shop's own record (a sale as a target, a shortfall, a cancel giving back what was taken, a delivery as a cumulative total, a unit refused and never
// converted, a line taking the unit of its first delivery), the reconciles with their history rules (an order that ended, or goods received, before counting began), the holds
// not yet booked, the low alerts once per crossing (ack, asked, the request id), and the daily tidy. Stock orders and Orders both use these.
// Run from the repository root:   node go/scripts/gen_stock_vectors.ts        (add --check to only compare with the committed file; words-fresh runs the check too)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ownerAuthority } from "../../modules/memory/memory.ts";
import {
  ackAlert, correct, emptyStock, leftFor, lowRequestId, noteAsked, ownerSold, pendingAlerts, received, reconcileDeliveries, reconcileSales, sale, setLow, shopRecord, startCounting,
  stopCounting, tidyStock, unbookedHolds, countOf,
} from "../../modules/stock/stock.ts";
import type { DeliveryFact, OrderFact, StockState } from "../../modules/stock/stock.ts";

export const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "internal", "stock", "testdata", "stock-vectors.json");

/** One step: what to do, with its arguments as plain JSON (the Go test reads the same). */
type Step =
  | { do: "start"; id: string; input: { count: number; name?: string; unit?: string; low?: number; aliases?: string[] }; nowMs: number }
  | { do: "stop"; id: string }
  | { do: "low"; id: string; low: number | null; nowMs: number }
  | { do: "correct"; id: string; to: number; reqId: string; shown?: number; nowMs: number }
  | { do: "sold"; id: string; qty: number; reqId: string; nowMs: number }
  | { do: "sale"; id: string; key: string; qty: number; nowMs: number }
  | { do: "received"; id: string; key: string; cumulative: number; unit?: string; nowMs: number }
  | { do: "reconcileSales"; facts: OrderFact[]; nowMs: number }
  | { do: "reconcileDeliveries"; facts: DeliveryFact[]; nowMs: number }
  | { do: "unbooked"; id: string; facts: OrderFact[]; exceptKey?: string }
  | { do: "left"; id: string; held: number }
  | { do: "count"; id: string }
  | { do: "pending"; kind?: "listing" | "menu" | "supply" }
  | { do: "ack"; line: string; crossing: number }
  | { do: "asked"; line: string; crossing: number }
  | { do: "requestId"; line: string; crossing: number }
  | { do: "tidy"; nowMs: number };

const D = 24 * 3_600_000;
const T0 = 1_000 * D;

const SCENARIOS: { name: string; steps: Step[] }[] = [
  {
    name: "the owner's acts: start (and its refusals), correct (a retry, a stale count), sold, the low mark, stop",
    steps: [
      { do: "start", id: "bad id", input: { count: 1 }, nowMs: T0 },
      { do: "start", id: "supply:rice", input: { count: 1.5 }, nowMs: T0 },
      { do: "start", id: "supply:rice", input: { count: 2, low: -1 }, nowMs: T0 },
      { do: "start", id: "supply:rice", input: { count: 2, name: "x".repeat(61) }, nowMs: T0 },
      { do: "start", id: "supply:rice", input: { count: 10, name: "  Rice   25 kg ", unit: "bag", low: 3, aliases: ["listing:l-1"] }, nowMs: T0 },
      { do: "start", id: "listing:l-1", input: { count: 1 }, nowMs: T0 },
      { do: "start", id: "supply:dal", input: { count: 2, low: 2 }, nowMs: T0 + 1 },
      { do: "correct", id: "supply:rice", to: 8, reqId: "r1", shown: 10, nowMs: T0 + 2 },
      { do: "correct", id: "supply:rice", to: 99, reqId: "r1", nowMs: T0 + 3 },
      { do: "correct", id: "supply:rice", to: 7, reqId: "r2", shown: 10, nowMs: T0 + 4 },
      { do: "sold", id: "listing:l-1", qty: 5, reqId: "r3", nowMs: T0 + 5 },
      { do: "sold", id: "listing:l-1", qty: 5, reqId: "r3", nowMs: T0 + 6 },
      { do: "sold", id: "supply:rice", qty: 0, reqId: "r4", nowMs: T0 + 7 },
      { do: "pending" },
      { do: "low", id: "supply:dal", low: null, nowMs: T0 + 8 },
      { do: "low", id: "supply:rice", low: 1.5, nowMs: T0 + 9 },
      { do: "low", id: "supply:nothing", low: 1, nowMs: T0 + 9 },
      { do: "stop", id: "listing:l-1" },
      { do: "stop", id: "supply:rice" },
      { do: "count", id: "supply:rice" },
    ],
  },
  {
    name: "a sale is a target: the same again takes nothing, a larger one the difference, a shortfall is noted, a cancel gives back only what was taken",
    steps: [
      { do: "start", id: "menu:thali", input: { count: 5, low: 1 }, nowMs: T0 },
      { do: "sale", id: "menu:uncounted", key: "sale:o-1:menu:uncounted", qty: 3, nowMs: T0 },
      { do: "sale", id: "menu:thali", key: "sale:o-1:menu:thali", qty: 2, nowMs: T0 + 1 },
      { do: "sale", id: "menu:thali", key: "sale:o-1:menu:thali", qty: 2, nowMs: T0 + 2 },
      { do: "sale", id: "menu:thali", key: "sale:o-1:menu:thali", qty: 3, nowMs: T0 + 3 },
      { do: "sale", id: "menu:thali", key: "sale:o-2:menu:thali", qty: 4, nowMs: T0 + 4 },
      { do: "pending", kind: "menu" },
      { do: "sale", id: "menu:thali", key: "sale:o-2:menu:thali", qty: 0, nowMs: T0 + 5 },
      { do: "sale", id: "menu:thali", key: "sale:o-2:menu:thali", qty: 0, nowMs: T0 + 6 },
      { do: "sale", id: "menu:thali", key: "sale:o-1:menu:thali", qty: 1, nowMs: T0 + 7 },
      { do: "sale", id: "menu:thali", key: "sale:o-3:menu:thali", qty: 2.5, nowMs: T0 + 8 },
      { do: "left", id: "menu:thali", held: 1 },
      { do: "left", id: "menu:thali", held: 99 },
      { do: "left", id: "menu:none", held: 0 },
    ],
  },
  {
    name: "a delivery is the total received so far: a part, then the rest, the same mark again, a unit that is not the count's, a line taking its first delivery's unit",
    steps: [
      { do: "start", id: "supply:hair-colour", input: { count: 5, unit: "box", low: 4 }, nowMs: T0 },
      { do: "start", id: "supply:oil", input: { count: 1 }, nowMs: T0 },
      { do: "received", id: "supply:hair-colour", key: "delivery:po-1", cumulative: 4, unit: "box", nowMs: T0 + 1 },
      { do: "received", id: "supply:hair-colour", key: "delivery:po-1", cumulative: 4, unit: "box", nowMs: T0 + 2 },
      { do: "received", id: "supply:hair-colour", key: "delivery:po-1", cumulative: 10, unit: "box", nowMs: T0 + 3 },
      { do: "received", id: "supply:hair-colour", key: "delivery:po-1", cumulative: 6, unit: "box", nowMs: T0 + 4 },
      { do: "received", id: "supply:hair-colour", key: "delivery:po-2", cumulative: 3, unit: "piece", nowMs: T0 + 5 },
      { do: "received", id: "supply:oil", key: "delivery:po-3", cumulative: 2, unit: "bottle", nowMs: T0 + 6 },
      { do: "received", id: "supply:oil", key: "delivery:po-4", cumulative: 2, unit: "can", nowMs: T0 + 7 },
      { do: "received", id: "supply:none", key: "delivery:po-5", cumulative: 2, nowMs: T0 + 8 },
    ],
  },
  {
    name: "reconcileDeliveries: goods before counting began move nothing, a later mark adds the difference, a refused unit is reported once per quantity",
    steps: [
      { do: "start", id: "supply:shampoo", input: { count: 12, unit: "bottle", low: 3 }, nowMs: T0 },
      { do: "reconcileDeliveries", facts: [{ key: "delivery:po-1", id: "supply:shampoo", cumulative: 6, unit: "bottle", atMs: T0 - 5 }, { key: "delivery:po-2", id: "supply:shampoo", cumulative: 2, unit: "bottle", atMs: T0 }], nowMs: T0 + 1 },
      { do: "reconcileDeliveries", facts: [{ key: "delivery:po-1", id: "supply:shampoo", cumulative: 10, unit: "bottle", atMs: T0 + 2 }, { key: "delivery:po-2", id: "supply:shampoo", cumulative: 2, unit: "bottle", atMs: T0 }], nowMs: T0 + 3 },
      { do: "reconcileDeliveries", facts: [{ key: "delivery:po-3", id: "supply:shampoo", cumulative: 4, unit: "box", atMs: T0 + 4 }], nowMs: T0 + 4 },
      { do: "reconcileDeliveries", facts: [{ key: "delivery:po-3", id: "supply:shampoo", cumulative: 4, unit: "box", atMs: T0 + 4 }], nowMs: T0 + 5 },
      { do: "reconcileDeliveries", facts: [{ key: "delivery:po-3", id: "supply:shampoo", cumulative: 5, unit: "box", atMs: T0 + 6 }, { key: "delivery:po-9", id: "supply:other", cumulative: 5 }], nowMs: T0 + 6 },
    ],
  },
  {
    name: "reconcileSales and the holds not yet booked: standing orders are booked, cancelled given back, history never moves the count",
    steps: [
      { do: "start", id: "menu:rice", input: { count: 10, low: 2 }, nowMs: T0 },
      { do: "unbooked", id: "menu:rice", facts: [
        { key: "sale:o-1:menu:rice", id: "menu:rice", qty: 3, standing: false, cancelled: false, holding: true },
        { key: "sale:o-2:menu:rice", id: "menu:rice", qty: 2, standing: true, cancelled: false, holding: false },
        { key: "sale:o-0:menu:rice", id: "menu:rice", qty: 5, standing: true, cancelled: false, holding: false, endedMs: T0 - 1 },
      ] },
      { do: "unbooked", id: "menu:rice", exceptKey: "sale:o-1:menu:rice", facts: [{ key: "sale:o-1:menu:rice", id: "menu:rice", qty: 3, standing: false, cancelled: false, holding: true }] },
      { do: "reconcileSales", facts: [
        { key: "sale:o-1:menu:rice", id: "menu:rice", qty: 3, standing: false, cancelled: false, holding: true },
        { key: "sale:o-2:menu:rice", id: "menu:rice", qty: 2, standing: true, cancelled: false, holding: false },
        { key: "sale:o-0:menu:rice", id: "menu:rice", qty: 5, standing: true, cancelled: false, holding: false, endedMs: T0 },
        { key: "sale:o-4:menu:other", id: "menu:other", qty: 1, standing: true, cancelled: false, holding: false },
      ], nowMs: T0 + 1 },
      { do: "reconcileSales", facts: [{ key: "sale:o-2:menu:rice", id: "menu:rice", qty: 2, standing: true, cancelled: false, holding: false }], nowMs: T0 + 2 },
      { do: "unbooked", id: "menu:rice", facts: [{ key: "sale:o-2:menu:rice", id: "menu:rice", qty: 4, standing: true, cancelled: false, holding: false }] },
      { do: "reconcileSales", facts: [{ key: "sale:o-3:menu:rice", id: "menu:rice", qty: 7, standing: true, cancelled: false, holding: false }], nowMs: T0 + 3 },
      { do: "reconcileSales", facts: [{ key: "sale:o-2:menu:rice", id: "menu:rice", qty: 2, standing: false, cancelled: true, holding: false, endedMs: T0 - 9 }], nowMs: T0 + 4 },
      { do: "pending" },
    ],
  },
  {
    name: "the low mark once per crossing: an alert per crossing, asked counted, acked once, cleared above the mark, the request id; tidy forgets old keys and alerts",
    steps: [
      { do: "start", id: "supply:towel", input: { count: 5, low: 2 }, nowMs: T0 },
      { do: "sold", id: "supply:towel", qty: 3, reqId: "a", nowMs: T0 + 1 },
      { do: "sold", id: "supply:towel", qty: 1, reqId: "b", nowMs: T0 + 2 },
      { do: "pending", kind: "supply" },
      { do: "pending", kind: "listing" },
      { do: "asked", line: "supply:towel", crossing: 1 },
      { do: "asked", line: "supply:towel", crossing: 1 },
      { do: "asked", line: "supply:towel", crossing: 9 },
      { do: "requestId", line: "supply:towel", crossing: 1 },
      { do: "ack", line: "supply:towel", crossing: 1 },
      { do: "ack", line: "supply:towel", crossing: 1 },
      { do: "received", id: "supply:towel", key: "delivery:po-1", cumulative: 5, nowMs: T0 + 3 },
      { do: "sold", id: "supply:towel", qty: 4, reqId: "c", nowMs: T0 + 4 },
      { do: "pending" },
      { do: "tidy", nowMs: T0 + 4 + 30 * D },
      { do: "tidy", nowMs: T0 + 2 + 120 * D + 1 },
    ],
  },
];

function run(): unknown[] {
  const owner = ownerAuthority("app");
  const shop = shopRecord("stock-orders");
  return SCENARIOS.map((sc) => {
    const st: StockState = emptyStock();
    const steps = sc.steps.map((s) => {
      const c = { nowMs: "nowMs" in s ? s.nowMs : 0 };
      let result: unknown;
      const r = (x: { ok: boolean; why?: string; value?: unknown }): unknown => (x.ok ? { ok: true } : { ok: false, why: x.why });
      switch (s.do) {
        case "start": result = r(startCounting(st, owner, s.id, s.input, c)); break;
        case "stop": result = r(stopCounting(st, owner, s.id)); break;
        case "low": result = r(setLow(st, owner, s.id, s.low, c)); break;
        case "correct": result = r(correct(st, owner, s.id, { to: s.to, reqId: s.reqId, ...(s.shown !== undefined ? { shown: s.shown } : {}) }, c)); break;
        case "sold": result = r(ownerSold(st, owner, s.id, { qty: s.qty, reqId: s.reqId }, c)); break;
        case "sale": { const x = sale(st, shop, s.id, s.key, s.qty, c); result = x.ok ? { ok: true, counted: x.value !== undefined } : { ok: false, why: x.why }; break; }
        case "received": { const x = received(st, shop, s.id, s.key, s.cumulative, s.unit, c); result = x.ok ? { ok: true, counted: x.value !== undefined } : { ok: false, why: x.why }; break; }
        case "reconcileSales": result = { changed: reconcileSales(st, shop, s.facts, c) }; break;
        case "reconcileDeliveries": result = { refused: reconcileDeliveries(st, shop, s.facts, c).map((f) => f.key) }; break;
        case "unbooked": result = { held: unbookedHolds(st, s.id, s.facts, s.exceptKey) }; break;
        case "left": result = { left: leftFor(st, s.id, s.held) ?? null }; break;
        case "count": result = { count: countOf(st, s.id) ?? null }; break;
        case "pending": result = { alerts: pendingAlerts(st, s.kind) }; break;
        case "ack": result = { acked: ackAlert(st, s.line, s.crossing) }; break;
        case "asked": result = { asked: noteAsked(st, s.line, s.crossing) }; break;
        case "requestId": result = { id: lowRequestId({ line: s.line, crossing: s.crossing }) }; break;
        case "tidy": tidyStock(st, s.nowMs); result = {}; break;
      }
      // copies now: `pendingAlerts` hands back the queue's own objects, which later steps change (noteAsked)
      return { step: s, result: JSON.parse(JSON.stringify(result)), state: JSON.parse(JSON.stringify(st)) };
    });
    return { name: sc.name, steps };
  });
}

export function generate(): string { return `${JSON.stringify({ scenarios: run() }, null, 1)}\n`; }

/** True when the committed file differs from a fresh run. */
export function stale(file = OUT): boolean {
  try { return readFileSync(file, "utf8") !== generate(); } catch { return true; }
}

if (import.meta.main) {
  if (process.argv.includes("--check")) {
    if (stale()) { console.error(`${OUT} is out of date: run node go/scripts/gen_stock_vectors.ts`); process.exit(1); }
    console.log("stock vectors are fresh");
  } else { mkdirSync(dirname(OUT), { recursive: true }); writeFileSync(OUT, generate()); console.log(`wrote ${OUT}`); }
}
