// Refunds, the careful way, for every template: look first, send once, never send again what may have gone out.
//
// A refund above the owner's limit is not decided here. The agent sends it like any other; Guard holds it (HTTP 202) and the approvals
// relay asks the owner, once, with a code. The agent keeps the approval id and the exact bytes of the held call, and sends those same
// bytes again only when the relay says the owner approved: Guard releases a call only if it is the identical call, and `60000` is not
// `"60000"`. Between the hold and the answer the agent does nothing: no timer sends a held refund again.
//
// Whatever Guard or the service answered, a refund that may have gone out is never sent again: Guard's own record makes the second one a
// new hold, which would ask the owner about money already paid.
//
// A 409 is "nothing was refunded" (the same action with other arguments), except one: a 409 with `reason_code: "already_done"` is Guard saying
// that a person at the server looked and settled the refund as made (Guard's ADR-0060). That one is DONE: recorded as done by that person's word,
// never sent again, and the owner is told in plain words.
//
// What a template gives this file: the thing a refund belongs to (a booking, a student's fee) as a `RefundCase`, how to write to the record and to the
// customer about it, and where to find the case again from an approval. Everything about HOW a refund is asked for and read back is here, once.
import { formatInr } from "../language/format.ts";
import type { Clock } from "../core/clock.ts";
import { ApiError, GuardAlreadyDoneError, GuardConflictError, GuardError, GuardHeldError, GuardOutcomeUnknownError, GuardRefusedError, GuardUnavailableError, NotSentError, TimeoutError } from "../core/faults.ts";
import { MINUTE } from "../core/time.ts";
import type { Decision } from "../limits/limits.ts";
import type { Action, Outcome } from "../record/record.ts";
import { ATTEMPTS } from "./links.ts";
import type { Payments } from "./payments.ts";

/** After a refund could not be sent at all, or an approved one could not be sent again: minutes before each next try, then the builder is told. */
export const RETRY_MINUTES = [1, 2, 5, 15, 30, 60];

/**
 * Why a refund needs the builder, not the owner. "unheld": a refund above the limit was sent without Guard holding it (Guard's threshold does not match the settings).
 * "late_upi": a UPI shop's owner marked money received after the booking's hold had ended (B33): it was not booked again by itself, the owner owes it back or books
 * the customer by hand, and the builder or partner is told through this count as well as the record.
 */
export type RefundIssueKind = "unknown" | "uncertain" | "refused" | "failed" | "unconfirmed" | "expired" | "unheld" | "late_upi";
export interface RefundIssue { paymentId: string; kind: RefundIssueKind; note: string; atMs: number }

/**
 *  - guard_hold: a refund Guard is holding for the owner. It keeps the approval id and the EXACT bytes of the call that was held:
 *    after the relay says the owner approved, those same bytes are sent again, once. It is never sent again on a timer.
 *  - refund_retry: a refund that could not be sent at all (nothing went out). The agent tries again by itself, a few times.
 */
export interface GuardHold {
  kind: "guard_hold"; amountInr: number; paymentId: string; receipt: string;
  approval: string; body: string; expiresAtMs: number | null; heldAtMs: number;
  /** The relay has said the owner approved. Set before the call is sent again, so a send that could not be made is tried again. */
  approved?: boolean; tries?: number; retryAtMs?: number;
  /** B37: who asked for this refund (Guard's approver ids, sent in Geo-Requested-By). The relay never asks them to approve it. */
  requestedBy?: string[];
}
export interface RefundRetry {
  kind: "refund_retry"; amountInr: number; paymentId: string; tries: number; retryAtMs: number;
  /** B37: who asked for it, named again on the next try (a try that sent nothing is a first try). */
  requestedBy?: string[];
  /** What to tell once it is done or held, as message ids of the template. */
  then: { customer: string; owner?: string; held: string };
}

