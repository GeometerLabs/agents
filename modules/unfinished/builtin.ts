// The kinds of unfinished work every shop has, for Bookings and Fees (plan B31). Each reads only the case's own fields and the record. Read registry.ts first.
//
//   deposit_no_booking     Bookings: a deposit is in, and the booking is not confirmed (the calendar would not take it, or the hold ran out)
//   payment_unrecorded     Fees and Orders: a payment came, and the fee's balance (or the order's advance) was not brought up to date (the payments service could not be read)
//   approval_waiting_long  an answer from the owner has waited longer than the panel's limit (a refund, a waiver, a calendar clash)
//   refund_waiting         a refund is on its way: with the owner, held by Guard for the owner, or being sent again
//   refund_unknown         a refund whose outcome nobody can state: it may or may not have gone
//   refund_failed          a refund that did not go, and will not go on its own (Guard said no, it ran out, it failed)
//   upi_payment_unconfirmed  a UPI shop: the customer says they paid, or the owner marked part, and the owner has not confirmed the rest (modules/payments/owner-marked, B33)
//   upi_refund_owed        a UPI shop: a refund the owner owes and has not marked done (the agent never sends a UPI refund)
//   message_unanswered     the wait for a Guard ended and the work of a message or payment event was not done (modules/runtime/guard-wait.ts)
//   message_not_delivered  WhatsApp reported a message the shop counted on as failed (one about a case, or to the owner or an approver): it never arrived
//
// A case shows once for one cause: a waiting answer that is overdue is listed as that, and not also as a refund on its way.
import { GUARD_WAIT_ENTRY, MESSAGE_STATUS_ENTRY, latestEntry, latestRecovery, reliedOn, timeOf } from "./registry.ts";
import { MARK_OBLIGATION_KINDS } from "../payments/owner-marked/obligations.ts";
import type { CaseLike, DetectInput, Obligation, ObligationKind } from "./registry.ts";

type Pending = CaseLike["pending"][number];
const OWNER_ANSWERS = new Set(["guard_hold", "refund", "waiver", "refund_request", "calendar", "big_order"]);
const REFUND_PENDING = new Set(["guard_hold", "refund", "refund_request", "refund_retry"]);
const UNKNOWN_ISSUES = new Set(["unknown", "uncertain", "unconfirmed"]);
/** The refund problems a read-only look at the payments service can still settle. */
const LOOKABLE = new Set(["unknown", "uncertain", "unconfirmed", "failed"]);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** When this pending item began: the time it carries, or else the record's time for the step that made it. Asking the owner again starts the wait again. */
function pendingSince(p: Pending, c: CaseLike, input: DetectInput): number | null {
  let since: number | null = num(p.heldAtMs) ?? num(p.askedAtMs) ?? null;
  if (since === null && p.kind === "calendar") since = timeOf(latestEntry(input.entries, c.id, ["confirm_booking"], ["failed", "unconfirmed"]));
  if (since === null && p.kind === "refund") since = timeOf(latestEntry(input.entries, c.id, ["refund"], ["held_for_owner"]));
  const again = timeOf(latestRecovery(input.entries, c.id, "ask_owner_again", ["confirmed"]));
  return since === null ? null : Math.max(since, again ?? 0);
}

const isOverdue = (since: number | null, input: DetectInput) => since !== null && input.nowMs - since >= input.options.approvalWaitMs;

const depositNoBooking: ObligationKind = {
  id: "deposit_no_booking",
  templates: ["bookings"],
  detect(input) {
    const out: Obligation[] = [];
    for (const c of input.cases) {
      if (!["needs_owner", "expired", "awaiting_deposit"].includes(c.state) || typeof c.depositPaymentId !== "string") continue;
      const since = timeOf(latestEntry(input.entries, c.id, ["record_deposit"], ["confirmed"]));
      if (since !== null && input.nowMs - since < input.options.graceMs) continue; // the agent is still on it
      out.push({ kind: "deposit_no_booking", caseId: c.id, sinceMs: since, facts: { case: c.id, amountInr: num(c.depositInr) ?? 0 }, actions: ["retry_booking", "recheck_payment", "ask_owner_again"] });
    }
    return out;
  },
};

const paymentUnrecorded: ObligationKind = {
  id: "payment_unrecorded",
  templates: ["fees", "orders"],
  detect(input) {
    const out: Obligation[] = [];
    for (const c of input.cases) {
      if (c.state !== "open" && c.state !== "awaiting_advance") continue; // a fee that is open, or an order waiting for its advance
      const bad = latestEntry(input.entries, c.id, ["record_payment"], ["failed", "unconfirmed"]);
      if (!bad) continue;
      // settled by a later payment line that was read, or by a look at the payments service's list that read it whole (a recovery step)
      const good = latestEntry(input.entries, c.id, ["record_payment"], ["confirmed"]);
      const looked = latestRecovery(input.entries, c.id, "recheck_payment", ["confirmed"]);
      if ((good && good.seq > bad.seq) || (looked && looked.seq > bad.seq)) continue;
      const since = timeOf(bad);
      if (since !== null && input.nowMs - since < input.options.graceMs) continue;
      out.push({ kind: "payment_unrecorded", caseId: c.id, sinceMs: since, facts: { case: c.id }, actions: ["recheck_payment"] });
    }
    return out;
  },
};

/** How long an item stays listed. It has no "done" of its own (the person answers on WhatsApp, which the record does not see), so it leaves by age rather than staying for ever. */
const UNANSWERED_KEEP_MS = 7 * 24 * 3_600_000;

