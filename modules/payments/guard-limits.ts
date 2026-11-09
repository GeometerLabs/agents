// ONE settings value, two places that act on it. The agent's refund limit (whole rupees in a template's settings) and Guard's `call_bound_approval`
// threshold (paise) must be the same number, or one of them is wrong in a way nobody notices: a threshold 100 times too high lets a refund through
// that the owner was never asked about (a silent fail-open); one 100 times too low makes the owner approve every refund. So Guard's side is never typed
// by hand. A template turns its settings into the numbers below; this file turns the numbers into a gateway's limits spec (monorepo
// docs/guard-limits-spec.md, schema 1), which `geo-guard compile` turns into the policy bundle.
//
// The rules are the same for every gateway (B71): a bound on a request's amount, a bound and the owner's approval on a refund, one refund per payment, the calls no
// agent may make, and the day's caps. What is the gateway's own (its routes, the names of its operations, the amount field and its unit, the once-only key) comes
// from its declaration (modules/payments/providers/<name>/guard.ts), so a client's spec is generated, not edited, and a Razorpay shop's comes out byte for byte as
// it did before the split (bundle/test/payment-guard-golden.test.ts).
import type { GatewayGuard } from "./providers/types.ts";

/** Guard's own bounds for a hold's lifetime: 60 to 604800 seconds (7 days). Checked against the real binary, see templates/commerce/bookings/Explanation.md. */
export const MIN_APPROVAL_TTL_SECONDS = 60;
export const MAX_APPROVAL_TTL_SECONDS = 604_800;
/**
 * How long a held refund waits for the owner: 24 hours. A shop owner will not answer inside 15 minutes (Guard's template default);
 * an evening request is usually seen the next morning. The customer is told "the owner will confirm", and gets a plain message if nothing comes (refund_expired).
 */
export const APPROVAL_TTL_SECONDS = 86_400;

/** Caps that settings do not carry. The defaults are the template's; a builder who wants others passes them. */
export interface PaymentCaps { refundPaisePerDay: number; refundsPerDay: number; linksPerHour: number }
export const DEFAULT_CAPS: PaymentCaps = { refundPaisePerDay: 500_000, refundsPerDay: 20, linksPerHour: 60 };

/** Whole rupees to paise. A fraction of a rupee, or a number too big to count exactly, is refused rather than rounded. */
export function rupeesToPaise(inr: number): number {
  if (!Number.isInteger(inr) || inr < 0) throw new Error(`${inr} is not a whole number of rupees, so it cannot be turned into paise.`);
  const paise = inr * 100;
  if (!Number.isSafeInteger(paise)) throw new Error(`${inr} rupees is too large to count in paise exactly.`);
  return paise;
}

/** The caps with the template's defaults under them, each checked: a whole number above zero. */
export function capsFrom(given: Partial<PaymentCaps> | undefined): PaymentCaps {
  const caps = { ...DEFAULT_CAPS, ...given };
  for (const [name, value] of Object.entries(caps)) if (!Number.isSafeInteger(value) || value < 1) throw new Error(`The cap "${name}" must be a whole number above zero.`);
  return caps;
}

/** The approval time, checked against Guard's own bounds. */
export function approvalTtlFrom(given: number | undefined): number {
  const ttl = given ?? APPROVAL_TTL_SECONDS;
  if (!Number.isInteger(ttl) || ttl < MIN_APPROVAL_TTL_SECONDS || ttl > MAX_APPROVAL_TTL_SECONDS) {
    throw new Error(`The approval time must be between ${MIN_APPROVAL_TTL_SECONDS} and ${MAX_APPROVAL_TTL_SECONDS} seconds (Guard refuses anything else).`);
  }
  return ttl;
}

export interface LimitsSpecIdentity {
  /** The client. Must equal `tenant` in that Guard's guard.toml. */
  tenant: string;
  /** The bundle's name. Default `<tenant>-<the gateway's tool>`. */
  name?: string;
  /** Raise it on every change: Guard loads a bundle only if its version is higher than the one it already runs. */
  version: number;
  /** Who the reviews are recorded under. This is the builder's own declaration that someone read the numbers. */
  reviewedBy: string;
}

