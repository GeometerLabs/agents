// Payments: Razorpay-shaped (payment links, payments, refunds, events), with an in-memory fake.
// Field names follow Razorpay's (snake_case, amounts in paise, times in epoch seconds) so a real adapter drops in.
// The fake's store is the record the agent reads back: "a deposit counts when Razorpay's record shows it".
import type { Clock } from "../clock.ts";
import { ApiError, TimeoutError, createFaults } from "./faults.ts";
import type { FaultOptions } from "./faults.ts";

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
  status: "created" | "paid" | "cancelled";
  short_url: string;
  amount_paid: number;
  payments: Payment[];
  created_at: number;
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

export interface NewPaymentLink { amount: number; reference_id: string; description: string }

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
  refund(paymentId: string, request: { amount: number; receipt?: string }): Promise<Refund>;
  /** Send a refund Guard held again, with those exact bytes (`call.body` of the GuardHeldError). Only after the owner approved it. */
  resendRefund(paymentId: string, body: string): Promise<Refund>;
  listRefunds(paymentId: string): Promise<Refund[]>;
}

/**
 *  - lostReply: the call is stored, then the reply is lost (the client sees a timeout).
 *  - error: the service refuses with 401, as when the key has expired.
 */
export type PaymentsFault = "lostReply" | "error";
export type PaymentsOp = "createPaymentLink" | "fetchPaymentLink" | "listPaymentLinks" | "cancelPaymentLink" | "fetchPayment" | "refund" | "listRefunds";

export interface FakePaymentsOptions {
  /** Refuse a second link with the same reference_id, as a provider that dedupes would. Default true. */
  enforceUniqueReference?: boolean;
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

  return {
    events,
    calls,
    inject: faults.inject,
    links: () => [...linkStore.values()].map(copyLink),
    refunds: () => refundStore.map((r) => ({ ...r })),

    async createPaymentLink(request) {
      const fault = begin("createPaymentLink");
      if (enforceUnique && [...linkStore.values()].some((l) => l.reference_id === request.reference_id)) {
        throw new ApiError(400, `A payment link with reference_id ${request.reference_id} already exists.`);
      }
      const id = nextId("plink");
      const link: PaymentLink = {
        id, reference_id: request.reference_id, amount: request.amount, currency: "INR", description: request.description,
        status: "created", short_url: `https://rzp.io/l/${id.replace("_", "")}`, amount_paid: 0, payments: [], created_at: seconds(),
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
      const fault = begin("refund");
      const p = findPayment(paymentId);
      if (!p) throw new ApiError(404, "No such payment.");
      if (!Number.isInteger(request.amount) || request.amount <= 0) throw new ApiError(400, "The refund amount must be a positive whole number of paise.");
      if (request.amount > p.amount - p.amount_refunded) throw new ApiError(400, "The refund is more than what is left on the payment.");
      p.amount_refunded += request.amount;
      const refund: Refund = { id: nextId("rfnd"), payment_id: paymentId, amount: request.amount, status: "processed", receipt: request.receipt, created_at: seconds() };
      refundStore.push(refund);
      emit("refund.processed", { refund: { id: refund.id, payment_id: paymentId } });
      if (fault === "lostReply") throw new TimeoutError("refund");
      return { ...refund };
    },

    async resendRefund(paymentId, body) {
      const sent = JSON.parse(body) as { amount: number; receipt?: string };
      return this.refund(paymentId, { amount: sent.amount, receipt: sent.receipt });
    },

    async listRefunds(paymentId) {
      begin("listRefunds");
      return refundStore.filter((r) => r.payment_id === paymentId).map((r) => ({ ...r }));
    },

    customerPays(linkId, opts = {}) {
      const l = linkStore.get(linkId);
      if (!l) throw new ApiError(404, "No such payment link.");
      if (l.status === "cancelled") throw new ApiError(400, "This payment link is cancelled.");
      const payment: Payment = {
        id: nextId("pay"), link_id: linkId, amount: opts.amount ?? l.amount, currency: "INR",
        status: "captured", amount_refunded: 0, created_at: seconds(),
      };
      l.payments.push(payment);
      l.amount_paid += payment.amount;
      emit("payment.captured", { payment: { id: payment.id, link_id: linkId } });
      if (l.status === "created") {
        l.status = "paid"; // the link counts as paid on the first payment; a second payment still lands (two phones)
        emit("payment_link.paid", { payment_link: { id: l.id, reference_id: l.reference_id }, payment: { id: payment.id, link_id: linkId } });
      }
      return { ...payment };
    },
  };
}
