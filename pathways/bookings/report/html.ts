// The builder layer: a printable page, self-contained (one file, inline CSS, no script, no external font, image or link),
// green and white with amber for what was not tested. It shows the same numbers as the owner's text, a table per limit,
// and a "Show what we did ▸" section with the counts by action and outcome, the record's entries (fingerprints only) and
// the digests. Every value that reaches the page is escaped; shop and service names come from the settings file.
import { formatDate } from "../src/language/format.ts";
import { localParts } from "../src/time.ts";
import { RULE_IDS } from "./data.ts";
import type { MonthlyReport } from "./data.ts";
import type { Envelope } from "./sign.ts";
import { STRINGS } from "./strings.ts";
import type { Strings } from "./strings.ts";
import { languagesOf, periodLabel, rupees } from "./text.ts";
import type { ReportLanguage } from "./text.ts";
import type { Language } from "../src/settings.ts";

export const esc = (value: string | number): string => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const CSS = `
:root{--g9:#14532d;--g7:#15803d;--g1:#dcfce7;--g0:#f0fdf4;--ink:#10231a;--mute:#4b5d52;--line:#cfe3d6;--amber:#92400e;--amber-bg:#fffbeb;--amber-line:#f5d98a;--bg:#fff}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI","Noto Sans","Noto Sans Devanagari","Noto Sans Malayalam","Noto Sans Kannada",sans-serif}
main{max-width:46rem;margin:0 auto;padding:0 16px 40px}
.doc{border-bottom:2px solid var(--g1);padding-bottom:24px;margin-bottom:24px}
.head{background:var(--g9);color:#fff;margin:0 -16px 16px;padding:20px 16px}
.head .kicker{margin:0;font-size:.9rem;opacity:.85}
.head h1{margin:.1rem 0;font-size:1.7rem;line-height:1.2}
.head .period{margin:0;font-size:1.1rem}
.head .tag{display:inline-block;margin:.5rem 0 0;padding:.1rem .6rem;border:1px solid #fff;border-radius:99px;font-size:.85rem}
h2{font-size:1.1rem;margin:1.6rem 0 .5rem;color:var(--g9)}
.note{background:var(--g0);border-left:4px solid var(--g7);padding:.6rem .8rem;margin:1rem 0}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(9rem,1fr));gap:10px;margin:1rem 0}
.card{border:1px solid var(--line);border-radius:10px;padding:.6rem .8rem;background:var(--g0)}
.card b{display:block;font-size:1.6rem;color:var(--g9);line-height:1.2}
.card span{font-size:.85rem;color:var(--mute)}
.tablewrap{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:.95rem}
th,td{text-align:left;padding:.4rem .5rem;border-bottom:1px solid var(--line);vertical-align:top}
th{background:var(--g0);color:var(--g9);font-weight:600}
td.n,th.n{text-align:right;white-space:nowrap}
code,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.85rem;word-break:break-all}
.warn{background:var(--amber-bg);border:1px solid var(--amber-line);border-radius:10px;padding:.2rem .9rem;margin:.6rem 0}
.warn li,.warn p{color:var(--amber)}
ul{padding-left:1.2rem;margin:.4rem 0}
dl{display:grid;grid-template-columns:max-content 1fr;gap:.2rem .8rem;margin:.4rem 0}
dt{color:var(--mute)}dd{margin:0;word-break:break-all}
.small{font-size:.85rem;color:var(--mute)}
details{margin:1.2rem 0;border:1px solid var(--line);border-radius:10px;padding:.4rem .8rem}
summary{cursor:pointer;font-weight:600;color:var(--g9);padding:.3rem 0}
.seal{border:2px solid var(--g7);border-radius:12px;padding:.6rem 1rem;margin:1rem 0}
.seal .code{font-size:1.6rem;font-weight:700;letter-spacing:.08em;color:var(--g9)}
@media print{.head{-webkit-print-color-adjust:exact;print-color-adjust:exact}details{border:0}.doc{break-after:page}}
`;

/** A whole page around one or more language sections. No script, no link, no external file; a content policy that forbids them. */
export function page(title: string, language: Language, sections: string[]): string {
  return `<!doctype html>
<html lang="${language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head>
<body>
<main>
${sections.join("\n")}
</main>
</body>
</html>
`;
}

