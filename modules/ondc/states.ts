// Our state names to ONDC's: the order state, the fulfillment state, the payment status and the cancellation reason code.
//
// Why a table per template and not a guess from the name: Orders, Bookings and Stock orders each have their own states, and ONDC has ONE small set (retail order states Created,
// Accepted, In-progress, Completed, Cancelled; services write the same words in capitals). Some of our states have no ONDC order at all: "enquiry" or "awaiting the owner" are
// before the buyer app has an order, so they map to stage "none" rather than to Created (a made-up order on the network would be worse than no order). The tables below are
// TOTAL: `ORDER_STATES` and the others list every state of the template, the template's own test reads the template's source and fails if it has a state that is not listed
// here, and `statusOf` throws on a name it does not know instead of guessing.
//
// Read from: ONDC-RET-Specifications draft-b2c-1.2.5 api/components/enums (order, fulfillments, payment) and error_codes/Cancellation; ONDC-SRV-Specifications draft-services
// enums/order.yaml (CREATED, ACCEPTED, IN-PROGRESS, COMPLETED, CANCELLED) and its fulfillment states. See sources.ts.
import type { CancelReason, PaymentPart, PurchaseIn } from "./types.ts";

export type RetailOrderState = "Created" | "Accepted" | "In-progress" | "Completed" | "Cancelled";
export type FulfillmentState = "Pending" | "Packed" | "Order-picked-up" | "Out-for-delivery" | "Order-delivered" | "Completed";
export type PaymentStatus = "PAID" | "NOT-PAID";

/** `stage: "none"`: nothing exists on the network yet (or ever will, for a record that never left the shop). */
export interface Status { stage: "none" | "order"; order?: RetailOrderState; fulfillment?: FulfillmentState; cancelled?: CancelReason }

export const ORDERS_STATES = ["enquiry", "awaiting_owner", "awaiting_advance", "confirmed", "expired", "cancelled", "completed"] as const;
export const BOOKINGS_STATES = ["enquiry", "confirming_details", "awaiting_deposit", "needs_owner", "confirmed", "expired", "cancelled", "completed"] as const;
export const STOCK_ORDERS_STATES = ["awaiting_approval", "declined", "void", "approved", "sent", "send_unknown", "send_failed", "send_blocked", "supplier_declined", "cancelled"] as const;

const none: Status = { stage: "none" };
const ORDERS: Record<(typeof ORDERS_STATES)[number], Status> = {
  enquiry: none, awaiting_owner: none, // not an order yet: the buyer is still choosing, or the owner has not said yes
  awaiting_advance: { stage: "order", order: "Created", fulfillment: "Pending" },
  confirmed: { stage: "order", order: "Accepted", fulfillment: "Pending" },
  expired: { stage: "order", order: "Cancelled", fulfillment: "Pending", cancelled: "advance_expired" },
  cancelled: { stage: "order", order: "Cancelled", fulfillment: "Pending" }, // the reason comes from the record (`Cancellation`), default below
  completed: { stage: "order", order: "Completed" }, // the fulfillment state depends on pickup or delivery
};
const BOOKINGS: Record<(typeof BOOKINGS_STATES)[number], Status> = {
  enquiry: none, confirming_details: none,
  awaiting_deposit: { stage: "order", order: "Created", fulfillment: "Pending" },
  needs_owner: { stage: "order", order: "Created", fulfillment: "Pending" }, // paid, but the calendar would not confirm: the owner decides
  confirmed: { stage: "order", order: "Accepted", fulfillment: "Pending" },
  expired: { stage: "order", order: "Cancelled", fulfillment: "Pending", cancelled: "advance_expired" },
  cancelled: { stage: "order", order: "Cancelled", fulfillment: "Pending" },
  completed: { stage: "order", order: "Completed", fulfillment: "Completed" },
};
const STOCK: Record<(typeof STOCK_ORDERS_STATES)[number], Status> = {
  awaiting_approval: none, declined: none, void: none, send_failed: none, send_blocked: none, cancelled: none, // never reached the supplier
  approved: { stage: "order", order: "Created", fulfillment: "Pending" },
  sent: { stage: "order", order: "Created", fulfillment: "Pending" }, // refined by the supplier's answer and the goods (purchaseStatus)
  send_unknown: { stage: "order", order: "Created", fulfillment: "Pending" },
  supplier_declined: { stage: "order", order: "Cancelled", fulfillment: "Pending", cancelled: "item_unavailable" },
};

