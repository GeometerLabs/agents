// The Guard in front of the owner-marked desk (B71 part 2). An agent someone else wrote calls everything through a Guard of its own (bundle/agent/plan.ts), and the
// desk is no exception: on a server the agent's address for UPI is https://<domain>/g/<agent>/upi, which is this Guard, and the desk itself (desk.ts, hosted by the
// approvals relay's container, bundle/services/desk.ts) is its upstream. So the agent's one credential, the kill switch, the licence's wind-down, the record of every
// call and the limits below hold for the desk the way they hold for a gateway.
//
// The limits are the gateway's neutral rules where they mean the same thing (modules/payments/guard-limits.ts): a request for the deposit and nothing else, a refund
// owed never more than one deposit, the day's refund caps, and requests per hour. Two of the gateway's rules are left out on purpose:
//   - no hold for the owner above a refund limit: on UPI every refund is sent by the owner from their own UPI app, so the owner already decides each one, and a
//     hold would ask them twice (and the relay asks only about calls it can word);
//   - no once-only rule on a refund: the desk itself never owes more than the owner marked on a payment, less what is already owed (desk.ts owe()).
// The operation names are the gateway's (create_link, cancel_link, refund, the reads), so the licence's wind-down list (bundle/generate/guards.ts) refuses a new
// request and never a refund, and the record's rule names read the same.
import type { LimitsSpec, LimitsSpecIdentity, PaymentCaps } from "../guard-limits.ts";
import type { GuardRoute } from "../providers/types.ts";

/** The desk's own API, as Guard sees it. The paths are desk.ts's routes. */
export const DESK_GUARD = {
  /** The Guard's tool name (its container is g-<agent>-<module id>, like every Guard's). */
  tool: "owner-marked-desk",
  routes: [
    { method: "POST", path: "/requests", operation: "create_link" },
    { method: "GET", path: "/requests", operation: "list_links" },
    { method: "GET", path: "/requests/{id}", operation: "read_link" },
    { method: "POST", path: "/requests/{id}/claim", operation: "claim" },
    { method: "POST", path: "/requests/{id}/close", operation: "cancel_link" },
    { method: "POST", path: "/refunds", operation: "refund" },
    { method: "GET", path: "/refunds", operation: "list_refunds" },
  ] as GuardRoute[],
  amountField: "amount_paise",
  /** What the reading agent (the record job) may call: the desk's own lists, nothing that changes them. */
  reads: { record: ["list_links", "list_refunds"] },
} as const;

/**
 * The desk Guard's spec for one agent: the deposit is the only amount a request may be for, a refund owed is from 1 paisa to one deposit, and the day's caps. The
 * same numbers as a gateway agent's spec from the same settings (templates/commerce/bookings/src/guard-limits.ts paymentNumbers), so moving an agent from a gateway
 * to UPI keeps its limits. Same inputs, same bytes: the order of every array and key is part of them.
 */
export function deskLimitsSpec(identity: LimitsSpecIdentity, n: { depositPaise: number; caps: PaymentCaps }): LimitsSpec {
  if (!Number.isInteger(identity.version) || identity.version < 1) throw new Error("The spec's version must be a whole number, 1 or more.");
  const field = DESK_GUARD.amountField;
  const units = { [field]: "paise" };
  const amount = (x: number) => String(x);
  const count = (id: string, operation: string, cap: number, windowSeconds: number) => ({ id, kind: "count", operation, scope: [], cap: amount(cap), window_seconds: windowSeconds });
  return {
    schema: 1, tenant: identity.tenant, tool: DESK_GUARD.tool, name: identity.name ?? `${identity.tenant}-${DESK_GUARD.tool}`, version: identity.version, reviewed_by: identity.reviewedBy,
    approval_ttl_seconds: 900,
    routes: DESK_GUARD.routes.map((r) => ({ method: r.method, path: r.path, operation: r.operation })),
    rules: [
      { id: "deposit-amount", kind: "argument_bound", operation: "create_link", field, min: amount(n.depositPaise), max: amount(n.depositPaise), units },
      { id: "refund-at-most-deposit", kind: "argument_bound", operation: "refund", field, min: "1", max: amount(n.depositPaise), units },
    ],
    limits: [
      { id: "refund-paise-per-day", kind: "spend", operation: "refund", amount_field: field, scope: [], cap: amount(n.caps.refundPaisePerDay), window_seconds: 86_400 },
      count("refunds-per-day", "refund", n.caps.refundsPerDay, 86_400),
      count("links-per-hour", "create_link", n.caps.linksPerHour, 3_600),
      // a claim only asks the owner to look, but an agent that claims in a loop would fill the owner's phone: the same cap as requests
      count("claims-per-hour", "claim", n.caps.linksPerHour, 3_600),
    ],
    intents: [], fail_policy: [],
  };
}