export type LimitsSpec = Record<string, any>;

/** Amounts in a spec are JSON strings, never numbers (a number is refused by the compiler). */
const amount = (n: number): string => String(n);

/** What a template decides about its gateway spec: the numbers, and the names of the two bounds. Everything else in the spec is the same for every template. */
export interface PaymentRules {
  identity: LimitsSpecIdentity;
  approvalTtlSeconds: number;
  caps: PaymentCaps;
  /** The only amounts a payment request may be created for: from `minPaise` to `maxPaise`, both included. A Guard bound is a range, not a list of amounts. */
  link: { ruleId: string; minPaise: number; maxPaise: number };
  /** The most one refund may be, in paise. Guard refuses a refund above it and the owner is never asked about it. */
  refundBound: { ruleId: string; maxPaise: number };
  /** Above this many paise Guard holds a refund for the owner. */
  refundThresholdPaise: number;
}

/**
 * A gateway's limits spec for one client, in the format of monorepo docs/guard-limits-spec.md (schema 1): the neutral rules written in the gateway's own routes and
 * operation names. Same rules, same gateway, same bytes. The order of every array and of every object's keys is part of those bytes: do not reorder.
 */
export function paymentLimitsSpecFrom(rules: PaymentRules, gateway: GatewayGuard): LimitsSpec {
  const { identity, caps } = rules;
  if (!Number.isInteger(identity.version) || identity.version < 1) throw new Error("The spec's version must be a whole number, 1 or more.");
  const { ops, amountField: field } = gateway;
  const units = { [field]: gateway.units };
  return {
    schema: 1,
    tenant: identity.tenant,
    tool: gateway.tool,
    name: identity.name ?? `${identity.tenant}-${gateway.tool}`,
    version: identity.version,
    reviewed_by: identity.reviewedBy,
    approval_ttl_seconds: rules.approvalTtlSeconds,
    routes: gateway.routes.map((r) => ({ method: r.method, path: r.path, operation: r.operation })),
    rules: [
      // The agent only ever creates a request for an amount its record asks for, so these are the only amounts the bound lets through.
      { id: rules.link.ruleId, kind: "argument_bound", operation: ops.createRequest, field, min: amount(rules.link.minPaise), max: amount(rules.link.maxPaise), units },
      // A refund is never more than the bound. Every payment this agent can receive is at most that amount (the requests are bound above), and the agent
      // refunds a payment on its own record, never an amount a customer wrote. This is Guard saying the same thing again, on its own: a refund from 1 paisa
      // up to the bound passes this rule, anything else is refused before it is sent. Guard decides this rule and the next one separately and a refusal
      // wins over a hold, so a refund above the bound is refused even when it is also above the owner's limit: the owner is never asked about it.
      { id: rules.refundBound.ruleId, kind: "argument_bound", operation: ops.refund, field, min: "1", max: amount(rules.refundBound.maxPaise), units },
      // THE one threshold: above it Guard holds the refund for the owner; the agent's own limit is this number in rupees.
      { id: "refund-needs-owner", kind: "call_bound_approval", operation: ops.refund, amount_field: field, threshold: amount(rules.refundThresholdPaise), units },
      { id: "refund-once", kind: "at_most_once_effect", operation: ops.refund },
      ...gateway.forbidden.map((f) => ({ id: f.ruleId, kind: "forbidden_call", operation: f.operation })),
    ],
    limits: [
      { id: "refund-paise-per-day", kind: "spend", operation: ops.refund, amount_field: field, scope: [], cap: amount(caps.refundPaisePerDay), window_seconds: 86_400 },
      { id: "refunds-per-day", kind: "count", operation: ops.refund, scope: [], cap: amount(caps.refundsPerDay), window_seconds: 86_400 },
      { id: "links-per-hour", kind: "count", operation: ops.createRequest, scope: [], cap: amount(caps.linksPerHour), window_seconds: 3_600 },
    ],
    intents: [{ operation: ops.refund, key_fields: [...gateway.refundOnce.keyFields], idempotency_header: gateway.refundOnce.idempotencyHeader, derive_key: true }],
    fail_policy: [],
  };
}

