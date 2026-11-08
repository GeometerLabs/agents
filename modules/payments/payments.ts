// Payments: Razorpay-shaped (payment links, payments, refunds, events), with an in-memory fake.
// Field names follow Razorpay's (snake_case, amounts in paise, times in epoch seconds) so a real adapter drops in.
// The fake's store is the record the agent reads back: "a deposit counts when Razorpay's record shows it".
import type { Clock } from "../core/clock.ts";
import { ApiError, GuardAlreadyDoneError, GuardConflictError, GuardHeldError, GuardOutcomeUnknownError, GuardRefusedError, GuardUnavailableError, TimeoutError, createFaults } from "../core/faults.ts";
import type { FaultOptions, GuardInfo, SentCall } from "../core/faults.ts";
import type { GuardModel } from "./guard-model.ts";

export interface Payment {
  id: string; // pay_...
  link_id: string;
  amount: number; // paise
  currency: "INR";
  status: "captured";
  amount_refunded: number; // paise
  created_at: number; // epoch seconds
}

export interface PaymentLink {
  id: string; // plink_...
  reference_id: string; // ours: the booking id
  amount: number; // paise
  currency: "INR";
  description: string;
  /** Razorpay's: "partially_paid" is a link that accepts part payments and has had some, not all. A link that does not accept them goes from created to paid on its first payment. */
  status: "created" | "partially_paid" | "paid" | "cancelled";
  short_url: string;
  amount_paid: number;
  payments: Payment[];
  created_at: number;
  /** Set on a link that takes part payments (Razorpay's `accept_partial` and `first_min_partial_amount`, in paise). Left out on any other link. */
  accept_partial?: boolean;
  first_min_partial_amount?: number;
}

export interface Refund {
  id: string; // rfnd_...
  payment_id: string;
  amount: number; // paise
  /** "pending" is Razorpay's word for accepted, not yet paid out. A "failed" refund is not a refund and is never listed. */
  status: "pending" | "processed";
  receipt?: string;
  created_at: number;
  /** Guard answered from its record: this is the first reply to the same refund, and nothing was sent again. */
  replayed?: boolean;
}

export type PaymentEventName = "payment_link.paid" | "payment.captured" | "refund.processed";

/** A webhook. The body is a snapshot at the time of the event; the agent re-fetches before it trusts it. */
export interface PaymentEvent {
  id: string; // evt_...
  event: PaymentEventName;
  created_at: number;
  /**
   * `payment.link_id` is missing on a real `payment.captured` event: Razorpay's body names the payment and its order, not the
   * payment link. The agent then finds the link by the payment id (listPaymentLinks({ payment_id })).
   */
  payload: { payment_link?: { id: string; reference_id: string }; payment?: { id: string; link_id?: string }; refund?: { id: string; payment_id: string } };
}

export interface NewPaymentLink { amount: number; reference_id: string; description: string; accept_partial?: boolean; first_min_partial_amount?: number }

export interface Payments {
  createPaymentLink(request: NewPaymentLink): Promise<PaymentLink>;
  fetchPaymentLink(id: string): Promise<PaymentLink | null>;
  listPaymentLinks(query?: { reference_id?: string; payment_id?: string }): Promise<PaymentLink[]>;
  cancelPaymentLink(id: string): Promise<PaymentLink>;
  fetchPayment(id: string): Promise<Payment | null>;
  /**
   * Refund part or all of a payment, never more than what is left on it. Through a Guard, a refund above the owner's limit is not
   * done: it throws GuardHeldError (HTTP 202), carrying the exact bytes it was sent with in `call.body`.
   */
  refund(paymentId: string, request: { amount: number; receipt?: string; requestedBy?: string[] }): Promise<Refund>;
  /** Send a refund Guard held again, with those exact bytes (`call.body` of the GuardHeldError). Only after the owner approved it. */
  resendRefund(paymentId: string, body: string, requestedBy?: string[]): Promise<Refund>;
  listRefunds(paymentId: string): Promise<Refund[]>;
}

