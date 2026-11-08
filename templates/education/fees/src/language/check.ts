// The outgoing check for Fees: the shared check (modules/language/check.ts) given the values a fee's record holds.
import { checkText } from "../../../../../modules/language/check.ts";
import type { CheckFacts, CheckResult } from "../../../../../modules/language/check.ts";
import type { MessageFacts } from "./templates.ts";

/** The lists the check reads, made from a fee conversation's facts. */
export function checkFactsOf(facts: MessageFacts): CheckFacts {
  return {
    language: facts.language,
    timeZone: facts.timeZone,
    amountsInr: [facts.feeInr, facts.lateFeeInr, facts.balanceInr, facts.paidInr, facts.receivedInr, facts.waiverInr, facts.refundInr, facts.waiverLimitInr].filter((v): v is number => v !== undefined),
    counts: [facts.graceDays, facts.approvalHours, facts.approvalsLeft].filter((v): v is number => v !== undefined),
    shownMs: facts.dueMs,
    momentsMs: [],
    links: facts.link ? [facts.link] : [],
    literals: [facts.businessName, facts.studentName, facts.batchName, facts.monthLabel, facts.dueRef, facts.requestRef, facts.customerPhone, facts.approvalCode],
  };
}

/** Check a final message against the facts of its fee. `problems` is in plain words and empty when `ok`. */
export function checkMessage(finalText: string, facts: MessageFacts): CheckResult {
  return checkText(finalText, checkFactsOf(facts));
}
