// The agent's refund flow when Guard decides (the harness puts a Guard model, built from the settings' own refund limit, in front of the refunds).
// A refund above the limit is held (202); the agent keeps the approval id and the exact bytes; the owner is asked by the approvals relay, once;
// after "approved" the same bytes are sent again, once. These tests play the relay's part with `ownerAnswers`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, GuardHeldError, TimeoutError } from "../../../../modules/core/faults.ts";
import { createGuardModel } from "../../../../modules/payments/guard-model.ts";
import { fakeClock } from "../../../../modules/core/clock.ts";
import { gatewayLimitsSpec } from "../src/guard-limits.ts";
import { createWorld, glowSalon, CUSTOMER, HARNESS_GUARD } from "../src/harness.ts";
import type { World } from "../src/harness.ts";
import { parseSettings } from "../src/settings.ts";
import { TEMPLATES } from "../src/language/templates.ts";
import { HOUR } from "../../../../modules/core/time.ts";

const limited = (refundLimitInr: number) => parseSettings({ ...JSON.parse(JSON.stringify(glowSalon())), cancellation: { windowHours: 24, refundLimitInr } });
const BOOK = "haircut day after tomorrow at 6pm";

/** A shop whose refund limit (₹100) is below its deposit (₹200): every refund of the deposit is held by Guard. */
async function paidAndCancelled(options: { refundLimitInr?: number; world?: Parameters<typeof createWorld>[0] } = {}) {
  const w = createWorld({ settings: limited(options.refundLimitInr ?? 100), ...options.world });
  const calls: { how: "refund" | "resend"; body: string }[] = [];
  const held: string[] = [];
  const { refund, resendRefund } = w.payments;
  w.payments.refund = async (id, request) => {
    try { return await refund(id, request); } catch (e) { if (e instanceof GuardHeldError && e.call.body) held.push(e.call.body); throw e; }
  };
  w.payments.resendRefund = async (id, body) => { calls.push({ how: "resend", body }); return resendRefund(id, body); };
  await w.say(BOOK);
  w.payments.customerPays(w.linkFor("b-1")!.id);
  await w.deliverPaymentEvents();
  await w.say("cancel my booking");
  return { w, calls, held };
}
const paymentOf = (w: World) => w.linkFor("b-1")!.payments[0].id;
const entries = (w: World, action: string, outcome?: string) => w.record.entries().filter((e) => e.action === action && (outcome === undefined || e.outcome === outcome));
const refundCalls = (w: World) => w.payments.calls.filter((c) => c.op === "refund").length;
const issues = (w: World) => w.store.bookings.get("b-1")!.refundIssues ?? [];

test("above the limit: the refund is held, the customer is told the owner will confirm, and the agent does not ask the owner", async () => {
  const { w } = await paidAndCancelled();
  assert.equal(w.payments.refunds().length, 0);
  assert.equal(w.heldForOwner().length, 1);
  assert.deepEqual(w.heldForOwner().map((h) => [h.amountPaise, h.paymentId, h.receipt]), [[20000, paymentOf(w), `b-1:${paymentOf(w)}`]], "the amount in paise, the payment, and the booking id in the receipt");
  assert.deepEqual(w.textsTo(w.owner), [], "the approvals relay asks the owner; the agent does not");
  assert.match(w.lastTextTo(CUSTOMER), /owner will confirm your ₹200 refund/);
  const asked = entries(w, "refund", "held_for_owner");
  assert.equal(asked.length, 1);
  assert.equal(asked[0].refs.approval, w.heldForOwner()[0].id);
  const hold = w.store.bookings.get("b-1")!.pending[0];
  assert.equal(hold.kind, "guard_hold");
  assert.equal((hold as any).body, '{"amount":20000,"receipt":"' + `b-1:${paymentOf(w)}` + '"}', "the exact bytes of the call that was held");
});

