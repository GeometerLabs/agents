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
    counts: [facts.graceDays, facts.approvalHours, facts.openFeesCount, facts.approvalsLeft].filter((v): v is number => v !== undefined),
    shownMs: facts.dueMs,
    momentsMs: [],
    // the payment link, and (item 11h) the parent's own private page in a message to that parent
    links: [facts.link, facts.pageLink].filter((v): v is string => v !== undefined),
    literals: [facts.businessName, facts.studentName, facts.batchName, facts.monthLabel, facts.dueRef, facts.requestRef, facts.customerPhone, facts.approvalCode, facts.upiId, facts.payee, facts.upiCode, facts.partner],
  };
}

/** Check a final message against the facts of its fee. `problems` is in plain words and empty when `ok`. */
export function checkMessage(finalText: string, facts: MessageFacts): CheckResult {
  return checkText(finalText, checkFactsOf(facts));
}
