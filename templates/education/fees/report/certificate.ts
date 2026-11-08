// The go-live certificate for Fees, as data and as a page and a short text in the centre's language.
//
// It is made from one run of the hand check (runOn()): "Held N of M situations. K failed. J not tested", the list of what was not tested, the date, the pathway version, the
// centre's limits in plain words, and how the checks were run ("by hand, against stand-in services", the hand check's own words). It states facts and counts; it never grades.
// It lists what was not tested, and every number, amount and date is read from the hand check or the settings and written by the per-language formatters; the words
// around them are in strings.ts. The monthly report reads this file back (report/go-live.ts) to say what its checks ran on.
//
// There is no monthly record certificate for Fees yet (Deferred.md): the monthly report carries what it was told about this one.
import { HAND_RUN, STAND_IN_SERVICES } from "../crash-test/not-tested.ts";
import type { HandCheckRun, SituationResult } from "../crash-test/situations.ts";
import { formatDate, formatInr } from "../../../../modules/language/format.ts";
import { LANGUAGES } from "../../../../modules/language/languages.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import { localParts } from "../../../../modules/core/time.ts";
import type { LocalDate } from "../../../../modules/core/time.ts";
import { esc, list, page, sealBlock } from "../../../../modules/report/page.ts";
import { verifyCodePath } from "../../../../modules/report/verify-link.ts";
import type { Envelope } from "../../../../modules/report/sign.ts";
import { languagesOf, oneLine } from "../../../../modules/report/text.ts";
import type { ReportLanguage } from "../../../../modules/report/text.ts";
import { batchName } from "../src/settings.ts";
import type { Settings } from "../src/settings.ts";
import { PATHWAY, checkedPolicyDigest, notTestedFor, policyDigest } from "./data.ts";
import type { NotTestedKey } from "./data.ts";
import { STRINGS } from "./strings.ts";

// ---- the hand check, summed up -------------------------------------------------------------------------------------------

export interface HandCheckSummary {
  /** Situations that held, how many were tried, and how many checks were made inside them. */
  held: number;
  total: number;
  checks: number;
  /** The titles (English) of the situations that did not hold. */
  failedTitles: string[];
  /** The digest of the settings the situations ran on, when it is not Bright Tuition Centre's (the default). */
  ranOn?: string;
  /** The titles (English) of situations that these settings could not run: they are not in `total`. */
  notRun?: string[];
}

/** A run on one centre's own settings: the counts, the digest of the settings it ran on, and the situations those settings could not run. */
export function summariseRun(run: HandCheckRun<Settings>): HandCheckSummary {
  return {
    ...summariseHandCheck(run.results),
    ranOn: policyDigest(run.settings),
    ...(run.skipped.length > 0 ? { notRun: run.skipped.map((s) => s.title) } : {}),
  };
}

export function summariseHandCheck(results: readonly SituationResult[]): HandCheckSummary {
  return {
    held: results.filter((r) => r.held).length,
    total: results.length,
    checks: results.reduce((n, r) => n + r.checks.length, 0),
    failedTitles: results.filter((r) => !r.held).map((r) => r.situation.title),
  };
}

// ---- the go-live certificate ---------------------------------------------------------------------------------------------

export interface GoLiveCertificate {
  format: "geometer-go-live-certificate/1";
  pathway: { name: string; version: string };
  /** The hand check runs on stand-in services only. */
  source: "stand-in";
  /** How the checks were run, in the hand check's own words. */
  ranAs: { how: typeof HAND_RUN; against: typeof STAND_IN_SERVICES };
  shop: { name: string; timeZone: string };
  preparedBy: string | null;
  issuedAt: string;
  issuedOn: LocalDate;
  checks: { held: number; total: number; failed: number; failedTitles: string[]; checks: number; notRun?: string[] };
  notTested: NotTestedKey[];
  /** The centre's limits, from its settings, with no contact details and no student's name. */
  limits: {
    batches: { id: string; monthlyFeeInr: number; name: Record<Language, string> }[];
    students: number;
    dueDay: number; graceDays: number; lateFeeInr: number;
    reminders: { daysFromDue: number[]; hour: number; maxPerMonth: number };
    partPayments: { allowed: boolean; minInr: number };
    waiverLimitInr: number; refundLimitInr: number;
  };
  /** The centre's settings (without contact details) and the settings the checks actually ran on. They differ only when the checks were not run on this centre's own settings. */
  policyDigest: string;
  checkedPolicyDigest: string;
  anchor: null;
}

