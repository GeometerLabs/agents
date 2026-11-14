// The money figures of a monthly report, read from the journal (journal.ts) instead of summed again from the record by each template.
//
// Why one helper: Bookings, Orders and Fees each summed their own deposits, refunds, waivers and late fees in report/data.ts, three times the same arithmetic. The signed
// report keeps every field (the QR summary carries these figures), so what moves is only where the number is worked out: here, once, from the books. A template's
// report hands in the journal, the record's entries (the journal's lines name a record entry by `seq`; the payment a refund belongs to and what a payment was for are
// read from that entry's chained fields, never from notes), the template's LegacyMap, and the month [fromIso, toIso).
//
// What is counted, so it equals what the three reports counted before (a test per template holds the two equal on every report fixture and crash-test record):
//  - `received`: a payment received for a deposit, an advance or a fee, once per payment (the journal counts a payment once). A second payment on a link ("extra") is
//    owed back at once and was never counted as collected or as a deposit;
//  - `refunds`: a refund made, once per refund id, not one a person at the server settled by their word (those have their own row in the report). `ofDeposits`: the
//    payment was received as an advance, or the owner marked the refund sent (as the Bookings report always counted them); `ofSecondPayments`: anything else;
//  - `discounts` (a waiver) and `lateFees`: each at its own entry;
//  - a line the journal could not read because its amount is missing is still counted (count 1, paise 0) and listed under `missing`, exactly as the old sums did.
//    Orders alone read a refund line that carries no amount (an older "looked for again" line) as the amount an earlier line of the same payment kept
//    (`refundAmountFromPayment`); the other two never did;
//  - the owner's marks (a UPI payment, a cash or bank payment, a refund marked sent) were summed only for a shop whose payments module cannot confirm by itself (UPI).
//    A report passes `ownerMarks: false` for any other shop, so its signed figures stay as they were; the books themselves count every mark.
import type { Journal, LegacyMap } from "./journal.ts";
import { MONEY_REFS } from "./journal.ts";
import type { RecordEntry } from "../record/record.ts";

export interface Amount { count: number; paise: number }

export interface MonthFigures {
  /** Payments received for a deposit, an advance or a fee (Bookings `money.deposits`; Orders and Fees `money.collected`). */
  received: Amount;
  /** Refunds made (Bookings `money.refunds`; Orders and Fees `money.givenBack`), with where they came from. */
  refunds: Amount & { ofDeposits: Amount; ofSecondPayments: Amount };
  /** Fees `waivers.total`. */
  discounts: Amount;
  /** Fees `waivers.lateFeesAdded`. */
  lateFees: Amount;
  missing: { depositAmounts: number; refundAmounts: number };
}

const empty = (): Amount => ({ count: 0, paise: 0 });
const bump = (a: Amount, paise: number) => { a.count++; a.paise += paise; };

/** What a payment received was for: the new line says so in `refs.for`; an older one is read through the template's map. */
function receivedFor(e: RecordEntry, legacy: LegacyMap): string | undefined {
  if (e.refs[MONEY_REFS.kind] !== undefined) return e.refs[MONEY_REFS.kind] === "received" ? e.refs[MONEY_REFS.for] : undefined;
  return legacy.received.find((x) => x.action === e.action && x.outcome === e.outcome)?.for;
}

/** A line the journal could not read, but which is the owner's mark (its own evidence, or an older line's action). */
const isOwnerMark = (e: RecordEntry): boolean => e.refs[MONEY_REFS.evidence] === "owner_mark" || e.action === "owner_marked_paid" || e.action === "upi_refund_marked_done";

export function figuresOf(journal: Journal, entries: readonly RecordEntry[], legacy: LegacyMap, fromIso: string, toIso: string, options: { refundAmountFromPayment?: boolean; ownerMarks?: boolean } = {}): MonthFigures {
  const out: MonthFigures = { received: empty(), refunds: { ...empty(), ofDeposits: empty(), ofSecondPayments: empty() }, discounts: empty(), lateFees: empty(), missing: { depositAmounts: 0, refundAmounts: 0 } };
  // the payments received as a deposit or advance, over the whole record up to the month's end (a refund may come a month after its payment)
  const advance = new Set<string>();
  for (const e of entries) {
    if (e.time >= toIso) continue;
    const lines = journal.linesOf(e.seq);
    if (lines.length > 0 && lines[0].kind === "received" && receivedFor(e, legacy) === "advance" && e.refs.paymentId !== undefined) advance.add(e.refs.paymentId);
  }
  // the amount an earlier refund line kept for a payment, for a refund line that carries none
  const amountOfPayment = new Map<string, number>();
  if (options.refundAmountFromPayment) for (const e of entries) if (e.time < toIso && e.action === "refund" && e.refs.paymentId && e.refs.amountPaise) amountOfPayment.set(e.refs.paymentId, Number(e.refs.amountPaise));
  const refundSeen = new Set<string>(); // a refund once, by its id: a line the journal could not read for its amount is deduplicated the same way
  const problems = new Map<number, string>(journal.problems.map((p) => [p.seq, p.why]));
  for (const e of entries) {
    if (e.time < fromIso || e.time >= toIso) continue;
    const lines = journal.linesOf(e.seq);
    if (options.ownerMarks === false && (lines.length > 0 ? lines[0].evidence === "owner_mark" : isOwnerMark(e))) continue;
    if (lines.length === 0) {
      // not read as money: only an amount that is missing or wrong is counted (as before: counted, adds nothing, listed as missing)
      const why = problems.get(e.seq);
      if (why === undefined || !why.startsWith("the amount")) continue;
      const kind = e.refs[MONEY_REFS.kind];
      if (kind === "received" || (kind === undefined && legacy.received.some((x) => x.action === e.action && x.outcome === e.outcome))) {
        if (receivedFor(e, legacy) !== "extra") { out.received.count++; out.missing.depositAmounts++; }
      } else if (kind === "refund_made" || (kind === undefined && e.outcome === "confirmed" && (e.action === "refund" || e.action === "upi_refund_marked_done"))) {
        const byWord = e.refs.confirmedBy !== undefined && e.refs.refundId === undefined;
        const key = e.refs.refundId ?? `seq-${e.seq}`;
        if (byWord || refundSeen.has(key)) continue;
        refundSeen.add(key);
        const part = e.action === "upi_refund_marked_done" || advance.has(e.refs.paymentId ?? "") ? out.refunds.ofDeposits : out.refunds.ofSecondPayments;
        const fallback = amountOfPayment.get(e.refs.paymentId ?? "");
        if (fallback !== undefined && Number.isFinite(fallback)) { bump(out.refunds, fallback); bump(part, fallback); } else { out.refunds.count++; part.count++; out.missing.refundAmounts++; }
      }
      continue;
    }
    const first = lines[0];
    const total = lines.reduce((n, l) => n + l.debitPaise, 0); // every entry balances: what it moved is the sum of its debits
    switch (first.kind) {
      case "received": if (receivedFor(e, legacy) !== "extra") bump(out.received, total); break;
      case "refund_made": {
        if (first.evidence === "person_word") break;
        refundSeen.add(e.refs.refundId ?? `seq-${e.seq}`);
        bump(out.refunds, total);
        bump(first.method === "upi" || advance.has(e.refs.paymentId ?? "") ? out.refunds.ofDeposits : out.refunds.ofSecondPayments, total);
        break;
      }
      case "discount": bump(out.discounts, total); break;
      case "late_fee": bump(out.lateFees, total); break;
    }
  }
  return out;
}
