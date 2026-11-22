// The main paths of a Stock orders shop (group F, README.md), on a live shop in front of the fake WhatsApp Guard: the owner's request becomes ONE exact order with an approval card;
// the card's yes (typed code or button) reserves the budget and sends the order to the supplier once, as the approved template in the supplier's language; the supplier's OK is
// recorded and is not receipt; receipt (all, part, wrong item) is the owner's mark and is not payment; "paid" is only the owner's note. What the agent cannot tell (which line,
// how many) it asks; what it cannot read it answers with examples. The witness is the WhatsApp stand-in's outbox and the shop's own file (agent.db). From test/agent.test.ts,
// test/channel.test.ts and the hand check's situations 8, 9, 10, 12, 13, 17 (crash-test/situations.ts).
import { after, describe } from "node:test";
import assert from "node:assert/strict";
import { MEENA, OWNER, RAVI, STRANGER, contract, orderAndApprove, shops } from "./harness.ts";

const made = shops();
after(async () => { for (const s of made.all) { await s.stop(); await s.cleanup(); } });

describe("request, card, approval, order", () => {
  contract("a request becomes one exact order with a card; nothing goes to the supplier before the yes; the yes sends the order once, in the supplier's language", async () => {
    const s = await made.boot();
    await s.ownerSays("order 10 boxes of hair colour from Ravi Traders");
    const o = s.order("po-1");
    assert.equal(o.state, "awaiting_approval");
    assert.equal(o.totalPaise, 450_000); assert.equal(o.unitPaise, 45_000); assert.equal(o.qty, 10);
    assert.equal(o.supplier, "ravi-traders"); assert.equal(o.item, "hair-colour"); assert.equal(o.unit, "box");
    assert.equal(s.sent(RAVI).length, 0, "nothing is sent before approval");
    const card = s.lastToOwner()!;
    assert.match(card.text, /po-1/u); assert.match(card.text, /₹4,500/u); assert.match(card.text, /Ravi Traders/u);
    assert.deepEqual(card.interactive.buttons.map((b: { id: string }) => b.id), [`card-yes:${s.code()}`, `card-no:${s.code()}`], "the owner wrote, so the card carries its two buttons");
    await s.ownerSays(`yes ${s.code()}`);
    const after1 = s.order("po-1");
    assert.equal(after1.state, "sent");
    assert.match(after1.budgetMonth, /^\d{4}-\d{2}$/u, "the month the budget is reserved in");
    assert.equal(typeof after1.approvedMs, "number");
    const orders = s.orderMessagesTo(RAVI);
    assert.equal(orders.length, 1, "one order message");
    assert.equal(orders[0].kind, "template", "the supplier has not written, so the order goes as the approved template");
    assert.match(orders[0].text, /po-1/u); assert.match(orders[0].text, /₹4,500/u);
    assert.match(orders[0].text, /नया ऑर्डर/u, "Ravi Traders reads Hindi");
    assert.ok(s.sent(OWNER).some((m) => /went to Ravi Traders/u.test(m.text)), "the owner is told it went");
    const sends = s.record().filter((l) => l.action === "send_order");
    assert.deepEqual(sends.map((l) => l.outcome), ["attempted", "confirmed"], "a claim, then its ending");
  });

  contract("the card's button works like the typed code, and a no declines it and sends nothing", async () => {
    const s = await made.boot();
    await s.ownerSays("order 10 boxes of hair colour from Ravi Traders");
    await s.tap(OWNER, `card-yes:${s.code()}`);
    assert.equal(s.order("po-1").state, "sent");
    await s.ownerSays("order 12 shampoo from meena");
    await s.tap(OWNER, `card-no:${s.code()}`);
    assert.equal(s.order("po-2").state, "declined");
    assert.equal(s.sent(MEENA).length, 0);
    assert.match(s.lastToOwner()!.text, /declined/u);
  });

  contract("an approval used twice, or after a no, does nothing more; a code nobody was given does nothing", async () => {
    const s = await made.boot();
    await s.ownerSays("order 10 boxes of hair colour from Ravi Traders");
    const code = s.code();
    await s.ownerSays(`yes ${code}`);
    await s.ownerSays(`yes ${code}`);
    assert.match(s.lastToOwner()!.text, /already answered or replaced/u);
    assert.equal(s.orderMessagesTo(RAVI).length, 1);
    await s.ownerSays("yes ZZZZZZ");
    assert.match(s.lastToOwner()!.text, /no card with that code/u);
  });

  contract("the owner's request delivered twice (the same message id) makes one order and one card", async () => {
    const s = await made.boot();
    await s.ownerSays("order 10 boxes of hair colour from Ravi Traders", { id: "wamid.same-1" });
    const again = await s.ownerSays("order 10 boxes of hair colour from Ravi Traders", { id: "wamid.same-1" });
    assert.deepEqual(again.body, { saved: 0, duplicates: 1 }, "the queue knows the message already");
    assert.deepEqual(Object.keys(s.saved().orders), ["po-1"]);
    assert.equal(s.sent(OWNER).filter((m) => /yes [A-Z0-9]{4,8}/u.test(m.text)).length, 1, "one card");
  });
});

