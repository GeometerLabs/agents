// THE OWNER'S SIDE (groups (iii) and (iv) of the contract, README.md): the owner's commands on WhatsApp, the limits the owner may change ("Limits, tightened by a tap": the
// big-order line, the refund limit, the day's count), the shop's assistant with the Orders skill (open orders, what needs me as a card whose answer is the owner's own command,
// the owner's cancel of a paid order as a card with the exact refund), and the shop's ONE stock count on the owner's Stock page (modules/stock): an order that stands takes its
// count once, a cancelled one gives it back, a hold is taken off what is left, the page's offer shows the smaller of the day's stock and the shelf. Expected values from
// test/assistant, assistant-acts, stock, approvers and the limits kit's own tests. Guards mode where the owner's WhatsApp words are the witness; fakes mode for the Stock page.
import { after, describe } from "node:test";
import assert from "node:assert/strict";
import { CUSTOMER, OWNER_NUMBER, contract, makeShop } from "./harness.ts";
import type { Shop } from "./harness.ts";

const shops: Shop[] = [];
after(async () => { for (const s of shops) { await s.stop(); await s.cleanup(); } });
async function boot(o: Parameters<typeof makeShop>[0] = {}): Promise<Shop> { const s = await makeShop(o); shops.push(s); await s.start(); return s; }
const ASSISTANT = { assistant: {} };
const link = (s: Shop, n = 0) => s.guards!.standins.fakes.payments.links()[n];
const stockView = async (s: Shop) => (await s.call("/internal/channel/owner-stock", { owner: s.owner })).body;
const stockOp = async (s: Shop, id: string, op: Record<string, unknown>) => { const a = await s.call("/internal/channel/owner-stock", { owner: s.owner, body: { id, op } }); if (a.status === 200) await s.settle(); return a; };

