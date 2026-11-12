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
//   - a denied hold is final for that approval, and for 24 hours after the no the same call again is REFUSED (HTTP 403, reason_code denied_by_approver,
//     the denied request in `detail`): no new request is made, so nobody is asked again (ADR-0061 addendum, the owner's decision of 12 Nov 2026). A changed
//     call is a new hold, as before; after the 24 hours the same call is held again under a new id;
//   - an approval can be used only until its expiry less the upstream timeout.
import type { Clock } from "../core/clock.ts";
import { DENIED_REPEAT_MS } from "../core/faults.ts";
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
  /** B37: who asked for the call (Geo-Requested-By). None of them may decide it. */
  requestedBy?: string[];
  /** B37: how many different people must approve (set only when more than one). */
  needed?: number;
  /** B37: each answer so far, oldest first. */
  votes?: { approver: string; approve: boolean; role: string; atMs: number }[];
}

/**
 * B37 (Guard's ADR-0061): the approver directory a shop with other people has (bundle/generate/guards.ts writes the same one): the owner and the people hold the
 * lower role (`shop-owner`, up to `twoAbovePaise`) and the upper one (`shop-two`, two approvals); the relay's reading credential (`reader`) holds the lower one only.
 */
export interface ModelApprovers { owner: string; people: string[]; twoAbovePaise?: number; reader?: string }

/** An item of GET /admin/reviews, as Guard words it (typed `arguments`, plain `amount`, times as strings). */
export interface ReviewItem {
  id: string;
  agent: string;
  /** The gateway's tool, from the spec (B71: whichever gateway the shop chose). */
  tool: string;
  operation: "refund";
  arguments: ["map", Record<string, [string, string]>];
  plain_arguments: string[];
  amount: string;
  rule: "refund-needs-owner";
  summary: string;
  requested_at_ms: string;
  expires_at_ms: string;
  waiting_for: "shop-owner" | "shop-two";
  you_may_decide: boolean | null;
  why_not: string | null;
  stuck: null;
  /** B37: only on a request that needs several approvals or names who asked, as Guard writes them. */
  approvals_needed?: number;
  approvals_given?: number;
  votes?: { approver: string; decision: "approve" | "deny"; role: string; at_ms: string }[];
  requested_by?: string[];
  may_still_decide?: string[];
}

export type RefundDecision =
  | { kind: "pass" } // send it
  | { kind: "hold"; approval: string; expiresAtMs: number }
  | { kind: "hold_uncertain" } // an earlier attempt may have happened: only a person at the server can resolve it
  | { kind: "replay"; reply: unknown } // the first reply, from the record
  | { kind: "conflict"; reason: string }
  /** The identical call again after a person settled it as `happened` (409 conflict, reason_code already_done): `detail` is Guard's, as its docs show it. */
  | { kind: "already_done"; reason: string; detail: { intent: string; state: "reconciled"; confirmed_by: string; provider_status?: number } }
  /** The identical call within 24 hours of a person's no (403 refused_by_policy, reason_code denied_by_approver): `detail` is Guard's, as its docs show it. */
  | { kind: "denied_repeat"; reason: string; detail: { approval: string; status: "denied"; denied_at_ms: number; until_ms: number } }
  | { kind: "refused"; reason: string; ruleId: string };

export interface GuardModel {
  readonly thresholdPaise: bigint;
  readonly ttlMs: number;
  /** Decide creating a payment link for this many paise: the spec's bound on the amount (HTTP 403, the rule's own id) or a pass. A spec with no such bound lets any amount through. */
  decideLink(amountPaise: unknown): { kind: "pass" } | { kind: "refused"; reason: string; ruleId: string };
  /** Decide a refund call: its payment id and the JSON body exactly as it was sent, and who asked for it (the Geo-Requested-By header's ids, which are not part of the call). */
  decideRefund(paymentId: string, body: unknown, requestedBy?: string[]): RefundDecision;
  /** The service answered the call that `decideRefund` let through. */
  recordSent(paymentId: string, body: unknown, reply: unknown): void;
  /** The call that `decideRefund` let through may have happened and the answer was lost (or was a 5xx, `providerStatus`). `body` is the call as it was sent. */
  recordUnknown(paymentId: string, body?: unknown, providerStatus?: number): void;
  /**
   * A person at the server settles an uncertain refund (POST /admin/intents/resolve). `happened`: the identical call is never sent again and is answered 409
   * already_done, naming `operator:<by>`; the same action with other arguments stays a plain 409. `did_not_happen`: the call may go again.
   */
  resolve(paymentId: string, resolution: "happened" | "did_not_happen", by?: string): void;
  /** Pending holds, for the review queue. `viewer` says whether the reader may decide them. */
  reviews(agent: string, mayDecide: boolean | null): ReviewItem[];
  approvals(): Approval[];
  /** An approver's decision on a hold. The status and message are Guard's (B37: a vote, while more approvals are needed, leaves it pending). */
  decide(approvalId: string, approve: boolean, approver: string): { status: 200; approval: Approval } | { status: 403 | 404 | 409; error: string };
}

