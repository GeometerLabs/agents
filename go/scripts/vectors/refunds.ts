// Vector cases for go/internal/payments: ensureLink (links.ts) against a recording server through the Razorpay client, and createRefunds (refunds.ts) as SCENARIOS: a case in some state,
// a payments service that answers from a script, the owner's decisions and the clock's sweeps; what is written down is every call to the payments service, every record line, every
// telling of the customer and owner, every books event, the result of each step and the case's final state. The Go port must write the same lines and leave the same state.
import { createRazorpayPayments } from "../../../modules/payments/providers/razorpay/api.ts";
import { ensureLink } from "../../../modules/payments/links.ts";
import { createRefunds } from "../../../modules/payments/refunds.ts";
import { ApiError, GuardAlreadyDoneError, GuardConflictError, GuardDeniedError, GuardHeldError, GuardOutcomeUnknownError, GuardRefusedError, GuardSuspendedError, GuardUnauthenticatedError, GuardUnavailableError, NotSentError, TimeoutError } from "../../../modules/core/faults.ts";
import { recordCase } from "../lib/record.ts";
import type { Case, Scripted } from "../lib/record.ts";
import { fixture, guardReply, ok, status } from "./fixtures.ts";

// ---- ensureLink on the wire -------------------------------------------------------------------------------------------------------

async function viaLink(name: string, replies: Scripted[], req: any, opts: { agentToken?: string } = {}): Promise<Case> {
  return recordCase(name, replies, async (baseUrl) => {
    const r = await ensureLink(createRazorpayPayments({ baseUrl, timeoutMs: 150, ...(opts.agentToken ? { agentToken: opts.agentToken } : {}) }), req);
    return { link: r.link, ...(r.error !== undefined ? { error: r.error } : {}), ...(r.suspended ? { suspended: true } : {}) };
  }, { config: { req, agentToken: opts.agentToken ?? "" } });
}

export async function linkCases(): Promise<Case[]> {
  const link = (extra: Record<string, unknown> = {}) => ({ ...fixture("razorpay-payment-link-create.json"), amount: 60000, reference_id: "b-3", ...extra });
  const list = (...links: unknown[]) => ok({ payment_links: links });
  const req = { reference: "b-3", amountPaise: 60000, description: "Deposit" };
  const out: Case[] = [];
  out.push(await viaLink("ensureLink: none yet, create, read back", [list(), ok(link()), list(link())], req, { agentToken: "t" }));
  out.push(await viaLink("ensureLink: an open link for the amount already exists", [list(link())], req));
  out.push(await viaLink("ensureLink: a cancelled link and one for another amount do not count", [list(link({ status: "expired" }), link({ amount: 100 })), ok(link()), list(link({ status: "expired" }), link())], req));
  out.push(await viaLink("ensureLink: part payments with a minimum", [list(), ok(link()), list(link())], { ...req, acceptPartial: true, minPartialPaise: 25000 }));
  out.push(await viaLink("ensureLink: part payments, default minimum", [list(), ok(link()), list(link())], { ...req, acceptPartial: true }));
  out.push(await viaLink("ensureLink: the reply to the create was lost, the second try finds it", [list(), { cut: true }, list(link())], req));
  out.push(await viaLink("ensureLink: read back shows nothing twice, then the last look finds it", [list(), ok(link()), list(), list(), ok(link()), list(), list(link())], req));
  out.push(await viaLink("ensureLink: nothing ever shows", [list(), ok(link()), list(), list(), ok(link()), list(), list()], req));
  out.push(await viaLink("ensureLink: Guard says the licence is suspended", [list(), guardReply("suspended")], req));
  out.push(await viaLink("ensureLink: Guard refuses the amount", [list(), guardReply("refused_rule"), list(), guardReply("refused_rule"), list()], req));
  out.push(await viaLink("ensureLink: the service is down (500)", [status(500, { error: { description: "boom" } }), status(500, { error: { description: "boom" } }), status(500, { error: { description: "boom" } })], req));
  return out;
}