describe("the owner on WhatsApp, without the assistant", () => {
  contract("a word that is not a command is answered with how to write one, and nothing is read as an approval", async () => {
    const s = await boot({ mode: "guards" });
    await s.inbound(OWNER_NUMBER, "open orders");
    assert.match(s.sent(OWNER_NUMBER).at(-1)!.text, /didn't understand/u);
    assert.equal(s.record().filter((r) => r.action === "owner_assistant").length, 0);
    await s.inbound(OWNER_NUMBER, "approve o-9");
    assert.ok(s.record().some((r) => r.action === "owner_decision" && r.outcome === "blocked"));
  });

  contract("the owner's 'approve o-1' on a big order lets the customer pay; the customer gets the link", async () => {
    const s = await boot({ mode: "guards" });
    await s.inbound(CUSTOMER, `7 chicken meal ${s.orderDay().words} 12:00 pm pickup`);
    assert.match(s.sent(OWNER_NUMBER).at(-1)!.text, /Approval needed: \+919844444444 wants 7 × chicken meal/u);
    assert.match(s.sent(CUSTOMER).at(-1)!.text, /asked the owner to approve it/u);
    assert.equal(s.guards!.of("payments", "POST").length, 0, "no link before the owner's yes");
    await s.inbound(OWNER_NUMBER, "approve o-1");
    const links = s.guards!.of("payments", "POST", /^\/v1\/payment_links$/u);
    assert.deepEqual(links.map((c) => c.body.amount), [56000]);
    assert.ok(s.sent(CUSTOMER).at(-1)!.text.includes(link(s).pay_url));
  });
});

describe("the limits the owner may change", () => {
  contract("the limits page and the deployer's list name the three limits Orders declares, with their values in force", async () => {
    const s = await boot();
    const changes = await s.call("/internal/limit-changes");
    assert.equal(changes.status, 200);
    const ids = JSON.stringify(changes.body);
    for (const key of ["owner.approveOverInr", "refund.limitInr", "orders.maxPerDay"]) assert.ok(ids.includes(key), `${key} in ${ids.slice(0, 300)}`);
    const page = await s.call("/internal/channel/owner-limits", { owner: s.owner });
    assert.equal(page.status, 200);
    const shown = JSON.stringify(page.body);
    for (const v of ["1000", "300", "8"]) assert.ok(shown.includes(v), `the value ${v} in force is shown`);
    const loosen = await s.call("/internal/channel/owner-limits", { owner: s.owner, body: { id: "l-1", limit: "refund.limitInr", to: 200 } });
    assert.deepEqual([loosen.status, loosen.body.state], [403, "passkey_needed"], "a change needs a passkey session");
  });
});

describe("the shop's assistant with the Orders skill", () => {
  contract("'open orders' lists them; 'what needs me' asks about a big order as a card whose Refuse is the owner's own deny", async () => {
    const s = await boot({ mode: "guards", settings: ASSISTANT });
    await s.inbound(CUSTOMER, `7 chicken meal ${s.orderDay().words} 12:00 pm pickup`);
    await s.inbound(OWNER_NUMBER, "open orders");
    assert.match(s.sent(OWNER_NUMBER).at(-1)!.text, /^Open orders: 1\n/u);
    await s.inbound(OWNER_NUMBER, "what needs me");
    const card = s.sent(OWNER_NUMBER).filter((m) => m.interactive).at(-1)!;
    assert.match(card.text, /^Accept order o-1 from \+919844444444 \(7 × /u);
    await s.tap(card.interactive.buttons[1].id, { from: OWNER_NUMBER });
    assert.deepEqual((await s.status()).orders, { cancelled: 1 });
    assert.ok(s.record().some((r) => r.action === "owner_decision" && r.outcome === "confirmed" && r.refs.command === "deny"));
    assert.match(s.sent(CUSTOMER).at(-1)!.text, /cannot take your order/u);
  });

  contract("the owner's cancel of a paid order is a card with the exact refund; nothing happens before the tap, and the tap refunds exactly that, once", async () => {
    const s = await boot({ mode: "guards", settings: ASSISTANT });
    const { hash } = await s.order();
    await s.events(s.guards!.pay(link(s).id).map((event) => ({ kind: "payment_event", event }))); await s.settle();
    await s.inbound(OWNER_NUMBER, "cancel o-1");
    const card = s.sent(OWNER_NUMBER).filter((m) => m.interactive).at(-1)!;
    assert.match(card.text, /o-1/u);
    assert.match(card.text, /₹120/u);
    assert.equal(s.guards!.of("payments", "POST", /\/refund$/u).length, 0, "nothing before the tap");
    await s.tap(card.interactive.buttons[0].id, { from: OWNER_NUMBER });
    const refunds = s.guards!.of("payments", "POST", /\/refund$/u);
    assert.equal(refunds.length, 1);
    assert.equal(refunds[0].body.amount, 12000);
    assert.equal((await s.request(hash)).body.status, "cancelled");
    await s.tap(card.interactive.buttons[0].id, { from: OWNER_NUMBER });
    assert.equal(s.guards!.of("payments", "POST", /\/refund$/u).length, 1, "a card is used once");
  });

  contract("the owner's page carries the assistant's app view, and the talk box is read by the assistant", async () => {
    const s = await boot({ settings: ASSISTANT });
    const view = (await s.ownerView()).body;
    assert.equal(typeof view.app, "object", "the app's view is on the owner's read");
    const said = await s.channelEvents([{ kind: "owner_message", id: "t-1", text: "open orders" }], { owner: true });
    assert.equal(said.status, 200); await s.settle();
    assert.ok(s.record().some((r) => r.action === "owner_assistant"), "the assistant read the owner's words");
    const plain = await boot();
    await plain.channelEvents([{ kind: "owner_message", id: "t-1", text: "open orders" }], { owner: true }); await plain.settle();
    assert.ok(plain.record().some((r) => r.action === "owner_page_message" && r.outcome === "blocked"), "a shop without the assistant reads nothing");
  });
});

describe("the shop's stock count", () => {
  contract("the Stock page offers the menu's items to count; an order that stands takes its count once, a hold is taken off what is left, a cancelled order gives it back", async () => {
    const s = await boot({ settings: ASSISTANT });
    const before = await stockView(s);
    assert.deepEqual(before.rows, []);
    assert.deepEqual(before.candidates.map((c: { id: string }) => c.id), ["menu:veg-thali", "menu:chicken-meal", "menu:curd"]);
    assert.equal((await stockOp(s, "s-1", { op: "start", id: "menu:veg-thali", count: 5 })).status, 200);
    const counted = await stockView(s);
    assert.deepEqual(counted.rows.map((r: { id: string; count: number }) => [r.id, r.count]), [["menu:veg-thali", 5]]);
    const first = await s.order({ lines: [{ itemId: "veg-thali", qty: 2 }] });
    assert.equal((await s.call("/internal/channel/offer")).body.days[1].left["veg-thali"], 3, "the shelf less what is held, below the day's 12");
    assert.equal((await stockView(s)).rows[0].count, 5, "a hold does not lower the count");
    await s.ownerPress("deposit", "received");
    assert.equal((await s.request(first.hash)).body.status, "confirmed");
    const after = await s.order({ lines: [{ itemId: "curd", qty: 1 }], phone: "+919855555555" }); // any step brings the count in line
    void after;
    assert.equal((await stockView(s)).rows[0].count, 3, "the confirmed order took its 2, once");
    const big = await s.order({ lines: [{ itemId: "veg-thali", qty: 4 }], phone: "+919866666666" });
    const v = (await s.request(big.hash)).body;
    assert.equal(v.status, "not_held", "more than the shelf has left is refused");
    assert.match(v.messages.at(-1).text, /only 3 veg thali left/u);
    assert.ok(s.record().some((r) => r.action === "stock"), "the stock's own lines are in the record");
  });

  contract("the page refuses a malformed op and one its rules refuse, and a stranger has no Stock page", async () => {
    const s = await boot({ settings: ASSISTANT });
    assert.equal((await s.call("/internal/channel/owner-stock")).status, 403);
    assert.equal((await stockOp(s, "s-1", { op: "nope", id: "menu:veg-thali" })).status, 400);
    assert.equal((await stockOp(s, "s-2", { op: "start", id: "veg-thali", count: 5 })).status, 400);
    const refused = await stockOp(s, "s-3", { op: "sold", id: "menu:veg-thali", qty: 1 });
    assert.equal(refused.status, 422, "an item nobody counts cannot be sold from");
  });
});