test("held, approved, sent again with the same bytes, confirmed once; the owner was asked exactly once", async () => {
  const { w, calls, held } = await paidAndCancelled();
  assert.equal(held.length, 1);
  await w.ownerAnswers("approve");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body, held[0], "byte for byte");
  assert.equal(w.payments.refunds().length, 1);
  assert.equal(w.payments.refunds()[0].amount, 20000);
  assert.equal(w.payments.refunds()[0].receipt, `b-1:${paymentOf(w)}`);
  assert.equal(entries(w, "refund", "confirmed").length, 1);
  assert.match(w.lastTextTo(CUSTOMER), /owner approved your refund/);
  assert.equal(w.store.bookings.get("b-1")!.pending.length, 0);
  assert.equal(w.heldForOwner().length, 0, "nothing is left waiting");
  assert.equal(w.guard.approvals().length, 1, "Guard only ever had one approval to ask about: one ask");
  assert.deepEqual(w.textsTo(w.owner), []);
  assert.deepEqual(entries(w, "owner_decision", "confirmed").map((e) => e.refs.command), ["approve"], "the report counts the owner's approvals from this: once, after Guard released the call");
  assert.match(entries(w, "owner_decision", "confirmed")[0].notes, /Guard released the held refund/);
});

test("the same answer twice, an approval for something else, and time passing send nothing more", async () => {
  const { w, calls } = await paidAndCancelled();
  const id = w.heldForOwner()[0].id;
  await w.ownerAnswers("approve");
  for (let i = 0; i < 3; i++) await w.agent.handle({ kind: "approval_decision", approval: id, decision: "approve" });
  await w.agent.handle({ kind: "approval_decision", approval: "ap-not-ours-9", decision: "approve" });
  await w.advance(3 * 60);
  assert.equal(calls.length, 1);
  assert.equal(w.payments.refunds().length, 1);
  assert.equal(w.guard.approvals().length, 1, "no repeat made Guard hold the call again");
  assert.ok(entries(w, "owner_decision", "blocked").length >= 4, "answers nobody was waiting for are in the record, and do nothing");
});

test("no blind retries: a held refund is never sent again on a timer, whatever time passes", async () => {
  const { w, calls } = await paidAndCancelled();
  const before = refundCalls(w);
  for (let i = 0; i < 6; i++) await w.advance(3 * 60); // 18 hours, inside the 24-hour approval
  assert.equal(calls.length, 0, "nothing was sent again");
  assert.equal(refundCalls(w), before);
  assert.equal(w.heldForOwner().length, 1, "still one ask, still the same one");
  assert.equal(w.guard.approvals().length, 1);
  assert.equal(w.store.bookings.get("b-1")!.pending[0].kind, "guard_hold");
});

test("a forged answer through the runtime's path: an approve event Guard has no approval behind makes the agent ask Guard once, and Guard holds it as before", async () => {
  const { w, calls } = await paidAndCancelled();
  const id = w.heldForOwner()[0].id;
  await w.agent.handle({ kind: "approval_decision", approval: id, decision: "approve" }); // nobody approved in Guard
  assert.equal(w.payments.refunds().length, 0, "Guard did not release it");
  assert.equal(calls.length, 1, "one look at Guard, and it said no");
  assert.deepEqual(w.heldForOwner().map((h) => h.id), [id], "the same hold, not a new one: the owner is not asked again");
  assert.equal(w.guard.approvals().length, 1);
  assert.equal((w.store.bookings.get("b-1")!.pending[0] as any).approved, false);
  assert.deepEqual(entries(w, "owner_decision", "confirmed"), [], "an approval is counted only when Guard released the call: nothing false is in the record, so the monthly count cannot be raised by a forged event");
  assert.equal(entries(w, "owner_decision", "attempted").length, 1, "what the relay said is in the record, as what it is");
  // and the owner's own commands do not reach it either: "approve b-1" is not how a Guard-held refund is answered
  await w.say("approve b-1", { from: w.owner });
  assert.equal(w.payments.refunds().length, 0);
  assert.deepEqual(w.textsTo(w.owner), []);
});

test("deny is final: the customer is told, nothing is sent, and the agent never asks Guard about this payment again", async () => {
  const { w, calls } = await paidAndCancelled();
  await w.ownerAnswers("deny");
  assert.equal(w.payments.refunds().length, 0);
  assert.match(w.lastTextTo(CUSTOMER), /decided not to refund the ₹200/);
  await w.advance(3 * 60);
  await w.say("cancel my booking"); // nothing to cancel any more
  assert.equal(calls.length, 0);
  assert.equal(w.heldForOwner().length, 0, "Guard would hold the same call again under a new approval; the agent does not make it");
  assert.deepEqual(w.store.bookings.get("b-1")!.stoppedRefunds, [paymentOf(w)]);
  assert.deepEqual(entries(w, "owner_decision", "confirmed").map((e) => e.refs.command), ["deny"]);
});