// ---- refund scenarios ---------------------------------------------------------------------------------------------------------------

type Err = { kind: string; [k: string]: any };
type Item = { ok: any } | { err: Err };

function makeError(e: Err): Error {
  const info = (decision: string, code: string, extra: Record<string, unknown> = {}) => ({ decision, code, sent: "no", retry: "no", ...extra });
  const call = { method: "POST", path: "/v1/payments/pay_1/refund", ...(e.body !== undefined ? { body: e.body } : {}) };
  switch (e.kind) {
    case "timeout": return new TimeoutError("Razorpay");
    case "notsent": return new NotSentError("Razorpay: could not connect (ECONNREFUSED).", "ECONNREFUSED");
    case "api": return new ApiError(e.status, e.message ?? `The payments service answered ${e.status}.`);
    case "held": return new GuardHeldError(202, "held by the Guard: refund-needs-owner", info("hold", "held_for_approval"), call, e.approval ?? null, e.expiresAtMs ?? null);
    case "refused": return new GuardRefusedError(403, "refused by the Guard: x", info("deny", "refused_by_policy", { reason: e.reason ?? "refund-at-most-deposit: amount 90000 is above the highest allowed value, 60000" }), call, e.limit ? "limit" : "rule", e.ruleId);
    case "denied": return new GuardDeniedError(403, "refused by the Guard: the person said no", info("deny", "refused_by_policy", { reason_code: "denied_by_approver", detail: { approval: e.approval ?? "ap-denied" } }), call);
    case "alreadyDone": return new GuardAlreadyDoneError(409, "refused by the Guard: reconciled", info("deny", "conflict", { reason_code: "already_done", detail: { confirmed_by: "operator:owner", intent: "intent:abc" } }), call);
    case "alreadyDoneBare": return new GuardAlreadyDoneError(409, "refused by the Guard: reconciled", info("deny", "conflict", { reason_code: "already_done" }), call);
    case "conflict": return new GuardConflictError(409, "refused by the Guard: other arguments", info("deny", "conflict"), call);
    case "unavailable": return new GuardUnavailableError(503, "refused by the Guard: kill switch engaged: test", info("deny", "guard_unavailable", { reason: "kill switch engaged: test" }), call);
    case "unknown": return new GuardOutcomeUnknownError(504, "refused by the Guard: outcome unknown", info("unknown", "outcome_unknown"), call);
    case "unauthenticated": return new GuardUnauthenticatedError(401, "refused by the Guard: no credential", info("deny", "unauthenticated"), call);
    case "suspended": return new GuardSuspendedError(402, "refused by the Guard: suspended", info("deny", "subscription_suspended"), call);
  }
  throw new Error(`unknown error kind ${e.kind}`);
}

interface Scenario { name: string; case: any; script: { listRefunds?: Item[]; refund?: Item[]; resendRefund?: Item[]; tellOutcome?: string[] }; steps: any[]; accounting?: boolean; now?: number; refundCase2?: any }

const refund = (over: Record<string, unknown> = {}) => ({ id: "rfnd_1", payment_id: "pay_1", amount: 60000, status: "processed", receipt: "b-3:pay_1", created_at: 1793700000, ...over });
const freshCase = (over: Record<string, unknown> = {}) => ({ id: "b-3", customer: "+919876500001", pending: [], ...over });
const hold = (over: Record<string, unknown> = {}) => ({ kind: "guard_hold", amountInr: 900, paymentId: "pay_1", receipt: "b-3:pay_1", approval: "ap-1", body: "{\"amount\":90000,\"receipt\":\"b-3:pay_1\"}", expiresAtMs: 1793800000000, heldAtMs: 1793700000000, ...over });

const NOW = 1_793_700_000_000;
const req = (amountInr = 600, o: Record<string, unknown> = {}) => ({ op: "request", paymentId: "pay_1", amountInr, decisions: [{ rule: "refund-limit", ok: true }], expectHold: amountInr > 500, ...o });

