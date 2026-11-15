// TallyPrime import files, BEST EFFORT: tally-masters.xml (the ledgers the vouchers use) and tally-vouchers.xml (one voucher for each book entry). The CSV files
// (export.ts) are the guaranteed way into any accountant's tool; these two are for an accountant who uses TallyPrime and would rather import than type.
//
// Why "best effort": nothing here has been imported into a real TallyPrime. It is written from Tally's own help pages and sample XML (read 15 Nov 2026,
// docs/research/2026-11-15-razorpay-settlements-and-tally.md part B), and Tally documents some of what a voucher needs only by example. Where it is not
// documented, this file says so below. An accountant must check the first import in Tally's own Exceptions report.
//
// What is built, and why it is the plain way:
//  - masters first: Tally refuses a voucher whose ledger does not exist, so the masters file lists every ledger the vouchers use, each under a group TallyPrime has
//    by default (Cash-in-Hand, Bank Accounts, Sundry Debtors, Current Liabilities, Sales Accounts, Indirect Expenses, Duties & Taxes), so no group has to be made;
//  - plain accounting vouchers only (Receipt, Payment, Journal), the type chosen by where the cash or bank ledger sits (voucherTypeOf); No GST-invoice Sales voucher: a GST invoice needs party, GSTIN, item and tax set-up that the books do
//    not hold (and a shop's own bill is already in documents-<period>.csv);
//  - a debit is ISDEEMEDPOSITIVE Yes with a NEGATIVE amount and a credit is No with a POSITIVE one (Tally's own sample), in rupees with two decimals written from
//    integer paise by integer arithmetic (never a float). Every voucher is added up in paise before it is written and must be exactly zero ("Voucher totals do not
//    match!" is Tally's refusal otherwise): a voucher that does not add up stops the file, and export.ts then leaves the Tally files out and says so;
//  - the date is YYYYMMDD in the shop's time zone; the voucher number is the document's number, or J-<seq>; the narration carries the payment, refund, settlement or
//    bank reference (UTR) so the accountant can tick it against the bank statement. No customer is named: a case reference at most (and never a phone number);
//  - ledger names are configurable (the accountant's own chart of accounts); the defaults are accounts.ts accountantName;
//  - every value is escaped for XML, and characters XML 1.0 cannot carry are replaced with a space, so a name can never break the file.
// Not confirmed by Tally's pages, so a risk of the first import: `ALLLEDGERENTRIES.LIST` (the older sample says `LEDGERENTRIES.LIST`), the company name in SVCURRENTCOMPANY
// (it must match the open company; left out when no name is given), the file's UTF-8 header, and that a date must be inside the company's financial year.
import { accountantName, kindOf } from "./accounts.ts";
import type { Line } from "./journal.ts";
import type { RecordEntry } from "../record/record.ts";
import { localParts } from "../core/time.ts";
import { rupees } from "./export.ts";

/** What the Tally files need beyond the journal. */
export interface TallyOptions {
  /** The company's name exactly as TallyPrime shows it. Left out: the file names no company and goes into the one that is open. */
  company?: string;
  /** The accountant's own name for an account code (accounts.ts codes); any left out keep accounts.ts accountantName. */
  ledgerNames?: Readonly<Record<string, string>>;
}

/** The groups TallyPrime has by default and the ledgers here use. */
export const TALLY_GROUPS = ["Cash-in-Hand", "Bank Accounts", "Sundry Debtors", "Current Liabilities", "Sales Accounts", "Indirect Expenses", "Duties & Taxes"] as const;
type Group = (typeof TALLY_GROUPS)[number];

/** The default Tally group of an account code. Unknown codes by kind: a liability is Current Liabilities, income Sales Accounts, expense Indirect Expenses, an asset Sundry Debtors. */
export function groupOf(code: string): Group {
  switch (code) {
    case "cash": return "Cash-in-Hand";
    case "upi": case "bank": case "bank_settled": return "Bank Accounts";
    case "gateway": case "receivable": return "Sundry Debtors"; // what the payment service or a parent still owes the shop
    case "advances": case "refunds_owed": return "Current Liabilities";
    case "discounts": case "gateway_fees": case "gst_on_fees": case "written_off": return "Indirect Expenses";
    case "returns": return "Sales Accounts"; // Tally keeps sales returns under Sales Accounts
  }
  if (code.startsWith("tax_out:")) return "Duties & Taxes";
  switch (kindOf(code)) {
    case "liability": return "Current Liabilities";
    case "income": return "Sales Accounts";
    case "expense": return "Indirect Expenses";
    default: return "Sundry Debtors";
  }
}

/**
 * A voucher's type, chosen by where the cash or bank ledger sits, because TallyPrime does not let a Journal voucher carry a Cash or Bank ledger (as far as its pages
 * say; not tried): a cash or bank ledger on the debit side is a Receipt, on the credit side a Payment, on neither a Journal. Money taken in and paid out in one voucher,
 * which no book entry here makes, would be a Contra (the file would still be written; Tally has no other word for it).
 */
