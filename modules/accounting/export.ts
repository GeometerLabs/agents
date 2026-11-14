// The accountant's files, as strings: journal-<period>.csv (one row per journal line), documents-<period>.csv (every document number, and the numbers skipped) and
// README.txt. A period is a month ("2026-11") or an Indian financial year ("26-27"), cut in the shop's time zone (periods.ts). CSV is the guaranteed way in for any
// accountant's tool (docs/research/2026-11-15-razorpay-settlements-and-tally.md: one flat general-ledger file); Tally files and settlements come in later steps.
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

export interface ExportFile { name: string; content: string }

export interface ExportInput { journal: Journal; entries: readonly RecordEntry[]; period: string; timeZone: string }

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

export function accountantFiles(i: ExportInput): ExportFile[] {
  const range = periodRange(i.period, i.timeZone);
  if (!range) throw new Error(`"${i.period}" is not a period: write a month as 2026-11 or a financial year as 26-27.`);
  const names = exportNames(i.period);
  const inRange = (iso: string): boolean => { const t = Date.parse(iso); return t >= range.fromMs && t < range.toMs; };
  const bySeq = new Map(i.entries.map((e) => [e.seq, e]));

  const journalRows: (string | number)[][] = [["date", "voucher_no", "voucher_type", "account", "debit", "credit", "method", "evidence", "case_ref", "payment_id", "refund_id", "record_seq"]];
  for (const l of i.journal.lines) {
    if (!inRange(l.at)) continue;
    const refs = bySeq.get(l.seq)?.refs ?? {};
    journalRows.push([dateOf(Date.parse(l.at), i.timeZone), l.doc ?? `J-${l.seq}`, voucherType(l), accountantName(l.account), rupees(l.debitPaise), rupees(l.creditPaise), l.method ?? "", l.evidence ?? "", caseRef(l.case), refs.paymentId ?? "", refs.refundId ?? "", l.seq]);
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
          for (let n = prev.n + 1; n < d.n; n++) {
            docRows.push([`${series}/${fy}/${String(n).padStart(4, "0")}`, dateOf(Date.parse(when), i.timeZone), DOC_TYPE[series], "", restore ? "not used: the shop's data was restored" : "missing"]);
          }
        }
        prev = { n: d.n, seq: d.seq };
      }
    }
  }

  const readme = [
    `Files for the period ${i.period} (${i.period.length === 7 ? "one month" : "one financial year, 1 April to 31 March"}), dates in the shop's time zone (${i.timeZone}).`,
    "",
    `${names.journal}: one row for each line the shop's books wrote, in the order they were written. Each payment, refund and bill is two or more lines whose debit and credit add up to the same amount. Columns: date (YYYY-MM-DD), voucher_no (the document's number, or J-<n> where no document was issued), voucher_type, account, debit, credit, method, evidence (provider: the payment service's own record; owner_mark: the owner marked it; person_word: a person said it was done), case_ref, payment_id, refund_id, record_seq.`,
    `${names.documents}: every receipt, bill and refund note issued in the period, with its number, date, type and amount. A number that was skipped has its own row: "not used: the shop's data was restored" when the shop's data was restored from a copy and the numbers moved on so none is used twice, and "missing" for any other gap (which should not happen).`,
    "",
    OWNER_MONEY_WORDS.en.scope,
    "All amounts are in rupees with two decimals. A customer's phone number or name is never in these files; a customer is only a case reference.",
    "",
  ].join("\r\n");

  return [{ name: names.journal, content: csv(journalRows) }, { name: names.documents, content: csv(docRows) }, { name: names.readme, content: readme }];
}
