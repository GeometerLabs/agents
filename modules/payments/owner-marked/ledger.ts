// Payments marked paid by the owner: the requests the agent has sent, the owner's marks, and the refunds the owner owes. For every template, and for every
// payment module that cannot confirm a payment by itself (PaymentCapabilities.confirmsAutomatically false: UPI today, modules/payments/providers/upi).
//
// With such a module nothing the agent can reach sees the money: the customer pays the shop directly (its own UPI ID, from their own app), and the owner sees it in
// theirs. So "paid" is the owner's word, given the way an approval is given (modules/approvals/): a reply from the owner's own number, through the inbox, carrying a
// fresh one-use code that was sent only to the owner. A customer's screenshot or "I have paid" is never a payment here; only the owner's mark is.
//
// The state lives in the template's own store (`store.upi`, the key it has always had), so it is saved with the rest of a step, in the same transaction, and a
// restart keeps it. It is plain JSON. `markedPayments` is a view over it in the neutral shape (payments.ts): a request's `pay_url` is the link the provider wrote
// (for UPI, the `upi://pay` link), and each owner's mark is a "payment" on it. That is what lets a template keep one flow and one rule, "a payment counts when the
// payment record shows it", with the owner's marks as the payment record.
//
// What is different from a gateway, and handled here:
//  - A mark is for the amount the owner says. The reply button is for the exact amount still asked; "received K7M2QX 150" is another amount. A mark that leaves
//    some still to pay uses its code up and makes a new code for the rest, so a code is used once and the same mark sent twice counts once.
//  - A request closed by the agent (a hold that ran out, a fee whose amount changed) keeps its code: the owner may still see the money later, and that mark is
//    recorded as received. What it means for the booking or the fee is the template's to decide.
//  - A refund is never sent by the agent. It is owed by the owner, tracked until the owner marks it done ("refunded <code>"), and the owner is reminded.
import { newCode } from "../../approvals/code.ts";
import type { Clock } from "../../core/clock.ts";
import { HOUR } from "../../core/time.ts";
import type { NewPaymentRequest, Payment, PaymentRequest, Payments, Refund } from "../payments.ts";
/** The provider's link for one request: the exact amount, and the reference as its note (providers/index.ts ownerMarkedOf). Never the owner's code. */
export type PayLink = (request: { amountPaise: number; note: string }) => string;

/** One mark by the owner: "I see this much from this request in my payment app". */
export interface OwnerMark { id: string; amountPaise: number; atMs: number; /** True when the request had already been closed by the agent (the hold ran out). */ afterClose?: boolean }

export interface MarkedRequest {
  /** "upi-3": the request's own id (it is the "link" id the template keeps). */
  id: string;
  /** The template's reference for what it pays for: "b-3", "f-3.2". */
  reference: string;
  amountPaise: number;
  description: string;
  /** The provider's link (for UPI the `upi://pay` link). It holds the reference, never the code. */
  link: string;
  /** The owner's live one-use code for this request, or null once the request is paid in full. Never sent to the customer and never written into the record. */
  code: string | null;
  /** Codes this request has used up, so a second reply with one is "already counted", not "unknown". */
  usedCodes: string[];
  status: "created" | "partially_paid" | "paid" | "cancelled";
  acceptPartial?: boolean;
  createdAtMs: number;
  closedAtMs?: number;
  marks: OwnerMark[];
  /** Where the QR picture of the link is, once it was made (https, for WhatsApp to fetch). */
  imageLink?: string;
  /** Set by the desk (desk.ts) for an agent someone else wrote, which has no booking of ours to name them: the customer, and what the money is for. */
  customer?: string;
  service?: string;
  slotMs?: number;
}

export interface OwedRefund {
  /** "upr-2". */
  id: string;
  /** The booking or fee it belongs to. */
  caseId: string;
  customer: string;
  /** The mark it gives back (a "payment" id). */
  paymentId: string;
  amountPaise: number;
  /** Why it is owed, in the template's words ("cancelled", "paid twice", "after the hold"). Kept in the record's notes. */
  why: string;
  state: "owed" | "done" | "kept";
  /** The owner's one-use code to mark it done; null once used. */
  code: string | null;
  usedCodes: string[];
  owedAtMs: number;
  doneAtMs?: number;
  /** Reminders sent to the owner so far, and when the next one is due. */
  reminders: number;
  nextReminderAtMs: number;
  /** The owner may also say "kept": the money paid for something they will give another way (a booking made again by hand). Only offered where that is true. */
  keepAllowed?: boolean;
}

export interface MarkState { seq: number; requests: MarkedRequest[]; refunds: OwedRefund[] }

// A fresh shop starts with nothing sent, marked or owed; one function so the stores and tests start from the same shape.
export const emptyMarkState = (): MarkState => ({ seq: 0, requests: [], refunds: [] });

/** How long after a refund became owed the owner is first reminded, and between reminders; and how many reminders at most. After that it stays in the unfinished work. */
export const REFUND_REMINDER_EVERY_MS = 24 * HOUR;
export const REFUND_REMINDERS_MAX = 3;

