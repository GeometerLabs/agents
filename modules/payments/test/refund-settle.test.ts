// A refund whose outcome was unknown is settled only by the payments service's own list (follow-ups 3 and 4, 12 Nov 2026; modules/payments/refunds.ts settleIssue).
// Who uses this: the three templates' recheck_refund (a person's look) and their refund.done handler (the provider's own event). What it pins:
//   - the ORIGINAL attempt is settled, matched by the refund id its reply gave, by our receipt, or by the payment and the exact amount it asked for, and never by a
//     refund of the same payment for another amount;
//   - nothing is ever sent to the payments service (no refund is asked for again);
//   - the record line is the provider's confirmation (its refund id and the amount its list shows; never `confirmedBy`, which is a person's word);
//   - the customer, told "we will message you as soon as it is confirmed", is told once, in the template's own words (`ids.confirmed`).
// Written 12 Nov 2026, not run yet (the owner runs every test in one pass).
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeClock } from "../../core/clock.ts";
import type { Payments, Refund } from "../payments.ts";
import { createRefunds } from "../refunds.ts";
import type { RefundCase, RefundIssue } from "../refunds.ts";

const CUSTOMER = "+919811111111";
const OWNER = "+919800000000";
const PAYMENT = "pay_1";

interface Line { action: string; outcome: string; inputs: unknown; refs: Record<string, string>; notes?: string }

/** A case with one open issue, a payments service whose list is `listed`, and every call and message kept. `refund` must never be called. */
function world(issue: Partial<RefundIssue>, listed: Refund[]) {
  const b: RefundCase = { id: "b-1", customer: CUSTOMER, pending: [], refundIssues: [{ paymentId: PAYMENT, kind: "unknown", note: "the reply was lost", atMs: 0, ...issue }], stoppedRefunds: [PAYMENT] };
  const calls: string[] = [];
  const lines: Line[] = [];
  const told: { ids: string[]; refundInr?: number }[] = [];
  const payments = {
    listRefunds: async (paymentId: string) => { calls.push(`list ${paymentId}`); return listed; },
    refund: async () => { calls.push("refund"); throw new Error("a refund must never be asked for again"); },
    resendRefund: async () => { calls.push("resend"); throw new Error("a refund must never be sent again"); },
  } as unknown as Payments;
  const flow = createRefunds<RefundCase>({
    payments, clock: fakeClock(Date.UTC(2026, 10, 12, 6)), owner: OWNER, limitInr: () => 1_000,
    log: (_c, _phone, action, outcome, inputs, more) => { lines.push({ action, outcome, inputs, refs: more?.refs ?? {}, ...(more?.notes ? { notes: more.notes } : {}) }); },
    tellCustomer: async (_c, _phone, ids, more) => { told.push({ ids, ...(more?.refundInr !== undefined ? { refundInr: more.refundInr } : {}) }); return true; },
    tellOwner: async () => true,
    cases: () => [b],
    ids: { checking: "refund_checking", denied: "refund_denied", approved: "refund_approved", expired: "refund_expired", settled: "owner_refund_settled", confirmed: "refund_confirmed" },
  });
  return { b, calls, lines, told, flow };
}

const refund = (over: Partial<Refund>): Refund => ({ id: "rfd_1", payment_id: PAYMENT, amount: 20_000, status: "processed", created_at: 1_700_000_000, ...over });

test("a look (recheck_refund) settles the attempt the list shows, tells the customer once, and sends nothing", async () => {
  const w = world({ amountPaise: 20_000 }, [refund({ receipt: `b-1:${PAYMENT}` })]);
  assert.deepEqual(await w.flow.recheck(w.b), { settled: 1, looked: 1 });
  assert.deepEqual(w.b.refundIssues, [], "the issue is cleared");
  assert.deepEqual(w.b.stoppedRefunds, [PAYMENT], "and the payment is still never asked about again");
  assert.deepEqual(w.calls, [`list ${PAYMENT}`], "read-only: one look at the list, no refund");
  const line = w.lines.at(-1)!;
  assert.deepEqual([line.action, line.outcome, line.refs], ["refund", "confirmed", { paymentId: PAYMENT, amountPaise: "20000", refundId: "rfd_1" }], "the provider's id and the amount its list shows");
  assert.equal(line.refs.confirmedBy, undefined, "the provider's confirmation, not a person's word");
  assert.deepEqual(w.told, [{ ids: ["refund_confirmed"], refundInr: 200 }], "the customer hears it, with the exact amount");
  assert.deepEqual(await w.flow.recheck(w.b), { settled: 0, looked: 0 }, "a second look finds nothing open");
  assert.equal(w.told.length, 1, "and tells nobody again");
});

