// A shop stopped and started again on one folder: the store file (agent.db, its tables, the record, the queue) and the files beside it carry everything over, and the
// shop goes on from where it stopped. Until 24 Nov 2026 this ran the TypeScript runtime and the Go runtime in turn, both ways (decision 61: a shop could move between them
// and lose nothing); the TypeScript runtime was deleted then, so it is the Go program twice. Without the Go binary (go/bin/orders, or ORDERS_GO_BIN) it is skipped and
// says so.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { REPO, makeShop } from "./harness.ts";
import { gatewayCaseThroughParts } from "../../parts/contract/via-parts.ts";
import type { Shop } from "./harness.ts";

const GO = process.env.ORDERS_GO_BIN ?? join(REPO, "go", "bin", "orders");
const SKIP = existsSync(GO) ? undefined : "the Go Orders program is not built (go build -o go/bin/ ./cmd/orders, or set ORDERS_GO_BIN)";
const shops: Shop[] = [];
after(async () => { for (const s of shops) { await s.stop(); await s.cleanup(); } });

for (const [first, second] of [["go", "go"]] as const) {
  test(`an Orders shop started on ${first} and started again on ${second} keeps its order, its payment, its record and its queue, and goes on`, { skip: SKIP ?? gatewayCaseThroughParts() }, async () => {
    const s = await makeShop({ mode: "guards" }); shops.push(s);
    await s.start(first);
    const { hash } = await s.order();
    const link = s.guards!.standins.fakes.payments.links()[0];
    await s.events(s.guards!.pay(link.id).map((event) => ({ kind: "payment_event", event }))); await s.settle();
    assert.equal((await s.request(hash)).body.status, "confirmed");
    const record = s.record().map((r) => [r.action, r.outcome]);
    const tasks = (await s.status()).tasks;
    await s.stop();
    await s.start(second);
    assert.equal((await s.request(hash)).body.status, "confirmed", "the order is there");
    assert.deepEqual(s.record().slice(0, record.length).map((r) => [r.action, r.outcome]), record, "the record is the same, line for line");
    assert.deepEqual((await s.status()).tasks, tasks);
    await s.channelEvents([{ kind: "channel_request", id: "cancel-1", channel: "web", op: "cancel", handle: hash }]); await s.settle();
    assert.equal((await s.request(hash)).body.status, "cancelled", "and the restarted shop carries on from where it stopped");
    assert.equal(s.guards!.of("payments", "POST", /\/refund$/u).length, 1);
  });
}
