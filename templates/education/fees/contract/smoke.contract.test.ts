// The smoke of the Fees contract: a centre starts from the folder the deployer writes and answers /healthz, /readyz and /status (counts only: `fees`, never a name or a number);
// every kind of route refuses a missing or wrong credential; the routes a Fees centre must NOT have (listings, stock) are 404; the centre's page says what it is; the inbox's and
// the panel's requests are checked whole and saved once; a folder the runtime refuses says so in a sentence; a live centre refuses the test clock and calls no Guard at start.
// Ports to Go: nothing here may be TypeScript-only.
import { after, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROHAN, SHARMA, contract, makeCentre } from "./harness.ts";
import type { Centre, CentreOptions } from "./harness.ts";

const centres: Centre[] = [];
after(async () => { for (const c of centres) await c.cleanup(); });
async function boot(o: CentreOptions = {}): Promise<Centre> { const c = await makeCentre(o); centres.push(c); await c.start(); return c; }

describe("the centre answers and refuses", () => {
  contract("/healthz and /readyz need no token; /status counts only, names its cases `fees`, and needs the inbox's token", async () => {
    const c = await boot({ tickSeconds: 3600 });
    assert.deepEqual((await c.call("/healthz", { token: null })).body, { ok: true });
    const ready = await c.call("/readyz", { token: null });
    assert.equal(ready.status, 200); assert.equal(ready.body.ok, true);
    for (const token of [null, "wrong", c.channel]) assert.equal((await c.call("/status", { token })).status, 401);
    const st = await c.call("/status");
    assert.equal(st.status, 200);
    assert.equal(st.body.pathway, "fees");
    assert.deepEqual(st.body.fees, {});
    assert.equal("bookings" in st.body, false);
    assert.deepEqual(st.body.tasks, { pending: 0, done: 0, failed: 0 });
    assert.deepEqual(st.body.refunds, { waitingForOwner: 0, beingSentAgain: 0, needBuilder: { total: 0 } });
    assert.equal(st.body.ownerAccess.passkeys, 0);
  });

  contract("every credentialed route refuses no token, a wrong token and the other token", async () => {
    const c = await boot({ tickSeconds: 3600 });
    const inbox: [string, string][] = [["POST", "/internal/events"], ["POST", "/internal/recover"], ["GET", "/internal/refund-context?receipt=f-1:pay_x"], ["GET", "/internal/owner-session"], ["GET", "/internal/limit-changes"]];
    for (const [method, path] of inbox) for (const token of [null, "wrong", c.channel]) assert.equal((await c.call(path, { method, token, ...(method === "POST" ? { body: {} } : {}) })).status, 401, `${method} ${path} with ${String(token)}`);
    const h = "a".repeat(64);
    for (const path of ["/internal/channel/offer", `/internal/channel/request?handle=${h}`, `/internal/channel/parent?link=${h}`, `/internal/channel/chat?handle=${h}`, "/internal/channel/owner", `/internal/channel/documents?link=${h}`]) {
      for (const token of [null, "wrong", c.internal]) assert.equal((await c.call(path, { token })).status, 401, `${path} with ${String(token)}`);
    }
  });

  contract("a wrong method is 405, an unknown path 404, and the owner's routes refuse a stranger", async () => {
    const c = await boot({ tickSeconds: 3600 });
    assert.equal((await c.call("/healthz", { method: "POST", token: null, body: {} })).status, 405);
    assert.equal((await c.call("/status", { method: "POST", body: {} })).status, 405);
    assert.equal((await c.call("/nothing-here")).status, 404);
    assert.equal((await c.call("/internal/channel/nothing")).status, 404);
    for (const path of ["/internal/channel/owner", "/internal/channel/owner-limits"]) {
      assert.equal((await c.call(path)).status, 403, `${path} with no credential`);
      assert.equal((await c.call(path, { owner: "not-the-link" })).status, 403);
      assert.equal((await c.call(path, { session: "made-up" })).status, 403);
    }
    assert.equal((await c.call("/internal/channel/accounting?period=2026-11", { owner: c.owner })).status, 403, "the panel's link does not open the accountant's files: a session only");
    assert.equal((await c.ownerView()).status, 200);
  });

  contract("the routes of a listings or stock shop are not here (404); a parent link no one has is 404, a bad one 400; no feed notice", async () => {
    const c = await boot({ tickSeconds: 3600 });
    for (const [m, p] of [["GET", "/internal/channel/listings"], ["GET", "/internal/channel/owner-listing"], ["GET", "/internal/channel/owner-stock"], ["POST", "/internal/channel/shop-feed"], ["POST", "/internal/channel/owner-photo"]] as const) {
      assert.equal((await c.call(p, { method: m, owner: c.owner, ...(m === "POST" ? { body: {} } : {}) })).status, 404, `${m} ${p}`);
    }
    assert.equal((await c.parent("a".repeat(64))).status, 404);
    assert.equal((await c.parent("not-a-hash")).status, 400);
    assert.equal((await c.call(`/internal/channel/material?link=${"a".repeat(64)}&batch=class-10`)).status, 404, "a centre without Classes has no material");
    assert.equal((await c.request("a".repeat(64))).status, 404, "a confirmation page nobody made");
    assert.equal((await c.call("/internal/feed-notice")).status, 204);
  });

  contract("the centre's page says what it is: its name, address, languages and that a UPI centre's parents pay its own UPI ID; never a fee or a student", async () => {
    const c = await boot({ tickSeconds: 3600 });
    const offer = await c.call("/internal/channel/offer");
    assert.equal(offer.status, 200);
    assert.equal(offer.body.kind, "fees");
    assert.equal(offer.body.shop.name, "Bright Tuition Centre (UPI)");
    assert.equal(offer.body.shop.address, "4 Temple Road, Thrissur");
    assert.deepEqual(offer.body.shop.languages, ["hi", "en", "ml", "kn"]);
    assert.deepEqual(offer.body.shop.payment, { kind: "upi", payee: "Bright Tuition" });
    assert.equal(offer.body.shop.paused, false);
    const text = JSON.stringify(offer.body);
    for (const secret of ["Aarav", "Rohan", SHARMA, "brighttuition@oksbi", "1800"]) assert.ok(!text.includes(secret), `${secret} is not on the centre's page`);
  });

  contract("a Razorpay centre's page says parents pay by a link", async () => {
    const c = await boot({ tickSeconds: 3600, example: "razorpay" });
    assert.deepEqual((await c.call("/internal/channel/offer")).body.shop.payment, { kind: "link" });
  });
});

