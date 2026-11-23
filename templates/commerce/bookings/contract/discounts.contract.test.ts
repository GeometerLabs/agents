// E1, THE DISCOUNT AUTHORITY (decision 64, 24 Nov 2026), as the outside sees a Bookings shop: a customer's price below the list on WhatsApp, decided by the shop's floor and
// the cap the agent may give alone (go/internal/discounts). Off by default: a shop with no "discounts" block refuses every price below the list exactly as before. Within the
// cap the agent agrees; beyond it the owner gets a card answered with the booking AND the card's code, and only an answer to the card that waits does anything; below the
// floor it is refused. The deposit link stays the deposit (Guard holds it to exactly that, and a floor is never below it); the agreed price is in the record and the words.
// Guards mode (the WhatsApp stand-in shows the words, the payments Guard the links). Expected values worked out from the Glow Salon example: a haircut is ₹450, the deposit ₹200.
import { after, describe } from "node:test";
import assert from "node:assert/strict";
import { CUSTOMER, TZ, contract, makeShop, openStart } from "./harness.ts";
import type { Shop } from "./harness.ts";

const OWNER = "+919000000000";
const shops: Shop[] = [];
after(async () => { for (const s of shops) { await s.stop(); await s.cleanup(); } });
async function boot(o: Parameters<typeof makeShop>[0] = {}): Promise<Shop> { const s = await makeShop({ mode: "guards", ...o }); shops.push(s); await s.start(); return s; }
// a floor of ₹300 on the haircut; the agent may take off 10% (₹45 of ₹450) or ₹100, the lower: ₹45
const ON = { discounts: { capPercent: 10, capInr: 100, floors: { haircut: 300 } } };
const links = (s: Shop) => s.guards!.of("payments", "POST", /^\/v1\/payment_links$/u);
const words = (s: Shop, to: string) => s.sent(to).map((m) => m.text).join("\n");
const discountLines = (s: Shop) => s.record().filter((r) => r.action === "discount");
const dayOf = (ms: number) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "numeric", month: "short" }).format(ms);
async function ask(s: Shop, price: number): Promise<void> { await s.inbound(CUSTOMER, `haircut on ${dayOf(openStart(s.now(), 3))} at 11am for ${price}`); await s.settle(); }
const codeOf = (s: Shop) => discountLines(s).filter((r) => r.outcome === "held_for_owner").at(-1)!.refs.code;

describe("the discount authority, off by default", () => {
  contract("no discounts block: a price below the list is refused as before, the deposit link is made at the list, and nothing is asked of the owner", async () => {
    const s = await boot();
    await ask(s, 410);
    assert.match(words(s, CUSTOMER), /₹450/u);
    assert.deepEqual(links(s).map((l) => l.body.amount), [20000]);
    assert.deepEqual(discountLines(s), [], "no discount line in the record");
    assert.ok(s.record().some((r) => r.action === "send_message" && (r.refs.templates ?? "").includes("price_floor")));
    assert.equal(s.sent(OWNER).length, 0);
  });
});

