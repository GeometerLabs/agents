// What a UPI shop still owes a person, read from the record alone: the payments the owner has not yet confirmed, and the refunds the owner owes and has not yet
// marked done. For the unfinished-work list (plan row B31), which reads a shop's exported record and nothing else, so this is a fold over record entries and needs
// no store. The entries it reads are written by every template the same way (the names below); `test/obligations.test.ts` folds a whole UPI crash-test world.
import type { RecordEntry } from "../../record/record.ts";

/** The record's names for UPI, the same in every template. */
export const UPI_ACTIONS = {
  /** A request was made and sent to the customer. refs: requestId, reference, amountPaise. */
  request: "upi_request",
  /** The owner marked money received ("marked paid by owner"): it counts as paid, and the record says by whom. refs: paymentId, requestId, amountPaise. */
  marked: "owner_marked_paid",
  /** The agent closed a request it no longer wants paid (a hold that ran out, a fee whose amount changed). refs: requestId. */
  closed: "upi_request_closed",
  /** A refund the owner owes (outcome held_for_owner). refs: refundId, paymentId, amountPaise. */
  refundOwed: "upi_refund_owed",
  /** The owner marked it paid back. refs: refundId, amountPaise. */
  refundDone: "upi_refund_marked_done",
  /** The owner kept the money for something they give another way (a booking made again by hand). refs: refundId, amountPaise. */
  refundKept: "upi_refund_kept",
  /** The owner was reminded of a refund still owed. refs: refundId. */
  refundReminder: "upi_refund_reminder",
} as const;

export interface UpiObligation {
  kind: "upi_payment_unconfirmed" | "upi_refund_owed";
  /** The booking or fee it is about ("b-3", "f-3"). */
  case: string;
  /** The customer's number, as the record keeps it. */
  customer: string;
  /** Still to be confirmed, or owed back, in paise. */
  amountPaise: number;
  /** When it began: the time of the record entry that opened it. */
  since: string;
  /** The request or refund in the shop's own store ("upi-3", "upr-5"). */
  id: string;
  /** Plain words for the list. */
  title: string;
}

export const OBLIGATION_TITLES: Record<UpiObligation["kind"], string> = {
  upi_payment_unconfirmed: "UPI payment not yet confirmed by the owner",
  upi_refund_owed: "Refund owed by the owner, not yet marked done",
};

const confirmed = (e: RecordEntry) => e.outcome === "confirmed";

/** The open UPI obligations in this record, oldest first. */
export function upiObligations(entries: readonly RecordEntry[]): UpiObligation[] {
  const requests = new Map<string, { entry: RecordEntry; amountPaise: number }>();
  const markedOn = new Map<string, number>();
  const closed = new Set<string>();
  const owed = new Map<string, { entry: RecordEntry; amountPaise: number }>();
  const settled = new Set<string>();
  for (const e of entries) {
    const r = e.refs;
    if (e.action === UPI_ACTIONS.request && confirmed(e) && r.requestId) requests.set(r.requestId, { entry: e, amountPaise: Number(r.amountPaise) });
    else if (e.action === UPI_ACTIONS.marked && confirmed(e) && r.requestId) markedOn.set(r.requestId, (markedOn.get(r.requestId) ?? 0) + Number(r.amountPaise));
    else if (e.action === UPI_ACTIONS.closed && confirmed(e) && r.requestId) closed.add(r.requestId);
    else if (e.action === UPI_ACTIONS.refundOwed && e.outcome === "held_for_owner" && r.refundId) owed.set(r.refundId, { entry: e, amountPaise: Number(r.amountPaise) });
    else if ((e.action === UPI_ACTIONS.refundDone || e.action === UPI_ACTIONS.refundKept) && confirmed(e) && r.refundId) settled.add(r.refundId);
  }
  const out: UpiObligation[] = [];
  for (const [id, { entry, amountPaise }] of requests) {
    const left = amountPaise - (markedOn.get(id) ?? 0);
    if (left > 0 && !closed.has(id)) out.push({ kind: "upi_payment_unconfirmed", case: entry.booking ?? "", customer: entry.conversation, amountPaise: left, since: entry.time, id, title: OBLIGATION_TITLES.upi_payment_unconfirmed });
  }
  for (const [id, { entry, amountPaise }] of owed) {
    if (!settled.has(id)) out.push({ kind: "upi_refund_owed", case: entry.booking ?? "", customer: entry.conversation, amountPaise, since: entry.time, id, title: OBLIGATION_TITLES.upi_refund_owed });
  }
  return out.sort((a, b) => a.since.localeCompare(b.since) || a.id.localeCompare(b.id));
}
