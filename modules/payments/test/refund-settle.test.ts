// A refund whose outcome was unknown is settled only by the payments service's own list (follow-ups 3 and 4, 12 Nov 2026; modules/payments/refunds.ts settleIssue).
// Who uses this: the three templates' recheck_refund (a person's look) and their refund.done handler (the provider's own event). What it pins:
//   - the ORIGINAL attempt is settled, matched by the refund id its reply gave, by our receipt, or by the payment and the exact amount it asked for, and never by a
//     refund of the same payment for another amount;
//   - nothing is ever sent to the payments service (no refund is asked for again);
//   - the record line is the provider's confirmation (its refund id and the amount its list shows; never `confirmedBy`, which is a person's word);
//   - the customer, told "we will message you as soon as it is confirmed", is told once, in the template's own words (`ids.confirmed`);
//   - (12 Nov 2026, the combined run's finding) "told" only when WhatsApp accepted that message: one it refused (a template Meta has not approved yet) keeps the
//     refund on the to-do list as "refund made, customer not yet told" and is tried at the next beat, then less often; one that may have gone out, or that a gate
//     held back, is never sent again by itself; after an accepted one nothing is sent again, by the clock, a look or another event.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeClock } from "../../core/clock.ts";
import { MINUTE } from "../../core/time.ts";
import type { SaidOutcome } from "../../messaging/say.ts";
import { DEFAULT_OPTIONS, obligations } from "../../unfinished/index.ts";
import type { CaseLike } from "../../unfinished/index.ts";
import type { Payments, Refund } from "../payments.ts";
import { TELL_RETRY_MINUTES, createRefunds, recheckLine } from "../refunds.ts";
import type { RefundCase, RefundIssue } from "../refunds.ts";

const CUSTOMER = "+919811111111";
const OWNER = "+919800000000";
const PAYMENT = "pay_1";

interface Line { action: string; outcome: string; inputs: unknown; refs: Record<string, string>; notes?: string }

/**
 * A case with one open issue, a payments service whose list is `listed`, and every call and message kept. `refund` must never be called. `said`: how each try at the
 * customer's confirmation ends, in order (then "accepted"), as modules/messaging/say.ts reports it.
 */
function world(issue: Partial<RefundIssue>, listed: Refund[], said: SaidOutcome[] = []) {
  const b: RefundCase = { id: "b-1", customer: CUSTOMER, pending: [], refundIssues: [{ paymentId: PAYMENT, kind: "unknown", note: "the reply was lost", atMs: 0, ...issue }], stoppedRefunds: [PAYMENT] };
  const calls: string[] = [];
  const lines: Line[] = [];
  const told: { ids: string[]; refundInr?: number }[] = [];
  const tries: { id: string; refundInr?: number; outcome: SaidOutcome }[] = [];
  const clock = fakeClock(Date.UTC(2026, 10, 12, 6));
  const payments = {
    listRefunds: async (paymentId: string) => { calls.push(`list ${paymentId}`); return listed; },
    refund: async () => { calls.push("refund"); throw new Error("a refund must never be asked for again"); },
    resendRefund: async () => { calls.push("resend"); throw new Error("a refund must never be sent again"); },
  } as unknown as Payments;
  const flow = createRefunds<RefundCase>({
    payments, clock, owner: OWNER, limitInr: () => 1_000,
    log: (_c, _phone, action, outcome, inputs, more) => { lines.push({ action, outcome, inputs, refs: more?.refs ?? {}, ...(more?.notes ? { notes: more.notes } : {}) }); },
    tellCustomer: async (_c, _phone, ids, more) => { told.push({ ids, ...(more?.refundInr !== undefined ? { refundInr: more.refundInr } : {}) }); return true; },
    tellCustomerOutcome: async (_c, _phone, id, more) => {
      const outcome = said.shift() ?? "accepted";
      tries.push({ id, ...(more?.refundInr !== undefined ? { refundInr: more.refundInr } : {}), outcome });
      if (outcome === "accepted") told.push({ ids: [id], ...(more?.refundInr !== undefined ? { refundInr: more.refundInr } : {}) });
      return outcome;
    },
    tellOwner: async () => true,
    cases: () => [b],
    ids: { checking: "refund_checking", denied: "refund_denied", approved: "refund_approved", expired: "refund_expired", settled: "owner_refund_settled", confirmed: "refund_confirmed" },
  });
  return { b, calls, lines, told, tries, clock, flow };
}

/** The to-do list's items for this one case, as the panel works them out (modules/unfinished). */
const listed = (b: RefundCase, nowMs: number) =>
  obligations.detect({ template: "bookings", entries: [], cases: [{ ...b, state: "cancelled" } as unknown as CaseLike], nowMs, options: DEFAULT_OPTIONS }).found;

