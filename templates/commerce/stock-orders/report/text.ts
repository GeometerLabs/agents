// The owner layer: a WhatsApp-ready text of six short lines, in the owner's language, that a shop owner can read in ten seconds.
// What was ordered and what came of it (placed, the supplier said OK, received in full, in part, the wrong item), then what went wrong with the supplier (said no, no answer,
// cancelled or never sent), the month's budget, what the limits stopped, and what was not checked. Lines are "label: number", so no number needs a case ending in Malayalam
// or Kannada. The owner's own "marked as paid" note is on the budget line only when there is one: this agent pays no one, so the word for a payment is never there on its own.
// Every number and amount is read from the report (which counted the record and the orders); the words come from strings.ts.
import { formatDate } from "../../../../modules/language/format.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import type { LocalDate } from "../../../../modules/core/time.ts";
import { languagesOf, oneLine, periodLabel, rupees } from "../../../../modules/report/text.ts";
import type { ReportLanguage } from "../../../../modules/report/text.ts";
import { RULE_IDS } from "./data.ts";
import type { GoLiveFinding, StockReport } from "./data.ts";
import { STRINGS } from "./strings.ts";

/**
 * What a document says about the go-live checks, as sentences in the shop's language: no certificate was given, one was given and could not be trusted, or one was read
 * and says what its checks ran on (with its date, the counts it states, and the key that signed it). Never a grade: the counts are the certificate's own, and only for a
 * certificate whose checks ran on this shop's settings.
 */
export function goLiveLines(goLive: GoLiveFinding, language: Language): string[] {
  const s = STRINGS[language];
  const when = (d: LocalDate) => `${formatDate(d, language)} ${d.year}`;
  switch (goLive.status) {
    case "none": return [s.goLive.none];
    case "untrusted": return [s.goLive.untrusted];
    case "own": return [s.goLive.own(when(goLive.issuedOn)), s.cert.held(goLive.held, goLive.total, goLive.failed, goLive.notTested), s.goLive.signedWith(goLive.signedBy)];
    case "example": return [s.goLive.example(when(goLive.issuedOn)), s.goLive.signedWith(goLive.signedBy)];
    case "different": return [s.goLive.different(when(goLive.issuedOn)), s.goLive.signedWith(goLive.signedBy)];
  }
}

/** What was not checked, as the owner's short form names it: the things an owner would expect, then how many more the full report lists. */
export function notCheckedList(report: StockReport, language: Language): string {
  const s = STRINGS[language];
  const named = [s.notChecked.whatsapp, s.notChecked.supplier, s.notChecked.paying, s.notChecked.review];
  const others = report.notTested.length + report.notCounted.length - named.length;
  return [...named, s.more(Math.max(0, others))].join(" · ");
}

/** The budget value: what the approved orders hold out of the month's budget, then the owner's own note when there is one. Used by the text and the WhatsApp message. */
export function budgetValue(report: StockReport, language: Language): string {
  const s = STRINGS[language];
  const held = s.budgetOf(rupees(report.budget.usedPaise), rupees(report.budget.monthlyPaise));
  return report.markedPaidByOwner.orders > 0 ? `${held} · ${s.label.markedPaid}: ${report.markedPaidByOwner.orders}` : held;
}

/** The lines for one language. */
export function ownerText(report: StockReport, language: Language): string {
  const s = STRINGS[language];
  const { orders, stopped } = report;
  const pair = (label: string, value: string | number) => `${label}: ${value}`;
  const tag = s.sourceTag[report.source];

  const title = [oneLine(report.shop.name), periodLabel(report.period, language), tag].filter(Boolean).join(" · ");
  const ordersLine = [pair(s.label.placed, orders.placed), pair(s.label.acknowledged, orders.acknowledged), pair(s.label.receivedFull, orders.receivedFull), pair(s.label.partReceived, orders.partReceived), pair(s.label.wrongItem, orders.wrongItem)].join(" · ");
  const supplierLine = [pair(s.label.supplierSaidNo, orders.declinedBySupplier), pair(s.label.noAnswer, orders.silent), pair(s.label.neverSent, orders.neverSent)].join(" · ");
  const budgetLine = pair(s.label.budgetUsed, budgetValue(report, language));

  const byCount = RULE_IDS.filter((r) => stopped.byRule[r] > 0).sort((a, b) => stopped.byRule[b] - stopped.byRule[a]); // ties keep the rules' own order
  const shown = byCount.slice(0, 3).map((r) => pair(s.stop[r], stopped.byRule[r]));
  const stoppedLine = stopped.total === 0 ? pair(s.label.stopped, 0) : `${pair(s.label.stopped, stopped.total)} (${shown.join(" · ")}${byCount.length > 3 ? " · …" : ""})`;

  const notChecked = `${pair(s.label.notChecked, notCheckedList(report, language))}${language === "hi" ? "।" : "."} ${s.handRun}`;

  return [title, ordersLine, supplierLine, budgetLine, stoppedLine, notChecked].join("\n");
}

/** The owner's messages for a language choice: one, or two for "both". */
export const ownerTexts = (report: StockReport, language: ReportLanguage): string[] => languagesOf(language).map((l) => ownerText(report, l));
