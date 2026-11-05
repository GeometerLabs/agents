// The plan for running the crash-test situations on one centre's own settings: which student the scripted parent writes about, which language they write in, the
// moments of the month (the first reminder, the due day, the grace days), and the amounts the situations use (a part payment, a waiver above the limit, a refund
// bigger than the payment). Nothing here decides whether the agent is right; it only picks the facts the situations are built from, so that the same situation
// can run on a tuition centre or a dance school or anything else with monthly fees.
//
// The world starts an hour before the first reminder of November 2026, as the example centre's does.
import { isDeepStrictEqual } from "node:util";
import { addDays, zonedToMs } from "../../../modules/core/time.ts";
import type { LocalDate } from "../../../modules/core/time.ts";
import type { Language } from "../../../modules/language/languages.ts";
import { brightTuition } from "../src/harness.ts";
import { batchOf } from "../src/settings.ts";
import type { Batch, Settings, Student } from "../src/settings.ts";

export interface Shop {
  settings: Settings;
  tz: string;
  student: Student;
  batch: Batch;
  /** The scripted parent's number and language. */
  parent: string;
  language: Language;
  /** The month the situations run in: November 2026. */
  month: { year: number; month: number };
  dueDate: LocalDate;
  dueMs: number;
  /** Every reminder moment of the month, earliest first. */
  moments: number[];
  startMs: number;
  /** The grace days are over from this moment (a late fee is added then), or undefined when the centre has no late fee. */
  lateFeeAtMs: number | undefined;
  feeInr: number;
  lateFeeInr: number;
  waiverLimitInr: number;
  refundLimitInr: number;
  /** A part payment the centre allows (at least its minimum, less than the fee), or undefined when it takes none. */
  partInr: number | undefined;
  /** An amount to ask to take off that is above the waiver limit and not more than the fee, or undefined when the fee is within the limit. */
  waiverAskInr: number | undefined;
  /** An amount to ask to take off that is within the waiver limit (and above nothing), or undefined when the limit is zero. */
  waiverSmallInr: number | undefined;
  /** True for the Bright Tuition Centre example, whose sentences are the reviewed ones in SAYS. */
  reviewed: boolean;
  /** The languages in this order, those the centre speaks. */
  inOrder(order: readonly Language[]): Language[];
}

export function planShop(settings: Settings): { shop: Shop } | { problem: string } {
  const tz = settings.timezone;
  // The scripted parent has one child at the centre, when any parent does: a message about "the fee" is then about one fee.
  const only = settings.students.find((s) => settings.students.filter((o) => o.parent === s.parent).length === 1) ?? settings.students[0];
  const batch = batchOf(settings, only);
  const month = { year: 2026, month: 11 };
  const dueDate: LocalDate = { year: month.year, month: month.month, day: settings.due.day };
  const moments = settings.reminders.daysFromDue.map((d) => zonedToMs(addDays(dueDate, d), { hour: settings.reminders.hour, minute: 0 }, tz)).sort((a, b) => a - b);
  const feeInr = batch.monthlyFeeInr;
  const partInr = settings.partPayments.allowed ? Math.max(settings.partPayments.minInr, Math.floor(feeInr / 3 / 100) * 100) : undefined;
  const waiverAskInr = settings.waiver.limitInr + Math.max(100, Math.ceil(feeInr / 10 / 100) * 100);
  const language = only.language ?? settings.languages[0];
  const shop: Shop = {
    settings, tz, student: only, batch, parent: only.parent, language, month, dueDate,
    dueMs: zonedToMs(dueDate, { hour: 0, minute: 0 }, tz),
    moments, startMs: moments[0] - 60 * 60 * 1000,
    lateFeeAtMs: settings.lateFeeInr > 0 ? zonedToMs(addDays(dueDate, settings.due.graceDays + 1), { hour: 0, minute: 0 }, tz) : undefined,
    feeInr, lateFeeInr: settings.lateFeeInr, waiverLimitInr: settings.waiver.limitInr, refundLimitInr: settings.refund.limitInr,
    partInr: partInr !== undefined && partInr < feeInr ? partInr : undefined,
    waiverAskInr: waiverAskInr < feeInr ? waiverAskInr : undefined,
    waiverSmallInr: settings.waiver.limitInr > 0 ? settings.waiver.limitInr : undefined,
    reviewed: isDeepStrictEqual(settings, brightTuition()),
    inOrder: (order) => order.filter((l) => settings.languages.includes(l)),
  };
  return { shop };
}