const messageUnanswered: ObligationKind = {
  id: "message_unanswered",
  templates: "all",
  detect(input) {
    const out: Obligation[] = [];
    for (const e of input.entries) {
      if (e.action !== GUARD_WAIT_ENTRY) continue;
      const since = timeOf(e);
      if (since !== null && input.nowMs - since >= UNANSWERED_KEEP_MS) continue;
      // Most such events are about no case yet, so a booking id cannot be asked for: the line's own number names it, the same on every read of the same record.
      const ref = e.booking ?? `#${e.seq}`;
      out.push({ kind: "message_unanswered", caseId: ref, sinceMs: since, facts: { case: ref }, actions: [] });
    }
    return out;
  },
};

/**
 * A message the shop counted on that WhatsApp reported as failed (modules/messaging/statuses.ts writes the line). Nothing re-sends it: sending again could reach the
 * person twice if the report was wrong, and a closed 24-hour window would refuse a plain message anyway, so a person decides. Like message_unanswered it has no
 * "done" the record can see, so it leaves by age.
 */
const messageNotDelivered: ObligationKind = {
  id: "message_not_delivered",
  templates: "all",
  detect(input) {
    const out: Obligation[] = [];
    for (const e of input.entries) {
      if (e.action !== MESSAGE_STATUS_ENTRY || e.outcome !== "failed" || !reliedOn(e.refs.to, e.booking)) continue;
      const since = timeOf(e);
      if (since !== null && input.nowMs - since >= UNANSWERED_KEEP_MS) continue;
      const ref = e.booking ?? `#${e.seq}`; // a message to the owner about no case is named by its line's number, the same on every read
      out.push({ kind: "message_not_delivered", caseId: ref, sinceMs: since, facts: { case: ref, to: e.refs.to ?? "unknown", ...(e.refs.errorCode && /^\d{1,9}$/u.test(e.refs.errorCode) ? { code: Number(e.refs.errorCode) } : {}) }, actions: [] });
    }
    return out;
  },
};

const approvalWaitingLong: ObligationKind = {
  id: "approval_waiting_long",
  templates: "all",
  detect(input) {
    const out: Obligation[] = [];
    for (const c of input.cases) {
      const late = c.pending.map((p) => ({ p, since: pendingSince(p, c, input) })).filter((x) => OWNER_ANSWERS.has(x.p.kind) && isOverdue(x.since, input));
      if (late.length === 0) continue;
      const oldest = late.reduce((a, b) => (a.since! <= b.since! ? a : b));
      // a refund Guard holds is asked by the approvals relay, once: only the agent's own asks can be sent again from here
      const canAsk = late.some((x) => x.p.kind !== "guard_hold");
      out.push({ kind: "approval_waiting_long", caseId: c.id, sinceMs: oldest.since, facts: { case: c.id, hours: Math.floor((input.nowMs - oldest.since!) / 3_600_000), what: oldest.p.kind }, actions: canAsk ? ["ask_owner_again"] : [] });
    }
    return out;
  },
};

const refundWaiting: ObligationKind = {
  id: "refund_waiting",
  templates: "all",
  detect(input) {
    const out: Obligation[] = [];
    for (const c of input.cases) {
      const items = c.pending.filter((p) => REFUND_PENDING.has(p.kind));
      if (items.length === 0) continue;
      if (items.some((p) => OWNER_ANSWERS.has(p.kind) && isOverdue(pendingSince(p, c, input), input))) continue; // listed as waiting too long
      const first = items[0];
      out.push({
        kind: "refund_waiting", caseId: c.id, sinceMs: pendingSince(first, c, input),
        facts: { case: c.id, amountInr: num(first.amountInr) ?? 0, holder: first.kind === "refund_retry" ? "agent" : "owner" },
        actions: first.kind === "refund" || first.kind === "refund_request" ? ["ask_owner_again"] : [],
      });
    }
    return out;
  },
};

function refundIssues(id: "refund_unknown" | "refund_failed", unknown: boolean): ObligationKind {
  return {
    id, templates: "all",
    detect(input) {
      const out: Obligation[] = [];
      for (const c of input.cases) {
        // "late_upi" (a UPI mark after the hold ended) is not a refund that failed: the refund the owner owes for it is listed as upi_refund_owed
        const issues = (c.refundIssues ?? []).filter((i) => i.kind !== "late_upi" && UNKNOWN_ISSUES.has(i.kind) === unknown);
        if (issues.length === 0) continue;
        const oldest = issues.reduce((a, b) => (a.atMs <= b.atMs ? a : b));
        // a refund that may have gone can be looked for again, read-only; one Guard refused, or that ran out, is definite and has nothing to look at
        const lookable = issues.some((i) => LOOKABLE.has(i.kind));
        out.push({ kind: id, caseId: c.id, sinceMs: Number.isFinite(oldest.atMs) ? oldest.atMs : null, facts: { case: c.id, count: issues.length, why: oldest.kind }, actions: lookable ? ["recheck_refund"] : [] });
      }
      return out;
    },
  };
}

export const BUILT_IN: readonly ObligationKind[] = [depositNoBooking, paymentUnrecorded, approvalWaitingLong, refundWaiting, refundIssues("refund_unknown", true), refundIssues("refund_failed", false), messageUnanswered, messageNotDelivered, ...MARK_OBLIGATION_KINDS];
