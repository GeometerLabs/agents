// Client health and margin (plan B32), per shop and over a person's shops. No words in any language here: it returns facts and numbers, and
// views-health.ts says them in the reader's language.
//
//  - The partner's own entries (the price they charge, a setup fee, support minutes and what an hour of their time is worth) are kept in the panel's own
//    store, under the person's account, and are never sent to fleet: fleet keeps counts only.
//  - The running cost is the same arithmetic as the shop page's cost line (cost.ts): whole paise, each line rounded UP once, the plan fee read from the price
//    list in force. WhatsApp at cost and the model come from THIS MONTH's entries of the exported record (lib/usage.ts), not from the cumulative totals.
//  - Unknown stays unknown, never 0: a line with no number has no amount, the margin then says which lines it leaves out, and a missing price makes the margin unknown.
//  - It states a margin from numbers the person typed and numbers the record holds. It never forecasts and never says what anyone could make.
import { monthRange } from "../../modules/report/months.ts";
import { summarizeUsage, usageRatesFrom } from "../lib/usage.ts";
import type { UsageTotals } from "../lib/usage.ts";
import type { Exported } from "./activity.ts";
import type { FleetAnswer, PlanName, ShopStatus } from "./contract.ts";
import { microPaise, paiseOf } from "./cost.ts";
import type { PriceList } from "./cost.ts";
import { STALE_AFTER_MS } from "./licence.ts";
import type { LicenceState } from "./licence.ts";
import type { Store } from "./store.ts";

// ---- what the person types, and where it is kept -------------------------------------------------------------------------------------------------

/** One shop's entries, for one person. Every field is optional: not entered is "unknown", never 0. */
export interface Entries {
  schema: 1;
  /** What the person charges the shop each month, in whole paise. */
  pricePaise?: number;
  /** A one-time setup fee, in whole paise. */
  setupFeePaise?: number;
  /** Support minutes for ONE month ("2026-11"): a new month starts with none entered. */
  supportMonth?: string;
  supportMinutes?: number;
  /** What an hour of the person's own time is worth to them, in whole paise. */
  supportPaisePerHour?: number;
}

export type EntryProblem = "price" | "setup" | "minutes" | "rate";
export const MAX_RUPEES = 10_000_000;
export const MAX_MINUTES = 100_000;

/** "1500", "1,500", "1500.50" as whole paise; "" is "not entered" (undefined); anything else is a problem (null). */
export function paiseFromText(text: string | undefined): number | undefined | null {
  const t = (text ?? "").trim().replace(/^₹\s*/u, "").replace(/,/gu, "");
  if (t === "") return undefined;
  const m = /^(\d{1,8})(?:\.(\d{1,2}))?$/u.exec(t);
  if (!m || Number(m[1]) > MAX_RUPEES) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || 0);
}

export function minutesFromText(text: string | undefined): number | undefined | null {
  const t = (text ?? "").trim();
  if (t === "") return undefined;
  return /^\d{1,6}$/u.test(t) && Number(t) <= MAX_MINUTES ? Number(t) : null;
}

/** The form's fields as entries, or the first problem. */
export function entriesFromForm(form: Record<string, string | undefined>, month: string): { ok: true; entries: Entries } | { ok: false; problem: EntryProblem } {
  const price = paiseFromText(form.price);
  const setup = paiseFromText(form.setup);
  const minutes = minutesFromText(form.minutes);
  const rate = paiseFromText(form.rate);
  if (price === null) return { ok: false, problem: "price" };
  if (setup === null) return { ok: false, problem: "setup" };
  if (minutes === null) return { ok: false, problem: "minutes" };
  if (rate === null) return { ok: false, problem: "rate" };
  return {
    ok: true,
    entries: {
      schema: 1,
      ...(price !== undefined ? { pricePaise: price } : {}), ...(setup !== undefined ? { setupFeePaise: setup } : {}),
      ...(minutes !== undefined ? { supportMonth: month, supportMinutes: minutes } : {}), ...(rate !== undefined ? { supportPaisePerHour: rate } : {}),
    },
  };
}

const keyOf = (accountId: string) => accountId.replace(/_/gu, "-");
const entriesName = (accountId: string, shop: string) => `health/${keyOf(accountId)}/${shop}.json`;

export function createEntries(store: Store) {
  return {
    /** This person's entries for a shop. Nobody else's are ever read for them. */
    read(accountId: string, shop: string): Entries | undefined {
      const e = store.read<Entries>(entriesName(accountId, shop));
      return e && e.schema === 1 ? e : undefined;
    },
    write(accountId: string, shop: string, entries: Entries): void { store.write(entriesName(accountId, shop), entries); },
  };
}
export type EntryStore = ReturnType<typeof createEntries>;

// ---- the running cost and the margin ---------------------------------------------------------------------------------------------------------------

