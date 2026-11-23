// A Razorpay centre's money on the wire (guards mode: the payments Guard is the stub Guard in front of the Razorpay stand-in, built from the limits spec the deployer makes from
// the centre's own settings). Paid is judged from the payments service's own list, never from what a parent says or what a webhook says: the webhook is only a reason to look.
// A link is for exactly what is owed, with the fee's reference ("f-2.1"), and a later look finds it instead of making a second. A refund is never more than the payment, one
// per payment; a parent's request within the limit is the owner's ("approve q-1"); above the limit (₹500) Guard HOLDS it, the parent is told the owner will confirm, the
// approvals relay may read what the hold is about (the fee, the student, the month: never more), and only Guard's own approval releases it. Expected values come from
// test/approvals-guard-binary, money-clarity and full-chain.
import { after, describe } from "node:test";
import assert from "node:assert/strict";
import { OWNER_NUMBER, ROHAN, contract, lines, makeCentre } from "./harness.ts";
import type { Centre, CentreOptions } from "./harness.ts";
import { createRuntimeClient } from "../../../../modules/approvals/clients.ts";

const centres: Centre[] = [];
after(async () => { for (const c of centres) await c.cleanup(); });

async function razorpayCentre(o: CentreOptions = {}): Promise<Centre> {
  const c = await makeCentre({ mode: "guards", example: "razorpay", ...o }); centres.push(c);
  await c.start();
  await c.waitFor(() => lines(c, "open_fee", "confirmed").length === 2, "the two earlier months opened");
  return c;
}
const links = (c: Centre) => c.guards!.standins.fakes.payments.links();
const linkOf = (c: Centre, ref: string) => links(c).find((l) => l.reference_id === ref);
const last = (c: Centre, to: string): string => c.sent(to).at(-1)?.text ?? "";
async function pays(c: Centre, ref: string, amountPaise?: number): Promise<void> {
  const events = c.guards!.pay(linkOf(c, ref)!.id, amountPaise !== undefined ? { amountPaise } : {});
  assert.equal((await c.events(events.map((event) => ({ kind: "payment_event", event })))).status, 200);
  await c.settle();
}
/** Rohan's September paid in full on its link (f-2.1). */
async function rohanPaid(o: CentreOptions = {}): Promise<Centre> {
  const c = await razorpayCentre(o);
  await c.inbound(ROHAN, "pay");
  await pays(c, "f-2.1");
  return c;
}