test("expiry: when the owner never answers, Guard's approval runs out, the customer is told plainly, nothing is refunded and the builder sees it", async () => {
  const { w, calls } = await paidAndCancelled();
  await w.advance(23 * 60);
  assert.equal(w.store.bookings.get("b-1")!.pending[0].kind, "guard_hold", "still waiting at 23 hours");
  await w.advance(2 * 60); // past 24 hours
  assert.equal(w.store.bookings.get("b-1")!.pending.length, 0);
  assert.match(w.lastTextTo(CUSTOMER), /did not answer in time about your ₹200 refund.*contact Glow Salon/);
  assert.equal(w.payments.refunds().length, 0);
  assert.equal(calls.length, 0);
  assert.deepEqual(issues(w).map((i) => i.kind), ["expired"]);
  assert.match(entries(w, "refund", "failed").at(-1)!.notes, /Nothing was refunded/);
});

test("an approval that Guard will no longer honour (it ran out between the answer and the send) ends the same way, and is not sent blind", async () => {
  const { w } = await paidAndCancelled();
  const id = w.heldForOwner()[0].id;
  w.clock.advance(24 * HOUR - 5_000); // 5 seconds before it runs out: the owner answers, but Guard needs 15 seconds to spare
  assert.equal(w.guard.decide(id, true, "owner").status, 200);
  await w.agent.handle({ kind: "approval_decision", approval: id, decision: "approve" });
  assert.equal(w.payments.refunds().length, 0);
  assert.deepEqual(issues(w).map((i) => i.kind), ["expired"]);
  assert.match(w.lastTextTo(CUSTOMER), /did not answer in time/);
});

test("look before retrying: a refund that already exists is treated as done and is not sent again", async () => {
  const { w, calls } = await paidAndCancelled();
  const id = w.heldForOwner()[0].id;
  assert.equal(w.guard.decide(id, true, "owner").status, 200);
  // someone else (the shop, in Razorpay's dashboard, with the same receipt) made the refund
  await w.payments.resendRefund(paymentOf(w), `{"amount":20000,"receipt":"b-1:${paymentOf(w)}"}`);
  assert.equal(w.payments.refunds().length, 1);
  const calledBefore = refundCalls(w);
  const sentBefore = calls.length; // the shop's own call above went through the same spy
  await w.agent.handle({ kind: "approval_decision", approval: id, decision: "approve" });
  assert.equal(calls.length, sentBefore, "the agent looked at the refunds first and did not send");
  assert.equal(refundCalls(w), calledBefore);
  assert.equal(w.payments.refunds().length, 1);
  assert.match(entries(w, "refund", "confirmed").at(-1)!.notes, /not sent again/);
  assert.match(w.lastTextTo(CUSTOMER), /owner approved your refund/);
});

test("a refund within the limit goes straight through Guard, and the customer is told; nobody is asked", async () => {
  const w = createWorld({ settings: limited(200) });
  await w.say(BOOK);
  w.payments.customerPays(w.linkFor("b-1")!.id);
  await w.deliverPaymentEvents();
  await w.say("cancel my booking");
  assert.equal(w.payments.refunds().length, 1);
  assert.equal(w.heldForOwner().length, 0);
  assert.equal(w.guard.approvals().length, 0, "Guard never held anything: the limit is the owner's ₹200, not ₹100");
  assert.deepEqual(w.textsTo(w.owner), []);
});

