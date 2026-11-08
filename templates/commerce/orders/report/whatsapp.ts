// The monthly Orders report as a WhatsApp message: the owner's lines, in the shop's language, from the numbers the report counted, with the name of the builder or
// partner who set the agent up and, when they have it, the Innovator badge. The same plan as Bookings' (B54), over the same shared job (modules/report/monthly-job.ts).
//
// One wording, two ways to send it. The words below are written once per language. Inside the owner's 24-hour window they go out as plain text. Outside it (the usual
// case on the 1st of the month) WhatsApp carries only an approved template, so the SAME words are listed for Meta as two utility templates, `order_monthly_report` and
// `order_monthly_report_innovator`, with the numbers as numbered values. A template cannot have an optional line, which is why the badge is a template of its own.
// Filling a template gives back, letter for letter, the plain text (a test holds that).
//
// What the lines are, and where each number comes from (all counted from the record by report/data.ts):
//   advance collected, given back, to collect   report.money.collected, report.money.givenBack, report.sold.toCollect
//   orders taken, cancelled                     report.orders.taken, report.orders.cancelled
//   you were asked, approved, said no           report.owner
//   stopped by your limits                      report.stopped.total
//   what was not checked                        the owner's short form (text.ts), and "checks were run by hand"
// The check code and the address of the full page, then the help line, close the message, then who set it up. Rules for the words: informational only, no promotion (Meta moves a
// promotional template to the marketing price), numbers and labels only, nothing graded.
import { META_LANGUAGE, fillBody, metaBody } from "../../../../modules/language/meta-templates.ts";
import type { MetaSubmission } from "../../../../modules/language/meta-templates.ts";
import { LANGUAGES } from "../../../../modules/language/languages.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import type { TemplateMessage } from "../../../../modules/messaging/messaging.ts";
import type { Envelope } from "../../../../modules/report/sign.ts";
import { badgeText, oneLine, periodLabel, rupees } from "../../../../modules/report/text.ts";
import type { OrdersReport } from "./data.ts";
import { sampleReport } from "./review.ts";
import { STRINGS } from "./strings.ts";
import { notCheckedList } from "./text.ts";

export interface ReportTemplate {
  /** The name registered with Meta (lowercase, underscores). */
  name: string;
  audience: "owner";
  /** True for the template that carries the Innovator badge line. */
  badge: boolean;
  /** True for a UPI shop's (B33): its money is labelled as marked paid by the owner. */
  upi?: boolean;
  /** The wording per language, with {slot} where a value goes (see REPORT_SLOTS). Turned into {{n}} for Meta. */
  bodies: Record<Language, string>;
}

/** The values in a report message, in the order they come in the wording. */
export const REPORT_SLOTS = ["title", "collected", "givenBack", "pending", "orders", "cancelled", "asked", "approved", "saidNo", "stopped", "notChecked", "code", "link", "builder"] as const;
export type ReportSlot = (typeof REPORT_SLOTS)[number];

/** The words for one language. Starts and ends with fixed words, never two values side by side, one line per thing the owner reads. */
function wording(language: Language, badge: boolean, upi = false): string {
  const s = STRINGS[language];
  const dot = language === "hi" ? "।" : ".";
  return [
    `${s.monthlyReport}: {title}`,
    `${upi ? s.upiLabel.collected : s.label.collected}: {collected} · ${upi ? s.upiLabel.givenBack : s.label.givenBack}: {givenBack} · ${s.label.stillToCollect}: {pending}`,
    `${s.label.ordersTaken}: {orders} · ${s.label.cancelled}: {cancelled}`,
    `${s.label.wasAsked}: {asked} · ${s.label.approved}: {approved} · ${s.label.saidNo}: {saidNo}`,
    `${s.label.stoppedByLimits}: {stopped}`,
    `${s.label.notChecked}: {notChecked}${dot} ${s.handRun}`,
    `${s.page.code}: {code} · ${s.fullReport}: {link}`,
    s.helpLine,
    `${s.page.setUpBy}: {builder} · Geometer`,
    ...(badge ? [badgeText(language)] : []),
  ].join("\n");
}

