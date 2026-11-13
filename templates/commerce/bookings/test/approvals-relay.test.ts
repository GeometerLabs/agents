// The approvals relay against a stub Guard (Guard's documented admin routes over HTTP), the real runtime server and a fake WhatsApp.
// The owner is asked exactly once, with a fresh one-use code; only the owner's number can answer; the answer reaches Guard signed, then the
// runtime; and every way of forging or replaying an answer is refused. See also approvals-guard-binary.test.ts, which runs the real Guard.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CODE_ALPHABET, CODE_LENGTH } from "../../../../modules/approvals/code.ts";
import { HOUR, MINUTE } from "../../../../modules/core/time.ts";
import { CUSTOMER, OTHER_CUSTOMER } from "../src/harness.ts";
import { groupPhone } from "../../../../modules/language/format.ts";
import { OWNER_SECRET, APPROVER_ID, startApprovalsWorld } from "./helpers/approvals-world.ts";
import type { ApprovalsWorld } from "./helpers/approvals-world.ts";

const codeIn = (text: string) => /"approve ([A-Z0-9]+)"/u.exec(text)?.[1] ?? "";
const refunded = (w: ApprovalsWorld) => w.payments.refunds().length;
const run = (name: string, body: (w: ApprovalsWorld) => Promise<void>, options: Parameters<typeof startApprovalsWorld>[0] = {}) =>
  test(name, async () => { const w = await startApprovalsWorld(options); try { await body(w); } finally { await w.close(); } });

run("the owner is asked once, in the pathway's own words: the amount and the payment from Guard, the booking from the runtime, a code in place of the booking ref", async (w) => {
  const approval = await w.heldRefund();
  assert.deepEqual(w.toOwner(), [], "nothing yet: the agent does not ask, and the relay has not looked");
  await w.relay.poll();
  const sent = w.toOwner();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].kind, "template", "the owner has not written today, so it goes as the approved template");
  assert.equal(sent[0].templateName, "owner_approval_request");
  const code = codeIn(sent[0].text);
  assert.equal(sent[0].text, `A refund needs your OK: ₹200 to ${groupPhone(CUSTOMER)} (haircut, Thu 5 Nov, 6:00 pm). Reply "approve ${code}" or "deny ${code}" within 24 hours.`); // the number grouped as people write it (14 Nov 2026)
  assert.equal(code.length, CODE_LENGTH);
  assert.ok([...code].every((c) => CODE_ALPHABET.includes(c)));
  assert.ok(!sent[0].text.includes("b-1"), "never the booking ref");
  for (let i = 0; i < 4; i++) { w.clock.advance(5_000); await w.relay.poll(); }
  assert.equal(w.toOwner().length, 1, "polling again asks nobody");
  assert.deepEqual(w.relay.status().asks, { asked: 1 });
  // a restart does not forget it asked
  w.restartRelay();
  await w.relay.poll();
  assert.equal(w.toOwner().length, 1);
  assert.equal(w.model.approvals().find((a) => a.id === approval)!.state, "pending");
});

run("the hours in the owner's message are Guard's own: the hold's expiry less the hold, whatever the spec said (6 hours here, not a constant)", async (w) => {
  await w.heldRefund();
  await w.relay.poll();
  const text = w.toOwner()[0].text;
  assert.match(text, /within 6 hours\.$/u);
  assert.ok(!/24 hours/u.test(text));
}, { approvalTtlSeconds: 21_600 });

run("when the owner has written today, the ask goes inside the window as a card: the same words, with Approve and Refuse buttons carrying its code (item 11e)", async (w) => {
  await w.heldRefund();
  await w.ownerWrites("hello");
  await w.relay.poll();
  assert.equal(w.toOwner().length, 1);
  assert.equal(w.toOwner()[0].kind, "interactive");
  assert.match(w.toOwner()[0].text, /"approve [A-HJKMNP-Z2-9]{6}"/u, "the typed reply is still in the words");
});

