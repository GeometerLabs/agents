// The limits every template has, as pure checks. Each takes the facts it needs and returns a decision { verdict, ruleId, reason }. They have no side effects and
// read nothing but their arguments, so the agent calls them in-process, and later Guard can run the very same functions outside the AI, in front of every real
// service. The rules that are about one template's business (Bookings: opening hours and double-booking; Fees: no reminder once paid) are in that template.
import { formatInr } from "../language/format.ts";
import { checkText } from "../language/check.ts";
import type { CheckFacts } from "../language/check.ts";
import type { RuleDecision, Verdict } from "../record/record.ts";

export type Decision = RuleDecision; // { ruleId, verdict, reason }

// Small constructors for Decision so every rule returns the same shape and a rule id always travels with its reason.
export const allow = (ruleId: Decision["ruleId"], reason: string): Decision => ({ ruleId, verdict: "allow", reason });
// See allow: a block is final, the action does not happen.
export const block = (ruleId: Decision["ruleId"], reason: string): Decision => ({ ruleId, verdict: "block", reason });
// See allow: a hold sends the action to the owner instead of deciding for them.
export const hold = (ruleId: Decision["ruleId"], reason: string): Decision => ({ ruleId, verdict: "hold_for_owner", reason });

const RANK: Record<Verdict, number> = { allow: 0, hold_for_owner: 1, block: 2 };

/** The strictest of several decisions: a block beats a hold for the owner, which beats an allow. */
export function strictest(decisions: Decision[]): Decision {
  return decisions.reduce((worst, d) => (RANK[d.verdict] > RANK[worst.verdict] ? d : worst));
}

/**
 * refund-limit: refunds above the limit need the owner's approval; so does any refund that is not owed automatically (`notAutomaticReason` says why, in the
 * template's words). A refund is never more than what was paid. "Within the limit" includes the limit itself.
 */
export function checkRefund(input: { amountInr: number; limitInr: number; paidInr?: number; ownerApproved?: boolean; owedAutomatically?: boolean; notAutomaticReason: string }): Decision {
  const { amountInr, limitInr, paidInr, ownerApproved = false, owedAutomatically = true, notAutomaticReason } = input;
  if (amountInr <= 0) return block("refund-limit", "A refund must be more than zero.");
  if (paidInr !== undefined && amountInr > paidInr) return block("refund-limit", `A refund of ${formatInr(amountInr)} is more than the ${formatInr(paidInr)} that was paid.`);
  if (ownerApproved) return allow("refund-limit", `The owner approved this refund of ${formatInr(amountInr)}.`);
  if (!owedAutomatically) return hold("refund-limit", notAutomaticReason);
  if (amountInr > limitInr) return hold("refund-limit", `${formatInr(amountInr)} is above your ${formatInr(limitInr)} refund limit, so the owner has to approve it.`);
  return allow("refund-limit", `${formatInr(amountInr)} is within your ${formatInr(limitInr)} refund limit.`);
}

/** opt-out: STOP ends all messages to the customer. (Messages to the owner are not messages to the customer.) */
export function checkOptOut(input: { toCustomer: boolean; customerOptedOut: boolean }): Decision {
  if (input.toCustomer && input.customerOptedOut) return block("opt-out", "The customer sent STOP, so nothing more is sent to them.");
  return allow("opt-out", input.toCustomer ? "The customer has not opted out." : "This message is for the owner.");
}

/** message-matches-record: every amount, date and time in a message equals the record (language/check.ts does the reading). */
export function checkRecordMatch(input: { text: string; facts: CheckFacts }): Decision {
  const result = checkText(input.text, input.facts);
  if (result.ok) return allow("message-matches-record", "Every amount, date, time and link in the message is in the record.");
  return block("message-matches-record", `The message does not match the record. ${result.problems.join(" ")}`);
}
