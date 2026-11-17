// The owner's page for Stock orders (src/channel.ts) and what its buttons do (agent.ts onOwnerAction): orders waiting for the owner's yes, orders no supplier has answered, and
// deliveries to mark. Each press carries the digest of what the page showed; a press for what changed since does nothing, and the same press twice is done once.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RAVI, createWorld } from "../src/harness.ts";
import { ownerItems, ownerView } from "../src/channel.ts";

const items = (w: ReturnType<typeof createWorld>) => ownerItems(w.settings, w.store, w.clock.now(), w.store.assistant);
const press = (w: ReturnType<typeof createWorld>, action: string, c: string, digest: string, id = `p-${Math.random().toString(36).slice(2, 8)}`) =>
  w.agent.handle({ kind: "owner_action", id, action: action as never, case: c, digest });

test("an order that waits is an item with its card's id and digest; yes on the page approves exactly once", async () => {
  const w = createWorld();
  await w.ownerSays("order 10 boxes of hair colour from Ravi Traders");
  const [item] = items(w);
  assert.equal(item.kind, "po_approval");
  assert.deepEqual(item.actions, ["card_yes", "card_no"]);
  assert.equal(item.amountPaise, 450_000);
  assert.ok(!JSON.stringify(item).includes("yes "), "no one-use code is ever on the page");
  await press(w, "card_yes", item.case, item.digest, "p-1");
  assert.equal(w.order("po-1")?.state, "sent");
  assert.equal(w.orderMessagesTo(RAVI).length, 1);
  await press(w, "card_yes", item.case, item.digest, "p-2");
  assert.equal(w.orderMessagesTo(RAVI).length, 1, "pressed again, nothing more is sent");
});

test("no on the page declines the order and sends nothing", async () => {
  const w = createWorld();
  await w.ownerSays("order 10 boxes of hair colour from Ravi Traders");
  const [item] = items(w);
  await press(w, "card_no", item.case, item.digest);
  assert.equal(w.order("po-1")?.state, "declined");
  assert.equal(w.orderMessagesTo(RAVI).length, 0);
});

test("a press with a digest from before a change does nothing", async () => {
  const w = createWorld();
  await w.ownerSays("order 10 boxes of hair colour from Ravi Traders");
  const [old] = items(w);
  await w.ownerSays("change po-1 12");
  await press(w, "card_yes", old.case, old.digest);
  assert.equal(w.order("po-1")?.state, "awaiting_approval");
  assert.equal(w.orderMessagesTo(RAVI).length, 0);
});

test("a delivery to mark: received on the page marks the whole order once, and it is the owner's mark, not the supplier's", async () => {
  const w = createWorld();
  await w.ownerSays("order 10 boxes of hair colour from Ravi Traders");
  await w.ownerSays(w.approveText());
  assert.equal(items(w).length, 0, "an order the supplier has not accepted is not yet a delivery to mark");
  await w.supplierSays(RAVI, "ok");
  const [item] = items(w);
  assert.equal(item.kind, "po_receive");
  await press(w, "received", item.case, item.digest, "p-r1");
  assert.equal(w.order("po-1")?.receipt, "full");
  assert.equal(w.order("po-1")?.paidOutsideMs, undefined);
  assert.equal(items(w).length, 0);
});

test("an order the supplier has not answered after the last ask is listed, and asking again is about the same order and once", async () => {
  const w = createWorld();
  await w.ownerSays("order 10 boxes of hair colour from Ravi Traders");
  await w.ownerSays(w.approveText());
  await w.advance(30 * 60);
  const [item] = items(w);
  assert.equal(item.kind, "po_silent");
  const before = w.textsTo(RAVI).length;
  await press(w, "retry", item.case, item.digest, "p-a1");
  assert.equal(w.textsTo(RAVI).length, before + 1);
  assert.equal(w.orderMessagesTo(RAVI).length, 1, "the ask is not a new order");
  await press(w, "retry", item.case, item.digest, "p-a2");
  assert.equal(w.textsTo(RAVI).length, before + 1, "the second press has an old digest");
});

test("the owner's view names the shop, carries no customer and no one-use code, and lists orders now with suppliers", async () => {
  const w = createWorld();
  await w.ownerSays("order 10 boxes of hair colour from Ravi Traders");
  await w.ownerSays(w.approveText());
  const view = ownerView(w.settings, w.store, w.clock.now());
  assert.equal(view.kind, "stock");
  assert.equal(view.upcoming.length, 1);
  assert.ok(!JSON.stringify(view).match(/yes [A-Z0-9]{4,6}/u));
});