const refund = (over: Partial<Refund>): Refund => ({ id: "rfd_1", payment_id: PAYMENT, amount: 20_000, status: "processed", created_at: 1_700_000_000, ...over });

test("a look (recheck_refund) settles the attempt the list shows, tells the customer once, and sends nothing", async () => {
  const w = world({ amountPaise: 20_000 }, [refund({ receipt: `b-1:${PAYMENT}` })]);
  assert.deepEqual(await w.flow.recheck(w.b), { settled: 1, looked: 1, told: 1 });
  assert.deepEqual(w.b.refundIssues, [], "the issue is cleared");
  assert.deepEqual(w.b.stoppedRefunds, [PAYMENT], "and the payment is still never asked about again");
  assert.deepEqual(w.calls, [`list ${PAYMENT}`], "read-only: one look at the list, no refund");
  const line = w.lines.at(-1)!;
  assert.deepEqual([line.action, line.outcome, line.refs], ["refund", "confirmed", { paymentId: PAYMENT, amountPaise: "20000", refundId: "rfd_1" }], "the provider's id and the amount its list shows");
  assert.equal(line.refs.confirmedBy, undefined, "the provider's confirmation, not a person's word");
  assert.deepEqual(w.told, [{ ids: ["refund_confirmed"], refundInr: 200 }], "the customer hears it, with the exact amount");
  assert.deepEqual(w.b.refundsUntold, [], "told, so nothing is kept to tell");
  assert.deepEqual(await w.flow.recheck(w.b), { settled: 0, looked: 0, told: 0 }, "a second look finds nothing open");
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
  assert.deepEqual(await v.flow.recheck(v.b), { settled: 0, looked: 1, told: 0 }, "a look does not take it either");
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
    assert.deepEqual(await w.flow.recheck(w.b), { settled: 0, looked: 0, told: 0 }, kind);
  }
});

// ---- told only when WhatsApp accepts the message (12 Nov 2026) --------------------------------------------------------------------------------------------------

test("a confirmation WhatsApp refuses (its template is not approved yet): the refund is settled, the customer is not told, and the to-do list keeps it", async () => {
  const w = world({ amountPaise: 20_000 }, [refund({ receipt: `b-1:${PAYMENT}` })], ["not_sent"]);
  assert.deepEqual(await w.flow.recheck(w.b), { settled: 1, looked: 1, told: 0 });
  assert.deepEqual(w.b.refundIssues, [], "the refund is settled: it happened at the provider");
  assert.deepEqual(w.lines.filter((l) => l.action === "refund" && l.outcome === "confirmed").length, 1, "one confirmation line, for the report");
  assert.deepEqual(w.told, [], "nobody was told");
  assert.equal(w.b.refundsUntold?.length, 1);
  assert.deepEqual({ ...w.b.refundsUntold![0] }, { paymentId: PAYMENT, refundId: "rfd_1", amountInr: 200, sinceMs: w.clock.now(), tries: 1, lastAtMs: w.clock.now(), last: "not_sent", retryAtMs: w.clock.now() }, "tried again at the next beat");
  const items = listed(w.b, w.clock.now());
  assert.deepEqual(items.map((o) => [o.kind, o.caseId, o.facts.amountInr, o.facts.what]), [["refund_made_not_told", "b-1", 200, "tell_retry"]], "refund made, customer not yet told");
  assert.equal(recheckLine({ settled: 1, looked: 1, told: 0 }), "1 of 1 refunds now show on the payments service's list; the customer was told of 0, and 1 stays on the to-do list as \"refund made, customer not yet told\"; none was sent again", "the recovery line says what happened");
});

