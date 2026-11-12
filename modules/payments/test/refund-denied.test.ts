// Guard's own record of the owner's no (monorepo ADR-0061 addendum, the owner's decision of 12 Nov 2026). For 24 hours after a person denies a held refund,
// Guard refuses the identical call with 403 `reason_code: "denied_by_approver"` instead of asking again. Who uses this: the three templates, through
// modules/payments/refunds.ts. What it pins: the runtime reads that refusal exactly as the relay's "deny" (the payment is never asked about again, the owner's
// decision is counted, nothing is raised for the builder) and the customer hears the owner's no, never "we are checking".
// Written 12 Nov 2026, not run yet (the owner runs every test in one pass).
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeClock } from "../../core/clock.ts";
import { GuardDeniedError } from "../../core/faults.ts";
import type { Payments } from "../payments.ts";
import { createRefunds } from "../refunds.ts";
import type { RefundCase } from "../refunds.ts";

const CUSTOMER = "+919811111111";
const OWNER = "+919800000000";
const PAYMENT = "pay_1";

interface Line { action: string; outcome: string; inputs: unknown; refs: Record<string, string>; notes?: string }

/** Guard's 403 for the identical refund after a no, as docs/guard-for-pathways.md shows it. */
const denied = () => new GuardDeniedError(403, "refused by the Guard: the person asked to approve this exact call said no (approval ap-7)", {
  decision: "deny", code: "refused_by_policy", sent: "no", retry: "no", reason_code: "denied_by_approver",
  reason: "the person asked to approve this exact call said no (approval ap-7): it is refused without asking anyone again for 24 hours after the no; a call with other arguments is a new request",
  detail: { approval: "ap-7", status: "denied", denied_at_ms: 1_000, until_ms: 1_000 + 86_400_000 },
}, { method: "POST", path: `/v1/payments/${PAYMENT}/refund`, body: '{"amount":20000,"receipt":"b-1:pay_1"}' });

function world() {
  const b: RefundCase = { id: "b-1", customer: CUSTOMER, pending: [] };
  const calls: string[] = [];
  const lines: Line[] = [];
  const told: string[][] = [];
  const payments = {
    listRefunds: async () => { calls.push("list"); return []; },
    refund: async () => { calls.push("refund"); throw denied(); },
    resendRefund: async () => { calls.push("resend"); throw denied(); },
  } as unknown as Payments;
  const flow = createRefunds<RefundCase>({
    payments, clock: fakeClock(Date.UTC(2026, 10, 12, 6)), owner: OWNER, limitInr: () => 100,
    log: (_c, _phone, action, outcome, inputs, more) => { lines.push({ action, outcome, inputs, refs: more?.refs ?? {}, ...(more?.notes ? { notes: more.notes } : {}) }); },
    tellCustomer: async (_c, _phone, ids) => { told.push(ids); return true; },
    tellOwner: async () => true,
    cases: () => [b],
    ids: { checking: "refund_checking", denied: "refund_denied", approved: "refund_approved", expired: "refund_expired", settled: "owner_refund_settled", confirmed: "refund_confirmed" },
  });
  return { b, calls, lines, told, flow };
}

test("a refund Guard refuses because a person said no is the owner's no: 'denied', never asked about again, counted, nothing for the builder, and the customer hears the no", async () => {
  const w = world();
  const result = await w.flow.requestRefund(w.b, PAYMENT, 200, [], true);
  assert.equal(result, "denied");
  assert.deepEqual(w.calls, ["list", "refund"], "one look first, one send, and no second try: the same call gets the same answer");
  assert.deepEqual(w.b.stoppedRefunds, [PAYMENT], "the payment is never asked about again");
  assert.deepEqual(w.b.refundIssues ?? [], [], "the owner's no is not something for the builder to look at");
  const decision = w.lines.find((l) => l.action === "owner_decision");
  assert.deepEqual([decision?.outcome, decision?.refs], ["confirmed", { command: "deny", approval: "ap-7" }], "the owner's decision is counted, from Guard's record");
  const blocked = w.lines.at(-1)!;
  assert.deepEqual([blocked.action, blocked.outcome, blocked.refs.approval], ["refund", "blocked", "ap-7"]);
  assert.match(blocked.notes ?? "", /owner declined the refund/u);
  await w.flow.afterRefund(w.b, result, { paymentId: PAYMENT, amountInr: 200, done: { customer: "cancelled_refund" }, held: "cancelled_refund_pending" });
  assert.deepEqual(w.told, [["refund_denied"]], "the owner's no, not 'we are checking'");
  // asked again, it is not sent: the stopped list answers before Guard is asked
  assert.equal(await w.flow.requestRefund(w.b, PAYMENT, 200, [], true), "stopped");
  assert.deepEqual(w.calls, ["list", "refund"]);
});

test("after the relay says approve, Guard's record of a no wins: the hold is dropped, the no is counted once, and the customer hears it", async () => {
  const w = world();
  w.b.pending.push({ kind: "guard_hold", amountInr: 200, paymentId: PAYMENT, receipt: `b-1:${PAYMENT}`, approval: "ap-7", body: '{"amount":20000,"receipt":"b-1:pay_1"}', expiresAtMs: null, heldAtMs: 0 } as never);
  await w.flow.onApprovalDecision({ approval: "ap-7", decision: "approve" });
  assert.deepEqual(w.calls, ["list", "resend"], "a look, then the identical bytes once");
  assert.deepEqual(w.b.pending, [], "the hold is dropped");
  assert.deepEqual(w.b.stoppedRefunds, [PAYMENT]);
  assert.deepEqual(w.b.refundIssues ?? [], []);
  assert.deepEqual(w.lines.filter((l) => l.action === "owner_decision" && l.outcome === "confirmed").map((l) => l.refs.command), ["deny"], "counted as the no Guard recorded, never as an approval");
  assert.deepEqual(w.told, [["refund_denied"]]);
});
