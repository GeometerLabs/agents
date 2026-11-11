// The owner-marked desk: payments the owner marks (UPI), offered to an agent someone else wrote (B71). UPI has no provider API for Guard to sit in front of, so an own
// agent cannot be given an address that "is UPI". Instead it calls this desk, on Geometer's side, for what a template does with the same ledger:
//
//   POST /requests                {reference, amount_paise, customer, description?, service?, slot_ms?}   a request: the pay link (and who is paid); the owner is told to expect it
//   GET  /requests?reference=R    the requests for one reference          GET /requests/{id}    one request
//   POST /requests/{id}/claim     {via: "screenshot" | "words" | "button"}  the customer says they paid: the owner is asked to look. It marks NOTHING paid
//   POST /requests/{id}/close     the agent no longer counts on it (a hold that ran out); a mark the owner makes later is kept apart
//   POST /refunds                 {payment_id, amount_paise, why}         a refund the owner owes, never more than was marked on that payment and not yet owed
//   GET  /refunds?payment_id=P    the refunds owed on a payment, and whether the owner marked each sent
//
// "paid" in a request's answer is true only when the OWNER's marks cover the amount: the codes are sent only to the owner, the owner's replies reach the desk from
// Geometer's inbox (ownerSays), and nothing the agent sends can mark a payment. Every step is written to the record under the same names the templates use
// (MARK_ACTIONS), so the unfinished-work list and the report read an own agent's UPI money the way they read a template's.
//
// What the desk cannot check for an agent we did not write: whether the agent tells the customer "paid" or "booked" before the desk says so (only the crash test
// reads its words), whether it takes money some other way (its own UPI ID or link in a message), and what amounts it writes in its own text. It holds no money and
// sees none: the owner's mark is the only proof, as for every UPI shop.
import type { Clock } from "../../core/clock.ts";
import type { PaymentSettings } from "../providers/index.ts";
import { ownerMarkedOf } from "../providers/index.ts";
import { ownerMarkChoices } from "./buttons.ts";
import type { MarkButtonLabels } from "./buttons.ts";
import type { Choice } from "../../language/interactive.ts";
import { closeRequest, leftOn, markReceived, markRefund, openRequest, owedOn, reminded, remindersDue, requestOfMark, oweRefund } from "./ledger.ts";
import type { MarkState, MarkedRequest, OwedRefund } from "./ledger.ts";
import { parseMarkReply } from "./owner.ts";
import { MARK_ACTIONS } from "./obligations.ts";

/** A message for the owner: one of the templates' owner_upi_* messages, its facts, and the buttons that carry the one-use code. The host renders and sends it. */
export interface DeskNotice { template: string; facts: Record<string, unknown>; choices?: Choice[] }

/** One line of the record, under the templates' own names. */
export interface DeskEntry { booking: string; conversation: string; action: string; outcome: "confirmed" | "blocked" | "held_for_owner"; refs: Record<string, string>; notes?: string }

export interface DeskOptions {
  clock: Clock;
  /** The shop's payment block: an owner-marked module (UPI), whose link and payee the requests carry. */
  payment: PaymentSettings;
  /** The owner's number: only a message from it can mark anything. */
  owner: string;
  state: MarkState;
  /** Called after every change, so the host saves the state in the same step. */
  save(state: MarkState): void;
  record(entry: DeskEntry): void;
  tellOwner(notice: DeskNotice): Promise<boolean>;
  /** The owner's button labels in the owner's language. */
  labels: MarkButtonLabels;
}

/**
 * A request as the agent sees it. `paid` is the owner's word, never the agent's or the customer's. Each "payment" is a mark the owner made (`marked_by` is always
 * "owner": the record keeps it as the owner's statement, never as a provider's confirmation, B74), with the time it was made, which the own agent's record job reads
 * through the desk's Guard (bundle/agent/record.ts).
 */
export interface DeskRequest {
  id: string; reference: string; amount_paise: number; pay_url: string; pay_to: { id: string; name: string };
  status: MarkedRequest["status"]; paid_paise: number; left_paise: number; paid: boolean;
  payments: { id: string; amount_paise: number; after_close: boolean; marked_at_ms: number; marked_by: "owner" }[];
}

/** A refund the owner owes, as the agent and the record job see it: `sent` and `kept` are the owner's marks, with when they were made. */
export interface DeskRefund { id: string; reference: string; payment_id: string; amount_paise: number; state: OwedRefund["state"]; sent: boolean; owed_at_ms: number; settled_at_ms?: number }

export type DeskReply = { status: number; body: unknown };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const whole = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const REF = /^[A-Za-z0-9._:-]{1,40}$/u;

