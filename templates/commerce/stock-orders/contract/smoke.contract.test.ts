// The smoke of the Stock orders contract (group S, README.md): a shop starts from the folder the deployer writes and answers /healthz, /readyz and /status (orders counted by state,
// never a word); every credentialed route refuses a missing or wrong token; the routes a Stock orders shop must NOT have are 404 (it has no customers, no listings, no payments);
// the events route checks what it is given; a folder the runtime refuses (no WhatsApp, another pathway version, settings that do not read) is refused in a sentence; and the
// shop's data survives a stop and a start. Nothing here may be TypeScript only.
import { after, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OWNER, contract, makeShop, orderAndApprove, shops } from "./harness.ts";

const made = shops();
after(async () => { for (const s of made.all) { await s.stop(); await s.cleanup(); } });

describe("the shop answers and refuses", () => {
  contract("/healthz and /readyz need no token; /status counts only, with orders by state, and needs the inbox's token", async () => {
    const s = await made.boot();
    assert.deepEqual((await s.call("/healthz", { token: null })).body, { ok: true });
    const ready = await s.call("/readyz", { token: null });
    assert.equal(ready.status, 200); assert.equal(ready.body.ok, true);
    for (const token of [null, "wrong", s.channel]) assert.equal((await s.call("/status", { token })).status, 401);
    const st = await s.status();
    assert.deepEqual(st.tasks, { pending: 0, done: 0, failed: 0 });
    assert.deepEqual(st.orders, {});
    assert.equal(typeof st.version, "string");
    await s.ownerSays("order 10 boxes of hair colour from Ravi Traders");
    assert.deepEqual((await s.status()).orders, { awaiting_approval: 1 });
    assert.ok(!JSON.stringify(await s.status()).includes("hair colour"), "no words of a message in the status");
  });

  contract("every credentialed route refuses no token, a wrong token and the other token", async () => {
    const s = await made.boot();
    for (const [method, path] of [["POST", "/internal/events"], ["POST", "/internal/recover"], ["GET", "/internal/limit-changes"]] as const) {
      for (const token of [null, "wrong", s.channel]) assert.equal((await s.call(path, { method, token, ...(method === "POST" ? { body: {} } : {}) })).status, 401, `${method} ${path} with ${String(token)}`);
    }
    for (const path of ["/internal/channel/owner", "/internal/channel/offer"]) {
      for (const token of [null, "wrong", s.internal]) assert.equal((await s.call(path, { token })).status, 401, `${path} with ${String(token)}`);
    }
  });

  contract("the owner's page refuses a stranger and a wrong link, and opens with the owner's link", async () => {
    const s = await made.boot();
    assert.equal((await s.call("/internal/channel/owner")).status, 403);
    assert.equal((await s.call("/internal/channel/owner", { owner: "not-the-link" })).status, 403);
    assert.equal((await s.call("/internal/channel/owner", { session: "made-up" })).status, 403);
    const own = await s.ownerView();
    assert.equal(own.status, 200);
    assert.equal(own.body.kind, "stock");
    assert.equal(own.body.shop.name, "Glow Unisex Salon");
    assert.deepEqual(own.body.items, []);
  });

  contract("a method that is not the route's is 405, an unknown path 404, and the routes of a booking, listings or Fees shop are 404 here", async () => {
    const s = await made.boot();
    assert.equal((await s.call("/healthz", { method: "POST", token: null, body: {} })).status, 405);
    assert.equal((await s.call("/status", { method: "POST", body: {} })).status, 405);
    assert.equal((await s.call("/nothing-here")).status, 404);
    for (const [m, p] of [["GET", "/internal/channel/listings"], ["GET", "/internal/channel/owner-listing"], ["POST", "/internal/channel/shop-feed"], ["POST", "/internal/channel/owner-photo"], ["GET", "/internal/channel/parent?link=" + "a".repeat(64)], ["GET", "/internal/channel/owner-stock"]] as const) {
      assert.equal((await s.call(p, { method: m, owner: s.owner, ...(m === "POST" ? { body: {} } : {}) })).status, 404, `${m} ${p}`);
    }
    assert.equal((await s.call("/internal/channel/request?handle=" + "a".repeat(64))).status, 404, "no customer requests");
    assert.equal((await s.call("/internal/refund-context?receipt=po-1:pay_x")).status, 404, "no refunds held");
    assert.equal((await s.call("/internal/feed-notice")).status, 204);
    const offer = await s.call("/internal/channel/offer");
    assert.equal(offer.status, 200);
    assert.deepEqual(offer.body, { kind: "stock", shop: { name: "Glow Unisex Salon" } }, "the public offer names the shop only");
  });

  contract("/internal/events is checked whole: a bad event refuses all, a repeated id is a no-op, a tick is refused", async () => {
    const s = await made.boot();
    assert.equal((await s.events([])).status, 400);
    assert.equal((await s.events([{ kind: "tick" }])).status, 400);
    assert.equal((await s.events([{ kind: "message", message: { id: "m-1", from: OWNER, text: "status", timestamp: Date.now() } }, { kind: "nonsense" }])).status, 400);
    const one = { kind: "message", message: { id: "m-2", from: OWNER, text: "status", timestamp: Date.now() } };
    const a = await s.events([one]);
    assert.equal(a.status, 200); assert.deepEqual(a.body, { saved: 1, duplicates: 0 });
    const b = await s.events([one]);
    assert.deepEqual(b.body, { saved: 0, duplicates: 1 });
    await s.settle();
  });
});

describe("the folder", () => {
  contract("a live shop whose runtime.json names no WhatsApp does not start, and says so in a sentence", async () => {
    const s = await makeShop({ noWhatsApp: true }); made.all.push(s);
    await assert.rejects(s.start(), /messaging|WhatsApp/iu);
  });

  contract("a folder pinned to another version of the pathway is refused", async () => {
    const s = await makeShop(); made.all.push(s);
    writeFileSync(join(s.client, "pathway.lock"), "stock-orders@9.9.9\n");
    await assert.rejects(s.start(), /9\.9\.9|version/iu);
  });

  contract("settings that do not read are refused with every problem in plain words", async () => {
    const s = await makeShop({ settings: { limits: { maxPerOrderInr: 30000, monthlyBudgetInr: 20000 }, suppliers: [{ id: "x", name: "X", whatsapp: "not a number", language: "en", approved: true }] } }); made.all.push(s);
    await assert.rejects(s.start(), /order limit|budget|number/iu);
  });

  contract("the orders, the counter and the record survive a stop and a start", async () => {
    const s = await made.boot();
    await orderAndApprove(s);
    await s.stop(); await s.start();
    assert.deepEqual((await s.status()).orders, { sent: 1 });
    await s.ownerSays("order 12 shampoo from ravi");
    assert.ok(s.order("po-2"), "the next order is po-2: the counter was saved");
    assert.equal(s.saved().seq, 2);
    assert.equal(s.orderMessagesTo("+919876500001").length, 1, "the order went once, across the restart");
    assert.ok(readFileSync(join(s.dataDir, "agent.db")).length > 0);
  });
});
