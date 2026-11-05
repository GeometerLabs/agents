// A model of what Guard does with a refund, built from the same generated spec Guard is given (src/guard-limits.ts). It is not Guard:
// it is the part of Guard's behaviour that this pathway depends on, written once from monorepo docs/guard-for-pathways.md and checked
// against the real binary (test/approvals-guard-binary.test.ts), so that every stand-in uses the same behaviour:
//   - the in-memory payments fake (fakes mode, the harness, the hand check, the demo) wraps it;
//   - the HTTP stub Guard (modules/standins/guard.ts, used by the tests and by `npm run stack`) serves it.
//
// What it does, as Guard does it:
//   - a refund below 1 paisa or above one deposit is REFUSED (HTTP 403, rule refund-at-most-deposit) before anything else is looked at:
//     no hold is made, nobody is asked, and the payment's once-only record is untouched. A refusal wins over a hold;
//   - a refund above the spec's threshold is HELD (HTTP 202), not sent, with an approval id and an expiry;
//   - the same call again while it is pending is the same hold (same id), whatever the order or spacing of its fields;
//     a different value or type (`60000` against `"60000"`), or a different receipt, is a different call and a new hold;
//   - an approved hold lets the identical call through ONCE; the approval is then used up, so the identical call again is held
//     again under a new id, and only once that is approved is it answered from the record (replayed) instead of sent again;
//   - a denied hold is final for that approval, and the same call again is held again under a new id;
//   - an approval can be used only until its expiry less the upstream timeout.
import type { Clock } from "../core/clock.ts";
import { guardHoldsRefund, guardRefusesLink, guardRefusesRefund, linkBoundOf, refundRulesOf } from "./guard-limits.ts";
import type { LimitsSpec } from "./guard-limits.ts";

/** Guard's `upstream_timeout_ms` in the templates. */
export const UPSTREAM_TIMEOUT_MS = 15_000;

export type ApprovalState = "pending" | "approved" | "denied" | "consumed";

export interface Approval {
  id: string;
  state: ApprovalState;
  callKey: string;
  paymentId: string;
  /** The call's fields as parsed from its body, with their JSON types. */
  fields: Record<string, unknown>;
  amountPaise: number;
  requestedAtMs: number;
  expiresAtMs: number;
  decidedAtMs?: number;
  approver?: string;
}

/** An item of GET /admin/reviews, as Guard words it (typed `arguments`, plain `amount`, times as strings). */
export interface ReviewItem {
  id: string;
  agent: string;
  tool: "razorpay";
  operation: "refund";
  arguments: ["map", Record<string, [string, string]>];
  plain_arguments: string[];
  amount: string;
  rule: "refund-needs-owner";
  summary: string;
  requested_at_ms: string;
  expires_at_ms: string;
  waiting_for: "shop-owner";
  you_may_decide: boolean | null;
  why_not: string | null;
  stuck: null;
}

export type RefundDecision =
  | { kind: "pass" } // send it
  | { kind: "hold"; approval: string; expiresAtMs: number }
  | { kind: "hold_uncertain" } // an earlier attempt may have happened: only a person at the server can resolve it
  | { kind: "replay"; reply: unknown } // the first reply, from the record
  | { kind: "conflict"; reason: string }
  | { kind: "refused"; reason: string; ruleId: string };

export interface GuardModel {
  readonly thresholdPaise: bigint;
  readonly ttlMs: number;
  /** Decide creating a payment link for this many paise: the spec's bound on the amount (HTTP 403, the rule's own id) or a pass. A spec with no such bound lets any amount through. */
  decideLink(amountPaise: unknown): { kind: "pass" } | { kind: "refused"; reason: string; ruleId: string };
  /** Decide a refund call: its payment id and the JSON body exactly as it was sent. */
  decideRefund(paymentId: string, body: unknown): RefundDecision;
  /** The service answered the call that `decideRefund` let through. */
  recordSent(paymentId: string, body: unknown, reply: unknown): void;
  /** The call that `decideRefund` let through may have happened and the answer was lost. */
  recordUnknown(paymentId: string): void;
  /** Pending holds, for the review queue. `viewer` says whether the reader may decide them. */
  reviews(agent: string, mayDecide: boolean | null): ReviewItem[];
  approvals(): Approval[];
  /** An approver's decision on a hold. The status and message are Guard's. */
  decide(approvalId: string, approve: boolean, approver: string): { status: 200; approval: Approval } | { status: 404 | 409; error: string };
}

/** The canonical form of a call: fields sorted, values keeping their JSON types. */
export function callKeyOf(paymentId: string, body: unknown): string {
  const fields = typeof body === "object" && body !== null && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const sorted = Object.keys(fields).sort().map((k) => [k, fields[k]]);
  return JSON.stringify([paymentId, sorted]);
}