test("a late cancellation of a deposit within the limit stays the agent's own question: the owner is asked once, with the booking reference", async () => {
  const w = createWorld({ settings: limited(200) });
  await w.say(BOOK);
  w.payments.customerPays(w.linkFor("b-1")!.id);
  await w.deliverPaymentEvents();
  await w.advance(26 * 60); // Wed 10:00; the 6pm booking on Wed 5 Nov is 32 hours away... move closer
  w.clock.set(Date.parse("2026-11-05T12:30:00+05:30"));
  await w.say("cancel my booking");
  assert.equal(w.payments.refunds().length, 0);
  assert.equal(w.textsTo(w.owner).length, 1);
  assert.match(w.textsTo(w.owner)[0], /Reply "approve b-1" to refund it or "deny b-1" to keep it/);
  await w.say("approve b-1", { from: w.owner });
  assert.equal(w.payments.refunds().length, 1, "within the limit, Guard lets it through");
  assert.equal(w.guard.approvals().length, 0);
});

test("a late cancellation of a deposit ABOVE the limit goes straight to Guard: one ask, the relay's, not the agent's and then Guard's", async () => {
  const w = createWorld({ settings: limited(100) });
  await w.say(BOOK);
  w.payments.customerPays(w.linkFor("b-1")!.id);
  await w.deliverPaymentEvents();
  w.clock.set(Date.parse("2026-11-05T12:30:00+05:30"));
  await w.say("cancel my booking");
  assert.deepEqual(w.textsTo(w.owner), [], "the agent did not ask");
  assert.equal(w.heldForOwner().length, 1);
  assert.match(w.lastTextTo(CUSTOMER), /owner will decide about your ₹200 deposit/);
  await w.ownerAnswers("approve");
  assert.equal(w.payments.refunds().length, 1);
});

// ---- when the refund cannot simply be done ------------------------------------------------------------------------------------

test("outcome unknown on a refund within the limit: never sent again, recorded as not confirmed, the builder is told, the owner is not", async () => {
  const w = createWorld({ settings: limited(200) });
  await w.say(BOOK);
  w.payments.customerPays(w.linkFor("b-1")!.id);
  await w.deliverPaymentEvents();
  w.payments.inject("refund", "outcomeUnknown");
  const listRefunds = w.payments.listRefunds;
  w.payments.listRefunds = async () => []; // Razorpay's list does not show it
  await w.say("cancel my booking");
  w.payments.listRefunds = listRefunds;
  assert.equal(refundCalls(w), 1, "one call; the second try was not made");
  assert.deepEqual(issues(w).map((i) => i.kind), ["unknown"]);
  const note = entries(w, "refund", "unconfirmed").at(-1)!.notes;
  assert.match(note, /NOT sent again/);
  assert.match(note, /Check Razorpay/);
  assert.deepEqual(w.textsTo(w.owner), [], "the owner cannot settle it");
  assert.match(w.lastTextTo(CUSTOMER), /checking your ₹200 refund/);
  await w.advance(5 * 60); // time passing does not send it either
  await w.say("cancel my booking");
  assert.equal(refundCalls(w), 1);
});

test("outcome unknown after the owner approved: the same, and a later answer cannot send it either", async () => {
  const { w, calls } = await paidAndCancelled();
  const id = w.heldForOwner()[0].id;
  w.payments.inject("refund", "outcomeUnknown");
  const listRefunds = w.payments.listRefunds;
  w.payments.listRefunds = async () => [];
  await w.ownerAnswers("approve");
  assert.equal(calls.length, 1);
  assert.deepEqual(issues(w).map((i) => i.kind), ["unknown"]);
  await w.agent.handle({ kind: "approval_decision", approval: id, decision: "approve" });
  await w.advance(10 * 60);
  w.payments.listRefunds = listRefunds;
  assert.equal(calls.length, 1, "never repeated");
  assert.equal(w.heldForOwner().length, 0, "and Guard has nothing new to ask the owner about");
  assert.deepEqual(w.textsTo(w.owner), []);
});

test("a provider 5xx on a refund may have happened: not sent again", async () => {
  const w = createWorld({ settings: limited(200) });
  await w.say(BOOK);
  w.payments.customerPays(w.linkFor("b-1")!.id);
  await w.deliverPaymentEvents();
  w.payments.inject("refund", "serverError");
  const listRefunds = w.payments.listRefunds;
  w.payments.listRefunds = async () => [];
  await w.say("cancel my booking");
  w.payments.listRefunds = listRefunds;
  assert.equal(refundCalls(w), 1);
  assert.deepEqual(issues(w).map((i) => i.kind), ["unknown"]);
});

