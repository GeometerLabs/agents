// This month in counts, for the shop page: the monthly report's own numbers (bookings, deposits, refunds, what it said no to, the owner's approvals),
// worked out from the record the deployer exports. Counts only. A record with no export, or one that cannot be read, is "not shared yet", not zero.
import { join } from "node:path";
import { existsSync } from "node:fs";
import { buildMonthlyReport } from "../../templates/commerce/bookings/report/data.ts";
import { monthRange } from "../../modules/report/months.ts";
import type { MonthlyReport } from "../../templates/commerce/bookings/report/data.ts";
import { readBookings, readEntries } from "../../templates/commerce/bookings/report/cli.ts";
import type { Settings } from "../../templates/commerce/bookings/src/settings.ts";
import { localParts } from "../../modules/core/time.ts";
import { buildFeesReport } from "../../templates/education/fees/report/data.ts";
import type { FeesReport } from "../../templates/education/fees/report/data.ts";
import { readDues } from "../../templates/education/fees/report/cli.ts";
import type { Due } from "../../templates/education/fees/src/due.ts";
import type { Settings as FeesSettings } from "../../templates/education/fees/src/settings.ts";
import { buildOrdersReport } from "../../templates/commerce/orders/report/data.ts";
import type { OrdersReport } from "../../templates/commerce/orders/report/data.ts";
import { readOrders } from "../../templates/commerce/orders/report/cli.ts";
import type { Order } from "../../templates/commerce/orders/src/order.ts";
import type { Settings as OrdersSettings } from "../../templates/commerce/orders/src/settings.ts";

/** What the deployer exported for a shop: its record, and its bookings (Bookings), its fees (Fees, `dues`) or its orders (Orders). */
export interface Exported { entries: ReturnType<typeof readEntries>; bookings: ReturnType<typeof readBookings>; dues?: Due[]; orders?: Order[] }

/** The record and bookings (or fees, or orders) the deployer exports to exports/<shop>/, or null when they are not there or not readable. */
export function readExport(dir: string): Exported | null {
  const record = join(dir, "record.json");
  const bookings = join(dir, "bookings.json");
  const dues = join(dir, "dues.json");
  const orders = join(dir, "orders.json");
  if (!existsSync(record)) return null;
  try {
    if (existsSync(bookings)) return { entries: readEntries(record), bookings: readBookings(bookings) };
    if (existsSync(dues)) return { entries: readEntries(record), bookings: [], dues: readDues(dues) };
    if (existsSync(orders)) return { entries: readEntries(record), bookings: [], orders: readOrders(orders) };
    return null;
  } catch { return null; }
}

export const monthOf = (ms: number, timeZone: string): string => {
  const p = localParts(ms, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}`;
};

/** The monthly report for a month, as data (not signed, not written), from the export. */
export function monthlyFromExport(settings: Settings, data: Exported, month: string, source: "stand-in" | "test-mode" | "live", nowMs: number): MonthlyReport {
  return buildMonthlyReport({ settings, entries: data.entries, bookings: data.bookings, ...monthRange(month, settings.timezone), source, madeAt: nowMs });
}

/** A Fees centre's monthly report as data, from its export (not signed, not written). */
export function feesMonthlyFromExport(settings: FeesSettings, data: Exported, month: string, source: "stand-in" | "test-mode" | "live", nowMs: number): FeesReport {
  return buildFeesReport({ settings, entries: data.entries, dues: data.dues ?? [], ...monthRange(month, settings.timezone), source, madeAt: nowMs });
}

/** An Orders shop's monthly report as data, from its export (not signed, not written). */
export function ordersMonthlyFromExport(settings: OrdersSettings, data: Exported, month: string, source: "stand-in" | "test-mode" | "live", nowMs: number): OrdersReport {
  return buildOrdersReport({ settings, entries: data.entries, orders: data.orders ?? [], ...monthRange(month, settings.timezone), source, madeAt: nowMs });
}

/** The cases a shop's export holds, by the shop's template: its bookings, its fees or its orders (what the inbox, the papers and the case list read). */
const CASES: Record<string, (d: Exported) => { id: string }[]> = { fees: (d) => d.dues ?? [], orders: (d) => d.orders ?? [] };
export const casesOf = (data: Exported, kind: string): { id: string }[] => (Object.hasOwn(CASES, kind) ? CASES[kind] : (d: Exported) => d.bookings)(data);