/** The thing a refund belongs to: a booking, a student's fee. Only these fields are used here. */
export interface RefundCase {
  id: string;
  /** The customer's number: the record is kept under it. */
  customer: string;
  pending: { kind: string }[];
  /** Refunds that need the builder (never the owner): see RefundIssueKind. Counted in the runtime's status. */
  refundIssues?: RefundIssue[];
  /** Payments the agent must not ask Guard to refund again: the owner said no, the outcome is unclear, it failed for good, the approval ran out, or a person settled it as made. */
  stoppedRefunds?: string[];
}

export type RefundResult = "done" | "held" | "retry" | "stopped";

export interface RefundDeps<C extends RefundCase> {
  payments: Payments;
  clock: Clock;
  /** The owner's number, for the record entries about the owner's decision. */
  owner: string;
  /** The refund limit in whole rupees, to word the note when Guard did not hold what it should have. */
  limitInr(): number;
  /** Write to the record. `c` is null when no case is waiting on what was said. */
  log(c: C | null, phone: string, action: Action, outcome: Outcome, inputs: unknown, more?: { decisions?: Decision[]; notes?: string; refs?: Record<string, string> }): void;
  tellCustomer(c: C, phone: string, templates: string[], more?: { refundInr?: number }): Promise<boolean>;
  tellOwner(c: C, phone: string, template: string, more?: { refundInr?: number }): Promise<boolean>;
  /** Every case, to find the one that waits on an approval, and to sweep the clock's work. */
  cases(): Iterable<C>;
  /** The message ids this file sends itself. `settled` tells the owner a refund is done by the word of the person who looks after the server (Guard's `already_done`). */
  ids: { checking: string; denied: string; approved: string; expired: string; settled: string };
}

