// The owner's page and the shop's stock count (group O, README.md). The page lists what waits for the owner (an order for their yes, a delivery to mark, a silent supplier, an
// order message that may not have arrived), each bound to a digest so a press for something that changed since does nothing and the same press twice is done once. With the
// shop's assistant (an `assistant` block in settings.json) the owner's Stock page counts the shop's supply items: goods marked received raise the count once per purchase order by
// what was marked (a part, then the rest), a unit that is not the count's adds nothing, and a count that falls to its low mark starts ONE reorder through the existing flow (a
// card for the owner's yes, never an approval by itself). From test/channel.test.ts, test/stock.test.ts and test/assistant.test.ts.
import { after, describe } from "node:test";
import assert from "node:assert/strict";
import { MEENA, OWNER, RAVI, contract, orderAndApprove, shops, sleep } from "./harness.ts";
import type { Shop } from "./harness.ts";

const made = shops();
after(async () => { for (const s of made.all) { await s.stop(); await s.cleanup(); } });
const STOCK = "/internal/channel/owner-stock";
async function stockOp(s: Shop, id: string, op: Record<string, unknown>): Promise<void> {
  const r = await s.call(STOCK, { owner: s.owner, body: { id, op } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  await s.settle();
}
const page = async (s: Shop): Promise<any> => (await s.call(STOCK, { owner: s.owner })).body;
const row = async (s: Shop, id: string): Promise<any> => (await page(s)).rows.find((r: any) => r.id === id);

describe("the owner's page", () => {
  contract("an order that waits is an item bound to its card; yes on the page approves exactly once, and a press with a digest from before a change does nothing", async () => {
    const s = await made.boot();
    await s.ownerSays("order 10 boxes of hair colour from Ravi Traders");
    const item = await s.item("po_approval", "po-1");
    assert.deepEqual(item.actions, ["card_yes", "card_no"]);
    assert.equal(item.amountPaise, 450_000);
    assert.match(item.what, /^po-1: 10 box hair colour$/u);
    assert.ok(!JSON.stringify(item).includes(s.code()), "the page never carries the one-use code");
    await s.ownerSays("change po-1 12");
    const stale = await s.press("card_yes", item);
    assert.equal(stale.status, 200);
    assert.equal(s.order("po-1").state, "awaiting_approval", "the card shown before the change does nothing");
    assert.match(s.lastToOwner()!.text, /already answered or replaced/u);
    await s.press("card_yes", { case: item.case, digest: "0".repeat(32) });
    assert.ok(s.record().some((l) => l.action === "owner_page_action" && l.outcome === "blocked"), "a digest that is not the card's does nothing");
    assert.equal(s.order("po-1").state, "awaiting_approval");
    const now = await s.item("po_approval", "po-1");
    await s.press("card_yes", now);
    await s.press("card_yes", now);
    assert.equal(s.order("po-1").state, "sent");
    assert.equal(s.orderMessagesTo(RAVI).length, 1);
  });

  contract("no on the page declines and sends nothing", async () => {
    const s = await made.boot();
    await s.ownerSays("order 12 shampoo from meena");
    await s.press("card_no", await s.item("po_approval", "po-1"));
    assert.equal(s.order("po-1").state, "declined");
    assert.equal(s.sent(MEENA).length, 0);
  });

  contract("a delivery to mark: received on the page marks the whole order once, as the owner's mark", async () => {
    const s = await made.boot();
    await orderAndApprove(s);
    assert.equal(await s.item("po_receive", "po-1"), undefined, "nothing to mark before the supplier says OK");
    await s.inbound(RAVI, "OK");
    const item = await s.item("po_receive", "po-1");
    assert.deepEqual(item.actions, ["received"]);
    await s.press("received", item);
    await s.press("received", item);
    assert.equal(s.order("po-1").receipt, "full"); assert.equal(s.order("po-1").receivedQty, 10);
    assert.equal(s.record().filter((l) => l.action === "mark_receipt").length, 1, "once");
    const view = (await s.ownerView()).body;
    assert.equal(view.items.length, 0);
    assert.ok(!JSON.stringify(view).includes(OWNER), "the owner's own number is not on the page");
  });

  contract("orders with suppliers are the page's coming list; the talk box needs the shop's assistant", async () => {
    const s = await made.boot();
    await orderAndApprove(s);
    const view = (await s.ownerView()).body;
    assert.equal(view.upcoming.length, 1);
    assert.match(view.upcoming[0].what, /^po-1: 10 box hair colour · Ravi Traders$/u);
    assert.equal(view.upcoming[0].state, "sent");
    assert.equal(view.app, undefined, "no assistant: no app view");
    const a = await s.channelEvents([{ kind: "owner_message", id: "t-1", text: "what needs me?" }]);
    assert.equal(a.status, 200);
    await s.settle();
    assert.ok(s.record().some((l) => l.action === "owner_page_message" && l.outcome === "blocked"));
  });

  contract("with the shop's assistant the page carries the app's view, and an order's card is listed once (as the order's item, not again in the app)", async () => {
    const s = await made.boot({ settings: { assistant: {} } });
    await s.ownerSays("order 10 boxes of hair colour from Ravi Traders");
    const view = (await s.ownerView()).body;
    assert.ok(view.app, "the assistant's view");
    assert.equal(view.items.filter((i: any) => i.kind === "po_approval").length, 1);
    assert.ok(!(view.app.cards ?? []).some((c: any) => c.kind === "order"), "the app leaves the order's card out");
  });
});

describe("the shop's stock count", () => {
  contract("no assistant, no Stock page; with it, the shop's items are the candidates, with the unit when every line uses one", async () => {
    const plain = await made.boot();
    assert.equal((await plain.call(STOCK, { owner: plain.owner })).status, 404);
    const s = await made.boot({ settings: { assistant: {} } });
    const view = await page(s);
    assert.deepEqual(view.rows, []);
    const byId = Object.fromEntries(view.candidates.map((c: any) => [c.id, c]));
    assert.deepEqual(byId["supply:shampoo"], { id: "supply:shampoo", name: "shampoo", unit: "bottle" });
    assert.deepEqual(byId["supply:hair-colour"], { id: "supply:hair-colour", name: "hair colour" }, "boxes and pieces: no one unit");
  });

  contract("goods marked received raise a counted item's count by what was marked, each piece once; an item nobody counts is untouched", async () => {
    const s = await made.boot({ settings: { assistant: {} } });
    await stockOp(s, "st-1", { op: "start", id: "supply:hair-colour", count: 5, unit: "box" });
    await orderAndApprove(s);
    await s.inbound(RAVI, "OK");
    await s.ownerSays("received po-1 4");
    assert.equal((await row(s, "supply:hair-colour")).count, 9);
    await s.ownerSays("received po-1 4", { id: "wamid.twice" });
    await s.ownerSays("received po-1 4", { id: "wamid.twice" });
    assert.equal((await row(s, "supply:hair-colour")).count, 13, "a redelivered mark adds once");
    await s.ownerSays("received po-1");
    assert.equal((await row(s, "supply:hair-colour")).count, 15);
    assert.ok(s.record().some((l) => l.action === "stock" && l.refs.change === "received" && l.refs.by === "shop"));
    assert.equal(await row(s, "supply:shampoo"), undefined);
  });

  contract("a delivery in another unit than the count is not added, and the owner is told once in their app", async () => {
    const s = await made.boot({ settings: { assistant: {} } });
    await stockOp(s, "st-1", { op: "start", id: "supply:hair-colour", count: 5, unit: "piece" });
    await orderAndApprove(s);
    await s.inbound(RAVI, "OK");
    await s.ownerSays("received po-1");
    assert.equal((await row(s, "supply:hair-colour")).count, 5);
    assert.ok(s.record().some((l) => l.action === "stock" && l.outcome === "blocked"));
    const talk = s.saved().assistant.talk.filter((t: any) => t.from === "assistant" && /piece/u.test(t.text));
    assert.equal(talk.length, 1);
  });

  contract("a count at its low mark starts one reorder: a card for the owner's yes, never an approval by itself; the same crossing never makes a second", async () => {
    const s = await made.boot({ settings: { assistant: {} }, tickSeconds: 1 });
    await stockOp(s, "st-1", { op: "start", id: "supply:hair-oil", count: 3, low: 2, unit: "bottle" });
    await stockOp(s, "st-2", { op: "sold", id: "supply:hair-oil", qty: 1 });
    for (let i = 0; i < 80 && !s.order("po-1"); i++) await sleep(100);
    const o = s.order("po-1");
    assert.ok(o, "a reorder was made");
    assert.equal(o.state, "awaiting_approval"); assert.equal(o.lowStock, true); assert.equal(o.qty, 6); assert.equal(o.supplier, "meena-beauty");
    assert.equal(s.sent(MEENA).length, 0, "nothing is sent without the owner's yes");
    assert.ok(s.saved().assistant.talk.some((t: any) => /low/u.test(t.text)), "the owner's app says which item is low");
    await s.ownerSays("cancel po-1");
    await sleep(2200);
    assert.deepEqual(Object.keys(s.saved().orders), ["po-1"], "one crossing, one reorder");
    assert.ok(s.record().some((l) => l.action === "stock" && l.refs.change === "low"));
  });
});
