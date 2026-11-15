// post(event): the one writer of money facts, for every payments agent (Bookings, Orders, Fees, refunds.ts, a builder's own agent).
//
// It never moves money and calls nothing outside. A money fact becomes money only when the record shows it: the template has already read the payment back from the
// payments service's own list, or has the owner's mark, exactly where it writes a `confirmed` line today, and nothing a customer or the AI says reaches here. So
// post does not write a line of its own. It gives the template the money fields (`refs`, journal.ts MONEY_REFS) for the line the template writes anyway, with the
// template's own action name (`record_deposit`, `owner_marked_paid`, `open_fee`, `refund`, ...), so every reader, limit, paper and report that reads those names
// today is unchanged. What it adds:
//  - one shape: the kind, the amount in paise, the payment, how it moved and how it is known, and the document number;
//  - once: a second post of the same money (the same payment received, the same refund made, a second refund owed while one is open) gets no money fields, and
//    says so (`posted: false`): the double tap, the redelivered webhook, the lost reply's retry;
//  - a gap-free document number, worked out from the record in the same step (numbers.ts);
//  - read-back: after the template writes, the line is read through the journal. A line that is not there, or does not read as posted, throws. The runtime then
//    saves nothing of the step (modules/runtime/store.ts: one transaction), so no half-written money and no number used.
import type { Clock } from "../core/clock.ts";
import type { RecordEntry } from "../record/record.ts";
import type { Method } from "./accounts.ts";
import { serviceAccount } from "./accounts.ts";
import { Journal, MONEY_REFS, checkSettlementRow } from "./journal.ts";
import type { Evidence, LegacyMap, MoneyKind, ReceivedFor } from "./journal.ts";
import { formatNumber, fyOf, fyStartMs, nextNumber } from "./numbers.ts";
import type { Series } from "./numbers.ts";

/**
 * The shop's tax status decides what its documents are called and what they may show (docs/research/2026-11-15-india-gst-invoicing.md):
 *  - unregistered (the default): a receipt, a bill, a refund note; no GSTIN, no tax line, no word "tax";
 *  - composition: a bill of supply with the legend "composition taxable person, not eligible to collect tax on supplies" (CGST r.5(1)(f)); no tax lines.
 * A regular GST-registered shop is not supported yet (the owner's decision, plan Q8): its documents carry tax at receipt and need a CA's reading first.
 */
export type TaxStatus = "unregistered" | "composition";

export interface AccountingShop { timezone: string; status?: TaxStatus }

/**
 * A money fact. `case` is the booking, order or fee it belongs to (the record line's case). `owed` names one refund owed until it is made, cancelled or kept:
 * for a gateway refund it is the refund's receipt, `<case>:<payment>` (modules/payments/refunds.ts); for a refund the owner pays by hand, the owner-marked ledger's
 * id (`upr-N`).
 */
export type MoneyEvent =
  | { kind: "received"; case: string; paymentId: string; amountPaise: number; method: Method; evidence: Evidence; for: ReceivedFor }
  | { kind: "fee_charged"; case: string; amountPaise: number }
  | { kind: "late_fee"; case: string; amountPaise: number }
  | { kind: "discount"; case: string; amountPaise: number }
  | { kind: "write_off"; case: string; amountPaise: number }
  | { kind: "applied"; case: string; amountPaise: number; /** A service id, or "orders". */ service: string }
  | { kind: "kept"; case: string; amountPaise: number; why: "late_cancellation" }
  | { kind: "kept"; case: string; owed: string; why: "late_mark_kept" }
  | { kind: "refund_owed"; case: string; owed: string; paymentId: string; amountPaise: number }
  | { kind: "refund_made"; case: string; owed: string; paymentId: string; amountPaise: number; method: Method; evidence: Evidence; /** The provider's or the owner-marked ledger's refund id; left out only for a person's word. */ refundId?: string }
  | { kind: "refund_cancelled"; case: string; owed: string; why: "owner_said_no" | "expired" | "refused" | "failed" }
  | { kind: "correction"; case: string | null; reverses: number; why: "owner" | "accountant" }
  /**
   * One row of the payment service's settlement report, for the case of the payment it is about (the books know the payment already: a row for one they do not know
   * is never posted, settlements.ts lists it). `entityId` is the payment's or the refund's own id, `paymentId` the payment either way. The figures are the row's own,
   * in paise; checkSettlementRow decides how the fee reads, and `feeBasis` is what it decided (written to the record, so a reader sees which way it was).
   */
  | { kind: "settled"; case: string; settlementId: string; utr: string; entityId: string; rowType: "payment" | "refund"; paymentId: string; amountPaise: number; feePaise: number; taxPaise: number; creditPaise: number; debitPaise: number; /** When the payment service settled it, epoch seconds (the settlements file shows the day). */ settledAt?: number };

