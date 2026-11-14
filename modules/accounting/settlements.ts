// The daily settlement read: once a day, the rows the payment service settled yesterday are read and posted to the books (plan section 8).
//
// Why a module function that the three templates call from their tick, and not a job of its own: the agent already wakes on a tick, already writes the record, and
// the books are a fold over that record (journal.ts), so a settlement row is one more record line, in the hash chain, with nothing else to keep. The one function here
// is the same for Bookings, Orders and Fees, and a template only asks it when its payment module `readsSettlements` (providers/types capabilities): a UPI shop never calls
// it, because nothing it can reach says what was paid into the bank.
//
// What it does, in order, and the rule behind each:
//  - yesterday is read once. A day that was read has a `settlements_read` line in the record, and is not read again (the record is the memory: no state of its own, so a
//    restore from a copy cannot read twice). A read that fails writes nothing and is tried again on the next tick; nothing is guessed from a half answer.
//  - a payment or refund row whose payment the books know (it came through this agent, `received:<payment>`) is posted with post(): `settled`, once per row
//    (identity `settled:<settlement>:<row>`), with the fee checked both ways (journal.ts checkSettlementRow);
//  - a row that is held (`on_hold`, or not settled) is not money in the bank: it is listed, and posted when it comes round again settled;
//  - a row for a payment the books do not know (not taken through the agent) is not posted: it is listed ("a payment not through your assistant");
//  - a row whose figures fit neither way of reading the fee, or a row of another kind (an adjustment, a transfer), is listed and never posted. An adjustment is kept
//    in the record with its figures so the accountant's settlements file can show it.
// A listed row is one `settlement_listed` line (no money refs, so the journal ignores it), at most once per reason, settlement and row.
//
// Written from Razorpay's documents and run only against the stand-in: no live key exists, so no real settlement has been read. The first one is the check
// (modules/Deferred.md): which way the fee reads, whether Payment Link and QR payments appear, how instant settlements look.
import type { Payments, SettlementRow } from "../payments/payments.ts";
import type { Language } from "../language/languages.ts";
import type { ActionRecord, Outcome } from "../record/record.ts";
import type { Accounting } from "./post.ts";
import { dayRange } from "./periods.ts";
import { localParts } from "../core/time.ts";

/** The record's action names for these lines. Persisted, so never renamed. */
export const SETTLEMENT_ACTIONS = { read: "settlements_read", row: "settlement_row", listed: "settlement_listed" } as const;

/** Why a row was listed and not posted. */
export type ListedWhy = "held" | "unknown_payment" | "problem" | "adjustment" | "other";

/** What the job needs: the payments adapter, the books, and the template's own way of writing a record line (its log), so the line carries the template's names. */
export interface SettlementsInput {
  payments: Payments;
  accounting: Accounting;
  /** The agent's own record: the job reads it for the days already read and the rows already listed, and appends its lines to it (the same chain every line is in). */
  record: ActionRecord;
  /** Who a system line is filed under (the owner's number, as the templates' own system lines are) and its language; no customer is ever named. */
  conversation: string;
  language: Language;
  nowMs: number;
  timeZone: string;
}

export interface SettlementsResult {
  /** read: the day was read now. already_read: it was read before, nothing done. failed: the read failed, nothing written, the next tick tries again. */
  status: "read" | "already_read" | "failed";
  day: string;
  posted: number;
  listed: number;
  error?: string;
}

/** One record line of the job, for a case or none. */
function line(i: SettlementsInput, l: { case: string | null; action: string; outcome: Outcome; refs: Record<string, string>; notes: string; inputs: unknown }) {
  return i.record.append({ conversation: i.conversation, booking: l.case, action: l.action, inputs: l.inputs, outcome: l.outcome, language: i.language, notes: l.notes, refs: l.refs });
}

