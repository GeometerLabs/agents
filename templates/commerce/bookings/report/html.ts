// The builder layer: a printable page, self-contained (one file, inline CSS, no script, no external font, image or link),
// green and white with amber for what was not tested. It shows the same numbers as the owner's text, a table per limit,
// and a "Show what we did ▸" section with the counts by action and outcome, the record's entries (fingerprints only) and
// the digests. Every value that reaches the page is escaped; shop and service names come from the settings file.
import { formatDate } from "../../../../modules/language/format.ts";
import { localParts } from "../../../../modules/core/time.ts";
const two = (n: number) => String(n).padStart(2, "0");
import { RULE_IDS } from "./data.ts";
import type { GoLiveFinding, MonthlyReport } from "./data.ts";
import type { Envelope } from "../../../../modules/report/sign.ts";
import { STRINGS, moneyLabels } from "./strings.ts";
import { badgeText } from "../../../../modules/report/text.ts";
import type { Strings } from "./strings.ts";
import { goLiveLines } from "./text.ts";
import { languagesOf, periodLabel, rupees } from "../../../../modules/report/text.ts";
import type { ReportLanguage } from "../../../../modules/report/text.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import { esc, list, page, sealBlock as sharedSealBlock, table } from "../../../../modules/report/page.ts";

/** The verification block (modules/report/page.ts) with this template's words; `check` is the paper's signed summary link, when it is signed. */
export const sealBlock = (s: Strings, envelope: Envelope, extra: [string, string][] = [], check?: string): string => sharedSealBlock(s.page, envelope, extra, check);

/** The go-live checks, in sentences: green when a go-live certificate shows they ran on this shop's own settings, amber for everything else. */
export function goLiveBlock(goLive: GoLiveFinding, language: Language): string {
  return `<div class="${goLive.status === "own" ? "note" : "warn"}">${goLiveLines(goLive, language).map((line) => `<p>${esc(line)}</p>`).join("")}</div>`;
}

/** Micro-rupees (1,000,000 = ₹1) as rupees to the paisa, rounded up, so a small cost shows as it is and never as 0. */
const costText = (micro: number): string => rupees(Math.ceil(micro / 10_000));

/**
 * The month's work and what it cost (plan B75): completed, abandoned and unresolved side by side, the cost beside them, and what each word means on the page itself.
 * The cost per completed job is shown only when the report has one; otherwise the page says why there is none (nothing completed, or the cost is not known).
 */
export function workBlock(r: MonthlyReport, s: Strings): string {
  const w = r.work;
  if (!w) return ""; // a report made before the work block existed has none, and is shown as it was
  const k = s.work;
  const unit = w.costPerCompletedMicroInr !== null ? costText(w.costPerCompletedMicroInr) : w.noUnitCost === "no-completed-jobs" ? k.noCompleted : k.noCost;
  const rows: [string, string][] = [
    [k.jobs, String(w.jobs)], [k.completed, String(w.completed)], [k.abandoned, String(w.abandoned)], [k.unresolved, String(w.unresolved)],
    ...(w.settledByPerson > 0 ? [[k.settledByPerson, String(w.settledByPerson)] as [string, string]] : []),
    [k.cost, w.costMicroInr !== null ? costText(w.costMicroInr) : k.costUnknown], [k.unitCost, unit],
  ];
  return `<h2>${esc(k.heading)}</h2>${table([{ text: s.page.item }, { text: s.page.count, n: true }], rows.map(([a, b]) => [esc(a), esc(b)]))}
${w.costBasis ? `<p class="small">${esc(w.costBasis)}</p>` : ""}
<ul class="small"><li>${esc(k.completedMeans)}</li><li>${esc(k.abandonedMeans)}</li><li>${esc(k.unresolvedMeans)}</li><li>${esc(k.abandonedNeverClears)}</li></ul>`;
}

