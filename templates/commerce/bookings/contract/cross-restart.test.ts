// The TypeScript runtime and the Go runtime IN TURN on one shop folder, both ways: the store file (agent.db, its tables, the record, the queue) and the files beside it are the same,
// so a shop can move between the two runtimes and lose nothing (the rule of decision 61). It needs BOTH runtimes, so without the Go binary (go/bin/bookings, or
// BOOKINGS_GO_BIN) it is skipped and says so; with it, it runs whatever BOOKINGS_IMPL says. Like the listings contract's cross-restart.test.ts.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { REPO, makeShop } from "./harness.ts";
import type { Shop } from "./harness.ts";

const GO = process.env.BOOKINGS_GO_BIN ?? join(REPO, "go", "bin", "bookings");
const SKIP = existsSync(GO) ? undefined : "no Go Bookings runtime yet (wave 2): this test runs both runtimes on one folder";
const shops: Shop[] = [];
after(async () => { for (const s of shops) { await s.stop(); await s.cleanup(); } });

for (const [first, second] of [["ts", "go"], ["go", "ts"]] as const) {
  test(`a shop started on ${first} and moved to ${second} keeps its booking, its payment, its record and its queue, and goes on`, { skip: SKIP }, async () => {
    const s = await makeShop({ mode: "guards" }); shops.push(s);
    await s.start(first);
    const { hash } = await s.book();
    const link = s.guards!.standins.fakes.payments.links()[0];
    await s.events(s.guards!.pay(link.id).map((event) => ({ kind: "payment_event", event }))); await s.settle();
    assert.equal((await s.request(hash)).body.status, "booked");
    const record = s.record().map((r) => [r.action, r.outcome]);
    const tasks = (await s.status()).tasks;
    await s.stop();
    await s.start(second);
    assert.equal((await s.request(hash)).body.status, "booked", "the booking is there");
    assert.deepEqual(s.record().slice(0, record.length).map((r) => [r.action, r.outcome]), record, "the record is the same, line for line");
    assert.deepEqual((await s.status()).tasks, tasks);
    const calls = s.guards!.calls.length;
    await s.channelEvents([{ kind: "channel_request", id: "cancel-1", channel: "web", op: "cancel", handle: hash }]); await s.settle();
    assert.equal((await s.request(hash)).body.status, "cancelled", "and the second runtime carries on from where the first stopped");
    assert.equal(s.guards!.of("payments", "POST", /\/refund$/u).length, 1);
    assert.ok(s.guards!.calls.length > calls);
  });
}
