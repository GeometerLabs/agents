// "We're checking, don't do it again yet" comes from saved state (plan B75, checkpoint item 8, 11 Nov 2026; docs/product/intent-and-outcomes.md). Through the real runtime:
//   - a refund whose outcome is unknown is kept on its booking (refundIssues and stoppedRefunds, in the saved snapshot): it survives a restart, a fresh attempt does not
//     send it again, days of the customer's silence do not clear it, the to-do list keeps it, and only the payments service's own list settles it, with its refund id;
//   - a wait for a Guard that ends with the step thrown away keeps the case number that step took: the hold (or link) its first try left at the provider is never taken
//     by the next customer's "look first" as their own.
//   - (12 Nov 2026) the look that settles it, or the provider's own refund.done, tells the customer once, as "we will message you as soon as it is confirmed" promised,
//     and the event settles the ORIGINAL attempt as the provider's confirmation, never a new refund.
//   - (12 Nov 2026, the combined run's finding) while Meta has not approved deposit_refund_confirmed, the settled refund stays on the to-do list as "refund made,
//     customer not yet told", the recovery line says so, and the clock tells the customer once the template is approved: once, and never again.
// The map of what exists and what does not is in modules/Explanation.md, "Unknown outcomes".
import { test } from "node:test";
import assert from "node:assert/strict";
import { CUSTOMER } from "../src/harness.ts";
import { GUARD_WAIT_MS } from "../../../../modules/runtime/guard-wait.ts";
import { outage } from "../../../../modules/runtime/test/outage.ts";
import { DEFAULT_OPTIONS, obligations } from "../../../../modules/unfinished/index.ts";
import { RECOVERY_ENTRY } from "../../../../modules/unfinished/registry.ts";
import { LANGUAGES } from "../../../../modules/language/languages.ts";
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
    assert.equal(confirmed[0].refs.amountPaise, "20000", "with the amount the provider's list shows, so the monthly report counts it in full");
    // 12 Nov 2026 (follow-up 3): "we will message you as soon as it is confirmed" is kept, once
    const toldConfirmed = () => kit.messaging.sentTo(CUSTOMER).filter((m) => /Your ₹200 refund is confirmed and is on its way back to you\./u.test(m.text)).length;
    assert.equal(toldConfirmed(), 1, "the customer hears it is confirmed");
    second.runtime.submit([{ kind: "recovery", id: "r-2", case: "b-1", action: "recheck_refund" }]);
    second.runtime.kick();
    await second.runtime.idle();
    assert.equal(toldConfirmed(), 1, "a second look finds nothing open and tells nobody again");
  } finally { await second.runtime.close(); kit.cleanup(); }
});

test("the provider's own refund.done settles a refund whose outcome was unknown: the original attempt, as the provider's confirmation, never a new refund (follow-up 4)", async () => {
  const kit = createKit();
  const refundCalls = () => kit.payments.calls.filter((c) => c.op === "refund").length;
  const { runtime, db } = kit.open();
  try {
    await kit.say(runtime, BOOK);
    kit.payments.customerPays(kit.linkFor("b-1")!.id);
    await kit.deliverPaymentEvents(runtime);
    // The refund reaches the provider (which queues its refund.done) and Guard says the outcome is unknown; the list does not show it yet, so it stays unknown.
    kit.payments.inject("refund", "outcomeUnknown");
    const listRefunds = kit.payments.listRefunds;
    kit.payments.listRefunds = async () => [];
    await kit.say(runtime, "cancel my booking");
    assert.equal(runtime.status().refunds.needBuilder.unknown, 1);
    // Now the provider's event arrives, and its list shows the refund.
    kit.payments.listRefunds = listRefunds;
    await kit.deliverPaymentEvents(runtime);
    assert.equal(runtime.status().refunds.needBuilder.total, 0, "settled by the provider's own word, checked against its list");
    assert.equal(refundCalls(), 1, "no new refund");
    const record = db.loadState().record;
    const confirmed = record.filter((e) => e.action === "refund" && e.outcome === "confirmed");
    assert.equal(confirmed.length, 1, "one confirmation, of the original attempt");
    assert.match(confirmed[0].refs.refundId ?? "", /^rfd/u);
    assert.equal(confirmed[0].refs.amountPaise, "20000");
    assert.ok(confirmed[0].refs.eventId, "recorded as the provider's confirmation (its event), not a look");
    assert.equal(confirmed[0].refs.confirmedBy, undefined, "never a person's word");
    const event = record.find((e) => e.action === "receive_payment_event" && e.refs.refundId === confirmed[0].refs.refundId)!;
    assert.equal(event.outcome, "confirmed");
    assert.match(event.notes ?? "", /the one whose outcome was unknown/u);
    assert.equal(kit.messaging.sentTo(CUSTOMER).filter((m) => /refund is confirmed/u.test(m.text)).length, 1, "the customer is told once");
  } finally { await runtime.close(); kit.cleanup(); }
});

