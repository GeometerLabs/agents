// The shop's one stock record (block S, phase A3, owner 18 Nov 2026): how many of an item the shop has, counted only for the items the owner chooses to count. A listing ("two Persian
// kittens"), an Orders menu item ("rice thali") and a Stock orders item ("Rice 25 kg") each name an item; this module keeps ONE count per item, so the page, the open feed and the
// owner's reorder card all tell the same truth. PURE: no disk, no node:sqlite, no network, no model and no `node:` import, so the agents (and the browser demo built from them) can
// import it. The state is plain JSON kept under `assistant.stock` (modules/assistant/state.ts), saved in the same step as everything else, so it is in the backup and the export.
//
// What it promises, and how:
//  - COUNTING IS OPTIONAL PER ITEM. An item with no stock line is uncounted and behaves exactly as it did before this module: nothing here reads or changes it.
//  - ONE ID SCHEME that names which kind an item is: "listing:l-3", "menu:thali", "supply:rice25". A line may carry `aliases` (more ids that read and write the same line), so a
//    listing for rice and the Stock orders item for rice can share one count when the owner links them.
//  - WHO MAY WRITE. The owner's own acts (start counting, set a low mark, correct a count, "sold 2") need an `Authority` (modules/memory), checked at run time. The shop's own record of
//    a sale or a delivery (an Orders order that stands, a Stock orders delivery the owner marked received) is written through a `ShopRecord`, which only `shopRecord()` makes and
//    which the templates' agents call with typed facts from their own order state. A customer's or a supplier's WORDS have no path to any write: nothing here takes text.
//  - NO DOUBLE COUNTING. Every effect on a count is keyed (`sale:<order>:<item>`, `delivery:<po>`, `req:<request id>`) and the line remembers what each key has already done
//    (`applied`). Asking again for the same key and the same target changes nothing: a retry, a duplicate event or a restart cannot count twice. A sale is "the order stands, qty N";
//    a cancelled order sets the target back to 0, which returns exactly what was taken. A delivery is the CUMULATIVE quantity received on that purchase order, so a part delivery then the
//    rest adds each piece once, and the same mark twice adds nothing.
//  - ORDERS STAYS THE SOURCE FOR ITS HOLDS. Orders works out what an order holds from the orders themselves (templates/commerce/orders/src/order.ts). This module does not hold anything:
//    a count falls only for an order that STANDS (confirmed or completed), and `leftFor` takes away the orders that hold stock but are not yet booked here, so two holds can never both take
//    the last unit and a booked order is never counted twice (once in the count, once as a hold).
//  - A count never goes below 0. A sale larger than the count takes what is there and notes the shortfall (`short`), which the owner sees; the return gives back only what was taken.
//  - LOW STOCK fires once per crossing: when a count falls to the low mark the line sets `lowFlag` and queues one alert; it clears only when the count rises above the mark again.
import { isAuthority } from "../memory/memory.ts";
import type { Authority } from "../memory/memory.ts";

/** The kinds of item a stock line may count, the prefix of its id. */
export const STOCK_KINDS = ["listing", "menu", "supply"] as const;
export type StockKind = (typeof STOCK_KINDS)[number];

/** "listing:l-3", "menu:thali", "supply:rice25". */
export type StockId = string;
const ID = /^(listing|menu|supply):[A-Za-z0-9._-]{1,64}$/u;
export const listingStockId = (listingId: string): StockId => `listing:${listingId}`;
export const menuStockId = (itemId: string): StockId => `menu:${itemId}`;
export const supplyStockId = (itemId: string): StockId => `supply:${itemId}`;
export const kindOf = (id: StockId): StockKind | undefined => (ID.test(id) ? (id.slice(0, id.indexOf(":")) as StockKind) : undefined);
export const isStockId = (id: unknown): id is StockId => typeof id === "string" && ID.test(id);

export const MAX_LINES = 300;
export const MAX_COUNT = 1_000_000;
/** The movements kept per line for the owner's history; the keys that stop a double count are kept longer (`applied`). */
export const MAX_MOVES = 30;
export const MAX_APPLIED = 400;
/** A key older than this is forgotten (an order or delivery does not change after months); the oldest go first past MAX_APPLIED. */
export const APPLIED_KEPT_MS = 120 * 24 * 3_600_000;
export const MAX_ALERTS = 50;
export const MAX_NAME = 60;
export const MAX_UNIT = 20;

