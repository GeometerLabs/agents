// The Bookings limits: nine rules, in plain words, as pure checks. Each takes the facts it needs and returns a decision { verdict, ruleId, reason }. They have
// no side effects and read nothing but their arguments, so in v0 the agent calls them in-process, and later Guard can run the very same functions outside
// the AI, in front of every real service. Three of the nine are every template's and live in modules/limits/limits.ts (opt-out, the refund limit and
// message-matches-record); the wrappers below give them Bookings' words and facts.
import { formatInr } from "../../../modules/language/format.ts";
import { allow, block, checkRefund, checkRecordMatch } from "../../../modules/limits/limits.ts";
import type { Decision } from "../../../modules/limits/limits.ts";
import type { RecordView } from "../../../modules/record/record.ts";
import { checkFactsOf } from "./language/check.ts";
import type { MessageFacts } from "./language/templates.ts";
import { hoursOn } from "./settings.ts";
import type { Service, Settings } from "./settings.ts";
import { MINUTE, localParts, minutesOfDay, sameDate } from "../../../modules/core/time.ts";

// price-at-or-above-list: never quote or agree below the price list
export function checkPriceAtOrAboveList(input: { serviceName: string; listInr: number; proposedInr: number }): Decision {
  const { serviceName, listInr, proposedInr } = input;
  if (proposedInr < listInr) {
    return block("price-at-or-above-list", `${formatInr(proposedInr)} is below the price list: ${serviceName} is ${formatInr(listInr)}. The agent never quotes or agrees to less.`);
  }
  return allow("price-at-or-above-list", `${formatInr(proposedInr)} is at or above the list price of ${formatInr(listInr)} for ${serviceName}.`);
}

// within-hours: never book outside opening hours (and only on the slot grid)
export function checkWithinHours(input: { settings: Settings; service: Service; startMs: number }): Decision {
  const { settings, service, startMs } = input;
  const start = localParts(startMs, settings.timezone);
  const end = localParts(startMs + service.durationMinutes * MINUTE, settings.timezone);
  const hours = hoursOn(settings, start.weekday);
  if (!hours) return block("within-hours", "The business is closed that day.");
  const startMin = minutesOfDay(start);
  const endMin = minutesOfDay(end);
  if (startMin < hours.open) return block("within-hours", "That is before opening time.");
  if (!sameDate(start, end) || endMin > hours.close) return block("within-hours", `${service.durationMinutes} minutes from then would run past closing time.`);
  if (startMin % settings.slotMinutes !== 0) return block("within-hours", `Bookings start every ${settings.slotMinutes} minutes, and that time is between two slots.`);
  return allow("within-hours", "The whole booking falls inside opening hours.");
}

// no-double-booking: one customer per slot. `others` come from the calendar's own record (holds count).
export interface BusyEvent { start: number; end: number; bookingRef: string; tentativeUntil?: number }

export function checkNoDoubleBooking(input: { startMs: number; endMs: number; bufferMinutes: number; ownBookingRef: string; others: BusyEvent[]; nowMs: number }): Decision {
  const { startMs, endMs, bufferMinutes, ownBookingRef, others, nowMs } = input;
  const buffer = bufferMinutes * MINUTE;
  const clash = others.find((e) =>
    e.bookingRef !== ownBookingRef
    && !(e.tentativeUntil !== undefined && e.tentativeUntil <= nowMs) // an expired hold no longer blocks anyone
    && e.start < endMs + buffer && startMs < e.end + buffer);
  if (clash) return block("no-double-booking", `Another booking or hold already uses that time${bufferMinutes > 0 ? ` (including the ${bufferMinutes}-minute gap kept between bookings)` : ""}.`);
  return allow("no-double-booking", "Nothing else in the calendar uses that time.");
}

// confirm-only-when-recorded: say "booked" only when the calendar shows it AND the deposit is recorded, both read back
// from the services' own records (the record only holds "confirmed" after a read-back).
export function checkConfirmOnlyWhenRecorded(input: { record: RecordView; booking: string }): Decision {
  const { record, booking } = input;
  const calendar = record.isConfirmed(booking, "confirm_booking");
  const deposit = record.isConfirmed(booking, "record_deposit");
  if (calendar && deposit) return allow("confirm-only-when-recorded", "The calendar shows the booking and the payment record shows the deposit.");
  const missing = [calendar ? null : "the calendar does not show the booking", deposit ? null : "no deposit is recorded"].filter(Boolean).join(" and ");
  return block("confirm-only-when-recorded", `Not booked yet: ${missing}.`);
}

// one-deposit-per-booking: a second payment on a booking that already has its deposit is not another deposit.
// The block means "do not count it"; the agent refunds it (within the refund limit) and tells the owner.
export function checkOneDepositPerBooking(input: { record: RecordView; booking: string; paymentId: string }): Decision {
  const { record, booking, paymentId } = input;
  const recorded = record.confirmedRefs(booking, "record_deposit", "paymentId");
  if (recorded.length === 0) return allow("one-deposit-per-booking", "No deposit is recorded for this booking yet, so this payment is its deposit.");
  if (recorded.includes(paymentId)) return allow("one-deposit-per-booking", "This payment is the booking's recorded deposit.");
  return block("one-deposit-per-booking", "This booking already has its deposit, so this second payment is not counted. It is refunded and the owner is told.");
}

// refund-limit: refunds above the limit need the owner's approval; so does any refund that is not owed automatically.
// "Within the limit" includes the limit itself.
export function checkRefundLimit(input: { amountInr: number; limitInr: number; paidInr?: number; ownerApproved?: boolean; inCancellationWindow?: boolean }): Decision {
  const { inCancellationWindow = true, ...rest } = input;
  return checkRefund({ ...rest, owedAutomatically: inCancellationWindow, notAutomaticReason: "The booking was cancelled too late for an automatic refund, so the owner decides." });
}

// no-message-after-stop: no reminder after a cancellation, completion or STOP
export function checkNoMessageAfterStop(input: { isReminder: boolean; bookingConfirmed: boolean; customerOptedOut: boolean }): Decision {
  const { isReminder, bookingConfirmed, customerOptedOut } = input;
  if (!isReminder) return allow("no-message-after-stop", "This is not a reminder.");
  if (customerOptedOut) return block("no-message-after-stop", "The customer sent STOP, so no reminder goes out.");
  if (!bookingConfirmed) return block("no-message-after-stop", "The booking is cancelled, finished or never confirmed, so no reminder goes out.");
  return allow("no-message-after-stop", "The booking is live and the customer has not opted out.");
}

// message-matches-record: every amount, date and time in a message equals the record (language/check.ts does the reading)
export function checkMessageMatchesRecord(input: { text: string; facts: MessageFacts }): Decision {
  return checkRecordMatch({ text: input.text, facts: checkFactsOf(input.facts) });
}
