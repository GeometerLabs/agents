// The outgoing check for Bookings: the shared check (modules/language/check.ts) given the values a booking's record holds.
import { checkText } from "../../../../../modules/language/check.ts";
import type { CheckFacts, CheckResult } from "../../../../../modules/language/check.ts";
import type { MessageFacts } from "./templates.ts";

/** The lists the check reads, made from a booking conversation's facts. */
export function checkFactsOf(facts: MessageFacts): CheckFacts {
  return {
    language: facts.language,
    timeZone: facts.timeZone,
    amountsInr: [facts.priceInr, facts.depositInr, facts.refundInr, facts.markedInr, facts.leftInr, ...facts.services.map((s) => s.priceInr)].filter((v): v is number => v !== undefined),
    counts: [facts.holdMinutes, facts.windowHours, facts.approvalHours, facts.upcomingCount, facts.approvalsLeft].filter((v): v is number => v !== undefined),
    shownMs: facts.slotMs,
    momentsMs: [...(facts.slotChoices ?? []), ...(facts.dayBookings ?? []).map((d) => d.slotMs)],
    links: facts.link ? [facts.link] : [],
    literals: [facts.businessName, facts.serviceName, facts.bookingRef, facts.customerPhone, facts.approvalCode, facts.upiId, facts.payee, facts.upiCode, facts.partner, ...facts.services.map((s) => s.name), ...(facts.dayBookings ?? []).flatMap((d) => [d.serviceName, d.customerPhone, d.ref])],
  };
}

/** Check a final message against the facts of its conversation. `problems` is in plain words and empty when `ok`. */
export function checkMessage(finalText: string, facts: MessageFacts): CheckResult {
  return checkText(finalText, checkFactsOf(facts));
}