export type MovementKind = "started" | "sold" | "returned" | "received" | "corrected";
export interface Movement {
  kind: MovementKind;
  /** The change to the count (negative for a sale), as it was really applied. */
  delta: number;
  /** The count after it. */
  after: number;
  atMs: number;
  /** Who: the owner's own act, or the shop's own record of an order or a delivery. */
  by: "owner" | "operator" | "builder" | "shop";
  /** A sale larger than the count: how many could not be taken. */
  short?: number;
}

/** What a key has already done: the quantity it stands for and how much of that really came off the count. */
export interface Applied { qty: number; took: number; atMs: number }

export interface StockLine {
  id: StockId;
  /** What the owner sees, in the owner's own words (the item's name). Optional: the page falls back to the item's own name. */
  name?: string;
  /** The unit the count is in ("bag", "kg"). A delivery in another unit is refused, never converted. */
  unit?: string;
  count: number;
  /** The owner's low mark: at or under it the owner is told once. */
  low?: number;
  /** True while the count is at or under the low mark and the owner has been told for this crossing. */
  lowFlag: boolean;
  /** How many times the count has crossed down to the low mark: names a crossing, so a reorder is asked for once per crossing. */
  crossings: number;
  /** More ids that read and write this same line. */
  aliases?: StockId[];
  applied: Record<string, Applied>;
  moves: Movement[];
  startedMs: number;
}

/** One "this item is low" waiting to be shown: the owner gets one card or one line per crossing. */
export interface LowAlert { line: StockId; crossing: number; count: number; atMs: number }

export interface StockState {
  lines: StockLine[];
  alerts: LowAlert[];
}

export const emptyStock = (): StockState => ({ lines: [], alerts: [] });

/** The stock in an assistant state, made on first use. A store from before stock has none and loads as it was. */
export function stockOf(holder: { stock?: StockState }): StockState {
  if (!holder.stock) holder.stock = emptyStock();
  return holder.stock;
}

// ---- who may write ----------------------------------------------------------------------------------------------------------------------------

const records = new WeakSet<object>();
/** The shop's own record of a sale or a delivery, made from typed facts of the agent's own order state: never from anyone's words. */
export interface ShopRecord { readonly from: "orders" | "stock-orders" }

/** Only an agent's own reconcile step calls this, with facts it read from its orders (a customer's chat code never imports this file: a test reads the sources). */
export function shopRecord(from: ShopRecord["from"]): ShopRecord {
  const r = Object.freeze({ from });
  records.add(r);
  return r;
}
const isShopRecord = (r: unknown): r is ShopRecord => typeof r === "object" && r !== null && records.has(r);
export type Source = Authority | ShopRecord;

function requireAuthority(a: unknown): asserts a is Authority {
  if (!isAuthority(a)) throw new Error("Only the owner, the Operator or the builder can change the shop's stock count.");
}
function requireSource(a: unknown): asserts a is Source {
  if (!isAuthority(a) && !isShopRecord(a)) throw new Error("Only the shop's own record of a sale or a delivery, or its owner, can change the stock count.");
}
const byOf = (s: Source): Movement["by"] => (isAuthority(s) ? s.by : "shop");

// ---- results ----------------------------------------------------------------------------------------------------------------------------------

export type Failure = "bad_id" | "bad_count" | "bad_low" | "bad_text" | "exists" | "full" | "no_such_line" | "stale" | "unit";
export type Result<T> = { ok: true; value: T } | { ok: false; why: Failure };
const fail = (why: Failure): { ok: false; why: Failure } => ({ ok: false, why });
const clean = (text: string): string => text.replace(/\s+/gu, " ").trim();
const whole = (n: unknown, max = MAX_COUNT): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0 && n <= max;

export interface WriteContext { nowMs: number }

// ---- reading ----------------------------------------------------------------------------------------------------------------------------------

