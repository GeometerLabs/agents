// The smoke of the Bookings contract: a shop starts from the folder the deployer writes and answers /healthz, /readyz and /status; every kind of route refuses a missing or wrong
// credential; the routes a Bookings shop must NOT have (listings, stock, parents) are 404; the owner's routes refuse a stranger; a recovery request is checked and saved; a start from
// a folder the runtime refuses says so in a sentence and does not listen; and the shop's data survives a stop and a start. It also checks that a Guards-mode shop starts against the fake Guards and
// reads nothing from them until a customer asks, and that a live shop refuses the test clock. Ports to Go: nothing here may be TypeScript-only.
import { after, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CUSTOMER, contract, makeShop } from "./harness.ts";
import type { Shop } from "./harness.ts";

const shops: Shop[] = [];
after(async () => { for (const s of shops) { await s.stop(); await s.cleanup(); } });
async function boot(o: Parameters<typeof makeShop>[0] = {}): Promise<Shop> { const s = await makeShop(o); shops.push(s); await s.start(); return s; }

describe("the shop answers and refuses", () => {
  contract("/healthz and /readyz need no token; /status counts only and needs the inbox's token", async () => {
    const s = await boot();
    assert.deepEqual((await s.call("/healthz", { token: null })).body, { ok: true });
    const ready = await s.call("/readyz", { token: null });
    assert.equal(ready.status, 200); assert.equal(ready.body.ok, true);
    assert.equal((await s.call("/status", { token: null })).status, 401);
    assert.equal((await s.call("/status", { token: "wrong" })).status, 401);
    assert.equal((await s.call("/status", { token: s.channel })).status, 401, "the channel token is not the inbox's");
    const st = await s.call("/status");
    assert.equal(st.status, 200);
    assert.deepEqual(st.body.tasks, { pending: 0, done: 0, failed: 0 });
    assert.deepEqual(st.body.bookings, {});
    assert.equal(typeof st.body.version, "string");
    assert.deepEqual(st.body.ownerAccess.passkeys, 0);
  });

  contract("every credentialed route refuses no token, a wrong token and the other token", async () => {
    const s = await boot();
    const inbox: [string, string][] = [["POST", "/internal/events"], ["POST", "/internal/recover"], ["GET", "/internal/refund-context?receipt=b-1:pay_x"], ["GET", "/internal/owner-session"], ["GET", "/internal/limit-changes"]];
    for (const [method, path] of inbox) {
      for (const token of [null, "wrong", s.channel]) assert.equal((await s.call(path, { method, token, ...(method === "POST" ? { body: {} } : {}) })).status, 401, `${method} ${path} with ${String(token)}`);
    }
    const channel = ["/internal/channel/offer", "/internal/channel/request?handle=" + "a".repeat(64), "/internal/channel/chat?handle=" + "a".repeat(64), "/internal/channel/owner", "/internal/channel/documents?handle=" + "a".repeat(64)];
    for (const path of channel) {
      for (const token of [null, "wrong", s.internal]) assert.equal((await s.call(path, { token })).status, 401, `${path} with ${String(token)}`);
    }
  });

  contract("a method that is not the route's is 405 with allow, and an unknown path is 404", async () => {
    const s = await boot();
    const r = await s.call("/healthz", { method: "POST", token: null, body: {} });
    assert.equal(r.status, 405);
    assert.equal((await s.call("/status", { method: "POST", body: {} })).status, 405);
    assert.equal((await s.call("/nothing-here")).status, 404);
    assert.equal((await s.call("/internal/channel/nothing")).status, 404);
  });

  contract("the owner's routes refuse a stranger, a wrong link and a made-up session; /internal/owner-session says 403", async () => {
    const s = await boot();
    for (const path of ["/internal/channel/owner", "/internal/channel/owner-limits"]) {
      assert.equal((await s.call(path)).status, 403, `${path} with no credential`);
      assert.equal((await s.call(path, { owner: "not-the-link" })).status, 403);
      assert.equal((await s.call(path, { session: "made-up" })).status, 403);
    }
    assert.equal((await s.call("/internal/channel/accounting?period=2026-11", { owner: s.owner })).status, 403, "the panel's link does not open the accountant's files: a session only");
    assert.equal((await s.call("/internal/owner-session", { session: "made-up" })).status, 403);
    const own = await s.ownerView();
    assert.equal(own.status, 200, "the owner's own link opens the owner's page data");
  });

  contract("the routes of a listings, stock or Fees shop are not here: 404", async () => {
    const s = await boot();
    for (const [m, p] of [["GET", "/internal/channel/listings"], ["GET", "/internal/channel/owner-listing"], ["GET", "/internal/channel/owner-stock"], ["POST", "/internal/channel/shop-feed"], ["POST", "/internal/channel/owner-photo"], ["GET", "/internal/channel/parent?link=" + "a".repeat(64)], ["GET", "/internal/channel/material?link=" + "a".repeat(64) + "&batch=x"]] as const) {
      const r = await s.call(p, { method: m, owner: s.owner, ...(m === "POST" ? { body: {} } : {}) });
      assert.equal(r.status, 404, `${m} ${p}`);
    }
    assert.equal((await s.call("/internal/feed-notice")).status, 204, "no listings: no feed notice");
  });

  contract("a recovery request is checked whole and saved once; /internal/events refuses a recovery, a tick and a channel event", async () => {
    const s = await boot();
    assert.equal((await s.call("/internal/recover", { body: { id: "r-1", case: "b-1" } })).status, 400);
    assert.equal((await s.call("/internal/recover", { body: { id: "r 1", case: "b-1", action: "recheck_payment" } })).status, 400);
    const ok = await s.call("/internal/recover", { body: { id: "r-1", case: "b-9", action: "recheck_payment" } });
    assert.equal(ok.status, 200);
    assert.deepEqual([ok.body.saved, ok.body.duplicates], [1, 0]);
    const again = await s.call("/internal/recover", { body: { id: "r-1", case: "b-9", action: "recheck_payment" } });
    assert.deepEqual([again.body.saved, again.body.duplicates], [0, 1]);
    await s.settle();
    assert.ok(s.record().some((r) => r.booking === "b-9" || r.refs.recovery === "r-1"), "an action on a booking that is not there is refused in the record");
    for (const event of [{ kind: "recovery", id: "r-2", case: "b-1", action: "recheck_payment" }, { kind: "tick" }, { kind: "owner_message", id: "x-1", text: "hi" }]) {
      assert.equal((await s.events([event])).status, 400, JSON.stringify(event));
    }
  });
});

