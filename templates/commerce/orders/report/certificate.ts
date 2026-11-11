// The go-live certificate for Orders, as data and as a page and a short text in the shop's language.
//
// It is made from one run of the hand check (runOn()): "Held N of M situations. K failed. J not tested", the list of what was not tested, the date, the template version, the
// shop's limits in plain words, and how the checks were run ("by hand, against stand-in services", the hand check's own words). It states facts and counts; it never grades.
// It lists what was not tested, and every number, amount and date is read from the hand check or the settings and written by the per-language formatters; the words
// around them are in strings.ts. The monthly report reads this file back (report/go-live.ts) to say what its checks ran on.
//
// There is no monthly record certificate for Orders yet: the monthly report carries what it was told about this one.
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
import { itemName } from "../src/settings.ts";
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
  /** The digest of the settings the situations ran on, when it is not Annapurna Tiffins' (the default). */
  ranOn?: string;
  /** The titles (English) of situations that these settings could not run: they are not in `total`. */
  notRun?: string[];
}

/** A run on one shop's own settings: the counts, the digest of the settings it ran on, and the situations those settings could not run. */
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
  /** The shop's limits, from its settings, with no contact details and no customer's name. */
  limits: {
    menu: { id: string; priceInr: number; dailyStock: number; name: Record<Language, string> }[];
    maxPerDay: number; maxItemsPerOrder: number; daysAhead: number;
    cutoff: { daysBefore: number; time: string };
    advance: { full: boolean; percent: number; holdMinutes: number };
    deliveryAreas: string[] | null;
    cancellationWindowHours: number;
    refundLimitInr: number;
    approveOverInr: number;
  };
  /** The shop's settings (without contact details) and the settings the checks actually ran on. They differ only when the checks were not run on this shop's own settings. */
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

/** The shop's limits, as the certificate states them. */
export function limitsOf(settings: Settings): Limits {
  return {
    menu: settings.menu.map((i) => ({ id: i.id, priceInr: i.priceInr, dailyStock: i.dailyStock, name: Object.fromEntries(LANGUAGES.map((l) => [l, itemName(i, l)])) as Record<Language, string> })),
    maxPerDay: settings.orders.maxPerDay, maxItemsPerOrder: settings.orders.maxItemsPerOrder, daysAhead: settings.orders.daysAhead,
    cutoff: { daysBefore: settings.cutoff.daysBefore, time: settings.cutoff.time },
    advance: { full: settings.advance.mode === "full" || settings.advance.percent >= 100, percent: settings.advance.percent, holdMinutes: settings.advance.holdMinutes },
    deliveryAreas: settings.delivery ? [...settings.delivery.area] : null,
    cancellationWindowHours: settings.cancellation.windowHours,
    refundLimitInr: settings.refund.limitInr,
    approveOverInr: settings.owner.approveOverInr,
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

/** The shop's limits in plain words, one phrase each, in the shop's language. */
export function limitLines(cert: GoLiveCertificate, language: Language): string[] {
  return limitLinesOf(cert.limits, language);
}

/** The same phrases from the limits alone. */
export function limitLinesOf(l: Limits, language: Language): string[] {
  const c = STRINGS[language].cert;
  return [
    c.paidRule,
    c.menu(l.menu.map((i) => `${i.name[language]} ${formatInr(i.priceInr)} (${i.dailyStock})`).join(" · ")),
    c.orderLimits(l.maxPerDay, l.maxItemsPerOrder, l.daysAhead),
    c.cutoff(l.cutoff.daysBefore, l.cutoff.time),
    c.advance(l.advance.full, l.advance.percent, l.advance.holdMinutes),
    l.deliveryAreas ? c.delivery(l.deliveryAreas.join(", ")) : c.noDelivery,
    c.window(l.cancellationWindowHours),
    c.refund(formatInr(l.refundLimitInr)),
    l.approveOverInr > 0 ? c.approve(formatInr(l.approveOverInr)) : c.noApprove,
  ];
}

const heldLine = (cert: GoLiveCertificate, language: Language): string => STRINGS[language].cert.held(cert.checks.held, cert.checks.total, cert.checks.failed, cert.notTested.length);

/** The short text, ready to paste into WhatsApp: a handful of lines. */
/** The short text, ready to paste into WhatsApp. It ends with the signed summary link when the certificate is signed (`check`), else the short /verify/#code. */
export function goLiveText(envelope: Envelope<GoLiveCertificate>, language: Language, check?: string): string {
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
    `${cert.preparedBy ? `${s.page.setUpBy}: ${oneLine(cert.preparedBy)} · ` : ""}${s.page.agentVersion}: ${cert.pathway.name} ${cert.pathway.version} · ${s.page.code}: ${envelope.code}${check ? "" : ` · ${verifyCodePath(envelope)}`}`,
    ...(check ? [`${s.checkGenuine}: ${check}`] : []),
  ];
  return lines.join("\n");
}

export function goLiveSection(envelope: Envelope<GoLiveCertificate>, language: Language, check?: string): string {
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
  [s.page.limitsDigest, cert.policyDigest], [`${s.cert.checkedOn} (${s.page.limitsDigest})`, cert.checkedPolicyDigest]], check)}
</section>`;
}

/** The go-live certificate's page; `check` is its signed summary link (report/run.ts), left out when it is not signed. */
export function goLivePage(envelope: Envelope<GoLiveCertificate>, language: ReportLanguage, check?: string): string {
  const langs = languagesOf(language);
  return page(`${envelope.document.shop.name} · ${STRINGS[langs[0]].goLiveCertificate}`, langs[0], langs.map((l) => goLiveSection(envelope, l, check)));
}
