// Payments, the same for every provider (B71): a payment request, the payments made on it, refunds, and three events. A provider's module maps its own API
// onto this (modules/payments/providers/<name>/), and says what it can do (PaymentCapabilities), so a template asks that instead of branching on a provider's name.
// Amounts are in paise and times in epoch seconds, snake_case, as JSON on the wire usually is; nothing here is any one provider's word.
// The in-memory fake below is the stand-in gateway every crash test uses; its store is the record the agent reads back: "a deposit counts when the payment record shows it".
import type { Clock } from "../core/clock.ts";
import { ApiError, GuardAlreadyDoneError, GuardConflictError, GuardDeniedError, GuardHeldError, GuardOutcomeUnknownError, GuardRefusedError, GuardUnavailableError, TimeoutError, createFaults } from "../core/faults.ts";
import type { FaultOptions, GuardInfo, SentCall } from "../core/faults.ts";
import type { GuardModel } from "./guard-model.ts";

/**
 * What a provider's module can do. A template asks these, never the provider's name, so a new provider is a folder, not a branch in every template.
 *  - confirmsAutomatically: the provider itself says a payment happened (a signed webhook, and its record read back). False: a person marks it (UPI: the owner).
 *  - refundsAutomatically: the agent can send a refund through the provider, behind Guard. False: the owner pays it back by hand and the agent tracks it until marked.
 *  - takesPartPayments: one request stays open for the rest after a part is paid. False: a request is for one exact amount, and the rest needs a request of its own.
 *  - cancels: a request can be closed at the provider so it can no longer be paid. False: a request already sent can still be paid (the agent only stops counting on it).
 *  - readsBack: the provider's own record can be read, so "look first" and "read back" ask the provider. False: the agent's own store is the only record.
 */
export interface PaymentCapabilities {
  confirmsAutomatically: boolean;
  refundsAutomatically: boolean;
  takesPartPayments: boolean;
  cancels: boolean;
  readsBack: boolean;
}

export interface Payment {
  id: string;
  request_id: string;
  amount: number; // paise
  currency: "INR";
  /** Money that arrived: the provider says so, or (UPI) the owner marked it. A payment that was only started, or failed, is never listed. */
  status: "received";
  amount_refunded: number; // paise
  created_at: number; // epoch seconds
}

export interface PaymentRequest {
  id: string;
  reference_id: string; // ours: the booking id
  amount: number; // paise
  currency: "INR";
  description: string;
  /** "partially_paid" is a request that takes part payments and has had some, not all. One that does not take them goes from created to paid on its first payment. */
  status: "created" | "partially_paid" | "paid" | "cancelled";
  /** Where the customer pays: a provider's payment page, or (UPI) the `upi://pay` link. */
  pay_url: string;
  amount_paid: number;
  payments: Payment[];
  created_at: number;
  /** Set on a request that takes part payments, with the least the first may be (paise). Left out on any other request. */
  part_payments?: boolean;
  min_first_payment?: number;
}

export interface Refund {
  id: string;
  payment_id: string;
  amount: number; // paise
  /** "pending": accepted, not yet paid out (UPI: owed by the owner). "processed": paid out. "failed" is only ever a reply (the provider declined it): never listed. */
  status: "pending" | "processed" | "failed";
  receipt?: string;
  created_at: number;
  /** Guard answered from its record: this is the first reply to the same refund, and nothing was sent again. */
  replayed?: boolean;
}

/** request.paid: a request is paid in full. payment.received: money arrived on a request. refund.done: a refund was paid out. Each provider maps its own names onto these. */
export type PaymentEventName = "request.paid" | "payment.received" | "refund.done";

/** A webhook. The body is a snapshot at the time of the event; the agent re-fetches before it trusts it. */
export interface PaymentEvent {
  id: string;
  event: PaymentEventName;
  created_at: number;
  /**
   * `payment.request_id` may be missing on a payment.received event: a provider's body can name the payment and not the request it paid. The agent then finds the
   * request by the payment id (listRequests({ payment_id })).
   */
  payload: { request?: { id: string; reference_id: string }; payment?: { id: string; request_id?: string }; refund?: { id: string; payment_id: string } };
}

export interface NewPaymentRequest { amount: number; reference_id: string; description: string; part_payments?: boolean; min_first_payment?: number }

export interface Payments {
  createRequest(request: NewPaymentRequest): Promise<PaymentRequest>;
  fetchRequest(id: string): Promise<PaymentRequest | null>;
  listRequests(query?: { reference_id?: string; payment_id?: string }): Promise<PaymentRequest[]>;
  cancelRequest(id: string): Promise<PaymentRequest>;
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
 *  - declined: the provider takes the call and declines the refund (its own "failed" status): no money moves, nothing is listed, and the reply says failed.
 */
export type PaymentsFault = "lostReply" | "error" | "guardUnavailable" | "uncertainHold" | "outcomeUnknown" | "guardRefused" | "serverError" | "declined";
export type PaymentsOp = "createRequest" | "fetchRequest" | "listRequests" | "cancelRequest" | "fetchPayment" | "refund" | "listRefunds";

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
  links(): PaymentRequest[];
  refunds(): Refund[];
  /** Every event the service has emitted, in order. The harness decides when (and how often) to deliver them. */
  events: PaymentEvent[];
  inject(op: PaymentsOp, mode: PaymentsFault, options?: FaultOptions): void;
  calls: { op: PaymentsOp }[];
}

