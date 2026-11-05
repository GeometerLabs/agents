// The page every report and certificate is printed on, for every template: a printable page, self-contained (one file, inline CSS, no script, no external
// font, image or link), green and white with amber for what was not tested. Every value that reaches the page is escaped by the caller with `esc`.
import type { Language } from "../language/languages.ts";
import type { Envelope } from "./sign.ts";

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
.head .badge{display:inline-block;margin:.5rem 0 0 .5rem;padding:.1rem .6rem;background:#fff;color:var(--g9);border-radius:99px;font-size:.85rem;font-weight:600}
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

/** The words the verification block needs; every template's strings carry them under `page`. */
export interface SealWords { checkHeading: string; code: string; digest: string; signedBy: string; notSigned: string; signatureNote: string }

/** The verification block every report and certificate carries: the code, the full digest, and what a signature does and does not show. */
export function sealBlock(words: SealWords, envelope: Envelope, extra: [string, string][] = []): string {
  const rows: [string, string][] = [...extra, [words.digest, envelope.digest]];
  const where = `/verify/${envelope.code}`;
  return `<h2>${esc(words.checkHeading)}</h2>
<div class="seal"><div class="small">${esc(words.code)}</div><div class="code">${esc(envelope.code)}</div><div class="mono">${esc(where)}</div></div>
<dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd class="mono">${esc(v)}</dd>`).join("")}<dt>${esc(words.signedBy)}</dt><dd class="mono">${esc(envelope.signature ? envelope.signature.keyId : words.notSigned)}</dd></dl>
<p class="small">${esc(words.signatureNote)}</p>`;
}