/** The template writes its own line with these refs merged in last, and returns nothing that matters: the line is read back from the record. */
export type WriteMoneyLine = (refs: Record<string, string>) => unknown;

export interface Posted { posted: boolean; doc?: string; /** Why nothing was posted (a repeat), for the line's notes. */ why?: string }

export interface Accounting {
  post(event: MoneyEvent, write: WriteMoneyLine): Posted;
  /** The journal, caught up with the record. */
  journal(): Journal;
}

/** Which documents an event issues, and in which series (numbers.ts). A bill for work done is issued only by a composition shop (a bill of supply). */
function seriesOf(event: MoneyEvent, status: TaxStatus): Series | null {
  switch (event.kind) {
    case "received": return "RCT";
    case "fee_charged": case "late_fee": return "BILL";
    case "applied": return status === "composition" ? "BILL" : null;
    case "refund_made": return "CN";
    default: return null;
  }
}

function checkAmount(event: MoneyEvent): void {
  if (!("amountPaise" in event)) return;
  const a = event.amountPaise;
  if (!Number.isSafeInteger(a) || a <= 0) throw new Error(`A ${event.kind} of ${a} paise cannot be posted: an amount is a whole number of paise above 0.`);
}

export function createAccounting(o: { record: { entries(): readonly RecordEntry[] }; shop: AccountingShop; legacy: LegacyMap; clock: Clock }): Accounting {
  const status: TaxStatus = o.shop.status ?? "unregistered";
  if (status !== "unregistered" && status !== "composition") throw new Error(`The tax status "${String(status)}" is not supported: a shop is "unregistered" or "composition" (a regular GST-registered shop is not supported yet).`);
  const book = new Journal(o.legacy);
  const caughtUp = (): Journal => book.addAll(o.record.entries());

  /** Why this event would count money a second time, or nothing new, or null when it is new. */
  function repeat(j: Journal, e: MoneyEvent): string | null {
    switch (e.kind) {
      case "received": return j.identities.has(`received:${e.paymentId}`) ? `payment ${e.paymentId} is already counted` : null;
      case "fee_charged": return j.identities.has(`fee:${e.case}`) ? `the fee ${e.case} is already charged` : null;
      case "late_fee": return j.identities.has(`late:${e.case}`) ? `the late fee of ${e.case} is already charged` : null;
      case "applied": return j.identities.has(`applied:${e.case}`) ? `the deposit of ${e.case} is already applied` : null;
      case "kept": return "owed" in e ? (j.openOwed(e.owed) === 0 ? `no refund is owed under ${e.owed}` : null) : (j.identities.has(`kept:${e.case}`) ? `the deposit of ${e.case} is already kept` : null);
      case "refund_owed": return j.openOwed(e.owed) > 0 ? `a refund is already owed under ${e.owed}` : null;
      case "refund_made": return j.identities.has(e.refundId ? `made:${e.refundId}` : `made:${e.owed}:${e.evidence}`) ? `refund ${e.refundId ?? e.owed} is already counted` : null;
      case "refund_cancelled": return j.openOwed(e.owed) === 0 ? `no refund is owed under ${e.owed}` : null;
      case "correction": return j.identities.has(`correction:${e.reverses}`) ? `entry ${e.reverses} is already corrected` : null;
      case "settled": return j.identities.has(`settled:${e.settlementId}:${e.entityId}`) ? `row ${e.entityId} of settlement ${e.settlementId} is already counted` : null;
      default: return null;
    }
  }

  function refsOf(e: MoneyEvent, doc: string | undefined): Record<string, string> {
    const R = MONEY_REFS;
    const refs: Record<string, string> = { [R.kind]: e.kind };
    if ("amountPaise" in e) refs[R.amount] = String(e.amountPaise);
    if ("paymentId" in e) refs[R.paymentId] = e.paymentId;
    if ("owed" in e) refs[R.owed] = e.owed;
    if ("method" in e) refs[R.method] = e.method;
    if ("evidence" in e) refs[R.evidence] = e.evidence;
    if (e.kind === "received") refs[R.for] = e.for;
    if (e.kind === "applied") refs[R.service] = e.service;
    if (e.kind === "refund_made" && e.refundId) refs[R.refundId] = e.refundId;
    if ("why" in e) refs[R.why] = e.why;
    if (e.kind === "correction") refs[R.reverses] = String(e.reverses);
    if (e.kind === "settled") {
      const check = checkSettlementRow({ type: e.rowType, amount: e.amountPaise, fee: e.feePaise, tax: e.taxPaise, credit: e.creditPaise, debit: e.debitPaise });
      if (!check.ok) throw new Error(`A settlement row of ${e.entityId} cannot be posted: ${check.why}.`); // before anything is written
      Object.assign(refs, { [R.settlementId]: e.settlementId, [R.utr]: e.utr, [R.entity]: e.entityId, [R.rowType]: e.rowType, [R.fee]: String(e.feePaise), [R.tax]: String(e.taxPaise), [R.credit]: String(e.creditPaise), [R.debit]: String(e.debitPaise), [R.basis]: check.basis, ...(e.settledAt !== undefined ? { [R.settledAt]: String(e.settledAt) } : {}) });
    }
    if (doc) refs[R.doc] = doc;
    return refs;
  }

  return {
    journal: caughtUp,
    post(event, write) {
      checkAmount(event);
      if (event.kind === "applied" && event.service !== "orders") serviceAccount(event.service); // refuses an id the accounts cannot carry, before anything is written
      const j = caughtUp();
      const again = repeat(j, event);
      if (again !== null) { write({}); return { posted: false, why: again }; }
      const series = seriesOf(event, status);
      let doc: string | undefined;
      if (series) {
        const fy = fyOf(o.clock.now(), o.shop.timezone);
        doc = formatNumber(nextNumber(o.record.entries(), series, fy, fyStartMs(fy, o.shop.timezone)));
      }
      const refs = refsOf(event, doc);
      const before = o.record.entries().length;
      write(refs);
      const entries = o.record.entries();
      const line = entries.at(-1);
      if (entries.length !== before + 1 || !line) throw new Error(`The ${event.kind} line was not written as one record entry, so it is not counted (and the step is not saved).`);
      if (line.booking !== event.case) throw new Error(`The ${event.kind} line was written for ${line.booking ?? "no case"}, not ${event.case ?? "no case"}; it is not counted.`);
      for (const [k, v] of Object.entries(refs)) if (line.refs[k] !== v) throw new Error(`The ${event.kind} line's ${k} is "${line.refs[k]}", not "${v}"; it is not counted.`);
      const problems = j.problems.length;
      j.addAll(entries);
      if (j.linesOf(line.seq).length === 0) throw new Error(`The ${event.kind} line cannot be read as money: ${j.problems.slice(problems).map((p) => p.why).join("; ") || "it gave no lines"}.`);
      return { posted: true, ...(doc ? { doc } : {}) };
    },
  };
}

/** The money kinds, for a caller that lists them. */
export type { MoneyKind };
