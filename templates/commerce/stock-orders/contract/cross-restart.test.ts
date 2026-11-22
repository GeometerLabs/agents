// The TypeScript runtime and the Go runtime IN TURN on one Stock orders folder, both ways: agent.db (its tables, the record, the queue, the saved state member for member) is the
// same, so a shop can move between the two runtimes and lose nothing (decision 61). It needs BOTH runtimes, so without the Go binary (go/bin/stock-orders, or STOCK_ORDERS_GO_BIN)
// it is skipped and says so; with it, it runs whatever STOCK_ORDERS_IMPL says.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { BOTH, RAVI, makeShop, orderAndApprove } from "./harness.ts";
import type { Shop } from "./harness.ts";

const SKIP = BOTH ? undefined : "no Go Stock orders runtime yet (wave 2): this test runs both runtimes on one folder";
const made: Shop[] = [];
after(async () => { for (const s of made) { await s.stop(); await s.cleanup(); } });

for (const [first, second] of [["ts", "go"], ["go", "ts"]] as const) {
  test(`a shop started on ${first} and moved to ${second} keeps its orders, its card, its record and its counter, and goes on`, { skip: SKIP }, async () => {
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