export type CostId = "plan" | "whatsapp" | "model" | "support";
/** Why a line is what it is, as a code the view says in words. */
export type CostNote = "innovator" | "self-host" | "included" | "floor" | "estimate" | "no-record" | "no-plan" | "no-price" | "no-minutes" | "no-rate";
export interface CostItem { id: CostId; /** Whole paise, rounded up once. Null exactly when the line is unknown. */ paise: number | null; notes: CostNote[]; /** Only on the model line when some calls had no price: how many. */ unpriced?: number; /** Only on the support line: the minutes. */ minutes?: number }

export interface ShopMargin {
  /** What the person charges a month, or null when not entered. */
  pricePaise: number | null;
  setupFeePaise: number | null;
  items: CostItem[];
  cost: { paise: number; complete: boolean; unknown: CostId[] };
  /** Price minus the known costs. Null when the price is unknown. `complete` is false when a cost line is unknown: then it is the margin before those lines. */
  margin: { paise: number; complete: boolean } | null;
}

/** The arithmetic, on already-worked-out lines. */
export function marginOf(pricePaise: number | null, items: CostItem[], setupFeePaise: number | null = null): ShopMargin {
  const unknown = items.filter((i) => i.paise === null).map((i) => i.id);
  const paise = items.reduce((sum, i) => sum + (i.paise ?? 0), 0);
  return {
    pricePaise, setupFeePaise, items, cost: { paise, complete: unknown.length === 0, unknown },
    margin: pricePaise === null ? null : { paise: pricePaise - paise, complete: unknown.length === 0 },
  };
}

export interface Sum {
  shops: number;
  /** Shops whose price is entered. */
  priced: number;
  /** The sum of the known margins. Null when no shop has one. */
  marginPaise: number | null;
  /** True only when every shop has a margin and none of them leaves a cost line out. */
  complete: boolean;
  costPaise: number;
  setupPaise: number;
}

export function sumMargins(list: readonly ShopMargin[]): Sum {
  const known = list.filter((m) => m.margin !== null);
  return {
    shops: list.length, priced: known.length,
    marginPaise: known.length === 0 ? null : known.reduce((n, m) => n + (m.margin as { paise: number }).paise, 0),
    complete: list.length > 0 && known.length === list.length && known.every((m) => (m.margin as { complete: boolean }).complete),
    costPaise: list.reduce((n, m) => n + m.cost.paise, 0),
    setupPaise: list.reduce((n, m) => n + (m.setupFeePaise ?? 0), 0),
  };
}

export interface PlanFeeInput {
  plan: PlanName | null;
  prices: PriceList;
  /** The builder runs the deploy bundle on their own server: the plan fee is half (licence.self-host). */
  selfHost: boolean;
  /** This shop gets the Innovator discount (the person is an innovator and this shop is within the shops the discount covers). */
  innovator: boolean;
}

/** Geometer's plan fee for a shop, in whole paise, before GST, from the price list; null when there is no plan or no price for it. Each share is taken once, then rounded up once. */
export function planFeePaise(i: PlanFeeInput): { paise: number | null; notes: CostNote[] } {
  if (!i.plan) return { paise: null, notes: ["no-plan"] };
  const fee = microPaise(i.prices, `plan.${i.plan}.fee`);
  if (!fee) return { paise: null, notes: ["no-price"] };
  const notes: CostNote[] = [];
  let value = fee.value;
  const half = i.prices.rates["licence.self-host"]?.basisPoints;
  if (i.selfHost && half !== undefined) { value = (value * BigInt(half)) / 10_000n; notes.push("self-host"); }
  const discount = i.prices.rates["innovator.discount"]?.basisPoints;
  if (i.innovator && discount !== undefined) { value = (value * BigInt(10_000 - discount)) / 10_000n; notes.push("innovator"); }
  return { paise: paiseOf(value), notes };
}

/** How many of an innovator's shops the discount covers (price list `innovator.max-shops`). Left out of the list: all of them. */
export const innovatorShopCap = (prices: PriceList): number => prices.rates["innovator.max-shops"]?.count ?? Number.MAX_SAFE_INTEGER;

/** The shops of this person that get the Innovator discount: the innovator-flagged ones, in id order, up to the cap. */
export function discountedShops(flagged: readonly string[], prices: PriceList): Set<string> {
  return new Set([...flagged].sort().slice(0, innovatorShopCap(prices)));
}

/** This month's usage from the exported record: only the entries whose own time is in [from, to). Null when the shop has no export. */
export function monthUsage(data: Exported | null, month: string, timeZone: string, prices: PriceList): UsageTotals | null {
  if (!data) return null;
  const { from, to } = monthRange(month, timeZone);
  const inMonth = data.entries.filter((e) => { const t = Date.parse((e as { time?: string }).time ?? ""); return Number.isFinite(t) && t >= from && t < to; });
  return summarizeUsage(inMonth, usageRatesFrom([prices]));
}