test("the provider's refund.done settles the original attempt as the provider's confirmation, matched by the refund id its reply gave", async () => {
  const listed = refund({ id: "rfd_7" });
  const w = world({ kind: "unconfirmed", amountPaise: 20_000, refundId: "rfd_7" }, [listed]);
  assert.ok(w.flow.openIssueFor(w.b, listed));
  assert.equal(await w.flow.settleFromEvent(w.b, listed, "evt_9"), true);
  const line = w.lines.at(-1)!;
  assert.deepEqual([line.action, line.outcome, line.refs], ["refund", "confirmed", { paymentId: PAYMENT, amountPaise: "20000", refundId: "rfd_7", eventId: "evt_9" }]);
  assert.deepEqual(line.inputs, { paymentId: PAYMENT, event: "evt_9" });
  assert.deepEqual(w.told, [{ ids: ["refund_confirmed"], refundInr: 200 }]);
  assert.deepEqual(w.calls, [], "the template read the list; nothing more is called, and no refund is made");
  assert.equal(await w.flow.settleFromEvent(w.b, listed, "evt_9"), false, "the same event again settles nothing (the issue is gone)");
  assert.equal(w.told.length, 1);
});

test("an attempt with a refund id is settled only by THAT refund: another refund of the same payment does not settle it", async () => {
  const other = refund({ id: "rfd_other", receipt: `b-1:${PAYMENT}` });
  const w = world({ kind: "unconfirmed", amountPaise: 20_000, refundId: "rfd_7" }, [other]);
  assert.equal(w.flow.openIssueFor(w.b, other), undefined);
  assert.equal(await w.flow.settleFromEvent(w.b, other, "evt_1"), false);
  assert.equal(w.b.refundIssues?.length, 1, "still open, for a person to look at");
  assert.deepEqual(w.told, []);
});

test("with no refund id and no receipt on the provider's list, the payment and the exact amount match the attempt; another amount never does", async () => {
  const same = refund({ id: "rfd_2" }); // a provider that does not echo the receipt
  const w = world({ amountPaise: 20_000 }, [same]);
  assert.equal(await w.flow.settleFromEvent(w.b, same, "evt_2"), true);
  const smaller = refund({ id: "rfd_3", amount: 10_000 });
  const v = world({ amountPaise: 20_000 }, [smaller]);
  assert.equal(await v.flow.settleFromEvent(v.b, smaller, "evt_3"), false, "₹100 back is not the ₹200 this attempt asked for");
  assert.deepEqual(await v.flow.recheck(v.b), { settled: 0, looked: 1 }, "a look does not take it either");
  assert.equal(v.lines.at(-1)?.outcome, "unconfirmed");
  assert.deepEqual(v.told, []);
});

test("an issue saved before 12 Nov (no amount, no refund id) is settled by our receipt alone", async () => {
  const ours = refund({ id: "rfd_4", receipt: `b-1:${PAYMENT}` });
  const w = world({}, [refund({ id: "rfd_x", receipt: undefined })]);
  assert.equal(w.flow.openIssueFor(w.b, refund({ id: "rfd_x" })), undefined, "without a receipt, an old issue cannot be matched by amount");
  assert.equal(await w.flow.settleFromEvent(w.b, ours, "evt_4"), true);
  assert.equal(w.lines.at(-1)?.refs.refundId, "rfd_4");
});

test("kinds the list does not answer (refused, expired, unheld) are never settled by it", async () => {
  for (const kind of ["refused", "expired", "unheld"] as const) {
    const listed = refund({ receipt: `b-1:${PAYMENT}` });
    const w = world({ kind, amountPaise: 20_000 }, [listed]);
    assert.equal(await w.flow.settleFromEvent(w.b, listed, "evt_5"), false, kind);
    assert.deepEqual(await w.flow.recheck(w.b), { settled: 0, looked: 0 }, kind);
  }
});