const bodiesOf = (badge: boolean, upi = false): Record<Language, string> => Object.fromEntries(LANGUAGES.map((l) => [l, wording(l, badge, upi)])) as Record<Language, string>;

export const REPORT_TEMPLATES: readonly ReportTemplate[] = [
  { name: "order_monthly_report", audience: "owner", badge: false, bodies: bodiesOf(false) },
  { name: "order_monthly_report_innovator", audience: "owner", badge: true, bodies: bodiesOf(true) },
  // a UPI shop (B33): the same lines, with its money labelled as marked paid by the owner
  { name: "order_monthly_report_upi", audience: "owner", badge: false, upi: true, bodies: bodiesOf(false, true) },
  { name: "order_monthly_report_upi_innovator", audience: "owner", badge: true, upi: true, bodies: bodiesOf(true, true) },
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
  /** Who set the agent up, as they are named on the report. */
  builder: string;
}

/** The value of every slot, as the owner reads it. */
export function reportValues(report: OrdersReport, language: Language, extras: ReportExtras): Record<ReportSlot, string> {
  const s = STRINGS[language];
  const tag = s.sourceTag[report.source];
  return {
    title: [oneLine(report.shop.name), periodLabel(report.period, language), tag].filter(Boolean).join(" · "),
    collected: rupees(report.money.collected.paise),
    givenBack: rupees(report.money.givenBack.paise),
    pending: report.sold.toCollect.count > 0 ? `${rupees(report.sold.toCollect.paise)} (${s.label.orders}: ${report.sold.toCollect.count})` : rupees(0),
    orders: String(report.orders.taken),
    cancelled: String(report.orders.cancelled),
    asked: String(report.owner.asked),
    approved: String(report.owner.approved),
    saidNo: String(report.owner.denied),
    stopped: String(report.stopped.total),
    notChecked: notCheckedList(report, language),
    code: extras.code,
    link: extras.link,
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
 * comes from the report's own `innovator` flag, so what the owner reads is what the signed report says.
 */
export function monthlyReportMessage(report: Envelope<OrdersReport>, language: Language, o: { link: string }): ReportMessage {
  const r = report.document;
  if (!r.preparedBy || oneLine(r.preparedBy) === "") throw new Error("The report names no one who set the agent up, and the message says who did.");
  const template = REPORT_TEMPLATES.find((t) => t.badge === (r.innovator === true) && (t.upi === true) === (r.paidBy === "owner-marked"))!;
  const parameters = reportParameters(template, language, reportValues(r, language, { code: report.code, link: o.link, builder: r.preparedBy }));
  const text = fillBody(metaBody(template.bodies[language]), parameters);
  return { text, template: { name: template.name, language, text, parameters } };
}

// ---- the list to submit to Meta ------------------------------------------------------------------------------------------------

/** Example values for Meta's review: the sample month the review sheets use, as a live report, with a believable address and builder. */
function exampleValues(language: Language): Record<ReportSlot, string> {
  const sample = { ...sampleReport(), source: "live" as const };
  return reportValues(sample, language, { code: "7K2M-9QXD", link: `https://reports.example.com/r/3f9a1c7d2b8e4f60/report-2027-02-${language}.html`, builder: "Divya, local partner" });
}

/** The message as the review sheets show it: the sample month, with the Innovator line, so a native reader sees every word that is sent. */
export function sampleMessage(language: Language): string {
  const template = REPORT_TEMPLATES.find((t) => t.badge && !t.upi)!;
  return fillBody(metaBody(template.bodies[language]), reportParameters(template, language, exampleValues(language)));
}

/** One entry per template and language, in the body Meta's create-template call takes (POST /{waba-id}/message_templates), like metaSubmissions in src/language/meta-templates.ts. */
export function reportSubmissions(): MetaSubmission[] {
  return REPORT_TEMPLATES.flatMap((t) => LANGUAGES.map((language) => ({
    name: t.name, language: META_LANGUAGE[language], category: "UTILITY" as const, parameter_format: "positional" as const,
    components: [{ type: "BODY" as const, text: metaBody(t.bodies[language]), example: { body_text: [reportParameters(t, language, exampleValues(language))] } }],
  })));
}