describe("the inbox's and the panel's requests", () => {
  contract("a message is saved before the 200, a repeat is a no-op, and the data survives a stop and a start", async () => {
    const c = await boot({ tickSeconds: 3600 });
    const msg = { kind: "message", message: { id: "wamid.once", from: ROHAN, text: "hello", timestamp: c.now() } };
    const first = await c.events([msg]);
    assert.deepEqual([first.status, first.body.saved, first.body.duplicates], [200, 1, 0]);
    const st = await c.settle();
    assert.deepEqual(st.tasks, { pending: 0, done: 1, failed: 0 }, "the step ran and was done");
    assert.ok(c.record().some((l) => l.action === "receive_message" && l.conversation === ROHAN), "the message is in the record");
    assert.deepEqual((await c.events([msg])).body.duplicates, 1);
    await c.stop();
    assert.ok(existsSync(join(c.dataDir, "agent.db")));
    await c.start();
    assert.deepEqual((await c.status()).tasks, st.tasks);
    assert.equal((await c.events([msg])).body.duplicates, 1, "remembered after the restart");
  });

  contract("a body the runtime cannot take is refused whole: not JSON, no events, 101 events, one bad among good, too big", async () => {
    const c = await boot({ tickSeconds: 3600 });
    assert.equal((await c.call("/internal/events", { raw: new TextEncoder().encode("not json"), type: "application/json" })).status, 400);
    assert.equal((await c.events([])).status, 400);
    const good = (i: number) => ({ kind: "message", message: { id: `wamid.m${i}`, from: ROHAN, text: "hi", timestamp: c.now() } });
    assert.equal((await c.events(Array.from({ length: 101 }, (_, i) => good(i)))).status, 400);
    assert.equal((await c.events([good(1), { kind: "message", message: { id: "wamid.bad" } }])).status, 400);
    const st = await c.status();
    assert.equal(st.tasks.pending + st.tasks.done, 0, "nothing of a refused request was saved");
    assert.equal((await c.call("/internal/events", { body: { events: [{ kind: "message", message: { id: "wamid.big", from: ROHAN, text: "x".repeat(300_000), timestamp: c.now() } }] } })).status, 413);
    for (const event of [{ kind: "recovery", id: "r-2", case: "f-1", action: "recheck_payment" }, { kind: "tick" }, { kind: "owner_message", id: "x-1", text: "hi" }]) assert.equal((await c.events([event])).status, 400, JSON.stringify(event));
  });

  contract("a recovery request is checked whole and saved once; one for a fee that is not there is refused in the record", async () => {
    const c = await boot({ tickSeconds: 3600 });
    assert.equal((await c.call("/internal/recover", { body: { id: "r-1", case: "f-1" } })).status, 400);
    const ok = await c.call("/internal/recover", { body: { id: "r-1", case: "f-9", action: "recheck_payment" } });
    assert.deepEqual([ok.status, ok.body.saved, ok.body.duplicates], [200, 1, 0]);
    assert.deepEqual((await c.call("/internal/recover", { body: { id: "r-1", case: "f-9", action: "recheck_payment" } })).body.duplicates, 1);
    await c.settle();
    const line = c.record().find((l) => l.refs.recovery === "r-1");
    assert.ok(line, "the recovery is in the record");
    assert.equal(line!.outcome, "blocked");
    assert.match(line!.notes, /no fee has this id/u);
  });

  contract("the refund context needs a receipt (400) and answers 404 when no refund is held under it", async () => {
    const c = await boot({ tickSeconds: 3600 });
    assert.equal((await c.call("/internal/refund-context")).status, 400);
    assert.equal((await c.call("/internal/refund-context?receipt=f-1:pay_x")).status, 404);
  });

  contract("a status report from WhatsApp is saved once by its ids and kind; a malformed one is refused", async () => {
    const c = await boot({ tickSeconds: 3600 });
    const status = (o: Record<string, unknown>) => ({ kind: "message_status", status: { ids: ["wamid.out_1"], status: "delivered", timestamp: c.now(), ...o } });
    assert.deepEqual((await c.events([status({})])).body.saved, 1);
    assert.deepEqual((await c.events([status({})])).body.duplicates, 1);
    for (const bad of [{ ids: [] }, { status: "seen" }, { timestamp: "now" }]) assert.equal((await c.events([status(bad)])).status, 400, JSON.stringify(bad));
    await c.settle();
    assert.equal((await c.status()).tasks.failed, 0);
  });
});

