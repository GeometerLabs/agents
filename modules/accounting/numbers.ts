// Document numbers: one gap-free series per document type, per shop, per Indian financial year (1 April to 31 March, in the shop's time zone).
//
// The rules (CGST Rules r.46(b), and the same clause in r.49 to r.53; read in CBIC's text on 15 Nov 2026, docs/research/2026-11-15-india-gst-invoicing.md): a
// consecutive serial number, at most 16 characters, letters, digits, "-" and "/" only, in one or several series, unique for a financial year. So a number here is
// `<series>/<yy-yy>/<n>`, e.g. `RCT/26-27/0007`, with no shop prefix (it would pass 16 characters, and a number need only be unique for its supplier).
//
// Why a number is worked out from the record and never kept in a counter: the record is the only memory that is saved in the same transaction as the step that
// issues the document (modules/runtime/store.ts). A step that crashes saves nothing, so it uses no number; a step that is saved has its number in its record line.
// So the next number is the highest one in the record for that series and year, plus one.
//
// A restore from a nightly snapshot (modules/runtime/restored.ts) loses the record after the snapshot, but a customer may hold a document issued in that time.
// Re-using its number would give two documents one number. So after a `restored` entry each series jumps on by RESTORE_DOC_GAP, and the numbers skipped are listed
// in the accountant's export as "not used: the shop's data was restored" (the owner's decision, plan Q5).
import { localParts, zonedToMs } from "../core/time.ts";
import type { RecordEntry } from "../record/record.ts";

/** RCT: a receipt for money received. BILL: a bill (a month's fee) or, for a composition shop, a bill of supply. CN: a refund note (a credit note). */
export type Series = "RCT" | "BILL" | "CN";
export const SERIES: readonly Series[] = ["RCT", "BILL", "CN"];

/** How far a series moves on after a restore: more documents than a busy shop issues in the 30 days a snapshot is kept. */
export const RESTORE_DOC_GAP = 10_000;
/** The record's entry for a restore (modules/runtime/restored.ts RESTORED_ENTRY; repeated here so this file needs no runtime import). */
export const RESTORED_ACTION = "restored";
/** Rule 46(b): at most 16 characters. */
export const MAX_NUMBER_LENGTH = 16;

const NUMBER = /^(RCT|BILL|CN)\/(\d{2})-(\d{2})\/(\d{4,6})$/u;

export interface DocNumber { series: Series; fy: string; n: number }

/** The financial year a moment falls in, in the shop's time zone, as "26-27" (1 April 2026 to 31 March 2027). */
export function fyOf(ms: number, timeZone: string): string {
  const p = localParts(ms, timeZone);
  const start = p.month >= 4 ? p.year : p.year - 1;
  return `${String(start % 100).padStart(2, "0")}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** "RCT/26-27/0007". Throws when the number would pass 16 characters, which only a series run past 99,999 in one year could do. */
export function formatNumber(d: DocNumber): string {
  const text = `${d.series}/${d.fy}/${String(d.n).padStart(4, "0")}`;
  if (!Number.isSafeInteger(d.n) || d.n < 1 || text.length > MAX_NUMBER_LENGTH) throw new Error(`The document number ${text} is not allowed: a number is 1 or more and at most ${MAX_NUMBER_LENGTH} characters long (GST rule 46(b)).`);
  return text;
}

/** A number this file wrote, or null for anything else (an older or a foreign form is never guessed at). */
export function parseNumber(text: string): DocNumber | null {
  const m = NUMBER.exec(text);
  if (!m) return null;
  const [, series, a, b, n] = m;
  if ((Number(a) + 1) % 100 !== Number(b)) return null;
  return { series: series as Series, fy: `${a}-${b}`, n: Number(n) };
}

/**
 * The next number of this series and year, from the record alone. `fyStartMs`: when the year began in the shop's time zone, so a restore earlier in the year
 * still moves a series that has issued nothing yet since it (the snapshot may be from before documents that were then lost).
 */
export function nextNumber(entries: readonly RecordEntry[], series: Series, fy: string, fyStartMs: number): DocNumber {
  let last = 0;
  let lastSeq = 0;
  for (const e of entries) {
    const d = e.refs.doc ? parseNumber(e.refs.doc) : null;
    if (d && d.series === series && d.fy === fy && d.n > last) { last = d.n; lastSeq = e.seq; }
  }
  const restoredSince = entries.some((e) => e.action === RESTORED_ACTION && e.seq > lastSeq && Date.parse(e.time) >= fyStartMs);
  return { series, fy, n: last + (restoredSince ? RESTORE_DOC_GAP : 0) + 1 };
}

/** The first moment of the financial year `fy` ("26-27") in the shop's time zone: 1 April, 00:00. */
export function fyStartMs(fy: string, timeZone: string): number {
  return zonedToMs({ year: 2000 + Number(fy.slice(0, 2)), month: 4, day: 1 }, { hour: 0, minute: 0 }, timeZone);
}
