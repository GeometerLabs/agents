// The outgoing check for Orders: the shared check (modules/language/check.ts) given the values an order's record holds. The order's lines are one literal ("2 × Veg
// thali, 1 × Curd") read whole from the record, so a message that states a different quantity or item than the record's lines leaves a bare number the check refuses.
import { checkText } from "../../../../../modules/language/check.ts";
import type { CheckFacts, CheckResult } from "../../../../../modules/language/check.ts";
import type { MessageFacts } from "./templates.ts";

/** The lists the check reads, made from an order conversation's facts. */
export function checkFactsOf(facts: MessageFacts): CheckFacts {
  const moments = [facts.slotToMs, facts.cutoffMs, facts.dateMs, ...(facts.slotChoices ?? []).flatMap((s) => [s.fromMs, s.toMs])].filter((v): v is number => v !== undefined);
  return {
    language: facts.language,
    timeZone: facts.timeZone,
    amountsInr: [facts.priceInr, facts.totalInr, facts.advanceInr, facts.balanceInr, facts.refundInr, facts.markedInr, facts.leftInr, ...facts.menu.map((i) => i.priceInr)].filter((v): v is number => v !== undefined),
    counts: [facts.leftCount, facts.holdMinutes, facts.windowHours, facts.maxItems, facts.approvalHours, facts.approvalsLeft, facts.upcomingCount, facts.openCount].filter((v): v is number => v !== undefined),
    shownMs: facts.slotFromMs ?? facts.dateMs,
    momentsMs: facts.licenceDateMs !== undefined ? [...moments, facts.licenceDateMs] : moments,
    links: facts.link ? [facts.link] : [],
    literals: [facts.businessName, facts.itemsText, facts.itemName, ...facts.menu.map((i) => i.name), facts.area, facts.address, ...(facts.areas ?? []), facts.orderRef, facts.customerPhone, facts.approvalCode, facts.upiId, facts.payee, facts.upiCode, facts.partner],
  };
}

/** Check a final message against the facts of its order. `problems` is in plain words and empty when `ok`. */
export function checkMessage(finalText: string, facts: MessageFacts): CheckResult {
  return checkText(finalText, checkFactsOf(facts));
}