test("a hold with no approval id (an earlier try has an unknown outcome) goes to the builder, never to the owner", async () => {
  const w = createWorld({ settings: limited(200) });
  await w.say(BOOK);
  w.payments.customerPays(w.linkFor("b-1")!.id);
  await w.deliverPaymentEvents();
  w.payments.inject("refund", "uncertainHold");
  await w.say("cancel my booking");
  assert.deepEqual(issues(w).map((i) => i.kind), ["uncertain"]);
  assert.equal(w.store.bookings.get("b-1")!.pending.length, 0, "nothing waits for the owner: it cannot be approved on WhatsApp");
  assert.deepEqual(w.textsTo(w.owner), []);
  assert.match(entries(w, "refund", "unconfirmed").at(-1)!.notes, /only a person at the server can settle it, not the owner on WhatsApp/);
  assert.equal(refundCalls(w), 0);
});

test("Guard cannot decide (stopped, busy): nothing was sent, so the agent tries again by itself, a minute later, and the owner is not asked", async () => {
  const w = createWorld({ settings: limited(200) });
  await w.say(BOOK);
  w.payments.customerPays(w.linkFor("b-1")!.id);
  await w.deliverPaymentEvents();
  w.payments.inject("refund", "guardUnavailable", { times: 2 });
  await w.say("cancel my booking");
  assert.equal(w.payments.refunds().length, 0);
  assert.equal(w.store.bookings.get("b-1")!.pending[0].kind, "refund_retry");
  assert.match(w.lastTextTo(CUSTOMER), /checking your ₹200 refund/);
  await w.advance(1);
  assert.equal(w.payments.refunds().length, 1, "tried again after a minute, looking first");
  assert.equal(w.store.bookings.get("b-1")!.pending.length, 0);
  assert.match(w.lastTextTo(CUSTOMER), /Your booking for .* is cancelled\. Your ₹200 deposit is being refunded/);
  assert.deepEqual(w.textsTo(w.owner), []);
  assert.deepEqual(issues(w), []);
});

test("Guard stays down: a few tries, then the builder is told, and no more tries", async () => {
  const w = createWorld({ settings: limited(200) });
  await w.say(BOOK);
  w.payments.customerPays(w.linkFor("b-1")!.id);
  await w.deliverPaymentEvents();
  w.payments.inject("refund", "guardUnavailable", { times: 100 });
  await w.say("cancel my booking");
  for (let i = 0; i < 12; i++) await w.advance(60);
  assert.deepEqual(issues(w).map((i) => i.kind), ["failed"]);
  assert.equal(w.store.bookings.get("b-1")!.pending.length, 0);
  assert.equal(w.payments.refunds().length, 0);
  assert.deepEqual(w.textsTo(w.owner), []);
});

test("Guard refuses a refund by a limit (the day's cap): nothing is refunded, it is not retried, and the builder is told", async () => {
  const w = createWorld({ settings: limited(200) });
  await w.say(BOOK);
  w.payments.customerPays(w.linkFor("b-1")!.id);
  await w.deliverPaymentEvents();
  w.payments.inject("refund", "guardRefused");
  await w.say("cancel my booking");
  assert.deepEqual(issues(w).map((i) => i.kind), ["refused"]);
  assert.match(issues(w)[0].note, /a limit: refund-paise-per-day/);
  assert.equal(w.store.bookings.get("b-1")!.pending.length, 0);
  await w.advance(10);
  assert.equal(refundCalls(w), 0);
});

