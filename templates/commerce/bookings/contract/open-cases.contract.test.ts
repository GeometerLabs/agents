// OPEN CASES of the contract (README.md section 8), written after the first nine groups: the Guard's remaining captured answers on a refund, `recheck_refund` after a refund whose
// outcome was lost, the month's allowance of model reads, units of a resource over HTTP, and the owner's sign-in link sent on WhatsApp. Same harness and shops as the other files.
import { after, describe } from "node:test";
import assert from "node:assert/strict";
import { OWNER_BASE, OWNER_NUMBER, contract, makeShop, sleep, startFakeModel } from "./harness.ts";
import type { FakeModel, Shop } from "./harness.ts";
import { fixture } from "./guards.ts";

const shops: Shop[] = [];
const models: FakeModel[] = [];
after(async () => { for (const s of shops) { await s.stop(); await s.cleanup(); } for (const m of models) await m.close(); });
async function boot(o: Parameters<typeof makeShop>[0] = {}): Promise<Shop> { const s = await makeShop(o); shops.push(s); await s.start(); return s; }
const link = (s: Shop) => s.guards!.standins.fakes.payments.links()[0];
const refundCalls = (s: Shop) => s.guards!.of("payments", "POST", /\/refund$/u);
const refundMatch = (c: { method: string; path: string }) => c.method === "POST" && /\/refund$/u.test(c.path);
const UPI = { payment: { module: "upi", upi: { id: "glowsalon@okicici", payee: "Glow Salon" } }, calendar: { module: "own" } };

async function paid(o: Parameters<typeof makeShop>[0] = {}): Promise<{ s: Shop; hash: string }> {
  const s = await boot({ mode: "guards", tickSeconds: 1, ...o });
  const { hash } = await s.book();
  await s.events(s.guards!.pay(link(s).id).map((event) => ({ kind: "payment_event", event }))); await s.settle();
  return { s, hash };
}
const cancel = async (s: Shop, hash: string): Promise<void> => { await s.channelEvents([{ kind: "channel_request", id: "cancel-1", channel: "web", op: "cancel", handle: hash }]); await s.settle(); };

describe("the Guard's other answers to a refund", () => {
  for (const [name, builder] of [["refused_rule", true], ["provider_500", true], ["held_uncertain", true], ["unauthenticated", false], ["provider_unreachable", false]] as const) {
    contract(`${name}: nothing is refunded, ${builder ? "it is not sent again and the builder is told" : "it is either tried again by itself or handed to the builder, and the owner is not asked"}`, async () => {
      const { s, hash } = await paid();
      s.guards!.payments.answer(fixture("guard-responses.json")[name], { times: 1, match: refundMatch });
      await cancel(s, hash);
      await sleep(2500); await s.settle();
      const st = await s.status();
      assert.equal(s.guards!.standins.fakes.payments.refunds().length >= 1 && builder, false, "no refund was made behind the answer");
      assert.equal(st.refunds.waitingForOwner, 0, `the owner is not asked: ${JSON.stringify(st.refunds)}`);
      if (builder) { assert.equal(st.refunds.needBuilder.total, 1, JSON.stringify(st.refunds)); assert.equal(refundCalls(s).length, 1, "not sent again"); }
      else assert.ok(st.refunds.beingSentAgain + st.refunds.needBuilder.total >= 1, JSON.stringify(st.refunds));
    });
  }
});