describe("what the agent will not guess", () => {
  contract("an item sold by the box and by the piece: the owner picks from a list, and the total is for the line they pick", async () => {
    const s = await made.boot();
    await s.ownerSays("order 10 hair colour");
    const list = s.lastToOwner()!.interactive.list;
    assert.ok(list.rows.length >= 2, "the ways to order it");
    assert.equal(s.saved().asking.kind, "line");
    const box = list.rows.findIndex((r: { title: string }) => /Ravi Traders \(box\)/u.test(r.title));
    assert.ok(box >= 0, JSON.stringify(list.rows));
    await s.tap(OWNER, `pick:${box}`);
    const o = s.order("po-1");
    assert.equal(o.unit, "box"); assert.equal(o.qty, 10); assert.equal(o.totalPaise, 450_000);
    assert.equal(s.saved().asking, undefined, "the question is answered");
  });

  contract("no quantity: the owner is asked how many, and the number they write makes the order", async () => {
    const s = await made.boot();
    await s.ownerSays("order hair oil from meena");
    assert.match(s.lastToOwner()!.text, /How many/u);
    assert.equal(s.saved().asking.kind, "qty");
    await s.ownerSays("6");
    assert.equal(s.order("po-1").qty, 6);
    assert.equal(s.order("po-1").totalPaise, 72_000);
  });

  contract("a low-stock mark orders the line's reorder quantity; a second mark for the same line makes no second order", async () => {
    const s = await made.boot();
    await s.ownerSays("shampoo from ravi is low");
    const o = s.order("po-1");
    assert.equal(o.qty, 12); assert.equal(o.lowStock, true);
    await s.ownerSays("shampoo from ravi is low");
    assert.deepEqual(Object.keys(s.saved().orders), ["po-1"]);
    assert.match(s.lastToOwner()!.text, /already open/u);
  });

  contract("something not in the catalogue is refused with what can be ordered; words it cannot read get examples, never a guess", async () => {
    const s = await made.boot();
    await s.ownerSays("order 5 soap");
    assert.equal(s.saved()?.orders ? Object.keys(s.saved().orders).length : 0, 0);
    await s.ownerSays("good morning");
    assert.match(s.lastToOwner()!.text, /could not tell/u);
    assert.equal(Object.keys(s.saved().orders).length, 0);
  });

  contract("status lists the open orders and the month's budget", async () => {
    const s = await made.boot();
    await s.ownerSays("status");
    assert.match(s.lastToOwner()!.text, /No open stock orders/u);
    await orderAndApprove(s);
    await s.ownerSays("status");
    const t = s.lastToOwner()!.text;
    assert.match(t, /po-1/u); assert.match(t, /₹4,500 of your ₹20,000/u);
  });
});

describe("changes and cancels", () => {
  contract("a change before the yes makes a new card with the new total, and the old code does nothing", async () => {
    const s = await made.boot();
    await s.ownerSays("order 10 boxes of hair colour from Ravi Traders");
    const old = s.code();
    await s.ownerSays("change po-1 12");
    assert.equal(s.order("po-1").qty, 12); assert.equal(s.order("po-1").totalPaise, 540_000);
    assert.notEqual(s.code(), old);
    assert.match(s.lastToOwner()!.text, /₹5,400/u);
    await s.ownerSays(`yes ${old}`);
    assert.equal(s.order("po-1").state, "awaiting_approval", "the old card does not approve the changed order");
    await s.ownerSays(`yes ${s.code()}`);
    assert.equal(s.order("po-1").state, "sent");
    assert.match(s.orderMessagesTo(RAVI)[0].text, /₹5,400/u);
  });

  contract("after the yes an order cannot be changed or cancelled from here; before it, a cancel releases it", async () => {
    const s = await made.boot();
    await orderAndApprove(s);
    await s.ownerSays("change po-1 12");
    assert.match(s.lastToOwner()!.text, /already approved/u);
    await s.ownerSays("cancel po-1");
    assert.match(s.lastToOwner()!.text, /cannot cancel/u);
    assert.equal(s.order("po-1").state, "sent");
    await s.ownerSays("order 12 shampoo from meena");
    await s.ownerSays("cancel po-2");
    assert.equal(s.order("po-2").state, "cancelled");
    assert.equal(s.sent(MEENA).length, 0);
    await s.ownerSays("received po-9");
    assert.match(s.lastToOwner()!.text, /no order po-9/u);
  });
});