export function scenarios(): Scenario[] {
  const S: Scenario[] = [];
  const add = (name: string, c: any, script: Scenario["script"], steps: any[], more: Partial<Scenario> = {}) => S.push({ name, case: c, script, steps, ...more });
  const none: Item = { ok: [] };

  // requestRefund
  add("request: made, read back from the list", freshCase(), { listRefunds: [none, { ok: [refund()] }], refund: [{ ok: refund() }] }, [req(300, { expectHold: false }), { op: "after", result: "done", amountInr: 300 }]);
  add("request: with accounting", freshCase(), { listRefunds: [none, { ok: [refund({ amount: 30000 })] }], refund: [{ ok: refund({ amount: 30000 }) }] }, [req(300, { expectHold: false })], { accounting: true });
  add("request: already on the list (look first)", freshCase(), { listRefunds: [{ ok: [refund()] }] }, [req(600)]);
  add("request: the reply says replayed", freshCase(), { listRefunds: [none, { ok: [refund()] }], refund: [{ ok: { ...refund(), replayed: true } }] }, [req(600)]);
  add("request: sent above the limit and not held (unheld)", freshCase(), { listRefunds: [none, { ok: [refund()] }], refund: [{ ok: refund() }] }, [req(600)]);
  add("request: accepted, the list does not show it (unconfirmed)", freshCase(), { listRefunds: [none, none], refund: [{ ok: refund() }] }, [req(300, { expectHold: false })]);
  add("request: stopped payment is not asked again", freshCase({ stoppedRefunds: ["pay_1"] }), {}, [req(300, { expectHold: false })]);
  add("request: held for the owner", freshCase(), { listRefunds: [none], refund: [{ err: { kind: "held", approval: "ap-1", expiresAtMs: 1793800000000, body: "{\"amount\":90000,\"receipt\":\"b-3:pay_1\"}" } }] }, [req(900), { op: "after", result: "held", amountInr: 900 }]);
  add("request: held with who asked", freshCase(), { listRefunds: [none], refund: [{ err: { kind: "held", approval: "ap-1", expiresAtMs: null, body: "{\"amount\":90000}" } }] }, [req(900, { requestedBy: ["owner", "op:7"] })]);
  add("request: held with no approval (uncertain)", freshCase(), { listRefunds: [none], refund: [{ err: { kind: "held", approval: null, body: "{}" } }] }, [req(900)]);
  add("request: held but no body to keep (uncertain)", freshCase(), { listRefunds: [none], refund: [{ err: { kind: "held", approval: "ap-9" } }] }, [req(900)]);
  add("request: already done by a person", freshCase(), { listRefunds: [none], refund: [{ err: { kind: "alreadyDone" } }] }, [req(300, { expectHold: false }), { op: "after", result: "done", amountInr: 300, doneOwner: "owner_done" }]);
  add("request: already done, nobody named", freshCase(), { listRefunds: [none], refund: [{ err: { kind: "alreadyDoneBare" } }] }, [req(300, { expectHold: false })], { accounting: true });
  add("request: the owner's no on record", freshCase(), { listRefunds: [none], refund: [{ err: { kind: "denied" } }] }, [req(900), { op: "after", result: "denied", amountInr: 900 }]);
  add("request: refused by a rule", freshCase(), { listRefunds: [none], refund: [{ err: { kind: "refused", ruleId: "refund-at-most-deposit" } }] }, [req(900)], { accounting: true });
  add("request: refused by a limit", freshCase(), { listRefunds: [none], refund: [{ err: { kind: "refused", limit: true, ruleId: "refund-paise-per-day" } }] }, [req(900)]);
  add("request: another conflict is no good", freshCase(), { listRefunds: [none], refund: [{ err: { kind: "conflict" } }] }, [req(300, { expectHold: false })]);
  add("request: unauthenticated is no good", freshCase(), { listRefunds: [none], refund: [{ err: { kind: "unauthenticated" } }] }, [req(300, { expectHold: false })]);
  add("request: suspended is no good", freshCase(), { listRefunds: [none], refund: [{ err: { kind: "suspended" } }] }, [req(300, { expectHold: false })]);
  add("request: outcome unknown, the list shows it", freshCase(), { listRefunds: [none, { ok: [refund({ amount: 30000 })] }], refund: [{ err: { kind: "unknown" } }] }, [req(300, { expectHold: false })]);
  add("request: outcome unknown, the list does not", freshCase(), { listRefunds: [none, none], refund: [{ err: { kind: "unknown" } }] }, [req(300, { expectHold: false })]);
  add("request: the list cannot be read after outcome unknown", freshCase(), { listRefunds: [none, { err: { kind: "timeout" } }], refund: [{ err: { kind: "unknown" } }] }, [req(300, { expectHold: false })]);
  add("request: a 500 may have happened", freshCase(), { listRefunds: [none, none], refund: [{ err: { kind: "api", status: 500 } }] }, [req(300, { expectHold: false })]);
  add("request: a 400 sent nothing, tried again, then retry", freshCase(), { listRefunds: [none, none], refund: [{ err: { kind: "api", status: 400, message: "bad" } }, { err: { kind: "api", status: 400, message: "bad" } }] }, [req(300, { expectHold: false }), { op: "after", result: "retry", amountInr: 300, doneCust: "refund_done", doneOwner: "owner_done", held: "refund_held", requestedBy: ["owner"] }]);
  add("request: lost reply, then found on the second look", freshCase(), { listRefunds: [none, { ok: [refund({ amount: 30000 })] }], refund: [{ err: { kind: "timeout" } }] }, [req(300, { expectHold: false })]);
  add("request: Guard cannot decide twice", freshCase(), { listRefunds: [none, none], refund: [{ err: { kind: "unavailable" } }, { err: { kind: "unavailable" } }] }, [req(300, { expectHold: false })]);
  add("request: nothing listens", freshCase(), { listRefunds: [none, none], refund: [{ err: { kind: "notsent" } }, { err: { kind: "notsent" } }] }, [req(300, { expectHold: false })]);
  add("request: the first look cannot be read, so nothing is sent", freshCase(), { listRefunds: [{ err: { kind: "timeout" } }] }, [req(300, { expectHold: false })]);
  add("request: the first look fails with an ApiError", freshCase(), { listRefunds: [{ err: { kind: "api", status: 500, message: "boom" } }] }, [req(300, { expectHold: false })]);

  // retry exhaustion through the sweep
  const retry = (over: Record<string, unknown> = {}) => ({ kind: "refund_retry", amountInr: 300, paymentId: "pay_1", tries: 0, retryAtMs: NOW, then: { customer: "refund_done", owner: "owner_done", held: "refund_held" }, ...over });
  add("retry: tried again and done", freshCase({ pending: [retry()] }), { listRefunds: [none, { ok: [refund({ amount: 30000 })] }], refund: [{ ok: refund({ amount: 30000 }) }] }, [{ op: "sweep", now: NOW }]);
  add("retry: not yet due", freshCase({ pending: [retry({ retryAtMs: NOW + 1 })] }), {}, [{ op: "sweep", now: NOW }]);
  add("retry: fails again, a later try is kept", freshCase({ pending: [retry({ tries: 1 })] }), { listRefunds: [none, none], refund: [{ err: { kind: "notsent" } }, { err: { kind: "notsent" } }] }, [{ op: "sweep", now: NOW }]);
  add("retry: the last try fails and the builder is told", freshCase({ pending: [retry({ tries: 5 })] }), { listRefunds: [none, none], refund: [{ err: { kind: "notsent" } }, { err: { kind: "notsent" } }] }, [{ op: "sweep", now: NOW }], { accounting: true });
  add("retry: held this time", freshCase({ pending: [retry({ amountInr: 900 })] }), { listRefunds: [none], refund: [{ err: { kind: "held", approval: "ap-2", expiresAtMs: 5, body: "{}" } }] }, [{ op: "sweep", now: NOW }]);
  add("retry: denied this time", freshCase({ pending: [retry({ amountInr: 900 })] }), { listRefunds: [none], refund: [{ err: { kind: "denied" } }] }, [{ op: "sweep", now: NOW }]);
  add("retry: another pending kind of the template is left alone", freshCase({ pending: [{ kind: "template_thing", note: "x" }, retry({ retryAtMs: NOW + 5 })] }), {}, [{ op: "sweep", now: NOW }]);

  // the owner's decision on a held refund
  add("approval: unknown approval", freshCase({ pending: [hold()] }), {}, [{ op: "approval", approval: "ap-zzz", decision: "approve" }]);
  add("approval: deny", freshCase({ pending: [hold()] }), {}, [{ op: "approval", approval: "ap-1", decision: "deny" }], { accounting: true });
  add("approval: approve, sent, read back", freshCase({ pending: [hold()] }), { listRefunds: [none, { ok: [refund({ amount: 90000 })] }], resendRefund: [{ ok: refund({ amount: 90000 }) }] }, [{ op: "approval", approval: "ap-1", decision: "approve" }]);
  add("approve: it was on the list already", freshCase({ pending: [hold()] }), { listRefunds: [{ ok: [refund({ amount: 90000 })] }] }, [{ op: "approval", approval: "ap-1", decision: "approve" }]);
  add("approve: the look cannot be made, tried later", freshCase({ pending: [hold()] }), { listRefunds: [{ err: { kind: "timeout" } }] }, [{ op: "approval", approval: "ap-1", decision: "approve" }]);
  add("approve: accepted but not on the list", freshCase({ pending: [hold()] }), { listRefunds: [none, none], resendRefund: [{ ok: refund({ amount: 90000 }) }] }, [{ op: "approval", approval: "ap-1", decision: "approve" }]);
  add("approve: not sent yet, then the sweep tries again", freshCase({ pending: [hold({ requestedBy: ["owner"] })] }), { listRefunds: [none, none, none, { ok: [refund({ amount: 90000 })] }], resendRefund: [{ err: { kind: "notsent" } }, { ok: refund({ amount: 90000 }) }] }, [{ op: "approval", approval: "ap-1", decision: "approve" }, { op: "sweep", now: NOW + 61_000 }]);
  add("approve: never sent, the tries run out", freshCase({ pending: [hold({ tries: 5, approved: true, retryAtMs: NOW })] }), { listRefunds: [none], resendRefund: [{ err: { kind: "unavailable" } }] }, [{ op: "sweep", now: NOW }]);
  add("approve: held with no approval", freshCase({ pending: [hold()] }), { listRefunds: [none], resendRefund: [{ err: { kind: "held", approval: null } }] }, [{ op: "approval", approval: "ap-1", decision: "approve" }]);
  add("approve: held again under the same approval", freshCase({ pending: [hold()] }), { listRefunds: [none], resendRefund: [{ err: { kind: "held", approval: "ap-1", expiresAtMs: 5 } }] }, [{ op: "approval", approval: "ap-1", decision: "approve" }]);
  add("approve: held again under a new approval", freshCase({ pending: [hold()] }), { listRefunds: [none], resendRefund: [{ err: { kind: "held", approval: "ap-2", expiresAtMs: 77 } }] }, [{ op: "approval", approval: "ap-1", decision: "approve" }]);
  add("approve: a person had settled it", freshCase({ pending: [hold()] }), { listRefunds: [none], resendRefund: [{ err: { kind: "alreadyDone" } }] }, [{ op: "approval", approval: "ap-1", decision: "approve" }]);
  add("approve: Guard's record says no", freshCase({ pending: [hold()] }), { listRefunds: [none], resendRefund: [{ err: { kind: "denied" } }] }, [{ op: "approval", approval: "ap-1", decision: "approve" }]);
  add("approve: refused because it expired", freshCase({ pending: [hold()] }), { listRefunds: [none, none], resendRefund: [{ err: { kind: "refused", reason: "approval ap-1 has expired" } }] }, [{ op: "approval", approval: "ap-1", decision: "approve" }]);
  add("approve: refused by a rule", freshCase({ pending: [hold()] }), { listRefunds: [none], resendRefund: [{ err: { kind: "refused", ruleId: "refund-at-most-deposit" } }] }, [{ op: "approval", approval: "ap-1", decision: "approve" }], { accounting: true });
  add("approve: another conflict", freshCase({ pending: [hold()] }), { listRefunds: [none], resendRefund: [{ err: { kind: "conflict" } }] }, [{ op: "approval", approval: "ap-1", decision: "approve" }]);
  add("approve: outcome unknown, on the list", freshCase({ pending: [hold()] }), { listRefunds: [none, { ok: [refund({ amount: 90000 })] }], resendRefund: [{ err: { kind: "unknown" } }] }, [{ op: "approval", approval: "ap-1", decision: "approve" }]);
  add("approve: outcome unknown, not on the list", freshCase({ pending: [hold()] }), { listRefunds: [none, none], resendRefund: [{ err: { kind: "unknown" } }] }, [{ op: "approval", approval: "ap-1", decision: "approve" }]);
  add("approve: lost reply", freshCase({ pending: [hold()] }), { listRefunds: [none, none], resendRefund: [{ err: { kind: "timeout" } }] }, [{ op: "approval", approval: "ap-1", decision: "approve" }]);
  add("approve: a 500 from the service", freshCase({ pending: [hold()] }), { listRefunds: [none, none], resendRefund: [{ err: { kind: "api", status: 502 } }] }, [{ op: "approval", approval: "ap-1", decision: "approve" }]);

  // the clock: an unanswered hold sends nothing; an expired one ends
  add("sweep: an unanswered hold waits and sends nothing", freshCase({ pending: [hold()] }), {}, [{ op: "sweep", now: NOW + 3_600_000 }]);
  add("sweep: an approved hold not yet due waits", freshCase({ pending: [hold({ approved: true, tries: 1, retryAtMs: NOW + 99 })] }), {}, [{ op: "sweep", now: NOW }]);
  add("sweep: a hold whose approval ran out", freshCase({ pending: [hold({ expiresAtMs: NOW - 1 })] }), { listRefunds: [none] }, [{ op: "sweep", now: NOW }], { accounting: true });
  add("sweep: a hold that ran out but the refund was made", freshCase({ pending: [hold({ expiresAtMs: NOW - 1 })] }), { listRefunds: [{ ok: [refund({ amount: 90000 })] }] }, [{ op: "sweep", now: NOW }]);
  add("sweep: a hold with no end", freshCase({ pending: [hold({ expiresAtMs: null })] }), {}, [{ op: "sweep", now: NOW + 99_999_999_999 }]);
  add("expire: the words given", freshCase({ pending: [hold()] }), { listRefunds: [none] }, [{ op: "expire", index: 0, why: "Guard said so" }]);

  // recheck and the provider's own event
  const issue = (over: Record<string, unknown> = {}) => ({ paymentId: "pay_1", kind: "unknown", note: "n", atMs: NOW, amountPaise: 30000, ...over });
  add("recheck: the list now shows it and the customer is told", freshCase({ refundIssues: [issue()] }), { listRefunds: [{ ok: [refund({ amount: 30000 })] }] }, [{ op: "recheck" }], { accounting: true });
  add("recheck: shows it but the message is not sent, then the sweep retries", freshCase({ refundIssues: [issue()] }), { listRefunds: [{ ok: [refund({ amount: 30000 })] }], tellOutcome: ["not_sent", "accepted"] }, [{ op: "recheck" }, { op: "sweep", now: NOW }]);
  add("recheck: the message may have gone (never sent again)", freshCase({ refundIssues: [issue()] }), { listRefunds: [{ ok: [refund({ amount: 30000 })] }], tellOutcome: ["maybe"] }, [{ op: "recheck" }, { op: "sweep", now: NOW + 99_999_999 }]);
  add("recheck: the message was held back", freshCase({ refundIssues: [issue()] }), { listRefunds: [{ ok: [refund({ amount: 30000 })] }], tellOutcome: ["held_back"] }, [{ op: "recheck" }]);
  add("recheck: still not on the list", freshCase({ refundIssues: [issue()] }), { listRefunds: [none] }, [{ op: "recheck" }]);
  add("recheck: the list cannot be read", freshCase({ refundIssues: [issue()] }), { listRefunds: [{ err: { kind: "timeout" } }] }, [{ op: "recheck" }]);
  add("recheck: a refused issue is not looked at", freshCase({ refundIssues: [issue({ kind: "refused" })] }), {}, [{ op: "recheck" }]);
  add("recheck: matched by receipt, not by amount", freshCase({ refundIssues: [issue({ amountPaise: undefined })] }), { listRefunds: [{ ok: [refund({ amount: 12345 })] }] }, [{ op: "recheck" }]);
  add("recheck: matched by refund id", freshCase({ refundIssues: [issue({ refundId: "rfnd_9" })] }), { listRefunds: [{ ok: [refund({ id: "rfnd_8" }), refund({ id: "rfnd_9", receipt: "other" })] }] }, [{ op: "recheck" }]);
  add("recheck: a refund for another amount is not the one", freshCase({ refundIssues: [issue({ amountPaise: 30000 })] }), { listRefunds: [{ ok: [refund({ amount: 99, receipt: "other" })] }] }, [{ op: "recheck" }]);
  add("recheck: two issues, one settled", freshCase({ refundIssues: [issue(), issue({ paymentId: "pay_2", kind: "failed" })] }), { listRefunds: [{ ok: [refund({ amount: 30000 })] }, none] }, [{ op: "recheck" }]);
  add("event: settles the open issue", freshCase({ refundIssues: [issue()] }), {}, [{ op: "settleEvent", refund: refund({ amount: 30000 }), eventId: "evt_1" }]);
  add("event: no issue open", freshCase(), {}, [{ op: "settleEvent", refund: refund(), eventId: "evt_1" }]);
  add("event: an issue the list cannot answer", freshCase({ refundIssues: [issue({ kind: "expired" })] }), {}, [{ op: "settleEvent", refund: refund({ amount: 30000 }), eventId: "evt_1" }]);
  add("untold: a fractional rupee amount", freshCase({ refundIssues: [issue({ amountPaise: 1250 })] }), { listRefunds: [{ ok: [refund({ amount: 1250 })] }], tellOutcome: ["not_sent"] }, [{ op: "recheck" }]);
  add("untold: the retry waits grow", freshCase({ refundsUntold: [{ paymentId: "pay_1", refundId: "r", amountInr: 12.05, sinceMs: NOW, tries: 6, lastAtMs: NOW, last: "not_sent", retryAtMs: NOW }] }), { tellOutcome: ["not_sent"] }, [{ op: "sweep", now: NOW }]);
  return S;
}

