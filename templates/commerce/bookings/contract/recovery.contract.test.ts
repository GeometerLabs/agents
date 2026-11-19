// RECOVERY (group vi of the contract, README.md): a Guard that is down while a customer writes or pays, the process killed in the middle of a step, the panel's to-do list asking the
// shop to look again, a shop put back from last night's snapshot. What must hold in every one: nothing is told or sent twice, nothing the provider already did is done again (the
// shop looks first, by the booking's id), a payment that arrived while the calendar was down still confirms the booking once, and no step is lost. A "guards" shop against the fake
// Guards (guards.ts), which can be made down, slow, or to lose a reply. Expected values from test/guard-outage, runtime, recovery, last-slot, unknown-outcome, restored.
import { after, describe } from "node:test";
import assert from "node:assert/strict";
import { cpSync, rmSync } from "node:fs";
import { join } from "node:path";
import { contract, makeShop, openStart, sleep } from "./harness.ts";
import type { Shop } from "./harness.ts";

const shops: Shop[] = [];
after(async () => { for (const s of shops) { await s.stop(); await s.cleanup(); } });
async function boot(o: Parameters<typeof makeShop>[0] = {}): Promise<Shop> { const s = await makeShop({ mode: "guards", ...o }); shops.push(s); await s.start(); return s; }
const link = (s: Shop, n = 0) => s.guards!.standins.fakes.payments.links()[n];
const events = (s: Shop) => s.guards!.standins.fakes.calendar.events().filter((e) => e.bookingRef !== "foreign");
/** Poll until `done()` holds (a Guard that was down is looked at again after 2, 4, 8 ... seconds). */
async function until(what: string, done: () => boolean | Promise<boolean>, seconds = 40): Promise<void> {
  for (let i = 0; i < seconds * 4; i++) { if (await done()) return; await sleep(250); }
  throw new Error(`gave up waiting for: ${what}`);
}
const deliver = (s: Shop, list: unknown[]) => s.events(list.map((event) => ({ kind: "payment_event", event })));
const SIGKILL = (s: Shop) => process.kill(s.pid()!, "SIGKILL");