run("approve <code>: Guard gets the owner's signed answer, the agent sends the identical call again, the refund is made once, the owner is told", async (w) => {
  const approval = await w.heldRefund();
  await w.relay.poll();
  const code = codeIn(w.toOwner()[0].text);
  await w.ownerWrites(`approve ${code}`);
  assert.deepEqual(w.guard.accepted, [{ approval, decision: "approve", approver: APPROVER_ID }]);
  assert.equal(refunded(w), 1);
  assert.equal(w.payments.refunds()[0].amount, 20000);
  assert.equal(w.model.approvals().length, 1, "Guard only ever held one call: the owner was asked about one thing");
  assert.match(w.kit.messaging.sentTo(CUSTOMER).at(-1)!.text, /owner approved your refund/);
  const told = w.toOwner();
  assert.equal(told.length, 2);
  assert.equal(told[1].text, `Thanks! The ₹200 refund to ${groupPhone(CUSTOMER)} is being sent, and I'll let them know.`);
  assert.equal(told[1].kind, "text", "a reply to the owner's own message");
  assert.deepEqual(w.relay.status().asks, { decided: 1 });
  assert.deepEqual(w.relay.status().decided, { approve: 1, deny: 0 });
  for (let i = 0; i < 3; i++) await w.relay.poll(); // nothing more
  assert.equal(w.toOwner().length, 2);
  assert.equal(refunded(w), 1);
  assert.deepEqual(w.runtime.status().refunds, { waitingForOwner: 0, beingSentAgain: 0, needBuilder: { total: 0 } });
  assert.ok(!w.lines.join("\n").includes(code), "the code is never logged");
  assert.ok(!w.lines.join("\n").includes(CUSTOMER), "nor a phone number");
});

run("deny <code>: Guard gets the no, nothing is refunded, the customer and the owner are told, and nothing is asked again", async (w) => {
  await w.heldRefund();
  await w.relay.poll();
  await w.ownerWrites(`deny ${codeIn(w.toOwner()[0].text).toLowerCase()}`); // any case
  assert.deepEqual(w.guard.accepted.map((a) => a.decision), ["deny"]);
  assert.equal(refunded(w), 0);
  assert.match(w.kit.messaging.sentTo(CUSTOMER).at(-1)!.text, /decided not to refund the ₹200/);
  assert.equal(w.toOwner()[1].text, `Okay, the ₹200 refund to ${groupPhone(CUSTOMER)} won't be sent. I'll let them know.`);
  await w.kit.say(w.runtime, "cancel my booking");
  for (let i = 0; i < 3; i++) { w.clock.advance(HOUR); await w.relay.poll(); await w.runtime.tick(); }
  assert.equal(w.toOwner().length, 2, "no second ask for the same refund");
  assert.equal(w.model.reviews("x", true).length, 0, "and Guard holds nothing new");
});

// ---- the owner's no is not asked again (the owner's decision of 12 Nov 2026; monorepo ADR-0061 addendum) ------------------------------------------------------

/** The owner asks the relay, says no, and then the identical refund is sent to Guard again (as a builder's agent does to find out). */
async function deniedThenSentAgain(w: ApprovalsWorld) {
  const first = await w.heldRefund();
  await w.relay.poll();
  await w.ownerWrites(`deny ${codeIn(w.toOwner()[0].text)}`);
  assert.equal(w.toOwner().length, 2, "the ask and the answer to the owner's no");
  const denied = w.model.approvals().find((a) => a.id === first)!;
  w.clock.advance(5 * MINUTE);
  return { first, again: w.model.decideRefund(denied.paymentId, { amount: denied.amountPaise, receipt: denied.fields.receipt }) };
}

run("Guard refuses the identical refund after the owner's no (denied_by_approver): no new request, so the relay has nothing to ask", async (w) => {
  const { first, again } = await deniedThenSentAgain(w);
  assert.equal(again.kind, "denied_repeat");
  assert.equal(again.kind === "denied_repeat" ? again.detail.approval : "", first, "the refusal names the request the owner denied");
  assert.equal(w.model.reviews("x", true).length, 0);
  for (let i = 0; i < 3; i++) { w.clock.advance(HOUR); await w.relay.poll(); }
  assert.equal(w.toOwner().length, 2, "the owner is not asked again");
});

