// The gaps before the deletion of the TypeScript runtime and its unit tests (group G, README.md, 23 Nov 2026): behaviours that only a unit test of the TypeScript checked until now, each
// run on BOTH runtimes. (1) The owner told outside their 24-hour window: a supplier's STOP, the order's send, a receipt marked on the page and the card that ran out each have an
// approved template of their own with their values (before, they went as the generic `stock_owner_notice` with no parameters, which a real provider refuses). (2) The two limits the
// owner may tighten (the order cap and the month's budget) keep their hard bounds: never below the dearest catalogue line, never below the cap, never looser. (3) The low-stock reorder
// asks which supplier when an item has two, waits while the owner is in the middle of another question, and gives up after three questions. (4) The WhatsApp Guard down while the
// owner writes: the message is kept and waits, nothing is answered meanwhile, and when the Guard is back there is one answer. (5) The send-once intent holds the order's own message.
// From test/agent.test.ts, test/chat-limits.test.ts, test/stock.test.ts, test/send-once.test.ts and test/runtime.test.ts.
import { after, describe } from "node:test";
import assert from "node:assert/strict";
import { HOUR, MEENA, OWNER, RAVI, contract, orderAndApprove, shops, sleep } from "./harness.ts";
import type { Shop } from "./harness.ts";

