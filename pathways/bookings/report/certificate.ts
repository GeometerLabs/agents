// The two plain-language certificates, as data and as pages and short texts in the shop's language.
//
//  - The go-live certificate is made from one run of the hand check (runAll()): "Held N of M situations. K failed. J not tested",
//    the list of what was not tested, the date, the pathway version, the shop's limits in plain words, and how the checks
//    were run ("by hand, against stand-in services", the hand check's own words).
//  - The monthly record certificate is made from a sealed monthly report: what was counted from the record, what was not
//    counted, what was not tested, and the digests of the report and the record it came from.
//
// They state facts and count; they never grade ("safe", "guaranteed", "certified"). Every certificate lists what was not
// tested. Every number, amount and date is read from the hand check, the settings or the report, and written by the
// per-language formatters; the words around them are in strings.ts.
import { HAND_RUN, STAND_IN_SERVICES } from "../crash-test/not-tested.ts";
import type { HandCheckRun, SituationResult } from "../crash-test/situations.ts";
import { formatDate, formatInr } from "../src/language/format.ts";
import { LANGUAGES, serviceName } from "../src/settings.ts";
import type { Language, Settings } from "../src/settings.ts";
import { localParts } from "../src/time.ts";
import type { LocalDate } from "../src/time.ts";
import { PATHWAY, checkedPolicyDigest, notTestedFor, policyDigest } from "./data.ts";
import type { GoLiveFinding, MonthlyReport, NotCountedId, NotTestedKey, Source } from "./data.ts";
import { esc, goLiveBlock, list, page, sealBlock, table } from "./html.ts";
import type { Envelope } from "./sign.ts";
import { STRINGS, badgeText } from "./strings.ts";
import { goLiveLines, languagesOf, oneLine, periodLabel, rupees } from "./text.ts";
import type { ReportLanguage } from "./text.ts";

// ---- the hand check, summed up -------------------------------------------------------------------------------------------

export interface HandCheckSummary {
  /** Situations that held, how many were tried, and how many checks were made inside them. */
  held: number;
  total: number;
  checks: number;
  /** The titles (English) of the situations that did not hold. */
  failedTitles: string[];
  /** The digest of the settings the situations ran on, when it is not Glow Salon's (the default). */
  ranOn?: string;
  /** The titles (English) of situations that these settings could not run: they are not in `total`. */
  notRun?: string[];
}

/** A run on one shop's own settings: the counts, the digest of the settings it ran on, and the situations those settings could not run. */
export function summariseRun(run: HandCheckRun): HandCheckSummary {
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
  limits: {
    services: { id: string; priceInr: number; name: Record<Language, string> }[];
    depositInr: number; holdMinutes: number; windowHours: number; refundLimitInr: number;
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
    limits: {
      services: settings.services.map((s) => ({ id: s.id, priceInr: s.priceInr, name: Object.fromEntries(LANGUAGES.map((l) => [l, serviceName(s, l)])) as Record<Language, string> })),
      depositInr: settings.deposit.amountInr, holdMinutes: settings.deposit.holdMinutes,
      windowHours: settings.cancellation.windowHours, refundLimitInr: settings.cancellation.refundLimitInr,
    },
    policyDigest: policyDigest(settings),
    checkedPolicyDigest: handCheck.ranOn ?? checkedPolicyDigest(),
    anchor: null,
  };
}

const dateText = (d: LocalDate, language: Language): string => `${formatDate(d, language)} ${d.year}`;

/** The shop's limits in plain words, one phrase each, in the shop's language. */
export function limitLines(cert: GoLiveCertificate, language: Language): string[] {
  const c = STRINGS[language].cert;
  const l = cert.limits;
  const floor = l.services.map((s) => `${s.name[language]} ${formatInr(s.priceInr)}`).join(" · ");
  return [c.floor(floor), c.deposit(formatInr(l.depositInr), l.holdMinutes), c.cancel(l.windowHours), c.refund(formatInr(l.refundLimitInr)), c.hours];
}

