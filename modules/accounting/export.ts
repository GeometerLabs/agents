// The accountant's files, as strings: journal-<period>.csv (one row per journal line), documents-<period>.csv (every document number, and the numbers skipped) and
// README.txt, and for a shop whose payment service settles into its bank (settlements.ts): settlements-<period>.csv (one row per settlement) and, best effort, the two
// TallyPrime import files (tally.ts). A period is a month ("2026-11") or an Indian financial year ("26-27"), cut in the shop's time zone (periods.ts). CSV is the guaranteed way in for any
// accountant's tool (docs/research/2026-11-15-razorpay-settlements-and-tally.md: one flat general-ledger file); the Tally XML is a second, best-effort way in.
//
// Why these choices:
//  - amounts are written from integer paise by integer arithmetic ("1234567.89"), never through a float, so a total in the sheet equals the journal to the paisa;
//  - quoting is RFC 4180 (a field with a comma, quote, CR or LF is quoted, quotes doubled; rows end CRLF), so any reader opens it the same way;
//  - the files carry accounting words (accounts.ts accountantName) because their reader is an accountant; the owner's screens never do;
//  - privacy: a row names a case id and a provider's payment or refund id, never a customer's number or a student's name (the record's own `conversation` is not
//    read at all). A case ref that looks like a phone number is dropped, as a last guard.
// Voucher type, chosen from the line's kind (the accountant's words for what happened):
//    received -> Receipt;  refund_made -> Credit note when the refund was numbered (a refund note, series CN), else Payment;
//    fee_charged, late_fee -> Sales (a bill raised);  applied -> Sales when it carries a bill of supply (composition shops), else Journal;
//    everything else (refund owed or cancelled, kept, discount, write-off, correction) -> Journal.
import type { Journal, Line } from "./journal.ts";
import { accountantName } from "./accounts.ts";
import { fyStartMs, RESTORED_ACTION, SERIES } from "./numbers.ts";
import type { Series } from "./numbers.ts";
import { periodRange } from "./periods.ts";
import { localParts } from "../core/time.ts";
import type { RecordEntry } from "../record/record.ts";
import { OWNER_MONEY_WORDS } from "./words-owner.ts";
import { MONEY_REFS, checkSettlementRow } from "./journal.ts";
import { SETTLEMENT_ACTIONS } from "./settlements.ts";
import { tallyFiles } from "./tally.ts";
import type { TallyOptions } from "./tally.ts";

export interface ExportFile { name: string; content: string }

export interface ExportInput {
  journal: Journal; entries: readonly RecordEntry[]; period: string; timeZone: string;
  /** Given (even as `{}`), the two best-effort Tally files are made, with this company name and the accountant's own ledger names (tally.ts). Left out: no Tally files. */
  tally?: TallyOptions;
  /**
   * Optional (Fees only today): says a record entry belongs to an old due, an earlier month that was unpaid when the agent started, and which month ("2026-09"). The
   * owner decided (17 Nov 2026) that each centre's accountant tallies old dues as they prefer, so the files only mark them plainly: the journal sheet gets a last column
   * `note` ("old due 2026-09") and the Tally narration the same words, only when a line of the period carries a mark. Left out, or no mark in the period, every file is
   * byte for byte what it was (Bookings and Orders never pass it).
   */
  oldDueOf?: (e: RecordEntry) => string | undefined;
}

/** The plain words an accountant reads beside a line that belongs to an old due. English only, like the rest of these files. */
export const oldDueNote = (month: string): string => `old due ${month}`;

/** Rupees with exactly 2 decimals from integer paise, by integer arithmetic. */
export function rupees(paise: number): string {
  if (!Number.isSafeInteger(paise)) throw new Error(`${paise} is not a whole number of paise`);
  const abs = Math.abs(paise);
  return `${paise < 0 ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** One CSV field, RFC 4180. */
export function csvField(v: string | number): string {
  const s = String(v);
  return /[",\r\n]/u.test(s) ? `"${s.replace(/"/gu, "\"\"")}"` : s;
}

const csv = (rows: readonly (readonly (string | number)[])[]): string => rows.map((r) => `${r.map(csvField).join(",")}\r\n`).join("");

