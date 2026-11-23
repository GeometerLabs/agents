// The limits held outside the AI (group L, README.md "The limits held outside the AI"), each seen from outside: what the owner is told, what is (not) sent, and the rule id in the
// record's decisions. An order goes only to an approved supplier; a whole quantity up to the setting; never above the per-order cap (the owner's yes cannot raise it); the month's
// approved orders never above the budget, reserved with the approval (two cards racing for the last of it: one wins); one request makes at most one order; an approval counts
// only for the exact fields shown (a price that moved voids it); only the supplier's own number answers for the supplier. From test/limits.test.ts and the hand check's situations
// 3, 4, 5, 6, 7, 11, 13 (crash-test/situations.ts).
import { after, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { KUMAR, MEENA, OWNER, RAVI, contract, orderAndApprove, shops } from "./harness.ts";
import type { Shop } from "./harness.ts";

const made = shops();
after(async () => { for (const s of made.all) { await s.stop(); await s.cleanup(); } });
const blockedBy = (s: Shop, rule: string): boolean => s.record().some((l) => l.outcome === "blocked" && l.decisions.some((d) => d.ruleId === rule && d.verdict !== "allow"));
const orderCount = (s: Shop): number => Object.keys(s.saved()?.orders ?? {}).length;

describe("who an order may go to", () => {
  contract("approved-supplier-only: a supplier not on the list, and one on it but paused, get nothing", async () => {
    const s = await made.boot();
    await s.ownerSays("order 10 boxes of hair colour from Sharma Stores");
    assert.match(s.lastToOwner()!.text, /not on your approved supplier list/u);
    await s.ownerSays("order 10 boxes of hair colour from Kumar Wholesale");
    assert.match(s.lastToOwner()!.text, /not on your approved supplier list, or is paused/u);
    assert.equal(orderCount(s), 0);
    assert.equal(s.sent(KUMAR).length, 0);
    assert.ok(blockedBy(s, "approved-supplier-only"));
  });

  contract("reply-from-supplier: only the supplier's own number answers for the supplier", async () => {
    const s = await made.boot();
    await orderAndApprove(s);
    await s.inbound(MEENA, "OK po-1");
    assert.equal(s.order("po-1").ack, "none");
    assert.ok(s.record().some((l) => l.action === "supplier_reply" && l.outcome === "blocked"));
  });
});

describe("how much", () => {
  contract("order-quantity: more than the most one order may have is a typing slip, and nothing is ordered", async () => {
    const s = await made.boot();
    await s.ownerSays("order 201 bottles of shampoo from ravi");
    assert.match(s.lastToOwner()!.text, /201 is more than 200/u);
    assert.equal(orderCount(s), 0);
    assert.ok(blockedBy(s, "order-quantity"));
  });

  contract("per-order-cap: an order above the cap gets no card and nothing is sent; at the cap it is allowed", async () => {
    const s = await made.boot();
    await s.ownerSays("order 30 boxes of hair colour from ravi");       // ₹13,500 > ₹12,000
    assert.match(s.lastToOwner()!.text, /more than the ₹12,000 one order may be worth/u);
    assert.equal(orderCount(s), 0);
    assert.ok(blockedBy(s, "per-order-cap"));
    await s.ownerSays("order 100 towels from meena");                    // ₹9,000
    assert.equal(s.order("po-1").totalPaise, 900_000);
  });

  contract("monthly-budget: the month's approved orders never add up to more than the budget; a cancelled or declined order gives its budget back", async () => {
    const s = await made.boot();
    await orderAndApprove(s, "order 26 boxes of hair colour from ravi");  // ₹11,700 reserved
    await s.ownerSays("order 20 boxes of hair colour from meena");       // ₹9,200 > ₹8,300 left
    assert.match(s.lastToOwner()!.text, /more than the ₹8,300 left of this month's ₹20,000 budget/u);
    assert.ok(blockedBy(s, "monthly-budget"));
    assert.equal(orderCount(s), 1);
    await s.inbound(RAVI, "no");                                         // the supplier cannot: released
    await orderAndApprove(s, "order 20 boxes of hair colour from meena");
    assert.equal(s.order("po-2").state, "sent");
  });

  contract("two cards racing for the last of the budget: the first yes reserves it, the second is refused and nothing more is sent", async () => {
    const s = await made.boot();
    await s.ownerSays("order 26 boxes of hair colour from ravi");        // ₹11,700
    const first = s.code();
    await s.ownerSays("order 20 boxes of hair colour from meena");       // ₹9,200: each fits alone, not both
    const second = s.code();
    await s.ownerSays(`yes ${first}`);
    await s.ownerSays(`yes ${second}`);
    assert.equal(s.order("po-1").state, "sent");
    assert.equal(s.order("po-2").state, "void");
    assert.equal(s.orderMessagesTo(MEENA).length, 0);
    assert.ok(blockedBy(s, "monthly-budget"));
  });
});

describe("the approval is for exactly what was shown", () => {
  contract("approval-matches-order: the catalogue's price moved after the card (a restart on new settings), so the old yes sends nothing and a new card shows the new total", async () => {
    const s = await made.boot();
    await s.ownerSays("order 10 boxes of hair colour from Ravi Traders");
    const code = s.code();
    await s.stop();
    const file = join(s.client, "settings.json");
    const settings = JSON.parse(readFileSync(file, "utf8"));
    settings.catalogue[0].priceInr = 470;
    writeFileSync(file, JSON.stringify(settings));
    await s.start();
    await s.ownerSays(`yes ${code}`);
    assert.equal(s.orderMessagesTo(RAVI).length, 0, "nothing was sent on the old approval");
    assert.ok(blockedBy(s, "approval-matches-order"));
    assert.equal(s.order("po-1").totalPaise, 470_000, "the order is brought up to date");
    assert.match(s.lastToOwner()!.text, /₹4,700/u);
    await s.ownerSays(`yes ${s.code()}`);
    assert.match(s.orderMessagesTo(RAVI)[0].text, /₹4,700/u);
  });

  contract("one-order-per-request and send-only-when-approved: the record shows every send passed the owner's yes", async () => {
    const s = await made.boot();
    await orderAndApprove(s);
    const decision = s.record().find((l) => l.action === "owner_decision" && l.outcome === "confirmed")!;
    assert.ok(decision.decisions.some((d) => d.ruleId === "approval-matches-order" && d.verdict === "allow"));
    assert.equal(decision.refs.evidence, "owner_marked");
    assert.equal(s.sent(OWNER).filter((m) => /yes [A-Z0-9]{4,8}/u.test(m.text)).length, 1, "one card");
  });
});
