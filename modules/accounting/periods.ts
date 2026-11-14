// Periods of the books, in the shop's time zone: a day, a month ("2026-11") or an Indian financial year ("26-27"). One place, because the owner's Money section
// (owner-money.ts) and the accountant's export (export.ts) must cut the record at the same moments, and a shop's day does not begin at midnight UTC.
// Every range is [fromMs, toMs): a line at exactly the next period's first moment belongs to the next period.
import { addDays, localParts, zonedToMs } from "../core/time.ts";
import { fyOf, fyStartMs } from "./numbers.ts";

export interface Range { fromMs: number; toMs: number }

const MIDNIGHT = { hour: 0, minute: 0 };

/** The shop's calendar day that holds this moment. */
export function dayRange(ms: number, timeZone: string): Range {
  const p = localParts(ms, timeZone);
  const day = { year: p.year, month: p.month, day: p.day };
  return { fromMs: zonedToMs(day, MIDNIGHT, timeZone), toMs: zonedToMs(addDays(day, 1), MIDNIGHT, timeZone) };
}

/** A month by number: month 1 to 12 of a year. */
export function monthRange(year: number, month: number, timeZone: string): Range {
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  return { fromMs: zonedToMs({ year, month, day: 1 }, MIDNIGHT, timeZone), toMs: zonedToMs({ ...next, day: 1 }, MIDNIGHT, timeZone) };
}

/** The month a moment falls in, as "2026-11". */
export function monthPeriodOf(ms: number, timeZone: string): string {
  const p = localParts(ms, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}`;
}

/** The month before a "2026-11" period: "2026-10" ("2025-12" for "2026-01"). */
export function previousMonth(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** The range of a period text, or null when it is neither "2026-11" nor a financial year "26-27" (the second number must follow the first). */
export function periodRange(period: string, timeZone: string): Range | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/u.exec(period);
  if (m) return monthRange(Number(m[1]), Number(m[2]), timeZone);
  const y = /^(\d{2})-(\d{2})$/u.exec(period);
  if (y && (Number(y[1]) + 1) % 100 === Number(y[2])) return { fromMs: fyStartMs(period, timeZone), toMs: fyStartMs(`${y[2]}-${String((Number(y[2]) + 1) % 100).padStart(2, "0")}`, timeZone) };
  return null;
}

/** The financial year of a moment, "26-27" (numbers.ts has it; repeated as a name here so a caller of periods needs one import). */
export const fyPeriodOf = fyOf;