/** The canonical form of a call: fields sorted, values keeping their JSON types. */
export function callKeyOf(paymentId: string, body: unknown): string {
  const fields = typeof body === "object" && body !== null && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const sorted = Object.keys(fields).sort().map((k) => [k, fields[k]]);
  return JSON.stringify([paymentId, sorted]);
}

// Built from the same generated spec as Guard so tests see the same holds and blocks, without a real Guard process; it is a model, not Guard.
/**
 * `olderGuard`: a Guard from before 12 Nov 2026, which holds the identical call again after a no instead of refusing it. Only the tests use it, to show the
 * approvals relay still does not ask the owner again.
 */
export function createGuardModel(spec: LimitsSpec, clock: Clock, options: { approvers?: ModelApprovers; olderGuard?: boolean } = {}): GuardModel {
  const directory = options.approvers;
  /** The role a new hold of this amount is assigned to, and how many approvals it needs (Guard: the covering role with the lowest ceiling). */
  const tierOf = (amount: number): { role: "shop-owner" | "shop-two"; needed?: number } => (directory?.twoAbovePaise !== undefined && amount > directory.twoAbovePaise ? { role: "shop-two", needed: 2 } : { role: "shop-owner" });
  /** Who may still decide a request: the role's holders, less the people who asked and those who answered (review.rs may_still_decide). */
  const mayStillDecide = (a: Approval): string[] => {
    if (!directory) return [];
    const holders = [directory.owner, ...directory.people, ...(a.needed === undefined && directory.reader ? [directory.reader] : [])];
    return holders.filter((p) => !(a.requestedBy ?? []).includes(p) && !(a.votes ?? []).some((v) => v.approver === p)).sort();
  };
  const several = (a: Approval) => a.needed !== undefined || (a.requestedBy?.length ?? 0) > 0;
  const rules = refundRulesOf(spec);
  const ttlMs = rules.approvalTtlSeconds * 1000;
  const approvals: Approval[] = [];
  const sent = new Map<string, { callKey: string; reply: unknown }>(); // by payment: what "refund this payment" already did
  const uncertain = new Map<string, { callKey?: string; providerStatus?: number }>(); // by payment: an attempt whose outcome is unknown
  const settled = new Map<string, { callKey?: string; by: string; intent: string; providerStatus?: number }>(); // by payment: settled by a person as `happened`
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

    decideRefund(paymentId, body, requestedBy) {
      const asked = (requestedBy ?? []).filter((r) => r.length > 0);
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
          if (pending) {
            // someone asking for the identical call while it is pending joins the same hold, as another person who asked (B37)
            const more = asked.filter((r) => !(pending.requestedBy ?? []).includes(r));
            if (more.length > 0) pending.requestedBy = [...(pending.requestedBy ?? []), ...more].sort();
            return { kind: "hold", approval: pending.id, expiresAtMs: pending.expiresAtMs };
          }
          const now = clock.now();
          // a person said no to this exact call in the last 24 hours (Guard's hold_for_approval, after the pending request and before a new one): refused, nobody asked
          const no = options.olderGuard ? undefined : approvals.filter((a) => a.callKey === callKey && a.state === "denied" && a.decidedAtMs !== undefined && a.decidedAtMs > now - DENIED_REPEAT_MS).at(-1);
          if (no) {
            const at = no.decidedAtMs as number;
            return {
              kind: "denied_repeat",
              reason: `the person asked to approve this exact call said no (approval ${no.id}): it is refused without asking anyone again for 24 hours after the no; a call with other arguments is a new request`,
              detail: { approval: no.id, status: "denied", denied_at_ms: at, until_ms: at + DENIED_REPEAT_MS },
            };
          }
          const fields = { ...(body as Record<string, unknown>), payment_id: paymentId };
          const tier = tierOf(amount);
          const created: Approval = {
            id: `ap-stub-${spec.tool}-${++seq}`, state: "pending", callKey, paymentId, fields, amountPaise: amount, requestedAtMs: now, expiresAtMs: now + ttlMs,
            ...(tier.needed ? { needed: tier.needed } : {}), ...(asked.length > 0 ? { requestedBy: [...new Set(asked)].sort() } : {}),
          };
          approvals.push(created);
          return { kind: "hold", approval: created.id, expiresAtMs: created.expiresAtMs };
        }
      }
      // refund-once: one refund per payment, whatever the amount
      if (uncertain.has(paymentId)) return { kind: "hold_uncertain" };
      const done = settled.get(paymentId);
      if (done) {
        // Guard's words (monorepo docs/guard-for-pathways.md, "A call that may have happened"): there is no provider reply to replay, so it is not a replay
        if (done.callKey === undefined || done.callKey === callKey) {
          return { kind: "already_done", reason: `intent ${done.intent} already reconciled (confirmed by operator:${done.by}); nothing is sent again, and there is no provider reply to return`, detail: { intent: done.intent, state: "reconciled", confirmed_by: `operator:${done.by}`, ...(done.providerStatus !== undefined ? { provider_status: done.providerStatus } : {}) } };
        }
        return { kind: "conflict", reason: "the same business action was already carried out with different arguments; the same business action is not repeated" };
      }
      const earlier = sent.get(paymentId);
      if (earlier) {
        if (earlier.callKey === callKey) return { kind: "replay", reply: earlier.reply };
        return { kind: "conflict", reason: "the same business action was already carried out with different arguments; the same business action is not repeated" };
      }
      return { kind: "pass" };
    },

    recordSent(paymentId, body, reply) { sent.set(paymentId, { callKey: callKeyOf(paymentId, body), reply }); },
    recordUnknown(paymentId, body, providerStatus) { uncertain.set(paymentId, { ...(body !== undefined ? { callKey: callKeyOf(paymentId, body) } : {}), ...(providerStatus !== undefined ? { providerStatus } : {}) }); },
    resolve(paymentId, resolution, by = "ops") {
      const open = uncertain.get(paymentId);
      if (!open) return;
      uncertain.delete(paymentId);
      if (resolution === "happened") settled.set(paymentId, { ...open, by, intent: `intent:stub-${paymentId}` });
    },

    reviews(agent, mayDecide) {
      return approvals.filter((a) => a.state === "pending" && !expired(a)).map((a): ReviewItem => {
        const typed = Object.fromEntries(Object.entries(a.fields).map(([k, v]): [string, [string, string]] => [k, [typeof v === "number" ? "int" : "str", String(v)]]));
        const role = tierOf(a.amountPaise).role;
        const item: ReviewItem = {
          id: a.id, agent, tool: spec.tool, operation: "refund", arguments: ["map", typed],
          plain_arguments: Object.entries(a.fields).map(([k, v]) => `${k}: ${v}`), amount: String(a.amountPaise), rule: "refund-needs-owner",
          summary: `refund: ${Object.entries(a.fields).map(([k, v]) => `${k} ${v}`).join(", ")} (refund-needs-owner: above the threshold: a person must approve this exact call)`,
          requested_at_ms: String(a.requestedAtMs), expires_at_ms: String(a.expiresAtMs), waiting_for: role,
          you_may_decide: mayDecide, why_not: mayDecide === false ? "this credential belongs to nobody who may approve it" : null, stuck: null,
        };
        if (!several(a)) return item;
        return {
          ...item, approvals_needed: a.needed ?? 1, approvals_given: (a.votes ?? []).filter((v) => v.approve).length,
          votes: (a.votes ?? []).map((v) => ({ approver: v.approver, decision: v.approve ? "approve" : "deny", role: v.role, at_ms: String(v.atMs) })),
          requested_by: a.requestedBy ?? [], may_still_decide: mayStillDecide(a),
        };
      });
    },

    approvals: () => approvals.map((a) => ({ ...a, ...(a.votes ? { votes: a.votes.map((v) => ({ ...v })) } : {}) })),

    decide(approvalId, approve, approver) {
      const a = approvals.find((x) => x.id === approvalId);
      if (!a) return { status: 404, error: `no approval ${approvalId}` };
      // B37, in Guard's words (review.rs may_decide, store/mod.rs apply_vote): the person who asked never decides; each person answers once; any one no refuses
      if (a.state === "pending" && !expired(a) && (a.requestedBy ?? []).includes(approver)) return { status: 403, error: `${approver} may not decide this request: ${approver} asked for this call, so may not approve or deny it (an admin may revoke it)` };
      if (a.needed !== undefined && a.state === "pending" && !expired(a)) {
        const votes = a.votes ?? [];
        const given = votes.filter((v) => v.approve).length;
        const prev = votes.find((v) => v.approver === approver);
        if (prev) return { status: 409, error: `approval ${approvalId} is already ${prev.approve ? "approved" : "denied"} by ${approver}: each approver decides once (${given} of ${a.needed} approvals so far)` };
        a.votes = [...votes, { approver, approve, role: tierOf(a.amountPaise).role, atMs: clock.now() }];
        if (!approve || given + 1 >= a.needed) { a.state = approve ? "approved" : "denied"; a.decidedAtMs = clock.now(); a.approver = approver; }
        return { status: 200, approval: { ...a, votes: a.votes.map((v) => ({ ...v })) } };
      }
      if (a.state === "pending" && expired(a)) return { status: 409, error: `approval ${approvalId} expired before it was decided` };
      if (a.state !== "pending") return { status: 409, error: `approval ${approvalId} is already ${a.state}` };
      a.state = approve ? "approved" : "denied";
      a.decidedAtMs = clock.now();
      a.approver = approver;
      return { status: 200, approval: { ...a } };
    },
  };
}
