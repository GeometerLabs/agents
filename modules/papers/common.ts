// What the three papers share: how a person is matched in the shop's own record and in the bundle's export, how a time is written, the page around a paper,
// and the hand-in a template gives (its cases, its money actions, its words). A module imports nothing from a template: the template hands these in.
import { createHash } from "node:crypto";
import { localParts } from "../core/time.ts";
import type { LocalDate } from "../core/time.ts";
import { formatDate, formatTime } from "../language/format.ts";
import type { Language } from "../language/languages.ts";
import type { RecordEntry } from "../record/record.ts";
import type { LedgerHead } from "../record/ledger.ts";
import { esc, list, page } from "../report/page.ts";
import type { Envelope } from "../report/sign.ts";
import { REVIEW_STATUS, WORDS } from "./words.ts";

/** One case as the papers need it: a booking or a fee, in the shape every template can give. */
export interface PaperCase {
  id: string; // "b-3", "f-2"
  /** The customer's (or parent's) number as the record holds it: the number itself in the shop's own store, a short hash ("p-…") in the bundle's export. */
  customer: string;
  language: Language;
  /** The case in a few words, in a language ("Haircut, Tue 4 Nov, 10:00 am"; "Fee for November 2026, Class 8"). Never anyone's name. */
  label(language: Language): string;
  /** What the case's state is now, in a few words (the template's own state name is fine). */
  state: string;
  /** For a fee: what is still owed by the record now, in paise. Left out for a booking. */
  owedPaise?: number;
}

/** What a template hands the papers: its money actions, its words for its own actions, and its cases. */
export interface TemplatePapers {
  pathway: { name: string; version: string };
  /** Actions whose confirmed entry is money coming in (Bookings: record_deposit; Fees: record_payment). UPI's owner_marked_paid is added by the papers. */
  paidActions: readonly string[];
  /** Actions whose confirmed entry is money going back (refund; UPI's upi_refund_marked_done is added). */
  refundActions: readonly string[];
  /** The template's own action words, by language. */
  actionWords: Record<Language, Record<string, string>>;
}

export const UPI_PAID = "owner_marked_paid";
export const UPI_REFUNDED = "upi_refund_marked_done";

/** The same short hash the bundle's export writes in place of a number ("c-" on a record entry, "p-" on a case): sha256 of the text, 12 hex digits. */
export const shortHash = (value: string): string => createHash("sha256").update(value).digest("hex").slice(0, 12);

/** Does a record or case field name this person? It matches the number itself (the shop's own store) and the export's short hashes of it. */
export function isPerson(field: string, number: string): boolean {
  const h = shortHash(number);
  return field === number || field === `p-${h}` || field === `c-${h}`;
}

/** "…4321": enough for a person to see it is their number, and no more. */
export const lastDigits = (number: string): string => `…${number.replace(/\D/gu, "").slice(-4)}`;

export const localDay = (ms: number, timeZone: string): LocalDate => { const p = localParts(ms, timeZone); return { year: p.year, month: p.month, day: p.day }; };

/** "Tue 4 Nov 2026, 10:30 am" in the shop's time zone. */
export function when(iso: string, timeZone: string, language: Language): string {
  const p = localParts(Date.parse(iso), timeZone);
  return `${formatDate({ year: p.year, month: p.month, day: p.day }, language)} ${p.year}, ${formatTime({ hour: p.hour, minute: p.minute }, language)}`;
}
export const dayText = (d: LocalDate, language: Language): string => `${formatDate(d, language)} ${d.year}`;

/** The record entries that belong to these cases, oldest first. */
export const entriesOf = (entries: readonly RecordEntry[], ids: ReadonlySet<string>): RecordEntry[] => [...entries].filter((e) => e.booking !== null && ids.has(e.booking)).sort((a, b) => a.seq - b.seq);

/** The lines a paper lists as not checked, in a language (the paper keeps them in its own bytes, so a reader of the file sees the same lines). */
export const notCheckedSection = (lines: readonly string[], language: Language): string =>
  `<h2>${esc(WORDS[language].common.notChecked)}</h2><div class="warn">${list([...lines])}</div>`;

/** The verification block: the code, the path on the site, the digest, the key, the ledger anchor, and what a signature does not show. No QR yet: a plain link (the QR encoder is moving to a shared module). */
export function sealSection(envelope: Envelope<{ anchor: LedgerHead | null }>, language: Language): string {
  const c = WORDS[language].common;
  const anchor = envelope.document.anchor;
  const rows: [string, string][] = [[c.digest, envelope.digest], [c.signedBy, envelope.signature ? envelope.signature.keyId : c.notSigned], [c.ledger, anchor ? `${anchor.tenant} #${anchor.seq} ${anchor.head}` : c.ledgerNone]];
  return `<h2>${esc(c.code)}</h2>
<div class="seal"><div class="code">${esc(envelope.code)}</div><div class="mono">${esc(c.checkAt(`/verify/#${envelope.code}`))}</div></div>
<dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd class="mono">${esc(v)}</dd>`).join("")}</dl>
<p class="small">${esc(c.signatureNote)}</p>`;
}

/** The head of a paper's page: the kind, the title, the shop, and the draft-words tag for a language no native speaker has read yet. */
export function head(kind: string, title: string, subtitle: string, language: Language): string {
  const draft = REVIEW_STATUS[language] === "source" ? "" : `<span class="tag">${esc(WORDS[language].common.draft)}</span>`;
  return `<div class="head"><p class="kicker">${esc(kind)}</p><h1>${esc(title)}</h1><p class="period">${esc(subtitle)}</p>${draft}</div>`;
}

export const paperPage = (title: string, language: Language, body: string): string => page(title, language, [`<section class="doc">${body}</section>`]);

/** The words a reader sees on a page: no style sheet, no tags, entities read back. What the claim-rule checks read. */
export const visibleText = (html: string): string => html.replace(/<style>[\s\S]*?<\/style>/gu, " ").replace(/<[^>]*>/gu, " ").replace(/&quot;/gu, '"').replace(/&#39;/gu, "'").replace(/&lt;/gu, "<").replace(/&gt;/gu, ">").replace(/&amp;/gu, "&");
