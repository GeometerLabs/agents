// A shop stopped and started again on one folder: the store file (agent.db, its tables, the record, the queue) and the files beside it carry everything over, and the
// shop goes on from where it stopped. Until 24 Nov 2026 this ran the TypeScript runtime and the Go runtime in turn, both ways (decision 61: a shop could move between them
// and lose nothing); the TypeScript runtime was deleted then, so it is the Go program twice. Without the Go binary (go/bin/stock-orders, or STOCK_ORDERS_GO_BIN) it is skipped and
// says so.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { BOTH, RAVI, makeShop, orderAndApprove } from "./harness.ts";
import type { Shop } from "./harness.ts";

const SKIP = BOTH ? undefined : "the Go Stock orders program is not built (go build -o go/bin/ ./cmd/stock-orders, or set STOCK_ORDERS_GO_BIN)";
const made: Shop[] = [];
after(async () => { for (const s of made) { await s.stop(); await s.cleanup(); } });

for (const [first, second] of [["go", "go"]] as const) {
  test(`a shop started on ${first} and started again on ${second} keeps its orders, its card, its record and its counter, and goes on`, { skip: SKIP }, async () => {
    const s = await makeShop(); made.push(s);
    await s.start(first);
    await orderAndApprove(s);
    await s.ownerSays("order 12 shampoo from meena");
    const code = s.code();
    const record = s.record().map((r) => [r.action, r.outcome]);
    const saved = s.saved();
    await s.stop();
    await s.start(second);
    assert.deepEqual(s.saved().orders, saved.orders, "the orders are the same, field for field");
    assert.deepEqual(s.record().slice(0, record.length).map((r) => [r.action, r.outcome]), record, "the record is the same, line for line");
    await s.ownerSays(`yes ${code}`);
    assert.equal(s.order("po-2").state, "sent", "the card made on the first runtime is answered on the second");
    await s.inbound(RAVI, "ok po-1");
    assert.equal(s.order("po-1").ack, "accepted");
    await s.ownerSays("order 6 hair oil from meena");
    assert.ok(s.order("po-3"), "the counter goes on");
    assert.equal(s.orderMessagesTo(RAVI).length, 1);
  });
}
