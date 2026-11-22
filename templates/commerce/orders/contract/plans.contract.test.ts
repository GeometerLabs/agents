// MONTHLY PLANS (group (viii) of the contract, README.md): a shop with a `plans` block takes a month of meals as one payment. The customer asks for a plan in plain words, is
// quoted the meals of the month and its price, the owner's mark on the period's payment starts it (the period's payment is an order record that never counts as a meal order),
// a skip before the cut-off is a credit and after it is refused with the cut-off's time, a plan's meals hold places in their slot, and a shop without plans reads the same words
// as ordinary words. A "fakes" UPI shop on the TEST clock at Mon 9 Nov 2026, 10:00 in India (the plan starts Tue 10 Nov: 22 weekday meals to Wed 9 Dec). Expected values from
// test/plans. Observed through the record's sent templates, /status, the owner's page and the page's offer.
import { after, describe } from "node:test";
import assert from "node:assert/strict";
import { CUSTOMER, at, beat, contract, makeShop } from "./harness.ts";
import type { Shop } from "./harness.ts";

const shops: Shop[] = [];
after(async () => { for (const s of shops) { await s.stop(); await s.cleanup(); } });
async function boot(o: Parameters<typeof makeShop>[0] = {}): Promise<Shop> { const s = await makeShop({ example: "plans", ...o }); shops.push(s); await s.start(); return s; }

async function subscribed(o: Parameters<typeof makeShop>[0] = {}): Promise<Shop> {
  const s = await boot(o);
  await s.inbound(CUSTOMER, "I want the monthly lunch plan");
  assert.equal(s.templatesTo(CUSTOMER).at(-1), "plan_quote", JSON.stringify(s.templatesTo(CUSTOMER)));
  const [item] = (await s.ownerView()).body.items;
  assert.deepEqual([item.kind, item.amountPaise], ["deposit", 240000], "the month's price, marked by the owner like an advance");
  assert.match(item.what, /monthly plan/u);
  await s.ownerPress("deposit", "received");
  return s;
}

describe("a monthly plan", () => {
  contract("asked in words, quoted, and started by the owner's mark: the period's payment is a record and never a meal order", async () => {
    const s = await subscribed();
    assert.equal(s.templatesTo(CUSTOMER).at(-1), "plan_active");
    assert.ok(s.templatesTo(CUSTOMER, "owner").some((t) => t.startsWith("owner_plan")), JSON.stringify(s.templatesTo(CUSTOMER, "owner")));
    assert.equal(s.record().filter((r) => r.action === "confirm_order").length, 0, "a plan's payment is not an order confirmed");
    assert.deepEqual((await s.ownerView()).body.items, []);
    const st = (await s.status()).orders;
    assert.equal(st.confirmed, undefined, "no meal order is confirmed");
  });

  contract("a skip before the cut-off is recorded; after the cut-off it is refused and nothing changes", async () => {
    const s = await subscribed({ tickSeconds: 1 });
    await s.inbound(CUSTOMER, "skip tomorrow");
    assert.equal(s.templatesTo(CUSTOMER).at(-1), "plan_skip_done");
    s.advance(at({ year: 2026, month: 11, day: 10 }, 21) - s.now()); await beat(); // Tue 9 pm: Wednesday's cut-off was Tue 8 pm
    await s.inbound(CUSTOMER, "skip tomorrow");
    assert.equal(s.templatesTo(CUSTOMER).at(-1), "plan_cutoff_refused");
  });

  contract("a plan's meals hold places in their slot: with the slot's last place taken by the plan, a one-off order for that slot is refused", async () => {
    const s = await subscribed({ settings: { pickup: { slots: [{ id: "lunch", from: "12:00", to: "13:00", names: { en: ["lunch"] }, cutoff: { daysBefore: 0, time: "09:00" }, maxOrders: 1 }, { id: "dinner", from: "19:00", to: "20:00", names: { en: ["dinner"] }, cutoff: { daysBefore: 0, time: "15:00" } }] } } });
    const lunch = (await s.call("/internal/channel/offer")).body.days[1].slots.find((x: { id: string }) => x.id === "lunch");
    assert.equal(lunch.open, false, "the plan's meal fills Tuesday's lunch");
    const { hash } = await s.order();
    const v = (await s.request(hash)).body;
    assert.equal(v.status, "not_held");
    assert.match(v.messages.at(-1).text, /is full/u);
  });

  contract("a shop without plans reads the same words as a message, and keeps no plans", async () => {
    const s = await makeShop({ example: "upi" }); shops.push(s); await s.start();
    await s.inbound(CUSTOMER, "I want the monthly lunch plan");
    assert.ok(!s.templatesTo(CUSTOMER).some((t) => t.startsWith("plan_")));
    assert.ok(!s.record().some((r) => r.action.startsWith("plan")));
  });
});