/** Run one scenario through the TypeScript refunds and write down everything it did. */
async function run(sc: Scenario): Promise<unknown> {
  const calls: unknown[] = [];
  const lines: unknown[] = [];
  const queue = (op: "listRefunds" | "refund" | "resendRefund") => { const q = [...(sc.script[op] ?? [])]; return () => { const n = q.shift(); if (!n) { if (op === "listRefunds") return { ok: [] }; throw new Error(`unscripted ${op}`); } return n; }; };
  const next = { listRefunds: queue("listRefunds"), refund: queue("refund"), resendRefund: queue("resendRefund") };
  const answer = (op: keyof typeof next) => { const n: any = next[op](); if ("err" in n) throw makeError(n.err); return n.ok; };
  const tellQueue = [...(sc.script.tellOutcome ?? [])];
  const caseObj: any = structuredClone(sc.case);
  const payments: any = {
    async listRefunds(id: string) { calls.push({ op: "listRefunds", id }); return answer("listRefunds"); },
    async refund(id: string, r: unknown) { calls.push({ op: "refund", id, r }); return answer("refund"); },
    async resendRefund(id: string, body: string, by?: string[]) { calls.push({ op: "resendRefund", id, body, by: by ?? null }); return answer("resendRefund"); },
  };
  const accounting = sc.accounting ? { post(e: unknown, write: (m: Record<string, string>) => void) { lines.push({ post: e }); write({ money: "posted" }); } } : undefined;
  let clock = sc.now ?? NOW;
  const refunds = createRefunds<any>({
    payments, clock: { now: () => clock } as any, owner: "+919876500000", limitInr: () => 500,
    log: (c, phone, action, outcome, inputs, more) => { lines.push({ log: { case: c ? c.id : null, phone, action, outcome, inputs, more: more ?? null } }); },
    tellCustomer: async (c, phone, templates, more) => { lines.push({ tell: { who: "customer", templates, refundInr: more?.refundInr ?? null } }); return true; },
    tellCustomerOutcome: async (c, phone, template, more) => { const o = tellQueue.shift() ?? "accepted"; lines.push({ tellOutcome: { template, refundInr: more?.refundInr ?? null, answered: o } }); return o as any; },
    tellOwner: async (c, phone, template, more) => { lines.push({ tell: { who: "owner", templates: [template], refundInr: more?.refundInr ?? null } }); return true; },
    cases: () => [caseObj],
    ids: { checking: "refund_checking", denied: "refund_denied", approved: "refund_approved", expired: "refund_expired", settled: "refund_settled", confirmed: "refund_confirmed" },
    ...(accounting ? { accounting: accounting as any } : {}),
  });
  const results: unknown[] = [];
  for (const s of sc.steps) {
    try {
      switch (s.op) {
        case "request": results.push(await refunds.requestRefund(caseObj, s.paymentId, s.amountInr, s.decisions, s.expectHold, s.requestedBy)); break;
        case "after": await refunds.afterRefund(caseObj, s.result, { paymentId: "pay_1", amountInr: s.amountInr, done: { customer: s.doneCust ?? "refund_done", ...(s.doneOwner ? { owner: s.doneOwner } : {}) }, held: s.held ?? "refund_held", ...(s.requestedBy ? { requestedBy: s.requestedBy } : {}) }); results.push(null); break;
        case "approval": results.push(await refunds.onApprovalDecision({ approval: s.approval, decision: s.decision }) ?? null); break;
        case "sweep": clock = s.now; results.push(await refunds.sweep(s.now) ?? null); break;
        case "expire": results.push(await refunds.expireGuardHold(caseObj, caseObj.pending[s.index], s.why) ?? null); break;
        case "recheck": results.push(await refunds.recheck(caseObj)); break;
        case "settleEvent": results.push(await refunds.settleFromEvent(caseObj, s.refund, s.eventId)); break;
      }
    } catch (e) { results.push({ threw: (e as Error).message }); }
  }
  return { calls, lines, results, final: caseObj };
}

export async function refundCases(): Promise<unknown[]> {
  const out: unknown[] = [];
  for (const sc of scenarios()) out.push({ name: sc.name, accounting: sc.accounting ?? false, now: sc.now ?? NOW, case: sc.case, script: sc.script, steps: sc.steps, outcome: JSON.parse(JSON.stringify(await run(sc))) });
  return out;
}

export async function files(): Promise<[string, unknown][]> {
  return [["payments/testdata/links-vectors.json", { cases: await linkCases() }], ["payments/testdata/refunds-vectors.json", { cases: await refundCases() }]];
}
