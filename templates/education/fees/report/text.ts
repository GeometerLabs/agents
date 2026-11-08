// The owner layer: a WhatsApp-ready text of five lines, in the centre's language, that a centre owner can read in ten seconds.
// Money first (collected, still to collect, given back), then reminders and what was taken off, then what the owner was asked, what the limits stopped, and what was
// not checked. Lines are "label: number", so no number needs a case ending in Malayalam or Kannada.
// Every number and amount is read from the report (which counted the record); the words come from strings.ts.
import { formatDate } from "../../../../modules/language/format.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import type { LocalDate } from "../../../../modules/core/time.ts";
import { languagesOf, oneLine, periodLabel, rupees } from "../../../../modules/report/text.ts";
import type { ReportLanguage } from "../../../../modules/report/text.ts";
import { RULE_IDS } from "./data.ts";
import type { FeesReport, GoLiveFinding } from "./data.ts";
import { STRINGS, moneyLabels } from "./strings.ts";

/**
 * What a document says about the go-live checks, as sentences in the centre's language: no certificate was given, one was given and could not be trusted, or one was read
 * and says what its checks ran on (with its date, the counts it states, and the key that signed it). Never a grade: the counts are the certificate's own, and only for a
 * certificate whose checks ran on this centre's settings.
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
export function notCheckedList(report: FeesReport, language: Language): string {
  const s = STRINGS[language].notChecked;
  // a UPI centre (B33): "payments outside Razorpay" and "real Razorpay" do not apply; automatic payment checking does not either, and the line says so
  const named = report.paidBy === "owner-marked" ? [s.cash, STRINGS[language].upiLabel.notChecked, s.whatsapp, s.review] : [s.cash, s.upi, s.whatsapp, s.razorpay, s.review];
  const others = report.notTested.length + report.notCounted.length - named.length;
  return [...named, STRINGS[language].more(Math.max(0, others))].join(" · ");
}

/** The five lines for one language. */
export function ownerText(report: FeesReport, language: Language): string {
  const s = STRINGS[language];
  const { money, fees, waivers, owner, stopped, reminders } = report;
  const pair = (label: string, value: string | number) => `${label}: ${value}`;
  const tag = s.sourceTag[report.source];

  const title = [oneLine(report.shop.name), periodLabel(report.period, language), tag].filter(Boolean).join(" · ");
  const moneyLine = [
    pair(moneyLabels(language, report.paidBy).collected, rupees(money.collected.paise)),
    pair(s.label.stillToCollect, fees.stillToCollect.count > 0 ? `${rupees(fees.stillToCollect.paise)} (${fees.stillToCollect.count} ${s.label.students})` : rupees(0)),
    money.givenBack.count > 0 ? pair(moneyLabels(language, report.paidBy).givenBack, rupees(money.givenBack.paise)) : "",
  ].filter(Boolean).join(" · ");
  const doneLine = [
    pair(s.label.remindersSent, reminders.sent),
    pair(s.label.takenOff, rupees(waivers.total.paise)),
    pair(s.label.wasAsked, owner.asked), pair(s.label.approved, owner.approved), pair(s.label.saidNo, owner.denied),
  ].join(" · ");

  const byCount = RULE_IDS.filter((r) => stopped.byRule[r] > 0).sort((a, b) => stopped.byRule[b] - stopped.byRule[a]); // ties keep the rules' own order
  const shown = byCount.slice(0, 3).map((r) => pair(s.stop[r], stopped.byRule[r]));
  const stoppedLine = stopped.total === 0 ? pair(s.label.stoppedByLimits, 0)
    : `${pair(s.label.stoppedByLimits, stopped.total)} (${shown.join(" · ")}${byCount.length > 3 ? " · …" : ""})`;

  const notChecked = `${pair(s.label.notChecked, notCheckedList(report, language))}${language === "hi" ? "।" : "."} ${s.handRun}`;

  return [title, moneyLine, doneLine, stoppedLine, notChecked].join("\n");
}

/** The owner's messages for a language choice: one, or two for "both". */
export const ownerTexts = (report: FeesReport, language: ReportLanguage): string[] => languagesOf(language).map((l) => ownerText(report, l));
