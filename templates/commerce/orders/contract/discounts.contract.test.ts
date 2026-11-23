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

// The price card on the owner's page (E1 item 2, 24 Nov 2026): the same card as on WhatsApp, with its numbers, answered by a press that the runtime turns into the owner's own
// "approve o-1 <code>" (go/internal/orders agent_channel.go onOwnerAction), so one decision path and one count, whichever door the answer comes through.
type PageItem = { kind: string; case: string; digest: string; actions: string[]; amountPaise: number; deal?: { name: string; qty: number; listInr: number; offeredInr: number; totalInr: number } };
const pageCard = async (s: Shop): Promise<PageItem | undefined> => ((await s.ownerView()).body.items as PageItem[]).find((i) => i.kind === "discount");
async function press(s: Shop, item: PageItem, action: "approve" | "deny"): Promise<void> {
  const a = await s.channelEvents([{ kind: "owner_action", id: `press-${action}-${item.digest.slice(0, 6)}-${s.record().length}`, action, case: item.case, digest: item.digest }], { owner: true });
  assert.equal(a.status, 200);
  await s.settle();
}

describe("the price card on the owner's page", () => {
  contract("it waits with the item, the quantity, the menu price, the price asked and the total (never its code); Approve there makes the request for exactly that total", async () => {
    const s = await boot({ settings: ON });
    await ask(s, 2, 100);
    const item = await pageCard(s);
    assert.ok(item, "the card is on the page");
    assert.deepEqual([item.case, item.actions, item.amountPaise, item.deal], ["o-1", ["approve", "deny"], 20000, { name: "veg thali", qty: 2, listInr: 120, offeredInr: 100, totalInr: 200 }]);
    assert.doesNotMatch(JSON.stringify(item), new RegExp(codeOf(s), "u"), "the card's code is not on the page");
    await press(s, item, "approve");
    assert.deepEqual(await advanceAsked(s), [10000], "half of exactly ₹200");
    assert.deepEqual(s.templatesTo(CUSTOMER).slice(-2), ["discount_approved", "quote_and_link"]);
    assert.deepEqual(discountLines(s).map((r) => [r.outcome, r.refs.by ?? "", r.refs.totalInr]), [["held_for_owner", "", "200"], ["confirmed", "owner", "200"]]);
    assert.equal(await pageCard(s), undefined, "answered: the card is gone from the page");
  });

  contract("Refuse there is the owner's no: the customer is offered the menu total", async () => {
    const s = await boot({ settings: ON });
    await ask(s, 2, 100);
    await press(s, (await pageCard(s))!, "deny");
    assert.deepEqual(s.templatesTo(CUSTOMER).slice(-2), ["discount_refused", "quote_and_link"]);
    assert.deepEqual(await advanceAsked(s), [12000]);
  });

  contract("a stale card's press is refused: the order changed after the page was shown, so the old press does nothing and the new card still waits", async () => {
    const s = await boot({ settings: ON });
    await ask(s, 2, 100);
    const old = (await pageCard(s))!;
    await s.inbound(CUSTOMER, "3 veg thali 10 nov 12:00 pm pickup"); await s.settle();
    const fresh = (await pageCard(s))!;
    assert.notEqual(fresh.digest, old.digest);
    assert.equal(fresh.deal?.totalInr, 300);
    await press(s, old, "approve");
    assert.deepEqual(await advanceAsked(s), [], "nothing held");
    assert.equal(discountLines(s).filter((r) => r.outcome === "confirmed").length, 0);
    assert.ok(s.record().some((r) => r.action === "owner_page_action" && r.outcome === "blocked"), "the press is in the record, refused");
    assert.deepEqual(await pageCard(s), fresh, "the new card still waits");
  });

  contract("a WhatsApp yes then a page press for the same card count once", async () => {
    const s = await boot({ settings: ON });
    await ask(s, 2, 100);
    const shown = (await pageCard(s))!;
    await s.inbound(OWNER_NUMBER, `approve o-1 ${codeOf(s)}`); await s.settle();
    await press(s, shown, "approve");
    assert.deepEqual(await advanceAsked(s), [10000], "one request");
    assert.equal(discountLines(s).filter((r) => r.outcome === "confirmed").length, 1, "one approval in the record");
    assert.ok(s.record().some((r) => r.action === "owner_page_action" && r.outcome === "blocked"));
  });
});

