// The owner's number is read at every step, never kept across steps (19 Nov 2026, third round of "no Operator holds a shop hostage"). A sale's number change applies after 48 hours
// with NO restart (owner-access.ts effectiveNumber, behind `settings.owner.whatsapp`); the runtime makes the agent afresh at every step, so the very next message from the new
// owner is the owner's and the previous owner's is a customer's, and an owner send goes to the new number.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, glowSalon } from "../src/harness.ts";

const A = "+919800000001";
const B = "+919822222222";

test("after the owner's number changes with no restart, the next step treats a message from the new number as the owner's, the old number's as a customer's, and sends to the new number", async () => {
  const settings = glowSalon();
  let now = A; // what the runtime's effective number answers
  Object.defineProperty(settings.owner, "whatsapp", { enumerable: true, configurable: true, get: () => now });
  const w = createWorld({ settings });
  await w.say("help", { from: A });
  assert.ok(w.messaging.sentTo(A).length > 0, "while A is the owner, A is answered as the owner");
  const ownerReplyA = w.messaging.sentTo(A).at(-1)!.text;
  const before = w.messaging.sentTo(B).length;
  // the sale applies: the settings' number is now the new owner's, nobody restarts; the next step makes a fresh agent
  now = B;
  w.renew();
  await w.say("help", { from: B });
  assert.ok(w.messaging.sentTo(B).length > before, "B is answered");
  assert.equal(w.messaging.sentTo(B).at(-1)!.text, ownerReplyA, "B gets the owner's answer: B is the owner");
  const sentToA = w.messaging.sentTo(A).length;
  await w.say("help", { from: A });
  const forA = w.messaging.sentTo(A).slice(sentToA).map((m) => m.text);
  assert.ok(!forA.includes(ownerReplyA), "A is now a customer: A does not get the owner's answer");
});
