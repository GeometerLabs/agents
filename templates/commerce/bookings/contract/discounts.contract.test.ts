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
