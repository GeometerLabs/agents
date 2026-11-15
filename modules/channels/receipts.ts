// A customer's receipts on their own page: the "Receipts" list on a booking's, an order's and a fee's private page, and the document itself at
// `<that page's address>/d/<number>` (the number URL-encoded: RCT%2F26-27%2F0007).
//
// Why it lives here and the pages only get a box: the three templates' pages (page.ts, order-page.ts, fee-page.ts) differ, the receipts do not. Each page's route
// asks the runtime for the documents of the page the visitor's handle (or link) opens (`backend.documents`, keyed by the same hash the page's own read uses), draws
// the box with `receiptsBox` and serves one with `documentHtml`. A number of another page is simply not in that list, so it is a plain not-found: nothing here can
// reach a document the handle does not own.
//
// No script and no link out: the list is plain links, the document is document-page.ts (which runs none and loads nothing). A failed read of the documents never
// breaks the page: the visitor sees the page without the list, as before.
import { html } from "../core/html.ts";
import type { Raw } from "../core/html.ts";
import { localParts } from "../core/time.ts";
import { formatDate } from "../language/format.ts";
import type { Language } from "../language/languages.ts";
import { documentPage } from "../accounting/document-page.ts";
import { formatPaise } from "../accounting/documents.ts";
import type { Document } from "../accounting/documents.ts";
import type { DocumentsKey } from "../accounting/case-documents.ts";
import { DOC } from "../accounting/words-documents.ts";
import type { ChannelBackend } from "./backend.ts";

/** What follows a page's address for one of its documents: "/d/<number>", the number still URL-encoded (it holds slashes). */
export const DOCUMENT_SUB = /^\/d\/(.+)$/u;

/** The documents of a page, or none: a runtime without accounting, or one that did not answer, leaves the page as it was. */
export async function receiptsOf(backend: ChannelBackend, key: DocumentsKey, language: Language): Promise<Document[]> {
  if (!backend.documents) return [];
  try { return await backend.documents(key, language); } catch { return []; }
}

/** The "Receipts" box, newest first: each document is a link to its own page; nothing at all when there are none. `base` is the page's address. */
export function receiptsBox(docs: readonly Document[], base: string, language: Language): Raw | "" {
  if (docs.length === 0) return "";
  const w = DOC[language];
  return html`<h2>${w.receipts}</h2><ul class="list">${docs.map((d) => {
    const when = localParts(Date.parse(d.at), d.timeZone);
    return html`<li class="card"><a href="${base}/d/${encodeURIComponent(d.number)}?lang=${language}">${w.title[d.kind]} ${d.number}</a> <small class="note">${formatDate(when, language)} ${when.year} · ${formatPaise(d.amountPaise)}</small></li>`;
  })}</ul>`;
}

/**
 * The page of the document with this number, among the documents of THIS page only; undefined when it is not one of them (or the number is not valid text). `raw` is
 * the path's part after "/d/" as it came, still encoded. `phone` is the shop's own, from its pages.json: the runtime leaves it empty.
 */
export function documentHtml(docs: readonly Document[], raw: string, phone: string | undefined): string | undefined {
  let number: string;
  try { number = decodeURIComponent(raw); } catch { return undefined; }
  const d = docs.find((x) => x.number === number);
  return d ? documentPage({ ...d, shop: { ...d.shop, phone: phone ?? "" } }) : undefined;
}