run("a Guard from before 12 Nov 2026 opens a new request for the same refund after the no: the relay sets it aside, tells the builder, and does not ask the owner again", async (w) => {
  const { first, again } = await deniedThenSentAgain(w);
  assert.equal(again.kind, "hold", "the older Guard holds it again");
  const second = again.kind === "hold" ? again.approval : "";
  assert.notEqual(second, first);
  for (let i = 0; i < 3; i++) { w.clock.advance(MINUTE); await w.relay.poll(); }
  assert.equal(w.toOwner().length, 2, "the owner is not asked again");
  const alert = w.store.alerts().find((a) => a.approval === second);
  assert.equal(alert?.kind, "denied_repeat");
  assert.match(alert?.note ?? "", new RegExp(`said no to this same refund \\(the same payment, amount and receipt: approval ${first}\\)`, "u"));
  assert.equal(w.store.ask(second)?.state, "alerted");
  // a day later it is a new question again, as it is for Guard
  w.clock.advance(25 * HOUR);
  assert.equal(w.store.deniedCall({ receipt: w.store.ask(first)!.receipt, paymentId: w.store.ask(first)!.paymentId, amountPaise: w.store.ask(first)!.amountPaise }, w.clock.now() - 24 * HOUR), undefined);
}, { olderGuard: true });

run("each ask gets its own fresh code; a code answers only its own refund", async (w) => {
  const first = await w.heldRefund(CUSTOMER);
  const second = await w.heldRefund(OTHER_CUSTOMER);
  assert.notEqual(first, second);
  await w.relay.poll();
  const [a, b] = w.toOwner().map((m) => codeIn(m.text));
  assert.equal(w.toOwner().length, 2);
  assert.notEqual(a, b);
  await w.ownerWrites(`approve ${b}`);
  assert.deepEqual(w.guard.accepted.map((x) => x.approval), [second]);
  assert.equal(refunded(w), 1);
  assert.equal(w.payments.refunds()[0].receipt?.startsWith("b-2:"), true);
  assert.equal(w.model.approvals().find((x) => x.id === first)!.state, "pending", "the other is still waiting for its own code");
});

// ---- forged and replayed answers ------------------------------------------------------------------------------------------------------

run("a forged answer is refused: another number, a code nobody issued, a used code, an expired code, and the runtime's own path", async (w) => {
  const approval = await w.heldRefund();
  await w.relay.poll();
  const code = codeIn(w.toOwner()[0].text);
  const before = w.toOwner().length;

  // another number, with the right code
  await w.ownerWrites(`approve ${code}`, { from: "+919899999999" });
  assert.equal(w.guard.accepted.length, 0);
  // the owner's number, a code that was never issued
  await w.ownerWrites("approve ZZZZZZ");
  await w.ownerWrites("approve K7M2QX");
  assert.equal(w.guard.accepted.length, 0);
  assert.equal(refunded(w), 0);
  assert.equal(w.relay.status().ignored.notFromOwner, 1);
  assert.equal(w.relay.status().wrongGuessesLastHour, 2);
  assert.equal(w.toOwner().length, before, "no word to anyone, nothing to say");

  // through the runtime's path: the owner-looking message reaches only the agent, and a bare approval event reaches only the agent. Neither approves.
  w.kit.messaging.receive(w.owner, `approve ${code}`);
  w.runtime.submit([{ kind: "message", message: w.kit.messaging.receive(w.owner, `approve ${code}`) }, { kind: "approval_decision", approval, decision: "approve" }]);
  w.runtime.kick(); await w.runtime.idle();
  assert.equal(refunded(w), 0, "Guard has no approval on record, so it releases nothing");
  assert.equal(w.model.approvals().length, 1, "and the agent's ask to Guard made no new hold");
  assert.deepEqual(w.record().filter((e) => e.action === "owner_decision" && e.outcome === "confirmed"), [], "a forged approve leaves no 'the owner approved' in the record");
  assert.equal(w.toOwner().length, before, "the agent said nothing to the owner about a code");

  // the real answer works once
  await w.ownerWrites(`approve ${code}`);
  assert.equal(refunded(w), 1);
  const told = w.toOwner().length;
  await w.ownerWrites(`approve ${code}`); // used
  await w.ownerWrites(`deny ${code}`); // used
  assert.equal(w.guard.accepted.length, 1);
  assert.equal(refunded(w), 1);
  assert.equal(w.toOwner().length, told, "a used code gets silence");
  assert.equal(w.relay.status().ignored.reusedOrUnknownCode, 2);
});