describe("the price card in the assistant's \"what needs me\"", () => {
  contract("it is listed as a card with the order's total; its yes is the owner's own \"approve o-1 <code>\", decided once", async () => {
    const s = await boot({ mode: "guards", settings: { ...ON, assistant: {} } });
    await ask(s, 2, 100);
    await s.inbound(OWNER_NUMBER, "what needs me"); await s.settle();
    const card = s.sent(OWNER_NUMBER).filter((m) => m.interactive).at(-1)!;
    assert.match(card.text, /^\+919844444444 asks a lower price than your list for o-1 \(2 × veg thali\): ₹200 in all\. Agree to it\?/u);
    await s.tap(card.interactive.buttons[0].id, { from: OWNER_NUMBER }); await s.settle();
    assert.deepEqual(discountLines(s).map((r) => [r.outcome, r.refs.by ?? "", r.refs.totalInr]), [["held_for_owner", "", "200"], ["confirmed", "owner", "200"]]);
    assert.ok(s.record().some((r) => r.action === "owner_decision" && r.outcome === "confirmed" && r.refs.kind === "discount"));
    assert.equal(await pageCard(s), undefined, "answered once: nothing waits on the page");
  });
});

// "Any discount?" without a number (E1 item 3, 24 Nov 2026): read by the rules in four languages. With the authority on, the agent offers the lowest price it may give alone for
// the order's item (two veg thalis at ₹120: 10% of the line is ₹24, so ₹108 each, never below the ₹100 floor), decided and recorded as any price within the cap, and the advance
// follows the agreed total; with no item yet it asks which one. With it off, today's answer.
describe("a discount asked without a price", () => {
  contract("on: in each language, ₹108 each is offered and agreed, recorded once, and the advance is half of ₹216", async () => {
    for (const ask of ["any discount?", "कुछ छूट मिलेगी?", "ഇളവ് ഉണ്ടോ", "ರಿಯಾಯಿತಿ ಇದೆಯಾ"]) {
      const s = await boot({ settings: ON });
      await s.inbound(CUSTOMER, `2 veg thali 10 nov 12:00 pm pickup, ${ask}`); await s.settle();
      assert.deepEqual(s.templatesTo(CUSTOMER), ["discount_agreed", "quote_and_link"], ask);
      assert.deepEqual(await advanceAsked(s), [10800], ask);
      assert.deepEqual(discountLines(s).map((r) => [r.outcome, r.refs.by, r.refs.offeredInr, r.refs.totalInr]), [["confirmed", "agent", "108", "216"]], ask);
    }
  });

  contract("on: with nothing ordered yet, the agent asks which item, and nothing is decided", async () => {
    const s = await boot({ settings: ON });
    await s.inbound(CUSTOMER, "any discount?"); await s.settle();
    assert.deepEqual(s.templatesTo(CUSTOMER), ["discount_which"]);
    assert.deepEqual(discountLines(s), []);
  });

  contract("off: today's answer, and the advance stays half the menu total", async () => {
    const s = await boot();
    await s.inbound(CUSTOMER, "any discount?"); await s.settle();
    assert.deepEqual(s.templatesTo(CUSTOMER), ["didnt_understand"]);
    await s.inbound(CUSTOMER, "2 veg thali 10 nov 12:00 pm pickup, any discount?"); await s.settle();
    assert.deepEqual(s.templatesTo(CUSTOMER).slice(-1), ["quote_and_link"]);
    assert.deepEqual(await advanceAsked(s), [12000]);
    assert.deepEqual(discountLines(s), []);
  });
});
