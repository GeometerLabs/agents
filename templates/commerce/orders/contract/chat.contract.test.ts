// THE CUSTOMER'S CHAT on the shop's page and what a language model says (group (v) of the contract, README.md): a guest's send through the channel token reaches the SAME
// ordering flow a WhatsApp customer reaches, in the guest's own conversation; the owner sees the guest as "Chat guest 1", never the conversation's name; a send made again is
// answered once; and a model's reading of a message is untrusted input the shop checks and falls back from. A "fakes" shop on the TEST clock at Mon 9 Nov 2026, 10:00 in India
// (tomorrow is Tue 10 Nov). Expected values from test/chat, talk, language and agent (the AI cap). The model is the shared fake OpenAI-compatible server (modules/test/contract).
import { after, describe } from "node:test";
import assert from "node:assert/strict";
import { CUSTOMER, contract, makeShop, startFakeModel } from "./harness.ts";
import type { FakeModel, Shop } from "./harness.ts";

const shops: Shop[] = [];
const models: FakeModel[] = [];
after(async () => { for (const s of shops) { await s.stop(); await s.cleanup(); } for (const m of models) await m.close(); });
async function boot(o: Parameters<typeof makeShop>[0] = {}): Promise<Shop> { const s = await makeShop(o); shops.push(s); await s.start(); return s; }
type Line = { n: number; who: "you" | "shop"; text: string; choices?: { id: string; title: string }[] };
const thread = async (s: Shop, hash: string): Promise<{ lines: Line[]; answered: boolean }> => (await s.call(`/internal/channel/chat?handle=${hash}`)).body;
const shopLines = async (s: Shop, hash: string): Promise<string[]> => (await thread(s, hash)).lines.filter((l) => l.who === "shop").map((l) => l.text);
const ORDER = "2 veg thali 10 nov 12:00 pm pickup";

describe("the chat's thread", () => {
  contract("a guest's order in the chat is held by the shop's own flow, in the guest's conversation; the owner sees 'Chat guest 1'", async () => {
    const s = await boot();
    const g = s.guest();
    assert.deepEqual((await thread(s, g.hash)).lines, [], "an unseen guest has an empty thread");
    assert.equal((await s.chat(g.hash, ORDER, { id: "send-1" })).status, 200);
    const t = await thread(s, g.hash);
    assert.deepEqual(t.lines.map((l) => l.who), ["you", "shop"]);
    assert.equal(t.lines[0].text, ORDER);
    assert.match(t.lines[1].text, /2 × veg thali .*Total ₹240/su);
    assert.deepEqual((await s.status()).orders, { awaiting_advance: 1 });
    const [item] = (await s.ownerView()).body.items;
    assert.deepEqual([item.kind, item.channel, item.customer], ["deposit", "chat", { phone: "", name: "Chat guest 1" }]);
    assert.ok(s.record().some((r) => r.conversation.startsWith("chat:") && r.action === "hold_stock"));
  });

  contract("the same send made again is answered once; a greeting is answered with the menu and its items as taps", async () => {
    const s = await boot();
    const g = s.guest();
    await s.chat(g.hash, "hello", { id: "same-1" });
    const again = await s.channelEvents([{ kind: "chat_message", id: "same-1", handle: g.hash, language: "en", text: "hello" }]);
    assert.equal(again.body.duplicates, 1);
    await s.settle();
    const lines = (await thread(s, g.hash)).lines;
    assert.deepEqual(lines.map((l) => l.who), ["you", "shop"]);
    assert.match(lines[1].text, /Welcome to Annapurna Tiffins/u);
    assert.ok((lines[1].choices ?? []).some((c) => c.id.includes("veg-thali")), JSON.stringify(lines[1].choices));
  });

  contract("a Hindi order is answered in Hindi", async () => {
    const s = await boot();
    const g = s.guest();
    await s.chat(g.hash, "2 वेज थाली 10 nov 12:00 pm पिकअप", { language: "hi" });
    assert.match((await shopLines(s, g.hash)).at(-1)!, /कुल ₹240/u);
  });
});

describe("what a model says is untrusted", () => {
  const intent = (fields: Record<string, unknown>) => ({ kind: "unknown", language: null, items: null, date: null, time: null, mode: null, slot: null, offerInr: null, overrideAttempt: false, ...fields });

  contract("a message the rules cannot read is sent to the shop's model; its answer is checked against the menu, and an item the shop does not have is not ordered", async () => {
    const fake = await startFakeModel(() => intent({ kind: "order", items: [{ item: "pizza", qty: 3 }], date: "10 nov" })); models.push(fake);
    const s = await boot({ modelPort: fake.port });
    await s.inbound(CUSTOMER, "do you have anything nice for my mother");
    assert.ok(fake.requests.length >= 1, "the model was asked");
    assert.equal((await s.status()).orders.awaiting_advance, undefined, "nothing is held for an item the menu does not have");
    assert.ok(s.templatesTo(CUSTOMER).length >= 1, "the customer was answered");
  });

  contract("a model that answers nonsense or nothing is fallen back from: the customer is answered by the rules", async () => {
    const fake = await startFakeModel(() => "this is not json at all", { rawStrings: true }); models.push(fake);
    const s = await boot({ modelPort: fake.port });
    await s.inbound(CUSTOMER, ORDER);
    assert.deepEqual((await s.status()).orders, { awaiting_advance: 1 }, "the rules still take a clear order");
    await s.inbound("+919855555555", "do you have anything nice for my mother");
    assert.ok(s.templatesTo("+919855555555").length >= 1);
    assert.equal((await s.status()).tasks.failed, 0);
  });
});
