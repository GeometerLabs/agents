// What the runtime does with the owner's Stock page, for every template at once (block S, phase A3): the events the runtime's own HTTP layer makes when the owner uses the Stock view of their
// app (start counting an item, set its count, "sold 2", the low mark, stop counting), their one rule-checked effect on the shop's stock, and the reads the owner's page needs. Like the listings
// kit (modules/listings/kit.ts) it is run by the runtime CORE inside a step, so the change is saved in the same transaction as the rest and no template's agent has to know about it.
// PURE: no disk, no node:sqlite, no network, no `node:` import.
//
// Who writes: the owner. The runtime's HTTP layer has checked the owner's link or session before it made the event, and the effect is done with an owner Authority made here
// (modules/memory ownerAuthority("app")). A customer has no route to any of this: the routes are the owner's, and no event of this kind is accepted from the inbox or the public channel.
// The request id of the page's form is the key of the effect (stock.ts `req:<id>`), so a double tap or a retried request changes the count once.
import type { Language } from "../language/languages.ts";
import { ownerAuthority } from "../memory/memory.ts";
import type { ActionRecord } from "../record/record.ts";
import { listingsOf, liveListingTitles } from "../listings/listings.ts";
import { STOCK_ACTION, correct, isStockId, lineOf, listingStockId, ownerRows, ownerSold, setLow, startCounting, stockOf, stockRefs, stopCounting } from "./stock.ts";
import type { Failure, StockChange, StockId, StockRow, StockState } from "./stock.ts";
import type { AssistantState } from "../assistant/state.ts";

export type StockOp =
  | { op: "start"; id: string; count: number; low?: number; name?: string; unit?: string }
  | { op: "correct"; id: string; to: number; shown?: number }
  | { op: "sold"; id: string; qty: number }
  | { op: "low"; id: string; low: number | null }
  | { op: "stop"; id: string };

/** The owner used their Stock page (made only by the runtime's HTTP layer after it checked the owner). `id` is the page's request id and the key of the effect. */
export interface OwnerStockEvent { kind: "owner_stock"; id: string; op: StockOp }
export const stockEventKey = (e: OwnerStockEvent): string => `${e.kind}:${e.id}`;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const REQUEST_ID = /^[A-Za-z0-9-]{1,64}$/u;
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** The body of POST /internal/channel/owner-stock, checked for shape. The rules themselves (limits, ids) are applied again in the step. */
export function checkOwnerStock(body: unknown): { ok: true; event: OwnerStockEvent } | { ok: false; error: string } {
  const bad = (error: string) => ({ ok: false as const, error });
  if (!isObj(body) || typeof body.id !== "string" || !REQUEST_ID.test(body.id) || !isObj(body.op)) return bad('Send {"id": a request id, "op": {...}}.');
  const o = body.op;
  if (typeof o.id !== "string" || !isStockId(o.id)) return bad("An item id looks like listing:l-3, menu:thali or supply:rice.");
  const id = o.id;
  const mk = (op: StockOp) => ({ ok: true as const, event: { kind: "owner_stock" as const, id: body.id as string, op } });
  switch (o.op) {
    case "start": {
      const count = num(o.count);
      const low = o.low === undefined ? undefined : num(o.low);
      if (count === undefined || (o.low !== undefined && low === undefined)) return bad("count and low are numbers.");
      return mk({ op: "start", id, count, ...(low !== undefined ? { low } : {}), ...(typeof o.name === "string" && o.name.trim() ? { name: o.name.slice(0, 80) } : {}), ...(typeof o.unit === "string" && o.unit.trim() ? { unit: o.unit.slice(0, 40) } : {}) });
    }
    case "correct": {
      const to = num(o.to);
      const shown = o.shown === undefined ? undefined : num(o.shown);
      if (to === undefined || (o.shown !== undefined && shown === undefined)) return bad("to is the new count, a number.");
      return mk({ op: "correct", id, to, ...(shown !== undefined ? { shown } : {}) });
    }
    case "sold": { const qty = num(o.qty); return qty === undefined ? bad("qty is how many were sold, a number.") : mk({ op: "sold", id, qty }); }
    case "low": {
      if (o.low === null) return mk({ op: "low", id, low: null });
      const low = num(o.low);
      return low === undefined ? bad("low is a number, or null to clear it.") : mk({ op: "low", id, low });
    }
    case "stop": return mk({ op: "stop", id });
    default: return bad("op is one of start, correct, sold, low, stop.");
  }
}