// The owner lowers the deposit in the settings (₹200 to ₹150) and Guard is given the new rules, while a booking paid at ₹200 is still open. The agent
// refunds what is on the booking's own record, ₹200, so Guard's bound (the new deposit) refuses it. The agent reads that like any refusal by a rule:
// nothing was sent, it is not tried again, and the builder is told, in the record and in the status counts. The customer is not told it is paid.
test("the deposit was lowered after a booking paid the old one: Guard refuses the older, larger refund, nothing is refunded, and the builder is told", async () => {
  const lowered = parseSettings({ ...JSON.parse(JSON.stringify(glowSalon())), deposit: { ...JSON.parse(JSON.stringify(glowSalon())).deposit, amountInr: 150 } });
  assert.equal(lowered.deposit.amountInr, 150);
  const w = createWorld({ payments: { guard: createGuardModel(gatewayLimitsSpec(lowered, HARNESS_GUARD), fakeClock(0)), guardLinks: false } }); // the ₹200 link was made before Guard had the new rules
  let asked = 0; // a call Guard refuses never reaches the service, so the service's own call list cannot count it
  const sendRefund = w.payments.refund;
  w.payments.refund = async (id, request) => { asked++; return sendRefund(id, request); };
  await w.say(BOOK);
  w.payments.customerPays(w.linkFor("b-1")!.id);
  await w.deliverPaymentEvents();
  assert.equal(w.store.bookings.get("b-1")!.depositInr, 200, "the booking's own record says ₹200");
  await w.say("cancel my booking");
  assert.equal(w.payments.refunds().length, 0, "Guard refused it: nothing was refunded");
  assert.equal(asked, 1);
  assert.deepEqual(issues(w).map((i) => i.kind), ["refused"]);
  assert.match(issues(w)[0].note, /Guard refused the refund \(a rule: refund-at-most-deposit\): .*20000 is above the highest allowed value, 15000\. Nothing was refunded\./);
  assert.equal(entries(w, "refund", "blocked").length, 1, "the record says blocked, with the same note");
  assert.equal(entries(w, "refund", "confirmed").length, 0);
  assert.deepEqual(w.heldForOwner(), [], "the owner is not asked about it");
  assert.deepEqual(w.textsTo(w.owner), []);
  assert.match(w.lastTextTo(CUSTOMER), /We are checking your ₹200 refund and will message you/, "the customer is told it is being checked, not that it was sent");
  await w.advance(120);
  assert.equal(asked, 1, "it is not tried again");
  assert.equal(w.payments.refunds().length, 0);
});

test("if Guard sends a refund above the limit without holding it, the builder is told that Guard's threshold does not match the settings", async () => {
  const unguarded = createWorld({ settings: limited(100), payments: { guard: undefined } });
  await unguarded.say(BOOK);
  unguarded.payments.customerPays(unguarded.linkFor("b-1")!.id);
  await unguarded.deliverPaymentEvents();
  await unguarded.say("cancel my booking");
  assert.equal(unguarded.payments.refunds().length, 1, "it went out: there was no Guard to hold it");
  assert.deepEqual(issues(unguarded).map((i) => i.kind), ["unheld"]);
  assert.match(issues(unguarded)[0].note, /does not match these settings/);
  assert.deepEqual(unguarded.store.bookings.get("b-1")!.stoppedRefunds ?? [], [], "the refund is done, so it is not blocked");
});

// ---- 409 already_done: a person at the server settled the refund as made (Guard's ADR-0060) ----------------------------------------------

/** A paid booking within the limit (₹200 limit, ₹200 deposit), its payment id, and a count of the refund calls the agent makes. */
async function paidWithinLimit() {
  const w = createWorld({ settings: limited(200) });
  await w.say(BOOK);
  w.payments.customerPays(w.linkFor("b-1")!.id);
  await w.deliverPaymentEvents();
  const sent: string[] = [];
  const { refund } = w.payments;
  w.payments.refund = async (id, request) => { sent.push(id); return refund(id, request); };
  return { w, pay: paymentOf(w), sent };
}

