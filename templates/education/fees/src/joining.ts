// A student who joins in the middle of a month, and a student who comes with dues from before the agent started: the pure rules, no clock, no store, no disk.
//
// Why a file of its own: the rule for the first, part month is one sum that the Fees agent and, next, the Classes template (grown from Fees, sharing its money path)
// both need, so it is written once here and imported, not copied. Nothing in this file talks to a parent or a payments service; the agent decides when to open a fee
// (src/agent.ts openMonthlyFees) and this file only says whether one is owed and for how much.
//
// The centre chooses ("joiningMidMonth" in the settings), for a student whose `joined` date falls after the 1st:
//   usual      today's behaviour: `joined` is ignored. The month's fee is the full fee, opened on the first reminder day, and not at all if that day was before the agent
//              first ran. This is the default, so a centre that sets nothing sees no change.
//   full       the full month's fee, whatever the day of joining.
//   prorata    the days from the joining day to the end of the month, as a share of the month's days, in whole rupees (rounded to the nearest, never below ₹1).
//   nextMonth  nothing for the joining month; the fee starts with the next month.
import type { LocalDate } from "../../../../modules/core/time.ts";

export type JoiningRule = "usual" | "full" | "prorata" | "nextMonth";
export const JOINING_RULES: readonly JoiningRule[] = ["usual", "full", "prorata", "nextMonth"];

/** The days in a calendar month (month 1 to 12). */
export const daysInMonth = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** "2026-11-18" as a date, or undefined when it is not a real date. */
export function parseJoined(text: string): LocalDate | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(text);
  if (!m) return undefined;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month) ? { year, month, day } : undefined;
}

export interface PartMonth { rule: "full" | "prorata"; joined: string; days: number; daysInMonth: number }

/** What a student owes for the month `year`-`month` under the rule: nothing (`none`), or this fee, with the part-month facts when the joining day mattered. */
export type MonthFee = { owed: false; why: "not_joined_yet" | "next_month" } | { owed: true; feeInr: number; part?: PartMonth };

/**
 * `monthlyFeeInr` is the batch's whole fee. `joined` is the student's joining date, or undefined (no date: nothing special, ever). Months before the joining month are
 * not owed under any rule but "usual"; months after it are the whole fee.
 */
export function feeForMonth(rule: JoiningRule, monthlyFeeInr: number, joined: LocalDate | undefined, year: number, month: number): MonthFee {
  if (rule === "usual" || !joined) return { owed: true, feeInr: monthlyFeeInr };
  const order = (year - joined.year) * 12 + (month - joined.month);
  if (order < 0) return { owed: false, why: "not_joined_yet" };
  if (order > 0 || joined.day === 1) return { owed: true, feeInr: monthlyFeeInr }; // a later month, or joined on the first: not a part month
  const length = daysInMonth(year, month);
  const days = length - joined.day + 1;
  const iso = `${joined.year}-${String(joined.month).padStart(2, "0")}-${String(joined.day).padStart(2, "0")}`;
  if (rule === "nextMonth") return { owed: false, why: "next_month" };
  if (rule === "full") return { owed: true, feeInr: monthlyFeeInr, part: { rule, joined: iso, days, daysInMonth: length } };
  return { owed: true, feeInr: Math.max(1, Math.round((monthlyFeeInr * days) / length)), part: { rule, joined: iso, days, daysInMonth: length } };
}

/** Is `year`-`month` the month the student joined part-way through (so the due date may need to wait for the joining day)? */
export const isJoiningMonth = (joined: LocalDate | undefined, year: number, month: number): boolean => !!joined && joined.year === year && joined.month === month && joined.day > 1;

/** The most back dues one student may carry in the settings, and the shape of one: an earlier month still unpaid when the agent started. */
export const BACK_DUES_MAX = 12;
export interface BackDue { month: string; amountInr: number }
