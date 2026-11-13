// The monthly Fees report as a WhatsApp message: the owner's lines, in the centre's language, from the numbers the report counted, with the name of the builder or
// partner who set the agent up and, when they have it, the Innovator badge. The same plan as Bookings' (B54), over the same shared job (modules/report/monthly-job.ts).
//
// One wording, two ways to send it. The words below are written once per language. Inside the owner's 24-hour window they go out as plain text. Outside it (the usual
// case on the 1st of the month) WhatsApp carries only an approved template, so the SAME words are listed for Meta as two utility templates, `fee_monthly_report` and
// `fee_monthly_report_innovator`, with the numbers as numbered values. A template cannot have an optional line, which is why the badge is a template of its own.
// Filling a template gives back, letter for letter, the plain text (a test holds that).
//
// What the lines are, and where each number comes from (all counted from the record by report/data.ts):
//   collected, given back, still to collect     report.money.collected, report.money.givenBack, report.fees.stillToCollect
//   reminders sent, taken off fees              report.reminders.sent, report.waivers.total
//   you were asked, approved, said no           report.owner
//   stopped by your limits                      report.stopped.total
//   what was not checked                        the owner's short form (text.ts), and "checks were run by hand"
// The check code and the address of the full page close the message, then the check link (item 17b: the report's signed summary, so the owner taps it and sees
// on geometer.dev whether the report is genuine, with no file; modules/report/summary.ts), then who set it up. The check link is the signed summary when the
// whole message still fits WhatsApp's 1024 characters, else the older #digest link (messageCheckLink): one choice per message, so the text and the template agree. Rules for the words: informational only, no promotion (Meta moves a
// promotional template to the marketing price), numbers and labels only, nothing graded.
import { META_LANGUAGE, fillBody, metaBody } from "../../../../modules/language/meta-templates.ts";
import type { MetaSubmission } from "../../../../modules/language/meta-templates.ts";
import { LANGUAGES } from "../../../../modules/language/languages.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import type { TemplateMessage } from "../../../../modules/messaging/messaging.ts";
import type { Envelope } from "../../../../modules/report/sign.ts";
import { badgeText, oneLine, periodLabel, rupees, settledByWordWords } from "../../../../modules/report/text.ts";
import type { FeesReport } from "./data.ts";
import { sampleReport } from "./review.ts";
import { STRINGS } from "./strings.ts";
import { notCheckedList } from "./text.ts";
import { WHATSAPP_BODY_LIMIT, messageCheckLink } from "../../../../modules/report/summary-sign.ts";
import { verifyCodeLink } from "../../../../modules/report/verify-link.ts";
import { SAMPLE_DIGEST, SAMPLE_SUMMARY_LINK } from "../../../../modules/report/summary.ts";

export interface ReportTemplate {
  /** The name registered with Meta (lowercase, underscores). */
  name: string;
  audience: "owner";
  /** True for the template that carries the Innovator badge line. */
  badge: boolean;
  /** True for a UPI centre's (B33): its money is labelled as marked paid by the owner. */
  upi?: boolean;
  /** The wording per language, with {slot} where a value goes (see REPORT_SLOTS). Turned into {{n}} for Meta. */
  bodies: Record<Language, string>;
}

/** The values in a report message, in the order they come in the wording. */
export const REPORT_SLOTS = ["title", "collected", "givenBack", "pending", "reminders", "takenOff", "asked", "approved", "saidNo", "stopped", "notChecked", "code", "link", "check", "builder"] as const;
export type ReportSlot = (typeof REPORT_SLOTS)[number];

/**
 * 14 Nov: the figures are bold (*text*, which WhatsApp shows as bold), so a figure never looks like its label: every number or amount, and the title line. In "Not checked" only the
 * label is bold; where a line has a count and reasons ("Stopped by your limits"), the numbers are bold, not the reasons. The asterisk is a fixed word on each side of a value, so the
 * rules (never start or end with a value, never two values side by side) still hold. The plain summary text (text.ts) is not changed: the website bolds that itself.
 */