const dayKey = (d: { year: number; month: number; day: number }): string => `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;

/** Yesterday in the shop's time zone (the day before the one `nowMs` falls in). */
export function yesterdayOf(nowMs: number, timeZone: string): { year: number; month: number; day: number } {
  const p = localParts(dayRange(nowMs, timeZone).fromMs - 1, timeZone);
  return { year: p.year, month: p.month, day: p.day };
}

export async function readSettlementsOnce(i: SettlementsInput): Promise<SettlementsResult> {
  const day = yesterdayOf(i.nowMs, i.timeZone);
  const key = dayKey(day);
  if (!i.payments.readSettlements) throw new Error("This payment module cannot read settlements: ask its capabilities (readsSettlements) before calling this.");
  if (i.record.entries().some((e) => e.action === SETTLEMENT_ACTIONS.read && e.refs.day === key)) return { status: "already_read", day: key, posted: 0, listed: 0 };

  let rows: SettlementRow[];
  try {
    rows = await i.payments.readSettlements(day);
  } catch (e) {
    return { status: "failed", day: key, posted: 0, listed: 0, error: (e as Error).message };
  }

  let posted = 0;
  let listed = 0;
  const list = (why: ListedWhy, row: SettlementRow, notes: string, caseId: string | null = null): void => {
    const id = `${why}:${row.settlementId ?? ""}:${row.entityId}`;
    if (i.record.entries().some((e) => e.action === SETTLEMENT_ACTIONS.listed && `${e.refs.why}:${e.refs.settlementId ?? ""}:${e.refs.entity}` === id)) return;
    line(i, { case: caseId, action: SETTLEMENT_ACTIONS.listed, outcome: "unconfirmed", notes, inputs: { entity: row.entityId }, refs: rowRefs(row, { why }) });
    listed++;
  };

  for (const row of rows) {
    if (row.type !== "payment" && row.type !== "refund") { list(row.type === "adjustment" ? "adjustment" : "other", row, `a ${row.type} row of settlement ${row.settlementId ?? "?"}: not booked, kept for the settlements file`); continue; }
    if (row.onHold || !row.settled) { list("held", row, "the payment service is holding this row; it is not in the bank"); continue; }
    if (row.settlementId === null || row.utr === null) { list("problem", row, "a settled row with no settlement id or bank reference is not posted"); continue; }
    const paymentId = row.type === "payment" ? row.entityId : row.paymentId;
    const known = paymentId === null ? null : caseOf(i.accounting, paymentId);
    if (known === null || paymentId === null) { list("unknown_payment", row, "a payment that did not go through the assistant: left out of the books"); continue; }
    try {
      const done = i.accounting.post(
        { kind: "settled", case: known, settlementId: row.settlementId, utr: row.utr, entityId: row.entityId, rowType: row.type, paymentId, amountPaise: row.amount, feePaise: row.fee, taxPaise: row.tax, creditPaise: row.credit, debitPaise: row.debit, ...(row.settledAt !== null ? { settledAt: row.settledAt } : {}) },
        (money) => line(i, { case: known, action: SETTLEMENT_ACTIONS.row, outcome: "confirmed", refs: money, inputs: { settlement: row.settlementId, entity: row.entityId }, notes: Object.keys(money).length === 0 ? "already counted" : "the payment service paid this out" }),
      );
      if (done.posted) posted++;
    } catch (e) {
      list("problem", row, (e as Error).message, known);
    }
  }

  line(i, { case: null, action: SETTLEMENT_ACTIONS.read, outcome: "confirmed", refs: { day: key, rows: String(rows.length), posted: String(posted), listed: String(listed) }, inputs: { day: key }, notes: `read ${rows.length} settlement rows for ${key}` });
  return { status: "read", day: key, posted, listed };
}

/** The case the books hold this gateway payment under, or null when the books never counted it. */
function caseOf(accounting: Accounting, paymentId: string): string | null {
  const j = accounting.journal();
  const seq = j.identities.get(`received:${paymentId}`);
  return seq === undefined ? null : j.linesOf(seq)[0]?.case ?? null;
}

/** The row's own ids and figures as record refs (no customer: a payment id and a settlement are the provider's). */
function rowRefs(row: SettlementRow, extra: Record<string, string>): Record<string, string> {
  return {
    ...extra, entity: row.entityId, rowType: row.type, amountPaise: String(row.amount), feePaise: String(row.fee), taxPaise: String(row.tax), creditPaise: String(row.credit), debitPaise: String(row.debit),
    ...(row.settlementId ? { settlementId: row.settlementId } : {}), ...(row.utr ? { utr: row.utr } : {}), ...(row.paymentId ? { paymentId: row.paymentId } : {}), ...(row.settledAt !== null ? { settledAt: String(row.settledAt) } : {}),
  };
}
