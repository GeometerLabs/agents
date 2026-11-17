// The shop's assistant for Stock orders (src/assistant.ts and its wiring in the agent): one order, one approval, one judge for each card.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RAVI, createWorld, glowSalon } from "../src/harness.ts";
import { parseSettings } from "../src/settings.ts";
import { stockSkill } from "../src/assistant.ts";
import { actionDigest } from "../../../../modules/assistant/cards.ts";
import { assistantOf } from "../../../../modules/assistant/state.ts";

const withAssistant = () => parseSettings({ ...JSON.parse(JSON.stringify(glowSalon())), assistant: {} });
const openCards = (w: ReturnType<typeof createWorld>) => assistantOf(w.store).cards.filter((c) => c.state === "open");

test("reads: the open orders, what waits, and the numbers the owner's talk may use (no supplier number)", async () => {
  const w = createWorld({ settings: withAssistant() });
  await w.ownerSays("order 10 boxes of hair colour from Ravi Traders");
  const skill = stockSkill({ settings: w.settings, store: w.store, nowMs: () => w.clock.now(), optedOut: () => false });
  assert.deepEqual(skill.open!().map((r) => [r.case, r.state]), [["po-1", "awaiting_approval"]]);
  assert.deepEqual(skill.waiting().map((i) => [i.case, i.kind, i.yes, i.no]), [["po-1", "order_approval", "approve", "decline"]]);
  const facts = skill.facts!(w.clock.now()).map((s) => s.text).join(" ");
  assert.ok(facts.includes("Waiting for the owner's yes: 1"));
  assert.ok(!facts.includes(RAVI));
});

test("prepare gives exactly the action the agent's own card is bound to, so both cards have one digest", async () => {
  const w = createWorld({ settings: withAssistant() });
  await w.ownerSays("order 10 boxes of hair colour from Ravi Traders");
  const skill = stockSkill({ settings: w.settings, store: w.store, nowMs: () => w.clock.now(), optedOut: () => false });
  const prepared = skill.prepare({ kind: "answer", case: "po-1", answer: "yes", itemKind: "order_approval" });
  assert.ok(prepared.ok);
  const own = openCards(w).find((c) => c.proposal.kind === "order")!;
  assert.equal(actionDigest(prepared.ok ? prepared.action : own.action), own.digest);
});

test("what needs me on an order that waits neither voids its card nor makes a second approval", async () => {
  const w = createWorld({ settings: withAssistant() });
  await w.ownerSays("order 10 boxes of hair colour from Ravi Traders");
  await w.ownerSays("what needs me");
  assert.equal(w.order("po-1")?.state, "awaiting_approval");
  const code = w.cardCode();
  await w.ownerSays(`yes ${code}`);
  assert.equal(w.order("po-1")?.state, "sent");
  assert.equal(w.orderMessagesTo(RAVI).length, 1, "one order message, whichever card was tapped");
  await w.ownerSays(`yes ${code}`);
  assert.equal(w.orderMessagesTo(RAVI).length, 1, "a card used twice does nothing");
});

test("a tap on the assistant's card for the same order approves it once, and the agent's own card is then closed", async () => {
  const w = createWorld({ settings: withAssistant() });
  await w.ownerSays("order 10 boxes of hair colour from Ravi Traders");
  await w.ownerSays("what needs me");
  const assistants = openCards(w).filter((c) => c.proposal.kind !== "order");
  for (const card of assistants) await w.agent.handle({ kind: "owner_action", id: `t-${card.id}`, action: "card_yes", case: card.id, digest: card.digest });
  assert.equal(w.order("po-1")?.state, "sent");
  assert.equal(w.orderMessagesTo(RAVI).length, 1);
  assert.equal(openCards(w).length, 0, "no card of this order is left to tap");
});

test("a cancel is prepared only for an order that has not gone out, and shows no money moving", async () => {
  const w = createWorld({ settings: withAssistant() });
  await w.ownerSays("order 10 boxes of hair colour from Ravi Traders");
  const skill = stockSkill({ settings: w.settings, store: w.store, nowMs: () => w.clock.now(), optedOut: () => false });
  const waiting = skill.prepare({ kind: "cancel", case: "po-1" });
  assert.ok(waiting.ok && waiting.shown.amountPaise === 0);
  await w.ownerSays(w.approveText());
  const sent = skill.prepare({ kind: "cancel", case: "po-1" });
  assert.ok(!sent.ok, "once the supplier has it, it cannot be cancelled from here");
  assert.ok(!skill.prepare({ kind: "refund", case: "po-1" }).ok, "nothing was paid by this agent, so there is nothing to refund");
});

test("a limit card tapped in a Stock orders shop reaches the assistant, not the order judge", async () => {
  const w = createWorld({ settings: withAssistant() });
  await w.ownerSays("monthly budget 15000");
  const limitCard = openCards(w).find((c) => c.action.kind === "limit");
  assert.ok(limitCard, "the owner's words about the budget make a limit card");
  await w.ownerSays(`yes ${w.cardCode()}`);
  assert.equal(assistantOf(w.store).limitChanges.length, 1);
});

test("an order that waits is never stranded without a card, whoever expires cards first", async () => {
  const w = createWorld({ settings: withAssistant() });
  await w.ownerSays("order 10 boxes of hair colour from Ravi Traders");
  for (const c of assistantOf(w.store).cards) c.expiresAtMs = w.clock.now() - 1; // the assistant's own sweep got there first
  await w.tick();
  assert.equal(w.order("po-1")?.state, "void");
});

test("a shop without the assistant answers an unreadable message as before", async () => {
  const w = createWorld();
  await w.ownerSays("blah blah");
  assert.ok(w.lastTextTo(w.owner).length > 0);
  assert.equal(w.store.assistant?.cards.length ?? 0, 0);
});
