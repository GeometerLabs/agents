// The builder layer: a printable page, self-contained (one file, inline CSS, no script, no external font, image or link), built with the shared page frame
// (modules/report/page.ts). It shows the same numbers as the owner's text, a table per supplier, the month's budget, what the limits stopped, and a "Show what we did" section
// with the counts by action and outcome and the digests. Every value that reaches the page is escaped; the shop's name and its suppliers' names come from the settings file.
// The owner's own "marked as paid" note has a row only when there is one: this agent pays no one.
import { formatDate } from "../../../../modules/language/format.ts";
import { localParts } from "../../../../modules/core/time.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import { esc, fig, list, page, sealBlock, table } from "../../../../modules/report/page.ts";
import type { Envelope } from "../../../../modules/report/sign.ts";
import { badgeText, languagesOf, periodLabel, rupees } from "../../../../modules/report/text.ts";
import type { ReportLanguage } from "../../../../modules/report/text.ts";
import { RULE_IDS } from "./data.ts";
import type { GoLiveFinding, StockReport } from "./data.ts";
import { STRINGS } from "./strings.ts";
import { goLiveLines } from "./text.ts";

/** What the page says about the go-live checks: a plain note when they ran on this shop's own settings, a warning in every other case. */
export function goLiveBlock(goLive: GoLiveFinding, language: Language): string {
  return `<div class="${goLive.status === "own" ? "note" : "warn"}">${goLiveLines(goLive, language).map((line) => `<p>${esc(line)}</p>`).join("")}</div>`;
}

