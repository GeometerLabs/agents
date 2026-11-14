// The documents of ONE page's cases, ready to draw: what a template's channel read gives the front for a booking's, an order's or a parent's page.
//
// Why a function of its own: the three templates do the same thing (pick the journal's documents of the cases a page owns, newest first, and build each with
// makeDocument), so the rule lives here once and a template only says which cases a page owns and how it words them (`whatFor`, `person`). A document of a case the
// page does not own is never in the list: that is what makes "another case's number" a plain not-found at the front.
//
// Privacy: a Document may carry a student's name (`person`) from the template's own store. It is built per request, goes only to the front over the channel route
// and is drawn at once; nothing here stores, logs or exports it. The phone is left empty: the front adds the shop's phone from pages.json, as it does for every
// customer page (channels/front.ts withContact).
import type { Language } from "../language/languages.ts";
import { makeDocument } from "./documents.ts";
import type { Document, DocumentShop } from "./documents.ts";
import type { Journal } from "./journal.ts";

/**
 * How a page is found at the runtime, by the same hash the page's own read uses: a booking's or an order's (or a fee confirmation's) handle hash, or a parent's link
 * hash. Never a case id, so a holder of the channel token cannot walk the cases.
 */
export type DocumentsKey = { handle: string } | { link: string };

export function caseDocuments(o: {
  journal: Journal; cases: readonly string[]; shop: Omit<DocumentShop, "phone">; language: Language;
  whatFor: (caseId: string, language: Language) => string; person?: (caseId: string) => string | undefined;
}): Document[] {
  const mine = new Set(o.cases);
  const all = o.journal.documents;
  return all
    .filter((d) => d.case !== null && mine.has(d.case))
    .sort((a, b) => b.seq - a.seq)
    .map((doc) => makeDocument({ doc, documents: all, shop: { ...o.shop, phone: "" }, language: o.language, whatFor: o.whatFor, ...(o.person ? { person: o.person } : {}) }));
}
