// Dates and money of a plan's periods, as pure functions. A period is one month counted from the day the plan started (start 16 Nov: 16 Nov to 15 Dec, then 16 Dec to
// 15 Jan), always from the START day so a plan that began on the 31st never drifts. A meal day is a date in a period whose weekday the plan is sent on. Why it is its own
// file: the ledger, the words and the tests all need the same dates, and Fees' periods are a different thing (a student's fee month) that this template may not import.
import { addDays, weekdayOf } from "../../../../../modules/core/time.ts";
import type { LocalDate } from "../../../../../modules/core/time.ts";

/** "2026-11-16": the key a date has in a ledger (sorts as dates sort, survives the store saved as JSON). */
export const keyOf = (d: LocalDate): string => `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
export const dateOfKey = (k: string): LocalDate => ({ year: Number(k.slice(0, 4)), month: Number(k.slice(5, 7)), day: Number(k.slice(8, 10)) });

const daysIn = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** A date `k` whole months on, from the START day: the 31st becomes the last day of a shorter month, and the next month is counted from the 31st again. */
export function addMonths(start: LocalDate, k: number): LocalDate {
  const total = start.year * 12 + (start.month - 1) + k;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return { year, month, day: Math.min(start.day, daysIn(year, month)) };
}

/** Period `index` of a plan that started on `start`: its first and last day. Period n+1 starts the day after period n ends. */
export function periodRange(start: LocalDate, index: number): { from: LocalDate; to: LocalDate } {
  return { from: addMonths(start, index), to: addDays(addMonths(start, index + 1), -1) };
}

/** The dates in a range (both ends included) whose weekday is one of `weekdays` (0 is Sunday). */
export function mealDates(range: { from: LocalDate; to: LocalDate }, weekdays: readonly number[]): LocalDate[] {
  const out: LocalDate[] = [];
  for (let d = range.from; keyOf(d) <= keyOf(range.to); d = addDays(d, 1)) if (weekdays.includes(weekdayOf(d))) out.push(d);
  return out;
}

/** The first meal day on or after a date. A plan with at least one weekday always has one within a week. */
export function firstMealOnOrAfter(date: LocalDate, weekdays: readonly number[]): LocalDate {
  let d = date;
  for (let i = 0; i < 7 && !weekdays.includes(weekdayOf(d)); i++) d = addDays(d, 1);
  return d;
}

/**
 * What `days` meal days not taken are worth, in whole rupees, out of a period of `meals` meals priced `priceInr`: rounded DOWN, so the credits of all the days of a period
 * can never add up to more than the price, and never more than `paidInr` (what was actually paid for the period, which a credit carried in may have lowered).
 */
export function creditInr(priceInr: number, meals: number, days: number, paidInr: number = priceInr): number {
  if (meals <= 0 || days <= 0) return 0;
  return Math.max(0, Math.min(paidInr, priceInr, Math.floor((priceInr * Math.min(days, meals)) / meals)));
}