/** The line an id names, by its own id or an alias. Undefined: the item is uncounted. */
export function lineOf(s: StockState, id: StockId): StockLine | undefined {
  return s.lines.find((l) => l.id === id) ?? s.lines.find((l) => l.aliases?.includes(id));
}
export const isCounted = (s: StockState | undefined, id: StockId): boolean => s !== undefined && lineOf(s, id) !== undefined;
/** The count of a counted item, else undefined. */
export const countOf = (s: StockState | undefined, id: StockId): number | undefined => (s ? lineOf(s, id)?.count : undefined);

/**
 * How many of a counted item can still be taken now: the count, less what orders hold that is not yet booked in the count. `held` is worked out by the caller from its own orders
 * (Orders: the orders that hold stock whose sale key is not in `applied`; see `unbookedHolds`). Undefined: uncounted, so the caller's own limits stand as they were.
 */
export function leftFor(s: StockState | undefined, id: StockId, held = 0): number | undefined {
  const l = s ? lineOf(s, id) : undefined;
  return l ? Math.max(0, l.count - held) : undefined;
}

/** The ids of listings whose line is counted and at 0: they are sold by themselves (the page, the feed and the talk leave them out; nothing is written to the listing). */
export function soldOutListings(s: StockState | undefined): Set<string> {
  const out = new Set<string>();
  for (const l of s?.lines ?? []) {
    if (l.count > 0) continue;
    for (const id of [l.id, ...(l.aliases ?? [])]) if (id.startsWith("listing:")) out.add(id.slice("listing:".length));
  }
  return out;
}

/** The quantity a counted listing shows (`items[].quantity`), or undefined for an uncounted one (which shows the owner's own `qty` as before). */
export const quantityOfListing = (s: StockState | undefined, listingId: string): number | undefined => countOf(s, listingStockId(listingId));

/** Lines at or under their low mark, for the morning line: the ones the owner has been told of this crossing and has not yet restocked. */
export const lowLines = (s: StockState | undefined, except?: StockKind): StockLine[] => (s?.lines ?? []).filter((l) => l.lowFlag && (except === undefined || kindOf(l.id) !== except));

/** What the owner's Stock page lists: low and sold-out first, then by name. */
export interface StockRow { id: StockId; name: string; unit?: string; count: number; low?: number; isLow: boolean; soldOut: boolean; kind: StockKind; moves: Movement[] }
export function ownerRows(s: StockState | undefined, nameOf: (id: StockId) => string | undefined = () => undefined): StockRow[] {
  const rows = (s?.lines ?? []).map((l): StockRow => ({
    id: l.id, name: l.name ?? nameOf(l.id) ?? l.id, ...(l.unit ? { unit: l.unit } : {}), count: l.count, ...(l.low !== undefined ? { low: l.low } : {}),
    isLow: l.lowFlag, soldOut: l.count <= 0, kind: kindOf(l.id) ?? "listing", moves: l.moves.slice(-5).reverse(),
  }));
  return rows.sort((a, b) => Number(b.soldOut) - Number(a.soldOut) || Number(b.isLow) - Number(a.isLow) || a.name.localeCompare(b.name));
}

// ---- the owner's own acts (an Authority) ---------------------------------------------------------------------------------------------------------

export interface StartInput { count: number; name?: string; unit?: string; low?: number; aliases?: StockId[] }

/** The owner chooses to count an item: a line is made with the count the owner says. An item already counted is refused (use `correct`). */
export function startCounting(s: StockState, a: Authority, id: StockId, input: StartInput, c: WriteContext): Result<StockLine> {
  requireAuthority(a);
  if (!isStockId(id)) return fail("bad_id");
  if (!whole(input.count)) return fail("bad_count");
  if (input.low !== undefined && !whole(input.low)) return fail("bad_low");
  const name = input.name === undefined ? undefined : clean(input.name);
  const unit = input.unit === undefined ? undefined : clean(input.unit);
  if ((name !== undefined && name.length > MAX_NAME) || (unit !== undefined && unit.length > MAX_UNIT)) return fail("bad_text");
  const aliases = (input.aliases ?? []).filter((x) => isStockId(x) && x !== id);
  if ((input.aliases ?? []).length !== aliases.length) return fail("bad_id");
  if ([id, ...aliases].some((x) => lineOf(s, x))) return fail("exists");
  if (s.lines.length >= MAX_LINES) return fail("full");
  const line: StockLine = {
    id, ...(name ? { name } : {}), ...(unit ? { unit } : {}), count: input.count, ...(input.low !== undefined ? { low: input.low } : {}), lowFlag: false, crossings: 0,
    ...(aliases.length > 0 ? { aliases } : {}), applied: {}, moves: [{ kind: "started", delta: input.count, after: input.count, atMs: c.nowMs, by: a.by }], startedMs: c.nowMs,
  };
  s.lines.push(line);
  watchLow(s, line, c);
  return { ok: true, value: line };
}

