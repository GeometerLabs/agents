// ONE settings value, two places that act on it. The agent's refund limit (whole rupees in a template's settings) and Guard's `call_bound_approval`
// threshold (paise) must be the same number, or one of them is wrong in a way nobody notices: a threshold 100 times too high lets a refund through
// that the owner was never asked about (a silent fail-open); one 100 times too low makes the owner approve every refund. So Guard's side is never typed
// by hand. A template turns its settings into the numbers below; this file turns the numbers into the Razorpay limits spec (monorepo
// docs/guard-limits-spec.md, schema 1), which `geo-guard compile` turns into the policy bundle.
//
// The rest of the spec (the routes, the rule names, the intent that makes a refund happen once) is the shipped Razorpay template
// (monorepo deploy/pathways/bookings/razorpay/spec.json), copied here so that a client's spec is generated, not edited.

/** Guard's own bounds for a hold's lifetime: 60 to 604800 seconds (7 days). Checked against the real binary, see templates/commerce/bookings/Explanation.md. */
export const MIN_APPROVAL_TTL_SECONDS = 60;
export const MAX_APPROVAL_TTL_SECONDS = 604_800;
/**
 * How long a held refund waits for the owner: 24 hours. A shop owner will not answer inside 15 minutes (Guard's template default);
 * an evening request is usually seen the next morning. The customer is told "the owner will confirm", and gets a plain message if nothing comes (refund_expired).
 */
export const APPROVAL_TTL_SECONDS = 86_400;

/** Caps that settings do not carry. The defaults are the template's; a builder who wants others passes them. */
export interface RazorpayCaps { refundPaisePerDay: number; refundsPerDay: number; linksPerHour: number }
export const DEFAULT_CAPS: RazorpayCaps = { refundPaisePerDay: 500_000, refundsPerDay: 20, linksPerHour: 60 };

/** Whole rupees to paise. A fraction of a rupee, or a number too big to count exactly, is refused rather than rounded. */
export function rupeesToPaise(inr: number): number {
  if (!Number.isInteger(inr) || inr < 0) throw new Error(`${inr} is not a whole number of rupees, so it cannot be turned into paise.`);
  const paise = inr * 100;
  if (!Number.isSafeInteger(paise)) throw new Error(`${inr} rupees is too large to count in paise exactly.`);
  return paise;
}

/** The caps with the template's defaults under them, each checked: a whole number above zero. */
export function capsFrom(given: Partial<RazorpayCaps> | undefined): RazorpayCaps {
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
  /** The bundle's name. Default `<tenant>-razorpay`. */
  name?: string;
  /** Raise it on every change: Guard loads a bundle only if its version is higher than the one it already runs. */
  version: number;
  /** Who the reviews are recorded under. This is the builder's own declaration that someone read the numbers. */
  reviewedBy: string;
}

export type LimitsSpec = Record<string, any>;

/** Amounts in a spec are JSON strings, never numbers (a number is refused by the compiler). */
const amount = (n: number): string => String(n);

/** What a template decides about its Razorpay spec: the numbers, and the names of the two bounds. Everything else in the spec is the same for every template. */
export interface RazorpayRules {
  identity: LimitsSpecIdentity;
  approvalTtlSeconds: number;
  caps: RazorpayCaps;
  /** The only amounts a payment link may be created for: from `minPaise` to `maxPaise`, both included. A Guard bound is a range, not a list of amounts. */
  link: { ruleId: string; minPaise: number; maxPaise: number };
  /** The most one refund may be, in paise. Guard refuses a refund above it and the owner is never asked about it. */
  refundBound: { ruleId: string; maxPaise: number };
  /** Above this many paise Guard holds a refund for the owner. */
  refundThresholdPaise: number;
}

