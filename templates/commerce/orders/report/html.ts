// The builder layer: a printable page, self-contained (one file, inline CSS, no script, no external font, image or link), built with the shared page frame
// (modules/report/page.ts). It shows the same numbers as the owner's text, a table per limit, and a "Show what we did" section with the counts by action and
// outcome and the digests. Every value that reaches the page is escaped; the shop's name comes from the settings file.
import { formatDate } from "../../../../modules/language/format.ts";
import { localParts } from "../../../../modules/core/time.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import { esc, list, page, sealBlock, table } from "../../../../modules/report/page.ts";
import type { Envelope } from "../../../../modules/report/sign.ts";
import { badgeText, languagesOf, periodLabel, rupees } from "../../../../modules/report/text.ts";
import type { ReportLanguage } from "../../../../modules/report/text.ts";
import { RULE_IDS } from "./data.ts";
import type { OrdersReport, GoLiveFinding } from "./data.ts";
import { STRINGS, moneyLabels } from "./strings.ts";
import { goLiveLines } from "./text.ts";

/** What the page says about the go-live checks: a plain note when they ran on this shop's own settings, a warning in every other case. */
export function goLiveBlock(goLive: GoLiveFinding, language: Language): string {
  return `<div class="${goLive.status === "own" ? "note" : "warn"}">${goLiveLines(goLive, language).map((line) => `<p>${esc(line)}</p>`).join("")}</div>`;
}

/** One language's section of the report page. */
/** One language's section of the report page. `check` is the report's signed summary link (report/run.ts), left out for a report that is not signed. */
export function reportSection(envelope: Envelope<OrdersReport>, language: Language, check?: string): string {
  const s = STRINGS[language];
  const r = envelope.document;
  const p = s.page;
  const amount = (a: { count: number; paise: number }) => [String(a.count), esc(rupees(a.paise))];
  const made = localParts(Date.parse(r.madeAt), r.shop.timeZone);
  const madeOn = `${formatDate(made, language)} ${made.year}`;
  const source = s.sourceTag[r.source] || p.liveServices;
  const labels = moneyLabels(language, r.paidBy);

  const numbers = table([{ text: p.item }, { text: p.count, n: true }, { text: p.amount, n: true }], [
    [esc(labels.collected), ...amount(r.money.collected)],
    [esc(labels.givenBack), ...amount(r.money.givenBack)],
    [esc(p.ordersTaken), String(r.orders.taken), ""],
    [esc(p.ordersCompleted), String(r.orders.completed), ""],
    [esc(p.ordersCancelled), String(r.orders.cancelled), ""],
    [esc(p.holdsRanOut), String(r.orders.holdsRanOut), ""],
    [esc(s.label.wasAsked), String(r.owner.asked), ""],
    [esc(s.label.approved), String(r.owner.approved), ""],
    [esc(s.label.saidNo), String(r.owner.denied), ""],
    [esc(p.stoppedCustomers), String(r.customers.stopped), ""],
  ]);
  const sold = table([{ text: p.item }, { text: p.count, n: true }, { text: p.amount, n: true }], [
    [esc(p.soldOrders), String(r.sold.orders), ""],
    [esc(p.pickup), String(r.sold.pickup), ""],
    [esc(p.delivery), String(r.sold.delivery), ""],
    [esc(s.label.stillToCollect), ...amount(r.sold.toCollect)],
  ]);
  const items = r.sold.items.length > 0
    ? table([{ text: p.itemsSold }, { text: p.count, n: true }], r.sold.items.map((i) => [esc(i.names[language]), String(i.qty)]))
    : `<p>${esc(p.itemsSold)}: ${esc(p.noItems)}</p>`;
  const rules = table([{ text: p.rule }, { text: p.times, n: true }], RULE_IDS.map((id) => [`${esc(s.stop[id])} <code>${esc(id)}</code>`, String(r.stopped.byRule[id])]));
  const messages = table([{ text: p.item }, { text: p.count, n: true }], [
    [esc(p.toYou), String(r.messages.toOwner)],
    [esc(p.heldBack), String(r.messages.heldBack)],
  ]);
  const actions = Object.keys(r.record.byAction).sort();
  const outcomes = [...new Set(actions.flatMap((a) => Object.keys(r.record.byAction[a])))].sort();
  const byAction = table([{ text: p.action }, ...outcomes.map((o) => ({ text: o, n: true }))], actions.map((a) => [`<code>${esc(a)}</code>`, ...outcomes.map((o) => String(r.record.byAction[a][o] ?? ""))]));

  return `<section class="doc" lang="${language}">
<header class="head"><p class="kicker">${esc(s.agent)} · ${esc(s.monthlyReport)}</p><h1>${esc(r.shop.name)}</h1><p class="period">${esc(periodLabel(r.period, language))}</p>${s.sourceTag[r.source] ? `<p class="tag">${esc(s.sourceTag[r.source])}</p>` : ""}${r.innovator ? `<p class="badge">${esc(badgeText(language))}</p>` : ""}</header>
<p class="note">${esc(s.handRun)}</p>
<div class="cards">
<div class="card"><b>${esc(rupees(r.money.collected.paise))}</b><span>${esc(labels.collected)}</span></div>
<div class="card"><b>${esc(rupees(r.sold.toCollect.paise))}</b><span>${esc(s.label.stillToCollect)}</span></div>
<div class="card"><b>${r.orders.taken}</b><span>${esc(s.label.ordersTaken)}</span></div>
<div class="card"><b>${r.orders.cancelled}</b><span>${esc(s.label.cancelled)}</span></div>
</div>
<h2>${esc(p.numbers)}</h2>${numbers}
<h2>${esc(p.soldHeading)}</h2>${sold}${items}
<h2>${esc(p.stoppedHeading)}</h2>${rules}
<h2>${esc(p.messagesHeading)}</h2>${messages}
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
export function reportPage(envelope: Envelope<OrdersReport>, language: ReportLanguage, check?: string): string {
  const langs = languagesOf(language);
  return page(`${envelope.document.shop.name} · ${STRINGS[langs[0]].monthlyReport}`, langs[0], langs.map((l) => reportSection(envelope, l, check)));
}