describe("what WhatsApp says later about a message the shop sent", () => {
  contract("a status report (delivered, read, failed) is saved once by its ids and kind, and a malformed one refuses the whole request", async () => {
    const s = await boot();
    const status = (o: Record<string, unknown>) => ({ kind: "message_status", status: { ids: ["wamid.out_1"], status: "delivered", timestamp: s.now(), ...o } });
    const first = await s.events([status({})]);
    assert.deepEqual([first.status, first.body.saved, first.body.duplicates], [200, 1, 0]);
    assert.deepEqual((await s.events([status({})])).body.duplicates, 1, "delivered twice is one");
    assert.deepEqual((await s.events([status({ status: "read" })])).body.saved, 1, "delivered and read are two");
    assert.equal((await s.events([status({ status: "failed", error: { code: 131047, title: "Re-engagement message" } })])).status, 200);
    await s.settle();
    for (const bad of [{ ids: [] }, { ids: ["a", "b", "c", "d"] }, { status: "seen" }, { timestamp: "now" }, { to: "98111" }, { status: "read", error: { code: 1 } }, { ids: ["bad id"] }]) {
      assert.equal((await s.events([status(bad)])).status, 400, JSON.stringify(bad));
    }
    assert.equal((await s.status()).tasks.failed, 0);
  });
});