const heldLine = (cert: GoLiveCertificate, language: Language): string => STRINGS[language].cert.held(cert.checks.held, cert.checks.total, cert.checks.failed, cert.notTested.length);
const verifyPath = (e: Envelope): string => `/verify/${e.code}`;

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
    `${cert.preparedBy ? `${s.page.setUpBy}: ${oneLine(cert.preparedBy)} · ` : ""}${s.page.agentVersion}: ${cert.pathway.name} ${cert.pathway.version} · ${s.page.code}: ${envelope.code} · ${verifyPath(envelope)}`,
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
${sealBlock(s, envelope, [[s.page.agentVersion, `${cert.pathway.name} ${cert.pathway.version}`], [s.cert.date, dateText(cert.issuedOn, language)], ...(cert.preparedBy ? [[s.page.setUpBy, cert.preparedBy] as [string, string]] : []),
  [s.page.limitsDigest, cert.policyDigest], [`${s.cert.checkedOn} (${s.page.limitsDigest})`, cert.checkedPolicyDigest]])}
</section>`;
}

export function goLivePage(envelope: Envelope<GoLiveCertificate>, language: ReportLanguage): string {
  const langs = languagesOf(language);
  return page(`${envelope.document.shop.name} · ${STRINGS[langs[0]].goLiveCertificate}`, langs[0], langs.map((l) => goLiveSection(envelope, l)));
}

// ---- the monthly record certificate --------------------------------------------------------------------------------------

export interface MonthlyCertificate {
  format: "geometer-monthly-certificate/1";
  pathway: { name: string; version: string };
  source: Source;
  shop: { name: string; timeZone: string };
  preparedBy: string | null;
  issuedAt: string;
  issuedOn: LocalDate;
  period: MonthlyReport["period"];
  /** What was counted from the record, copied from the report it was made from. */
  counted: { bookingsMade: number; cancelled: number; depositsPaise: number; refundsPaise: number; stopped: number; unconfirmedOpen: number; asked: number; approved: number; denied: number };
  /** The record the counts came from, and the sealed report that holds them all. */
  record: { entries: number; digest: string };
  report: { digest: string; code: string };
  policyDigest: string;
  notCounted: NotCountedId[];
  notTested: NotTestedKey[];
  /** What the report was told about the go-live checks, copied from it: none, untrusted, or what a go-live certificate that was read says they ran on. */
  goLive: GoLiveFinding;
  /** Copied from the report: present, and true, only when the report carries the Innovator badge. */
  innovator?: true;
  anchor: null;
}

export function buildMonthlyCertificate(report: Envelope<MonthlyReport>, issuedAt: number): MonthlyCertificate {
  const r = report.document;
  const day = localParts(issuedAt, r.shop.timeZone);
  return {
    format: "geometer-monthly-certificate/1",
    pathway: r.pathway,
    source: r.source,
    shop: { name: r.shop.name, timeZone: r.shop.timeZone },
    preparedBy: r.preparedBy,
    issuedAt: new Date(issuedAt).toISOString(),
    issuedOn: { year: day.year, month: day.month, day: day.day },
    period: r.period,
    counted: {
      bookingsMade: r.bookings.made, cancelled: r.bookings.cancelled, depositsPaise: r.money.deposits.paise, refundsPaise: r.money.refunds.paise, stopped: r.stopped.total,
      unconfirmedOpen: r.unconfirmed.openOnBookings, asked: r.owner.asked, approved: r.owner.approved, denied: r.owner.denied,
    },
    record: { entries: r.record.entries, digest: r.record.digest },
    report: { digest: report.digest, code: report.code },
    policyDigest: r.policyDigest,
    notCounted: [...r.notCounted],
    notTested: [...r.notTested],
    goLive: r.goLive,
    ...(r.innovator ? { innovator: true as const } : {}),
    anchor: null,
  };
}

/** The counted facts as "label: number" pairs, in the shop's words. */
function countedPairs(cert: MonthlyCertificate, language: Language): string[] {
  const s = STRINGS[language];
  const c = cert.counted;
  return [
    `${s.label.bookingsMade}: ${c.bookingsMade}`, `${s.label.cancelled}: ${c.cancelled}`, `${s.label.depositsCollected}: ${rupees(c.depositsPaise)}`, `${s.label.givenBack}: ${rupees(c.refundsPaise)}`,
    `${s.label.wasAsked}: ${c.asked}`, `${s.label.approved}: ${c.approved}`, `${s.label.saidNo}: ${c.denied}`, `${s.label.stoppedByLimits}: ${c.stopped}`, `${s.label.notConfirmed}: ${c.unconfirmedOpen}`,
  ];
}

export function monthlyCertificateText(envelope: Envelope<MonthlyCertificate>, language: Language): string {
  const s = STRINGS[language];
  const cert = envelope.document;
  const tag = s.sourceTag[cert.source];
  return [
    `${oneLine(cert.shop.name)} · ${s.agent} · ${s.monthlyCertificate} · ${periodLabel(cert.period, language)}${tag ? ` · ${tag}` : ""}`,
    `${s.cert.countedIntro(periodLabel(cert.period, language))} ${countedPairs(cert, language).join(" · ")}`,
    `${s.page.notCountedHeading}: ${cert.notCounted.map((id) => s.notCounted[id]).join(" · ")}`,
    `${s.label.notChecked}: ${cert.notTested.map((id) => s.notTested[id]).join(" · ")}`,
    goLiveLines(cert.goLive, language).join(" "),
    s.handRun,
    `${cert.preparedBy ? `${s.page.setUpBy}: ${oneLine(cert.preparedBy)} · ` : ""}${cert.innovator ? `${badgeText(language)} · ` : ""}${s.page.agentVersion}: ${cert.pathway.name} ${cert.pathway.version} · ${s.page.code}: ${envelope.code} · ${verifyPath(envelope)}`,
  ].join("\n");
}

export function monthlySection(envelope: Envelope<MonthlyCertificate>, language: Language): string {
  const s = STRINGS[language];
  const cert = envelope.document;
  const tag = s.sourceTag[cert.source];
  return `<section class="doc" lang="${language}">