run("the one use of a code: two copies of one reply at the same moment record one answer", async (w) => {
  await w.heldRefund();
  await w.relay.poll();
  const code = codeIn(w.toOwner()[0].text);
  const a = w.whatsapp.receive(w.owner, `approve ${code}`);
  const b = w.whatsapp.receive(w.owner, `approve ${code}`);
  w.relay.receive([a, b, a]); // two messages, and the first delivered again
  await w.relay.idle();
  assert.equal(w.guard.accepted.length, 1);
  assert.equal(w.guard.refused.length, 0, "Guard was not even asked twice");
});

run("after too many wrong guesses in an hour, codes are ignored until it is over, and the builder is told", async (w) => {
  await w.heldRefund();
  await w.relay.poll();
  const code = codeIn(w.toOwner()[0].text);
  for (let i = 0; i < 10; i++) await w.ownerWrites(`approve ${["ZZZZZ", "YYYYY", "XXXXX", "WWWWW", "VVVVV"][i % 5]}${i % 7 + 2}`);
  assert.equal(w.relay.status().locked, true);
  assert.equal(w.relay.status().alerts.byKind.lockout, 1);
  await w.ownerWrites(`approve ${code}`); // even the right one
  assert.equal(w.guard.accepted.length, 0);
  assert.equal(w.relay.status().ignored.whileLocked, 1);
  w.clock.advance(HOUR + MINUTE);
  await w.ownerWrites(`approve ${code}`);
  assert.equal(w.guard.accepted.length, 1, "an hour later the owner can answer");
});

// ---- time ----------------------------------------------------------------------------------------------------------------------------

