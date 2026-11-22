// RECOVERY (group (vi) of the contract, README.md): a Guard that is down while a customer orders or pays, the process killed in the middle of a step, the panel's to-do list
// asking the shop to look again, a shop put back from last night's snapshot. What must hold in every one: nothing is told or sent twice, nothing the provider already did is
// done again (the shop looks first, by the order's id), a payment that arrived while WhatsApp was down still confirms the order once, and no step is lost. A "guards" shop
// against the fake Guards (guards.ts), which can be made down, slow, or to lose a reply. Expected values from test/guard-outage, runtime and the situations.
import { after, describe } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CUSTOMER, contract, makeShop, sleep } from "./harness.ts";
import type { Shop } from "./harness.ts";

const shops: Shop[] = [];
after(async () => { for (const s of shops) { await s.stop(); await s.cleanup(); } });
async function boot(o: Parameters<typeof makeShop>[0] = {}): Promise<Shop> { const s = await makeShop({ mode: "guards", ...o }); shops.push(s); await s.start(); return s; }
const link = (s: Shop, n = 0) => s.guards!.standins.fakes.payments.links()[n];
async function until(what: string, done: () => boolean | Promise<boolean>, seconds = 40): Promise<void> {
  for (let i = 0; i < seconds * 4; i++) { if (await done()) return; await sleep(250); }
  throw new Error(`gave up waiting for: ${what}`);
}
const deliver = (s: Shop, list: unknown[]) => s.events(list.map((event) => ({ kind: "payment_event", event })));
const SIGKILL = (s: Shop) => process.kill(s.pid()!, "SIGKILL");

describe("a Guard that is down", () => {
  contract("the payments Guard down while a customer orders from the page: the request waits, and when it is back there is one link and one answer", async () => {
    const s = await boot();
    s.guards!.payments.down();
    const { hash, answer } = await s.order({ wait: false });
    assert.equal(answer.status, 200, "the request was saved before anything else");
    await sleep(1500);
    const st = await s.status();
    assert.equal(st.tasks.pending, 1, JSON.stringify(st));
    assert.ok(st.waitingForGuard !== null && st.waitingForGuard !== undefined, "the status says it waits for a Guard");
    assert.equal(st.tasks.failed, 0);
    assert.equal(link(s), undefined);
    s.guards!.payments.up();
    await until("the request to be answered", async () => (await s.status()).tasks.pending === 0);
    assert.equal(s.guards!.standins.fakes.payments.links().length, 1, "one link");
    const view = (await s.request(hash)).body;
    assert.equal(view.status, "held");
    assert.equal(view.messages.length, 1, "one answer");
  });

  contract("a Guard a person stopped on purpose (the kill switch) is not waited for: the step ends, nothing is held, and the owner is told the link could not be made", async () => {
    const s = await boot();
    s.guards!.payments.stopped();
    const { hash } = await s.order();
    const st = await s.status();
    assert.equal(st.tasks.pending, 0);
    assert.equal(st.waitingForGuard, null);
    assert.equal(link(s), undefined);
    assert.notEqual((await s.request(hash)).body.status, "held");
  });

  contract("the WhatsApp Guard down when the payment comes in: the order is confirmed once and the customer told once when it is back", async () => {
    const s = await boot();
    const day = s.orderDay();
    await s.inbound(CUSTOMER, `2 veg thali ${day.words} 12:00 pm pickup`);
    s.guards!.messaging.down();
    assert.equal((await deliver(s, s.guards!.pay(link(s).id))).status, 200, "the webhook is saved even now");
    await sleep(1500);
    s.guards!.messaging.up();
    await until("the confirmation", () => s.sent(CUSTOMER).some((m) => /^Confirmed!/u.test(m.text)));
    await s.settle(); await sleep(2500);
    assert.equal(s.sent(CUSTOMER).filter((m) => /^Confirmed!/u.test(m.text)).length, 1, "told once");
    assert.deepEqual((await s.status()).orders, { confirmed: 1 });
    assert.equal(s.record().filter((r) => r.action === "confirm_order").length, 1);
  });
});