describe("the shop keeps its data and refuses a folder it cannot run", () => {
  contract("a message is saved before the 200 is sent, a repeat of its id is a no-op, and the data survives a stop and a start", async () => {
    const s = await boot();
    const msg = { kind: "message", message: { id: "wamid.once", from: CUSTOMER, text: "hello", timestamp: s.now() } };
    const first = await s.events([msg]);
    assert.deepEqual([first.status, first.body.saved, first.body.duplicates], [200, 1, 0]);
    await s.settle();
    const dup = await s.events([msg]);
    assert.deepEqual([dup.body.saved, dup.body.duplicates], [0, 1]);
    const before = await s.status();
    await s.stop();
    assert.ok(existsSync(join(s.dataDir, "agent.db")), "the store is a file on disk");
    await s.start();
    const after = await s.status();
    assert.deepEqual(after.tasks, before.tasks, "the queue's counts are what they were");
    assert.equal((await s.events([msg])).body.duplicates, 1, "the message id is remembered after the restart");
  });

  contract("a body the runtime cannot take is refused whole: not JSON, no events, 101 events, one bad event among good ones, too big", async () => {
    const s = await boot();
    assert.equal((await s.call("/internal/events", { raw: new TextEncoder().encode("not json"), type: "application/json" })).status, 400);
    assert.equal((await s.events([])).status, 400);
    const good = (i: number) => ({ kind: "message", message: { id: `wamid.m${i}`, from: CUSTOMER, text: "hi", timestamp: s.now() } });
    assert.equal((await s.events(Array.from({ length: 101 }, (_, i) => good(i)))).status, 400);
    assert.equal((await s.events([good(1), { kind: "message", message: { id: "wamid.bad" } }])).status, 400);
    assert.equal((await s.status()).tasks.pending + (await s.status()).tasks.done, 0, "nothing of a refused request was saved");
    const big = { events: [{ kind: "message", message: { id: "wamid.big", from: CUSTOMER, text: "x".repeat(300_000), timestamp: s.now() } }] };
    assert.equal((await s.call("/internal/events", { body: big })).status, 413);
  });

  contract("a folder pinned to another version, or with a runtime.json it refuses, does not start and says why in a sentence", async () => {
    const s = await makeShop(); shops.push(s);
    writeFileSync(join(s.client, "pathway.lock"), "bookings@99.0.0\n");
    await assert.rejects(s.start(), /99\.0\.0|version|pinned/iu);
    writeFileSync(join(s.client, "pathway.lock"), "listings@0.1.0\n");
    await assert.rejects(s.start(), /listings|bookings|pathway/iu);
  });
});

describe("the test clock is for a fakes shop only", () => {
  contract("a shop in live mode (what the panel writes for every real shop) refuses to start on a test clock, and says so", async () => {
    const s = await makeShop({ mode: "guards", forceClock: true }); shops.push(s);
    await assert.rejects(s.start(), /fakes|test clock/iu);
    await assert.rejects(fetch(`http://127.0.0.1:${s.port}/healthz`), "and it is not listening");
  });
});

describe("a Guards shop starts against the fake Guards", () => {
  contract("in live mode the runtime starts with its Guards named, reads nothing from them yet, and is ready", async () => {
    const s = await boot({ mode: "guards" });
    assert.equal((await s.call("/readyz", { token: null })).status, 200);
    assert.deepEqual(s.guards!.calls, [], "the shop made no call to a Guard at start");
    const offer = await s.call("/internal/channel/offer");
    assert.equal(offer.status, 200);
    assert.equal(offer.body.shop.name, "Glow Salon");
    assert.deepEqual(offer.body.services.map((x: { id: string }) => x.id), ["haircut", "beard-trim", "facial", "hair-colour"]);
  });
});
