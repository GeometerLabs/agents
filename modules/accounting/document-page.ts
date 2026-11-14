// A customer's document (receipt, bill, bill of supply, refund note) as one HTML page: phone first, in the customer's language with the fixed fields (title,
// number, date, amount) also in English beside it so an accountant can read any document, and a print stylesheet so the phone's own "Print / Save as PDF" makes the
// PDF. It runs NO script (a customer page never does; a PDF needs none because the phone's menu prints the page) and loads nothing.
//
// Why it reuses the shop pages' look (CUSTOMER_CSS) but not their layout(): that layout carries the shop's character picture, language links and a refresh, none of
// which belong on a paper document. The head here is just the shop's name, and print turns the screen colours, the head and the print hint off: black on white.
// The paper size is the printer's own (A4 or A5): the page is fluid and only sets a margin, so one sheet does for both.
//
// What it draws is a Document (documents.ts); the escaping is html.ts's, so a shop named <script> is text. Hindi, Malayalam and Kannada words are machine-written
// (words-documents.ts) and the page says so at its top, as the other customer pages do.
import { html, raw } from "../core/html.ts";
import type { Raw } from "../core/html.ts";
import { localParts } from "../core/time.ts";
import { formatDate, formatTime, MONTH_NAMES } from "../language/format.ts";
import { CUSTOMER_CSS } from "../channels/look.ts";
import { PAGE } from "../channels/words.ts";
import { formatPaise } from "./documents.ts";
import type { Document } from "./documents.ts";
import { DOC } from "./words-documents.ts";

/** Screen additions and the whole print sheet. Print: white paper, black ink, no head and no hint, a margin, and no card shadow. */
const DOC_CSS = `
.doc { padding: 16px; }
.doc h1 { margin: 0 0 4px; }
.doc .en { display: block; color: var(--soft); font-size: .85rem; font-weight: 400; }
.doc dl { margin: 12px 0 0; }
.doc dt { color: var(--soft); font-size: .85rem; margin-top: 10px; }
.doc dd { margin: 0; font-size: 1.02rem; overflow-wrap: anywhere; }
.doc .amount { font-size: 1.7rem; font-weight: 750; }
.doc .legend { border: 1px solid var(--line2); padding: 8px 12px; border-radius: 10px; margin: 0 0 12px; }
.doc .made { margin-top: 18px; color: var(--soft); font-size: .88rem; }
@page { margin: 12mm; }
@media print {
  body, .doc { background: #fff !important; color: #000 !important; box-shadow: none !important; }
  .head, .machine, .noprint { display: none !important; }
  .doc { border: 0 !important; padding: 0 !important; }
  .doc .en, .doc dt, .doc .made { color: #000 !important; }
}`;

/** The date as "15 Nov 2026": the English fixed field, written the same in every language. */
function englishDate(ms: number, tz: string): string {
  const p = localParts(ms, tz);
  return `${p.day} ${MONTH_NAMES.en[p.month - 1]} ${p.year}`;
}

/** The whole page for one document. `selfPath` is not needed: the page has no links and no form. */
export function documentPage(d: Document): string {
  const w = DOC[d.language];
  const en = DOC.en;
  const ms = Date.parse(d.at);
  const both = d.language !== "en";
  /** A fixed field's label: in the customer's language, with the English one beneath it when that differs. */
  const label = (local: string, english: string): Raw => html`${local}${both ? html`<span class="en" lang="en">${english}</span>` : ""}`;
  const refund = d.kind === "refund_note";
  const how = d.evidence === undefined ? "" : d.evidence === "owner_mark" && refund ? w.ownerMarkRefund : w.evidence[d.evidence];
  const when = localParts(ms, d.timeZone);
  const dateText = `${formatDate(when, d.language)} ${when.year}, ${formatTime(when, d.language)}`;
  const citeDate = (iso: string) => `${formatDate(localParts(Date.parse(iso), d.timeZone), d.language)} ${localParts(Date.parse(iso), d.timeZone).year}`;
  const title = `${w.title[d.kind]} ${d.number}`;
  return `<!doctype html>${html`<html lang="${d.language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="theme-color" content="#e2f2e9">
<title>${title} - ${d.shop.name}</title><style>${raw(CUSTOMER_CSS)}${raw(DOC_CSS)}</style></head>
<body><header class="head"><div class="wrap"><h1>${d.shop.name}</h1></div></header>
<main class="wrap">${PAGE[d.language].machine ? html`<p class="machine">${PAGE[d.language].machine}</p>` : ""}
<article class="card doc">
${d.legend ? html`<p class="legend">${w.legend}${both ? html`<span class="en" lang="en">${en.legend}</span>` : html``}</p>` : ""}
<h1>${label(w.title[d.kind], en.title[d.kind])}</h1>
<p class="note">${d.shop.name}${d.shop.address ? html`<br>${d.shop.address}` : ""}${d.shop.phone ? html`<br>${w.phone}: ${d.shop.phone}` : ""}</p>
<dl>
<dt>${label(w.number, en.number)}</dt><dd>${d.number}</dd>
<dt>${label(w.date, en.date)}</dt><dd>${dateText}${both ? html`<span class="en" lang="en">${englishDate(ms, d.timeZone)}</span>` : ""}</dd>
<dt>${label(w.amountLabel[d.kind], en.amountLabel[d.kind])}</dt><dd class="amount">${formatPaise(d.amountPaise)}</dd>
${d.whatFor ? html`<dt>${w.forLabel}</dt><dd>${d.whatFor}</dd>` : ""}
${d.person ? html`<dt>${w.person}</dt><dd>${d.person}</dd>` : ""}
${d.cites ? html`<dd>${w.cites(d.cites.number, citeDate(d.cites.at))}</dd>` : ""}
${d.method ? html`<dt>${w.paidBy}</dt><dd>${w.method[d.method]}</dd>` : ""}
${how ? html`<dt>${w.howKnown}</dt><dd>${how}</dd>` : ""}
</dl>
<p class="made">${w.footer(d.shop.name)}</p>
</article>
<p class="note noprint">${w.printHint}</p>
</main></body></html>`.markup}`;
}
