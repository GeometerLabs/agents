// The go-live certificate of an agent someone else wrote: what the crash test found, on the agent's own settings, in the same document format the templates' go-live certificate has
// (format `geometer-go-live-certificate/1`), so the monthly report reads it the same way (pathways/bookings/report/go-live.ts: it must be signed, and its checks must have run on the
// settings the report is for). It is made with the shared sealing and page code (modules/report) and the English words of the template's certificate. What differs from the template's
// builder (pathways/bookings/report/certificate.ts) is only what is true of the template: its list of what was not tested is Bookings' fixed list of ids in four languages, its limits are a
// salon's (a cancel window, a hold on the slot), and its pathway is the bookings pathway. Here the not-tested list is this crash test's own, in words, and the limits are the ones Guard enforces.
import type { KeyObject } from "node:crypto";
import { localParts } from "../../../modules/core/time.ts";
import type { LocalDate } from "../../../modules/core/time.ts";
import { formatDate, formatInr } from "../../../modules/language/format.ts";
import { writer } from "../../../modules/report/months.ts";
import { esc, list, page, sealBlock } from "../../../modules/report/page.ts";
import { envelopeFile, seal } from "../../../modules/report/sign.ts";
import type { Envelope } from "../../../modules/report/sign.ts";
import { oneLine } from "../../../modules/report/text.ts";
import { policyDigest } from "../../../pathways/bookings/report/data.ts";
import { STRINGS } from "../../../pathways/bookings/report/strings.ts";
import type { Settings } from "../../../pathways/bookings/src/settings.ts";
import type { CrashResult } from "./run.ts";

export const UNVERSIONED = "unversioned";

export interface AgentCertificate {
  format: "geometer-go-live-certificate/1";
  /** `name` is `own-agent`; `version` is the agent's own version (a git commit, an image tag), or "unversioned". */
  pathway: { name: "own-agent"; version: string };
  source: "stand-in";
  ranAs: { how: "crash-test"; against: "stand-in services behind the real Guard" };
  shop: { name: string; timeZone: string };
  agent: { name: string };
  preparedBy: string | null;
  issuedAt: string;
  issuedOn: LocalDate;
  checks: { held: number; total: number; failed: number; failedTitles: string[]; checks: number; notRun?: string[] };
  /** In words, as the crash test said them. */
  notTested: string[];
  limits: { depositInr: number; refundLimitInr: number; services: { id: string; priceInr: number }[] };
  /** The settings the checks ran on, and the settings this certificate is for. The same here: the crash test always runs on the agent's own settings. */
  policyDigest: string;
  checkedPolicyDigest: string;
  anchor: null;
}

export interface CertificateInput { settings: Settings; agent: string; result: CrashResult; issuedAt: number; preparedBy?: string }

export function buildAgentCertificate(input: CertificateInput): AgentCertificate {
  const { settings, result } = input;
  const day = localParts(input.issuedAt, settings.timezone);
  const digest = policyDigest(settings);
  return {
    format: "geometer-go-live-certificate/1",
    pathway: { name: "own-agent", version: result.version ?? UNVERSIONED },
    source: "stand-in",
    ranAs: { how: "crash-test", against: "stand-in services behind the real Guard" },
    shop: { name: settings.name, timeZone: settings.timezone },
    agent: { name: input.agent },
    preparedBy: input.preparedBy ?? null,
    issuedAt: new Date(input.issuedAt).toISOString(),
    issuedOn: { year: day.year, month: day.month, day: day.day },
    checks: {
      held: result.held, total: result.total, failed: result.failed, failedTitles: result.situations.filter((s) => !s.held).map((s) => s.title),
      checks: result.situations.reduce((n, s) => n + s.checks.length, 0), ...(result.notRun.length > 0 ? { notRun: result.notRun.map((s) => s.title) } : {}),
    },
    notTested: result.notTested,
    limits: { depositInr: settings.deposit.amountInr, refundLimitInr: settings.cancellation.refundLimitInr, services: settings.services.map((s) => ({ id: s.id, priceInr: s.priceInr })) },
    policyDigest: digest,
    checkedPolicyDigest: digest,
    anchor: null,
  };
}

