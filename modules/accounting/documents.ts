// What a customer's document says, as plain data: a receipt, a bill, a bill of supply or a refund note (plan section 5 and 7.2). A pure function, no page, no
// clock, no store: document-page.ts draws it, and case-documents.ts picks the documents of one page's cases for the booking's, order's and fee's own pages. Kept apart from the page so the rules (what a shop's status may show) are
// tested without HTML.
//
// A CALLER MUST HAND IN:
//   doc        the DocRef from `Journal.documents` (it carries the number, date, amount, evidence, method and, since this step, the paymentId);
//   documents  all of `Journal.documents`, so a refund note can find the receipt of the same payment (matching paymentId) and cite its number;
//   shop       { name, address, phone, timezone, status } (status "unregistered" | "composition", the plan's two supported states; a shop with no status is unregistered);
//   language   the customer's language;
//   whatFor    the template's own words for what the case is ("Haircut, Sat 15 Nov, 10:30 am", "Fee for November 2026"), by case id and language;
//   person     optional: a customer's or student's name from the shop's own store, by case id. It is shown ONLY on the private page and is never stored or exported:
//              the Document that comes back holds it for drawing, so a caller must not keep or log a Document (it is rebuilt on every view).
//
// What the status decides (docs/research/2026-11-15-india-gst-invoicing.md): an unregistered shop's document has no GSTIN, no tax line and no word "tax", ever; a
// composition shop's BILL is a "Bill of supply" and its documents begin with the legend of CGST rule 5(1)(f). Neither shows a tax line: this file has no field for one.
import type { Language } from "../language/languages.ts";
import type { Method } from "./accounts.ts";
import type { DocRef, Evidence } from "./journal.ts";
import type { TaxStatus } from "./post.ts";
import type { DocKind } from "./words-documents.ts";

export interface DocumentShop { name: string; address: string; phone: string; timezone: string; status?: TaxStatus }

export interface Document {
  language: Language;
  kind: DocKind;
  number: string;
  /** When it was issued (ISO, UTC), and the shop's time zone it is written in. */
  at: string;
  timeZone: string;
  amountPaise: number;
  shop: { name: string; address: string; phone: string };
  /** True for a composition shop: the page prints the rule 5(1)(f) legend at the top. */
  legend: boolean;
  whatFor: string;
  /** The private page only. Never stored, never exported. */
  person?: string;
  method?: Method;
  evidence?: Evidence;
  /** A refund note: the receipt it gives back, by number and date (when the record holds that receipt). */
  cites?: { number: string; at: string };
}

/** The title's kind: by series, and for a BILL by the shop's status ("Bill" for an unregistered shop, "Bill of supply" for a composition one). */
export function kindOf(series: DocRef["series"], status: TaxStatus): DocKind {
  if (series === "RCT") return "receipt";
  if (series === "CN") return "refund_note";
  return status === "composition" ? "bill_of_supply" : "bill";
}

/** Whole rupees and paise from integer paise, by integer arithmetic only (never a float sum): 45000 -> "₹450", 45050 -> "₹450.50". */
export function formatPaise(paise: number): string {
  if (!Number.isSafeInteger(paise) || paise < 0) throw new Error(`An amount is a whole number of paise, 0 or more (got ${paise}).`);
  const rupees = Math.floor(paise / 100);
  const rest = paise % 100;
  const base = `₹${rupees.toLocaleString("en-IN")}`;
  return rest === 0 ? base : `${base}.${String(rest).padStart(2, "0")}`;
}

export function makeDocument(o: {
  doc: DocRef; documents: readonly DocRef[]; shop: DocumentShop; language: Language;
  whatFor: (caseId: string, language: Language) => string; person?: (caseId: string) => string | undefined;
}): Document {
  const status: TaxStatus = o.shop.status ?? "unregistered";
  const d = o.doc;
  const kind = kindOf(d.series, status);
  const receipt = d.series === "CN" && d.paymentId !== undefined
    ? o.documents.find((x) => x.series === "RCT" && x.paymentId === d.paymentId && x.case === d.case)
    : undefined;
  const name = d.case !== null ? o.person?.(d.case) : undefined;
  return {
    language: o.language, kind, number: d.number, at: d.at, timeZone: o.shop.timezone, amountPaise: d.amountPaise,
    shop: { name: o.shop.name, address: o.shop.address, phone: o.shop.phone },
    legend: status === "composition",
    whatFor: d.case !== null ? o.whatFor(d.case, o.language) : "",
    ...(name ? { person: name } : {}),
    ...(d.method ? { method: d.method } : {}),
    ...(d.evidence ? { evidence: d.evidence } : {}),
    ...(receipt ? { cites: { number: receipt.number, at: receipt.at } } : {}),
  };
}