export type Template = "orders" | "bookings" | "stock-orders";
const TABLES: Record<Template, Record<string, Status>> = { orders: ORDERS, bookings: BOOKINGS, "stock-orders": STOCK };
export const statesOf = (t: Template): readonly string[] => Object.keys(TABLES[t]);

/** The ONDC status of one state name of a template. `mode` settles the fulfillment of a completed Orders order. Throws on a name it does not know. */
export function statusOf(template: Template, state: string, mode?: "pickup" | "delivery"): Status {
  const s = TABLES[template][state];
  if (!s) throw new Error(`The ${template} state "${state}" has no ONDC mapping: add it to modules/ondc/states.ts.`);
  if (template === "orders" && state === "completed") return { ...s, fulfillment: mode === "delivery" ? "Order-delivered" : "Order-picked-up" };
  return s;
}

/** A purchase order has three questions (accepted, arrived, paid) and ONDC's order one state: the supplier's yes is Accepted, some goods In-progress, all of them Completed. */
export function purchaseStatus(po: Pick<PurchaseIn, "state" | "ack" | "receipt">): Status {
  const s = statusOf("stock-orders", po.state);
  if (s.stage === "none" || s.order === "Cancelled") return s;
  if (po.ack === "declined") return { stage: "order", order: "Cancelled", fulfillment: "Pending", cancelled: "item_unavailable" };
  if (po.receipt === "full") return { stage: "order", order: "Completed", fulfillment: "Order-delivered" };
  if (po.receipt === "part" || po.receipt === "wrong_item") return { stage: "order", order: "In-progress", fulfillment: "Out-for-delivery" };
  if (po.ack === "accepted") return { stage: "order", order: "Accepted", fulfillment: "Pending" };
  return s;
}

/** The services contract writes the same states in capitals. */
export const srvStatus = (s: RetailOrderState): string => s.toUpperCase();

/** Payment status of one part, and of the whole: PAID only when every part is. An advance alone is NOT-PAID for the whole order. */
export const partStatus = (p: Pick<PaymentPart, "paid">): PaymentStatus => (p.paid ? "PAID" : "NOT-PAID");
export const wholeStatus = (parts: readonly Pick<PaymentPart, "paid">[]): PaymentStatus => (parts.length > 0 && parts.every((p) => p.paid) ? "PAID" : "NOT-PAID");

/** Our reasons to ONDC's cancellation codes (ONDC-RET error_codes/Cancellation, which the B2B contract shares; SRV's examples use the same codes). */
export const CANCEL_CODES: Record<CancelReason, { code: string; reason: string }> = {
  customer_cancelled: { code: "012", reason: "Buyer does not want product any more" },
  owner_declined: { code: "005", reason: "Merchant rejected the order" },
  advance_expired: { code: "022", reason: "Payment Failed or TTL expires" },
  item_unavailable: { code: "002", reason: "One or more items in the Order not available" },
  area_not_served: { code: "018", reason: "Delivery pin code not serviceable" },
  customer_unreachable: { code: "011", reason: "Buyer not found or cannot be contacted" },
};

/** The reason code the inbound side may see, back to ours (the ones we can act on). */
export const reasonOfCode = (code: string): CancelReason | undefined => (Object.keys(CANCEL_CODES) as CancelReason[]).find((r) => CANCEL_CODES[r].code === code);