test("a refund settled while Meta has not approved deposit_refund_confirmed: kept on the to-do list as made but not told, told once the template is approved, and never again", async () => {
  const kit = createKit({ notApproved: ["deposit_refund_confirmed"] });
  const { runtime, db } = kit.open();
  const toldConfirmed = () => kit.messaging.sentTo(CUSTOMER).filter((m) => /refund is confirmed/u.test(m.text)).length;
  const untold = () => {
    const saved = parseStore(db.loadState().snapshot!);
    return obligations.detect({ template: "bookings", entries: db.loadState().record, cases: [...saved.bookings.values()] as never, nowMs: kit.clock.now(), options: DEFAULT_OPTIONS }).found.filter((o) => o.kind === "refund_made_not_told");
  };
  try {
    await kit.say(runtime, BOOK);
    kit.payments.customerPays(kit.linkFor("b-1")!.id);
    await kit.deliverPaymentEvents(runtime);
    kit.payments.inject("refund", "outcomeUnknown");
    const listRefunds = kit.payments.listRefunds;
    kit.payments.listRefunds = async () => [];
    await kit.say(runtime, "cancel my booking");
    kit.clock.advance(2 * DAY); // the customer's 24-hour window closes: only an approved template reaches them now
    await runtime.tick();

    // A look settles it: the refund is made. The "it is confirmed" template is refused (not approved), so the customer is NOT told, and the record and the list say so.
    kit.payments.listRefunds = listRefunds;
    runtime.submit([{ kind: "recovery", id: "r-1", case: "b-1", action: "recheck_refund" }]);
    runtime.kick();
    await runtime.idle();
    assert.equal(runtime.status().refunds.needBuilder.total, 0, "the refund is settled");
    assert.equal(db.loadState().record.filter((e) => e.action === "refund" && e.outcome === "confirmed").length, 1);
    assert.equal(toldConfirmed(), 0, "not told: the template was refused");
    const record = db.loadState().record;
    const looked = record.findLastIndex((e) => e.action === RECOVERY_ENTRY && e.outcome === "attempted");
    assert.deepEqual(record.slice(looked).filter((e) => e.action === "send_message" && e.refs.to === "customer").map((e) => e.outcome), ["failed"], "the refused message is a failed line, not a confirmed one");
    const line = db.loadState().record.filter((e) => e.action === RECOVERY_ENTRY && e.outcome === "confirmed").at(-1)!;
    assert.match(line.notes ?? "", /the customer was told of 0, and 1 stays on the to-do list as "refund made, customer not yet told"/u, "the recovery line says what happened");
    assert.doesNotMatch(line.notes ?? "", /told of each/u);
    assert.deepEqual(untold().map((o) => [o.caseId, o.facts.amountInr, o.facts.what]), [["b-1", 200, "tell_retry"]], "on the to-do list: refund made, customer not yet told");

    await runtime.tick(); // the next beat tries again: still refused
    assert.equal(toldConfirmed(), 0);
    assert.equal(untold().length, 1, "still listed");

    // Meta approves the template; the next try that is due tells the customer, as the template.
    for (const language of LANGUAGES) kit.messaging.approve("deposit_refund_confirmed", language);
    kit.clock.advance(6 * 3_600_000);
    await runtime.tick();
    assert.equal(toldConfirmed(), 1, "told once the template is approved");
    assert.equal(kit.messaging.sentTo(CUSTOMER).filter((m) => /refund is confirmed/u.test(m.text)).at(-1)!.templateName, "deposit_refund_confirmed");
    assert.deepEqual(untold(), [], "off the to-do list");

    for (let day = 0; day < 3; day++) { kit.clock.advance(DAY); await runtime.tick(); }
    runtime.submit([{ kind: "recovery", id: "r-2", case: "b-1", action: "recheck_refund" }]);
    runtime.kick();
    await runtime.idle();
    await kit.deliverPaymentEvents(runtime); // the provider's own refund.done arrives late: it settles nothing and tells nobody
    assert.equal(toldConfirmed(), 1, "never told twice");
    assert.equal(db.loadState().record.filter((e) => e.action === "refund" && e.outcome === "confirmed").length, 1, "and confirmed once");
  } finally { await runtime.close(); kit.cleanup(); }
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