describe("a folder the runtime cannot run, and a live centre", () => {
  contract("a folder pinned to another version or pathway does not start and says why in a sentence", async () => {
    const c = await makeCentre({ tickSeconds: 3600 }); centres.push(c);
    writeFileSync(join(c.client, "pathway.lock"), "fees@99.0.0\n");
    await assert.rejects(c.start(), /99\.0\.0|version|pinned/iu);
    writeFileSync(join(c.client, "pathway.lock"), "bookings@0.1.0\n");
    await assert.rejects(c.start(), /bookings|fees|pathway/iu);
  });

  contract("settings the template refuses stop the start with the template's own sentence", async () => {
    const c = await makeCentre({ tickSeconds: 3600 }); centres.push(c);
    writeFileSync(join(c.client, "settings.json"), JSON.stringify({ ...c.settings, due: { day: 31, graceDays: 5 } }));
    await assert.rejects(c.start(), /due day \("due\.day"\) must be between 1 and 28, not 31/u);
  });

  contract("a live centre refuses to start on a test clock, and does not listen", async () => {
    const c = await makeCentre({ mode: "guards", forceClock: true }); centres.push(c);
    await assert.rejects(c.start(), /fakes|test clock/iu);
    await assert.rejects(fetch(`http://127.0.0.1:${c.port}/healthz`));
  });

  contract("a live Razorpay centre starts with its Guards named, calls none at start, and is ready", async () => {
    const c = await boot({ mode: "guards", example: "razorpay", tickSeconds: 3600 });
    assert.equal((await c.call("/readyz", { token: null })).status, 200);
    assert.deepEqual(c.guards!.calls, [], "no call to a Guard at start");
  });
});
