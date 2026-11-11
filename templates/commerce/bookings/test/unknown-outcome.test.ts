// "We're checking, don't do it again yet" comes from saved state (plan B75, checkpoint item 8, 11 Nov 2026; docs/product/intent-and-outcomes.md). Through the real runtime:
//   - a refund whose outcome is unknown is kept on its booking (refundIssues and stoppedRefunds, in the saved snapshot): it survives a restart, a fresh attempt does not
//     send it again, days of the customer's silence do not clear it, the to-do list keeps it, and only the payments service's own list settles it, with its refund id;
//   - a wait for a Guard that ends with the step thrown away keeps the case number that step took: the hold (or link) its first try left at the provider is never taken
//     by the next customer's "look first" as their own.
// The map of what exists and what does not is in modules/Explanation.md, "Unknown outcomes".
import { test } from "node:test";
import assert from "node:assert/strict";
import { CUSTOMER } from "../src/harness.ts";
import { GUARD_WAIT_MS } from "../../../../modules/runtime/guard-wait.ts";
import { outage } from "../../../../modules/runtime/test/outage.ts";
import { DEFAULT_OPTIONS, obligations } from "../../../../modules/unfinished/index.ts";
import { parseStore } from "../server/snapshot.ts";
import { createKit } from "./runtime-kit.ts";

const BOOK = "I want a haircut tomorrow at 6pm";
const OTHER = "+919822222222";
const DAY = 24 * 3_600_000;

test("a refund whose outcome is unknown: kept through a restart, a fresh attempt and days of silence, and settled only by the payments service's own list", async () => {
  const kit = createKit();
  const refundCalls = () => kit.payments.calls.filter((c) => c.op === "refund").length;
  const first = kit.open();
  await kit.say(first.runtime, BOOK);
  kit.payments.customerPays(kit.linkFor("b-1")!.id);
  await kit.deliverPaymentEvents(first.runtime);
  assert.equal(first.runtime.status().bookings.confirmed, 1);

  // The refund reaches the provider and its answer is lost: Guard says the outcome is unknown, and the provider's list does not show it yet.
  kit.payments.inject("refund", "outcomeUnknown");
  const listRefunds = kit.payments.listRefunds;
  kit.payments.listRefunds = async () => [];
  await kit.say(first.runtime, "cancel my booking");
  assert.equal(refundCalls(), 1);
  assert.equal(first.runtime.status().refunds.needBuilder.unknown, 1);
  assert.match(kit.messaging.sentTo(CUSTOMER).at(-1)!.text, /checking your ₹200 refund/u, "the customer hears \"we're checking\"");
  await first.runtime.close(); // the process stops

  const second = kit.open();
  try {
    assert.equal(second.runtime.status().refunds.needBuilder.unknown, 1, "after a restart it is still unknown, from the saved state");
    await kit.say(second.runtime, "cancel my booking"); // a fresh attempt
    for (let day = 0; day < 3; day++) { kit.clock.advance(DAY); await second.runtime.tick(); } // the customer goes quiet; the clock goes on
    assert.equal(refundCalls(), 1, "never sent again");
    const saved = parseStore(second.db.loadState().snapshot!);
    const b = saved.bookings.get("b-1")!;
    assert.deepEqual([b.refundIssues?.map((i) => i.kind), b.stoppedRefunds], [["unknown"], [b.depositPaymentId]], "tied to the payment it was for");
    const listed = obligations.detect({ template: "bookings", entries: second.db.loadState().record, cases: [...saved.bookings.values()] as never, nowMs: kit.clock.now(), options: DEFAULT_OPTIONS }).found;
    assert.deepEqual(listed.filter((o) => o.kind === "refund_unknown").map((o) => o.caseId), ["b-1"], "still on the to-do list");

    // The payments service's own list shows it now: a look (the to-do list's read-only recovery) settles it with the provider's refund id, and sends nothing.
    kit.payments.listRefunds = listRefunds;
    second.runtime.submit([{ kind: "recovery", id: "r-1", case: "b-1", action: "recheck_refund" }]);
    second.runtime.kick();
    await second.runtime.idle();
    assert.equal(second.runtime.status().refunds.needBuilder.total, 0);
    assert.equal(refundCalls(), 1);
    const confirmed = second.db.loadState().record.filter((e) => e.action === "refund" && e.outcome === "confirmed");
    assert.equal(confirmed.length, 1);
    assert.match(confirmed[0].refs.refundId ?? "", /^rfd/u, "settled by the provider's own record, which names the refund");
  } finally { await second.runtime.close(); kit.cleanup(); }
});

test("a wait that ends with the step thrown away keeps its case number: the next customer gets a new one, not the first try's hold", async () => {
  const kit = createKit();
  const calendar = outage(kit.calendar, "Google Calendar");
  const payments = outage(kit.payments, "Razorpay");
  const { runtime } = kit.open({ services: { calendar: calendar.service, payments: payments.service, messaging: kit.messaging }, guardLookAgainMs: [1_000] });
  try {
    payments.down();
    await kit.say(runtime, BOOK); // the first try holds the time under b-1, then cannot make the link: it is thrown away and waits
    assert.deepEqual(kit.calendar.events().map((e) => e.bookingRef), ["b-1"]);
    payments.up();
    calendar.down();
    kit.clock.advance(GUARD_WAIT_MS); // the bound: the last try cannot read the calendar, throws, and the task ends
    runtime.kick();
    await runtime.idle();
    assert.equal(runtime.status().tasks.failed, 1);
    assert.match(kit.messaging.sentTo(CUSTOMER).at(-1)!.text, /could not finish your request/u);

    calendar.up();
    await kit.say(runtime, BOOK, { from: OTHER });
    const theirs = kit.calendar.events().filter((e) => e.bookingRef === "b-2");
    assert.equal(theirs.length, 1, "the next customer's booking is b-2, with its own hold");
    assert.ok(theirs[0].summary.includes(OTHER), "a hold that names them");
    const left = kit.calendar.events().find((e) => e.bookingRef === "b-1")!;
    assert.ok(left.summary.includes(CUSTOMER), "the first try's hold was not taken over");
    assert.ok(kit.messaging.sentTo(OTHER).at(-1)!.text.includes(kit.linkFor("b-2")!.pay_url), "and the link they got is their own");
  } finally { await runtime.close(); kit.cleanup(); }
});
