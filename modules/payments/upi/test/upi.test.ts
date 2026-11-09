// The UPI request, the owner's marks and replies, the refunds the owner owes, and the obligations read back from a record.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeClock } from "../../../core/clock.ts";
import { createRecord } from "../../../record/record.ts";
import { ensureLink } from "../../links.ts";
import { amountText, payeeProblem, readUpiLink, upiPayLink, vpaProblem } from "../link.ts";
import { closeRequest, emptyUpiState, markReceived, markRefund, noRazorpay, oweRefund, reminded, remindersDue, upiPayments, REFUND_REMINDERS_MAX, REFUND_REMINDER_EVERY_MS } from "../ledger.ts";
import { parseUpiReply, upiButtonId } from "../owner.ts";
import { UPI_ACTIONS, upiObligations } from "../obligations.ts";
import { DEFAULT_OPTIONS, obligations } from "../../../unfinished/index.ts";

const payee = { id: "glowsalon@okicici", payee: "Glow Salon" };

test("a UPI ID is checked in plain words, and kept in lower case", () => {
  assert.equal(vpaProblem("glowsalon@okicici"), null);
  assert.equal(vpaProblem("9876543210@ybl"), null);
  assert.equal(vpaProblem("Glow.Salon-1@OKICICI"), null);
  assert.match(vpaProblem("glowsalon")!, /needs an @/);
  assert.match(vpaProblem("g@okicici")!, /not a UPI ID/);
  assert.match(vpaProblem("glow salon@okicici")!, /not a UPI ID/);
  assert.match(vpaProblem("glowsalon@1bank")!, /not a UPI ID/);
  assert.match(vpaProblem("")!, /Add the shop's UPI ID/);
  assert.equal(payeeProblem("Glow Salon"), null);
  assert.match(payeeProblem("x".repeat(51))!, /longer than 50/);
  assert.match(payeeProblem("Glow\nSalon")!, /one line/);
});

test("the link follows NPCI's rules: pa, pn, am in decimals, tn, cu=INR; spaces as %20; no code, no sign", () => {
  const link = upiPayLink({ vpa: "GlowSalon@OKICICI", payee: "Glow & Salon", amountPaise: 20_000, note: "b-3" });
  assert.equal(link, "upi://pay?pa=glowsalon@okicici&pn=Glow%20%26%20Salon&am=200.00&tn=b-3&cu=INR");
  assert.equal(amountText(150_050), "1500.50");
  assert.deepEqual(readUpiLink(link), { pa: "glowsalon@okicici", pn: "Glow & Salon", am: "200.00", tn: "b-3", cu: "INR" });
  const hindi = upiPayLink({ vpa: "9876543210@ybl", payee: "ग्लो सैलून", amountPaise: 100, note: "f-1.1" });
  assert.ok(!/[^\x21-\x7e]/u.test(hindi), "the link is plain ASCII: the Hindi name is percent-encoded");
  assert.equal(readUpiLink(hindi)!.pn, "ग्लो सैलून");
  assert.throws(() => upiPayLink({ vpa: "nope", payee: "A", amountPaise: 100, note: "" }), /needs an @/);
  assert.throws(() => upiPayLink({ vpa: "a1@ybl", payee: "A", amountPaise: 0, note: "" }), /above zero/);
});

test("the request is a payment link to the template: made once (look first), its link is the upi:// link, and the code is never in it", async () => {
  const state = emptyUpiState();
  const clock = fakeClock(Date.UTC(2026, 10, 3, 4, 30));
  const payments = upiPayments(state, payee, clock);
  const made = await ensureLink(payments, { reference: "b-1", amountPaise: 20_000, description: "deposit" });
  const again = await ensureLink(payments, { reference: "b-1", amountPaise: 20_000, description: "deposit" });
  assert.equal(made.link!.id, again.link!.id);
  assert.equal(state.requests.length, 1);
  assert.equal(made.link!.pay_url, "upi://pay?pa=glowsalon@okicici&pn=Glow%20Salon&am=200.00&tn=b-1&cu=INR");
  assert.ok(state.requests[0].code && !made.link!.pay_url.includes(state.requests[0].code));
  await assert.rejects(payments.refund("upi-pay-1", { amount: 100 }), /never sends a refund/);
  await assert.rejects(noRazorpay.createRequest({ amount: 1, reference_id: "x", description: "" }), /no Razorpay account/);
});

test("marks: the button's amount is what is still asked; another amount leaves the rest with a new code; the same code twice counts once", async () => {
  const state = emptyUpiState();
  const clock = fakeClock(0);
  const payments = upiPayments(state, payee, clock);
  const link = (await payments.createRequest({ amount: 20_000, reference_id: "b-1", description: "" }));
  const first = state.requests[0].code!;
  const part = markReceived(state, first, 15_000, 1);
  assert.equal(part.kind, "marked");
  assert.equal(part.kind === "marked" && part.full, false);
  const second = state.requests[0].code!;
  assert.notEqual(second, first, "the rest has its own code");
  assert.equal(markReceived(state, first, undefined, 2).kind, "already", "the first code again counts nothing");
  assert.equal((await payments.fetchRequest(link.id))!.status, "partially_paid");
  const rest = markReceived(state, second, undefined, 3);
  assert.ok(rest.kind === "marked" && rest.full && rest.mark.amountPaise === 5_000, "the button for the rest is for the rest");
  assert.equal(markReceived(state, second, undefined, 4).kind, "already");
  const after = (await payments.fetchRequest(link.id))!;
  assert.equal(after.status, "paid");
  assert.equal(after.amount_paid, 20_000);
  assert.deepEqual(after.payments.map((p) => p.amount), [15_000, 5_000]);
  assert.equal(markReceived(state, "ZZZZZZ", undefined, 5).kind, "unknown");
});

test("a request closed by the agent keeps its code: a later mark is recorded, as after the close", async () => {
  const state = emptyUpiState();
  const payments = upiPayments(state, payee, fakeClock(0));
  const link = await payments.createRequest({ amount: 20_000, reference_id: "b-1", description: "" });
  const code = state.requests[0].code!;
  await payments.cancelRequest(link.id);
  const late = markReceived(state, code, undefined, 10);
  assert.ok(late.kind === "marked" && late.afterClose && late.mark.afterClose);
  assert.equal((await payments.fetchRequest(link.id))!.status, "cancelled", "the request stays closed");
  assert.equal(state.requests[0].code, null);
  closeRequest(state.requests[0], 11);
});

test("a refund owed: never sent by the agent, marked done once with its own code, reminded at most three times, and counted against the payment", async () => {
  const state = emptyUpiState();
  const payments = upiPayments(state, payee, fakeClock(0));
  await payments.createRequest({ amount: 20_000, reference_id: "b-1", description: "" });
  const marked = markReceived(state, state.requests[0].code!, undefined, 0);
  assert.equal(marked.kind, "marked");
  const paymentId = marked.kind === "marked" ? marked.mark.id : "";
  const owed = oweRefund(state, { caseId: "b-1", customer: "+919811111111", paymentId, amountPaise: 20_000, why: "cancelled" }, 0);
  assert.equal((await payments.fetchPayment(paymentId))!.amount_refunded, 20_000, "what is owed counts, so it is never owed twice");
  assert.deepEqual((await payments.listRefunds(paymentId)).map((r) => r.status), ["pending"]);
  assert.equal(markReceived(state, owed.code!, undefined, 1).kind, "already_refund", "a refund's code is not a payment's");
  let now = 0;
  for (let i = 0; i < REFUND_REMINDERS_MAX + 2; i++) {
    now += REFUND_REMINDER_EVERY_MS;
    for (const r of remindersDue(state, now)) reminded(r, now);
  }
  assert.equal(state.refunds[0].reminders, REFUND_REMINDERS_MAX);
  assert.equal(markRefund(state, owed.code!, "kept", now).kind, "not_allowed", "keeping is only offered where it is true");
  const code = owed.code!;
  assert.equal(markRefund(state, code, "done", now).kind, "done");
  assert.equal(markRefund(state, code, "done", now).kind, "already");
  assert.deepEqual((await payments.listRefunds(paymentId)).map((r) => r.status), ["processed"]);
});

test("the owner's replies: a button carries its code; typed words with a code and maybe an amount; anything else is not a UPI reply", () => {
  assert.deepEqual(parseUpiReply({ text: "Received ₹200", reply: { id: upiButtonId("received", "K7M2QX") } }), { kind: "received", code: "K7M2QX" });
  assert.deepEqual(parseUpiReply({ text: "x", reply: { id: upiButtonId("refunded", "K7M2QX") } }), { kind: "refunded", code: "K7M2QX" });
  assert.deepEqual(parseUpiReply({ text: "x", reply: { id: upiButtonId("kept", "K7M2QX") } }), { kind: "kept", code: "K7M2QX" });
  assert.deepEqual(parseUpiReply({ text: "received k7m2qx" }), { kind: "received", code: "K7M2QX" });
  assert.deepEqual(parseUpiReply({ text: " Received K7M2QX 150 " }), { kind: "received", code: "K7M2QX", amountPaise: 15_000 });
  assert.deepEqual(parseUpiReply({ text: "received K7M2QX ₹1,500.5" }), { kind: "received", code: "K7M2QX", amountPaise: 150_050 });
  assert.deepEqual(parseUpiReply({ text: "refunded K7M2QX" }), { kind: "refunded", code: "K7M2QX" });
  assert.equal(parseUpiReply({ text: "received b-3" }), undefined, "a booking reference is never a code");
  assert.equal(parseUpiReply({ text: "approve K7M2QX" }), undefined, "the approvals relay's words are not these");
  assert.equal(parseUpiReply({ text: "x", reply: { id: "pay:f-1" } }), undefined);
});

test("the obligations come from the record alone: a payment the customer says they made (or the owner marked part of) until marked in full or closed; a refund until marked done or kept", () => {
  const clock = fakeClock(Date.UTC(2026, 10, 3, 4, 30));
  const record = createRecord(clock);
  const add = (booking: string, action: string, outcome: "confirmed" | "held_for_owner", refs: Record<string, string>) => { record.append({ conversation: "+919811111111", booking, action, inputs: {}, outcome, language: "en", refs }); clock.advanceMinutes(1); };
  add("b-1", UPI_ACTIONS.request, "confirmed", { requestId: "upi-1", reference: "b-1", amountPaise: "20000" });
  add("b-2", UPI_ACTIONS.request, "confirmed", { requestId: "upi-2", reference: "b-2", amountPaise: "20000" });
  add("b-3", UPI_ACTIONS.request, "confirmed", { requestId: "upi-3", reference: "b-3", amountPaise: "20000" });
  add("b-4", UPI_ACTIONS.request, "confirmed", { requestId: "upi-7", reference: "b-4", amountPaise: "20000" });
  add("b-5", UPI_ACTIONS.request, "confirmed", { requestId: "upi-8", reference: "b-5", amountPaise: "20000" });
  add("b-5", UPI_ACTIONS.claim, "confirmed", { requestId: "upi-8", via: "screenshot" });
  add("b-1", UPI_ACTIONS.marked, "confirmed", { requestId: "upi-1", paymentId: "upi-pay-4", amountPaise: "15000" });
  add("b-2", UPI_ACTIONS.marked, "confirmed", { requestId: "upi-2", paymentId: "upi-pay-5", amountPaise: "20000" });
  add("b-3", UPI_ACTIONS.claim, "confirmed", { requestId: "upi-3", via: "button" });
  add("b-3", UPI_ACTIONS.closed, "confirmed", { requestId: "upi-3" });
  add("b-2", UPI_ACTIONS.refundOwed, "held_for_owner", { refundId: "upr-6", paymentId: "upi-pay-5", amountPaise: "20000" });
  let open = upiObligations(record.entries());
  assert.deepEqual(open.map((o) => [o.kind, o.case, o.amountPaise, o.id]), [["upi_payment_unconfirmed", "b-5", 20000, "upi-8"], ["upi_payment_unconfirmed", "b-1", 5000, "upi-1"], ["upi_refund_owed", "b-2", 20000, "upr-6"]], "b-4 is not the owner's business yet: nobody says it was paid");
  assert.equal(open[0].title, "UPI payment not yet confirmed by the owner");
  assert.equal(open[2].title, "Refund owed by the owner, not yet marked done");
  assert.equal(open[0].customer, "+919811111111");

  // the same, as the unfinished-work registry lists it: no customer's number in the facts, ask_owner_again as the one recovery, nothing younger than the grace
  const listed = obligations.detect({ template: "bookings", entries: record.entries(), cases: [], nowMs: clock.now() + DEFAULT_OPTIONS.graceMs, options: DEFAULT_OPTIONS }).found.filter((o) => o.kind.startsWith("upi_"));
  assert.deepEqual(listed.map((o) => [o.kind, o.caseId, o.facts.amountInr, o.actions]), [["upi_payment_unconfirmed", "b-5", 200, ["ask_owner_again"]], ["upi_payment_unconfirmed", "b-1", 50, ["ask_owner_again"]], ["upi_refund_owed", "b-2", 200, ["ask_owner_again"]]]);
  assert.ok(listed.every((o) => !JSON.stringify(o.facts).includes("9811111111")), "no customer's number in the facts");
  assert.equal(obligations.detect({ template: "fees", entries: record.entries(), cases: [], nowMs: clock.now(), options: DEFAULT_OPTIONS }).found.filter((o) => o.kind.startsWith("upi_")).length, 0, "within the grace the agent is still on it");
  assert.ok(obligations.has("upi_payment_unconfirmed") && obligations.has("upi_refund_owed"));

  add("b-2", UPI_ACTIONS.refundDone, "confirmed", { refundId: "upr-6", amountPaise: "20000" });
  add("b-1", UPI_ACTIONS.closed, "confirmed", { requestId: "upi-1" });
  add("b-5", UPI_ACTIONS.marked, "confirmed", { requestId: "upi-8", paymentId: "upi-pay-9", amountPaise: "20000" });
  open = upiObligations(record.entries());
  assert.deepEqual(open, []);
});
