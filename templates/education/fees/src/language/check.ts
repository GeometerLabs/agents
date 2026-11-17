// The outgoing check for Fees: the shared check (modules/language/check.ts) given the values a fee's record holds.
import { checkText } from "../../../../../modules/language/check.ts";
import type { CheckFacts, CheckResult } from "../../../../../modules/language/check.ts";
import type { MessageFacts } from "./templates.ts";

/** The lists the check reads, made from a fee conversation's facts. */
export function checkFactsOf(facts: MessageFacts): CheckFacts {
  return {
    language: facts.language,
    timeZone: facts.timeZone,
    amountsInr: [facts.feeInr, facts.lateFeeInr, facts.balanceInr, facts.paidInr, facts.receivedInr, facts.waiverInr, facts.refundInr, facts.waiverLimitInr, ...(facts.family ?? []).map((l) => l.balanceInr)].filter((v): v is number => v !== undefined),
    counts: [facts.graceDays, facts.approvalHours, facts.openFeesCount, facts.approvalsLeft, facts.leadMinutes, facts.presentCount, facts.absentCount, facts.notedCount, facts.waitingCount, facts.sentCount, facts.heldCount].filter((v): v is number => v !== undefined),
    shownMs: facts.dueMs ?? facts.classMs,
    // a reminder that lists several fees states each one's own due date (the first is `shownMs` too); nothing else
    // (Classes) the class of a class message, and the next class of each student in the timetable answer
    momentsMs: [...(facts.family ?? []).map((l) => l.dueMs), ...(facts.classMs !== undefined ? [facts.classMs] : []), ...(facts.classLines ?? []).map((l) => l.startMs)],
    // the payment link, and (item 11h) the parent's own private page in a message to that parent; (Classes) the class link and the reading-material page
    links: [facts.link, facts.pageLink, facts.classLink, facts.materialLink, ...(facts.family ?? []).map((l) => l.link)].filter((v): v is string => v !== undefined),
    literals: [...(facts.family ?? []).flatMap((l) => [l.studentName, l.batchName, l.monthLabel, l.dueRef]), facts.businessName, facts.studentName, facts.batchName, facts.monthLabel, facts.dueRef, facts.requestRef, facts.customerPhone, facts.approvalCode, facts.upiId, facts.payee, facts.upiCode, facts.partner, facts.roster, facts.doubtText, ...(facts.classLines ?? []).flatMap((l) => [l.studentName, l.batchName])],
  };
}

/** Check a final message against the facts of its fee. `problems` is in plain words and empty when `ok`. */
export function checkMessage(finalText: string, facts: MessageFacts): CheckResult {
  return checkText(finalText, checkFactsOf(facts));
}