// UPI has no provider API for Guard to sit in front of, so the desk gives the agent the same payments interface backed by the owner's marks.
export function createDesk(o: DeskOptions) {
  const marked = ownerMarkedOf(o.payment);
  if (!marked) throw new Error("The desk is for a payment module the owner marks (UPI); this shop's module confirms by itself.");
  const { state } = o;
  const customerOf = (r: MarkedRequest) => r.customer ?? "";

  const view = (r: MarkedRequest): DeskRequest => {
    const paid = r.marks.filter((m) => !m.afterClose).reduce((n, m) => n + m.amountPaise, 0);
    return {
      id: r.id, reference: r.reference, amount_paise: r.amountPaise, pay_url: r.link, pay_to: marked.payTo, status: r.status, paid_paise: paid, left_paise: leftOn(r),
      paid: paid >= r.amountPaise, payments: r.marks.map((m) => ({ id: m.id, amount_paise: m.amountPaise, after_close: m.afterClose === true, marked_at_ms: m.atMs, marked_by: "owner" as const })),
    };
  };
  const facts = (r: MarkedRequest, more: Record<string, unknown> = {}) => ({
    bookingRef: r.reference, customerPhone: customerOf(r), depositInr: r.amountPaise / 100, upiCode: r.code ?? undefined, ...(r.service ? { serviceName: r.service } : {}),
    ...(r.slotMs !== undefined ? { slotMs: r.slotMs } : {}), ...more,
  });
  const received = (r: MarkedRequest): Choice[] | undefined => (r.code ? ownerMarkChoices(o.labels, { kind: "received", code: r.code, amountInr: leftOn(r) / 100 }) : undefined);
  const log = (r: MarkedRequest | OwedRefund, action: string, outcome: DeskEntry["outcome"], refs: Record<string, string>, notes?: string) =>
    o.record({ booking: "reference" in r ? r.reference : r.caseId, conversation: "reference" in r ? customerOf(r) : r.customer, action, outcome, refs, ...(notes ? { notes } : {}) });

  async function request(body: unknown): Promise<DeskReply> {
    if (!isObj(body) || typeof body.reference !== "string" || !REF.test(body.reference) || !whole(body.amount_paise) || typeof body.customer !== "string" || !/^\+\d{8,15}$/u.test(body.customer)) {
      return { status: 400, body: { error: "Send {\"reference\": \"b-1\", \"amount_paise\": 20000, \"customer\": \"+919811111111\"}: a reference of up to 40 letters, digits and . _ : -, a whole number of paise above zero, and the customer's number with + and the country code." } };
    }
    // look first: one open request per reference and amount, so an agent that asks again after a lost answer gets the same one
    const open = state.requests.find((r) => r.reference === body.reference && r.amountPaise === body.amount_paise && r.status !== "cancelled");
    if (open) return { status: 200, body: view(open) };
    let r: MarkedRequest;
    try { r = openRequest(state, marked!.payLink, { amount: body.amount_paise, reference_id: body.reference, description: typeof body.description === "string" ? body.description.slice(0, 120) : "" }, o.clock.now()); }
    catch (e) { return { status: 400, body: { error: (e as Error).message } }; }
    // who and what, kept in the request itself (plain JSON in the saved state), so a restart keeps them
    r.customer = body.customer;
    if (typeof body.service === "string") r.service = body.service.slice(0, 80);
    if (whole(body.slot_ms)) r.slotMs = body.slot_ms;
    o.save(state);
    log(r, MARK_ACTIONS.request, "confirmed", { requestId: r.id, reference: r.reference, amountPaise: String(r.amountPaise) }, "a request to the shop's own UPI ID, for an agent someone else wrote; it counts as paid only when the owner marks it received");
    // the owner is told to expect it when the agent said what it is for; otherwise the first word to the owner is the customer's claim
    if (r.service && r.slotMs !== undefined) await o.tellOwner({ template: "owner_upi_expected", facts: facts(r), ...(received(r) ? { choices: received(r) } : {}) });
    return { status: 200, body: view(r) };
  }

  async function claim(id: string, body: unknown): Promise<DeskReply> {
    const r = state.requests.find((x) => x.id === id);
    if (!r) return { status: 404, body: { error: `No request ${id}.` } };
    const via = isObj(body) && (body.via === "screenshot" || body.via === "button" || body.via === "words") ? body.via : "words";
    log(r, MARK_ACTIONS.claim, "confirmed", { requestId: r.id, via, to: "owner" }, `the customer says they paid (${via === "screenshot" ? "a screenshot, which is not proof" : via}); nothing is marked paid, the owner is asked to look`);
    if (leftOn(r) > 0 && r.code) await o.tellOwner({ template: "owner_upi_claim", facts: facts(r), ...(received(r) ? { choices: received(r) } : {}) });
    return { status: 200, body: view(r) };
  }

  function close(id: string): DeskReply {
    const r = state.requests.find((x) => x.id === id);
    if (!r) return { status: 404, body: { error: `No request ${id}.` } };
    const was = r.status;
    closeRequest(r, o.clock.now());
    o.save(state);
    if (was !== r.status) log(r, MARK_ACTIONS.closed, "confirmed", { requestId: r.id }, "the agent closed the request; a mark the owner makes later is still recorded, and is kept apart");
    return { status: 200, body: view(r) };
  }

  async function owe(body: unknown): Promise<DeskReply> {
    if (!isObj(body) || typeof body.payment_id !== "string" || !whole(body.amount_paise)) return { status: 400, body: { error: "Send {\"payment_id\": \"upi-pay-2\", \"amount_paise\": 20000, \"why\": \"cancelled\"}." } };
    const r = requestOfMark(state, body.payment_id);
    const mark = r?.marks.find((m) => m.id === body.payment_id);
    if (!r || !mark) return { status: 404, body: { error: `No payment ${body.payment_id} was marked by the owner.` } };
    // never more than the owner marked on that payment, less what is already owed on it: the same money is never owed twice
    const left = mark.amountPaise - owedOn(state, mark.id);
    if (body.amount_paise > left) {
      log(r, MARK_ACTIONS.refundOwed, "blocked", { paymentId: mark.id, amountPaise: String(body.amount_paise) }, `refused: only ${left} paise of this payment is not yet owed back`);
      return { status: 409, body: { error: `Only ${left} paise of payment ${mark.id} is not already owed back.` } };
    }
    const refund = oweRefund(state, { caseId: r.reference, customer: customerOf(r), paymentId: mark.id, amountPaise: body.amount_paise, why: typeof body.why === "string" ? body.why.slice(0, 120) : "the agent asked" }, o.clock.now());
    o.save(state);
    log(refund, MARK_ACTIONS.refundOwed, "held_for_owner", { refundId: refund.id, paymentId: mark.id, amountPaise: String(refund.amountPaise) }, "owed back by the owner, who sends it from their own UPI app; the agent never sends money");
    await o.tellOwner({ template: "owner_upi_refund_owed", facts: { bookingRef: r.reference, customerPhone: refund.customer, refundInr: refund.amountPaise / 100, upiCode: refund.code ?? undefined }, choices: ownerMarkChoices(o.labels, { kind: "refund", code: refund.code!, keepAllowed: false }) });
    return { status: 200, body: refundView(refund) };
  }

  const refundView = (r: OwedRefund): DeskRefund => ({ id: r.id, reference: r.caseId, payment_id: r.paymentId, amount_paise: r.amountPaise, state: r.state, sent: r.state === "done", owed_at_ms: r.owedAtMs, ...(r.doneAtMs !== undefined ? { settled_at_ms: r.doneAtMs } : {}) });

  /** A message from the owner's own number (Geometer's inbox gives the desk a copy). Only a reply with a code the desk issued marks anything; a picture never does. */
  async function ownerSays(m: { from: string; text: string; reply?: { id: string } }): Promise<"marked" | "refund" | "already" | "unknown" | "not_ours"> {
    if (m.from !== o.owner) return "not_ours";
    const reply = parseMarkReply(m);
    if (!reply) return "not_ours";
    const now = o.clock.now();
    if (reply.kind === "received") {
      const result = markReceived(state, reply.code, reply.amountPaise, now);
      o.save(state);
      if (result.kind === "already" || result.kind === "already_refund") { await o.tellOwner({ template: "owner_upi_already", facts: {} }); return "already"; }
      if (result.kind !== "marked") { await o.tellOwner({ template: "owner_upi_unknown", facts: {} }); return "unknown"; }
      const r = result.request;
      log(r, MARK_ACTIONS.marked, "confirmed", { paymentId: result.mark.id, requestId: r.id, amountPaise: String(result.mark.amountPaise), markedBy: "owner" },
        result.afterClose ? "marked received by the owner after the request was closed: kept apart, it pays nothing open" : "marked paid by owner: from the owner's own number, with a one-use code");
      const markedInr = result.mark.amountPaise / 100;
      if (result.afterClose) {
        // B71 part 2, as a template does (lateMark): money marked after the request was closed is owed back unless the owner keeps it for something they give
        // another way, and the owner's message carries that refund's own code (it used to carry none, and could not be worded on a server)
        const owed = oweRefund(state, { caseId: r.reference, customer: customerOf(r), paymentId: result.mark.id, amountPaise: result.mark.amountPaise, why: "marked received after the request was closed", keepAllowed: true }, now);
        o.save(state);
        log(owed, MARK_ACTIONS.refundOwed, "held_for_owner", { refundId: owed.id, paymentId: owed.paymentId, amountPaise: String(owed.amountPaise) }, "marked received after the request was closed: owed back by the owner, or kept for something given another way");
        await o.tellOwner({ template: "owner_upi_late", facts: facts(r, { markedInr, refundInr: markedInr, upiCode: owed.code ?? undefined }), choices: ownerMarkChoices(o.labels, { kind: "refund", code: owed.code!, keepAllowed: true }) });
      }
      else if (!result.full) await o.tellOwner({ template: "owner_upi_part", facts: facts(r, { markedInr: (r.amountPaise - leftOn(r)) / 100, leftInr: leftOn(r) / 100 }), ...(received(r) ? { choices: received(r) } : {}) });
      else await o.tellOwner({ template: "owner_upi_marked", facts: facts(r, { markedInr }) });
      return "marked";
    }
    const result = markRefund(state, reply.code, reply.kind === "kept" ? "kept" : "done", now);
    o.save(state);
    if (result.kind === "already") { await o.tellOwner({ template: "owner_upi_already", facts: {} }); return "already"; }
    if (result.kind !== "done" && result.kind !== "kept") { await o.tellOwner({ template: "owner_upi_unknown", facts: {} }); return "unknown"; }
    const r = result.refund;
    log(r, result.kind === "kept" ? MARK_ACTIONS.refundKept : MARK_ACTIONS.refundDone, "confirmed", { refundId: r.id, paymentId: r.paymentId, amountPaise: String(r.amountPaise) }, "the owner marked the refund sent from their UPI app");
    await o.tellOwner({ template: result.kind === "kept" ? "owner_upi_refund_kept" : "owner_upi_refund_marked", facts: { bookingRef: r.caseId, refundInr: r.amountPaise / 100 } });
    return "refund";
  }

  /** The clock's share: remind the owner of refunds still owed, at most REFUND_REMINDERS_MAX times (then they stay on the unfinished-work list). */
  async function tick(): Promise<void> {
    for (const r of remindersDue(state, o.clock.now())) {
      reminded(r, o.clock.now());
      o.save(state);
      const told = await o.tellOwner({ template: "owner_upi_refund_reminder", facts: { bookingRef: r.caseId, customerPhone: r.customer, refundInr: r.amountPaise / 100, upiCode: r.code ?? undefined }, ...(r.code ? { choices: ownerMarkChoices(o.labels, { kind: "refund", code: r.code, keepAllowed: false }) } : {}) });
      log(r, MARK_ACTIONS.refundReminder, told ? "confirmed" : "blocked", { refundId: r.id, amountPaise: String(r.amountPaise) }, `reminder ${r.reminders} of a refund the owner still owes`);
    }
  }

  /** The desk's HTTP routes, as a handler of a method, a path, a query and a parsed JSON body (the host checks the agent's credential first). */
  async function handle(method: string, path: string, query: URLSearchParams, body: unknown): Promise<DeskReply> {
    if (method === "POST" && path === "/requests") return request(body);
    if (method === "GET" && path === "/requests") {
      const ref = query.get("reference");
      return { status: 200, body: { requests: state.requests.filter((r) => ref === null || r.reference === ref).map(view) } };
    }
    let m = /^\/requests\/([A-Za-z0-9-]{1,40})$/u.exec(path);
    if (m && method === "GET") { const r = state.requests.find((x) => x.id === m![1]); return r ? { status: 200, body: view(r) } : { status: 404, body: { error: `No request ${m[1]}.` } }; }
    m = /^\/requests\/([A-Za-z0-9-]{1,40})\/claim$/u.exec(path);
    if (m && method === "POST") return claim(m[1], body);
    m = /^\/requests\/([A-Za-z0-9-]{1,40})\/close$/u.exec(path);
    if (m && method === "POST") return close(m[1]);
    if (method === "POST" && path === "/refunds") return owe(body);
    if (method === "GET" && path === "/refunds") {
      const pid = query.get("payment_id");
      return { status: 200, body: { refunds: state.refunds.filter((r) => pid === null || r.paymentId === pid).map(refundView) } };
    }
    return { status: 404, body: { error: `The desk has no ${method} ${path}.` } };
  }

  return { handle, ownerSays, tick, view };
}

export type Desk = ReturnType<typeof createDesk>;