const ceilDiv = (a: number, b: number): number => Number((BigInt(a) + BigInt(b) - 1n) / BigInt(b));

export interface RunningCostInput {
  plan: { paise: number | null; notes: CostNote[] };
  /** This month from the record, or null when there is no export. */
  usage: UsageTotals | null;
  /** True on a hosted (Geometer's partner) server: the model is inside the plan fee. False on the builder's own server, where the model key is the builder's own. */
  modelIncluded: boolean;
  entries: Entries | undefined;
  month: string;
}

export function runningCostItems(i: RunningCostInput): CostItem[] {
  const items: CostItem[] = [{ id: "plan", paise: i.plan.paise, notes: i.plan.notes }];
  // WhatsApp at cost: the month's counts at the price list's rates, GST included, before the month's free replies (so it can be a little high, never low).
  if (!i.usage) items.push({ id: "whatsapp", paise: null, notes: ["no-record"] });
  else if (!i.usage.whatsapp.estimated) items.push({ id: "whatsapp", paise: null, notes: ["no-price"] });
  else items.push({ id: "whatsapp", paise: ceilDiv(i.usage.whatsapp.estMicroInr, 10_000), notes: ["estimate"] }); // 1 micro-rupee = 0.0001 paisa
  // The model: inside the plan fee on a hosted server; the builder's own key on their own server, from the cost the runtime recorded.
  if (i.modelIncluded) items.push({ id: "model", paise: 0, notes: ["included"] });
  else if (!i.usage) items.push({ id: "model", paise: null, notes: ["no-record"] });
  else {
    const unpriced = i.usage.unpriced ?? 0;
    items.push({ id: "model", paise: ceilDiv(i.usage.modelMicroInr, 10_000), notes: unpriced > 0 ? ["floor"] : [], ...(unpriced > 0 ? { unpriced } : {}) });
  }
  // Support time: minutes for this month, times what an hour is worth to the person. Either missing: unknown.
  const minutes = i.entries?.supportMonth === i.month ? i.entries.supportMinutes : undefined;
  const rate = i.entries?.supportPaisePerHour;
  if (minutes === undefined) items.push({ id: "support", paise: null, notes: ["no-minutes"] });
  else if (rate === undefined) items.push({ id: "support", paise: null, notes: ["no-rate"], minutes });
  else items.push({ id: "support", paise: ceilDiv(minutes * rate, 60), notes: [], minutes });
  return items;
}

// ---- what needs attention ----------------------------------------------------------------------------------------------------------------------------

export interface Attention {
  /** Open unfinished-work items by kind. */
  unfinished: Record<string, number>;
  unfinishedTotal: number;
  /** False when the shop's record has not been exported: there is nothing to count, which is not the same as nothing open. */
  recordShared: boolean;
  licence?: LicenceState;
  /** Fleet's last answer: the last heartbeat it replied to. */
  heartbeat: { at?: string; stale: boolean };
  /** The last restore drill, as an age in whole days, when the panel can see it. */
  drill: { at?: string; days?: number; ok?: boolean | null };
  warn: string[];
  buttons: boolean;
  /** Something above is not in order. */
  needs: boolean;
}

const DAY = 86_400_000;

export function attentionOf(i: { items: readonly { kind: string }[]; recordShared: boolean; status: ShopStatus | undefined; fleet: FleetAnswer | undefined; licence: LicenceState | undefined; nowMs: number }): Attention {
  const unfinished: Record<string, number> = {};
  for (const o of i.items) unfinished[o.kind] = (unfinished[o.kind] ?? 0) + 1;
  const at = i.fleet?.at;
  const atMs = at ? Date.parse(at) : NaN;
  const stale = Number.isFinite(atMs) && i.nowMs - atMs > STALE_AFTER_MS;
  const drillAt = i.status?.backups?.lastDrillAt ?? undefined;
  const drillMs = drillAt ? Date.parse(drillAt) : NaN;
  const drill: Attention["drill"] = { ...(drillAt && Number.isFinite(drillMs) ? { at: drillAt, days: Math.max(0, Math.floor((i.nowMs - drillMs) / DAY)) } : {}), ...(i.status?.backups?.drillOk !== undefined ? { ok: i.status.backups.drillOk } : {}) };
  const buttons = i.fleet?.ai === "buttons";
  const warn = i.fleet?.warn ?? [];
  const licenceBad = i.licence !== undefined && i.licence !== "active";
  return {
    unfinished, unfinishedTotal: i.items.length, recordShared: i.recordShared, ...(i.licence ? { licence: i.licence } : {}),
    heartbeat: { ...(at ? { at } : {}), stale }, drill, warn, buttons,
    needs: i.items.length > 0 || licenceBad || stale || warn.length > 0 || buttons || (drill.at !== undefined && drill.ok === false),
  };
}