/** One language's section of the report page. `check` is the report's signed summary link (report/run.ts), left out for a report that is not signed. */
export function reportSection(envelope: Envelope<MonthlyReport>, language: Language, check?: string): string {
  const s = STRINGS[language];
  const r = envelope.document;
  const p = s.page;
  const amount = (a: { count: number; paise: number }) => [String(a.count), esc(rupees(a.paise))];
  const made = localParts(Date.parse(r.madeAt), r.shop.timeZone);
  const madeOn = `${formatDate(made, language)} ${made.year}`;

  const numbers = table([{ text: p.item }, { text: p.count, n: true }, { text: p.amount, n: true }], [
    [esc(s.label.bookingsMade), String(r.bookings.made), ""],
    [esc(s.label.cancelled), String(r.bookings.cancelled), ""],
    [esc(s.label.moved), String(r.bookings.moved), ""],
    [esc(p.droppedBeforeBooked), String(r.bookings.droppedBeforeBooked), ""],
    [esc(moneyLabels(language, r.paidBy).deposits), ...amount(r.money.deposits)],
    [esc(moneyLabels(language, r.paidBy).givenBack), ...amount(r.money.refunds)],
    [esc(p.givenBackDeposits), ...amount(r.money.refunds.ofDeposits)],
    [esc(p.givenBackSecond), ...amount(r.money.refunds.ofSecondPayments)],
    // refunds a person settled by their word (B75): one row per person, never counted in the refunds above
    ...(r.money.settledByWord ?? []).map((w) => [`${esc(s.work.refundsByPerson)}: ${esc(w.by)}`, ...amount(w)]),
    [esc(s.label.wasAsked), String(r.owner.asked), ""],
    [esc(s.label.approved), String(r.owner.approved), ""],
    [esc(s.label.saidNo), String(r.owner.denied), ""],
    [esc(p.retried), String(r.owner.retried), ""],
  ]);
  const rules = table([{ text: p.rule }, { text: p.times, n: true }], RULE_IDS.map((id) => [`${esc(s.stop[id])} <code>${esc(id)}</code>`, String(r.stopped.byRule[id])]));
  const languages = (["hi", "en", "ml", "kn"] as const);
  const messages = table([{ text: p.item }, { text: p.count, n: true }, ...languages.map((l) => ({ text: s.languageName[l], n: true }))], [
    [esc(p.toCustomers), String(r.messages.toCustomers.total), ...languages.map((l) => String(r.messages.toCustomers.byLanguage[l]))],
    [esc(p.toYou), String(r.messages.toOwner.total), ...languages.map((l) => String(r.messages.toOwner.byLanguage[l]))],
    [esc(p.heldBack), String(r.messages.heldBack), ...languages.map(() => "")],
  ]);
  const unconfirmed = r.unconfirmed.rows.length === 0 ? `<p>${esc(p.nothing)}</p>`
    : table([{ text: p.colNo, n: true }, { text: p.colAction }, { text: p.colOutcome }, { text: p.colBooking }, { text: p.stillOpen }],
      r.unconfirmed.rows.map((x) => [String(x.seq), `<code>${esc(x.action)}</code>`, `<code>${esc(x.outcome)}</code>`, esc(x.booking ?? "–"), esc(x.settledLater ? p.settledLater : p.stillOpen)]));
  const missing = ([[p.missingDepositAmounts, r.missing.depositAmounts], [p.missingRefundAmounts, r.missing.refundAmounts], [p.missingOwnerCommands, r.missing.ownerCommands], [p.missingMessageTargets, r.missing.messageTargets]] as [string, number][])
    .filter(([, n]) => n > 0);

  const actions = Object.keys(r.record.byAction).sort();
  const outcomes = [...new Set(actions.flatMap((a) => Object.keys(r.record.byAction[a])))].sort();
  const byAction = table([{ text: p.colAction }, ...outcomes.map((o) => ({ text: o, n: true }))], actions.map((a) => [`<code>${esc(a)}</code>`, ...outcomes.map((o) => String(r.record.byAction[a][o] ?? ""))]));
  const entries = table([{ text: p.colNo, n: true }, { text: `${p.colTime} (${r.shop.timeZone})` }, { text: p.colAction }, { text: p.colOutcome }, { text: p.colBooking }, { text: p.colFingerprint }],
    r.record.rows.map((x) => { const t = localParts(Date.parse(x.time), r.shop.timeZone); return [String(x.seq), esc(`${t.year}-${two(t.month)}-${two(t.day)} ${two(t.hour)}:${two(t.minute)}`), `<code>${esc(x.action)}</code>`, `<code>${esc(x.outcome)}</code>`, esc(x.booking ?? "–"), `<code>${esc(x.digest.slice(7, 23))}</code>`]; }));

  return `<section class="doc" lang="${language}">
<header class="head"><p class="kicker">${esc(s.agent)} · ${esc(s.monthlyReport)}</p><h1>${esc(r.shop.name)}</h1><p class="period">${esc(periodLabel(r.period, language))}</p>${s.sourceTag[r.source] ? `<p class="tag">${esc(s.sourceTag[r.source])}</p>` : ""}${r.innovator ? `<p class="badge">${esc(badgeText(language))}</p>` : ""}</header>
<p class="note">${esc(s.sourceLong[r.source])} ${esc(s.handRun)}</p>
<div class="cards">
<div class="card"><b>${r.bookings.made}</b><span>${esc(s.label.bookingsMade)}</span></div>
<div class="card"><b>${esc(rupees(r.money.deposits.paise))}</b><span>${esc(moneyLabels(language, r.paidBy).deposits)}</span></div>
<div class="card"><b>${esc(rupees(r.money.refunds.paise))}</b><span>${esc(moneyLabels(language, r.paidBy).givenBack)}</span></div>
<div class="card"><b>${r.stopped.total}</b><span>${esc(s.label.stoppedByLimits)}</span></div>
</div>
<h2>${esc(p.numbers)}</h2>${numbers}
${workBlock(r, s)}
<h2>${esc(p.stoppedHeading)}</h2>${rules}<p class="small">${esc(p.stoppedNote)}</p>
<h2>${esc(p.messagesHeading)}</h2>${messages}
<h2>${esc(p.unconfirmedHeading)}</h2>${unconfirmed}
<dl><dt>${esc(p.waitingNow)}</dt><dd>${r.atReportTime.waitingForOwner}</dd><dt>${esc(p.paidNotBooked)}</dt><dd>${r.atReportTime.paidNotBooked}</dd></dl>
${missing.length > 0 ? `<div class="warn"><p><b>${esc(p.missingHeading)}</b></p><ul>${missing.map(([label, n]) => `<li>${esc(label)}: ${n}</li>`).join("")}</ul></div>` : ""}
<h2>${esc(s.goLive.heading)}</h2>${goLiveBlock(r.goLive, language)}
<div class="warn"><h2>${esc(p.notCountedHeading)}</h2>${list(r.notCounted.map((id) => s.notCounted[id]))}<h2>${esc(p.notTestedHeading)}</h2>${list(r.notTested.map((id) => s.notTested[id]))}</div>
<p class="small">${esc(p.notAGrade)}</p>
${sealBlock(s, envelope, [[p.countedFrom, s.sourceTag[r.source] || s.sourceLong[r.source]], [p.period, periodLabel(r.period, language)], [p.agentVersion, `${r.pathway.name} ${r.pathway.version}`], [p.madeOn, madeOn], ...(r.preparedBy ? [[p.setUpBy, r.preparedBy] as [string, string]] : []), [p.limitsDigest, r.policyDigest], [p.recordDigest, r.record.digest]], check)}
<details><summary>${esc(p.showWhatWeDid)}</summary>
<h2>${esc(p.byActionHeading)}</h2>${byAction}
<h2>${esc(p.entriesHeading)}</h2>${entries}
</details>
</section>`;
}

/** The report page for one language, or Hindi and English together. */
export function reportPage(envelope: Envelope<MonthlyReport>, language: ReportLanguage, check?: string): string {
  const langs = languagesOf(language);
  return page(`${envelope.document.shop.name} · ${STRINGS[langs[0]].monthlyReport}`, langs[0], langs.map((l) => reportSection(envelope, l, check)));
}
