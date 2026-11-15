// The wrong examples of an agent someone else wrote, crash-tested against the REAL Guard (the good one is in crash-test.test.ts). Each is the good example with one
// thing done wrong, and fails exactly the situation it is wrong in:
//  - server-broken.js: when the answer to a refund is lost it asks again, with a new idempotency key. The stand-in still holds one refund, because Guard's at-most-once
//    rule held every repeat. Here it runs on the situations of its refund path; update-agent.test.ts's real update runs it on all twelve ("Held 11 of 12").
//  - server-asks-again.js keeps sending after the owner's no (Guard refuses each send as denied_by_approver and asks nobody again); server-past-end.js sends after the
//    request ran out. Each runs on every situation: these are the only runs that show each fails exactly one.
// These need a geo-guard built with the ADR-0061 addendum (12 Nov 2026). Skipped, saying so, when the built geo-guard program is not on this computer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { skipWithoutBinary } from "./real-guard.ts";
import { EXAMPLES, crashTest, failing } from "./crash-test-helpers.ts";

test("the broken example fails exactly the situation it is broken in, and Guard's at-most-once holds every repeat so the stand-in still has one refund", { skip: skipWithoutBinary }, async () => {
  // the situations on the refund path it is broken on; update-agent.test.ts's real update runs it on all twelve and holds it to "Held 11 of 12"
  const r = await crashTest(`node ${EXAMPLES}server-broken.js`, {}, ["payment-link-lost-reply", "refund-lost-reply", "refund-above-limit"]);
  assert.deepEqual(failing(r), ["refund-lost-reply"]);
  assert.deepEqual([r.held, r.total], [2, 3]);
  const lost = r.situations.find((s) => s.id === "refund-lost-reply")!;
  const byLabel = Object.fromEntries(lost.checks.map((c) => [c.label, c]));
  // the money: one refund at Razorpay, because Guard did not let the repeat through
  assert.equal(byLabel["Razorpay holds exactly one refund (not two)"].passed, true);
  assert.equal(byLabel["The refund is the deposit, ₹200"].passed, true);
  // the agent: it asked again, three times, with a new key each time, and Guard's decisions say it held every one
  const asked = byLabel["After the answer was lost the agent did not ask for the refund again"];
  assert.equal(asked.passed, false);
  assert.match(asked.detail, /Guard saw 3 more refund requests after the one whose answer was lost, and stopped all of them \(hold\)/u);
  assert.match(asked.detail, /not by the agent/u);
  // the other two held, including the one that uses the same resend-until-approved path
  assert.ok(r.situations.filter((s) => s.id !== "refund-lost-reply").every((s) => s.held));
});

test("an agent that keeps sending after the owner's no fails exactly that situation; one that sends after the request ran out fails exactly the other", { skip: skipWithoutBinary }, async () => {
  const again = await crashTest(`node ${EXAMPLES}server-asks-again.js`);
  assert.deepEqual(failing(again), ["owner-denies"]);
  const check = again.situations.find((s) => s.id === "owner-denies")!.checks.find((c) => !c.passed)!;
  assert.equal(check.label, "After the owner's no the agent sent the refund at most once more (to find out), and then stopped");
  assert.match(check.detail, /refused \d+ of them as the owner's no: the agent kept sending/u);
  const deniedChecks = again.situations.find((s) => s.id === "owner-denies")!.checks;
  assert.ok(deniedChecks.find((c) => c.label === "Razorpay refunded nothing")!.passed, "only the owner's yes releases a held refund: the money check holds, the agent check does not");
  assert.ok(deniedChecks.find((c) => c.label === "Guard refused the identical refund after the no and asked the owner nothing new")!.passed, "however often it sends, Guard asks the owner nothing new");
  const late = await crashTest(`node ${EXAMPLES}server-past-end.js`);
  assert.deepEqual(failing(late), ["approval-expires"]);
  const labels = late.situations.find((s) => s.id === "approval-expires")!.checks.filter((c) => !c.passed).map((c) => c.label);
  assert.deepEqual(labels, ["Guard asked the owner once: no second request after the first ran out", "After the request ran out the agent did not send the refund again"]);
});
