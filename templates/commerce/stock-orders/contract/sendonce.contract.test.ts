// SEND ONCE (group R, README.md): the purchase order commits the owner, so it is never sent twice by the machine. The step records an intent; after the step is saved the runtime
// writes a claim, sends, and writes the ending (modules/messaging/send-once.ts). Seen from outside, on a live shop in front of the fake WhatsApp Guard:
//   - a refusal that says nothing went out is shown to the owner at once ("Try now" / "Cancel order"), tried again, three tries in all, then the order is not sent and the owner
//     may send it again by their own word;
//   - a lost reply (the stand-in took it, the shop never heard): the order "may or may not have reached the supplier", is NEVER sent again by itself, and the owner chooses
//     "They got it" (nothing is sent) or "Send it again" (a fresh message, their own act); the supplier's own OK also settles it;
//   - the process killed while the order message is on the wire: after the restart it is not sent again and the owner is asked.
// From test/send-once.test.ts and the hand check's situations 1 and 16.
import { after, describe } from "node:test";
import assert from "node:assert/strict";
import { OWNER, RAVI, contract, orderAndApprove, shops, sleep } from "./harness.ts";
import { guardAnswer, isOrderSend } from "./guards.ts";

const made = shops();
after(async () => { for (const s of made.all) { await s.stop(); await s.cleanup(); } });

describe("a refusal: nothing went out", () => {
  contract("the order message refused once is shown to the owner at once with Try now; Try now sends it, once", async () => {
    const s = await made.boot();
    s.guard!.answer(guardAnswer("refused_rule"), { times: 1, match: isOrderSend });
    await orderAndApprove(s);
    assert.equal(s.order("po-1").state, "approved", "still approved: the budget stays reserved and a try is due");
    assert.equal(s.orderMessagesTo(RAVI).length, 0);
    const intent = s.saved().sendOnce.intents[0];
    assert.equal(intent.status, "failed"); assert.equal(intent.tries, 1);
    const item = await s.item("po_refused", "po-1");
    assert.ok(item, "the owner's page lists the refused order");
    assert.deepEqual(item.actions, ["try_now", "cancel_order"]);
    assert.equal(typeof item.startMs, "number", "with the time of the next try");
    await s.press("try_now", item);
    assert.equal(s.order("po-1").state, "sent");
    assert.equal(s.orderMessagesTo(RAVI).length, 1);
    assert.equal(await s.item("po_refused", "po-1"), undefined, "the item closed by itself");
    assert.equal(s.sent(OWNER).filter((m) => /went to Ravi Traders/u.test(m.text)).length, 1, "the owner is told once that it went");
  });

  contract("refused on every try: after three the order is not sent, the owner is told, and their own \"send po-1\" sends it", async () => {
    const s = await made.boot();
    s.guard!.answer(guardAnswer("refused_rule"), { times: 3, match: isOrderSend });
    await orderAndApprove(s);
    for (let i = 0; i < 2; i++) await s.press("try_now", (await s.item("po_refused", "po-1"))!);
    assert.equal(s.order("po-1").state, "send_failed");
    assert.equal(s.saved().sendOnce.intents[0].status, "gave_up");
    assert.match(s.lastToOwner()!.text, /WhatsApp refused it/u);
    assert.equal(s.orderMessagesTo(RAVI).length, 0);
    await s.ownerSays("send po-1");
    assert.equal(s.order("po-1").state, "sent");
    assert.equal(s.orderMessagesTo(RAVI).length, 1);
  });

  contract("Cancel order on a refused message stops the retries and frees the budget", async () => {
    const s = await made.boot();
    s.guard!.answer(guardAnswer("refused_rule"), { match: isOrderSend });
    await orderAndApprove(s);
    await s.press("cancel_order", (await s.item("po_refused", "po-1"))!);
    assert.equal(s.order("po-1").state, "cancelled");
    assert.equal(s.saved().sendOnce.intents[0].status, "gave_up");
    await s.ownerSays("status");
    assert.match(s.lastToOwner()!.text, /₹0 of your ₹20,000/u);
  });
});

describe("a lost reply: it may have gone out", () => {
  contract("the order is never sent again by itself; the owner is told and asked; \"They got it\" settles it without sending", async () => {
    const s = await made.boot();
    s.guard!.loseReply({ times: 1, match: isOrderSend });
    await orderAndApprove(s);
    assert.equal(s.orderMessagesTo(RAVI).length, 1, "the stand-in took it");
    assert.equal(s.order("po-1").state, "send_unknown");
    assert.ok(s.sent(OWNER).some((m) => /may or may not have reached Ravi Traders/u.test(m.text)));
    const item = await s.item("po_unsure", "po-1");
    assert.deepEqual(item.actions, ["got_it", "send_again"]);
    await s.press("got_it", item);
    assert.equal(s.order("po-1").state, "sent");
    assert.equal(s.saved().sendOnce.intents[0].resolved, "owner_got_it");
    assert.equal(s.orderMessagesTo(RAVI).length, 1, "nothing more was sent");
    assert.equal(await s.item("po_unsure", "po-1"), undefined);
  });

  contract("\"Send it again\" is the owner's own act: a second message, once, and the first stays unconfirmed in the record", async () => {
    const s = await made.boot();
    s.guard!.loseReply({ times: 1, match: isOrderSend });
    await orderAndApprove(s);
    const item = await s.item("po_unsure", "po-1");
    await s.press("send_again", item);
    await s.press("send_again", item);
    assert.equal(s.orderMessagesTo(RAVI).length, 2, "the first may have gone, and the owner chose to send it again: two, never three");
    assert.equal(s.order("po-1").state, "sent");
    const endings = s.record().filter((l) => l.action === "send_order" && l.outcome !== "attempted").map((l) => l.outcome);
    assert.deepEqual(endings, ["unconfirmed", "confirmed"]);
  });

  contract("the supplier's own OK settles an unconfirmed order: the owner's question leaves the list", async () => {
    const s = await made.boot();
    s.guard!.loseReply({ times: 1, match: isOrderSend });
    await orderAndApprove(s);
    await s.inbound(RAVI, "ok");
    assert.equal(s.order("po-1").state, "sent");
    assert.equal(s.order("po-1").ack, "accepted");
    assert.equal(await s.item("po_unsure", "po-1"), undefined);
  });
});

describe("the process dies while the order is on the wire", () => {
  contract("killed while WhatsApp is taking the order: after the restart it is not sent again, and the owner is asked", async () => {
    const s = await made.boot({ tickSeconds: 1 });
    s.guard!.delay(1500, { times: 1, match: isOrderSend });
    await s.ownerSays("order 10 boxes of hair colour from Ravi Traders");
    const a = await s.events([{ kind: "message", message: s.guard!.fake.receive(OWNER, `yes ${s.code()}`) }]);
    assert.equal(a.status, 200);
    for (let i = 0; i < 200 && !s.guard!.calls.some((c) => isOrderSend(c)); i++) await sleep(10);
    s.kill();
    await sleep(1800); // the delayed call reaches the stand-in: the supplier has it
    assert.equal(s.orderMessagesTo(RAVI).length, 1);
    await s.start();
    await s.settle();
    for (let i = 0; i < 100 && s.order("po-1").state === "approved"; i++) await sleep(50);
    assert.equal(s.order("po-1").state, "send_unknown");
    assert.equal(s.orderMessagesTo(RAVI).length, 1, "never sent again by itself");
    assert.ok(await s.item("po_unsure", "po-1"), "the owner is asked");
    assert.equal(s.saved().sendOnce.intents[0].status, "unconfirmed");
  });
});