export function createRefunds<C extends RefundCase>(deps: RefundDeps<C>) {
  const { payments, clock, owner, log, tellCustomer, tellOwner } = deps;

  const issuesOf = (b: C) => (b.refundIssues ??= []);
  const stoppedOf = (b: C) => (b.stoppedRefunds ??= []);
  const holds = (b: C) => b.pending as { kind: string }[];
  /** The builder must look at this refund, not the owner. It is in the record (the entry's notes) and counted in the runtime's status. */
  function raise(b: C, paymentId: string, kind: RefundIssueKind, note: string): void {
    issuesOf(b).push({ paymentId, kind, note, atMs: clock.now() });
    if (kind !== "unheld") stoppedOf(b).push(paymentId); // asking Guard again could only ask the owner about the same money again
  }

  type Sorted =
    | { is: "already_done"; error: GuardAlreadyDoneError } // a person at the server settled it as made: done, never sent again
    | { is: "held"; error: GuardHeldError }
    | { is: "may_have_happened"; why: string } // look once, never send again
    | { is: "refused"; error: GuardRefusedError }
    | { is: "no_good"; why: string } // Guard said no and trying again will not change it
    | { is: "lost"; why: string } // no reply: the next look says whether it landed
    | { is: "not_sent"; why: string }; // nothing went out: Guard could not decide or reach the service, or the service refused this call

  /** What an error from a refund call means for the refund. Anything that is not one of the service errors is the agent's own bug, and is thrown. */
  function sortRefundError(e: unknown): Sorted {
    // first: it is a GuardConflictError too, and any other 409 still means "nothing was refunded"
    if (e instanceof GuardAlreadyDoneError) return { is: "already_done", error: e };
    if (e instanceof GuardHeldError) return { is: "held", error: e };
    if (e instanceof GuardOutcomeUnknownError) return { is: "may_have_happened", why: "Guard says the outcome is unknown" };
    if (e instanceof GuardRefusedError) return { is: "refused", error: e };
    if (e instanceof GuardUnavailableError) return { is: "not_sent", why: e.message };
    if (e instanceof GuardConflictError || e instanceof GuardError) return { is: "no_good", why: e.message };
    if (e instanceof NotSentError) return { is: "not_sent", why: e.message };
    if (e instanceof TimeoutError) return { is: "lost", why: e.message };
    // the service's own answer, as it came through Guard: a 5xx may have happened (Guard will not repeat it either); a 4xx did not
    if (e instanceof ApiError) return e.status >= 500 ? { is: "may_have_happened", why: `the payments service answered ${e.status}` } : { is: "not_sent", why: e.message };
    throw e;
  }

  const findRefund = async (paymentId: string, receipt: string) => (await payments.listRefunds(paymentId)).find((r) => r.receipt === receipt);

  /**
   * Guard says a person at the server settled this refund as made (409 `already_done`): done, by that person's word, and never sent again. The record says
   * who (refs.confirmedBy) and that the payments service's own list did not show it; the payment is never asked about again; the owner is told plainly.
   * It is not a refund issue: nobody needs to look at it again.
   */
  async function settledByPerson(b: C, paymentId: string, amountInr: number, refs: Record<string, string>, e: GuardAlreadyDoneError): Promise<void> {
    const who = e.confirmedBy ?? "a person at the server";
    log(b, b.customer, "refund", "confirmed", { paymentId, amountInr }, {
      refs: { ...refs, confirmedBy: who, ...(e.intent ? { intent: e.intent } : {}) },
      notes: `Guard says ${who} settled this refund as made (already_done): it is done by that person's word, not by the payments service's own list, which did not show it. It is not sent again`,
    });
    if (!stoppedOf(b).includes(paymentId)) stoppedOf(b).push(paymentId); // asking Guard again would only get the same answer
    await tellOwner(b, b.customer, deps.ids.settled, { refundInr: amountInr });
  }

  const overLimit = (amountInr: number) => amountInr > deps.limitInr();

  /**
   * Ask for a refund of a payment, once. `expectHold`: the amount is above the owner's limit, so Guard should hold it.
   * "done": the payments service's own list shows the refund. "held": Guard is holding it for the owner. "retry": nothing went out, it will
   * be tried again by itself. "stopped": the builder has been told, and nothing more is done for this payment.
   */
  async function requestRefund(b: C, paymentId: string, amountInr: number, decisions: Decision[], expectHold: boolean, requestedBy?: string[]): Promise<RefundResult> {
    const receipt = `${b.id}:${paymentId}`; // the case id travels in the receipt: the relay finds the case from it
    const amountPaise = amountInr * 100;
    const refs = { paymentId, amountPaise: String(amountPaise) };
    if (stoppedOf(b).includes(paymentId)) {
      log(b, b.customer, "refund", "blocked", { paymentId, amountInr }, { refs, notes: "an earlier try at this refund ended with a no, an unclear outcome, a failure, or Guard's word that a person settled it as made, so Guard is not asked again" });
      return "stopped";
    }
    log(b, b.customer, "refund", "attempted", { paymentId, amountInr }, { decisions, refs });

    /** The refund may have gone out and cannot be sent again: read the payments service's own list once, and stop. */
    async function maybeDone(why: string): Promise<RefundResult> {
      const found = await findRefund(paymentId, receipt).catch(() => undefined);
      if (found) { log(b, b.customer, "refund", "confirmed", { paymentId, amountInr }, { refs: { ...refs, refundId: found.id }, notes: `${why}; the payments service's own list shows the refund, and it is not sent again` }); return "done"; }
      const note = `${why}. The refund may or may not have been made. It was NOT sent again. Check Razorpay for payment ${paymentId}; if Guard holds it as uncertain, tell Guard what happened (POST /admin/intents/resolve).`;
      log(b, b.customer, "refund", "unconfirmed", { paymentId, amountInr }, { refs, notes: note });
      raise(b, paymentId, "unknown", note);
      return "stopped";
    }

    /** The service took the refund (2xx): read it back once. Never send again, whatever the list shows. */
    async function readBack(note?: string): Promise<RefundResult> {
      const found = await findRefund(paymentId, receipt).catch(() => undefined);
      if (found) {
        log(b, b.customer, "refund", "confirmed", { paymentId, amountInr }, { refs: { ...refs, refundId: found.id }, ...(note ? { notes: note } : {}) });
        if (expectHold) {
          const why = `A refund of ${formatInr(amountInr)} is above the ${formatInr(deps.limitInr())} limit but Guard sent it without holding it for the owner. Guard's threshold does not match these settings: check the Razorpay limits spec.`;
          log(b, b.customer, "refund", "unconfirmed", { paymentId, amountInr }, { refs, notes: why });
          raise(b, paymentId, "unheld", why);
        }
        return "done";
      }
      const why = "the payments service accepted the refund, but its own list does not show it yet. It is NOT sent again";
      log(b, b.customer, "refund", "unconfirmed", { paymentId, amountInr }, { refs, notes: why });
      raise(b, paymentId, "unconfirmed", why);
      return "stopped";
    }

    let error: string | undefined;
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      try {
        const done = await findRefund(paymentId, receipt); // look first: an earlier try, or a lost reply, may have landed
        if (done) {
          log(b, b.customer, "refund", "confirmed", { paymentId, amountInr }, { refs: { ...refs, refundId: done.id } });
          return "done";
        }
      } catch (e) {
        if (!(e instanceof TimeoutError) && !(e instanceof ApiError)) throw e;
        error = `could not look at the existing refunds first (${(e as Error).message}), so nothing was sent`;
        break; // what cannot be looked at is not sent blind
      }
      try {
        const sent = await payments.refund(paymentId, { amount: amountPaise, receipt, ...(requestedBy && requestedBy.length > 0 ? { requestedBy } : {}) });
        return await readBack(sent.replayed ? "Guard answered from its record; nothing was sent again" : undefined);
      } catch (e) {
        const sorted = sortRefundError(e);
        switch (sorted.is) {
          case "already_done": await settledByPerson(b, paymentId, amountInr, refs, sorted.error); return "done";
          case "held": {
            if (sorted.error.approval === null || sorted.error.call.body === undefined) {
              const note = `Guard is holding this refund with no approval to give: an earlier attempt has an unknown outcome, and only a person at the server can settle it, not the owner on WhatsApp. It was NOT sent again. Check Razorpay for payment ${paymentId}, then tell Guard (POST /admin/intents/resolve).`;
              log(b, b.customer, "refund", "unconfirmed", { paymentId, amountInr }, { refs, notes: note });
              raise(b, paymentId, "uncertain", note);
              return "stopped";
            }
            holds(b).push({ kind: "guard_hold", amountInr, paymentId, receipt, approval: sorted.error.approval, body: sorted.error.call.body, expiresAtMs: sorted.error.expiresAtMs, heldAtMs: clock.now(), ...(requestedBy && requestedBy.length > 0 ? { requestedBy } : {}) } as GuardHold);
            log(b, b.customer, "refund", "held_for_owner", { paymentId, amountInr }, { decisions, refs: { ...refs, approval: sorted.error.approval }, notes: "Guard is holding this refund for the owner. The approvals relay asks the owner, once; the agent does not." });
            return "held";
          }
          case "may_have_happened": return await maybeDone(sorted.why);
          case "refused": {
            const note = `Guard refused the refund (${sorted.error.kind === "limit" ? "a limit" : "a rule"}${sorted.error.ruleId ? `: ${sorted.error.ruleId}` : ""}): ${sorted.error.guard.reason ?? sorted.error.message}. Nothing was refunded.`;
            log(b, b.customer, "refund", "blocked", { paymentId, amountInr }, { refs, notes: note });
            raise(b, paymentId, "refused", note);
            return "stopped";
          }
          case "no_good": {
            const note = `Guard did not take the refund and will not on a retry: ${sorted.why}. Nothing was refunded.`;
            log(b, b.customer, "refund", "failed", { paymentId, amountInr }, { refs, notes: note });
            raise(b, paymentId, "failed", note);
            return "stopped";
          }
          case "lost": case "not_sent": error = sorted.why; break; // look again, and try once more
        }
      }
    }
    log(b, b.customer, "refund", error ? "failed" : "unconfirmed", { paymentId, amountInr }, { refs, notes: `${error ?? "the refund could not be sent"}; it will be tried again` });
    return "retry";
  }

  /** What the customer is told after a refund was asked for, and what is kept to try again. */
  async function afterRefund(b: C, result: RefundResult, a: { paymentId: string; amountInr: number; done: { customer: string; owner?: string }; held: string; requestedBy?: string[] }): Promise<void> {
    if (result === "done") {
      await tellCustomer(b, b.customer, [a.done.customer], { refundInr: a.amountInr });
      if (a.done.owner) await tellOwner(b, b.customer, a.done.owner, { refundInr: a.amountInr });
      return;
    }
    if (result === "held") { await tellCustomer(b, b.customer, [a.held], { refundInr: a.amountInr }); return; }
    if (result === "retry") holds(b).push({ kind: "refund_retry", amountInr: a.amountInr, paymentId: a.paymentId, tries: 0, retryAtMs: clock.now() + RETRY_MINUTES[0] * MINUTE, then: { ...a.done, held: a.held }, ...(a.requestedBy && a.requestedBy.length > 0 ? { requestedBy: a.requestedBy } : {}) } as RefundRetry);
    await tellCustomer(b, b.customer, [deps.ids.checking], { refundInr: a.amountInr });
  }

  /** A refund that could not be sent at all is tried again by the clock, a few times; then the builder is told. */
  async function retryRefund(b: C, p: RefundRetry): Promise<void> {
    b.pending = b.pending.filter((x) => x !== p);
    const result = await requestRefund(b, p.paymentId, p.amountInr, [], overLimit(p.amountInr), p.requestedBy);
    if (result === "retry") {
      const tries = p.tries + 1;
      if (tries >= RETRY_MINUTES.length) {
        const note = `The refund of ${formatInr(p.amountInr)} for payment ${p.paymentId} could not be sent after ${tries + 1} tries. Nothing was refunded.`;
        log(b, b.customer, "refund", "failed", { paymentId: p.paymentId, amountInr: p.amountInr }, { notes: note, refs: { paymentId: p.paymentId } });
        raise(b, p.paymentId, "failed", note);
        return;
      }
      holds(b).push({ ...p, tries, retryAtMs: clock.now() + RETRY_MINUTES[tries] * MINUTE });
      return;
    }
    if (result === "done") { await tellCustomer(b, b.customer, [p.then.customer], { refundInr: p.amountInr }); if (p.then.owner) await tellOwner(b, b.customer, p.then.owner, { refundInr: p.amountInr }); }
    else if (result === "held") await tellCustomer(b, b.customer, [p.then.held], { refundInr: p.amountInr });
  }

  // ---- a look at a refund whose outcome is not known (the panel's to-do list asks for it) -------------------------------------------------

  /**
   * Look once more, read-only, at the payments service's own list of refunds for each payment whose refund may have gone (unknown, uncertain, unconfirmed, or failed after its
   * tries). A refund that is on the list is recorded as confirmed and the problem is cleared. Nothing is ever SENT: no refund is asked for again, and the payment stays in
   * `stoppedRefunds`. Returns how many it settled, and how many it looked at and still could not see.
   */
  async function recheck(b: C): Promise<{ settled: number; looked: number }> {
    let settled = 0;
    let looked = 0;
    for (const issue of [...issuesOf(b)]) {
      if (!["unknown", "uncertain", "unconfirmed", "failed"].includes(issue.kind)) continue;
      looked++;
      const refs = { paymentId: issue.paymentId };
      let found;
      try { found = (await payments.listRefunds(issue.paymentId)).find((r) => r.receipt === `${b.id}:${issue.paymentId}`); } catch (e) {
        if (!(e instanceof TimeoutError) && !(e instanceof ApiError)) throw e;
        log(b, b.customer, "refund", "unconfirmed", { paymentId: issue.paymentId, recheck: true }, { refs, notes: `looked again, but the payments service's list could not be read (${(e as Error).message}). Nothing was sent` });
        continue;
      }
      if (found) {
        log(b, b.customer, "refund", "confirmed", { paymentId: issue.paymentId, recheck: true }, { refs: { ...refs, refundId: found.id }, notes: "looked again: the payments service's own list now shows the refund. It was not sent again" });
        b.refundIssues = issuesOf(b).filter((x) => x !== issue);
        settled++;
      } else {
        log(b, b.customer, "refund", "unconfirmed", { paymentId: issue.paymentId, recheck: true }, { refs, notes: "looked again: the payments service's own list still does not show the refund. It was not sent again; check Razorpay" });
      }
    }
    return { settled, looked };
  }

  // ---- a refund Guard held: the relay says the owner decided ---------------------------------------------------------------------

  const holdFor = (approval: string): { b: C; hold: GuardHold } | undefined => {
    for (const b of deps.cases()) for (const hold of b.pending) if (hold.kind === "guard_hold" && (hold as GuardHold).approval === approval) return { b, hold: hold as GuardHold };
    return undefined;
  };
  const dropHold = (b: C, hold: GuardHold) => { b.pending = b.pending.filter((x) => x !== hold); };

  async function onApprovalDecision(event: { approval: string; decision: "approve" | "deny" }): Promise<void> {
    const found = holdFor(event.approval);
    if (!found) {
      log(null, owner, "owner_decision", "blocked", { approval: event.approval, decision: event.decision }, { notes: "no refund is waiting on this approval, so nothing is done (it may be answered already, expired, or not ours)", refs: { approval: event.approval } });
      return;
    }
    const { b, hold } = found;
    const command = event.decision;
    // What the relay said is not yet a fact: the agent cannot see Guard's record. An approval is counted as the owner's (owner_decision, confirmed) only
    // when Guard has RELEASED the held call (see releaseHeld), so a forged "approve" event leaves nothing false in the record or the monthly report.
    log(b, owner, "owner_decision", "attempted", { approval: hold.approval, decision: command }, { refs: { command, approval: hold.approval }, notes: "the approvals relay says the owner decided" });
    if (command === "deny") {
      // A deny cannot be checked from here (a refund Guard did not send leaves no trace to read). It is the safe direction for the money, and it is final.
      log(b, owner, "owner_decision", "confirmed", { approval: hold.approval, decision: command }, { refs: { command, approval: hold.approval }, notes: "the approvals relay reported that the owner denied the refund" });
      dropHold(b, hold);
      stoppedOf(b).push(hold.paymentId); // Guard would hold the same call again under a new approval: the agent must not ask again
      log(b, b.customer, "refund", "blocked", { paymentId: hold.paymentId, amountInr: hold.amountInr }, { refs: { paymentId: hold.paymentId, approval: hold.approval }, notes: "the owner declined the refund" });
      await tellCustomer(b, b.customer, [deps.ids.denied]);
      return;
    }
    hold.approved = true;
    await releaseHeld(b, hold);
  }

  /** Send the held call again, with the very bytes it was held with. Only after the relay said the owner approved. */
  async function releaseHeld(b: C, hold: GuardHold): Promise<void> {
    const { paymentId, amountInr } = hold;
    const refs = { paymentId, amountPaise: String(amountInr * 100), approval: hold.approval };
    const later = (why: string) => {
      hold.tries = (hold.tries ?? 0) + 1;
      if (hold.tries >= RETRY_MINUTES.length) {
        dropHold(b, hold);
        const note = `The owner approved the refund, but it could not be sent after ${hold.tries} tries (${why}). Nothing was refunded.`;
        log(b, b.customer, "refund", "failed", { paymentId, amountInr }, { refs, notes: note });
        raise(b, paymentId, "failed", note);
        return tellCustomer(b, b.customer, [deps.ids.checking], { refundInr: amountInr }).then(() => undefined);
      }
      hold.retryAtMs = clock.now() + RETRY_MINUTES[hold.tries - 1] * MINUTE;
      log(b, b.customer, "refund", "failed", { paymentId, amountInr }, { refs, notes: `the approved refund could not be sent yet (${why}); it is tried again` });
    };
    /** Guard let the held call go, which it does only for an approved one: now the owner's approval is a fact the report may count. */
    const released = () => log(b, owner, "owner_decision", "confirmed", { approval: hold.approval, decision: "approve" }, { refs: { command: "approve", approval: hold.approval }, notes: "Guard released the held refund, so the owner's approval is on Guard's record" });
    const finish = async (refundId: string, note?: string) => {
      dropHold(b, hold);
      log(b, b.customer, "refund", "confirmed", { paymentId, amountInr }, { refs: { ...refs, refundId }, ...(note ? { notes: note } : {}) });
      await tellCustomer(b, b.customer, [deps.ids.approved], { refundInr: amountInr });
    };
    const stop = async (kind: RefundIssueKind, note: string, outcome: "failed" | "unconfirmed" | "blocked") => {
      dropHold(b, hold);
      log(b, b.customer, "refund", outcome, { paymentId, amountInr }, { refs, notes: note });
      raise(b, paymentId, kind, note);
      await tellCustomer(b, b.customer, [deps.ids.checking], { refundInr: amountInr });
    };

    // look before retrying: the refund may exist already
    let listed;
    try { listed = await findRefund(paymentId, hold.receipt); } catch (e) {
      if (!(e instanceof TimeoutError) && !(e instanceof ApiError)) throw e;
      return later(`could not look at the existing refunds first: ${(e as Error).message}`);
    }
    if (listed) return finish(listed.id, "the refund was already on the payments service's own list, so it was not sent again");

    try {
      // who asked goes again (B37): not needed for the approval, which Guard binds to the bytes, but if Guard holds it anew the new hold must not be asked of them
      await payments.resendRefund(paymentId, hold.body, hold.requestedBy);
    } catch (e) {
      const sorted = sortRefundError(e);
      switch (sorted.is) {
        case "already_done": {
          // a person at the server settled it as made while it waited for the owner: Guard did not use the owner's approval, and nothing was sent
          dropHold(b, hold);
          await settledByPerson(b, paymentId, amountInr, refs, sorted.error);
          await tellCustomer(b, b.customer, [deps.ids.approved], { refundInr: amountInr });
          return;
        }
        case "held":
          if (sorted.error.approval === null) return stop("uncertain", `After the owner approved, Guard holds the refund with no approval to give (an earlier attempt has an unknown outcome). It was NOT sent again. Check Razorpay for payment ${paymentId}, then tell Guard (POST /admin/intents/resolve).`, "unconfirmed");
          hold.approved = false;
          if (sorted.error.approval === hold.approval) { // Guard has no approval on record for this call: the owner's answer was not recorded there, and the owner was already asked
            log(b, b.customer, "refund", "held_for_owner", { paymentId, amountInr }, { refs, notes: "Guard still holds the refund: its record does not show the owner's approval. It waits; the owner is not asked again" });
            return;
          }
          hold.approval = sorted.error.approval;
          hold.expiresAtMs = sorted.error.expiresAtMs;
          log(b, b.customer, "refund", "held_for_owner", { paymentId, amountInr }, { refs: { ...refs, approval: sorted.error.approval }, notes: "Guard held the call again under a new approval (the first was used up or no longer valid). The relay will ask the owner about the new one" });
          return;
        case "refused": {
          const reason = sorted.error.guard.reason ?? sorted.error.message;
          if (/expire/iu.test(reason)) return expireGuardHold(b, hold, reason);
          return stop("refused", `Guard refused the approved refund (${sorted.error.kind === "limit" ? "a limit" : "a rule"}${sorted.error.ruleId ? `: ${sorted.error.ruleId}` : ""}): ${reason}. Nothing was refunded.`, "blocked");
        }
        case "no_good": return stop("failed", `Guard did not take the approved refund and will not on a retry: ${sorted.why}. Nothing was refunded.`, "failed");
        case "may_have_happened": case "lost": {
          released(); // the call went out: Guard does not send an unapproved one
          const found = await findRefund(paymentId, hold.receipt).catch(() => undefined);
          if (found) return finish(found.id, `${sorted.why}; the payments service's own list shows the refund, and it is not sent again`);
          return stop("unknown", `${sorted.why}. The approved refund may or may not have been made. It was NOT sent again. Check Razorpay for payment ${paymentId}; if Guard holds it as uncertain, tell Guard what happened (POST /admin/intents/resolve).`, "unconfirmed");
        }
        case "not_sent": return later(sorted.why);
      }
    }
    // the service took it: read back once; whatever the list shows, it is not sent again
    released();
    const after = await findRefund(paymentId, hold.receipt).catch(() => undefined);
    if (after) return finish(after.id);
    return stop("unconfirmed", "the payments service accepted the approved refund, but its own list does not show it yet. It is NOT sent again", "unconfirmed");
  }

  /**
   * Guard's approval ran out before the owner answered (or before the approved call could be used). Nothing was refunded; the customer is told. But look first: a hold
   * put back from a snapshot (a restore) may have been approved and sent after that snapshot, and then the payments service's own list shows the refund.
   */
  async function expireGuardHold(b: C, hold: GuardHold, why = "the owner did not answer before Guard's approval ran out"): Promise<void> {
    const made = await findRefund(hold.paymentId, hold.receipt).catch(() => undefined);
    if (made) {
      dropHold(b, hold);
      log(b, b.customer, "refund", "confirmed", { paymentId: hold.paymentId, amountInr: hold.amountInr }, { refs: { paymentId: hold.paymentId, approval: hold.approval, refundId: made.id }, notes: "the hold's time ran out here, but the payments service's own list shows the refund: it was made. It is not sent again" });
      await tellCustomer(b, b.customer, [deps.ids.approved], { refundInr: hold.amountInr });
      return;
    }
    dropHold(b, hold);
    const note = `${why}. Nothing was refunded. A new request for payment ${hold.paymentId} has to be made by the builder.`;
    log(b, b.customer, "refund", "failed", { paymentId: hold.paymentId, amountInr: hold.amountInr }, { refs: { paymentId: hold.paymentId, approval: hold.approval }, notes: note });
    raise(b, hold.paymentId, "expired", note);
    await tellCustomer(b, b.customer, [deps.ids.expired], { refundInr: hold.amountInr });
  }

  /**
   * The clock's share of the work, refunds first, whatever state their case is in. A hold whose approval ran out is over; one the owner approved and that
   * could not be sent yet is sent again; a refund that could not be sent at all is tried again. A hold nobody answered is NOT sent again: it just waits.
   */
  async function sweep(now: number): Promise<void> {
    for (const b of [...deps.cases()]) {
      for (const p of [...b.pending]) {
        if (p.kind === "guard_hold") {
          const hold = p as GuardHold;
          if (hold.expiresAtMs !== null && hold.expiresAtMs <= now) await expireGuardHold(b, hold);
          else if (hold.approved && hold.retryAtMs !== undefined && hold.retryAtMs <= now) await releaseHeld(b, hold);
        } else if (p.kind === "refund_retry" && (p as RefundRetry).retryAtMs <= now) await retryRefund(b, p as RefundRetry);
      }
    }
  }

  return { requestRefund, afterRefund, retryRefund, onApprovalDecision, releaseHeld, expireGuardHold, sweep, overLimit, stoppedOf, raise, recheck };
}