/** YYYY-MM-DD in the shop's time zone. */
function dateOf(ms: number, timeZone: string): string {
  const p = localParts(ms, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function voucherType(l: Line): string {
  switch (l.kind) {
    case "received": return "Receipt";
    case "refund_made": return l.doc ? "Credit note" : "Payment";
    case "fee_charged": case "late_fee": return "Sales";
    case "applied": return l.doc ? "Sales" : "Journal";
    default: return "Journal";
  }
}

const DOC_TYPE: Record<Series, string> = { RCT: "Receipt", BILL: "Bill", CN: "Credit note" };
/** A case id is `b-14` or `f-3.2`; anything with a long run of digits could be a phone number and is left out. */
const caseRef = (c: string | null): string => (c === null || /\d{8,}/u.test(c) ? "" : c);

export const exportNames = (period: string): { journal: string; documents: string; readme: string } => ({ journal: `journal-${period}.csv`, documents: `documents-${period}.csv`, readme: "README.txt" });
/** The files beside those: the settlements file (for a shop that has settlements) and the two best-effort Tally files (when asked for). */
export const extraNames = (period: string): { settlements: string; tallyMasters: string; tallyVouchers: string } => ({ settlements: `settlements-${period}.csv`, tallyMasters: "tally-masters.xml", tallyVouchers: "tally-vouchers.xml" });

/**
 * One row per settlement the payment service paid out: gross (what the customers paid), its charge without the GST and the GST on it, refunds taken back, other
 * adjustments, and what reached the bank (the net), all from the record's own settlement lines (settlements.ts). A settlement is in the period of the day the service
 * settled it. Null when the shop has no settlement at all (a UPI shop, or none read yet), so the file is only there for a shop that has them.
 */
function settlementRows(entries: readonly RecordEntry[], inRange: (ms: number) => boolean, timeZone: string): (string | number)[][] | null {
  interface Acc { id: string; utr: string; atMs: number; gross: number; fee: number; gst: number; refunds: number; adjustments: number; net: number; leftOut: number }
  const by = new Map<string, Acc>();
  let any = false;
  const take = (id: string, utr: string, atMs: number): Acc => {
    let a = by.get(id);
    if (!a) { a = { id, utr, atMs, gross: 0, fee: 0, gst: 0, refunds: 0, adjustments: 0, net: 0, leftOut: 0 }; by.set(id, a); }
    a.atMs = Math.min(a.atMs, atMs);
    return a;
  };
  const int = (v: string | undefined): number => { const n = Number(v ?? 0); return Number.isSafeInteger(n) ? n : 0; };
  for (const e of entries) {
    const r = e.refs;
    const atMs = r[MONEY_REFS.settledAt] ? int(r[MONEY_REFS.settledAt]) * 1000 : Date.parse(e.time);
    if (r[MONEY_REFS.kind] === "settled") {
      any = true;
      const type = r[MONEY_REFS.rowType] === "refund" ? "refund" : "payment";
      const check = checkSettlementRow({ type, amount: int(r[MONEY_REFS.amount]), fee: int(r[MONEY_REFS.fee]), tax: int(r[MONEY_REFS.tax]), credit: int(r[MONEY_REFS.credit]), debit: int(r[MONEY_REFS.debit]) });
      if (!check.ok) continue; // the journal already lists it as a problem; a row that does not add up is not summed
      const a = take(r[MONEY_REFS.settlementId], r[MONEY_REFS.utr], atMs);
      if (type === "payment") { a.gross += int(r[MONEY_REFS.amount]); a.fee += check.feePaise; a.gst += check.gstPaise; a.net += int(r[MONEY_REFS.credit]); }
      else { a.refunds += int(r[MONEY_REFS.amount]); a.net -= int(r[MONEY_REFS.amount]); }
    } else if (e.action === SETTLEMENT_ACTIONS.listed && (r.why === "unknown_payment" || r.why === "problem" || r.why === "other") && r.settlementId) {
      any = true;
      take(r.settlementId, r.utr ?? "", atMs).leftOut++; // in the bank's figure but not in the books: the sheet says so
    } else if (e.action === SETTLEMENT_ACTIONS.listed && r.why === "adjustment" && r.settlementId) {
      any = true;
      const a = take(r.settlementId, r.utr ?? "", atMs);
      const taken = int(r[MONEY_REFS.debit]) - int(r[MONEY_REFS.credit]); // an adjustment that takes money off the settlement is positive
      a.adjustments += taken;
      a.net -= taken;
    }
  }
  if (!any) return null;
  const rows: (string | number)[][] = [["settlement_id", "utr", "settled_on", "gross", "fee_without_gst", "gst_on_fee", "refunds", "adjustments", "net", "rows_left_out"]];
  for (const a of [...by.values()].sort((x, y) => x.atMs - y.atMs || x.id.localeCompare(y.id))) {
    if (inRange(a.atMs)) rows.push([a.id, a.utr, dateOf(a.atMs, timeZone), rupees(a.gross), rupees(a.fee), rupees(a.gst), rupees(a.refunds), rupees(a.adjustments), rupees(a.net), a.leftOut]);
  }
  return rows;
}

export function accountantFiles(i: ExportInput): ExportFile[] {
  const range = periodRange(i.period, i.timeZone);
  if (!range) throw new Error(`"${i.period}" is not a period: write a month as 2026-11 or a financial year as 26-27.`);
  const names = { ...exportNames(i.period), ...extraNames(i.period) };
  const inRange = (iso: string): boolean => { const t = Date.parse(iso); return t >= range.fromMs && t < range.toMs; };
  const bySeq = new Map(i.entries.map((e) => [e.seq, e]));

  const oldDue = (seq: number): string => { const e = bySeq.get(seq); const m = e && i.oldDueOf ? i.oldDueOf(e) : undefined; return m ? oldDueNote(m) : ""; };
  const anyOldDue = i.oldDueOf !== undefined && i.journal.lines.some((l) => inRange(l.at) && oldDue(l.seq) !== "");
  const journalRows: (string | number)[][] = [["date", "voucher_no", "voucher_type", "account", "debit", "credit", "method", "evidence", "case_ref", "payment_id", "refund_id", "record_seq", ...(anyOldDue ? ["note"] : [])]];
  for (const l of i.journal.lines) {
    if (!inRange(l.at)) continue;
    const refs = bySeq.get(l.seq)?.refs ?? {};
    journalRows.push([dateOf(Date.parse(l.at), i.timeZone), l.doc ?? `J-${l.seq}`, voucherType(l), accountantName(l.account), rupees(l.debitPaise), rupees(l.creditPaise), l.method ?? "", l.evidence ?? "", caseRef(l.case), refs.paymentId ?? "", refs.refundId ?? "", l.seq, ...(anyOldDue ? [oldDue(l.seq)] : [])]);
  }

  const docRows: (string | number)[][] = [["number", "date", "type", "amount", "note"]];
  const restores = i.entries.filter((e) => e.action === RESTORED_ACTION);
  for (const series of SERIES) {
    const years = new Set(i.journal.documents.filter((d) => d.series === series).map((d) => d.fy));
    for (const fy of years) {
      const docs = i.journal.documents.filter((d) => d.series === series && d.fy === fy).sort((a, b) => a.n - b.n);
      let prev = { n: 0, seq: 0 };
      for (const d of docs) {
        if (inRange(d.at)) docRows.push([d.number, dateOf(Date.parse(d.at), i.timeZone), DOC_TYPE[series], rupees(d.amountPaise), ""]);
        // Numbers between the last one and this one were never issued here. A restore entry in between (as numbers.ts reads it) says why; nothing else should.
        const restore = restores.find((r) => r.seq > prev.seq && r.seq < d.seq && (prev.seq > 0 || Date.parse(r.time) >= fyStartMs(fy, i.timeZone)));
        const when = restore ? restore.time : d.at;
        if (d.n > prev.n + 1 && inRange(when)) {
          // One row per skipped range, not per number: a restore skips 10,000 numbers (numbers.ts RESTORE_DOC_GAP), and a sheet of 10,000 empty rows helps nobody.
          const num = (n: number) => `${series}/${fy}/${String(n).padStart(4, "0")}`;
          const range = d.n - 1 === prev.n + 1 ? num(prev.n + 1) : `${num(prev.n + 1)} to ${num(d.n - 1)}`;
          docRows.push([range, dateOf(Date.parse(when), i.timeZone), DOC_TYPE[series], "", restore ? "not used: the shop's data was restored" : "missing"]);
        }
        prev = { n: d.n, seq: d.seq };
      }
    }
  }

  const settlementCsv = settlementRows(i.entries, (ms) => ms >= range.fromMs && ms < range.toMs, i.timeZone);

  // The Tally files are best effort and never the only copy: if they cannot be made, the CSV files are still complete and the README says why.
  let tally: { masters: string; vouchers: string } | null = null;
  let tallyWhy = "";
  if (i.tally) try { tally = tallyFiles({ lines: i.journal.lines.filter((l) => inRange(l.at)), entries: i.entries, timeZone: i.timeZone, ...(anyOldDue ? { oldDueOf: i.oldDueOf } : {}), ...i.tally }); } catch (e) { tallyWhy = (e as Error).message; }

  const readme = [
    `Files for the period ${i.period} (${i.period.length === 7 ? "one month" : "one financial year, 1 April to 31 March"}), dates in the shop's time zone (${i.timeZone}).`,
    "",
    `${names.journal}: one row for each line the shop's books wrote, in the order they were written. Each payment, refund and bill is two or more lines whose debit and credit add up to the same amount. Columns: date (YYYY-MM-DD), voucher_no (the document's number, or J-<n> where no document was issued), voucher_type, account, debit, credit, method, evidence (provider: the payment service's own record; owner_mark: the owner marked it; person_word: a person said it was done), case_ref, payment_id, refund_id, record_seq.${anyOldDue ? " A last column, note, says \"old due 2026-09\" on every line of a fee for an earlier month that was unpaid when the agent started (the owner typed it in the settings): the books post it as an ordinary fee, and the accountant moves it where they prefer." : ""}`,
    `${names.documents}: every receipt, bill and refund note issued in the period, with its number, date, type and amount. Numbers that were skipped have one row for each run of them ("RCT/26-27/0003 to RCT/26-27/10002"): "not used: the shop's data was restored" when the shop's data was restored from a copy and the numbers moved on so none is used twice, and "missing" for any other gap (which should not happen).`,
    ...(settlementCsv ? [`${names.settlements}: one row for each settlement the payment service paid into the bank: settlement_id, utr (the bank's reference, to tick against the bank statement), settled_on, gross (what customers paid), fee_without_gst, gst_on_fee, refunds, adjustments, and net (gross less the fee, the GST, refunds and adjustments, for the rows the books counted: rows_left_out is how many rows of that settlement are not in the books, such as a payment that did not go through the assistant, and the bank received those too).`] : []),
    "",
    OWNER_MONEY_WORDS.en.scope,
    "All amounts are in rupees with two decimals. A customer's phone number or name is never in these files; a customer is only a case reference.",
    ...(i.tally ? ["", "Importing into TallyPrime (best effort: the CSV files above are the way that always works)"] : []),
    ...(!i.tally ? [] : [tally
      ? `${names.tallyMasters} and ${names.tallyVouchers} are written from TallyPrime's own help pages and sample files. They have not been tried on a real TallyPrime, so look at the first import in Tally's Exceptions report. 1) Back up the company first. 2) Open the company${i.tally?.company ? `: its name must be exactly "${i.tally.company}", as written in the file` : " you want them in (the file names no company, so it goes into the open one)"}. 3) Alt+O (Import) > Masters, choose ${names.tallyMasters}. 4) Alt+O (Import) > Transactions, choose ${names.tallyVouchers}. Import each file once only: a second import makes every voucher again. The dates must be inside the company's financial year, and the ledgers are made under groups every TallyPrime has (Cash-in-Hand, Bank Accounts, Sundry Debtors, Current Liabilities, Sales Accounts, Indirect Expenses, Duties & Taxes). Vouchers are plain Receipt, Payment and Journal vouchers, never GST invoices.`
      : `The Tally files could not be made this time (${tallyWhy}). The CSV files are complete.`]),
    "",
  ].join("\r\n");

  return [
    { name: names.journal, content: csv(journalRows) }, { name: names.documents, content: csv(docRows) },
    ...(settlementCsv ? [{ name: names.settlements, content: csv(settlementCsv) }] : []),
    ...(tally ? [{ name: names.tallyMasters, content: tally.masters }, { name: names.tallyVouchers, content: tally.vouchers }] : []),
    { name: names.readme, content: readme },
  ];
}