describe("a Guard that is down", () => {
  contract("the payments Guard down while a customer asks for a booking: nothing is said, and when it is back there is one hold, one link and one answer", async () => {
    const s = await boot();
    s.guards!.payments.down();
    const { hash, answer } = await s.book();
    assert.equal(answer.status, 200, "the request was saved before anything else");
    await sleep(1500);
    const st = await s.status();
    assert.equal(st.tasks.pending, 1, `the request waits: ${JSON.stringify(st)}\n${JSON.stringify(s.record().map((r) => [r.action, r.outcome]))}`);
    assert.ok(st.waitingForGuard !== null && st.waitingForGuard !== undefined, `the status says it waits for a Guard: ${JSON.stringify(st.waitingForGuard)}`);
    assert.equal(st.tasks.failed, 0);
    assert.equal(link(s), undefined);
    s.guards!.payments.up();
    await until("the request to be answered", async () => (await s.status()).tasks.pending === 0);
    assert.equal(events(s).length, 1, "the hold written before the outage is found again, not written twice");
    assert.equal(s.guards!.standins.fakes.payments.links().length, 1, "one link");
    const view = (await s.request(hash)).body;
    assert.equal(view.status, "held");
    assert.equal(view.messages.length, 1, "one answer");
  });

  contract("the calendar Guard down while a payment arrives: the deposit waits, and when it is back the booking is confirmed once and the customer told once", async () => {
    const s = await boot();
    const { hash } = await s.book();
    s.guards!.calendar.down();
    assert.equal((await deliver(s, s.guards!.pay(link(s).id))).status, 200, "the webhook is saved even now: the inbox is told 200 and the provider does not send it again");
    await sleep(1500);
    assert.equal((await s.request(hash)).body.status, "checking", "not confirmed while the calendar cannot say: the page says it is checking");
    assert.equal(s.guards!.of("calendar", "PATCH").filter((c) => c.status === 200).length, 0);
    s.guards!.calendar.up();
    await until("the booking to be confirmed", async () => (await s.request(hash)).body.status === "booked");
    await s.settle();
    assert.equal(s.guards!.of("calendar", "PATCH").filter((c) => c.status === 200 && c.body.status === "confirmed").length, 1, "confirmed once");
    const told = (await s.request(hash)).body.messages.filter((m: { text: string }) => /^You're booked!/u.test(m.text));
    assert.equal(told.length, 1, "told once");
  });

  contract("the WhatsApp Guard down: the shop's work is done and kept, the customer's replies wait, and the shop says nothing twice when it is back", async () => {
    const s = await boot();
    s.guards!.messaging.down();
    const at = Date.now();
    await s.inbound("+919811111111", "hello").catch(() => undefined);
    s.guards!.messaging.up();
    assert.ok(Date.now() - at < 60_000);
    await s.settle();
    assert.equal((await s.status()).tasks.failed, 0, "nothing was lost into a failed step");
  });
});

describe("the process is killed in the middle of a step", () => {
  contract("killed while the link is being made: the restarted shop finds the hold and the link the first try left, and makes no second of either", async () => {
    const s = await boot();
    // the link request reaches the provider after a pause; the process dies while it waits for the answer, and the provider makes the link anyway
    s.guards!.payments.delay(2500, { times: 1, match: (c) => c.method === "POST" && c.path === "/v1/payment_links" });
    const { hash } = await s.book({ id: "req-kill" });
    await until("the hold", () => events(s).length === 1, 10);
    SIGKILL(s);
    await until("the provider to have made the link", () => s.guards!.standins.fakes.payments.links().length === 1, 15);
    await s.start();
    await until("the request to be answered", async () => (await s.status()).tasks.pending === 0, 40);
    assert.equal(events(s).length, 1, "one hold");
    assert.equal(s.guards!.standins.fakes.payments.links().length, 1, "one link");
    const view = (await s.request(hash)).body;
    assert.equal(view.status, "held");
    assert.deepEqual(view.pay, { kind: "link", url: link(s).pay_url }, "the customer is given the link the first try made");
    assert.equal(s.tasks().filter((t) => t.kind === "channel_request" && t.state === "done").length, 1, JSON.stringify(s.tasks()));
  });

  contract("a request saved but not yet run when the shop dies is run when it starts again, once", async () => {
    const s = await boot();
    s.guards!.calendar.delay(2500, { times: 1, match: (c) => c.method === "POST" });
    const first = await s.book({ id: "req-a" });
    const second = await s.channelEvents([{ kind: "channel_request", id: "req-b", channel: "web", op: "book", handle: "b".repeat(64), serviceId: "beard-trim", startMs: openStart(Date.now(), 5), name: "Ravi", phone: "+919822222222", language: "en" }]);
    assert.equal(second.status, 200, "saved before the 200");
    SIGKILL(s);
    await s.start();
    await until("both to be done", async () => (await s.status()).tasks.pending === 0, 40);
    assert.equal((await s.status()).tasks.failed, 0);
    assert.equal((await s.request(first.hash)).body.status, "held");
    assert.ok(s.tasks().every((t) => t.state === "done"), JSON.stringify(s.tasks()));
    assert.equal(new Set(events(s).map((e) => e.bookingRef)).size, events(s).length, "no booking has two holds");
  });

  contract("a reply the provider never answered (it did it and the answer was lost) is looked for before it is tried again: one link", async () => {
    const s = await boot();
    s.guards!.payments.loseReply({ times: 1, match: (c) => c.method === "POST" && c.path === "/v1/payment_links" });
    const { hash } = await s.book();
    await until("the request to be answered", async () => (await s.status()).tasks.pending === 0, 40);
    assert.equal(s.guards!.standins.fakes.payments.links().length, 1, "the link made behind the lost answer is the one used");
    assert.equal((await s.request(hash)).body.status, "held");
    assert.equal(s.guards!.of("payments", "POST", /^\/v1\/payment_links$/u).length, 1, "the make was asked once: the lost answer was looked for, not asked again");
    assert.ok(s.guards!.of("payments", "GET", /^\/v1\/payment_links$/u).some((c) => c.query.reference_id === "b-1"), "by the booking's id");
  });
});

describe("the panel's to-do list asks the shop to look again", () => {
  contract("recheck_payment: a payment the webhook never brought is found in the payments service's own list and books the booking, once", async () => {
    const s = await boot();
    const { hash } = await s.book();
    s.guards!.pay(link(s).id); // the customer paid; the webhook was lost
    assert.equal((await s.request(hash)).body.status, "held");
    const asked = await s.call("/internal/recover", { body: { id: "rec-1", case: "b-1", action: "recheck_payment" } });
    assert.deepEqual([asked.status, asked.body.saved], [200, 1]);
    await s.settle();
    assert.equal((await s.request(hash)).body.status, "booked");
    assert.equal(s.guards!.of("calendar", "PATCH").filter((c) => c.body.status === "confirmed").length, 1);
    const again = await s.call("/internal/recover", { body: { id: "rec-2", case: "b-1", action: "recheck_payment" } });
    assert.equal(again.status, 200); await s.settle();
    assert.equal(s.guards!.of("calendar", "PATCH").filter((c) => c.body.status === "confirmed").length, 1, "nothing counted twice");
    assert.deepEqual((await s.status()).bookings, { confirmed: 1 });
    assert.equal(s.record().filter((r) => r.refs.recovery !== undefined).length >= 2, true, "each request is in the record");
  });

  contract("an action that does not fit the booking, an unknown action and a booking that is not there are refused in the record and change nothing", async () => {
    const s = await boot();
    const { hash } = await s.book();
    const calls = s.guards!.calls.length;
    for (const [id, c, action] of [["r-1", "b-1", "retry_booking"], ["r-2", "b-1", "no_such_action"], ["r-3", "b-77", "recheck_payment"], ["r-4", "b-1", "ask_owner_again"]]) {
      assert.equal((await s.call("/internal/recover", { body: { id, case: c, action } })).status, 200);
    }
    await s.settle();
    assert.equal((await s.request(hash)).body.status, "held");
    assert.ok(s.record().filter((r) => r.refs.recovery !== undefined && r.outcome === "blocked").length >= 3);
    assert.equal(s.guards!.calls.slice(calls).filter((c) => c.method !== "GET").length, 0, "nothing was written anywhere");
  });

  contract("retry_booking: a deposit is in and the calendar would not confirm; asked again with the calendar well, it confirms and only then is the customer told", async () => {
    const s = await boot({ tickSeconds: 1 });
    const { hash } = await s.book();
    s.guards!.calendar.answer({ status: 500, body: { error: { code: 500, message: "backend error" } } }, { match: (c) => c.method === "PATCH" });
    await deliver(s, s.guards!.pay(link(s).id));
    await sleep(2000); await s.settle();
    assert.notEqual((await s.request(hash)).body.status, "booked", "the calendar did not confirm: the customer is not told 'booked'");
    assert.equal((await s.status()).bookings.needs_owner ?? 0, 1, JSON.stringify(await s.status()));
    s.guards!.calendar.clear();                                   // the calendar is well again
    assert.equal((await s.call("/internal/recover", { body: { id: "rec-1", case: "b-1", action: "retry_booking" } })).status, 200);
    await s.settle();
    assert.equal((await s.request(hash)).body.status, "booked");
    assert.equal(s.guards!.of("calendar", "PATCH").filter((c) => c.status === 200 && c.body.status === "confirmed").length, 1);
    const toldBooked = (await s.request(hash)).body.messages.filter((m: { text: string }) => /^You're booked!/u.test(m.text));
    assert.equal(toldBooked.length, 1, `told once, and only now: ${JSON.stringify((await s.request(hash)).body.messages.map((m: { text: string }) => m.text))}`);
  });
});

describe("a shop put back from last night's snapshot", () => {
  contract("a new booking after the restore takes an id no booking used after the snapshot, so it never gets another customer's link or calendar event", async () => {
    const s = await boot();
    await s.book();                                        // b-1, before the snapshot
    await s.stop();
    cpSync(s.dataDir, `${s.dataDir}-snapshot`, { recursive: true });
    await s.start();
    await s.book({ name: "Ravi", phone: "+919822222222", startMs: openStart(Date.now(), 6) }); // b-2, after it: its hold and link exist at the Guards
    await s.stop();
    rmSync(s.dataDir, { recursive: true, force: true });
    cpSync(`${s.dataDir}-snapshot`, s.dataDir, { recursive: true });   // the restore: the shop has no memory of b-2
    await s.start();
    const third = await s.book({ name: "Meera", phone: "+919833333333", startMs: openStart(Date.now(), 7) });
    const view = (await s.request(third.hash)).body;
    assert.notEqual(view.ref, "b-2", "b-2 belongs to the customer the snapshot did not know");
    assert.equal(view.status, "held");
    const refs = events(s).map((e) => e.bookingRef);
    assert.equal(new Set(refs).size, refs.length, `every calendar event has its own booking: ${refs.join(",")}`);
  });
});