/** The owner stops counting an item: its line goes, and the item behaves as an uncounted one again (a listing is just available or sold). */
export function stopCounting(s: StockState, a: Authority, id: StockId): Result<true> {
  requireAuthority(a);
  const l = lineOf(s, id);
  if (!l) return fail("no_such_line");
  s.lines = s.lines.filter((x) => x !== l);
  s.alerts = s.alerts.filter((x) => x.line !== l.id);
  return { ok: true, value: true };
}

/** The owner's low mark, or `null` to clear it. */
export function setLow(s: StockState, a: Authority, id: StockId, low: number | null, c: WriteContext): Result<StockLine> {
  requireAuthority(a);
  const l = lineOf(s, id);
  if (!l) return fail("no_such_line");
  if (low !== null && !whole(low)) return fail("bad_low");
  if (low === null) { delete l.low; l.lowFlag = false; s.alerts = s.alerts.filter((x) => x.line !== l.id); } else l.low = low;
  watchLow(s, l, c);
  return { ok: true, value: l };
}

/**
 * The owner's own count: "there are 12". `reqId` is the page's request id, so a retry does nothing. `shown` is the count the owner was looking at: if the count moved since (a sale came
 * in), the correction is refused as stale rather than overwriting it, and the page asks again with the new count.
 */
export function correct(s: StockState, a: Authority, id: StockId, input: { to: number; reqId: string; shown?: number }, c: WriteContext): Result<StockLine> {
  requireAuthority(a);
  const l = lineOf(s, id);
  if (!l) return fail("no_such_line");
  if (!whole(input.to)) return fail("bad_count");
  const key = `req:${input.reqId}`;
  if (l.applied[key]) return { ok: true, value: l };
  if (input.shown !== undefined && input.shown !== l.count) return fail("stale");
  const delta = input.to - l.count;
  l.applied[key] = { qty: input.to, took: 0, atMs: c.nowMs };
  l.count = input.to;
  noteMove(l, { kind: "corrected", delta, after: l.count, atMs: c.nowMs, by: a.by });
  watchLow(s, l, c);
  prune(l, c.nowMs);
  return { ok: true, value: l };
}

/** The owner's "sold 2" (in their app): the same keyed sale as an order's, so a retry with the same request id takes nothing more. */
export function ownerSold(s: StockState, a: Authority, id: StockId, input: { qty: number; reqId: string }, c: WriteContext): Result<StockLine> {
  requireAuthority(a);
  const l = lineOf(s, id);
  if (!l) return fail("no_such_line");
  if (!whole(input.qty, MAX_COUNT) || input.qty < 1) return fail("bad_count");
  settleOut(s, l, `req:${input.reqId}`, input.qty, a, c);
  return { ok: true, value: l };
}

// ---- the shop's own record of a sale or a delivery ------------------------------------------------------------------------------------------------

/**
 * A sale, as the shop's own record has it: the order `key` stands for `qty` of the item (target semantics). The same key and qty again changes nothing; a larger qty takes the difference;
 * a smaller one (or 0, a cancelled order) gives back what was taken. An uncounted item is skipped and nothing is made for it.
 */
export function sale(s: StockState, src: Source, id: StockId, key: string, qty: number, c: WriteContext): Result<StockLine | undefined> {
  requireSource(src);
  const l = lineOf(s, id);
  if (!l) return { ok: true, value: undefined };
  if (!whole(qty)) return fail("bad_count");
  settleOut(s, l, key, qty, src, c);
  return { ok: true, value: l };
}