const made = shops();
after(async () => { for (const s of made.all) { await s.stop(); await s.cleanup(); } });
const STOCK = "/internal/channel/owner-stock";
async function stockOp(s: Shop, id: string, op: Record<string, unknown>): Promise<void> {
  const r = await s.call(STOCK, { owner: s.owner, body: { id, op } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  await s.settle();
}
/** Wait (on the real clock, while the shop beats every second) until `ok` holds. */
async function until(s: Shop, ok: () => boolean | Promise<boolean>, what: string, tries = 100): Promise<void> {
  for (let i = 0; i < tries; i++) { if (await ok()) return; await sleep(100); }
  throw new Error(`waited ${tries / 10} s for ${what}:\n${s.log().slice(-2000)}`);
}
const templated = (s: Shop, to: string, name: string) => s.sent(to).filter((m) => m.templateName === name);

describe("the owner is told outside their window by a template of its own", () => {
  contract("a reorder card, its approval and its receipt from the page, and a supplier's STOP: each reaches an owner who never wrote, as a template with its values", async () => {
    const s = await made.boot({ settings: { assistant: {} }, tickSeconds: 1 });
    // the owner has written nothing: their window is closed, so only an approved template reaches them
    await stockOp(s, "st-1", { op: "start", id: "supply:hair-oil", count: 3, low: 2, unit: "bottle" });
    await stockOp(s, "st-2", { op: "sold", id: "supply:hair-oil", qty: 1 });
    await until(s, () => !!s.order("po-1"), "the reorder");
    await until(s, () => templated(s, OWNER, "stock_owner_approval_card").length === 1, "the card");
    await s.press("card_yes", (await s.item("po_approval", "po-1"))!);
    assert.equal(s.order("po-1").state, "sent");
    const sent = templated(s, OWNER, "stock_owner_order_sent");
    assert.equal(sent.length, 1, "the send's ending reaches the owner as its template");
    assert.match(sent[0].text, /Order po-1 went to Meena Beauty Supplies/u);
    const intent = s.saved().sendOnce.intents[0];
    assert.equal(intent.status, "confirmed"); assert.equal(intent.kind, "purchase_order");
    await s.inbound(MEENA, "OK");
    await s.press("received", (await s.item("po_receive", "po-1"))!);
    const got = templated(s, OWNER, "stock_owner_received_all");
    assert.equal(got.length, 1, "a receipt marked on the page is told as its template");
    assert.match(got[0].text, /Marked received, all of it: order po-1/u);
    await s.inbound(RAVI, "STOP");
    const stopped = templated(s, OWNER, "stock_owner_supplier_stopped");
    assert.equal(stopped.length, 1, "a supplier's STOP reaches the owner as its template");
    assert.match(stopped[0].text, /Supplier Ravi Traders asked for no more messages/u);
    assert.equal(s.sent(OWNER).filter((m) => m.templateName === "stock_owner_notice").length, 0, "nothing went as the generic notice, which a provider refuses");
  });

  contract("a refused send ends as send_failed and the owner, with no window, is told by its template; a lost reply is told by another", async () => {
    const s = await made.boot({ settings: { assistant: {} }, tickSeconds: 1 });
    await stockOp(s, "st-1", { op: "start", id: "supply:hair-oil", count: 3, low: 2, unit: "bottle" });
    await stockOp(s, "st-2", { op: "sold", id: "supply:hair-oil", qty: 1 });
    await until(s, () => !!s.order("po-1"), "the reorder");
    s.guard!.loseReply({ times: 1, match: (c) => c.method === "POST" && c.body?.template?.name === "stock_order_to_supplier" });
    await s.press("card_yes", (await s.item("po_approval", "po-1"))!);
    await until(s, () => s.order("po-1").state === "send_unknown", "the unconfirmed send");
    await until(s, () => templated(s, OWNER, "stock_owner_order_unconfirmed").length === 1, "the owner's word that it may not have arrived");
    assert.match(templated(s, OWNER, "stock_owner_order_unconfirmed")[0].text, /may or may not have reached Meena Beauty Supplies/u);
  });
});

describe("the two limits the owner may tighten keep their bounds", () => {
  contract("the order cap cannot go below the dearest catalogue line, the budget cannot go below the cap, and neither can be loosened", async () => {
    const s = await made.boot({ settings: { assistant: {} } });
    const cards = (): any[] => (s.saved()?.assistant?.cards ?? []).filter((c: any) => c.action?.kind === "limit");
    await s.ownerSays("order cap at most ₹300");            // the dearest line is ₹460
    await s.ownerSays("monthly budget at most ₹10000");     // the cap is ₹12,000
    await s.ownerSays("monthly budget at most ₹25000");     // the budget is ₹20,000 now: this loosens it
    assert.equal(cards().length, 0, `no limit card for a value out of bounds: ${JSON.stringify([s.lastToOwner()?.text, cards()])}`);
    await s.ownerSays("order cap at most ₹9000");           // within bounds: a card
    assert.equal(cards().filter((c: any) => c.state === "open").length, 1, JSON.stringify([s.lastToOwner()?.text, cards()]));
    await s.ownerSays(`yes ${s.code()}`);
    assert.equal(s.saved().assistant.limitChanges.length, 1);
    await s.ownerSays("order 25 boxes of hair colour from ravi");   // ₹11,250: above the new cap of ₹9,000
    assert.equal(Object.keys(s.saved().orders).length, 0, "an order above the tightened cap gets no card");
    assert.match(s.lastToOwner()!.text, /₹9,000/u);
  });
});

describe("the low-stock reorder", () => {
  contract("an item with two suppliers asks which, once, and the answer makes one card for the line's reorder quantity", async () => {
    const s = await made.boot({ settings: { assistant: {} }, tickSeconds: 1 });
    await s.ownerSays("status"); // the owner wrote today: a list goes only inside their window
    await stockOp(s, "st-1", { op: "start", id: "supply:shampoo", count: 3, low: 2, unit: "bottle" });
    await stockOp(s, "st-2", { op: "sold", id: "supply:shampoo", qty: 1 });
    await until(s, () => s.saved().asking?.kind === "line", "the question which supplier");
    assert.equal(s.saved().asking.lowStock, true);
    await sleep(3000); // more beats: the same question is not asked again while it stands
    assert.equal(s.sent(OWNER).filter((m) => m.interactive?.list).length, 1, "one list");
    const list = s.sent(OWNER).filter((m) => m.interactive?.list).at(-1)!.interactive.list;
    const meena = list.rows.findIndex((r: { title: string }) => /Meena Beauty Supplies/u.test(r.title));
    assert.ok(meena >= 0, JSON.stringify(list.rows));
    await s.tap(OWNER, `pick:${meena}`);
    const o = s.order("po-1");
    assert.equal(o.supplier, "meena-beauty"); assert.equal(o.qty, 12); assert.equal(o.lowStock, true); assert.equal(o.state, "awaiting_approval");
    await sleep(2500);
    assert.deepEqual(Object.keys(s.saved().orders), ["po-1"], "one crossing, one reorder");
    assert.equal(s.sent(MEENA).length, 0, "nothing is sent without the yes");
  });

  contract("a low-stock question waits while the owner is in the middle of another, and is asked once that one is answered", async () => {
    const s = await made.boot({ settings: { assistant: {} }, tickSeconds: 1 });
    await s.ownerSays("order hair oil from meena");           // "How many?": the owner is asked
    assert.equal(s.saved().asking.kind, "qty");
    await stockOp(s, "st-1", { op: "start", id: "supply:shampoo", count: 3, low: 2, unit: "bottle" });
    await stockOp(s, "st-2", { op: "sold", id: "supply:shampoo", qty: 1 });
    await sleep(3000);
    assert.equal(s.saved().asking.kind, "qty", "the owner's question is not overwritten");
    assert.equal(s.saved().asking.lowStock, false);
    assert.equal(s.saved().assistant.stock.alerts.length, 1, "the alert stays queued");
    await s.ownerSays("6");
    assert.equal(s.order("po-1").item, "hair-oil");
    await until(s, () => s.saved().asking?.lowStock === true, "the low-stock question, asked now");
    assert.equal(s.saved().asking.item, "shampoo");
  });

  contract("an owner who never answers a low-stock question is asked three times, six hours apart, and then left alone", async () => {
    const s = await made.boot({ mode: "fakes", settings: { assistant: {} }, tickSeconds: 1 });
    const asked = (): number | undefined => s.saved()?.assistant?.stock?.alerts?.[0]?.asked;
    await stockOp(s, "st-1", { op: "start", id: "supply:shampoo", count: 3, low: 2, unit: "bottle" });
    await stockOp(s, "st-2", { op: "sold", id: "supply:shampoo", qty: 1 });
    await until(s, () => asked() === 1, "the first question");
    for (const n of [2, 3]) {
      s.advance(7 * HOUR);
      await until(s, () => asked() === n, `question ${n}`);
    }
    s.advance(7 * HOUR);
    await until(s, () => (s.saved()?.assistant?.stock?.alerts ?? []).length === 0, "the alert given up");
    await sleep(2500);
    assert.equal(s.saved().asking, undefined, "no fourth question");
    assert.deepEqual(Object.keys(s.saved().orders ?? {}), [], "nothing was ordered");
  });
});

describe("the WhatsApp Guard down", () => {
  contract("the owner's message is kept and waits, nothing is answered meanwhile, and when the Guard is back there is one answer", async () => {
    const s = await made.boot();
    s.guard!.down();
    const message = s.guard!.fake.receive(OWNER, "status");
    assert.equal((await s.events([{ kind: "message", message }])).status, 200, "saved before anything else");
    await sleep(1500);
    assert.deepEqual([(await s.status()).tasks.pending, s.sent(OWNER).length], [1, 0], "waiting, and nothing said");
    s.guard!.up();
    await until(s, () => s.sent(OWNER).length === 1, "the answer", 300);
    await s.settle(); await sleep(2500);
    assert.equal(s.sent(OWNER).length, 1, "one answer, not two");
    assert.equal((await s.status()).tasks.failed, 0);
  });
});

describe("send once keeps the order's own message", () => {
  contract("the intent holds the message id, the supplier, the template and the order, and the supplier is sent exactly that", async () => {
    const s = await made.boot();
    await orderAndApprove(s);
    const intent = s.saved().sendOnce.intents[0];
    assert.equal(intent.caseId ?? intent.case, "po-1");
    assert.equal(intent.kind, "purchase_order");
    assert.ok(typeof intent.id === "string" && intent.id.length > 0, "a message id");
    assert.equal(intent.to, RAVI);
    assert.equal(s.orderMessagesTo(RAVI).length, 1);
    assert.equal(s.orderMessagesTo(RAVI)[0].templateName, "stock_order_to_supplier");
  });
});