const paidOf = (r: MarkedRequest) => r.marks.reduce((n, m) => n + m.amountPaise, 0);
/** What is still asked on a request, in paise (0 once paid in full or more). */
export const leftOn = (r: MarkedRequest): number => Math.max(0, r.amountPaise - paidOf(r));

/** A code no request or refund holds, live or used. */
function freshCode(state: MarkState): string {
  const taken = new Set<string>([...state.requests.flatMap((r) => [r.code ?? "", ...r.usedCodes]), ...state.refunds.flatMap((r) => [r.code ?? "", ...r.usedCodes])]);
  let code = newCode();
  for (let i = 0; taken.has(code) && i < 50; i++) code = newCode();
  return code;
}

/** Make a request. The note in the link is the reference, so the owner sees it beside the money in their payment app. */
export function openRequest(state: MarkState, payLink: PayLink, r: NewPaymentRequest, nowMs: number): MarkedRequest {
  const request: MarkedRequest = {
    id: `upi-${++state.seq}`, reference: r.reference_id, amountPaise: r.amount, description: r.description,
    link: payLink({ amountPaise: r.amount, note: r.reference_id }),
    code: freshCode(state), usedCodes: [], status: "created", createdAtMs: nowMs, marks: [], ...(r.part_payments ? { acceptPartial: true } : {}),
  };
  state.requests.push(request);
  return request;
}

export type MarkResult =
  | { kind: "marked"; request: MarkedRequest; mark: OwnerMark; /** Paid in full with this mark. */ full: boolean; /** The request had been closed (a hold that ran out). */ afterClose: boolean }
  | { kind: "already"; request: MarkedRequest }
  | { kind: "already_refund"; refund: OwedRefund }
  | { kind: "unknown" }
  | { kind: "bad_amount"; request: MarkedRequest };

const findByCode = <T extends { code: string | null; usedCodes: string[] }>(list: T[], code: string) => ({ live: list.find((x) => x.code === code), used: list.find((x) => x.usedCodes.includes(code)) });

/**
 * The owner says they received money for the request with this code: `amountPaise`, or, left out, exactly what is still asked. The code is used up. If the request is
 * still not paid in full (and not closed), a new code is made for the rest, so the owner can mark it again when the rest comes.
 */
export function markReceived(state: MarkState, code: string, amountPaise: number | undefined, nowMs: number): MarkResult {
  const { live, used } = findByCode(state.requests, code);
  if (!live) {
    if (used) return { kind: "already", request: used };
    const refund = findByCode(state.refunds, code);
    if (refund.live || refund.used) return { kind: "already_refund", refund: (refund.live ?? refund.used)! };
    return { kind: "unknown" };
  }
  const amount = amountPaise ?? (leftOn(live) > 0 ? leftOn(live) : live.amountPaise);
  if (!Number.isInteger(amount) || amount <= 0 || amount > 10 * live.amountPaise) return { kind: "bad_amount", request: live };
  const afterClose = live.status === "cancelled";
  const mark: OwnerMark = { id: `upi-pay-${++state.seq}`, amountPaise: amount, atMs: nowMs, ...(afterClose ? { afterClose: true } : {}) };
  live.marks.push(mark);
  live.usedCodes.push(code);
  const full = paidOf(live) >= live.amountPaise;
  if (!afterClose) live.status = full ? "paid" : "partially_paid";
  live.code = full || afterClose ? null : freshCode(state);
  return { kind: "marked", request: live, mark, full, afterClose };
}

/** The agent closes a request it no longer wants paid (the hold ran out, the amount changed). Its code stays live: a mark that comes later is still recorded. */
export function closeRequest(request: MarkedRequest, nowMs: number): void {
  if (request.status === "created" || request.status === "partially_paid") { request.status = "cancelled"; request.closedAtMs = nowMs; }
}

/** A refund the owner owes. The agent never sends it; the owner pays it from their own payment app and marks it done. */
export function oweRefund(state: MarkState, r: { caseId: string; customer: string; paymentId: string; amountPaise: number; why: string; keepAllowed?: boolean }, nowMs: number): OwedRefund {
  const refund: OwedRefund = {
    id: `upr-${++state.seq}`, caseId: r.caseId, customer: r.customer, paymentId: r.paymentId, amountPaise: r.amountPaise, why: r.why, state: "owed",
    code: freshCode(state), usedCodes: [], owedAtMs: nowMs, reminders: 0, nextReminderAtMs: nowMs + REFUND_REMINDER_EVERY_MS, ...(r.keepAllowed ? { keepAllowed: true } : {}),
  };
  state.refunds.push(refund);
  return refund;
}

export type RefundMarkResult = { kind: "done" | "kept"; refund: OwedRefund } | { kind: "already"; refund: OwedRefund } | { kind: "not_allowed"; refund: OwedRefund } | { kind: "unknown" };