/** The effect of one op on a state with the owner's authority: shared by the step (real state) and the page's pre-check (a copy), so what the page says is what the step does. */
function applyOp(s: StockState, op: StockOp, reqId: string, nowMs: number): { ok: true; change: StockChange; id: StockId } | { ok: false; why: Failure } {
  const a = ownerAuthority("app");
  const w = { nowMs };
  const done = (r: { ok: boolean; why?: Failure }, change: StockChange) => (r.ok ? { ok: true as const, change, id: op.id } : { ok: false as const, why: (r as { why: Failure }).why });
  switch (op.op) {
    case "start": return done(startCounting(s, a, op.id, { count: op.count, ...(op.low !== undefined ? { low: op.low } : {}), ...(op.name ? { name: op.name } : {}), ...(op.unit ? { unit: op.unit } : {}) }, w), "started");
    case "correct": return done(correct(s, a, op.id, { to: op.to, reqId, ...(op.shown !== undefined ? { shown: op.shown } : {}) }, w), "corrected");
    case "sold": return done(ownerSold(s, a, op.id, { qty: op.qty, reqId }, w), "sold");
    case "low": return done(setLow(s, a, op.id, op.low, w), "low_mark");
    case "stop": return done(stopCounting(s, a, op.id), "stopped");
  }
}

// ---- the reads ----------------------------------------------------------------------------------------------------------------------------------------

/** An item the owner could start counting: its id, its name in the owner's language and, for a Stock orders item, the unit it is ordered in. */
export interface ItemRef { id: StockId; name: string; unit?: string }

export interface OwnerStockView {
  rows: StockRow[];
  /** Items not counted yet that the owner may start counting (live listings; the template's menu or supply items). */
  candidates: ItemRef[];
  /** How many are low or sold out, for the page's heading. */
  attention: number;
}

export interface StockKitOptions {
  owner: { whatsapp: string; language: Language };
  /** The template's own items the owner may count (Orders' menu, Stock orders' items), named in the owner's language. Left out: only listings. */
  items?: (language: Language) => ItemRef[];
}

export interface StockKit<Store extends { assistant?: AssistantState }> {
  takes(event: { kind: string }): boolean;
  run(event: OwnerStockEvent, ctx: { store: Store; record: ActionRecord; nowMs: number }): void;
  /** What an op would do now, without doing it: undefined when it would work, else why not. For the page's own notice. */
  check(store: Store, event: OwnerStockEvent, nowMs: number): Failure | undefined;
  ownerView(store: Store, nowMs: number, language?: Language): OwnerStockView;
}

export function createStockKit<Store extends { assistant?: AssistantState }>(o: StockKitOptions): StockKit<Store> {
  const peek = (store: Store): StockState | undefined => store.assistant?.stock;
  const stateOf = (store: Store): StockState => stockOf((store.assistant ??= { seq: 0, cards: [], refused: [], closedDays: [], undo: [], talk: [], limitChanges: [] }));

  /** Every item the owner could count, by id, named in this language. */
  const known = (store: Store, language: Language): ItemRef[] => {
    const ls = store.assistant?.listings ? listingsOf(store.assistant) : undefined;
    const listed = ls ? liveListingTitles(ls, language).map((l) => ({ id: listingStockId(l.id), name: l.title })) : [];
    return [...listed, ...(o.items?.(language) ?? [])];
  };

  return {
    takes: (event) => event.kind === "owner_stock",
    run(event, ctx) {
      const s = stateOf(ctx.store);
      const op = event.op;
      // a new line takes the item's own name and unit when the page did not send one, so the Stock page and the reorder words say the item's name
      const ref = known(ctx.store, o.owner.language).find((r) => r.id === op.id);
      const fixed: StockOp = op.op === "start" ? { ...op, ...(op.name === undefined && ref ? { name: ref.name } : {}), ...(op.unit === undefined && ref?.unit ? { unit: ref.unit } : {}) } : op;
      const r = applyOp(s, fixed, event.id, ctx.nowMs);
      const refs = stockRefs(op.id, r.ok ? r.change : "corrected", "owner");
      if (!r.ok) {
        ctx.record.append({ conversation: o.owner.whatsapp, action: STOCK_ACTION, outcome: "blocked", inputs: { op: op.op, item: op.id, why: r.why }, language: o.owner.language, refs, notes: `the owner's Stock page asked for something the rules refuse (${r.why}); nothing changed` });
        return;
      }
      ctx.record.append({ conversation: o.owner.whatsapp, action: STOCK_ACTION, outcome: "confirmed", inputs: { op: op.op, item: op.id, ...("count" in op ? { count: op.count } : {}), ...("to" in op ? { to: op.to } : {}), ...("qty" in op ? { qty: op.qty } : {}), ...("low" in op ? { low: op.low } : {}) }, language: o.owner.language, refs, notes: "the owner changed their stock count in their app" });
    },
    check(store, event, nowMs) {
      const copy = structuredClone(peek(store) ?? { lines: [], alerts: [] });
      const r = applyOp(copy, event.op, event.id, nowMs);
      return r.ok ? undefined : r.why;
    },
    ownerView(store, nowMs, language = o.owner.language) {
      void nowMs;
      const s = peek(store);
      const refs = known(store, language);
      const rows = ownerRows(s, (id) => refs.find((r) => r.id === id)?.name);
      return { rows, candidates: refs.filter((r) => !s || !lineOf(s, r.id)), attention: rows.filter((r) => r.isLow || r.soldOut).length };
    },
  };
}