/** The Razorpay limits spec for one client, in the format of monorepo docs/guard-limits-spec.md (schema 1). Same rules, same bytes. */
export function razorpayLimitsSpecFrom(rules: RazorpayRules): LimitsSpec {
  const { identity, caps } = rules;
  if (!Number.isInteger(identity.version) || identity.version < 1) throw new Error("The spec's version must be a whole number, 1 or more.");
  return {
    schema: 1,
    tenant: identity.tenant,
    tool: "razorpay",
    name: identity.name ?? `${identity.tenant}-razorpay`,
    version: identity.version,
    reviewed_by: identity.reviewedBy,
    approval_ttl_seconds: rules.approvalTtlSeconds,
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
    rules: [
      // The agent only ever creates a link for an amount its record asks for, so these are the only amounts the bound lets through.
      { id: rules.link.ruleId, kind: "argument_bound", operation: "create_link", field: "amount", min: amount(rules.link.minPaise), max: amount(rules.link.maxPaise), units: { amount: "paise" } },
      // A refund is never more than the bound. Every payment this agent can receive is at most that amount (the links are bound above), and the agent
      // refunds a payment on its own record, never an amount a customer wrote. This is Guard saying the same thing again, on its own: a refund from 1 paisa
      // up to the bound passes this rule, anything else is refused before it is sent. Guard decides this rule and the next one separately and a refusal
      // wins over a hold, so a refund above the bound is refused even when it is also above the owner's limit: the owner is never asked about it.
      { id: rules.refundBound.ruleId, kind: "argument_bound", operation: "refund", field: "amount", min: "1", max: amount(rules.refundBound.maxPaise), units: { amount: "paise" } },
      // THE one threshold: above it Guard holds the refund for the owner; the agent's own limit is this number in rupees.
      { id: "refund-needs-owner", kind: "call_bound_approval", operation: "refund", amount_field: "amount", threshold: amount(rules.refundThresholdPaise), units: { amount: "paise" } },
      { id: "refund-once", kind: "at_most_once_effect", operation: "refund" },
      { id: "no-payouts", kind: "forbidden_call", operation: "payout" },
    ],
    limits: [
      { id: "refund-paise-per-day", kind: "spend", operation: "refund", amount_field: "amount", scope: [], cap: amount(caps.refundPaisePerDay), window_seconds: 86_400 },
      { id: "refunds-per-day", kind: "count", operation: "refund", scope: [], cap: amount(caps.refundsPerDay), window_seconds: 86_400 },
      { id: "links-per-hour", kind: "count", operation: "create_link", scope: [], cap: amount(caps.linksPerHour), window_seconds: 3_600 },
    ],
    intents: [{ operation: "refund", key_fields: ["payment_id"], idempotency_header: "X-Refund-Idempotency", derive_key: true }],
    fail_policy: [],
  };
}

/** What a spec says about refunds, read back from the spec itself (so a test, and the Guard stand-in, use the numbers Guard will be given). */
export function refundRulesOf(spec: LimitsSpec): { thresholdPaise: bigint; approvalTtlSeconds: number; bound: { ruleId: string; minPaise: bigint; maxPaise: bigint } } {
  const rule = (spec.rules as any[]).find((r) => r.kind === "call_bound_approval" && r.operation === "refund");
  if (!rule || typeof rule.threshold !== "string" || !/^\d+$/u.test(rule.threshold)) throw new Error("The spec has no refund approval threshold in whole paise.");
  const bound = (spec.rules as any[]).find((r) => r.kind === "argument_bound" && r.operation === "refund" && r.field === "amount");
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

/** What a spec says about creating a link: the range of amounts, or null when the spec has no such bound. */
export function linkBoundOf(spec: LimitsSpec): { ruleId: string; minPaise: bigint; maxPaise: bigint } | null {
  const bound = (spec.rules as any[]).find((r) => r.kind === "argument_bound" && r.operation === "create_link" && r.field === "amount");
  if (!bound) return null;
  return { ruleId: bound.id, minPaise: BigInt(bound.min ?? "0"), maxPaise: BigInt(bound.max ?? "0") };
}

/** Would Guard refuse a payment link for this many paise, whatever the agent says? Gives Guard's own words, or nothing if the bound lets it through. */
export function guardRefusesLink(spec: LimitsSpec, amountPaise: number): string | undefined {
  const bound = linkBoundOf(spec);
  if (!bound) return undefined;
  const amount = BigInt(amountPaise);
  if (amount < bound.minPaise) return `${bound.ruleId}: amount ${amount} is below the lowest allowed value, ${bound.minPaise}`;
  if (amount > bound.maxPaise) return `${bound.ruleId}: amount ${amount} is above the highest allowed value, ${bound.maxPaise}`;
  return undefined;
}