/**
 * A delivery, as the shop's own record has it: `cumulative` is the whole quantity received so far on the purchase order `key` (the owner marked "received 4", then "received 6": 4 then 10). Only
 * the difference is added, so the same mark twice adds nothing, and a wrong item adds nothing (the caller does not pass it). A delivery in another unit than the line's is refused: a unit is never
 * converted into another.
 */
export function received(s: StockState, src: Source, id: StockId, key: string, cumulative: number, unit: string | undefined, c: WriteContext): Result<StockLine | undefined> {
  requireSource(src);
  const l = lineOf(s, id);
  if (!l) return { ok: true, value: undefined };
  if (!whole(cumulative)) return fail("bad_count");
  if (l.unit !== undefined && unit !== undefined && l.unit !== unit) return fail("unit");
  const prev = l.applied[key];
  const delta = cumulative - (prev?.qty ?? 0);
  if (delta <= 0) return { ok: true, value: l };
  l.applied[key] = { qty: cumulative, took: cumulative, atMs: c.nowMs };
  l.count = Math.min(MAX_COUNT, l.count + delta);
  noteMove(l, { kind: "received", delta, after: l.count, atMs: c.nowMs, by: byOf(src) });
  watchLow(s, l, c);
  prune(l, c.nowMs);
  return { ok: true, value: l };
}

function settleOut(s: StockState, l: StockLine, key: string, target: number, src: Source, c: WriteContext): void {
  const prev = l.applied[key] ?? { qty: 0, took: 0, atMs: c.nowMs };
  if (target === prev.qty) return;
  if (target > prev.qty) {
    const want = target - prev.qty;
    const took = Math.min(want, l.count);
    l.count -= took;
    l.applied[key] = { qty: target, took: prev.took + took, atMs: c.nowMs };
    noteMove(l, { kind: "sold", delta: -took, after: l.count, atMs: c.nowMs, by: byOf(src), ...(took < want ? { short: want - took } : {}) });
  } else {
    // a smaller target (a cancelled order is 0): give back what this key really took, in proportion to what is no longer sold
    const back = Math.min(prev.took, prev.qty - target);
    l.count = Math.min(MAX_COUNT, l.count + back);
    l.applied[key] = { qty: target, took: prev.took - back, atMs: c.nowMs };
    noteMove(l, { kind: "returned", delta: back, after: l.count, atMs: c.nowMs, by: byOf(src) });
  }
  watchLow(s, l, c);
  prune(l, c.nowMs);
}

// ---- the low mark: once per crossing ----------------------------------------------------------------------------------------------------------------

function watchLow(s: StockState, l: StockLine, c: WriteContext): void {
  if (l.low === undefined) { l.lowFlag = false; return; }
  if (l.count <= l.low && !l.lowFlag) {
    l.lowFlag = true;
    l.crossings += 1;
    s.alerts.push({ line: l.id, crossing: l.crossings, count: l.count, atMs: c.nowMs });
    if (s.alerts.length > MAX_ALERTS) s.alerts = s.alerts.slice(-MAX_ALERTS);
  } else if (l.count > l.low && l.lowFlag) l.lowFlag = false;
}

/** The alerts not yet shown whose line is of this kind (a Stock orders agent takes the "supply" ones). Pure: shows them without removing. */
export const pendingAlerts = (s: StockState | undefined, kind?: StockKind): LowAlert[] => (s?.alerts ?? []).filter((a) => kind === undefined || kindOf(a.line) === kind);

/** The card or line for this crossing has been made: take it off the queue. A second call finds nothing. */
export function ackAlert(s: StockState, line: StockId, crossing: number): boolean {
  const before = s.alerts.length;
  s.alerts = s.alerts.filter((a) => !(a.line === line && a.crossing === crossing));
  return s.alerts.length < before;
}

/** The request id a reorder for one crossing carries, so asking twice for the same crossing makes one order: "low:supply:rice25#2". */
export const lowRequestId = (a: Pick<LowAlert, "line" | "crossing">): string => `low:${a.line}#${a.crossing}`;

// ---- Orders: what is held but not yet booked ---------------------------------------------------------------------------------------------------------