function voucherTypeOf(sides: { group: string; debit: boolean }[]): "Receipt" | "Payment" | "Journal" | "Contra" {
  const money = (g: string) => g === "Cash-in-Hand" || g === "Bank Accounts";
  const into = sides.some((s) => money(s.group) && s.debit);
  const outOf = sides.some((s) => money(s.group) && !s.debit);
  return into && outOf ? "Contra" : into ? "Receipt" : outOf ? "Payment" : "Journal";
}

/** Text safe inside an XML element or attribute: the five special characters escaped, and what XML 1.0 cannot carry replaced with a space. */
export function xml(text: string): string {
  return text
    .replace(/[^\u0009\u000A\u000D -퟿-�\u{10000}-\u{10FFFF}]/gu, " ")
    .replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;").replace(/'/gu, "&apos;");
}

const HEAD = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n";
function envelope(report: string, company: string | undefined, body: string): string {
  const vars = company ? `<STATICVARIABLES><SVCURRENTCOMPANY>${xml(company)}</SVCURRENTCOMPANY></STATICVARIABLES>` : "";
  return `${HEAD}<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>${report}</REPORTNAME>${vars}</REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">\n${body}</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>\n`;
}

/** A case id is `b-14` or `f-3.2`; a long run of digits could be a phone number and is left out (the same guard as export.ts). */
const caseRef = (c: string | null): string => (c === null || /\d{8,}/u.test(c) ? "" : c);

function narrationOf(first: Line, refs: Readonly<Record<string, string>>): string {
  const bits: string[] = [first.kind.replace(/_/gu, " ")];
  const c = caseRef(first.case);
  if (c) bits.push(c);
  if (refs.paymentId) bits.push(`payment ${refs.paymentId}`);
  if (refs.refundId) bits.push(`refund ${refs.refundId}`);
  if (refs.settlementId) bits.push(`settlement ${refs.settlementId}`);
  if (refs.utr) bits.push(`UTR ${refs.utr}`);
  return bits.join(", ");
}

/**
 * The two files for the journal lines given (already cut to the period). A voucher that does not add up to zero, or two ledgers whose names are the same but whose
 * groups differ, throws: the caller leaves the Tally files out and says why.
 */
export function tallyFiles(i: { lines: readonly Line[]; entries: readonly RecordEntry[]; timeZone: string } & TallyOptions): { masters: string; vouchers: string } {
  const nameOf = (code: string): string => {
    const n = (i.ledgerNames?.[code] ?? accountantName(code)).trim();
    if (n === "") throw new Error(`The ledger name for "${code}" is empty.`);
    return n;
  };
  const bySeq = new Map(i.entries.map((e) => [e.seq, e.refs]));
  const entries = new Map<number, Line[]>();
  for (const l of i.lines) { const group = entries.get(l.seq); if (group) group.push(l); else entries.set(l.seq, [l]); }

  const ledgers = new Map<string, Group>(); // ledger name -> group
  let vouchers = "";
  for (const [seq, lines] of entries) {
    const sum = lines.reduce((n, l) => n + l.debitPaise - l.creditPaise, 0);
    if (sum !== 0) throw new Error(`Voucher J-${seq} does not add up (${sum} paise): it is not written, and no Tally file is made.`);
    const first = lines[0];
    const type = voucherTypeOf(lines.map((l) => ({ group: groupOf(l.account), debit: l.debitPaise > 0 })));
    const p = localParts(Date.parse(first.at), i.timeZone);
    const date = `${p.year}${String(p.month).padStart(2, "0")}${String(p.day).padStart(2, "0")}`;
    const number = lines.find((l) => l.doc)?.doc ?? `J-${seq}`;
    let entriesXml = "";
    for (const l of lines) {
      const name = nameOf(l.account);
      const group = groupOf(l.account);
      const had = ledgers.get(name);
      if (had !== undefined && had !== group) throw new Error(`The ledger "${name}" would be made under two groups (${had} and ${group}); give the accounts different names.`);
      ledgers.set(name, group);
      const debit = l.debitPaise > 0;
      const paise = debit ? l.debitPaise : l.creditPaise;
      entriesXml += `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${xml(name)}</LEDGERNAME><ISDEEMEDPOSITIVE>${debit ? "Yes" : "No"}</ISDEEMEDPOSITIVE><AMOUNT>${debit ? "-" : ""}${rupees(paise)}</AMOUNT></ALLLEDGERENTRIES.LIST>\n`;
    }
    vouchers += `<VOUCHER VCHTYPE="${type}" ACTION="Create" OBJVIEW="Accounting Voucher View"><DATE>${date}</DATE><VOUCHERTYPENAME>${type}</VOUCHERTYPENAME><VOUCHERNUMBER>${xml(number)}</VOUCHERNUMBER><NARRATION>${xml(narrationOf(first, bySeq.get(seq) ?? {}))}</NARRATION>\n${entriesXml}</VOUCHER>\n`;
  }
  const masters = [...ledgers].map(([name, group]) => `<LEDGER NAME="${xml(name)}" ACTION="Create"><NAME>${xml(name)}</NAME><PARENT>${xml(group)}</PARENT></LEDGER>\n`).join("");
  return { masters: envelope("All Masters", i.company, masters), vouchers: envelope("Vouchers", i.company, vouchers) };
}