describe("the process is killed in the middle of a step", () => {
  contract("killed while the link is being made: the restarted shop finds the link the first try made, by the order's id, and makes no second", async () => {
    const s = await boot();
    s.guards!.payments.delay(2500, { times: 1, match: (c) => c.method === "POST" && c.path === "/v1/payment_links" });
    const { hash } = await s.order({ id: "req-kill", wait: false });
    await until("the link request to be on its way", () => s.guards!.of("payments", "POST", /^\/v1\/payment_links$/u).length === 1, 10);
    SIGKILL(s);
    await until("the provider to have made the link", () => s.guards!.standins.fakes.payments.links().length === 1, 15);
    await s.start();
    await until("the request to be answered", async () => (await s.status()).tasks.pending === 0, 40);
    assert.equal(s.guards!.standins.fakes.payments.links().length, 1, "one link");
    const view = (await s.request(hash)).body;
    assert.equal(view.status, "held");
    assert.deepEqual(view.pay, { kind: "link", url: link(s).pay_url });
  });

  contract("a reply the provider never answered is looked for before it is tried again: one link", async () => {
    const s = await boot();
    s.guards!.payments.loseReply({ times: 1, match: (c) => c.method === "POST" && c.path === "/v1/payment_links" });
    const { hash } = await s.order({ wait: false });
    await until("the request to be answered", async () => (await s.status()).tasks.pending === 0, 40);
    assert.equal(s.guards!.standins.fakes.payments.links().length, 1);
    assert.equal((await s.request(hash)).body.status, "held");
    assert.equal(s.guards!.of("payments", "POST", /^\/v1\/payment_links$/u).length, 1, "asked once: the lost answer was looked for");
    assert.ok(s.guards!.of("payments", "GET", /^\/v1\/payment_links$/u).some((c) => c.query.reference_id === "o-1"), "by the order's id");
  });

  contract("an order held before a restart is still held after it, and its payment confirms it", async () => {
    const s = await boot();
    const { hash } = await s.order();
    await s.stop(); await s.start();
    assert.equal((await s.request(hash)).body.status, "held");
    await deliver(s, s.guards!.pay(link(s).id)); await s.settle();
    assert.equal((await s.request(hash)).body.status, "confirmed");
  });
});

describe("the panel's to-do list asks the shop to look again", () => {
  contract("recheck_payment: a payment the webhook never brought is found in the payments service's own list and confirms the order, once", async () => {
    const s = await boot();
    const { hash } = await s.order();
    s.guards!.pay(link(s).id); // paid; the webhook was lost
    assert.equal((await s.request(hash)).body.status, "held");
    const asked = await s.call("/internal/recover", { body: { id: "rec-1", case: "o-1", action: "recheck_payment" } });
    assert.deepEqual([asked.status, asked.body.saved], [200, 1]);
    await s.settle();
    assert.equal((await s.request(hash)).body.status, "confirmed");
    await s.call("/internal/recover", { body: { id: "rec-2", case: "o-1", action: "recheck_payment" } }); await s.settle();
    assert.deepEqual((await s.status()).orders, { confirmed: 1 });
    assert.equal(s.record().filter((r) => r.action === "record_payment" && r.outcome === "confirmed").length, 1, "nothing counted twice");
  });

  contract("an action that does not fit the order, an unknown action and an order that is not there are refused in the record and change nothing", async () => {
    const s = await boot();
    const { hash } = await s.order();
    const calls = s.guards!.calls.length;
    for (const [id, c, action] of [["r-1", "o-1", "recheck_refund"], ["r-2", "o-1", "no_such_action"], ["r-3", "o-77", "recheck_payment"], ["r-4", "o-1", "ask_owner_again"]]) {
      assert.equal((await s.call("/internal/recover", { body: { id, case: c, action } })).status, 200);
    }
    await s.settle();
    assert.equal((await s.request(hash)).body.status, "held");
    assert.ok(s.record().filter((r) => r.refs.recovery !== undefined && r.outcome === "blocked").length >= 3);
    assert.equal(s.guards!.calls.slice(calls).filter((c) => c.method !== "GET").length, 0, "nothing was written anywhere");
  });
});

describe("a shop put back from last night's snapshot", () => {
  contract("a new order after the restore takes an id no order used after the snapshot", async () => {
    const s = await boot();
    await s.order();                                        // o-1, before the snapshot
    await s.stop();
    cpSync(s.dataDir, `${s.dataDir}-snapshot`, { recursive: true });
    await s.start();
    await s.order({ phone: "+919822222222" });              // o-2, after it
    await s.stop();
    rmSync(s.dataDir, { recursive: true, force: true });
    cpSync(`${s.dataDir}-snapshot`, s.dataDir, { recursive: true });
    writeFileSync(join(s.dataDir, "restored.json"), JSON.stringify({ snapshot: "20261119T013000Z", restoredAt: new Date().toISOString(), lastSeq: null }));
    await s.start();
    const third = await s.order({ phone: "+919833333333" });
    const view = (await s.request(third.hash)).body;
    assert.equal(view.ref, "o-100002", "every counter moved on by 100000");
    assert.equal(view.status, "held");
    assert.equal(s.record().filter((r) => r.action === "restored").length, 1);
    assert.ok(!existsSync(join(s.dataDir, "restored.json")));
    assert.ok(readdirSync(s.dataDir).some((f) => f.startsWith("restored.json.done-")));
    const refs = s.guards!.standins.fakes.payments.links().map((l) => l.reference_id);
    assert.equal(new Set(refs).size, refs.length, `every link has its own order: ${refs.join(",")}`);
  });
});
