// This month in counts, for the shop page: the monthly report's own numbers (bookings, deposits, refunds, what it said no to, the owner's approvals),
// worked out from the record the deployer exports. Counts only. A record with no export, or one that cannot be read, is "not shared yet", not zero.
import { join } from "node:path";
import { existsSync } from "node:fs";
import { buildMonthlyReport } from "../../pathways/bookings/report/data.ts";
import { monthRange } from "../../modules/report/months.ts";
import type { MonthlyReport } from "../../pathways/bookings/report/data.ts";
import { readBookings, readEntries } from "../../pathways/bookings/report/cli.ts";
import type { Settings } from "../../pathways/bookings/src/settings.ts";
import { localParts } from "../../modules/core/time.ts";

export interface Exported { entries: ReturnType<typeof readEntries>; bookings: ReturnType<typeof readBookings> }

/** The record and bookings the deployer exports to exports/<shop>/, or null when they are not there or not readable. */
export function readExport(dir: string): Exported | null {
  const record = join(dir, "record.json");
  const bookings = join(dir, "bookings.json");
  if (!existsSync(record) || !existsSync(bookings)) return null;
  try { return { entries: readEntries(record), bookings: readBookings(bookings) }; } catch { return null; }
}

export const monthOf = (ms: number, timeZone: string): string => {
  const p = localParts(ms, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}`;
};

/** The monthly report for a month, as data (not signed, not written), from the export. */
export function monthlyFromExport(settings: Settings, data: Exported, month: string, source: "stand-in" | "test-mode" | "live", nowMs: number): MonthlyReport {
  return buildMonthlyReport({ settings, entries: data.entries, bookings: data.bookings, ...monthRange(month, settings.timezone), source, madeAt: nowMs });
}
