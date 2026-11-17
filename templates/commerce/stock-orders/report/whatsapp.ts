// The monthly Stock orders report as a WhatsApp message: the owner's lines, in the owner's language, from the numbers the report counted, with the name of the builder or
// Operator who set the agent up and, when they have it, the Innovator badge. The same plan as Orders' and Bookings' reports, over the same shared job (modules/report/monthly-job.ts).
//
// One wording, two ways to send it. The words below are written once per language. Inside the owner's 24-hour window they go out as plain text. Outside it (the usual
// case on the 1st of the month) WhatsApp carries only an approved template, so the SAME words are listed for Meta as two utility templates, `stock_monthly_report` and
// `stock_monthly_report_innovator`, with the numbers as numbered values. A template cannot have an optional line, which is why the badge is a template of its own. The names
// start with "stock_" so they never clash with another template's (Orders has `order_monthly_report`). Filling a template gives back, letter for letter, the plain text.
//
// What the lines are, and where each number comes from (all counted by report/data.ts from the record and the orders):
//   orders placed, supplier said OK, received in full, part, wrong item     report.orders
//   supplier said no, no answer, cancelled or never sent                    report.orders
//   budget used (of the month's budget), and the owner's own "marked as paid" report.budget, report.markedPaidByOwner (inside the budget value, only when there is one:
//                                                                           a template cannot have an optional line, and this agent pays no one)
//   stopped by your limits                                                  report.stopped.total
//   what was not checked                                                    the owner's short form (text.ts), and "checks were run by hand"
// The check code and the address of the full page, then the check link, then the help line, close the message, then who set it up. Rules for the words: informational
// only, no promotion (Meta moves a promotional template to the marketing price), numbers and labels only, nothing graded.
// The check link is the report's signed summary, so the owner taps it and sees on geometer.dev whether the report is genuine, with no file (modules/report/summary.ts). It is
// the signed summary when the whole message still fits WhatsApp's 1024 characters, else the older #digest link (messageCheckLink): one choice per message.
import { META_LANGUAGE, fillBody, metaBody } from "../../../../modules/language/meta-templates.ts";
import type { MetaSubmission } from "../../../../modules/language/meta-templates.ts";
import { LANGUAGES } from "../../../../modules/language/languages.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import type { TemplateMessage } from "../../../../modules/messaging/messaging.ts";
import type { Envelope } from "../../../../modules/report/sign.ts";
import { badgeText, oneLine, periodLabel } from "../../../../modules/report/text.ts";
import type { StockReport } from "./data.ts";
import { sampleReport } from "./review.ts";
import { STRINGS } from "./strings.ts";
import { budgetValue, notCheckedList } from "./text.ts";
import { messageCheckLink } from "../../../../modules/report/summary-sign.ts";
import { SAMPLE_DIGEST, SAMPLE_SUMMARY_LINK } from "../../../../modules/report/summary.ts";

export interface ReportTemplate {
  /** The name registered with Meta (lowercase, underscores, starting "stock_"). */
  name: string;
  audience: "owner";
  /** True for the template that carries the Innovator badge line. */
  badge: boolean;
  /** The wording per language, with {slot} where a value goes (see REPORT_SLOTS). Turned into {{n}} for Meta. */
  bodies: Record<Language, string>;
}

/** The values in a report message, in the order they come in the wording. */
export const REPORT_SLOTS = ["title", "placed", "acknowledged", "received", "part", "wrong", "declined", "silent", "neverSent", "budget", "stopped", "notChecked", "code", "link", "check", "builder"] as const;
export type ReportSlot = (typeof REPORT_SLOTS)[number];

/**
 * The words for one language. Starts and ends with fixed words, never two values side by side, one line per thing the owner reads. The figures are bold (*text*, which WhatsApp
 * shows as bold), so a figure never looks like its label; the asterisk is a fixed word on each side of a value, so the rules (never start or end with a value) still hold.
 */
function wording(language: Language, badge: boolean): string {
  const s = STRINGS[language];
  const dot = language === "hi" ? "।" : ".";
  return [
    `*${s.monthlyReport}: {title}*`,
    `${s.label.placed}: *{placed}* · ${s.label.acknowledged}: *{acknowledged}* · ${s.label.receivedFull}: *{received}* · ${s.label.partReceived}: *{part}* · ${s.label.wrongItem}: *{wrong}*`,
    `${s.label.supplierSaidNo}: *{declined}* · ${s.label.noAnswer}: *{silent}* · ${s.label.neverSent}: *{neverSent}*`,
    `${s.label.budgetUsed}: *{budget}*`,
    `${s.label.stopped}: *{stopped}*`,
    `*${s.label.notChecked}*: {notChecked}${dot} ${s.handRun}`,
    `${s.page.code}: {code} · ${s.fullReport}: {link}`,
    `${s.checkGenuine}: {check}`,
    s.helpLine,
    `${s.page.setUpBy}: {builder} · Geometer`,
    ...(badge ? [badgeText(language)] : []),
  ].join("\n");
}

