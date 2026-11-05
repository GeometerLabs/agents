// The builder layer: a printable page, self-contained (one file, inline CSS, no script, no external font, image or link), built with the shared page frame
// (modules/report/page.ts). It shows the same numbers as the owner's text, a table per limit, and a "Show what we did" section with the counts by action and
// outcome and the digests. Every value that reaches the page is escaped; the centre's name comes from the settings file.
import { formatDate } from "../../../modules/language/format.ts";
import { localParts } from "../../../modules/core/time.ts";
import type { Language } from "../../../modules/language/languages.ts";
import { LANGUAGES } from "../../../modules/language/languages.ts";
import { esc, list, page, sealBlock, table } from "../../../modules/report/page.ts";
import type { Envelope } from "../../../modules/report/sign.ts";
import { badgeText, languagesOf, periodLabel, rupees } from "../../../modules/report/text.ts";
import type { ReportLanguage } from "../../../modules/report/text.ts";
import { RULE_IDS } from "./data.ts";
import type { FeesReport, GoLiveFinding } from "./data.ts";
import { STRINGS } from "./strings.ts";
import { goLiveLines } from "./text.ts";

/** What the page says about the go-live checks: a plain note when they ran on this centre's own settings, a warning in every other case. */
export function goLiveBlock(goLive: GoLiveFinding, language: Language): string {
  return `<div class="${goLive.status === "own" ? "note" : "warn"}">${goLiveLines(goLive, language).map((line) => `<p>${esc(line)}</p>`).join("")}</div>`;
}

/** One language's section of the report page. */
export function reportSection(envelope: Envelope<FeesReport>, language: Language): string {
  const s = STRINGS[language];
  const r = envelope.document;
  const p = s.page;
  const amount = (a: { count: number; paise: number }) => [String(a.count), esc(rupees(a.paise))];
  const made = localParts(Date.parse(r.madeAt), r.shop.timeZone);
  const madeOn = `${formatDate(made, language)} ${made.year}`;
  const source = s.sourceTag[r.source] || p.liveServices;

  const numbers = table([{ text: p.item }, { text: p.count, n: true }, { text: p.amount, n: true }], [
    [esc(s.label.collected), ...amount(r.money.collected)],
    [esc(s.label.givenBack), ...amount(r.money.givenBack)],
    [esc(p.opened), String(r.fees.opened), ""],
    [esc(p.paidInFull), String(r.fees.paidInFull), ""],
    [esc(p.partlyPaid), String(r.fees.partlyPaid), ""],
    [esc(s.label.stillToCollect), ...amount(r.fees.stillToCollect)],
    [esc(p.byOwner), ...amount(r.waivers.byOwner)],
    [esc(p.withinLimit), ...amount(r.waivers.withinLimit)],
    [esc(p.lateFeesAdded), ...amount(r.waivers.lateFeesAdded)],
    [esc(s.label.wasAsked), String(r.owner.asked), ""],
    [esc(s.label.approved), String(r.owner.approved), ""],
    [esc(s.label.saidNo), String(r.owner.denied), ""],
    [esc(p.stoppedParents), String(r.parents.stopped), ""],
  ]);
  const rules = table([{ text: p.rule }, { text: p.times, n: true }], RULE_IDS.map((id) => [`${esc(s.stop[id])} <code>${esc(id)}</code>`, String(r.stopped.byRule[id])]));
  const messages = table([{ text: p.item }, { text: p.count, n: true }, ...LANGUAGES.map((l) => ({ text: s.languageName[l], n: true }))], [
    [esc(p.remindersToParents), String(r.reminders.sent), ...LANGUAGES.map((l) => String(r.reminders.byLanguage[l]))],
    [esc(p.receiptsToParents), String(r.reminders.receipts), ...LANGUAGES.map(() => "")],
    [esc(p.toYou), String(r.messages.toOwner), ...LANGUAGES.map(() => "")],
    [esc(p.heldBack), String(r.messages.heldBack), ...LANGUAGES.map(() => "")],
  ]);
  const actions = Object.keys(r.record.byAction).sort();
  const outcomes = [...new Set(actions.flatMap((a) => Object.keys(r.record.byAction[a])))].sort();
  const byAction = table([{ text: p.action }, ...outcomes.map((o) => ({ text: o, n: true }))], actions.map((a) => [`<code>${esc(a)}</code>`, ...outcomes.map((o) => String(r.record.byAction[a][o] ?? ""))]));

  return `<section class="doc" lang="${language}">
<header class="head"><p class="kicker">${esc(s.agent)} · ${esc(s.monthlyReport)}</p><h1>${esc(r.shop.name)}</h1><p class="period">${esc(periodLabel(r.period, language))}</p>${s.sourceTag[r.source] ? `<p class="tag">${esc(s.sourceTag[r.source])}</p>` : ""}${r.innovator ? `<p class="badge">${esc(badgeText(language))}</p>` : ""}</header>
<p class="note">${esc(s.handRun)}</p>
<div class="cards">
<div class="card"><b>${esc(rupees(r.money.collected.paise))}</b><span>${esc(s.label.collected)}</span></div>
<div class="card"><b>${esc(rupees(r.fees.stillToCollect.paise))}</b><span>${esc(s.label.stillToCollect)}</span></div>
<div class="card"><b>${esc(rupees(r.waivers.total.paise))}</b><span>${esc(s.label.takenOff)}</span></div>
<div class="card"><b>${r.reminders.sent}</b><span>${esc(s.label.remindersSent)}</span></div>
</div>
<h2>${esc(p.numbers)}</h2>${numbers}
<h2>${esc(p.stoppedHeading)}</h2>${rules}
<h2>${esc(p.messagesHeading)}</h2>${messages}
<dl><dt>${esc(p.unconfirmed)}</dt><dd>${r.unconfirmed.open}</dd></dl>
<h2>${esc(s.goLive.heading)}</h2>${goLiveBlock(r.goLive, language)}
<div class="warn"><h2>${esc(p.notCountedHeading)}</h2>${list(r.notCounted.map((id) => s.notCounted[id]))}<h2>${esc(p.notTestedHeading)}</h2>${list(r.notTested.map((id) => s.notTested[id]))}</div>
<p class="small">${esc(p.notAGrade)}</p>
${sealBlock(s.page, envelope, [[p.countedFrom, source], [p.period, periodLabel(r.period, language)], [p.agentVersion, `${r.pathway.name} ${r.pathway.version}`], [p.madeOn, madeOn], ...(r.preparedBy ? [[p.setUpBy, r.preparedBy] as [string, string]] : []), [p.limitsDigest, r.policyDigest], [p.recordDigest, r.record.digest]])}
<details><summary>${esc(p.showWhatWeDid)}</summary>
<h2>${esc(p.byActionHeading)}</h2>${byAction}
</details>
</section>`;
}

/** The report page for one language, or Hindi and English together. */
export function reportPage(envelope: Envelope<FeesReport>, language: ReportLanguage): string {
  const langs = languagesOf(language);
  return page(`${envelope.document.shop.name} · ${STRINGS[langs[0]].monthlyReport}`, langs[0], langs.map((l) => reportSection(envelope, l)));
}
