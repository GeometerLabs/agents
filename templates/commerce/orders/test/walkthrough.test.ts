// The walkthrough a partner shows an owner (scripts/walkthrough.ts) does what the sell guide says it does, in every language, on the example shop: an order for tomorrow's lunch
// with its advance request, "I have paid" with nothing marked, the owner's mark that confirms it, a lower price refused, and a cancellation with a refund the owner sends. Judged
// from the stand-ins' own records, not from the text it printed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { LANGUAGES } from "../../../../modules/language/languages.ts";
import { inLanguage } from "../crash-test/shop.ts";
import { WALK_HAGGLER, WALK_OFFER_INR, WALK_QTY, printed, walk, walkSettings } from "../scripts/walkthrough.ts";
import { takenOf } from "../src/order.ts";

for (const language of LANGUAGES) {
  test(`walkthrough in ${language}: five steps, each doing what the guide says, and the stand-ins' records agree`, async () => {
    const { world: w, shop, steps, customer } = await walk(language);
    assert.equal(steps.length, 5);
    const [order, claim, mark, lower, cancel] = steps;
    const menuPrice = shop.item.priceInr;
    assert.equal(menuPrice, 120);

    assert.deepEqual(order.lines.map((l) => l.from), ["customer", "agent", "agent to owner"]);
    assert.ok(inLanguage(order.lines[1].text, language), order.lines[1].text);
    assert.ok(order.lines[1].text.includes(`₹${menuPrice * WALK_QTY}`) && order.lines[1].text.includes(`₹${shop.advanceInr}`), "the total and the advance");
    assert.match(order.lines[1].text, /upi:\/\/pay\?pa=annapurna@okicici/);
    assert.match(order.lines[2].text, /received [A-Z0-9]{6}/);

    assert.deepEqual(claim.lines.map((l) => l.from), ["customer", "agent", "agent to owner"]);
    assert.ok(inLanguage(claim.lines[1].text, language), claim.lines[1].text);
    assert.match(claim.lines[2].text, /A screenshot is not proof/);

    assert.deepEqual(mark.lines.map((l) => l.from), ["owner", "agent", "agent to owner", "agent to owner"]);
    assert.match(mark.lines[0].text, /^received [A-Z0-9]{6}$/);
    assert.ok(mark.lines[1].text.includes("×") && inLanguage(mark.lines[1].text, language), mark.lines[1].text);
    assert.match(mark.lines[2].text, /^New order o-1 /);

    assert.deepEqual(lower.lines.map((l) => l.from), ["customer", "agent", "agent to owner"]);
    assert.ok(lower.lines[0].text.includes(`₹${WALK_OFFER_INR}`));
    assert.ok(lower.lines[1].text.includes(`₹${menuPrice}`), "the agent names the menu price");

    assert.deepEqual(cancel.lines.map((l) => l.from), ["customer", "agent", "agent to owner", "agent to owner", "owner", "agent", "agent to owner"]);
    assert.match(cancel.lines[3].text, /Refund to send/);
    assert.match(cancel.lines[4].text, /^refunded [A-Z0-9]{6}$/);

    // the stand-ins' own records
    const first = w.orderOf(customer)!;
    assert.equal(first.state, "cancelled");
    const request = w.upiRequest(customer)!;
    assert.equal(request.amountPaise, shop.advanceInr * 100, "the request was for the advance and nothing else");
    assert.equal(request.marks.length, 1, "one mark: the owner's");
    assert.equal(request.marks[0].amountPaise, shop.advanceInr * 100);
    const refunds = w.upiRefunds(customer);
    assert.equal(refunds.length, 1);
    assert.equal(refunds[0].state, "done");
    assert.equal(refunds[0].amountPaise, request.marks[0].amountPaise, "the refund is the advance paid, never more");
    const second = w.orderOf(WALK_HAGGLER)!;
    assert.equal(second.state, "awaiting_advance", "the customer who asked for a lower price is asked for the advance at the menu price, and is not confirmed");
    assert.equal(w.upiRequest(WALK_HAGGLER)!.amountPaise, shop.advanceInr * 100);
    assert.equal(takenOf(w.store, shop.date, shop.item.id, w.clock.now()), WALK_QTY, "only the second customer's hold is left on the stock");
    // the agent never sent money: there is no payments-service refund in a UPI shop
    assert.equal(w.payments.refunds().length, 0);
  });
}

test("the walkthrough's shop is the example shop with Malayalam and Kannada names added, and nothing else changed", () => {
  const walkSet = walkSettings();
  assert.deepEqual([...walkSet.languages].sort(), [...LANGUAGES].sort());
  assert.deepEqual(walkSet.menu.map((m) => [m.id, m.priceInr, m.dailyStock]), [["veg-thali", 120, 12], ["chicken-meal", 160, 8], ["curd", 20, 30]]);
  assert.equal(walkSet.payment.module, "upi");
});

test("the printed walkthrough names its language, says it is stand-in services and test money, and numbers its steps", async () => {
  const { steps } = await walk("ml");
  const text = printed("ml", steps);
  assert.match(text, /^Annapurna Tiffins, an order in Malayalam\. Stand-in services and test money: nothing real is sent\./);
  for (let i = 1; i <= 5; i++) assert.ok(text.includes(`\n${i}. `));
});