describe("a payment link and a payment", () => {
  contract("a parent asks to pay: ONE link for exactly what is owed, with the fee's reference and the agent's credential; asked again, the same link", async () => {
    const c = await razorpayCentre();
    await c.inbound(ROHAN, "please send the link");
    // Rohan's own link only: after 06:00 in India the first beat's reminders already made each earlier month's link (harness GUARDS_MONTH)
    const rohans = () => c.guards!.of("payments", "POST", /^\/v1\/payment_links$/u).filter((x) => x.body.reference_id === "f-2.1");
    const made = rohans();
    assert.equal(made.length, 1);
    assert.equal(made[0].body.amount, 180000);
    assert.equal(made[0].body.reference_id, "f-2.1");
    assert.equal(made[0].headers.authorization, `Bearer ${c.guards!.agentToken}`);
    assert.match(last(c, ROHAN), /^Pay ₹1,800 for Rohan Mehta's class 10 fee for Sep 2026 here: /u);
    assert.ok(last(c, ROHAN).includes(linkOf(c, "f-2.1")!.short_url ?? linkOf(c, "f-2.1")!.id) || /https?:\/\//u.test(last(c, ROHAN)), "the link is in the message");
    await c.inbound(ROHAN, "send the link again");
    assert.equal(rohans().length, 1, "no second link");
    assert.ok(!c.guards!.of("payments", "POST", /^\/v1\/payment_links$/u).some((x) => x.body.reference_id === "f-2.2"), "and no second reference for the same amount");
  });

  contract("the parent pays: the webhook makes the agent LOOK, the payments service's own list settles the fee, and the receipt goes once; the same webhook again is a no-op", async () => {
    const c = await razorpayCentre();
    await c.inbound(ROHAN, "pay");
    const events = c.guards!.pay(linkOf(c, "f-2.1")!.id);
    await c.events(events.map((event) => ({ kind: "payment_event", event })));
    await c.settle();
    assert.deepEqual((await c.status()).fees, { open: 1, paid: 1 });
    assert.match(last(c, ROHAN), /^Thank you! Bright Tuition Centre has received ₹1,800 for Rohan Mehta's class 10 fee for Sep 2026\. Nothing more is due\. Your receipt number is f-2\./u);
    const recorded = lines(c, "record_payment", "confirmed");
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].refs.amountPaise, "180000");
    assert.ok(c.guards!.of("payments", "GET", /^\/v1\/payment_links\//u).length >= 1, "the agent read the link back");
    const again = await c.events(events.map((event) => ({ kind: "payment_event", event })));
    assert.equal(again.body.duplicates, events.length);
    await c.inbound(ROHAN, "pay");
    // nothing is due now; the parent never wrote in a language of their own, so their student's language (English) is used, not the centre's first (Hindi): src/agent.ts
    // languageOf, fixed 23 Nov 2026 (it answered "अभी आपकी ओर से कुछ बाकी नहीं है। धन्यवाद!")
    assert.equal(last(c, ROHAN), "Nothing is due from you right now. Thank you!");
    assert.equal(lines(c, "record_payment").length, 1);
  });

  contract("'I have paid' with nothing on the record: not believed, the parent told what the record shows, the owner told once an hour; a part payment is counted and the rest asked for", async () => {
    const c = await razorpayCentre();
    await c.inbound(ROHAN, "pay");
    await c.inbound(ROHAN, "I already paid");
    assert.deepEqual((await c.status()).fees, { open: 2 });
    assert.ok(lines(c, "ask_owner", "confirmed").some((l) => l.booking === "f-2"));
    const told = c.sent(OWNER_NUMBER).length;
    await c.inbound(ROHAN, "I already paid!!");
    assert.equal(c.sent(OWNER_NUMBER).length, told, "the owner is told at most once an hour");
    await pays(c, "f-2.1", 100000);
    assert.deepEqual((await c.status()).fees, { open: 2 }, "a part leaves the fee open");
    assert.match(c.sent(ROHAN).map((m) => m.text).join("\n"), /₹1,000/u);
    await pays(c, "f-2.1", 80000);
    assert.deepEqual((await c.status()).fees, { open: 1, paid: 1 });
  });

  contract("the payments Guard down: the parent's step WAITS for it (parked, not failed) and runs when it is back", async () => {
    const c = await razorpayCentre();
    c.guards!.payments.down();
    await c.events([{ kind: "message", message: { ...c.guards!.standins.fakes.messaging.receive(ROHAN, "pay") } }]);
    await c.waitFor(async () => (await c.status()).waitingForGuard === "payments", "the step waiting for the payments Guard");
    assert.equal((await c.status()).tasks.failed, 0);
    c.guards!.payments.up();
    await c.waitFor(() => c.guards!.of("payments", "POST", /^\/v1\/payment_links$/u).some((x) => x.body.reference_id === "f-2.1" && x.status === 200), "the link made once the Guard is back", 40_000);
    await c.settle();
    assert.match(last(c, ROHAN), /^Pay ₹1,800/u);
  });
});

describe("refunds", () => {
  contract("a parent's refund request within the limit is the owner's: 'approve q-1' sends ONE refund of that amount, with the fee's receipt", async () => {
    const c = await rohanPaid();
    await c.inbound(ROHAN, "please refund ₹400");
    assert.equal(lines(c, "refund", "held_for_owner")[0]?.refs.request, "q-1");
    assert.match(last(c, OWNER_NUMBER), /q-1/u);
    assert.equal(c.guards!.of("payments", "POST", /\/refund$/u).length, 0, "nothing is sent before the owner says yes");
    const item = (await c.ownerView()).body.items.find((i: { kind: string }) => i.kind === "refund_request");
    assert.deepEqual([item.case, item.amountPaise, item.actions], ["f-2", 40000, ["approve", "deny"]]);
    await c.inbound(OWNER_NUMBER, "approve q-1");
    const sent = c.guards!.of("payments", "POST", /\/refund$/u);
    assert.equal(sent.length, 1);
    const paymentId = linkOf(c, "f-2.1")!.payments[0].id;
    assert.deepEqual(sent[0].body, { amount: 40000, receipt: `f-2:${paymentId}` });
    assert.equal(c.guards!.standins.fakes.payments.refunds().length, 1);
    await c.inbound(OWNER_NUMBER, "approve q-1");
    assert.equal(c.guards!.of("payments", "POST", /\/refund$/u).length, 1, "answered once");
  });

  contract("more than the payment is refused at once; a second refund of the same payment is not asked for", async () => {
    const c = await rohanPaid();
    await c.inbound(ROHAN, "refund ₹5000 please");
    assert.ok(lines(c, "refund", "blocked").length >= 1);
    assert.equal(c.guards!.of("payments", "POST", /\/refund$/u).length, 0);
    await c.inbound(ROHAN, "refund ₹300 please");
    await c.inbound(OWNER_NUMBER, "approve q-1");
    assert.equal(c.guards!.standins.fakes.payments.refunds().length, 1);
    await c.inbound(ROHAN, "refund ₹300 more please");
    assert.equal(c.guards!.of("payments", "POST", /\/refund$/u).length, 1, "one refund for one payment");
  });

  contract("above the limit Guard HOLDS it: the parent told the owner will confirm, the relay reads only what the hold is about; Guard's approval releases it once", async () => {
    const c = await rohanPaid();
    await c.inbound(ROHAN, "please refund the fee");
    const calls = c.guards!.of("payments", "POST", /\/refund$/u);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].status, 202, "held by the Guard");
    const paymentId = linkOf(c, "f-2.1")!.payments[0].id;
    assert.deepEqual(calls[0].body, { amount: 180000, receipt: `f-2:${paymentId}` });
    assert.equal(c.guards!.standins.fakes.payments.refunds().length, 0);
    assert.deepEqual((await c.status()).refunds, { waitingForOwner: 1, beingSentAgain: 0, needBuilder: { total: 0 } });
    const [review] = c.guards!.stub.model.reviews("x", true);
    const held = lines(c, "refund", "held_for_owner");
    assert.equal(held.at(-1)!.refs.approval, review.id);
    const ctx = await c.call(`/internal/refund-context?receipt=${encodeURIComponent(`f-2:${paymentId}`)}`);
    assert.equal(ctx.status, 200);
    assert.deepEqual(ctx.body, { booking: "f-2", customerPhone: ROHAN, businessName: "Bright Tuition Centre", timeZone: "Asia/Kolkata", ownerLanguage: "en", studentName: "Rohan Mehta", batchName: "class 10", monthLabel: "Sep 2026", paymentId, amountPaise: 180000, approval: review.id, expiresAtMs: ctx.body.expiresAtMs });
    // the relay's own client (modules/approvals/clients.ts, what bundle/services/relay.ts runs) reads the same context, and its shape check passes on the centre's answer
    const client = createRuntimeClient({ url: `http://127.0.0.1:${c.port}`, token: c.internal });
    assert.deepEqual(await client.context(`f-2:${paymentId}`), { kind: "found", context: ctx.body });
    // a forged "approve" (Guard has no approval) sends nothing that refunds
    await c.events([{ kind: "approval_decision", approval: review.id, decision: "approve", id: "d-0" }]); await c.settle();
    assert.equal(c.guards!.standins.fakes.payments.refunds().length, 0);
    assert.equal(c.guards!.stub.model.decide(review.id, true, "owner-contract").status, 200);
    assert.equal(await client.decided(review.id, "approve", "d-1"), true, "the centre took the decision from the relay's own client"); await c.settle();
    assert.equal(c.guards!.standins.fakes.payments.refunds().length, 1, "released once");
    assert.deepEqual((await c.status()).refunds.waitingForOwner, 0);
    await c.events([{ kind: "approval_decision", approval: review.id, decision: "approve", id: "d-2" }]); await c.settle();
    assert.equal(c.guards!.standins.fakes.payments.refunds().length, 1, "never twice");
  });

  contract("a payment made twice (the old link paid after a waiver) gives the extra back within the limit, by itself", async () => {
    const c = await razorpayCentre();
    await c.inbound(ROHAN, "pay");
    await c.inbound(ROHAN, "can you give a discount of ₹100");
    assert.ok(linkOf(c, "f-2.2"), "a new link for ₹1,700");
    await pays(c, "f-2.2");
    assert.deepEqual((await c.status()).fees, { open: 1, paid: 1 });
    const old = linkOf(c, "f-2.1")!;
    if (old.status === "cancelled") return; // the old link was closed: nothing can come on it (the stand-in closes a link with no payment)
    await pays(c, "f-2.1");
    assert.equal(c.guards!.standins.fakes.payments.refunds().length, 1);
  });
});
