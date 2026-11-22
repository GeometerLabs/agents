// The shop's assistant on a Stock orders shop (group A, README.md), on a live shop whose settings have an `assistant` block: "what needs me" while an order waits leaves the
// order's own card standing (one approval, one order message, whichever card is answered); the assistant's card for the same order, pressed on the owner's page, approves it once
// and closes the agent's own card; the owner's words about a limit ("monthly budget at most ₹15000") make a limit card, and once it is answered the tighter budget is in force for
// the next order. From test/assistant.test.ts and test/chat-limits.test.ts. The rules alone read the owner here (no model in runtime.json).
import { after, describe } from "node:test";
import assert from "node:assert/strict";
import { MEENA, RAVI, contract, orderAndApprove, shops } from "./harness.ts";
import type { Shop } from "./harness.ts";

const made = shops();
after(async () => { for (const s of made.all) { await s.stop(); await s.cleanup(); } });
const cards = (s: Shop): any[] => s.saved()?.assistant?.cards ?? [];

describe("the shop's assistant", () => {
  contract("\"what needs me\" while an order waits keeps its card; one yes makes one order message, and the same yes again nothing", async () => {
    const s = await made.boot({ settings: { assistant: {} } });
    await s.ownerSays("order 10 boxes of hair colour from Ravi Traders");
    const code = s.code();
    await s.ownerSays("what needs me");
    assert.equal(s.order("po-1").state, "awaiting_approval");
    await s.ownerSays(`yes ${code}`);
    assert.equal(s.order("po-1").state, "sent");
    await s.ownerSays(`yes ${code}`);
    assert.equal(s.orderMessagesTo(RAVI).length, 1, "one order message, whichever card was answered");
  });

  contract("the assistant's card for the same order, pressed on the owner's page, approves it once and leaves no card of the order open", async () => {
    const s = await made.boot({ settings: { assistant: {} } });
    await s.ownerSays("order 10 boxes of hair colour from Ravi Traders");
    await s.ownerSays("what needs me");
    const theirs = cards(s).filter((c) => c.state === "open" && c.proposal?.kind !== "order");
    for (const c of theirs) await s.press("card_yes", { case: c.id, digest: c.digest });
    if (theirs.length === 0) await s.press("card_yes", (await s.item("po_approval", "po-1"))!); // the assistant made no card of its own: the order's card is the one
    assert.equal(s.order("po-1").state, "sent");
    assert.equal(s.orderMessagesTo(RAVI).length, 1);
    assert.equal(cards(s).filter((c) => c.state === "open").length, 0, "no card of this order is left to tap");
  });

  contract("a rule about the month's budget makes a limit card; once answered, the tighter budget holds the next order", async () => {
    const s = await made.boot({ settings: { assistant: {} } });
    await s.ownerSays("monthly budget at most ₹15000");
    const limit = cards(s).find((c) => c.action?.kind === "limit" && c.state === "open");
    assert.ok(limit, "the owner's words about the budget make a limit card");
    await s.ownerSays(`yes ${s.code()}`);
    assert.equal(s.saved().assistant.limitChanges.length, 1);
    await orderAndApprove(s, "order 26 boxes of hair colour from ravi");   // ₹11,700
    await s.ownerSays("order 9 boxes of hair colour from meena");        // ₹4,140: within ₹20,000, not within ₹15,000
    assert.equal(Object.keys(s.saved().orders).length, 1, "the second order is not made");
    assert.match(s.lastToOwner()!.text, /₹15,000 budget/u);
    assert.equal(s.sent(MEENA).length, 0);
  });
});