describe("the discount authority, on", () => {
  contract("within the cap (₹40 off, ₹45 allowed): the agent agrees, the quote names the agreed price, the record says the agent gave ₹40, the link is the deposit", async () => {
    const s = await boot({ settings: ON });
    await ask(s, 410);
    assert.match(words(s, CUSTOMER), /I can do ₹410/u);
    assert.deepEqual(links(s).map((l) => l.body.amount), [20000]);
    const [line] = discountLines(s);
    assert.deepEqual([line.outcome, line.refs.by, line.refs.discountInr, line.refs.totalInr, line.refs.rule], ["confirmed", "agent", "40", "410", "discount-authority"]);
    assert.equal(s.sent(OWNER).length, 0, "the owner is not asked");
  });

  contract("a price agreed before the time is known: the quote in the later message says the agreed price again and never the list price", async () => {
    const s = await boot({ settings: ON });
    await s.inbound(CUSTOMER, "haircut for 410"); await s.settle();
    assert.match(words(s, CUSTOMER), /I can do ₹410/u);
    const before = s.sent(CUSTOMER).length;
    await s.inbound(CUSTOMER, `haircut on ${dayOf(openStart(s.now(), 3))} at 11am`); await s.settle();
    const quote = s.sent(CUSTOMER).slice(before).map((m) => m.text).join("\n");
    assert.match(quote, /I can do ₹410/u);
    assert.doesNotMatch(quote, /₹450/u, "the list price is not quoted after the agreement");
    assert.deepEqual(links(s).map((l) => l.body.amount), [20000]);
    assert.equal(discountLines(s).length, 1, "one decision, recorded once");
  });

  contract("the report counts: discounts given (rupees), asked of the owner and refused, from the runtime's own record", async () => {
    const s = await boot({ settings: ON });
    await ask(s, 410); // given by the agent, ₹40
    const r = await boot({ settings: ON });
    await ask(r, 350);
    await r.inbound(OWNER, `deny b-1 ${codeOf(r)}`); await r.settle();
    const counts = (shop: Shop) => {
      const lines = discountLines(shop);
      return { given: lines.filter((l) => l.outcome === "confirmed").reduce((n, l) => n + Number(l.refs.discountInr) * 100, 0), asked: lines.filter((l) => l.outcome === "held_for_owner").length, refused: lines.filter((l) => l.outcome === "blocked").length };
    };
    assert.deepEqual(counts(s), { given: 4000, asked: 0, refused: 0 });
    assert.deepEqual(counts(r), { given: 0, asked: 1, refused: 1 });
    // the report's own count over these lines (modules/limits/discounts.ts, the same as go/internal/discounts Count)
    const { discountsOfMonth } = await import("../../../../modules/limits/discounts.ts");
    assert.deepEqual(discountsOfMonth(r.record()), { given: { count: 0, paise: 0 }, asked: 1, refused: 1 });
    assert.deepEqual(discountsOfMonth(s.record()), { given: { count: 1, paise: 4000 }, asked: 0, refused: 0 });
    assert.ok(r.record().some((l) => l.action === "owner_decision" && l.outcome === "confirmed" && l.refs.kind === "discount"), "the owner's answer is in the record, named as a price card's");
  });

  contract("exactly the cap (₹45 off) is agreed; one rupee more goes to the owner", async () => {
    const a = await boot({ settings: ON });
    await ask(a, 405);
    assert.equal(discountLines(a)[0].outcome, "confirmed");
    const b = await boot({ settings: ON });
    await ask(b, 404);
    assert.equal(discountLines(b)[0].outcome, "held_for_owner");
  });

  contract("beyond the cap: the owner gets one card with the exact price and its code; nothing is held; the yes to that card makes the link and the customer hears the agreed price", async () => {
    const s = await boot({ settings: ON });
    await ask(s, 350);
    assert.deepEqual(links(s), [], "nothing held, no link before the owner answers");
    assert.match(words(s, CUSTOMER), /asked the owner about ₹350/u);
    const code = codeOf(s);
    assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/u);
    const card = words(s, OWNER);
    assert.match(card, new RegExp(`asks ₹350 for haircut \\(your price is ₹450\\)\\. Reply "approve b-1 ${code}" to agree to exactly ₹350`, "u"));
    await s.inbound(OWNER, `approve b-1 ${code}`); await s.settle();
    assert.deepEqual(links(s).map((l) => l.body.amount), [20000], "the deposit link, once");
    assert.match(words(s, CUSTOMER), /the owner agreed to ₹350/u);
    const approved = discountLines(s).filter((r) => r.outcome === "confirmed");
    assert.deepEqual(approved.map((r) => [r.refs.by, r.refs.totalInr, r.refs.code]), [["owner", "350", code]]);
    // the same answer again does nothing
    await s.inbound(OWNER, `approve b-1 ${code}`); await s.settle();
    assert.equal(links(s).length, 1);
    assert.match(words(s, OWNER), /already answered, so nothing was done/u);
  });

  contract("the owner's no: the customer is offered the list price, and the record says the owner refused", async () => {
    const s = await boot({ settings: ON });
    await ask(s, 350);
    await s.inbound(OWNER, `deny b-1 ${codeOf(s)}`); await s.settle();
    assert.match(words(s, CUSTOMER), /couldn't agree to ₹350\. The lowest for your haircut is ₹450/u);
    assert.deepEqual(links(s).map((l) => l.body.amount), [20000]);
    assert.deepEqual(discountLines(s).map((r) => [r.outcome, r.refs.by ?? ""]), [["held_for_owner", ""], ["blocked", "owner"]]);
  });

  contract("below the floor: refused as before with the list price stated, and counted as a refusal by the rule", async () => {
    const s = await boot({ settings: ON });
    await ask(s, 250);
    assert.match(words(s, CUSTOMER), /Our haircut is ₹450\. Sorry, I can't go lower than that\./u);
    assert.deepEqual(links(s).map((l) => l.body.amount), [20000]);
    assert.deepEqual(discountLines(s).map((r) => [r.outcome, r.refs.by]), [["blocked", "rule"]]);
    assert.equal(s.sent(OWNER).length, 0);
  });

  contract("a changed ask after the card voids it: the old card's yes is refused, nothing is held; the new card's yes goes through", async () => {
    const s = await boot({ settings: ON });
    await ask(s, 350);
    const old = codeOf(s);
    await ask(s, 340);
    const fresh = codeOf(s);
    assert.notEqual(fresh, old);
    await s.inbound(OWNER, `approve b-1 ${old}`); await s.settle();
    assert.deepEqual(links(s), [], "the old card's yes made nothing");
    assert.ok(s.record().some((r) => r.action === "owner_decision" && r.outcome === "blocked" && r.refs.kind === "discount"));
    await s.inbound(OWNER, `approve b-1 ${fresh}`); await s.settle();
    assert.equal(links(s).length, 1);
    assert.match(words(s, CUSTOMER), /the owner agreed to ₹340/u);
  });

  contract("a retry makes no second card: the same ask twice, and a plain \"approve b-1\", send the owner one card", async () => {
    const s = await boot({ settings: ON });
    await ask(s, 350);
    await ask(s, 350);
    assert.equal(discountLines(s).filter((r) => r.outcome === "held_for_owner").length, 1, "one ask in the record");
    assert.equal(s.sent(OWNER).filter((m) => /A price needs your OK/u.test(m.text)).length, 1, "one card");
    await s.inbound(OWNER, "approve b-1"); await s.settle();
    assert.match(words(s, OWNER), new RegExp(`reply "approve b-1 ${codeOf(s)}"`, "u"), "the owner is told the exact words");
    assert.deepEqual(links(s), [], "and nothing was done");
  });
});

// The price card on the owner's page (E1 item 2, 24 Nov 2026): the same card as on WhatsApp, with its numbers, answered by a press that the runtime turns into the owner's own
// "approve b-1 <code>" (go/internal/bookings agent_channel.go onOwnerAction), so one decision path and one count, whichever door the answer comes through.
type PageItem = { kind: string; case: string; digest: string; actions: string[]; amountPaise: number; deal?: { name: string; qty: number; listInr: number; offeredInr: number; totalInr: number } };
const pageCard = async (s: Shop): Promise<PageItem | undefined> => ((await s.ownerView()).body.items as PageItem[]).find((i) => i.kind === "discount");
async function press(s: Shop, item: PageItem, action: "approve" | "deny"): Promise<void> {
  const a = await s.channelEvents([{ kind: "owner_action", id: `press-${action}-${item.digest.slice(0, 6)}-${s.record().length}`, action, case: item.case, digest: item.digest }], { owner: true });
  assert.equal(a.status, 200);
  await s.settle();
}

describe("the price card on the owner's page", () => {
  contract("it waits with the service, the list price, the price asked and the total (never its code); Approve there agrees exactly as the WhatsApp yes", async () => {
    const s = await boot({ settings: ON });
    await ask(s, 350);
    const item = await pageCard(s);
    assert.ok(item, "the card is on the page");
    assert.deepEqual([item.case, item.actions, item.amountPaise, item.deal], ["b-1", ["approve", "deny"], 35000, { name: "haircut", qty: 1, listInr: 450, offeredInr: 350, totalInr: 350 }]);
    assert.doesNotMatch(JSON.stringify(item), new RegExp(codeOf(s), "u"), "the card's code is not on the page");
    await press(s, item, "approve");
    assert.deepEqual(links(s).map((l) => l.body.amount), [20000], "the deposit link, once");
    assert.match(words(s, CUSTOMER), /the owner agreed to ₹350/u);
    assert.deepEqual(discountLines(s).map((r) => [r.outcome, r.refs.by ?? "", r.refs.totalInr]), [["held_for_owner", "", "350"], ["confirmed", "owner", "350"]]);
    assert.equal(await pageCard(s), undefined, "answered: the card is gone from the page");
  });

  contract("Refuse there is the owner's no: the customer is offered the list price", async () => {
    const s = await boot({ settings: ON });
    await ask(s, 350);
    await press(s, (await pageCard(s))!, "deny");
    assert.match(words(s, CUSTOMER), /couldn't agree to ₹350\. The lowest for your haircut is ₹450/u);
    assert.deepEqual(discountLines(s).map((r) => [r.outcome, r.refs.by ?? ""]), [["held_for_owner", ""], ["blocked", "owner"]]);
  });

  contract("a stale card's press is refused: the ask changed after the page was shown, so the old press does nothing and the new card still waits", async () => {
    const s = await boot({ settings: ON });
    await ask(s, 350);
    const old = (await pageCard(s))!;
    await ask(s, 340);
    const fresh = (await pageCard(s))!;
    assert.notEqual(fresh.digest, old.digest);
    assert.equal(fresh.deal?.offeredInr, 340);
    await press(s, old, "approve");
    assert.deepEqual(links(s), [], "nothing was agreed or held");
    assert.equal(discountLines(s).filter((r) => r.outcome === "confirmed").length, 0);
    assert.ok(s.record().some((r) => r.action === "owner_page_action" && r.outcome === "blocked"), "the press is in the record, refused");
    assert.deepEqual(await pageCard(s), fresh, "the new card still waits");
  });

  contract("a WhatsApp yes then a page press for the same card count once", async () => {
    const s = await boot({ settings: ON });
    await ask(s, 350);
    const shown = (await pageCard(s))!;
    await s.inbound(OWNER, `approve b-1 ${codeOf(s)}`); await s.settle();
    await press(s, shown, "approve");
    assert.deepEqual(links(s).map((l) => l.body.amount), [20000], "one link");
    assert.equal(discountLines(s).filter((r) => r.outcome === "confirmed").length, 1, "one approval in the record");
    assert.ok(s.record().some((r) => r.action === "owner_page_action" && r.outcome === "blocked"));
  });
});

// "Any discount?" without a number (E1 item 3, 24 Nov 2026): read by the rules in four languages. With the authority on, the agent offers the lowest price it may give alone (the
// lower of the two caps, never below the floor: ₹45 off the ₹450 haircut is ₹405), decided and recorded as any price within the cap; with no service yet it asks which one.
// With it off, today's answer.
describe("a discount asked without a price", () => {
  contract("on: in each language, the agent offers ₹405 for the haircut, recorded once as given by the agent; the deposit link stays the deposit", async () => {
    for (const text of ["any discount on haircut?", "haircut पर कुछ छूट मिलेगी?", "haircut ഇളവ് ഉണ്ടോ", "haircut ರಿಯಾಯಿತಿ ಇದೆಯಾ"]) {
      const s = await boot({ settings: ON });
      await s.inbound(CUSTOMER, text); await s.settle();
      const [line] = discountLines(s);
      assert.deepEqual([line?.outcome, line?.refs.by, line?.refs.offeredInr, line?.refs.discountInr], ["confirmed", "agent", "405", "45"], text);
      assert.match(s.sent(CUSTOMER)[0].text, /₹405/u, text);
      await s.inbound(CUSTOMER, `${dayOf(openStart(s.now(), 3))} at 11am`); await s.settle();
      assert.deepEqual(links(s).map((l) => l.body.amount), [20000], text);
      assert.equal(discountLines(s).length, 1, `${text}: one decision`);
    }
  });

  contract("on: with no service in the conversation, the agent asks which one, and nothing is decided", async () => {
    const s = await boot({ settings: ON });
    await s.inbound(CUSTOMER, "any discount?"); await s.settle();
    assert.match(s.sent(CUSTOMER)[0].text, /^Which service is it for\?/u);
    assert.deepEqual(discountLines(s), []);
  });

  contract("on: a card waiting for the owner is not voided, and a lower price the owner approved stands", async () => {
    const s = await boot({ settings: ON });
    await s.inbound(CUSTOMER, "haircut for 350"); await s.settle(); // no time yet: nothing is held, so the booking stays the one the deal is on
    const code = codeOf(s);
    await s.inbound(CUSTOMER, "any discount?"); await s.settle();
    assert.match(s.sent(CUSTOMER).at(-1)!.text, /asked the owner about ₹350/u);
    assert.equal(codeOf(s), code, "the same card");
    assert.equal(discountLines(s).length, 1, "no second decision");
    await s.inbound(OWNER, `approve b-1 ${code}`); await s.settle();
    await s.inbound(CUSTOMER, "any discount on haircut?"); await s.settle();
    assert.match(s.sent(CUSTOMER).at(-1)!.text, /₹350/u, "the approved ₹350 is said again, not replaced by ₹405");
    assert.deepEqual(discountLines(s).map((r) => [r.outcome, r.refs.offeredInr]), [["held_for_owner", "350"], ["confirmed", "350"]]);
  });

  contract("off: today's answer, and nothing is decided or recorded as a discount", async () => {
    const s = await boot();
    await s.inbound(CUSTOMER, "any discount?"); await s.settle();
    assert.match(s.sent(CUSTOMER)[0].text, /^Sorry, I didn't catch that\. Which service would you like, and on what day and time\?\nhaircut: ₹450/u);
    await s.inbound(CUSTOMER, "any discount on haircut?"); await s.settle();
    assert.match(s.sent(CUSTOMER).at(-1)!.text, /^When would you like your haircut\?/u);
    assert.deepEqual(discountLines(s), []);
  });
});