export interface GoLiveInput {
  settings: Settings;
  handCheck: HandCheckSummary;
  /** When the certificate is made (epoch milliseconds), passed in so the same input gives the same certificate. */
  issuedAt: number;
  preparedBy?: string;
}

export type Limits = GoLiveCertificate["limits"];

/** The centre's limits, as the certificate states them. The panel uses it to show them before a certificate exists. */
export function limitsOf(settings: Settings): Limits {
  return {
    batches: settings.batches.map((b) => ({ id: b.id, monthlyFeeInr: b.monthlyFeeInr, name: Object.fromEntries(LANGUAGES.map((l) => [l, batchName(b, l)])) as Record<Language, string> })),
    students: settings.students.length,
    dueDay: settings.due.day, graceDays: settings.due.graceDays, lateFeeInr: settings.lateFeeInr,
    reminders: { daysFromDue: [...settings.reminders.daysFromDue], hour: settings.reminders.hour, maxPerMonth: settings.reminders.maxPerMonth },
    partPayments: { allowed: settings.partPayments.allowed, minInr: settings.partPayments.minInr },
    waiverLimitInr: settings.waiver.limitInr, refundLimitInr: settings.refund.limitInr,
  };
}

export function buildGoLiveCertificate(input: GoLiveInput): GoLiveCertificate {
  const { settings, handCheck, issuedAt } = input;
  const day = localParts(issuedAt, settings.timezone);
  return {
    format: "geometer-go-live-certificate/1",
    pathway: PATHWAY,
    source: "stand-in",
    ranAs: { how: HAND_RUN, against: STAND_IN_SERVICES },
    shop: { name: settings.name, timeZone: settings.timezone },
    preparedBy: input.preparedBy ?? null,
    issuedAt: new Date(issuedAt).toISOString(),
    issuedOn: { year: day.year, month: day.month, day: day.day },
    checks: { held: handCheck.held, total: handCheck.total, failed: handCheck.total - handCheck.held, failedTitles: handCheck.failedTitles, checks: handCheck.checks, ...(handCheck.notRun ? { notRun: handCheck.notRun } : {}) },
    notTested: notTestedFor(settings, { onPolicyDigest: handCheck.ranOn, notRun: handCheck.notRun?.length }),
    limits: limitsOf(settings),
    policyDigest: policyDigest(settings),
    checkedPolicyDigest: handCheck.ranOn ?? checkedPolicyDigest(),
    anchor: null,
  };
}

const dateText = (d: LocalDate, language: Language): string => `${formatDate(d, language)} ${d.year}`;

/** The centre's limits in plain words, one phrase each, in the centre's language. */
export function limitLines(cert: GoLiveCertificate, language: Language): string[] {
  return limitLinesOf(cert.limits, language);
}

/** The same phrases from the limits alone (the panel shows them before any certificate exists). */
export function limitLinesOf(l: Limits, language: Language): string[] {
  const c = STRINGS[language].cert;
  const days = l.reminders.daysFromDue.map((d) => (d > 0 ? `+${d}` : String(d))).join(", ");
  return [
    c.paidRule,
    c.fees(l.batches.map((b) => `${b.name[language]} ${formatInr(b.monthlyFeeInr)}`).join(" · ")),
    c.due(l.dueDay, l.graceDays),
    l.lateFeeInr > 0 ? c.lateFee(formatInr(l.lateFeeInr)) : c.noLateFee,
    c.reminders(days, l.reminders.hour, l.reminders.maxPerMonth),
    l.partPayments.allowed ? c.partPayments(formatInr(l.partPayments.minInr)) : c.noPartPayments,
    l.waiverLimitInr > 0 ? c.waiver(formatInr(l.waiverLimitInr)) : c.noWaiver,
    c.refund(formatInr(l.refundLimitInr)),
    c.students(l.students),
  ];
}

