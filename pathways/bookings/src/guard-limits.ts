// ONE settings value, two places that act on it. The agent's refund limit (settings.cancellation.refundLimitInr, whole rupees) and
// Guard's `call_bound_approval` threshold (paise) must be the same number, or one of them is wrong in a way nobody notices: a
// threshold 100 times too high lets a refund through that the owner was never asked about (a silent fail-open); one 100 times too low
// makes the owner approve every refund. So Guard's side is never typed by hand. This file turns the settings into the numbers of
// the Razorpay limits spec (monorepo docs/guard-limits-spec.md, schema 1), and `geo-guard compile` turns that into the policy bundle.
//
// The rest of the spec (the routes, the rule names, the intent that makes a refund happen once) is the shipped Razorpay template
// (monorepo deploy/pathways/bookings/razorpay/spec.json), copied here so that a client's spec is generated, not edited.
import type { Settings } from "./settings.ts";

/** Guard's own bounds for a hold's lifetime: 60 to 604800 seconds (7 days). Checked against the real binary, see Explanation.md. */
export const MIN_APPROVAL_TTL_SECONDS = 60;
export const MAX_APPROVAL_TTL_SECONDS = 604_800;
/**
 * How long a held refund waits for the owner: 24 hours. A salon owner will not answer inside 15 minutes (Guard's template default);
 * an evening cancellation is usually seen the next morning. The booking's hold on the customer is not the same thing: the customer
 * is told "the owner will confirm", and gets a plain message if nothing comes (refund_expired).
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

/** The refund amount (paise) above which Guard holds the call for the owner. The agent holds above `refundLimitInr`; the two are this one value. */
export const refundThresholdPaise = (settings: Settings): number => rupeesToPaise(settings.cancellation.refundLimitInr);

/** The deposit, in paise: the only amount a payment link may be created for. */
export const depositPaise = (settings: Settings): number => rupeesToPaise(settings.deposit.amountInr);

export interface RazorpayNumbers {
  depositPaise: number;
  refundThresholdPaise: number;
  caps: RazorpayCaps;
  approvalTtlSeconds: number;
}

export function razorpayNumbers(settings: Settings, options: { caps?: Partial<RazorpayCaps>; approvalTtlSeconds?: number } = {}): RazorpayNumbers {
  const caps = { ...DEFAULT_CAPS, ...options.caps };
  for (const [name, value] of Object.entries(caps)) if (!Number.isSafeInteger(value) || value < 1) throw new Error(`The cap "${name}" must be a whole number above zero.`);
  const approvalTtlSeconds = options.approvalTtlSeconds ?? APPROVAL_TTL_SECONDS;
  if (!Number.isInteger(approvalTtlSeconds) || approvalTtlSeconds < MIN_APPROVAL_TTL_SECONDS || approvalTtlSeconds > MAX_APPROVAL_TTL_SECONDS) {
    throw new Error(`The approval time must be between ${MIN_APPROVAL_TTL_SECONDS} and ${MAX_APPROVAL_TTL_SECONDS} seconds (Guard refuses anything else).`);
  }
  const deposit = depositPaise(settings);
  if (deposit < 1) throw new Error("The deposit must be at least 1 rupee for Guard to allow a payment link.");
  // A refund can be as large as a deposit. If the day's cap is smaller than that, an approved refund would still be refused: say so now, not at the till.
  if (caps.refundPaisePerDay < deposit) throw new Error(`The daily refund cap (${caps.refundPaisePerDay} paise) is smaller than one deposit (${deposit} paise), so an approved refund could still be refused. Raise the cap.`);
  return { depositPaise: deposit, refundThresholdPaise: refundThresholdPaise(settings), caps, approvalTtlSeconds };
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

/** The Razorpay limits spec for one client, in the format of monorepo docs/guard-limits-spec.md (schema 1). Same settings, same bytes. */
export function razorpayLimitsSpec(settings: Settings, identity: LimitsSpecIdentity, options: { caps?: Partial<RazorpayCaps>; approvalTtlSeconds?: number } = {}): LimitsSpec {
  if (!Number.isInteger(identity.version) || identity.version < 1) throw new Error("The spec's version must be a whole number, 1 or more.");
  const n = razorpayNumbers(settings, options);
  return {
    schema: 1,
    tenant: identity.tenant,
    tool: "razorpay",
    name: identity.name ?? `${identity.tenant}-razorpay`,
    version: identity.version,
    reviewed_by: identity.reviewedBy,
    approval_ttl_seconds: n.approvalTtlSeconds,
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
      // The agent only ever creates a link for the deposit, so that is the only amount the bound lets through.
      { id: "deposit-amount", kind: "argument_bound", operation: "create_link", field: "amount", min: amount(n.depositPaise), max: amount(n.depositPaise), units: { amount: "paise" } },
      // THE one threshold: above it Guard holds the refund for the owner; the agent's own limit is this number in rupees.
      { id: "refund-needs-owner", kind: "call_bound_approval", operation: "refund", amount_field: "amount", threshold: amount(n.refundThresholdPaise), units: { amount: "paise" } },
      { id: "refund-once", kind: "at_most_once_effect", operation: "refund" },
      { id: "no-payouts", kind: "forbidden_call", operation: "payout" },
    ],
    limits: [
      { id: "refund-paise-per-day", kind: "spend", operation: "refund", amount_field: "amount", scope: [], cap: amount(n.caps.refundPaisePerDay), window_seconds: 86_400 },
      { id: "refunds-per-day", kind: "count", operation: "refund", scope: [], cap: amount(n.caps.refundsPerDay), window_seconds: 86_400 },
      { id: "links-per-hour", kind: "count", operation: "create_link", scope: [], cap: amount(n.caps.linksPerHour), window_seconds: 3_600 },
    ],
    intents: [{ operation: "refund", key_fields: ["payment_id"], idempotency_header: "X-Refund-Idempotency", derive_key: true }],
    fail_policy: [],
  };
}

/** What a spec says about refunds, read back from the spec itself (so a test, and the Guard stand-in, use the numbers Guard will be given). */
export function refundRulesOf(spec: LimitsSpec): { thresholdPaise: bigint; approvalTtlSeconds: number } {
  const rule = (spec.rules as any[]).find((r) => r.kind === "call_bound_approval" && r.operation === "refund");
  if (!rule || typeof rule.threshold !== "string" || !/^\d+$/u.test(rule.threshold)) throw new Error("The spec has no refund approval threshold in whole paise.");
  return { thresholdPaise: BigInt(rule.threshold), approvalTtlSeconds: Number(spec.approval_ttl_seconds ?? 900) };
}

/** Would Guard hold a refund of this many paise for the owner, under this spec? "Above the threshold": equal passes. */
export function guardHoldsRefund(spec: LimitsSpec, amountPaise: number): boolean {
  return BigInt(amountPaise) > refundRulesOf(spec).thresholdPaise;
}