const en = STRINGS.en;
const dateText = (d: LocalDate) => `${formatDate(d, "en")} ${d.year}`;
const heldLine = (c: AgentCertificate) => en.cert.held(c.checks.held, c.checks.total, c.checks.failed, c.notTested.length);
const INTRO = "Before going live, your agent was run through situations that could go wrong: lost replies after a payment link and a refund, a payment event delivered twice and late, a calendar that saves nothing, an expired key, refunds above the limit and above what was paid, the same WhatsApp message twice, and a customer asking for a price below the floor.";
const RAN_AS = "Run by hand against stand-in services (Razorpay, Google Calendar and WhatsApp), with your agent's real Guards in front of them. Not real WhatsApp, payments or a calendar. Test money only.";

/** What Guard enforces for this agent, in a line each: only what is true of an agent we did not write (Guard has no rule for prices or opening hours). */
const limitLines = (c: AgentCertificate): string[] => [
  `A payment link only for the deposit, ${formatInr(c.limits.depositInr)}`,
  `Refunds of at most one deposit, and above ${formatInr(c.limits.refundLimitInr)} only with the owner's OK`,
  "No payouts, a calendar event only on the shop's own calendar, a message only from the shop's own number",
];

/** The short text, ready to paste into WhatsApp: a handful of lines. */
export function agentCertificateText(envelope: Envelope<AgentCertificate>): string {
  const cert = envelope.document;
  return [
    `${oneLine(cert.shop.name)} · ${en.agent} · ${en.goLiveCertificate} · ${dateText(cert.issuedOn)}`,
    heldLine(cert),
    ...(cert.checks.failed > 0 ? [`${en.cert.didNotHold}: ${cert.checks.failedTitles.join("; ")}`] : []),
    `${en.cert.yourLimits}:`,
    ...limitLines(cert).map((line) => `• ${line}`),
    `${en.label.notChecked}: ${cert.notTested.join(" · ")}`,
    RAN_AS,
    `${cert.preparedBy ? `${en.page.setUpBy}: ${oneLine(cert.preparedBy)} · ` : ""}${en.page.agentVersion}: ${cert.pathway.name} ${cert.pathway.version} · ${en.page.code}: ${envelope.code} · /verify/${envelope.code}`,
  ].join("\n");
}

export function agentCertificatePage(envelope: Envelope<AgentCertificate>): string {
  const cert = envelope.document;
  const section = `<section class="doc" lang="en">
<header class="head"><p class="kicker">${esc(en.agent)}</p><h1>${esc(cert.shop.name)}</h1><p class="period">${esc(en.goLiveCertificate)} · ${esc(dateText(cert.issuedOn))}</p><p class="tag">${esc(en.sourceTag["stand-in"])}</p></header>
<div class="cards">
<div class="card"><b>${cert.checks.held} / ${cert.checks.total}</b><span>${esc(heldLine(cert))}</span></div>
</div>
<p>${esc(INTRO)}</p>
${cert.checks.failed > 0 ? `<div class="warn"><h2>${esc(en.cert.didNotHold)}</h2>${list(cert.checks.failedTitles)}</div>` : ""}
<h2>${esc(en.cert.yourLimits)}</h2>${list(limitLines(cert))}
<p class="note">${esc(RAN_AS)}</p>
<div class="warn"><h2>${esc(en.page.notTestedHeading)}</h2>${list(cert.notTested)}</div>
<p class="small">${esc(en.cert.notAGrade)}</p>
${sealBlock(en.page, envelope, [[en.page.agentVersion, `${cert.pathway.name} ${cert.pathway.version}`], [en.cert.date, dateText(cert.issuedOn)], ...(cert.preparedBy ? [[en.page.setUpBy, cert.preparedBy] as [string, string]] : []),
  [en.page.limitsDigest, cert.policyDigest], [`${en.cert.checkedOn} (${en.page.limitsDigest})`, cert.checkedPolicyDigest]])}
</section>`;
  return page(`${cert.shop.name} · ${en.goLiveCertificate}`, "en", [section]);
}

/** The certificate's files (signed data, page, short text) in one folder. Signed when a key is given, and then the monthly report can use it (an unsigned one is read as untrusted). */
export function writeAgentCertificate(o: CertificateInput & { out: string; key?: KeyObject }): { files: string[]; code: string; text: string; envelope: Envelope<AgentCertificate> } {
  const envelope = seal(buildAgentCertificate(o), o.key);
  const w = writer(o.out);
  w.write("go-live-certificate.json", envelopeFile(envelope));
  w.write("go-live-certificate-en.html", agentCertificatePage(envelope));
  const text = agentCertificateText(envelope);
  w.write("go-live-certificate-en.txt", `${text}\n`);
  return { files: w.files, code: envelope.code, text, envelope };
}