/**
 *  - lostReply: the call is stored, then the reply is lost (the client sees a timeout).
 *  - error: the service refuses with 401, as when the key has expired.
 * With a Guard model (refunds only), three more, each what a Guard would say:
 *  - guardUnavailable: Guard cannot decide (503). Nothing was sent.
 *  - uncertainHold: Guard holds the call with no approval id, because an earlier attempt may have happened.
 *  - outcomeUnknown: the refund is stored, then Guard says the outcome is unknown (504). It is not repeated.
 *  - guardRefused: Guard refuses the call before it is sent, by a limit (the day's refund cap).
 *  - serverError: the refund is stored, then the service answers 500, which Guard passes through as it came. The refund may have happened.
 */
export type PaymentsFault = "lostReply" | "error" | "guardUnavailable" | "uncertainHold" | "outcomeUnknown" | "guardRefused" | "serverError";
export type PaymentsOp = "createPaymentLink" | "fetchPaymentLink" | "listPaymentLinks" | "cancelPaymentLink" | "fetchPayment" | "refund" | "listRefunds";

export interface FakePaymentsOptions {
  /** Refuse a second link with the same reference_id, as a provider that dedupes would. Default true. */
  enforceUniqueReference?: boolean;
  /**
   * Put a Guard in front of the refunds, as there is in production: a refund above its threshold is held for the owner and answers
   * with GuardHeldError, and the identical call is sent again only after an approval (see guard-model.ts). Without it, every refund goes through.
   */
  guard?: GuardModel;
  /**
   * Whether that Guard also bounds the amount of a link (default true, as the real one does). Off for a test that makes a link under the old rules and then gives
   * Guard the new ones, which a Guard given at the start cannot be.
   */
  guardLinks?: boolean;
}

export interface FakePayments extends Payments {
  /** The customer pays the link (they can do it twice, from two phones). Emits events. */
  customerPays(linkId: string, options?: { amount?: number }): Payment;
  links(): PaymentLink[];
  refunds(): Refund[];
  /** Every event the service has emitted, in order. The harness decides when (and how often) to deliver them. */
  events: PaymentEvent[];
  inject(op: PaymentsOp, mode: PaymentsFault, options?: FaultOptions): void;
  calls: { op: PaymentsOp }[];
}