export function createGuardModel(spec: LimitsSpec, clock: Clock): GuardModel {
  const rules = refundRulesOf(spec);
  const ttlMs = rules.approvalTtlSeconds * 1000;
  const approvals: Approval[] = [];
  const sent = new Map<string, { callKey: string; reply: unknown }>(); // by payment: what "refund this payment" already did
  const uncertain = new Set<string>();
  let seq = 0;

  const expired = (a: Approval) => a.expiresAtMs <= clock.now();
  const amountOf = (body: unknown): number | undefined => {
    const v = typeof body === "object" && body !== null ? (body as Record<string, unknown>).amount : undefined;
    return typeof v === "number" && Number.isSafeInteger(v) ? v : undefined;
  };

  return {
    thresholdPaise: rules.thresholdPaise,
    ttlMs,

    decideLink(amountPaise) {
      const bound = linkBoundOf(spec);
      if (!bound) return { kind: "pass" };
      // A missing or non-numeric amount is never read as a pass.
      if (typeof amountPaise !== "number" || !Number.isSafeInteger(amountPaise)) return { kind: "refused", reason: `${bound.ruleId}: cannot decide: no amount in the call`, ruleId: bound.ruleId };
      const outside = guardRefusesLink(spec, amountPaise);
      return outside === undefined ? { kind: "pass" } : { kind: "refused", reason: outside, ruleId: bound.ruleId };
    },

    decideRefund(paymentId, body) {
      const amount = amountOf(body);
      if (amount === undefined) return { kind: "refused", reason: "refund-needs-owner: cannot decide: no amount in the call", ruleId: "refund-needs-owner" }; // a missing or non-numeric amount is never read as a pass
      // The bound on the amount is decided first, and a refusal wins over a hold (Guard folds every rule's answer: any refusal refuses, otherwise any hold holds).
      // So a refund above the deposit is refused even when it is also above the owner's limit: no hold is made, no approval is asked, and the once-only
      // record of the payment is not touched.
      const outside = guardRefusesRefund(spec, amount);
      if (outside !== undefined) return { kind: "refused", reason: outside, ruleId: rules.bound.ruleId };
      const callKey = callKeyOf(paymentId, body);
      if (guardHoldsRefund(spec, amount)) {
        const usable = approvals.find((a) => a.callKey === callKey && a.state === "approved" && !expired(a));
        if (usable) {
          if (clock.now() > usable.expiresAtMs - UPSTREAM_TIMEOUT_MS) {
            return { kind: "refused", reason: `approval ${usable.id} expires in ${Math.max(0, Math.round((usable.expiresAtMs - clock.now()) / 1000))} s, before the provider could answer: ask for a fresh approval` };
          }
          usable.state = "consumed"; // an approval works once
        } else {
          const pending = approvals.find((a) => a.callKey === callKey && a.state === "pending" && !expired(a));
          if (pending) return { kind: "hold", approval: pending.id, expiresAtMs: pending.expiresAtMs };
          const now = clock.now();
          const fields = { ...(body as Record<string, unknown>), payment_id: paymentId };
          const created: Approval = { id: `ap-stub-razorpay-${++seq}`, state: "pending", callKey, paymentId, fields, amountPaise: amount, requestedAtMs: now, expiresAtMs: now + ttlMs };
          approvals.push(created);
          return { kind: "hold", approval: created.id, expiresAtMs: created.expiresAtMs };
        }
      }
      // refund-once: one refund per payment, whatever the amount
      if (uncertain.has(paymentId)) return { kind: "hold_uncertain" };
      const earlier = sent.get(paymentId);
      if (earlier) {
        if (earlier.callKey === callKey) return { kind: "replay", reply: earlier.reply };
        return { kind: "conflict", reason: "the same business action was already carried out with different arguments; the same business action is not repeated" };
      }
      return { kind: "pass" };
    },

    recordSent(paymentId, body, reply) { sent.set(paymentId, { callKey: callKeyOf(paymentId, body), reply }); },
    recordUnknown(paymentId) { uncertain.add(paymentId); },

    reviews(agent, mayDecide) {
      return approvals.filter((a) => a.state === "pending" && !expired(a)).map((a): ReviewItem => {
        const typed = Object.fromEntries(Object.entries(a.fields).map(([k, v]): [string, [string, string]] => [k, [typeof v === "number" ? "int" : "str", String(v)]]));
        return {
          id: a.id, agent, tool: "razorpay", operation: "refund", arguments: ["map", typed],
          plain_arguments: Object.entries(a.fields).map(([k, v]) => `${k}: ${v}`), amount: String(a.amountPaise), rule: "refund-needs-owner",
          summary: `refund: ${Object.entries(a.fields).map(([k, v]) => `${k} ${v}`).join(", ")} (refund-needs-owner: above the threshold: a person must approve this exact call)`,
          requested_at_ms: String(a.requestedAtMs), expires_at_ms: String(a.expiresAtMs), waiting_for: "shop-owner",
          you_may_decide: mayDecide, why_not: mayDecide === false ? "this credential belongs to nobody who may approve it" : null, stuck: null,
        };
      });
    },

    approvals: () => approvals.map((a) => ({ ...a })),

    decide(approvalId, approve, approver) {
      const a = approvals.find((x) => x.id === approvalId);
      if (!a) return { status: 404, error: `no approval ${approvalId}` };
      if (a.state === "pending" && expired(a)) return { status: 409, error: `approval ${approvalId} expired before it was decided` };
      if (a.state !== "pending") return { status: 409, error: `approval ${approvalId} is already ${a.state}` };
      a.state = approve ? "approved" : "denied";
      a.decidedAtMs = clock.now();
      a.approver = approver;
      return { status: 200, approval: { ...a } };
    },
  };
}