export const table = (head: { text: string; n?: boolean }[], rows: string[][]): string =>
  `<div class="tablewrap"><table><thead><tr>${head.map((h) => `<th${h.n ? ' class="n"' : ""}>${esc(h.text)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td${head[i]?.n ? ' class="n"' : ""}>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;

export const list = (items: string[]): string => `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;

/** The verification block every report and certificate carries: the code, the full digest, and what a signature does and does not show. */
export function sealBlock(s: Strings, envelope: Envelope, extra: [string, string][] = []): string {
  const rows: [string, string][] = [...extra, [s.page.digest, envelope.digest]];
  const where = `/verify/${envelope.code}`;
  return `<h2>${esc(s.page.checkHeading)}</h2>
<div class="seal"><div class="small">${esc(s.page.code)}</div><div class="code">${esc(envelope.code)}</div><div class="mono">${esc(where)}</div></div>
<dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd class="mono">${esc(v)}</dd>`).join("")}<dt>${esc(s.page.signedBy)}</dt><dd class="mono">${esc(envelope.signature ? envelope.signature.keyId : s.page.notSigned)}</dd></dl>
<p class="small">${esc(s.page.signatureNote)}</p>`;
}

/** One language's section of the report page. */
export function reportSection(envelope: Envelope<MonthlyReport>, language: Language): string {
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
    [esc(s.label.depositsCollected), ...amount(r.money.deposits)],
    [esc(s.label.givenBack), ...amount(r.money.refunds)],
    [esc(p.givenBackDeposits), ...amount(r.money.refunds.ofDeposits)],
    [esc(p.givenBackSecond), ...amount(r.money.refunds.ofSecondPayments)],
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
  const entries = table([{ text: p.colNo, n: true }, { text: p.colTime }, { text: p.colAction }, { text: p.colOutcome }, { text: p.colBooking }, { text: p.colFingerprint }],
    r.record.rows.map((x) => [String(x.seq), esc(x.time.slice(0, 19).replace("T", " ")), `<code>${esc(x.action)}</code>`, `<code>${esc(x.outcome)}</code>`, esc(x.booking ?? "–"), `<code>${esc(x.digest.slice(7, 23))}</code>`]));

  return `<section class="doc" lang="${language}">
<header class="head"><p class="kicker">${esc(s.agent)} · ${esc(s.monthlyReport)}</p><h1>${esc(r.shop.name)}</h1><p class="period">${esc(periodLabel(r.period, language))}</p>${s.sourceTag[r.source] ? `<p class="tag">${esc(s.sourceTag[r.source])}</p>` : ""}</header>
<p class="note">${esc(s.sourceLong[r.source])} ${esc(s.handRun)}</p>
<div class="cards">
<div class="card"><b>${r.bookings.made}</b><span>${esc(s.label.bookingsMade)}</span></div>
<div class="card"><b>${esc(rupees(r.money.deposits.paise))}</b><span>${esc(s.label.depositsCollected)}</span></div>
<div class="card"><b>${esc(rupees(r.money.refunds.paise))}</b><span>${esc(s.label.givenBack)}</span></div>
<div class="card"><b>${r.stopped.total}</b><span>${esc(s.label.stoppedByLimits)}</span></div>
</div>
<h2>${esc(p.numbers)}</h2>${numbers}
<h2>${esc(p.stoppedHeading)}</h2>${rules}<p class="small">${esc(p.stoppedNote)}</p>
<h2>${esc(p.messagesHeading)}</h2>${messages}
<h2>${esc(p.unconfirmedHeading)}</h2>${unconfirmed}
<dl><dt>${esc(p.waitingNow)}</dt><dd>${r.atReportTime.waitingForOwner}</dd><dt>${esc(p.paidNotBooked)}</dt><dd>${r.atReportTime.paidNotBooked}</dd></dl>
${missing.length > 0 ? `<div class="warn"><p><b>${esc(p.missingHeading)}</b></p><ul>${missing.map(([label, n]) => `<li>${esc(label)}: ${n}</li>`).join("")}</ul></div>` : ""}
<div class="warn"><h2>${esc(p.notCountedHeading)}</h2>${list(r.notCounted.map((id) => s.notCounted[id]))}<h2>${esc(p.notTestedHeading)}</h2>${list(r.notTested.map((id) => s.notTested[id]))}</div>
<p class="small">${esc(p.notAGrade)}</p>
${sealBlock(s, envelope, [[p.countedFrom, s.sourceTag[r.source] || s.sourceLong[r.source]], [p.period, periodLabel(r.period, language)], [p.agentVersion, `${r.pathway.name} ${r.pathway.version}`], [p.madeOn, madeOn], ...(r.preparedBy ? [[p.setUpBy, r.preparedBy] as [string, string]] : []), [p.limitsDigest, r.policyDigest], [p.recordDigest, r.record.digest]])}
<details><summary>${esc(p.showWhatWeDid)}</summary>
<h2>${esc(p.byActionHeading)}</h2>${byAction}
<h2>${esc(p.entriesHeading)}</h2>${entries}
</details>
</section>`;
}

/** The report page for one language, or Hindi and English together. */
export function reportPage(envelope: Envelope<MonthlyReport>, language: ReportLanguage): string {
  const langs = languagesOf(language);
  return page(`${envelope.document.shop.name} · ${STRINGS[langs[0]].monthlyReport}`, langs[0], langs.map((l) => reportSection(envelope, l)));
}