export function createFakePayments(clock: Clock, options: FakePaymentsOptions = {}): FakePayments {
  const enforceUnique = options.enforceUniqueReference ?? true;
  const guard = options.guard;
  const faults = createFaults<PaymentsOp, PaymentsFault>();
  const calls: { op: PaymentsOp }[] = [];
  const linkStore = new Map<string, PaymentLink>();
  const refundStore: Refund[] = [];
  const events: PaymentEvent[] = [];
  let seq = 1;
  const nextId = (prefix: string) => `${prefix}_${seq++}`;
  const seconds = () => Math.floor(clock.now() / 1000);

  function begin(op: PaymentsOp): PaymentsFault | undefined {
    calls.push({ op });
    const fault = faults.take(op);
    if (fault === "error") throw new ApiError(401, "Authentication failed: the API key is not valid.");
    return fault;
  }

  const copyLink = (l: PaymentLink): PaymentLink => ({ ...l, payments: l.payments.map((p) => ({ ...p })) });
  const emit = (event: PaymentEvent["event"], payload: PaymentEvent["payload"]) =>
    events.push({ id: nextId("evt"), event, created_at: seconds(), payload });
  const findPayment = (id: string) => [...linkStore.values()].flatMap((l) => l.payments).find((p) => p.id === id);

  const call = (paymentId: string, body: string): SentCall => ({ method: "POST", path: `/v1/payments/${encodeURIComponent(paymentId)}/refund`, body });
  const info = (decision: string, code: string, retry: string, reason?: string, detail: unknown = null): GuardInfo => ({ decision, code, sent: "no", retry, ...(reason ? { reason } : {}), detail });

  /** One refund call, as the service sees it after Guard (if there is one) has decided: the same bytes whether first sent or sent again. `requestedBy` is the Geo-Requested-By header's ids. */
  async function refundCall(paymentId: string, bodyText: string, requestedBy?: string[]): Promise<Refund> {
    const sentCall = call(paymentId, bodyText);
    const request = JSON.parse(bodyText) as { amount: number; receipt?: string };
    const before = faults.peek("refund");
    if (before === "guardUnavailable") {
      faults.take("refund");
      throw new GuardUnavailableError(503, "refused by the Guard: kill switch engaged: test", info("deny", "guard_unavailable", "later", "kill switch engaged: test"), sentCall);
    }
    if (before === "guardRefused") {
      faults.take("refund");
      const reason = "limit refund-paise-per-day would be exceeded (0.00 of 0.00 already reserved for this scope); refused before dispatch";
      throw new GuardRefusedError(403, `refused by the Guard: ${reason}`, info("deny", "refused_by_policy", "no", reason), sentCall, "limit", "refund-paise-per-day");
    }
    if (before === "uncertainHold") {
      faults.take("refund");
      const detail = { approval: null, status: "pending", expires_at_ms: null };
      throw new GuardHeldError(202, "held by the Guard: an earlier attempt has an unknown outcome and the provider could not be asked; the Guard will not repeat it", info("hold", "held_for_approval", "after_approval", undefined, detail), sentCall, null, null);
    }
    if (guard) {
      const decision = guard.decideRefund(paymentId, request, requestedBy);
      switch (decision.kind) {
        case "hold": {
          const detail = { approval: decision.approval, status: "pending", expires_at_ms: decision.expiresAtMs };
          const reason = "refund-needs-owner: above the threshold: a person must approve this exact call";
          throw new GuardHeldError(202, `held by the Guard: ${reason}`, info("hold", "held_for_approval", "after_approval", reason, detail), sentCall, decision.approval, decision.expiresAtMs);
        }
        case "hold_uncertain": {
          const detail = { approval: null, status: "pending", expires_at_ms: null };
          throw new GuardHeldError(202, "held by the Guard: an earlier attempt has an unknown outcome and the provider could not be asked; the Guard will not repeat it", info("hold", "held_for_approval", "after_approval", undefined, detail), sentCall, null, null);
        }
        case "refused": throw new GuardRefusedError(403, `refused by the Guard: ${decision.reason}`, info("deny", "refused_by_policy", "no", decision.reason), sentCall, "rule", decision.ruleId);
        case "conflict": throw new GuardConflictError(409, `refused by the Guard: ${decision.reason}`, info("deny", "conflict", "no", decision.reason), sentCall);
        case "already_done": throw new GuardAlreadyDoneError(409, `refused by the Guard: ${decision.reason}`, { ...info("deny", "conflict", "no", decision.reason, decision.detail), reason_code: "already_done" }, sentCall);
        case "replay": return { ...(decision.reply as Refund), replayed: true };
        case "pass": break;
      }
    }
    const fault = begin("refund");
    const p = findPayment(paymentId);
    if (!p) throw new ApiError(404, "No such payment.");
    if (!Number.isInteger(request.amount) || request.amount <= 0) throw new ApiError(400, "The refund amount must be a positive whole number of paise.");
    if (request.amount > p.amount - p.amount_refunded) throw new ApiError(400, "The refund is more than what is left on the payment.");
    p.amount_refunded += request.amount;
    const refund: Refund = { id: nextId("rfnd"), payment_id: paymentId, amount: request.amount, status: "processed", receipt: request.receipt, created_at: seconds() };
    refundStore.push(refund);
    emit("refund.processed", { refund: { id: refund.id, payment_id: paymentId } });
    if (fault === "outcomeUnknown") {
      guard?.recordUnknown(paymentId, request);
      throw new GuardOutcomeUnknownError(504, "refused by the Guard: outcome unknown: the request may or may not have reached the provider. The action may have happened; it is not repeated automatically", { decision: "unknown", code: "outcome_unknown", sent: "unknown", retry: "do_not_repeat", detail: null }, sentCall);
    }
    if (fault === "serverError") {
      guard?.recordUnknown(paymentId, request, 500);
      throw new ApiError(500, "The payments service answered 500.");
    }
    guard?.recordSent(paymentId, request, { ...refund });
    if (fault === "lostReply") throw new TimeoutError("refund");
    return { ...refund };
  }

  return {
    events,
    calls,
    inject: faults.inject,
    links: () => [...linkStore.values()].map(copyLink),
    refunds: () => refundStore.map((r) => ({ ...r })),

    async createPaymentLink(request) {
      if (guard && options.guardLinks !== false) {
        // Guard bounds the amount of a link before anything is sent: the agent only ever asks for an amount its record asks for, so this is Guard saying the same on its own.
        const decision = guard.decideLink(request.amount);
        if (decision.kind === "refused") {
          const body = JSON.stringify(request);
          throw new GuardRefusedError(403, `refused by the Guard: ${decision.reason}`, { decision: "deny", code: "refused_by_policy", sent: "no", retry: "no", reason: decision.reason, detail: null }, { method: "POST", path: "/v1/payment_links", body }, "rule", decision.ruleId);
        }
      }
      const fault = begin("createPaymentLink");
      if (enforceUnique && [...linkStore.values()].some((l) => l.reference_id === request.reference_id)) {
        throw new ApiError(400, `A payment link with reference_id ${request.reference_id} already exists.`);
      }
      const id = nextId("plink");
      const link: PaymentLink = {
        id, reference_id: request.reference_id, amount: request.amount, currency: "INR", description: request.description,
        status: "created", short_url: `https://rzp.io/l/${id.replace("_", "")}`, amount_paid: 0, payments: [], created_at: seconds(),
        ...(request.accept_partial ? { accept_partial: true, first_min_partial_amount: request.first_min_partial_amount ?? 100 } : {}),
      };
      linkStore.set(id, link);
      if (fault === "lostReply") throw new TimeoutError("payment link create");
      return copyLink(link);
    },

    async fetchPaymentLink(id) {
      begin("fetchPaymentLink");
      const l = linkStore.get(id);
      return l ? copyLink(l) : null;
    },

    async listPaymentLinks(query = {}) {
      begin("listPaymentLinks");
      return [...linkStore.values()]
        .filter((l) => (query.reference_id === undefined || l.reference_id === query.reference_id) && (query.payment_id === undefined || l.payments.some((p) => p.id === query.payment_id)))
        .map(copyLink);
    },

    async cancelPaymentLink(id) {
      const fault = begin("cancelPaymentLink");
      const l = linkStore.get(id);
      if (!l) throw new ApiError(404, "No such payment link.");
      if (l.status === "created") l.status = "cancelled";
      if (fault === "lostReply") throw new TimeoutError("payment link cancel");
      return copyLink(l);
    },

    async fetchPayment(id) {
      begin("fetchPayment");
      const p = findPayment(id);
      return p ? { ...p } : null;
    },

    async refund(paymentId, request) {
      return refundCall(paymentId, JSON.stringify({ amount: request.amount, receipt: request.receipt }), request.requestedBy); // the same bytes the live adapter sends
    },

    async resendRefund(paymentId, body, requestedBy) {
      return refundCall(paymentId, body, requestedBy);
    },


    async listRefunds(paymentId) {
      begin("listRefunds");
      return refundStore.filter((r) => r.payment_id === paymentId).map((r) => ({ ...r }));
    },

    customerPays(linkId, opts = {}) {
      const l = linkStore.get(linkId);
      if (!l) throw new ApiError(404, "No such payment link.");
      if (l.status === "cancelled") throw new ApiError(400, "This payment link is cancelled.");
      if (l.accept_partial) {
        // A link that takes part payments, as Razorpay's does: a payment is at least the link's minimum (the first one) and at most what is left.
        const left = l.amount - l.amount_paid;
        const amount = opts.amount ?? left;
        if (left <= 0) throw new ApiError(400, "This payment link is already paid.");
        if (!Number.isInteger(amount) || amount < Math.min(l.first_min_partial_amount ?? 0, left) || amount > left) throw new ApiError(400, "The amount is not allowed for this payment link.");
      }
      const payment: Payment = {
        id: nextId("pay"), link_id: linkId, amount: opts.amount ?? (l.accept_partial ? l.amount - l.amount_paid : l.amount), currency: "INR",
        status: "captured", amount_refunded: 0, created_at: seconds(),
      };
      l.payments.push(payment);
      l.amount_paid += payment.amount;
      emit("payment.captured", { payment: { id: payment.id, link_id: linkId } });
      if (l.accept_partial) {
        const was = l.status;
        l.status = l.amount_paid >= l.amount ? "paid" : "partially_paid";
        if (l.status === "paid" && was !== "paid") emit("payment_link.paid", { payment_link: { id: l.id, reference_id: l.reference_id }, payment: { id: payment.id, link_id: linkId } });
      } else if (l.status === "created") {
        l.status = "paid"; // the link counts as paid on the first payment; a second payment still lands (two phones)
        emit("payment_link.paid", { payment_link: { id: l.id, reference_id: l.reference_id }, payment: { id: payment.id, link_id: linkId } });
      }
      return { ...payment };
    },
  };
}
