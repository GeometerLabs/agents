// The page every report and certificate is printed on, for every template: a printable page, self-contained (one file, inline CSS, no script, no external
// font or image, nothing loaded from anywhere), green and white with amber for what was not tested. Every value that reaches the page is escaped by the caller
// with `esc`. The one thing a reader can follow is a signed paper's check link (sealBlock), and the page sends no referrer, so its own address stays private.
import type { Language } from "../language/languages.ts";
import type { Envelope } from "./sign.ts";
import { textQrSvg } from "../qr/svg.ts";
import { verifyLink, verifyQrSvg } from "./verify-link.ts";
import { whatThisChecksBlock } from "./what-this-checks.ts";

/** A figure in a table cell or card: <strong>, so it stands out from its label. Empty stays empty (a row with no amount). The value is escaped here. */
export const fig = (value: string | number): string => (String(value) === "" ? "" : `<strong>${esc(value)}</strong>`);

// The only door for text into the page: every value is escaped here so a shop name or customer text can never add markup.
export const esc = (value: string | number): string => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// 14 Nov: figures are <strong> in full ink (cards and the numbers table), so a figure never looks like its label; `.hi` is the one soft highlight, on the first money figure.
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
.head .badge{display:inline-block;margin:.5rem 0 0 .5rem;padding:.1rem .6rem;background:#fff;color:var(--g9);border-radius:99px;font-size:.85rem;font-weight:600}
h2{font-size:1.1rem;margin:1.6rem 0 .5rem;color:var(--g9)}
.note{background:var(--g0);border-left:4px solid var(--g7);padding:.6rem .8rem;margin:1rem 0}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(9rem,1fr));gap:10px;margin:1rem 0}
.card{border:1px solid var(--line);border-radius:10px;padding:.6rem .8rem;background:var(--g0)}
.card strong{display:block;font-size:1.6rem;color:var(--ink);line-height:1.2}
.card strong.hi{display:inline-block;background:var(--g1);border-radius:6px;padding:0 .35rem;margin-left:-.35rem}
td.n strong{color:var(--ink)}
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
.seal{display:flex;flex-wrap:wrap;gap:1rem;align-items:center}
.seal .qr{flex:0 0 auto;width:9.5rem}
.seal .qr.wide{width:12rem}
.seal .qr svg{display:block;width:100%;height:auto;border:1px solid var(--line)}
.seal .words{flex:1 1 14rem;min-width:0}
.what{border:1px solid var(--line);border-radius:10px;padding:.2rem .9rem;margin:1.2rem 0;background:var(--g0)}
.what h2{margin:.7rem 0 .2rem}
.what dd{word-break:normal}
@media print{.head{-webkit-print-color-adjust:exact;print-color-adjust:exact}details{border:0}.doc{break-after:page}}
`;

const SECTION_LANG = /^<section[^>]*\blang="(en|hi|ml|kn)"/u;

/**
 * "What this checks" (B67) goes inside every section, in that section's language (the `lang` its opening tag names, else the page's), as its last block. It is added
 * here, where every report, certificate and paper is printed, so a new paper cannot leave it out and a bilingual page gets each language's own.
 */
function withWhatThisChecks(section: string, pageLanguage: Language): string {
  const language = (SECTION_LANG.exec(section)?.[1] as Language | undefined) ?? pageLanguage;
  const end = section.lastIndexOf("</section>");
  return end < 0 ? section : `${section.slice(0, end)}${whatThisChecksBlock(language)}${section.slice(end)}`;
}

/** A whole page around one or more language sections. No script, no link, no external file; a content policy that forbids them. */
export function page(title: string, language: Language, sections: string[]): string {
  return `<!doctype html>
<html lang="${language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<meta name="referrer" content="no-referrer">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head>
<body>
<main>
${sections.map((s) => withWhatThisChecks(s, language)).join("\n")}
</main>
</body>
</html>
`;
}

// Cells are passed in already escaped (they may hold markup such as a line break), so the caller owns escaping; the head is escaped here.
export const table = (head: { text: string; n?: boolean }[], rows: string[][]): string =>
  `<div class="tablewrap"><table><thead><tr>${head.map((h) => `<th${h.n ? ' class="n"' : ""}>${esc(h.text)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td${head[i]?.n ? ' class="n"' : ""}>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;

// Items are escaped here, unlike table cells, because a list item is always plain text.
export const list = (items: string[]): string => `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;

/**
 * The words the verification block needs; every template's strings carry them under `page`. `scanSummary` is what a paper with a signed summary in its link says
 * instead of `scanToCheck` (item 17b: the check needs no file); left out, `scanToCheck` is used for both.
 */
export interface SealWords { checkHeading: string; code: string; digest: string; signedBy: string; notSigned: string; signatureNote: string; scanToCheck: string; scanSummary?: string }

/**
 * The verification block every report and certificate carries: the code, the full digest, the QR and the link, and what a signature does and does not show.
 *
 * `summaryLink` is the paper's signed summary link (modules/report/summary-sign.ts, `#s1.`), given only for a signed paper. With it the QR and the printed link carry
 * the summary, so a phone checks the paper with no file, the QR is drawn larger (a summary is a version 12 to 14 code: at 12rem, about 51 mm printed, each module
 * is about 0.6 mm), and the link can be tapped on a phone that is showing this page. The link opens with no referrer: this page's own address holds the secret
 * folder name it is served from, and it must not reach geometer.dev. Without it, the older #digest link is printed as before.
 */
export function sealBlock(words: SealWords, envelope: Envelope, extra: [string, string][] = [], summaryLink?: string): string {
  const rows: [string, string][] = [...extra, [words.digest, envelope.digest]];
  const scan = summaryLink ? words.scanSummary ?? words.scanToCheck : words.scanToCheck;
  const qr = summaryLink ? `<div class="qr wide">${textQrSvg(summaryLink, { label: scan })}</div>` : `<div class="qr">${verifyQrSvg(envelope, scan)}</div>`;
  const link = summaryLink ? `<div class="mono"><a href="${esc(summaryLink)}" rel="noreferrer">${esc(summaryLink)}</a></div>` : `<div class="mono">${esc(verifyLink(envelope))}</div>`;
  return `<h2>${esc(words.checkHeading)}</h2>
<div class="seal">${qr}<div class="words"><div class="small">${esc(words.code)}</div><div class="code">${esc(envelope.code)}</div>${link}<p class="small">${esc(scan)}</p></div></div>
<dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd class="mono">${esc(v)}</dd>`).join("")}<dt>${esc(words.signedBy)}</dt><dd class="mono">${esc(envelope.signature ? envelope.signature.keyId : words.notSigned)}</dd></dl>
<p class="small">${esc(words.signatureNote)}</p>`;
}