test("the next beat tries again, then less often; once WhatsApp accepts, the customer is told once and never again, by the clock, a look or another event", async () => {
  const listedRefund = refund({ id: "rfd_7" });
  const w = world({ kind: "unconfirmed", amountPaise: 20_000, refundId: "rfd_7" }, [listedRefund], ["not_sent", "not_sent", "not_sent"]);
  assert.equal(await w.flow.settleFromEvent(w.b, listedRefund, "evt_9"), true, "settled by the provider's event");
  assert.equal(w.tries.length, 1);
  await w.flow.sweep(w.clock.now()); // the next beat
  assert.equal(w.tries.length, 2, "tried at the next beat");
  assert.equal(w.b.refundsUntold![0].retryAtMs, w.clock.now() + TELL_RETRY_MINUTES[1] * MINUTE, "then after a few minutes, not every beat");
  await w.flow.sweep(w.clock.now());
  assert.equal(w.tries.length, 2, "not before it is due: a refused template is not tried every 30 s");
  w.clock.advanceMinutes(TELL_RETRY_MINUTES[1]);
  await w.flow.sweep(w.clock.now());
  assert.equal(w.tries.length, 3);
  assert.equal(w.b.refundsUntold![0].tries, 3);
  w.clock.advanceMinutes(TELL_RETRY_MINUTES[2]); // Meta approves the template in the meantime: this try is accepted
  await w.flow.sweep(w.clock.now());
  assert.deepEqual(w.tries.map((t) => [t.id, t.refundInr, t.outcome]), [["refund_confirmed", 200, "not_sent"], ["refund_confirmed", 200, "not_sent"], ["refund_confirmed", 200, "not_sent"], ["refund_confirmed", 200, "accepted"]]);
  assert.deepEqual(w.told, [{ ids: ["refund_confirmed"], refundInr: 200 }], "told once, with the exact amount");
  assert.deepEqual(w.b.refundsUntold, [], "and nothing is kept to tell");
  assert.deepEqual(listed(w.b, w.clock.now()), [], "off the to-do list");
  for (let i = 0; i < 3; i++) { w.clock.advanceMinutes(24 * 60); await w.flow.sweep(w.clock.now()); }
  assert.equal(await w.flow.settleFromEvent(w.b, listedRefund, "evt_10"), false, "a second refund.done for the same refund settles nothing");
  assert.deepEqual(await w.flow.recheck(w.b), { settled: 0, looked: 0, told: 0 }, "a look finds nothing open");
  assert.equal(w.tries.length, 4, "nothing is sent after the accepted message");
  assert.equal(w.lines.filter((l) => l.action === "refund" && l.outcome === "confirmed").length, 1, "and the refund is confirmed once in the record");
});

test("a try that refuses for days goes on every few hours and stays listed: a template Meta approves late still reaches the customer", async () => {
  const w = world({ amountPaise: 20_000 }, [refund({ receipt: `b-1:${PAYMENT}` })], Array(40).fill("not_sent"));
  await w.flow.recheck(w.b);
  for (let hour = 0; hour < 72; hour++) { w.clock.advanceMinutes(60); await w.flow.sweep(w.clock.now()); }
  const n = w.tries.length;
  assert.ok(n > 10 && n < 25, `tried ${n} times in three days: steady, and not every beat`);
  assert.equal(w.b.refundsUntold![0].retryAtMs! - w.b.refundsUntold![0].lastAtMs, TELL_RETRY_MINUTES.at(-1)! * MINUTE, "every 6 hours at the end");
  assert.deepEqual(listed(w.b, w.clock.now()).map((o) => o.facts.what), ["tell_retry"], "still on the to-do list after three days");
});

for (const outcome of ["maybe", "held_back"] as const) {
  test(`a confirmation that ${outcome === "maybe" ? "may have gone out (no reply came back)" : "a gate held back (the customer said STOP)"} is never sent again by itself, and is listed for a person`, async () => {
    const w = world({ amountPaise: 20_000 }, [refund({ receipt: `b-1:${PAYMENT}` })], [outcome]);
    assert.deepEqual(await w.flow.recheck(w.b), { settled: 1, looked: 1, told: 0 });
    for (let i = 0; i < 5; i++) { w.clock.advanceMinutes(24 * 60); await w.flow.sweep(w.clock.now()); }
    assert.equal(w.tries.length, 1, "never tried again by the clock");
    assert.equal(w.b.refundsUntold![0].retryAtMs, undefined);
    assert.deepEqual(listed(w.b, w.clock.now()).map((o) => [o.kind, o.facts.what]), [["refund_made_not_told", "tell_person"]], "a person tells the customer");
    w.clock.advanceMinutes(3 * 24 * 60);
    assert.deepEqual(listed(w.b, w.clock.now()), [], "and it leaves the list by age, a week after the try, like other items with no done the record can see");
  });
}

test("the recovery line counts what happened: told of each, or how many stay on the to-do list", () => {
  assert.equal(recheckLine({ settled: 2, looked: 2, told: 2 }), "2 of 2 refunds now show on the payments service's list, and the customer was told of each one that does; none was sent again");
  assert.equal(recheckLine({ settled: 2, looked: 3, told: 0 }), "2 of 3 refunds now show on the payments service's list; the customer was told of 0, and 2 stay on the to-do list as \"refund made, customer not yet told\"; none was sent again");
  assert.equal(recheckLine({ settled: 0, looked: 1, told: 0 }), "0 of 1 refunds now show on the payments service's list; none was sent again", "nothing settled: no word about telling");
});