describe("the supplier answers", () => {
  contract("the supplier's OK is recorded, the owner is told, and it is not receipt", async () => {
    const s = await made.boot();
    await orderAndApprove(s);
    await s.inbound(RAVI, "OK");
    const o = s.order("po-1");
    assert.equal(o.ack, "accepted"); assert.equal(o.receipt, "none"); assert.equal(o.state, "sent");
    assert.ok(s.sent(OWNER).some((m) => /confirmed by the supplier/u.test(m.text)));
    assert.match(s.sent(RAVI).at(-1)!.text, /po-1/u, "the supplier is thanked, about the same order");
    const line = s.record().find((l) => l.action === "supplier_reply")!;
    assert.equal(line.outcome, "confirmed"); assert.equal(line.refs.evidence, "supplier_reply");
  });

  contract("the supplier's no releases the budget, and the delivery cannot be marked", async () => {
    const s = await made.boot();
    await orderAndApprove(s);
    await s.inbound(RAVI, "no");
    assert.equal(s.order("po-1").state, "supplier_declined");
    assert.equal(s.order("po-1").ack, "declined");
    await s.ownerSays("status");
    assert.match(s.lastToOwner()!.text, /₹0 of your ₹20,000/u, "nothing reserved now");
    await s.ownerSays("received po-1");
    assert.match(s.lastToOwner()!.text, /cannot be changed that way/u);
  });

  contract("an OK from a stranger or from the wrong supplier counts for nothing; a bare OK with two orders waiting is asked about, never applied by guess", async () => {
    const s = await made.boot();
    await orderAndApprove(s);
    await s.inbound(STRANGER, "OK");
    await s.inbound(MEENA, "ok po-1");
    assert.equal(s.order("po-1").ack, "none");
    await orderAndApprove(s, "order 12 shampoo from ravi");
    await s.inbound(RAVI, "ok");
    assert.equal(s.order("po-1").ack, "none"); assert.equal(s.order("po-2").ack, "none");
    assert.match(s.sent(RAVI).at(-1)!.text, /po-1, po-2/u, "the supplier is asked which");
    await s.inbound(RAVI, "ok po-2");
    assert.equal(s.order("po-2").ack, "accepted"); assert.equal(s.order("po-1").ack, "none");
  });

  contract("a supplier's STOP: they are messaged no more, an order for them is held back, and a cancel releases its budget", async () => {
    const s = await made.boot();
    await s.ownerSays("status"); // the owner wrote today: what the shop tells them is a plain message (outside the window it would need a template, and this one has none)
    await s.inbound(MEENA, "STOP");
    assert.ok(s.sent(OWNER).some((m) => /asked for no more messages/u.test(m.text)));
    await orderAndApprove(s, "order 12 shampoo from meena");
    assert.equal(s.sent(MEENA).length, 0, "nothing goes to a supplier who said STOP");
    assert.equal(s.order("po-1").state, "send_blocked");
    await s.ownerSays("cancel po-1");
    assert.equal(s.order("po-1").state, "cancelled");
  });
});

describe("receipt is the owner's mark, and paid is only a note", () => {
  contract("a part delivery, the rest, a wrong item and paid outside are separate records", async () => {
    const s = await made.boot();
    await orderAndApprove(s);
    await s.inbound(RAVI, "OK");
    await s.ownerSays("received po-1 4");
    assert.equal(s.order("po-1").receipt, "part"); assert.equal(s.order("po-1").receivedQty, 4);
    await s.ownerSays("received po-1 7");
    assert.match(s.lastToOwner()!.text, /only 6/u, "more than is still to come is refused");
    assert.equal(s.order("po-1").receivedQty, 4);
    await s.ownerSays("received po-1");
    assert.equal(s.order("po-1").receipt, "full"); assert.equal(s.order("po-1").receivedQty, 10);
    assert.equal(s.order("po-1").paidOutsideMs, undefined, "received is not paid");
    await s.ownerSays("paid po-1");
    assert.equal(typeof s.order("po-1").paidOutsideMs, "number");
    assert.match(s.lastToOwner()!.text, /I paid nothing/u);
    await orderAndApprove(s, "order 12 shampoo from meena");
    await s.inbound(MEENA, "ok");
    await s.ownerSays("wrong po-2");
    assert.equal(s.order("po-2").receipt, "wrong_item"); assert.equal(s.order("po-2").receivedQty, 0);
    const marks = s.record().filter((l) => l.action === "mark_receipt");
    assert.ok(marks.every((l) => l.refs.evidence === "owner_marked"));
    assert.equal(s.sent(RAVI).filter((m) => /paid/iu.test(m.text)).length, 0, "nothing is sent to the supplier about payment");
  });
});
