// An order asked about from another number, and where a UPI refund goes back to (25 Nov 2026, refund-paths; modules/record/case-asked.ts, ledger.ts refundSource), on the Go
// shop over HTTP and files. Someone at a number that holds no order names one: one line that shows nothing of it, the owner told once an hour (the approved template), a record
// line with the order in refs.case and no other number, nothing changed. A reference the shop does not hold gets the usual answer and the owner hears nothing. A UPI shop's
// refund names the account the money came from by its note, amount and day, under the new template name.
import { after, describe } from "node:test";
import assert from "node:assert/strict";
import { CUSTOMER, OWNER_NUMBER, TZ, contract, makeShop } from "./harness.ts";
import type { Shop } from "./harness.ts";
import { formatDate } from "../../../../modules/language/format.ts";
import { localParts } from "../../../../modules/core/time.ts";

const shops: Shop[] = [];
after(async () => { for (const s of shops) { await s.stop(); await s.cleanup(); } });
async function boot(o: Parameters<typeof makeShop>[0] = {}): Promise<Shop> { const s = await makeShop({ mode: "guards", ...o }); shops.push(s); await s.start(); return s; }
const STRANGER = "+919877777777";
const NOT_SHOWN = "I can't show that order to this number. I've told the owner, and they will contact you.";

/** A paid WhatsApp order, o-1 of CUSTOMER, on the gateway stand-in. */
async function ordered(): Promise<Shop> {
  const s = await boot();
  await s.inbound(CUSTOMER, `2 veg thali ${s.orderDay().words} 12:00 pm pickup`);
  const link = s.guards!.standins.fakes.payments.links()[0];
  await s.events(s.guards!.pay(link.id).map((event) => ({ kind: "payment_event", event }))); await s.settle();
  assert.deepEqual((await s.status()).orders, { confirmed: 1 });
  return s;
}

describe("an order named from a number that holds none", () => {
  contract("a real reference: one line that shows nothing, the owner told once an hour, a record line with no other number, and nothing changed", async () => {
    const s = await ordered();
    const ownerBefore = s.sent(OWNER_NUMBER).length;
    await s.inbound(STRANGER, "Where is O1? My mother ordered it");
    assert.equal(s.sent(STRANGER).length, 1);
    assert.equal(s.sent(STRANGER)[0].text, NOT_SHOWN);
    assert.doesNotMatch(s.sent(STRANGER)[0].text, /thali|₹|98444|o-1/iu, "nothing of the order reaches the asker");
    const told = s.sent(OWNER_NUMBER).slice(ownerBefore);
    assert.equal(told.length, 1);
    assert.equal(told[0].text, `Someone at ${STRANGER} asks about order o-1 (ordered from ${CUSTOMER}). Check before you help.`);
    const lines = s.record().filter((r) => r.action === "case_asked_elsewhere");
    assert.equal(lines.length, 1);
    assert.deepEqual([lines[0].outcome, lines[0].booking, lines[0].conversation], ["confirmed", null, STRANGER]);
    assert.deepEqual(lines[0].refs, { case: "o-1", via: "reference", to: "owner" });
    assert.doesNotMatch(lines[0].notes + JSON.stringify(lines[0].refs), /9844444444/u, "no other number in the line");
    await s.inbound(STRANGER, "o-1 please");
    assert.equal(s.sent(STRANGER).at(-1)!.text, NOT_SHOWN);
    assert.equal(s.sent(OWNER_NUMBER).length, ownerBefore + 1, "at most once an hour per asker and order");
    assert.deepEqual((await s.status()).orders, { confirmed: 1 }, "the order is as it was");
    assert.equal(s.guards!.of("payments", "POST", /\/refund$/u).length, 0, "no money moved");
  });

  contract("a reference the shop does not hold: the usual answer, and the owner hears nothing", async () => {
    const s = await ordered();
    const ownerBefore = s.sent(OWNER_NUMBER).length;
    await s.inbound(STRANGER, "where is o-8?");
    assert.notEqual(s.sent(STRANGER).at(-1)?.text, NOT_SHOWN);
    assert.equal(s.sent(OWNER_NUMBER).length, ownerBefore);
    assert.equal(s.record().filter((r) => r.action === "case_asked_elsewhere").length, 0);
  });
});

describe("a UPI refund goes back to the account that paid", () => {
  contract("the owner's refund message names the payment's note, amount and day, under owner_order_upi_refund_to_account", async () => {
    const s = await boot({ example: "upi" });
    const { hash } = await s.order({ name: "Asha Verma" });
    const before = Date.now();
    await s.ownerPress("deposit", "received");
    const after = Date.now();
    assert.equal((await s.request(hash)).body.status, "confirmed");
    await s.channelEvents([{ kind: "channel_request", id: "cancel-1", channel: "web", op: "cancel", handle: hash }]); await s.settle();
    const told = s.sent(OWNER_NUMBER).filter((m) => m.templateName === "owner_order_upi_refund_to_account");
    assert.equal(told.length, 1, JSON.stringify(s.sent(OWNER_NUMBER).map((m) => [m.templateName, m.text])));
    const days = [before, after].map((ms) => formatDate(localParts(ms, TZ), "en"));
    assert.ok(days.some((d) => told[0].text.startsWith(`Refund to send: ₹120 back to the account that paid you ₹120 on ${d} with the note o-1 (customer `)), told[0].text);
    assert.match(told[0].text, /Find that payment in your UPI app and send it back to that account\./u);
  });
});