<header class="head"><p class="kicker">${esc(s.agent)}</p><h1>${esc(cert.shop.name)}</h1><p class="period">${esc(s.monthlyCertificate)} · ${esc(periodLabel(cert.period, language))}</p>${tag ? `<p class="tag">${esc(tag)}</p>` : ""}${cert.innovator ? `<p class="badge">${esc(badgeText(language))}</p>` : ""}</header>
<p class="note">${esc(s.sourceLong[cert.source])} ${esc(s.handRun)}</p>
<h2>${esc(s.cert.countedIntro(periodLabel(cert.period, language)))}</h2>
${table([{ text: s.page.item }, { text: s.page.count, n: true }], countedPairs(cert, language).map((p) => { const i = p.lastIndexOf(": "); return [esc(p.slice(0, i)), esc(p.slice(i + 2))]; }))}
<h2>${esc(s.goLive.heading)}</h2>${goLiveBlock(cert.goLive, language)}
<div class="warn"><h2>${esc(s.page.notCountedHeading)}</h2>${list(cert.notCounted.map((id) => s.notCounted[id]))}<h2>${esc(s.page.notTestedHeading)}</h2>${list(cert.notTested.map((id) => s.notTested[id]))}</div>
<p class="small">${esc(s.page.notAGrade)}</p>
${sealBlock(s, envelope, [[s.page.agentVersion, `${cert.pathway.name} ${cert.pathway.version}`], [s.cert.date, dateText(cert.issuedOn, language)], ...(cert.preparedBy ? [[s.page.setUpBy, cert.preparedBy] as [string, string]] : []),
  [s.page.recordDigest, cert.record.digest], [`${s.monthlyReport} (${s.page.digest})`, cert.report.digest], [`${s.monthlyReport} (${s.page.code})`, cert.report.code], [s.page.limitsDigest, cert.policyDigest]])}
</section>`;
}

export function monthlyCertificatePage(envelope: Envelope<MonthlyCertificate>, language: ReportLanguage): string {
  const langs = languagesOf(language);
  return page(`${envelope.document.shop.name} · ${STRINGS[langs[0]].monthlyCertificate}`, langs[0], langs.map((l) => monthlySection(envelope, l)));
}
