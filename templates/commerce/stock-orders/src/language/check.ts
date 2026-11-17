// What the outgoing check may let a message state: the record's own facts, as the plain lists modules/language/check.ts reads. Anything else in a message that looks like an
// amount or a number fails the check and the message is not sent. The same lists are read for every language, so a wrong figure in a translation is caught too.
import type { CheckFacts } from "../../../../../modules/language/check.ts";
import type { MessageFacts } from "./templates.ts";

export function checkFactsOf(f: MessageFacts): CheckFacts {
  const rows = f.lines ?? [];
  const amounts = [f.unitPriceInr, f.totalInr, f.budgetInr, f.reservedInr, f.leftInr, f.capInr, f.limitInr, ...rows.map((r) => r.totalInr), ...(f.choices ?? []).map((c) => c.priceInr)].filter((n): n is number => n !== undefined);
  const counts = [f.qty, f.receivedQty, f.moreQty, f.saidQty, f.hours, f.maxQty, ...rows.flatMap((r) => [r.qty, r.receivedQty])].filter((n): n is number => n !== undefined);
  return {
    language: f.language, timeZone: f.timeZone, amountsInr: amounts, counts, momentsMs: [], links: [],
    literals: [f.businessName, f.supplierName, f.itemName, f.unitName, f.orderRef, f.code, f.monthLabel, ...(f.options ?? []), ...(f.refs ?? []), ...rows.flatMap((r) => [r.ref, r.itemName, r.unitName, r.supplierName, r.stateWord]), ...(f.choices ?? []).flatMap((c) => [c.supplierName, c.unitName]), f.stateWord, f.example],
  };
}
