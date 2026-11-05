// The Fees limits, in plain words, as pure checks. Each takes the facts it needs and returns a decision { verdict, ruleId, reason }. They have no side effects and
// read nothing but their arguments, so the agent calls them in-process, and later Guard can run the very same functions outside the AI, in front of every real
// service. Three are every template's and live in modules/limits/limits.ts (opt-out, the refund limit, message-matches-record); the wrappers below give the last
// two Fees' facts. The rest are about fees:
//
//   fee-link-matches-record     a payment link is for what the record says is still owed, and for nothing else
//   no-reminder-once-paid       no reminder when the payment record shows the fee paid, or when the record could not be read
//   reminder-cap                at most so many reminders for one fee in a month
//   waiver-limit                a waiver above the limit is the owner's call, for that exact amount; and never more than what is owed
//   paid-only-when-recorded     "received" and "nothing more is due" go out only when the payment record shows the money
//   one-refund-per-payment      a payment is refunded once
//   refund-limit, opt-out, message-matches-record      the shared three
import { formatInr } from "../../../modules/language/format.ts";
import { allow, block, checkRecordMatch, checkRefund, hold } from "../../../modules/limits/limits.ts";
import type { Decision } from "../../../modules/limits/limits.ts";
import type { RecordView } from "../../../modules/record/record.ts";
import { checkFactsOf } from "./language/check.ts";
import type { MessageFacts } from "./language/templates.ts";

export { allow, block, hold };
export type { Decision };

/** What the payment record shows paid on a fee, in paise: the payments the agent read back from the payments service's own list and wrote as confirmed. Never what a parent said. */
export function recordedPaidPaise(record: RecordView, dueId: string): number {
  return record.confirmedRefs(dueId, "record_payment", "amountPaise").reduce((n, s) => n + Number(s), 0);
}

// fee-link-matches-record: a link is made for what is still owed, from the record, and never for more than the dearest fee with its late fee.
export function checkFeeLink(input: { amountInr: number; balanceInr: number; highestInr: number }): Decision {
  const { amountInr, balanceInr, highestInr } = input;
  if (!Number.isInteger(amountInr) || amountInr < 1) return block("fee-link-matches-record", "A payment link must be for at least one rupee.");
  if (amountInr !== balanceInr) return block("fee-link-matches-record", `A link for ${formatInr(amountInr)} does not match the record: ${formatInr(balanceInr)} is still owed.`);
  if (amountInr > highestInr) return block("fee-link-matches-record", `${formatInr(amountInr)} is more than the dearest fee with its late fee, ${formatInr(highestInr)}.`);
  return allow("fee-link-matches-record", `${formatInr(amountInr)} is what the record says is still owed.`);
}

// no-reminder-once-paid: judged from the payment record the agent has just read, never from what a parent said and never from a flag kept earlier.
// `readOk` is false when the payments service could not be read just now: then no reminder goes out, because it cannot be known that the fee is unpaid.
export function checkNoReminderOncePaid(input: { record: RecordView; dueId: string; owedPaise: number; readOk: boolean }): Decision {
  const { record, dueId, owedPaise, readOk } = input;
  if (!readOk) return block("no-reminder-once-paid", "The payment record could not be read just now, so it cannot be known that the fee is unpaid. No reminder goes out.");
  const paid = recordedPaidPaise(record, dueId);
  if (paid >= owedPaise) return block("no-reminder-once-paid", `The payment record shows ${formatInr(paid / 100)} paid, which covers what is owed. No reminder goes out.`);
  return allow("no-reminder-once-paid", `The payment record shows ${formatInr(paid / 100)} paid of ${formatInr(owedPaise / 100)}, so the fee is not paid.`);
}

// reminder-cap: a parent is not written to without end.
export function checkReminderCap(input: { sent: number; maxPerMonth: number }): Decision {
  if (input.sent >= input.maxPerMonth) return block("reminder-cap", `${input.sent} reminders have gone out for this fee this month, which is the most (${input.maxPerMonth}).`);
  return allow("reminder-cap", `${input.sent} of ${input.maxPerMonth} reminders have gone out for this fee.`);
}

// waiver-limit: the agent takes off, on its own, no more than the limit for one student-month in all. Above it, the owner decides, for the exact amount.
// A waiver is never more than what is still owed.
export function checkWaiver(input: { amountInr: number; balanceInr: number; alreadyWaivedInr: number; limitInr: number; ownerApproved?: boolean }): Decision {
  const { amountInr, balanceInr, alreadyWaivedInr, limitInr, ownerApproved = false } = input;
  if (!Number.isInteger(amountInr) || amountInr < 1) return block("waiver-limit", "A waiver must be at least one rupee.");
  if (amountInr > balanceInr) return block("waiver-limit", `A waiver of ${formatInr(amountInr)} is more than the ${formatInr(balanceInr)} still owed.`);
  if (ownerApproved) return allow("waiver-limit", `The owner approved this waiver of ${formatInr(amountInr)}.`);
  if (alreadyWaivedInr + amountInr <= limitInr) return allow("waiver-limit", `${formatInr(alreadyWaivedInr + amountInr)} waived in all is within your ${formatInr(limitInr)} limit.`);
  return hold("waiver-limit", `${formatInr(alreadyWaivedInr + amountInr)} waived in all is above your ${formatInr(limitInr)} limit, so the owner has to approve it.`);
}

// paid-only-when-recorded: say "received" or "nothing more is due" only when the payment record shows the money for this fee.
export function checkPaidOnlyWhenRecorded(input: { record: RecordView; dueId: string; owedPaise: number; needsAll: boolean }): Decision {
  const paid = recordedPaidPaise(input.record, input.dueId);
  if (paid <= 0) return block("paid-only-when-recorded", "Not paid yet: the payment record shows no payment for this fee.");
  if (input.needsAll && paid < input.owedPaise) return block("paid-only-when-recorded", `Not paid in full yet: the payment record shows ${formatInr(paid / 100)} of ${formatInr(input.owedPaise / 100)}.`);
  return allow("paid-only-when-recorded", `The payment record shows ${formatInr(paid / 100)} paid for this fee.`);
}

// one-refund-per-payment: a payment is refunded once, whatever the amount. (Guard says the same, on its own, with the `refund-once` rule.)
export function checkOneRefundPerPayment(input: { paymentId: string; refundedPaise: number }): Decision {
  if (input.refundedPaise > 0) return block("one-refund-per-payment", `Payment ${input.paymentId} has already been refunded once, and a payment is refunded once.`);
  return allow("one-refund-per-payment", `Payment ${input.paymentId} has no refund yet.`);
}

/** refund-limit, in Fees' words. A refund is never more than the payment; above the limit the owner has to approve it (Guard holds it). */
export function checkRefundLimit(input: { amountInr: number; limitInr: number; paidInr?: number; ownerApproved?: boolean }): Decision {
  return checkRefund({ ...input, owedAutomatically: true, notAutomaticReason: "The owner decides this refund." });
}

export function checkMessageMatchesRecord(input: { text: string; facts: MessageFacts }): Decision {
  return checkRecordMatch({ text: input.text, facts: checkFactsOf(input.facts) });
}
