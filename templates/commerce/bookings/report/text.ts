// The owner layer: a WhatsApp-ready text of five lines, in the shop's language, that a shop owner can read in ten seconds.
// Money and bookings first, then what they were asked, what the limits stopped, and what was not checked. (Moves and the
// per-limit table are in the builder layer; this is what an owner wants in ten seconds.)
// Lines are "label: number", like the product's mock-up, so no number needs a case ending in Malayalam or Kannada.
// Every number and amount is read from the report (which counted the record); the words come from strings.ts.
import { NOT_TESTED } from "../crash-test/not-tested.ts";
import { formatDate } from "../../../../modules/language/format.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import { languagesOf, oneLine, periodLabel, rupees } from "../../../../modules/report/text.ts";
import type { ReportLanguage } from "../../../../modules/report/text.ts";
import type { LocalDate } from "../../../../modules/core/time.ts";
import { RULE_IDS } from "./data.ts";
import type { GoLiveFinding, MonthlyReport } from "./data.ts";
import { STRINGS } from "./strings.ts";

/**
 * What a monthly document says about the go-live checks, as sentences in the shop's language: no certificate was given, one was given and could
 * not be trusted, or one was read and says what its checks ran on (with its date, the counts it states, and the key that signed it). Never a
 * grade: the counts are the certificate's own, and only for a certificate whose checks ran on this shop's settings.
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

/** What was not checked, as the owner's short form names it: the items an owner would expect, then how many more the full report lists. */
export function notCheckedList(report: MonthlyReport, language: Language): string {
  const s = STRINGS[language];
  const named = NOT_TESTED.filter((n) => n.forOwner).map((n) => s.notTested[n.id]);
  const others = report.notTested.length + report.notCounted.length - named.length;
  return [...named, s.more(others)].join(" · ");
}

/** The five lines for one language. */
export function ownerText(report: MonthlyReport, language: Language): string {
  const s = STRINGS[language];
  const { bookings, money, owner, stopped, unconfirmed } = report;
  const pair = (label: string, value: string | number) => `${label}: ${value}`;
  const tag = s.sourceTag[report.source];

  const title = [oneLine(report.shop.name), periodLabel(report.period, language), tag].filter(Boolean).join(" · ");
  const moneyAndBookings = [
    pair(s.label.bookingsMade, bookings.made),
    bookings.cancelled > 0 ? pair(s.label.cancelled, bookings.cancelled) : "",
    pair(s.label.depositsCollected, rupees(money.deposits.paise)),
    money.refunds.count > 0 ? pair(s.label.givenBack, rupees(money.refunds.paise)) : "",
  ].filter(Boolean).join(" · ");
  const asked = [
    pair(s.label.wasAsked, owner.asked), pair(s.label.approved, owner.approved), pair(s.label.saidNo, owner.denied),
    unconfirmed.openOnBookings > 0 ? pair(s.label.notConfirmed, unconfirmed.openOnBookings) : "",
  ].filter(Boolean).join(" · ");

  const byCount = RULE_IDS.filter((r) => stopped.byRule[r] > 0).sort((a, b) => stopped.byRule[b] - stopped.byRule[a]); // ties keep the rules' own order
  const shown = byCount.slice(0, 3).map((r) => pair(s.stop[r], stopped.byRule[r]));
  const stoppedLine = stopped.total === 0 ? pair(s.label.stoppedByLimits, 0)
    : `${pair(s.label.stoppedByLimits, stopped.total)} (${shown.join(" · ")}${byCount.length > 3 ? " · …" : ""})`;

  const notChecked = `${pair(s.label.notChecked, notCheckedList(report, language))}${language === "hi" ? "।" : "."} ${s.handRun}`;

  return [title, moneyAndBookings, asked, stoppedLine, notChecked].join("\n");
}

/** The owner's messages for a language choice: one, or two for "both". */
export const ownerTexts = (report: MonthlyReport, language: ReportLanguage): string[] => languagesOf(language).map((l) => ownerText(report, l));
