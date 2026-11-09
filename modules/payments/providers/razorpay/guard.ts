// What Guard needs to know of Razorpay's API to hold a shop's limits in front of it: the routes, the operation names the neutral rules refer to, the amount field
// and its unit, the once-only key for a refund, and the calls that are never allowed. The rules themselves (a bound on a link's amount, a bound and the owner's
// approval on a refund, one refund per payment, the day's caps) are the same for every gateway: modules/payments/guard-limits.ts.
//
// These strings ARE the deployed Guard: the tool name names the Guard's container, state volume and credentials, and the routes and operations are in every bundle
// Guard has loaded. Changing any of them changes every Razorpay shop's spec; bundle/test/payment-guard-golden.test.ts pins the bytes. The routes are the shipped
// Razorpay template's (monorepo deploy/pathways/bookings/razorpay/spec.json), in its order.
import type { GatewayGuard } from "../types.ts";

export const RAZORPAY_GUARD: GatewayGuard = {
  tool: "razorpay",
  upstream: "api.razorpay.com:443",
  secretFile: "razorpay_authorization",
  routes: [
    { method: "POST", path: "/v1/payment_links", operation: "create_link" },
    { method: "GET", path: "/v1/payment_links", operation: "list_links" },
    { method: "GET", path: "/v1/payment_links/{id}", operation: "read_link" },
    { method: "POST", path: "/v1/payment_links/{id}/cancel", operation: "cancel_link" },
    { method: "GET", path: "/v1/payments/{id}", operation: "read_payment" },
    { method: "POST", path: "/v1/payments/{payment_id}/refund", operation: "refund" },
    { method: "GET", path: "/v1/payments/{id}/refunds", operation: "list_refunds" },
    { method: "POST", path: "/v1/payouts", operation: "payout" },
  ],
  ops: { createRequest: "create_link", listRequests: "list_links", readRequest: "read_link", cancelRequest: "cancel_link", readPayment: "read_payment", refund: "refund", listRefunds: "list_refunds" },
  forbidden: [{ ruleId: "no-payouts", operation: "payout" }],
  amountField: "amount",
  units: "paise",
  // Razorpay's refund `receipt` is its own idempotency key; Guard derives the once-only key from the payment, and the agent may send this header too.
  refundOnce: { keyFields: ["payment_id"], idempotencyHeader: "X-Refund-Idempotency" },
  fields: { paymentId: "payment_id", reference: "reference_id" },
  // The reading credential looks at the provider's own state and changes nothing; the panel's check reads one empty list.
  reads: { record: ["list_links", "read_link", "read_payment", "list_refunds"], panel: ["list_links"] },
};