/** The words for one language. Starts and ends with fixed words, never two values side by side, one line per thing the owner reads. */
function wording(language: Language, badge: boolean, upi = false): string {
  const s = STRINGS[language];
  const dot = language === "hi" ? "।" : ".";
  return [
    `*${s.monthlyReport}: {title}*`,
    `${upi ? s.upiLabel.collected : s.label.collected}: *{collected}* · ${upi ? s.upiLabel.givenBack : s.label.givenBack}: *{givenBack}* · ${s.label.stillToCollect}: *{pending}*`,
    `${s.label.remindersSent}: *{reminders}* · ${s.label.takenOff}: *{takenOff}*`,
    `${s.label.wasAsked}: *{asked}* · ${s.label.approved}: *{approved}* · ${s.label.saidNo}: *{saidNo}*`,
    `${s.label.stoppedByLimits}: *{stopped}*`,
    `*${s.label.notChecked}*: {notChecked}${dot} ${s.handRun}`,
    `${s.page.code}: {code} · ${s.fullReport}: {link}`,
    `${s.checkGenuine}: {check}`,
    `${s.page.setUpBy}: {builder} · Geometer`,
    ...(badge ? [badgeText(language)] : []),
  ].join("\n");
}

const bodiesOf = (badge: boolean, upi = false): Record<Language, string> => Object.fromEntries(LANGUAGES.map((l) => [l, wording(l, badge, upi)])) as Record<Language, string>;

export const REPORT_TEMPLATES: readonly ReportTemplate[] = [
  { name: "fee_monthly_report", audience: "owner", badge: false, bodies: bodiesOf(false) },
  { name: "fee_monthly_report_innovator", audience: "owner", badge: true, bodies: bodiesOf(true) },
  // a UPI centre (B33): the same lines, with its money labelled as marked paid by the owner
  { name: "fee_monthly_report_upi", audience: "owner", badge: false, upi: true, bodies: bodiesOf(false, true) },
  { name: "fee_monthly_report_upi_innovator", audience: "owner", badge: true, upi: true, bodies: bodiesOf(true, true) },
];

/** Every report template name, for a provider (or the stand-in) to approve. */
export const REPORT_TEMPLATE_NAMES: readonly string[] = REPORT_TEMPLATES.map((t) => t.name);

const SLOT_RE = /\{([A-Za-z]+)\}/gu;

/** The values a body names, in order. A name this file does not know is a mistake in the wording, and says so. */
export function reportSlotsOf(body: string): ReportSlot[] {
  return [...body.matchAll(SLOT_RE)].map((m) => {
    if (!(REPORT_SLOTS as readonly string[]).includes(m[1])) throw new Error(`The report template body has an unknown value {${m[1]}}.`);
    return m[1] as ReportSlot;
  });
}

export interface ReportExtras {
  /** The report's check code (7K2M-9QXD). */
  code: string;
  /** The address of the full report page. */
  link: string;
  /** The check link: the report's signed summary link, or its #digest link (messageCheckLink). */
  check: string;
  /** Who set the agent up, as they are named on the report. */
  builder: string;
  /**
   * B75: the words for refunds people settled by their word ("Settled by asha, by their word: 1 (₹200)"; modules/report/text.ts settledByWordWords), added after
   * the given-back value. Left out when nobody did. They go inside an existing value, not on a line of their own, so the approved template bodies do not change.
   */
  settled?: string;
}

/** The value of every slot, as the owner reads it. */
export function reportValues(report: FeesReport, language: Language, extras: ReportExtras): Record<ReportSlot, string> {
  const s = STRINGS[language];
  const tag = s.sourceTag[report.source];
  return {
    title: [oneLine(report.shop.name), periodLabel(report.period, language), tag].filter(Boolean).join(" · "),
    collected: rupees(report.money.collected.paise),
    // what the payment service confirmed given back, then what a person settled by their word (B75), which is never counted in it
    givenBack: [rupees(report.money.givenBack.paise), extras.settled].filter(Boolean).join(" \u00b7 "),
    pending: report.fees.stillToCollect.count > 0 ? `${rupees(report.fees.stillToCollect.paise)} (${report.fees.stillToCollect.count} ${s.label.students})` : rupees(0),
    reminders: String(report.reminders.sent),
    takenOff: rupees(report.waivers.total.paise),
    asked: String(report.owner.asked),
    approved: String(report.owner.approved),
    saidNo: String(report.owner.denied),
    stopped: String(report.stopped.total),
    notChecked: notCheckedList(report, language),
    code: extras.code,
    link: extras.link,
    check: extras.check,
    builder: oneLine(extras.builder),
  };
}