// The fake every crash test runs against; it can fail on demand (timeouts, lost replies) so the agent's careful handling is exercised.
export function createFakePayments(clock: Clock, options: FakePaymentsOptions = {}): FakePayments {
  const enforceUnique = options.enforceUniqueReference ?? true;
  const guard = options.guard;
  const faults = createFaults<PaymentsOp, PaymentsFault>();
  const calls: { op: PaymentsOp }[] = [];
  const linkStore = new Map<string, PaymentRequest>();
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

  const copyLink = (l: PaymentRequest): PaymentRequest => ({ ...l, payments: l.payments.map((p) => ({ ...p })) });
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
        case "denied_repeat": throw new GuardDeniedError(403, `refused by the Guard: ${decision.reason}`, { ...info("deny", "refused_by_policy", "no", decision.reason, decision.detail), reason_code: "denied_by_approver" }, sentCall);
        case "replay": return { ...(decision.reply as Refund), replayed: true };
        case "pass": break;
      }
    }
    const fault = begin("refund");
    const p = findPayment(paymentId);
    if (!p) throw new ApiError(404, "No such payment.");
    if (!Number.isInteger(request.amount) || request.amount <= 0) throw new ApiError(400, "The refund amount must be a positive whole number of paise.");
    if (request.amount > p.amount - p.amount_refunded) throw new ApiError(400, "The refund is more than what is left on the payment.");
    if (fault === "declined") return { id: nextId("rfd"), payment_id: paymentId, amount: request.amount, status: "failed", receipt: request.receipt, created_at: seconds() };
    p.amount_refunded += request.amount;
    const refund: Refund = { id: nextId("rfd"), payment_id: paymentId, amount: request.amount, status: "processed", receipt: request.receipt, created_at: seconds() };
    refundStore.push(refund);
    emit("refund.done", { refund: { id: refund.id, payment_id: paymentId } });
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

    async createRequest(request) {
      if (guard && options.guardLinks !== false) {
        // Guard bounds the amount of a link before anything is sent: the agent only ever asks for an amount its record asks for, so this is Guard saying the same on its own.
        const decision = guard.decideLink(request.amount);
        if (decision.kind === "refused") {
          const body = JSON.stringify(request);
          throw new GuardRefusedError(403, `refused by the Guard: ${decision.reason}`, { decision: "deny", code: "refused_by_policy", sent: "no", retry: "no", reason: decision.reason, detail: null }, { method: "POST", path: "/v1/payment_links", body }, "rule", decision.ruleId);
        }
      }
      const fault = begin("createRequest");
      if (enforceUnique && [...linkStore.values()].some((l) => l.reference_id === request.reference_id)) {
        throw new ApiError(400, `A payment link with reference_id ${request.reference_id} already exists.`);
      }
      const id = nextId("req");
      const link: PaymentRequest = {
        id, reference_id: request.reference_id, amount: request.amount, currency: "INR", description: request.description,
        status: "created", pay_url: `https://pay.example/${id}`, amount_paid: 0, payments: [], created_at: seconds(),
        ...(request.part_payments ? { part_payments: true, min_first_payment: request.min_first_payment ?? 100 } : {}),
      };
      linkStore.set(id, link);
      if (fault === "lostReply") throw new TimeoutError("payment link create");
      return copyLink(link);
    },

    async fetchRequest(id) {
      begin("fetchRequest");
      const l = linkStore.get(id);
      return l ? copyLink(l) : null;
    },

    async listRequests(query = {}) {
      begin("listRequests");
      return [...linkStore.values()]
        .filter((l) => (query.reference_id === undefined || l.reference_id === query.reference_id) && (query.payment_id === undefined || l.payments.some((p) => p.id === query.payment_id)))
        .map(copyLink);
    },

    async cancelRequest(id) {
      const fault = begin("cancelRequest");
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
      if (l.part_payments) {
        // A request that takes part payments: a payment is at least its minimum (the first one) and at most what is left.
        const left = l.amount - l.amount_paid;
        const amount = opts.amount ?? left;
        if (left <= 0) throw new ApiError(400, "This payment link is already paid.");
        if (!Number.isInteger(amount) || amount < Math.min(l.min_first_payment ?? 0, left) || amount > left) throw new ApiError(400, "The amount is not allowed for this payment link.");
      }
      const payment: Payment = {
        id: nextId("pmt"), request_id: linkId, amount: opts.amount ?? (l.part_payments ? l.amount - l.amount_paid : l.amount), currency: "INR",
        status: "received", amount_refunded: 0, created_at: seconds(),
      };
      l.payments.push(payment);
      l.amount_paid += payment.amount;
      emit("payment.received", { payment: { id: payment.id, request_id: linkId } });
      if (l.part_payments) {
        const was = l.status;
        l.status = l.amount_paid >= l.amount ? "paid" : "partially_paid";
        if (l.status === "paid" && was !== "paid") emit("request.paid", { request: { id: l.id, reference_id: l.reference_id }, payment: { id: payment.id, request_id: linkId } });
      } else if (l.status === "created") {
        l.status = "paid"; // the link counts as paid on the first payment; a second payment still lands (two phones)
        emit("request.paid", { request: { id: l.id, reference_id: l.reference_id }, payment: { id: payment.id, request_id: linkId } });
      }
      return { ...payment };
    },
  };
}
