// The agent's main paths on the example shop: request, card, approval, order message, acknowledgement, receipt.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RAVI, createWorld } from "../src/harness.ts";

test("a request becomes a card; the card's approval sends one order; the supplier's OK is not receipt", async () => {
  const w = createWorld();
  await w.ownerSays("order 10 boxes of hair colour from Ravi Traders");
  assert.equal(w.order("po-1")?.state, "awaiting_approval");
  assert.equal(w.order("po-1")?.totalPaise, 450_000);
  assert.equal(w.orderMessagesTo(RAVI).length, 0, "nothing is sent before approval");
  await w.ownerSays(w.approveText());
  assert.equal(w.order("po-1")?.state, "sent");
  assert.equal(w.orderMessagesTo(RAVI).length, 1);
  await w.supplierSays(RAVI, "ok");
  assert.equal(w.order("po-1")?.ack, "accepted");
  assert.equal(w.order("po-1")?.receipt, "none");
  await w.ownerSays("received po-1");
  assert.equal(w.order("po-1")?.receipt, "full");
  assert.equal(w.order("po-1")?.paidOutsideMs, undefined);
});

test("the owner's button taps work like the typed code", async () => {
  const w = createWorld();
  await w.ownerSays("order 10 boxes of hair colour from Ravi Traders");
  await w.ownerSays("hi"); // opens the owner's window so the next card carries buttons
  await w.ownerSays("order 12 shampoo from ravi");
  const code = w.cardCode();
  await w.ownerTaps(`card-yes:${code}`);
  assert.equal(w.order("po-2")?.state, "sent");
});

test("a card that ran out does nothing", async () => {
  const w = createWorld();
  await w.ownerSays("order 10 boxes of hair colour from Ravi Traders");
  const code = w.cardCode();
  await w.advance(25 * 60);
  await w.ownerSays(`yes ${code}`);
  assert.equal(w.orderMessagesTo(RAVI).length, 0);
  assert.equal(w.order("po-1")?.state, "void");
});

test("an unreadable message is answered with examples, never guessed", async () => {
  const w = createWorld();
  await w.ownerSays("good morning");
  assert.equal(w.orders().length, 0);
  assert.match(w.lastTextTo(w.owner), /could not tell/u);
});