run("a late reply: the code ran out, the owner is told once and plainly that nothing was refunded; later replies get silence", async (w) => {
  const approval = await w.heldRefund();
  await w.relay.poll();
  const code = codeIn(w.toOwner()[0].text);
  w.clock.advance(24 * HOUR - 30_000); // inside Guard's own 24 hours, but Guard needs time to spare when the call is sent again
  await w.relay.poll();
  assert.deepEqual(w.relay.status().asks, { expired: 1 });
  await w.ownerWrites(`approve ${code}`);
  assert.equal(w.guard.accepted.length, 0, "never offered to Guard");
  assert.equal(refunded(w), 0);
  const told = w.toOwner();
  assert.equal(told.at(-1)!.text, `That refund request (₹200 to ${groupPhone(CUSTOMER)}) ran out before you answered, so nothing was refunded.`);
  const count = told.length;
  await w.ownerWrites(`approve ${code}`);
  await w.ownerWrites(`deny ${code}`);
  assert.equal(w.toOwner().length, count, "once");
  // the agent, on its side, ends the same way when Guard's approval runs out
  w.clock.advance(HOUR);
  await w.runtime.tick();
  assert.match(w.kit.messaging.sentTo(CUSTOMER).at(-1)!.text, /didn't answer in time about your ₹200 refund/);
  assert.equal(w.model.approvals().find((a) => a.id === approval)!.state, "pending");
  assert.equal(w.runtime.status().refunds.needBuilder.expired, 1);
});

run("a reply on the last day, inside the code's life, still works", async (w) => {
  await w.heldRefund();
  await w.relay.poll();
  const code = codeIn(w.toOwner()[0].text);
  w.clock.advance(23 * HOUR);
  await w.relay.poll();
  await w.ownerWrites(`approve ${code}`);
  assert.equal(refunded(w), 1);
});

// ---- Guard and the runtime disagree, or are not there --------------------------------------------------------------------------------

run("the runtime's view of a different payment: the owner is not asked, and the builder is told", async (w) => {
  const approval = await w.heldRefund();
  const runtimeSaid = w.model.reviews(AGENT_ID_FOR_TEST, true)[0].arguments[1].receipt![1]; // b-1:pay_X
  // a second hold in Guard, for ANOTHER payment, under the receipt of the first booking: what a runtime that was lying about the payment would produce
  w.model.decideRefund("pay_OTHER", { amount: 20000, receipt: runtimeSaid });
  await w.relay.poll();
  assert.equal(w.toOwner().length, 1, "the honest one was asked, the mismatched one was not");
  assert.equal(w.relay.status().alerts.byKind.disagree, 1);
  assert.match(w.lines.join("\n"), /ALERT \[disagree\] The runtime's booking is for a different payment or amount/);
  const forged = w.model.reviews(AGENT_ID_FOR_TEST, true).find((r) => r.id !== approval)!;
  assert.equal(w.store.ask(forged.id)!.state, "alerted");
  assert.equal(w.store.ask(approval)!.state, "asked");
});

const AGENT_ID_FOR_TEST = "runtime-glow-salon";

run("the runtime's amount is not Guard's: the owner is asked nothing", async (w) => {
  const approval = await w.heldRefund();
  // Guard holds ₹150 for what the runtime knows as ₹200 (₹150 is within Guard's own bound, one deposit; a hold for more than the deposit cannot exist, because Guard refuses it)
  w.model.decide(approval, false, "operator");
  w.model.decideRefund(w.model.approvals()[0].paymentId, { amount: 15000, receipt: w.model.approvals()[0].fields.receipt });
  await w.relay.poll();
  assert.equal(w.toOwner().length, 0);
  assert.equal(w.relay.status().alerts.byKind.disagree, 1);
});

run("a hold the runtime has no booking for waits a short while, then the builder is told; a hold from another agent is never asked about", async (w) => {
  w.model.decideRefund("pay_Q", { amount: 20000, receipt: "b-9:pay_Q" });
  await w.relay.poll();
  assert.equal(w.toOwner().length, 0);
  assert.deepEqual(w.relay.status().asks, { waiting_context: 1 });
  w.clock.advance(3 * MINUTE);
  await w.relay.poll();
  assert.deepEqual(w.relay.status().asks, { alerted: 1 });
  assert.equal(w.relay.status().alerts.byKind.no_booking, 1);

  const other = (await startApprovalsWorld({ relay: { expectedAgent: "someone-else" } }));
  try {
    await other.heldRefund();
    await other.relay.poll();
    assert.equal(other.toOwner().length, 0);
    assert.equal(other.relay.status().alerts.byKind.other_agent, 1);
  } finally { await other.close(); }
});

run("a hold with no approval to give is never shown to the owner; it is counted for the builder", async (w) => {
  const read = w.guardClient.reviews;
  w.guardClient.reviews = async () => ({ ok: true, items: [{ id: null, tool: "razorpay", operation: "refund", arguments: ["map", {}] }, { tool: "razorpay", operation: "refund" }] });
  await w.relay.poll();
  await w.relay.poll();
  w.guardClient.reviews = read;
  assert.equal(w.toOwner().length, 0);
  assert.equal(w.relay.status().uncertainHolds, 2);
  assert.match(w.lines.join("\n"), /cannot be approved on WhatsApp\. It is for the builder/);
});

run("an amount that came as text, or a call that is not a refund, is not shown to the owner", async (w) => {
  w.guardClient.reviews = async () => ({ ok: true, items: [
    { id: "ap-1", tool: "razorpay", operation: "refund", agent: "runtime-glow-salon", arguments: ["map", { amount: ["str", "20000"], payment_id: ["str", "pmt_1"], receipt: ["str", "b-1:pmt_1"] }], requested_at_ms: "1", expires_at_ms: "2", you_may_decide: true },
    { id: "ap-2", tool: "razorpay", operation: "payout", arguments: ["map", {}] },
    { id: "ap-3", tool: "google-calendar", operation: "delete", arguments: ["map", {}] },
  ] });
  await w.relay.poll();
  assert.equal(w.toOwner().length, 0);
  assert.equal(w.relay.status().alerts.byKind.unreadable, 1, "the odd refund is for the builder; the others are not the relay's business");
});

run("a reading credential Guard does not accept: no refund can be asked about, and the builder is told", async (w) => {
  w.guardClient.reviews = async () => ({ ok: false, credential: true, error: "Guard did not accept the reading credential (401); it may have expired" });
  await w.heldRefund();
  await w.relay.poll();
  assert.equal(w.toOwner().length, 0);
  assert.equal(w.relay.status().guardReadFailures, 1);
  assert.equal(w.relay.status().alerts.byKind["read-credential"], 1);
});

run("a reading credential that may not decide: the relay says so instead of asking", async (w) => {
  const read = w.guardClient.reviews;
  w.guardClient.reviews = async () => { const r = await read(); return r.ok ? { ok: true, items: r.items.map((i) => ({ ...(i as object), you_may_decide: null })) } : r; };
  await w.heldRefund();
  await w.relay.poll();
  assert.equal(w.toOwner().length, 0);
  assert.equal(w.relay.status().alerts.byKind.cannot_decide, 1);
});

// ---- when something along the way is down -----------------------------------------------------------------------------------------------

run("Guard cannot be reached when the owner answers: the owner is asked to send it again, the code is not used up, and it works when Guard is back", async (w) => {
  await w.heldRefund();
  await w.relay.poll();
  const code = codeIn(w.toOwner()[0].text);
  const notify = w.guardClient.notify;
  w.guardClient.notify = async () => ({ kind: "unreachable", error: "down" });
  await w.ownerWrites(`approve ${code}`);
  assert.equal(w.toOwner().at(-1)!.text, "Sorry, I couldn't save your answer just now. Please send it again in a few minutes.");
  assert.equal(refunded(w), 0);
  assert.deepEqual(w.relay.status().asks, { asked: 1 });
  w.guardClient.notify = notify;
  await w.ownerWrites(`approve ${code}`);
  assert.equal(refunded(w), 1);
});

run("the runtime is down when the owner answers: Guard has the answer, and the runtime is told as soon as it is back; the owner is told meanwhile", async (w) => {
  await w.heldRefund();
  await w.relay.poll();
  const code = codeIn(w.toOwner()[0].text);
  const decided = w.runtimeClient.decided;
  w.runtimeClient.decided = async () => false;
  await w.ownerWrites(`approve ${code}`);
  assert.equal(w.guard.accepted.length, 1);
  assert.equal(refunded(w), 0);
  assert.equal(w.store.ask(w.model.approvals()[0].id)!.runtimeTold, false);
  w.runtimeClient.decided = decided;
  await w.relay.poll();
  assert.equal(refunded(w), 1);
  assert.equal(w.toOwner().filter((m) => /is being sent/.test(m.text)).length, 1);
});

run("the relay stops after its answer to Guard was recorded but before it told anyone: a restart finishes it, once", async (w) => {
  const approval = await w.heldRefund();
  await w.relay.poll();
  const code = codeIn(w.toOwner()[0].text);
  const decided = w.runtimeClient.decided;
  w.runtimeClient.decided = async () => { throw new Error("the process was killed"); };
  const message = w.whatsapp.receive(w.owner, `approve ${code}`);
  w.relay.receive([message]);
  await w.relay.idle().catch(() => undefined);
  assert.equal(w.guard.accepted.length, 1);
  w.runtimeClient.decided = decided;
  w.restartRelay();
  await w.relay.poll();
  assert.equal(refunded(w), 1);
  assert.equal(w.guard.accepted.length, 1, "Guard was not told twice");
  assert.equal(w.store.ask(approval)!.ownerTold, true);
});

run("Guard refuses the relay's signature (a wrong secret): the builder is told, the owner is asked to try again later, and the code survives", async (w) => {
  await w.heldRefund();
  await w.relay.poll();
  const code = codeIn(w.toOwner()[0].text);
  const notify = w.guardClient.notify;
  w.guardClient.notify = async () => ({ kind: "refused", status: 401, error: "signature does not verify" });
  await w.ownerWrites(`approve ${code}`);
  assert.equal(w.relay.status().alerts.byKind["guard_refused_401"], 1);
  assert.equal(refunded(w), 0);
  assert.deepEqual(w.relay.status().asks, { asked: 1 });
  w.guardClient.notify = notify;
});

run("a message that cannot be sent right now is sent again with the same code; one that may have gone is not sent again", async (w) => {
  await w.heldRefund();
  const send = w.whatsapp.sendTemplate;
  let calls = 0;
  w.whatsapp.sendTemplate = async (to, t) => { calls++; throw Object.assign(new Error("provider says no"), { name: "ApiError", status: 400 }); };
  // ApiError means nothing was sent
  const { ApiError } = await import("../../../../modules/core/faults.ts");
  w.whatsapp.sendTemplate = async () => { calls++; throw new ApiError(400, "no"); };
  await w.relay.poll();
  await w.relay.poll();
  assert.equal(calls, 2);
  assert.equal(w.toOwner().length, 0);
  const id = w.model.approvals()[0].id;
  const firstCode = w.store.ask(id)!.code;
  assert.equal(w.store.ask(id)!.state, "sending");
  w.whatsapp.sendTemplate = send;
  await w.relay.poll();
  assert.equal(w.toOwner().length, 1);
  assert.equal(codeIn(w.toOwner()[0].text), firstCode, "the same code");
  assert.equal(w.store.ask(id)!.code, null, "and not kept in the clear once it is out");

  // lost reply: it may have gone out, and sending again could ask twice
  const second = await w.heldRefund(OTHER_CUSTOMER);
  const { TimeoutError } = await import("../../../../modules/core/faults.ts");
  w.whatsapp.sendTemplate = async () => { throw new TimeoutError("WhatsApp"); };
  await w.relay.poll();
  w.whatsapp.sendTemplate = send;
  await w.relay.poll();
  assert.equal(w.store.ask(second)!.state, "asked");
  assert.equal(w.toOwner().length, 1, "not sent again");
});

run("the owner's language: the ask and the answers are in it, the commands stay in Latin letters", async (w) => {
  await w.heldRefund();
  await w.relay.poll();
  const text = w.toOwner()[0].text;
  assert.match(text, /^रिफंड के लिए आपकी हाँ चाहिए: /);
  assert.match(text, /"approve [A-Z0-9]{6}" या "deny [A-Z0-9]{6}"/);
  assert.match(text, /24 घंटे के अंदर/);
  await w.ownerWrites(`approve ${codeIn(text)}`);
  assert.match(w.toOwner().at(-1)!.text, /^धन्यवाद। /);
}, { ownerLanguage: "hi" });

// ---- the relay's own HTTP face ------------------------------------------------------------------------------------------------------------

test("the relay's server takes the owner's messages from the inbox only with its token, saves them before it answers, and says counts only", async () => {
  const w = await startApprovalsWorld();
  const { startRelayServer } = await import("../../../../modules/approvals/server.ts");
  const server = await startRelayServer(w.relay, { token: "relay-token-own-0123456789", port: 0 });
  try {
    await w.heldRefund();
    await w.relay.poll();
    const code = codeIn(w.toOwner()[0].text);
    const post = (body: unknown, token = "relay-token-own-0123456789") => fetch(`${server.url}/internal/owner-messages`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    const message = { id: "wamid.http-1", from: w.owner, text: `approve ${code}`, timestamp: w.clock.now() };
    assert.equal((await post({ messages: [message] }, "the-runtimes-token")).status, 401);
    assert.equal((await fetch(`${server.url}/internal/owner-messages`, { method: "POST", body: "{}" })).status, 401);
    assert.equal((await post({ messages: [] })).status, 400);
    assert.equal((await post({ messages: [{ id: "x" }] })).status, 400);
    assert.equal(w.store.unprocessed().length, 0, "nothing was saved from the refused ones");
    const ok = await post({ messages: [message] });
    assert.deepEqual(await ok.json(), { saved: 1, duplicates: 0 });
    assert.deepEqual(await (await post({ messages: [message] })).json(), { saved: 0, duplicates: 1 });
    await w.relay.idle();
    assert.equal(refunded(w), 1);
    const status = await (await fetch(`${server.url}/status`, { headers: { authorization: "Bearer relay-token-own-0123456789" } })).json() as any;
    assert.equal((await fetch(`${server.url}/status`)).status, 401);
    const text = JSON.stringify(status);
    for (const secret of [code, CUSTOMER.slice(3), "haircut", OWNER_SECRET, "pay_"]) assert.ok(!text.includes(secret), `status leaked ${secret}`);
    assert.deepEqual(status.decided, { approve: 1, deny: 0 });
    assert.equal((await fetch(`${server.url}/healthz`)).status, 200);
  } finally { await server.close(); await w.close(); }
});