test("409 already_done: a refund a person at the server settled as made is done by their word; the owner is told plainly, and it is never sent again", async () => {
  const { w, pay, sent } = await paidWithinLimit();
  const { refund, listRefunds } = w.payments;
  // The connection is cut after the refund left, and Guard's own record says its outcome is unknown. The agent cannot look at Razorpay's list a second time,
  // so it does not send blind: it tries again in a minute. Meanwhile the person who looks after the server checks Razorpay and settles it as made.
  let cut = true, looks = 0;
  w.payments.refund = async (id, request) => {
    if (cut) { cut = false; w.guard.recordUnknown(id, { amount: request.amount, receipt: request.receipt }); throw new TimeoutError("refund"); }
    return refund(id, request);
  };
  w.payments.listRefunds = async (id) => { if (++looks === 2) throw new ApiError(503, "Razorpay is not answering"); await listRefunds(id); return []; };
  await w.say("cancel my booking");
  assert.match(w.lastTextTo(CUSTOMER), /checking your ₹200 refund/);
  w.guard.resolve(pay, "happened", "ops");
  await w.advance(2 * 60);
  // the second try reached Guard, which said already_done: nothing was sent, and it is not a failure
  assert.equal(w.payments.refunds().length, 0, "nothing was sent to Razorpay a second time (in this world the first never landed either: it is the person's word)");
  const done = entries(w, "refund", "confirmed");
  assert.equal(done.length, 1);
  assert.equal(done[0].refs.confirmedBy, "operator:ops");
  assert.equal(done[0].refs.intent, `intent:stub-${pay}`);
  assert.match(done[0].notes, /settled this refund as made \(already_done\).*not by the payments service's own list.*not sent again/);
  assert.deepEqual(issues(w), [], "nobody needs to look at it again");
  assert.deepEqual(w.store.bookings.get("b-1")!.stoppedRefunds, [pay], "and Guard is never asked about this payment again");
  assert.equal(w.textsTo(w.owner).at(-1), `Refund done: ₹200 for ${CUSTOMER}. The person who set up your agent checked it and marked it as made, so it is not sent a second time.`);
  assert.match(w.lastTextTo(CUSTOMER), /deposit is being refunded/, "the customer is told it is done, never that it failed");
  const tries = w.payments.calls.length;
  await w.advance(60 * 60);
  await w.say("cancel my booking");
  assert.equal(w.payments.calls.length, tries, "time passing and asking again send nothing");
  w.payments.listRefunds = listRefunds;
});

test("any other 409 (the same refund with other numbers) still means nothing was refunded: not sent again, and the builder is told", async () => {
  const { w, pay } = await paidWithinLimit();
  w.guard.recordSent(pay, { amount: 5000, receipt: "an-earlier-refund" }, { id: "rfnd_earlier" }); // Guard's once-only record holds a different refund of this payment
  await w.say("cancel my booking");
  assert.equal(w.payments.refunds().length, 0);
  assert.deepEqual(issues(w).map((i) => i.kind), ["failed"]);
  assert.match(issues(w)[0].note, /will not on a retry.*Nothing was refunded/);
  assert.equal(entries(w, "refund", "confirmed").length, 0);
  assert.ok(!w.textsTo(w.owner).some((t) => /Refund done/u.test(t)), "the owner is not told it is done");
});

test("409 already_done after the owner approved a held refund: done, the owner is told, nothing is sent, and the approval is not counted as used", async () => {
  const { w, calls } = await paidAndCancelled();
  const pay = paymentOf(w);
  // Guard's record of this very call says a person settled it as made
  w.guard.recordUnknown(pay, { amount: 20000, receipt: `b-1:${pay}` });
  w.guard.resolve(pay, "happened", "asha.ops");
  await w.ownerAnswers("approve");
  assert.equal(calls.length, 1, "the held bytes went to Guard once");
  assert.equal(w.payments.refunds().length, 0);
  assert.equal(entries(w, "refund", "confirmed").at(-1)!.refs.confirmedBy, "operator:asha.ops");
  assert.match(w.textsTo(w.owner).at(-1)!, /^Refund done: ₹200 for /u);
  assert.match(w.lastTextTo(CUSTOMER), /owner approved your refund/);
  assert.deepEqual(issues(w), []);
  assert.equal(w.store.bookings.get("b-1")!.pending.length, 0);
  assert.deepEqual(entries(w, "owner_decision", "confirmed"), [], "Guard did not release the held call, so the report does not count the approval as used");
});

test("every template the agent uses for these exists in all four languages", () => {
  for (const language of ["en", "hi", "ml", "kn"] as const) for (const id of ["refund_checking", "refund_expired", "owner_approval_done", "owner_approval_denied", "owner_approval_expired", "owner_approval_failed", "owner_approval_waiting", "owner_approval_closed", "owner_approval_refused", "owner_refund_settled"] as const) assert.ok(TEMPLATES[language][id], `${id} (${language})`);
});