/** One language's section of the report page. `check` is the report's signed summary link (report/run.ts), left out for a report that is not signed. */
export function reportSection(envelope: Envelope<StockReport>, language: Language, check?: string): string {
  const s = STRINGS[language];
  const r = envelope.document;
  const p = s.page;
  const o = r.orders;
  const made = localParts(Date.parse(r.madeAt), r.shop.timeZone);
  const madeOn = `${formatDate(made, language)} ${made.year}`;
  const source = s.sourceTag[r.source] || p.liveServices;

  const orders = table([{ text: p.item }, { text: p.count, n: true }], [
    [esc(s.label.placed), fig(o.placed)],
    [esc(s.label.acknowledged), fig(o.acknowledged)],
    [esc(s.label.receivedFull), fig(o.receivedFull)],
    [esc(s.label.partReceived), fig(o.partReceived)],
    [esc(s.label.wrongItem), fig(o.wrongItem)],
    [esc(s.label.supplierSaidNo), fig(o.declinedBySupplier)],
    [esc(s.label.noAnswer), fig(o.silent)],
    [esc(s.label.neverSent), fig(o.neverSent)],
    [esc(s.label.asked), fig(r.owner.asked)],
    [esc(s.label.approved), fig(r.owner.approved)],
    [esc(s.label.saidNo), fig(r.owner.saidNo)],
  ]);
  const budget = table([{ text: p.item }, { text: p.count, n: true }, { text: p.amount, n: true }], [
    [esc(p.monthlyBudget), "", fig(rupees(r.budget.monthlyPaise))],
    [esc(s.label.budgetUsed), "", fig(rupees(r.budget.usedPaise))],
    [esc(s.label.budgetLeft), "", fig(rupees(r.budget.leftPaise))],
  ]);
  // the owner's own note, shown only when there is one (the agent pays no one and cannot check it)
  const ownersNote = r.markedPaidByOwner.orders > 0 ? `<h2>${esc(p.ownersNoteHeading)}</h2>${table([{ text: p.item }, { text: p.count, n: true }], [[esc(s.label.markedPaid), fig(r.markedPaidByOwner.orders)]])}` : "";
  const suppliers = r.suppliers.length > 0
    ? table([{ text: p.supplier }, { text: s.label.placed, n: true }, { text: s.label.acknowledged, n: true }, { text: s.label.receivedFull, n: true }, { text: s.label.partReceived, n: true }, { text: s.label.wrongItem, n: true }, { text: s.label.supplierSaidNo, n: true }, { text: s.label.noAnswer, n: true }],
      r.suppliers.map((x) => [esc(x.name), fig(x.placed), fig(x.acknowledged), fig(x.receivedFull), fig(x.partReceived), fig(x.wrongItem), fig(x.declined), fig(x.silent)]))
    : "";
  const rules = table([{ text: p.rule }, { text: p.times, n: true }], RULE_IDS.map((id) => [`${esc(s.stop[id])} <code>${esc(id)}</code>`, String(r.stopped.byRule[id])]));
  const actions = Object.keys(r.record.byAction).sort();
  const outcomes = [...new Set(actions.flatMap((a) => Object.keys(r.record.byAction[a])))].sort();
  const byAction = table([{ text: p.action }, ...outcomes.map((x) => ({ text: x, n: true }))], actions.map((a) => [`<code>${esc(a)}</code>`, ...outcomes.map((x) => String(r.record.byAction[a][x] ?? ""))]));

  return `<section class="doc" lang="${language}">
<header class="head"><p class="kicker">${esc(s.agent)} · ${esc(s.monthlyReport)}</p><h1>${esc(r.shop.name)}</h1><p class="period">${esc(periodLabel(r.period, language))}</p>${s.sourceTag[r.source] ? `<p class="tag">${esc(s.sourceTag[r.source])}</p>` : ""}${r.innovator ? `<p class="badge">${esc(badgeText(language))}</p>` : ""}</header>
<p class="note">${esc(s.handRun)}</p>
<div class="cards">
<div class="card"><strong class="hi">${o.placed}</strong><span>${esc(s.label.placed)}</span></div>
<div class="card"><strong>${o.receivedFull}</strong><span>${esc(s.label.receivedFull)}</span></div>
<div class="card"><strong>${esc(rupees(r.budget.usedPaise))}</strong><span>${esc(s.label.budgetUsed)}</span></div>
<div class="card"><strong>${o.silent}</strong><span>${esc(s.label.noAnswer)}</span></div>
</div>
<h2>${esc(p.ordersHeading)}</h2>${orders}
${suppliers ? `<h2>${esc(p.suppliersHeading)}</h2>${suppliers}` : ""}
<h2>${esc(p.budgetHeading)}</h2>${budget}
${ownersNote}
<h2>${esc(p.stoppedHeading)}</h2>${rules}
<dl><dt>${esc(p.unconfirmed)}</dt><dd>${r.unconfirmed.open}</dd></dl>
<h2>${esc(s.goLive.heading)}</h2>${goLiveBlock(r.goLive, language)}
<div class="warn"><h2>${esc(p.notCountedHeading)}</h2>${list(r.notCounted.map((id) => s.notCounted[id]))}<h2>${esc(p.notTestedHeading)}</h2>${list(r.notTested.map((id) => s.notTested[id]))}</div>
<p class="note">${esc(s.promise)}</p>
<p class="small">${esc(p.notAGrade)}</p>
${sealBlock(s.page, envelope, [[p.countedFrom, source], [p.period, periodLabel(r.period, language)], [p.agentVersion, `${r.pathway.name} ${r.pathway.version}`], [p.madeOn, madeOn], ...(r.preparedBy ? [[p.setUpBy, r.preparedBy] as [string, string]] : []), [p.limitsDigest, r.policyDigest], [p.recordDigest, r.record.digest]], check)}
<p class="small">${esc(s.helpLine)}</p>
<details><summary>${esc(p.showWhatWeDid)}</summary>
<h2>${esc(p.byActionHeading)}</h2>${byAction}
</details>
</section>`;
}

/** The report page for one language, or Hindi and English together. */
export function reportPage(envelope: Envelope<StockReport>, language: ReportLanguage, check?: string): string {
  const langs = languagesOf(language);
  return page(`${envelope.document.shop.name} · ${STRINGS[langs[0]].monthlyReport}`, langs[0], langs.map((l) => reportSection(envelope, l, check)));
}
