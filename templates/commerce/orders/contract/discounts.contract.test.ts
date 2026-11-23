// E1, THE DISCOUNT AUTHORITY (decision 64, 24 Nov 2026), as the outside sees an Orders shop: a customer's price below the menu on WhatsApp, decided by the item's floor and
// the cap the agent may give alone (go/internal/discounts), on the whole line (quantity included). Off by default: a shop with no "discounts" block refuses every price below
// the menu exactly as before. Within the cap the agent agrees and the order's total, advance and payment request follow the agreed total; beyond it the owner gets a card
// answered with the order AND the card's code, and the request is made for exactly the total the card showed; a changed quantity voids the card; below the floor it is refused.
// A "fakes" UPI shop on the TEST clock (Mon 9 Nov 2026, 10:00 in India): the advance is what the owner's page shows to mark (amountPaise). Annapurna's veg thali is ₹120 and
// the advance half the total.
import { after, describe } from "node:test";
import assert from "node:assert/strict";
import { CUSTOMER, OWNER_NUMBER, contract, makeShop } from "./harness.ts";
import type { Shop } from "./harness.ts";

const shops: Shop[] = [];
after(async () => { for (const s of shops) { await s.stop(); await s.cleanup(); } });
async function boot(o: Parameters<typeof makeShop>[0] = {}): Promise<Shop> { const s = await makeShop(o); shops.push(s); await s.start(); return s; }
// a floor of ₹100 a veg thali; the agent may take off 10% of the line or ₹100, the lower: two thalis (₹240) give ₹24
const ON = { discounts: { capPercent: 10, capInr: 100, floors: { "veg-thali": 100 } } };
const discountLines = (s: Shop) => s.record().filter((r) => r.action === "discount");
const codeOf = (s: Shop) => discountLines(s).filter((r) => r.outcome === "held_for_owner").at(-1)!.refs.code;
const advanceAsked = async (s: Shop): Promise<number[]> => ((await s.ownerView()).body.items as { kind: string; amountPaise: number }[]).filter((i) => i.kind === "deposit").map((i) => i.amountPaise);
async function ask(s: Shop, qty: number, price: number): Promise<void> { await s.inbound(CUSTOMER, `${qty} veg thali 10 nov 12:00 pm pickup for ${price}`); await s.settle(); }

describe("the discount authority, off by default", () => {
  contract("no discounts block: a price below the menu is refused as before and the advance is half the menu total", async () => {
    const s = await boot();
    await ask(s, 2, 110);
    assert.ok(s.templatesTo(CUSTOMER).includes("price_floor"));
    assert.deepEqual(await advanceAsked(s), [12000]);
    assert.deepEqual(discountLines(s), []);
  });
});