const heldLine = (cert: GoLiveCertificate, language: Language): string => STRINGS[language].cert.held(cert.checks.held, cert.checks.total, cert.checks.failed, cert.notTested.length);

/** The short text, ready to paste into WhatsApp: a handful of lines. */
export function goLiveText(envelope: Envelope<GoLiveCertificate>, language: Language): string {
  const s = STRINGS[language];
  const cert = envelope.document;
  const lines = [
    `${oneLine(cert.shop.name)} · ${s.agent} · ${s.goLiveCertificate} · ${dateText(cert.issuedOn, language)}`,
    heldLine(cert, language),
    ...(cert.checks.failed > 0 ? [`${s.cert.didNotHold}: ${cert.checks.failedTitles.join("; ")}`] : []),
    `${s.cert.yourLimits}:`,
    ...limitLines(cert, language).map((line) => `• ${line}`),
    `${s.label.notChecked}: ${cert.notTested.map((id) => s.notTested[id]).join(" · ")}`,
    s.cert.handRunLine,
    `${cert.preparedBy ? `${s.page.setUpBy}: ${oneLine(cert.preparedBy)} · ` : ""}${s.page.agentVersion}: ${cert.pathway.name} ${cert.pathway.version} · ${s.page.code}: ${envelope.code} · ${verifyCodePath(envelope)}`,
  ];
  return lines.join("\n");
}

export function goLiveSection(envelope: Envelope<GoLiveCertificate>, language: Language): string {
  const s = STRINGS[language];
  const cert = envelope.document;
  return `<section class="doc" lang="${language}">
<header class="head"><p class="kicker">${esc(s.agent)}</p><h1>${esc(cert.shop.name)}</h1><p class="period">${esc(s.goLiveCertificate)} · ${esc(dateText(cert.issuedOn, language))}</p><p class="tag">${esc(s.sourceTag["stand-in"])}</p></header>
<div class="cards">
<div class="card"><b>${cert.checks.held} / ${cert.checks.total}</b><span>${esc(heldLine(cert, language))}</span></div>
</div>
<p>${esc(s.cert.intro)}</p>
${cert.checks.failed > 0 ? `<div class="warn"><h2>${esc(s.cert.didNotHold)}</h2>${list(cert.checks.failedTitles)}</div>` : ""}
<h2>${esc(s.cert.yourLimits)}</h2>${list(limitLines(cert, language))}
<p class="note">${esc(s.cert.handRunLine)}</p>
<div class="warn"><h2>${esc(s.page.notTestedHeading)}</h2>${list(cert.notTested.map((id) => s.notTested[id]))}</div>
<p class="small">${esc(s.cert.notAGrade)}</p>
${sealBlock(s.page, envelope, [[s.page.agentVersion, `${cert.pathway.name} ${cert.pathway.version}`], [s.cert.date, dateText(cert.issuedOn, language)], ...(cert.preparedBy ? [[s.page.setUpBy, cert.preparedBy] as [string, string]] : []),
  [s.page.limitsDigest, cert.policyDigest], [`${s.cert.checkedOn} (${s.page.limitsDigest})`, cert.checkedPolicyDigest]])}
</section>`;
}

export function goLivePage(envelope: Envelope<GoLiveCertificate>, language: ReportLanguage): string {
  const langs = languagesOf(language);
  return page(`${envelope.document.shop.name} · ${STRINGS[langs[0]].goLiveCertificate}`, langs[0], langs.map((l) => goLiveSection(envelope, l)));
}