const bodiesOf = (badge: boolean): Record<Language, string> => Object.fromEntries(LANGUAGES.map((l) => [l, wording(l, badge)])) as Record<Language, string>;

export const REPORT_TEMPLATES: readonly ReportTemplate[] = [
  { name: "stock_monthly_report", audience: "owner", badge: false, bodies: bodiesOf(false) },
  { name: "stock_monthly_report_innovator", audience: "owner", badge: true, bodies: bodiesOf(true) },
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
}

/** The value of every slot, as the owner reads it. */
export function reportValues(report: StockReport, language: Language, extras: ReportExtras): Record<ReportSlot, string> {
  const s = STRINGS[language];
  const tag = s.sourceTag[report.source];
  const o = report.orders;
  return {
    title: [oneLine(report.shop.name), periodLabel(report.period, language), tag].filter(Boolean).join(" · "),
    placed: String(o.placed), acknowledged: String(o.acknowledged), received: String(o.receivedFull), part: String(o.partReceived), wrong: String(o.wrongItem),
    declined: String(o.declinedBySupplier), silent: String(o.silent), neverSent: String(o.neverSent),
    budget: budgetValue(report, language),
    stopped: String(report.stopped.total),
    notChecked: notCheckedList(report, language),
    code: extras.code, link: extras.link, check: extras.check, builder: oneLine(extras.builder),
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

/** The template a report goes out as: with the Innovator line or without. */
export const templateFor = (r: StockReport): ReportTemplate => REPORT_TEMPLATES.find((t) => t.badge === (r.innovator === true))!;

/** The values with the check link chosen for this template and language: the summary link if the filled message fits WhatsApp's limit, else the #digest link, else the #code link. */
function valuesWithCheck(template: ReportTemplate, language: Language, report: StockReport, extras: Omit<ReportExtras, "check">, envelope: { digest: string; code: string }, summaryLink?: string): Record<ReportSlot, string> {
  const fill = (check: string) => fillBody(metaBody(template.bodies[language]), reportParameters(template, language, reportValues(report, language, { ...extras, check })));
  return reportValues(report, language, { ...extras, check: messageCheckLink(fill, envelope, summaryLink) });
}

/**
 * The message for one sealed report, in one language. The builder's name is the report's own `preparedBy` (the report cannot be sent without it), and the badge
 * comes from the report's own `innovator` flag, so what the owner reads is what the signed report says. `check` is the report's signed summary link (report/run.ts),
 * left out for a report that is not signed: the message then carries the #digest link.
 */
export function monthlyReportMessage(report: Envelope<StockReport>, language: Language, o: { link: string; check?: string }): ReportMessage {
  const r = report.document;
  if (!r.preparedBy || oneLine(r.preparedBy) === "") throw new Error("The report names no one who set the agent up, and the message says who did.");
  const template = templateFor(r);
  const parameters = reportParameters(template, language, valuesWithCheck(template, language, r, { code: report.code, link: o.link, builder: r.preparedBy }, report, o.check));
  const text = fillBody(metaBody(template.bodies[language]), parameters);
  return { text, template: { name: template.name, language, text, parameters } };
}

// ---- the list to submit to Meta ------------------------------------------------------------------------------------------------

/** The sample month as a report this template would really carry (the badge line only on the Innovator template). */
export function sampleFor(template: ReportTemplate): StockReport {
  return { ...sampleReport(), ...(template.badge ? { innovator: true as const } : {}) };
}

/** Example values for Meta's review: the sample month the review sheets use, as a live report, with a believable address and builder. */
function exampleValues(language: Language, template: ReportTemplate): Record<ReportSlot, string> {
  const sample = { ...sampleFor(template), source: "live" as const };
  // a real signed summary link (SAMPLE_SUMMARY_LINK) where the message has room for it, chosen as a real message's is
  return valuesWithCheck(template, language, sample, { code: "7K2M-9QXD", link: `https://reports.example.com/r/3f9a1c7d2b8e4f60/report-2027-02-${language}.html`, builder: "Divya, Sri Sai Digital" }, { digest: SAMPLE_DIGEST, code: "7K2M-9QXD" }, SAMPLE_SUMMARY_LINK);
}

/**
 * The message as the review sheets show it: the sample month, with the Innovator line, so a native reader sees every word that is sent, with the same values Meta's example has.
 */
export function sampleMessage(language: Language): string {
  const template = templateFor({ ...sampleReport(), innovator: true });
  return fillBody(metaBody(template.bodies[language]), reportParameters(template, language, exampleValues(language, template)));
}

/** One entry per template and language, in the body Meta's create-template call takes (POST /{waba-id}/message_templates), like metaSubmissions in src/language/meta-templates.ts. */
export function reportSubmissions(): MetaSubmission[] {
  return REPORT_TEMPLATES.flatMap((t) => LANGUAGES.map((language) => ({
    name: t.name, language: META_LANGUAGE[language], category: "UTILITY" as const, parameter_format: "positional" as const,
    components: [{ type: "BODY" as const, text: metaBody(t.bodies[language]), example: { body_text: [reportParameters(t, language, exampleValues(language, t))] } }],
  })));
}
