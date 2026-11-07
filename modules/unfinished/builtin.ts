// The kinds of unfinished work every shop has, for Bookings and Fees (plan B31). Each reads only the case's own fields and the record. Read registry.ts first.
//
//   deposit_no_booking     Bookings: a deposit is in, and the booking is not confirmed (the calendar would not take it, or the hold ran out)
//   payment_unrecorded     Fees: a payment came, and the fee's balance was not brought up to date (the payments service could not be read)
//   approval_waiting_long  an answer from the owner has waited longer than the panel's limit (a refund, a waiver, a calendar clash)
//   refund_waiting         a refund is on its way: with the owner, held by Guard for the owner, or being sent again
//   refund_unknown         a refund whose outcome nobody can state: it may or may not have gone
//   refund_failed          a refund that did not go, and will not go on its own (Guard said no, it ran out, it failed)
//
// A case shows once for one cause: a waiting answer that is overdue is listed as that, and not also as a refund on its way.
import { latestEntry, latestRecovery, timeOf } from "./registry.ts";
import type { CaseLike, DetectInput, Obligation, ObligationKind } from "./registry.ts";

type Pending = CaseLike["pending"][number];
const OWNER_ANSWERS = new Set(["guard_hold", "refund", "waiver", "refund_request", "calendar"]);
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
  templates: ["fees"],
  detect(input) {
    const out: Obligation[] = [];
    for (const c of input.cases) {
      if (c.state !== "open") continue;
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
        const issues = (c.refundIssues ?? []).filter((i) => UNKNOWN_ISSUES.has(i.kind) === unknown);
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

export const BUILT_IN: readonly ObligationKind[] = [depositNoBooking, paymentUnrecorded, approvalWaitingLong, refundWaiting, refundIssues("refund_unknown", true), refundIssues("refund_failed", false)];