describe("a refund whose outcome was lost", () => {
  contract("recheck_refund reads the payments service's list and settles it: the refund that was made is found, nothing is sent again, and the builder's list is empty", async () => {
    const { s, hash } = await paid();
    s.guards!.stub.failNext("outcome_unknown"); // the refund reaches the provider and the answer is lost
    await cancel(s, hash);
    assert.equal(s.guards!.standins.fakes.payments.refunds().length, 1, "the provider did it");
    assert.equal((await s.status()).refunds.needBuilder.total, 1, "the shop does not know");
    const before = refundCalls(s).length;
    assert.equal((await s.call("/internal/recover", { body: { id: "rec-r1", case: "b-1", action: "recheck_refund" } })).status, 200);
    await s.settle();
    assert.equal(refundCalls(s).length, before, "nothing is sent again");
    assert.ok(s.guards!.of("payments", "GET", /\/refunds$/u).length >= 1, "the payments service's own list was read");
    assert.deepEqual((await s.status()).refunds, { waitingForOwner: 0, beingSentAgain: 0, needBuilder: { total: 0 } });
    assert.equal(s.guards!.standins.fakes.payments.refunds().length, 1);
  });
});

describe("the month's allowance of model reads", () => {
  contract("with an allowance of two, the third message that needs a model is read by the rules and the buttons: the model is asked twice", async () => {
    const fake = await startFakeModel(() => ({ kind: "book", language: "en", serviceId: "facial", offerInr: null, date: null, time: null, overrideAttempt: false })); models.push(fake);
    const s = await boot({ modelPort: fake.port, runtime: { allowance: { messages: 2 } } });
    for (let i = 0; i < 4; i++) { const g = s.guest(); await s.chat(g.hash, "something nice for my hair please", { id: `al-${i}` }); }
    assert.equal(fake.calls, 2, "two reads, then no more");
    const ai = (await s.status()).ai;
    assert.equal(ai.messages.model, 2);
    assert.equal(ai.allowance.messages, 2);
    assert.equal((await s.status()).tasks.failed, 0);
  });
});

describe("units of a resource", () => {
  contract("a shop with two chairs holds two customers for one time and tells the third it is taken", async () => {
    const s = await boot({ settings: { ...UPI, resources: { shop: 2 } } });
    const start = s.now() + 26 * 3_600_000;
    const day = new Date(start);
    const at = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 5, 30)).getTime(); // 11:00 in India that day
    const asked = [] as { hash: string }[];
    for (const [i, phone] of ["+919811111111", "+919822222222", "+919833333333"].entries()) asked.push(await s.book({ startMs: at, name: `Guest ${i}`, phone }));
    const statuses = [] as string[];
    for (const a of asked) statuses.push((await s.request(a.hash)).body.status);
    assert.deepEqual(statuses.slice().sort(), ["held", "held", "not_held"].sort(), `${statuses}`);
  });
});

describe("the owner's sign-in link on WhatsApp", () => {
  contract("a request on the page sends the link to the owner's number once; the link opens a session once; the session opens the owner's page", async () => {
    const s = await boot({ mode: "guards" });
    assert.equal((await s.channelEvents([{ kind: "owner_signin", id: "si-1" }])).status, 200); await s.settle();
    const toOwner = s.guards!.of("messaging", "POST").filter((c) => c.body.to === OWNER_NUMBER);
    assert.equal(toOwner.length, 1, "one message to the owner's number");
    const text = JSON.stringify(toOwner[0].body);
    const found = new RegExp(`${OWNER_BASE.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}/[A-Za-z0-9/_-]*?([A-Za-z0-9_-]{20,})`, "u").exec(text);
    assert.ok(found, text);
    const token = found![1];
    const read = await s.call("/internal/channel/owner-signin", { headers: { "x-owner-signin": token } });
    assert.equal(read.body.state, "valid", JSON.stringify(read.body));
    const used = await s.call("/internal/channel/owner-signin", { method: "POST", headers: { "x-owner-signin": token }, body: {} });
    assert.equal(used.status, 200, JSON.stringify(used.body));
    assert.equal((await s.call("/internal/channel/owner", { session: used.body.session })).status, 200);
    const again = await s.call("/internal/channel/owner-signin", { method: "POST", headers: { "x-owner-signin": token }, body: {} });
    assert.equal(again.status, 403);
    assert.equal(again.body.state, "used");
    assert.equal((await s.call("/internal/channel/owner-signin", { headers: { "x-owner-signin": "x".repeat(30) } })).body.state, "unknown");
  });
});