/** The parameters of a template body in the order its {{1}}, {{2}} ... take them. A value is one line: Meta refuses a line break, a tab or a run of spaces in one. */
export function reportParameters(template: ReportTemplate, language: Language, values: Record<ReportSlot, string>): string[] {
  return reportSlotsOf(template.bodies[language]).map((slot) => oneLine(values[slot]));
}

export interface ReportMessage {
  /** The whole message: what goes out as plain text inside the window, and what the template reads as when filled. */
  text: string;
  /** The same words as the approved template, with the values that fill it. */
  template: TemplateMessage;
}

/**
 * The message for one sealed report, in one language. The builder's name is the report's own `preparedBy` (the report cannot be sent without it), and the badge
 * comes from the report's own `innovator` flag, so what the owner reads is what the signed report says. `check` is the report's signed summary link (report/run.ts),
 * left out for a report that is not signed: the message then carries the #digest link.
 */
export function monthlyReportMessage(report: Envelope<FeesReport>, language: Language, o: { link: string; check?: string }): ReportMessage {
  const r = report.document;
  if (!r.preparedBy || oneLine(r.preparedBy) === "") throw new Error("The report names no one who set the agent up, and the message says who did.");
  const template = REPORT_TEMPLATES.find((t) => t.badge === (r.innovator === true) && (t.upi === true) === (r.paidBy === "owner-marked"))!;
  const parameters = reportParameters(template, language, valuesWithCheck(template, language, r, { code: report.code, link: o.link, builder: r.preparedBy }, report, o.check));
  const text = fillBody(metaBody(template.bodies[language]), parameters);
  return { text, template: { name: template.name, language, text, parameters } };
}

// ---- the list to submit to Meta ------------------------------------------------------------------------------------------------

/** Example values for Meta's review: the sample month the review sheets use, as a live report, with a believable address and builder. */
function exampleValues(language: Language, template: ReportTemplate): Record<ReportSlot, string> {
  const sample = { ...sampleReport(), source: "live" as const };
  // a real signed summary link (SAMPLE_SUMMARY_LINK) where the message has room for it, chosen as a real message's is
  return valuesWithCheck(template, language, sample, { code: "7K2M-9QXD", link: `https://reports.example.com/r/3f9a1c7d2b8e4f60/report-2027-02-${language}.html`, builder: "Divya, Sri Sai Digital" }, { digest: SAMPLE_DIGEST, code: "7K2M-9QXD" }, SAMPLE_SUMMARY_LINK);
}

/** The values with the check link chosen for this template and language: the summary link if the filled message fits WhatsApp's limit, else the #digest link, else the #code link (messageCheckLink). */
function valuesWithCheck(template: ReportTemplate, language: Language, report: FeesReport, extras: Omit<ReportExtras, "check">, envelope: { digest: string; code: string }, summaryLink?: string): Record<ReportSlot, string> {
  const fill = (check: string, settled?: string) => fillBody(metaBody(template.bodies[language]), reportParameters(template, language, reportValues(report, language, { ...extras, check, ...(settled ? { settled } : {}) })));
  // B75: refunds people settled by their word, with each person named if the message still fits with the shortest check link; otherwise without the names
  // (the full report names them). Chosen before the link, so a long month gives up the longer link before it gives up who settled what.
  const settled = settledByWordWords(report.money.settledByWord, language, STRINGS[language].more, (words) => fill(verifyCodeLink(envelope), words).length <= WHATSAPP_BODY_LIMIT);
  return reportValues(report, language, { ...extras, ...(settled ? { settled } : {}), check: messageCheckLink((check) => fill(check, settled), envelope, summaryLink) });
}

/** The message as the review sheets show it: the sample month, with the Innovator line, so a native reader sees every word that is sent. */
export function sampleMessage(language: Language): string {
  const template = REPORT_TEMPLATES.find((t) => t.badge && !t.upi)!;
  return fillBody(metaBody(template.bodies[language]), reportParameters(template, language, exampleValues(language, template)));
}

/** One entry per template and language, in the body Meta's create-template call takes (POST /{waba-id}/message_templates), like metaSubmissions in src/language/meta-templates.ts. */
export function reportSubmissions(): MetaSubmission[] {
  return REPORT_TEMPLATES.flatMap((t) => LANGUAGES.map((language) => ({
    name: t.name, language: META_LANGUAGE[language], category: "UTILITY" as const, parameter_format: "positional" as const,
    components: [{ type: "BODY" as const, text: metaBody(t.bodies[language]), example: { body_text: [reportParameters(t, language, exampleValues(language, t))] } }],
  })));
}