/** The owner says the refund with this code is paid ("refunded"), or, where that is allowed, that they keep the money for something they will give another way ("kept"). */
export function markRefund(state: MarkState, code: string, how: "done" | "kept", nowMs: number): RefundMarkResult {
  const { live, used } = findByCode(state.refunds, code);
  if (!live) return used ? { kind: "already", refund: used } : { kind: "unknown" };
  if (how === "kept" && !live.keepAllowed) return { kind: "not_allowed", refund: live };
  live.state = how;
  live.doneAtMs = nowMs;
  live.usedCodes.push(code);
  live.code = null;
  return { kind: how, refund: live };
}

/** Refunds still owed whose next reminder to the owner is due. The caller sends it and calls `reminded`. */
export const remindersDue = (state: MarkState, nowMs: number): OwedRefund[] =>
  state.refunds.filter((r) => r.state === "owed" && r.reminders < REFUND_REMINDERS_MAX && r.nextReminderAtMs <= nowMs);

// Mutates in place and schedules the next nudge, so the caller sends a reminder and then records it; remindersDue stops at the maximum.
export function reminded(refund: OwedRefund, nowMs: number): void {
  refund.reminders += 1;
  refund.nextReminderAtMs = nowMs + REFUND_REMINDER_EVERY_MS;
}

/** What is owed back on one mark (owed or done), so a second refund is never owed for the same money. */
export const owedOn = (state: MarkState, paymentId: string): number =>
  state.refunds.filter((r) => r.paymentId === paymentId && r.state !== "kept").reduce((n, r) => n + r.amountPaise, 0);

/** The request a mark was made on. */
export const requestOfMark = (state: MarkState, paymentId: string): MarkedRequest | undefined => state.requests.find((r) => r.marks.some((m) => m.id === paymentId));

/** Thrown by the view for what an owner-marked module cannot do: send a refund. A template routes refunds to `oweRefund` when the module cannot refund by itself; reaching this is a bug, so it is loud. */
export class OwnerPaysError extends Error {}

/**
 * The requests and the owner's marks in the neutral shape (payments.ts), so a template's "look first, write, read back" and "a payment counts when the payment record
 * shows it" work unchanged. `refund` and `resendRefund` throw: the owner pays refunds (`oweRefund`).
 */
export function markedPayments(state: MarkState, payLink: PayLink, clock: Clock): Payments {
  const seconds = (ms: number) => Math.floor(ms / 1000);
  const asPayment = (r: MarkedRequest, m: OwnerMark): Payment => ({ id: m.id, request_id: r.id, amount: m.amountPaise, currency: "INR", status: "received", amount_refunded: owedOn(state, m.id), created_at: seconds(m.atMs) });
  const asLink = (r: MarkedRequest): PaymentRequest => ({
    id: r.id, reference_id: r.reference, amount: r.amountPaise, currency: "INR", description: r.description, status: r.status, pay_url: r.link,
    amount_paid: paidOf(r), payments: r.marks.map((m) => asPayment(r, m)), created_at: seconds(r.createdAtMs), ...(r.acceptPartial ? { part_payments: true, min_first_payment: 100 } : {}),
  });
  const refundsOf = (paymentId: string): Refund[] => state.refunds.filter((r) => r.paymentId === paymentId && r.state !== "kept").map((r) => ({ id: r.id, payment_id: r.paymentId, amount: r.amountPaise, status: r.state === "done" ? "processed" : "pending", receipt: `${r.caseId}:${r.paymentId}`, created_at: seconds(r.owedAtMs) }));
  return {
    async createRequest(request) { return asLink(openRequest(state, payLink, request, clock.now())); },
    async fetchRequest(id) { const r = state.requests.find((x) => x.id === id); return r ? asLink(r) : null; },
    async listRequests(query = {}) {
      return state.requests.filter((r) => (query.reference_id === undefined || r.reference === query.reference_id) && (query.payment_id === undefined || r.marks.some((m) => m.id === query.payment_id))).map(asLink);
    },
    async cancelRequest(id) {
      const r = state.requests.find((x) => x.id === id);
      if (!r) throw new OwnerPaysError(`No request ${id}.`);
      closeRequest(r, clock.now());
      return asLink(r);
    },
    async fetchPayment(id) { const r = requestOfMark(state, id); const m = r?.marks.find((x) => x.id === id); return r && m ? asPayment(r, m) : null; },
    async refund() { throw new OwnerPaysError("Here the agent never sends a refund: the owner pays it from their own payment app, and the agent tracks it (oweRefund)."); },
    async resendRefund() { throw new OwnerPaysError("There is no held refund to send again: the owner pays refunds."); },
    async listRefunds(paymentId) { return refundsOf(paymentId); },
  };
}

/** The Payments an owner-marked shop's agent is handed from outside: none. Any call is a bug (a gateway path reached on a shop with no gateway), and it says so. */
export const noGateway: Payments = new Proxy({} as Payments, {
  get: (_t, name) => (name === "then" ? undefined : async () => { throw new OwnerPaysError(`This shop's payments are marked paid by the owner: it has no gateway account, so "${String(name)}" cannot be called.`); }),
});