/** What a spec says about refunds, read back from the spec itself (so a test, and the Guard stand-in, use the numbers Guard will be given). */
export function refundRulesOf(spec: LimitsSpec): { thresholdPaise: bigint; approvalTtlSeconds: number; bound: { ruleId: string; minPaise: bigint; maxPaise: bigint } } {
  const rule = (spec.rules as any[]).find((r) => r.kind === "call_bound_approval" && r.id === "refund-needs-owner");
  if (!rule || typeof rule.threshold !== "string" || !/^\d+$/u.test(rule.threshold)) throw new Error("The spec has no refund approval threshold in whole paise.");
  const refundOp = (spec.rules as any[]).find((r) => r.id === "refund-needs-owner")?.operation;
  const bound = (spec.rules as any[]).find((r) => r.kind === "argument_bound" && r.operation === refundOp && r.min === "1");
  if (!bound || typeof bound.min !== "string" || typeof bound.max !== "string" || !/^\d+$/u.test(bound.min) || !/^\d+$/u.test(bound.max)) throw new Error("The spec has no refund amount bound in whole paise.");
  return { thresholdPaise: BigInt(rule.threshold), approvalTtlSeconds: Number(spec.approval_ttl_seconds ?? 900), bound: { ruleId: bound.id, minPaise: BigInt(bound.min), maxPaise: BigInt(bound.max) } };
}

/** Would Guard hold a refund of this many paise for the owner, under this spec? "Above the threshold": equal passes. */
export function guardHoldsRefund(spec: LimitsSpec, amountPaise: number): boolean {
  return BigInt(amountPaise) > refundRulesOf(spec).thresholdPaise;
}

/** Would Guard refuse a refund of this many paise outright (below 1 paisa, or above the bound), whatever the owner's limit says? Gives Guard's own words, or nothing if the bound lets it through. */
export function guardRefusesRefund(spec: LimitsSpec, amountPaise: number): string | undefined {
  const { bound } = refundRulesOf(spec);
  const amount = BigInt(amountPaise);
  if (amount < bound.minPaise) return `${bound.ruleId}: amount ${amount} is below the lowest allowed value, ${bound.minPaise}`;
  if (amount > bound.maxPaise) return `${bound.ruleId}: amount ${amount} is above the highest allowed value, ${bound.maxPaise}`;
  return undefined;
}

/** What a spec says about creating a request: the range of amounts, or null when the spec has no such bound. */
export function linkBoundOf(spec: LimitsSpec): { ruleId: string; minPaise: bigint; maxPaise: bigint } | null {
  const linkOp = (spec.limits as any[] | undefined)?.find((l) => l.id === "links-per-hour")?.operation;
  const bound = (spec.rules as any[]).find((r) => r.kind === "argument_bound" && r.operation === linkOp);
  if (!bound) return null;
  return { ruleId: bound.id, minPaise: BigInt(bound.min ?? "0"), maxPaise: BigInt(bound.max ?? "0") };
}

/** Would Guard refuse a payment request for this many paise, whatever the agent says? Gives Guard's own words, or nothing if the bound lets it through. */
export function guardRefusesLink(spec: LimitsSpec, amountPaise: number): string | undefined {
  const bound = linkBoundOf(spec);
  if (!bound) return undefined;
  const amount = BigInt(amountPaise);
  if (amount < bound.minPaise) return `${bound.ruleId}: amount ${amount} is below the lowest allowed value, ${bound.minPaise}`;
  if (amount > bound.maxPaise) return `${bound.ruleId}: amount ${amount} is above the highest allowed value, ${bound.maxPaise}`;
  return undefined;
}