/** One order line as the agent reads it from its own orders: the key its sale is booked under, the item, the quantity, whether the order STANDS (confirmed or completed) and whether it merely HOLDS stock. */
export interface OrderFact { key: string; id: StockId; qty: number; standing: boolean; cancelled: boolean; holding: boolean }

/**
 * Bring the counts in line with the orders, once per step: every order that stands is booked, every cancelled one is given back. Orders absent from `facts` (an old order the agent no longer
 * keeps) are never touched. Idempotent: running it again with the same facts changes nothing.
 */
export function reconcileSales(s: StockState, src: Source, facts: readonly OrderFact[], c: WriteContext): number {
  requireSource(src);
  let changed = 0;
  for (const f of facts) {
    const l = lineOf(s, f.id);
    if (!l) continue;
    const target = f.standing ? f.qty : f.cancelled ? 0 : undefined;
    if (target === undefined) continue;
    const before = l.applied[f.key]?.qty ?? 0;
    if (target === before) continue;
    settleOut(s, l, f.key, target, src, c);
    changed += 1;
  }
  return changed;
}

/** What orders hold of a counted item that is NOT yet in the count: holding or standing orders whose sale key has not been booked. `exceptKey` leaves out the order being checked. */
export function unbookedHolds(s: StockState | undefined, id: StockId, facts: readonly OrderFact[], exceptKey = ""): number {
  const l = s ? lineOf(s, id) : undefined;
  if (!l) return 0;
  return facts.filter((f) => f.id === id && f.key !== exceptKey && (f.holding || f.standing) && (l.applied[f.key]?.qty ?? 0) < f.qty).reduce((n, f) => n + f.qty - (l.applied[f.key]?.qty ?? 0), 0);
}

/** A delivery fact as the Stock orders agent reads it from a purchase order the owner marked received (a wrong item is not passed). */
export interface DeliveryFact { key: string; id: StockId; cumulative: number; unit?: string }

/** Add every delivery not yet in the count. Returns the facts the stock refused (a unit that does not match) so the agent can say so; the rest are booked once. */
export function reconcileDeliveries(s: StockState, src: Source, facts: readonly DeliveryFact[], c: WriteContext): DeliveryFact[] {
  requireSource(src);
  const refused: DeliveryFact[] = [];
  for (const f of facts) {
    const r = received(s, src, f.id, f.key, f.cumulative, f.unit, c);
    if (!r.ok) refused.push(f);
  }
  return refused;
}

// ---- keeping the state small ------------------------------------------------------------------------------------------------------------------------

function noteMove(l: StockLine, m: Movement): void {
  l.moves.push(m);
  if (l.moves.length > MAX_MOVES) l.moves = l.moves.slice(-MAX_MOVES);
}

function prune(l: StockLine, nowMs: number): void {
  const keys = Object.keys(l.applied);
  if (keys.length <= MAX_APPLIED) return;
  for (const k of keys) if (nowMs - l.applied[k].atMs > APPLIED_KEPT_MS) delete l.applied[k];
  const left = Object.keys(l.applied).sort((a, b) => l.applied[a].atMs - l.applied[b].atMs);
  for (const k of left.slice(0, Math.max(0, left.length - MAX_APPLIED))) delete l.applied[k];
}

/** On the tick: forget keys old enough that their order or delivery cannot change any more. */
export function tidyStock(s: StockState, nowMs: number): void {
  for (const l of s.lines) {
    for (const k of Object.keys(l.applied)) if (nowMs - l.applied[k].atMs > APPLIED_KEPT_MS) delete l.applied[k];
  }
  s.alerts = s.alerts.filter((a) => nowMs - a.atMs < 30 * 24 * 3_600_000);
}

// ---- the record --------------------------------------------------------------------------------------------------------------------------------------

export const STOCK_ACTION = "stock";
export type StockChange = "started" | "stopped" | "low_mark" | "corrected" | "sold" | "booked_sale" | "returned" | "received" | "low";

/** What a `stock` line of the record carries: the item's id and kind, who and what changed. Counts are the owner's business figures, not customer data, and are kept as inputs. */
export const stockRefs = (id: StockId, change: StockChange, by: string): Record<string, string> => ({ item: id, kind: kindOf(id) ?? "", change, by });