describe("the discount authority, on", () => {
  contract("within the cap (2 × ₹12 = ₹24 off, exactly the cap): agreed, and the total, the advance and the payment request follow ₹216", async () => {
    const s = await boot({ settings: ON });
    await ask(s, 2, 108);
    assert.deepEqual(s.templatesTo(CUSTOMER), ["discount_agreed", "quote_and_link"]);
    assert.deepEqual(await advanceAsked(s), [10800], "half of ₹216");
    const [line] = discountLines(s);
    assert.deepEqual([line.outcome, line.refs.by, line.refs.qty, line.refs.discountInr, line.refs.totalInr], ["confirmed", "agent", "2", "24", "216"]);
  });

  contract("beyond the cap: one card, nothing held; the owner's yes with the card's code makes the request for exactly the card's total", async () => {
    const s = await boot({ settings: ON });
    await ask(s, 2, 100);
    assert.deepEqual(await advanceAsked(s), [], "nothing held before the owner answers");
    assert.deepEqual(s.templatesTo(CUSTOMER), ["discount_asked"]);
    assert.deepEqual(s.templatesTo(CUSTOMER, "owner"), ["owner_discount_ask"]);
    const code = codeOf(s);
    assert.equal(discountLines(s)[0].refs.totalInr, "200");
    await s.inbound(OWNER_NUMBER, `approve o-1 ${code}`); await s.settle();
    assert.deepEqual(await advanceAsked(s), [10000], "half of exactly ₹200");
    assert.deepEqual(s.templatesTo(CUSTOMER).slice(-2), ["discount_approved", "quote_and_link"]);
    assert.deepEqual(discountLines(s).map((r) => [r.outcome, r.refs.by ?? "", r.refs.totalInr]), [["held_for_owner", "", "200"], ["confirmed", "owner", "200"]]);
    await s.inbound(OWNER_NUMBER, `approve o-1 ${code}`); await s.settle();
    assert.deepEqual(await advanceAsked(s), [10000], "the same yes again changes nothing");
  });

  contract("the owner's no: the customer is offered the menu total", async () => {
    const s = await boot({ settings: ON });
    await ask(s, 2, 100);
    await s.inbound(OWNER_NUMBER, `deny o-1 ${codeOf(s)}`); await s.settle();
    assert.deepEqual(s.templatesTo(CUSTOMER).slice(-2), ["discount_refused", "quote_and_link"]);
    assert.deepEqual(await advanceAsked(s), [12000]);
  });

  contract("below the floor: refused as before, counted as refused by the rule", async () => {
    const s = await boot({ settings: ON });
    await ask(s, 2, 90);
    assert.ok(s.templatesTo(CUSTOMER).includes("price_floor"));
    assert.deepEqual(await advanceAsked(s), [12000]);
    assert.deepEqual(discountLines(s).map((r) => [r.outcome, r.refs.by]), [["blocked", "rule"]]);
  });

  contract("a changed quantity after the card voids it: a new card for the new total, the old card's yes is refused, the new one's goes through", async () => {
    const s = await boot({ settings: ON });
    await ask(s, 2, 100);
    const old = codeOf(s);
    await s.inbound(CUSTOMER, "3 veg thali 10 nov 12:00 pm pickup"); await s.settle();
    const fresh = codeOf(s);
    assert.notEqual(fresh, old);
    assert.equal(discountLines(s).at(-1)!.refs.totalInr, "300", "three at ₹100");
    await s.inbound(OWNER_NUMBER, `approve o-1 ${old}`); await s.settle();
    assert.deepEqual(await advanceAsked(s), [], "the old card's yes made nothing");
    assert.ok(s.templatesTo(OWNER_NUMBER, "owner").includes("owner_discount_stale") || s.record().some((r) => r.action === "owner_decision" && r.outcome === "blocked" && r.refs.kind === "discount"));
    await s.inbound(OWNER_NUMBER, `approve o-1 ${fresh}`); await s.settle();
    assert.deepEqual(await advanceAsked(s), [15000], "half of exactly ₹300");
  });

  contract("the report counts: discounts given (rupees), asked of the owner and refused, from the runtime's own record", async () => {
    const s = await boot({ settings: ON });
    await ask(s, 2, 100);
    await s.inbound(OWNER_NUMBER, `approve o-1 ${codeOf(s)}`); await s.settle();
    await s.inbound("+919855555555", "2 veg thali 10 nov 12:00 pm pickup for 90"); await s.settle();
    const { discountsOfMonth } = await import("../../../../modules/limits/discounts.ts");
    assert.deepEqual(discountsOfMonth(s.record()), { given: { count: 1, paise: 4000 }, asked: 1, refused: 1 }, "₹40 off given by the owner's yes, one asked, one below the floor");
    assert.ok(s.record().some((l) => l.action === "owner_decision" && l.outcome === "confirmed" && l.refs.kind === "discount"));
  });

  contract("a retry makes no second card; a plain \"approve o-1\" is told the card's words and does nothing", async () => {
    const s = await boot({ settings: ON });
    await ask(s, 2, 100);
    await ask(s, 2, 100);
    assert.equal(discountLines(s).filter((r) => r.outcome === "held_for_owner").length, 1);
    assert.deepEqual(s.templatesTo(CUSTOMER, "owner"), ["owner_discount_ask"], "one card");
    await s.inbound(OWNER_NUMBER, "approve o-1"); await s.settle();
    assert.ok(s.templatesTo(CUSTOMER, "owner").includes("owner_discount_use_code"));
    assert.deepEqual(await advanceAsked(s), []);
  });
});
