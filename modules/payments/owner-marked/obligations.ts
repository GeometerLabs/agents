// What a shop whose payments the owner marks (UPI today) still owes a person, read from the record alone: the payments the owner has not yet confirmed, and the refunds the owner owes and has not yet
// marked done. They are two kinds of the unfinished-work registry (modules/unfinished, plan B31), which reads a shop's exported record (no store, no customer's
// number), so this is a fold over record entries. The entries it reads are written by every template the same way (the names below);
// test/owner-marked.test.ts folds a hand-made record, and each template's UPI crash test folds a whole world's.
//
// "Not yet confirmed" is not every request a customer has not paid: an unpaid fee is the parent's business, not the owner's. A request is the owner's to look at
// when there is a reason to think the money came: the customer said they paid (a screenshot, the button, the words), or the owner marked part of it and the rest
// is still open. It stops being listed when the owner marks the rest, or when the agent closes the request (a hold that ran out, a fee whose amount changed).
import type { RecordEntry } from "../../record/record.ts";
import type { Obligation, ObligationKind } from "../../unfinished/registry.ts";

/** The record's names for payments the owner marks, the same in every template. They keep their "upi_" values: records already written use them, and so do reports. */
export const MARK_ACTIONS = {
  /** A request was made and sent to the customer. refs: requestId, reference, amountPaise. */
  request: "upi_request",
  /** The customer says they paid (refs.via: screenshot, button or words). It marks nothing paid; the owner is asked to look. refs: requestId. */
  claim: "upi_paid_claim",
  /** The owner marked money received ("marked paid by owner"): it counts as paid, and the record says by whom. refs: paymentId, requestId, amountPaise, markedBy. */
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

export interface MarkObligation {
  kind: "upi_payment_unconfirmed" | "upi_refund_owed";
  /** The booking or fee it is about ("b-3", "f-3"). */
  case: string;
  /** The customer's number, as the record keeps it. The registry's kinds leave it out: an exported record carries none. */
  customer: string;
  /** Still to be confirmed, or owed back, in paise. */
  amountPaise: number;
  /** When it began: the time of the record entry that opened it (the claim, the part mark, the refund owed). */
  since: string;
  /** The request or refund in the shop's own store ("upi-3", "upr-5"). */
  id: string;
  /** Plain words for the list (English; the panel has the sentence in four languages). */
  title: string;
}

export const OBLIGATION_TITLES: Record<MarkObligation["kind"], string> = {
  upi_payment_unconfirmed: "UPI payment not yet confirmed by the owner",
  upi_refund_owed: "Refund owed by the owner, not yet marked done",
};

const confirmed = (e: RecordEntry) => e.outcome === "confirmed";

/** The open owner-marked obligations in this record, oldest first. */
export function markObligations(entries: readonly RecordEntry[]): MarkObligation[] {
  const requests = new Map<string, { entry: RecordEntry; amountPaise: number; reason?: RecordEntry }>();
  const markedOn = new Map<string, number>();
  const closed = new Set<string>();
  const owed = new Map<string, { entry: RecordEntry; amountPaise: number }>();
  const settled = new Set<string>();
  for (const e of entries) {
    const r = e.refs;
    if (e.action === MARK_ACTIONS.request && confirmed(e) && r.requestId) requests.set(r.requestId, { entry: e, amountPaise: Number(r.amountPaise) });
    else if (e.action === MARK_ACTIONS.claim && r.requestId) { const q = requests.get(r.requestId); if (q && !q.reason) q.reason = e; }
    else if (e.action === MARK_ACTIONS.marked && confirmed(e) && r.requestId) {
      markedOn.set(r.requestId, (markedOn.get(r.requestId) ?? 0) + Number(r.amountPaise));
      const q = requests.get(r.requestId);
      if (q) q.reason = e; // a part marked: the rest is now the owner's to look for, from this mark on
    } else if (e.action === MARK_ACTIONS.closed && confirmed(e) && r.requestId) closed.add(r.requestId);
    else if (e.action === MARK_ACTIONS.refundOwed && e.outcome === "held_for_owner" && r.refundId) owed.set(r.refundId, { entry: e, amountPaise: Number(r.amountPaise) });
    else if ((e.action === MARK_ACTIONS.refundDone || e.action === MARK_ACTIONS.refundKept) && confirmed(e) && r.refundId) settled.add(r.refundId);
  }
  const out: MarkObligation[] = [];
  for (const [id, { entry, amountPaise, reason }] of requests) {
    const left = amountPaise - (markedOn.get(id) ?? 0);
    if (left > 0 && reason && !closed.has(id)) out.push({ kind: "upi_payment_unconfirmed", case: entry.booking ?? "", customer: entry.conversation, amountPaise: left, since: reason.time, id, title: OBLIGATION_TITLES.upi_payment_unconfirmed });
  }
  for (const [id, { entry, amountPaise }] of owed) {
    if (!settled.has(id)) out.push({ kind: "upi_refund_owed", case: entry.booking ?? "", customer: entry.conversation, amountPaise, since: entry.time, id, title: OBLIGATION_TITLES.upi_refund_owed });
  }
  return out.sort((a, b) => a.since.localeCompare(b.since) || a.id.localeCompare(b.id));
}

/**
 * The two kinds, for the unfinished-work registry (modules/unfinished/builtin.ts lists them). Facts: the case, the amount in rupees, and the request or refund id; never
 * the customer's number. The one recovery that fits both is `ask_owner_again`: the agent sends the owner the same notice again, with the code and the button.
 * A thing younger than the registry's grace is still the agent's own (the owner was told a moment ago), so it is not listed yet.
 */
function kind(id: MarkObligation["kind"]): ObligationKind {
  return {
    id,
    templates: "all",
    detect(input) {
      const out: Obligation[] = [];
      for (const o of markObligations(input.entries)) {
        if (o.kind !== id) continue;
        const since = Date.parse(o.since);
        if (Number.isFinite(since) && input.nowMs - since < input.options.graceMs) continue;
        out.push({ kind: id, caseId: o.case, sinceMs: Number.isFinite(since) ? since : null, facts: { case: o.case, amountInr: o.amountPaise / 100, ref: o.id }, actions: ["ask_owner_again"] });
      }
      return out;
    },
  };
}

export const MARK_OBLIGATION_KINDS: readonly ObligationKind[] = [kind("upi_payment_unconfirmed"), kind("upi_refund_owed")];
