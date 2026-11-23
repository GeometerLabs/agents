// THE MONEY GAPS (group (ix) of the contract, README.md; 23 Nov 2026, stream OG): money, limit, approval and licence behaviour that, until now, only a TypeScript unit test in
// test/ checked. Those unit tests go when the TypeScript runtime is deleted (decision 61), so each behaviour is held here on both runtimes, over HTTP and the files only. Where
// each came from: test/agent (the same order again, a part of the UPI money marked), test/reminder-balance (the balance), test/late-advance-card (the 48-hour and 14-day
// windows), test/slot-capacity (a slot's place given back), test/licence (Guard's own licence refusal), test/assistant-acts (the owner's cancel and refund from the chat).
// go/TRIAL.md's section "go-orders-gaps-23nov" lists every such behaviour and what holds it now. The last describe holds two TypeScript findings fixed on both sides.
//
// Fakes shops run on the TEST clock at Mon 9 Nov 2026, 10:00 in India (tomorrow is Tue 10 Nov); guards shops on the real clock order two days ahead (`orderDay`), and a
// cancellation window of 96 hours makes their cancellation a late one, as in money.contract.test.ts.
import { after, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CUSTOMER, MIN, OWNER_NUMBER, RAJESH, beat, contract, makeShop } from "./harness.ts";
import { fixture } from "./guards.ts";
import type { Shop } from "./harness.ts";

const shops: Shop[] = [];
after(async () => { for (const s of shops) { await s.stop(); await s.cleanup(); } });
async function boot(o: Parameters<typeof makeShop>[0] = {}): Promise<Shop> { const s = await makeShop(o); shops.push(s); await s.start(); return s; }
const ASSISTANT = { assistant: {} };
/** Tuesday's lunch on the test clock, as a customer writes it. */
const LUNCH = "2 veg thali 10 nov 12:00 pm pickup";
/** The same order two days ahead, for a shop on the real clock. */
const lunchOn = (s: Shop, qty = 2) => `${qty} veg thali ${s.orderDay().words} 12:00 pm pickup`;
const items = async (s: Shop, kind: string) => ((await s.ownerView()).body.items as { kind: string; amountPaise: number; case: string }[]).filter((i) => i.kind === kind);
const lines = (s: Shop, action: string, outcome = "confirmed") => s.record().filter((r) => r.action === action && r.outcome === outcome);
const links = (s: Shop) => s.guards!.standins.fakes.payments.links();
const refunds = (s: Shop) => s.guards!.standins.fakes.payments.refunds();
async function deliver(s: Shop, events: unknown[]): Promise<void> {
  const answer = await s.events(events.map((event) => ({ kind: "payment_event", event })));
  assert.equal(answer.status, 200, JSON.stringify(answer.body));
  await s.settle();
}
/** The newest card the shop's assistant sent the owner (guards mode): its words and its yes and no ids. */
function lastCard(s: Shop): { text: string; yes: string; no?: string } {
  const card = s.sent(OWNER_NUMBER).filter((m) => m.interactive?.buttons?.some((b: { id: string }) => b.id.startsWith("card-"))).at(-1);
  assert.ok(card, `a card was sent to the owner: ${JSON.stringify(s.sent(OWNER_NUMBER).map((m) => m.text))}`);
  return { text: card.text, yes: card.interactive.buttons[0].id, no: card.interactive.buttons[1]?.id };
}
/** The one-use code of the newest UPI payment the owner was asked to check (guards mode, a UPI shop): their message says 'reply "received P8ZS6Z"'. */
function upiCode(s: Shop): string {
  const code = s.sent(OWNER_NUMBER).map((m) => /reply "received ([A-Z0-9]+)"/u.exec(m.text)?.[1]).filter((c) => c !== undefined).at(-1);
  assert.ok(code, `the owner was asked to check a UPI payment: ${JSON.stringify(s.sent(OWNER_NUMBER).map((m) => m.text))}`);
  return code;
}

describe("an order's money, said again or in part", () => {
  contract("the same order written again keeps its one link; a changed order replaces it, its old link is closed, and the old quantity is free again", async () => {
    const s = await boot({ mode: "guards" });
    await s.inbound(CUSTOMER, lunchOn(s));
    await s.inbound(CUSTOMER, lunchOn(s));
    assert.equal(s.guards!.of("payments", "POST", /^\/v1\/payment_links$/u).length, 1, "one link for one order");
    const day = (await s.call("/internal/channel/offer")).body.days.find((d: { date: string }) => d.date === s.orderDay().iso);
    assert.equal(day.left["veg-thali"], 10);
    await s.inbound(CUSTOMER, lunchOn(s, 3));
    assert.equal(links(s).filter((l) => l.status !== "cancelled").length, 1, "the first link is closed, the changed order has its own");
    assert.deepEqual(links(s).filter((l) => l.status !== "cancelled").map((l) => l.amount), [18000], "half of 3 x ₹120");
    const after = (await s.call("/internal/channel/offer")).body.days.find((d: { date: string }) => d.date === s.orderDay().iso);
    assert.equal(after.left["veg-thali"], 9, "the first order's 2 are free again; the new order holds 3");
  });

  contract("a UPI mark of less than the advance does not confirm the order; the rest marked after it does, and nothing is owed back", async () => {
    const s = await boot({ mode: "guards", example: "upi" });
    await s.inbound(CUSTOMER, lunchOn(s));
    const code = upiCode(s);
    await s.inbound(OWNER_NUMBER, `received ${code} 50`);
    assert.deepEqual((await s.status()).orders, { awaiting_advance: 1 }, "₹50 of ₹120 is not the advance");
    await s.inbound(OWNER_NUMBER, `received ${upiCode(s)} 70`);
    assert.deepEqual((await s.status()).orders, { confirmed: 1 });
    assert.equal(lines(s, "confirm_order").length, 1);
    assert.deepEqual(await items(s, "refund_owed"), [], "the two marks make the advance exactly");
  });
});

describe("the balance at pickup", () => {
  contract("the owner marks the balance received in cash once; a second mark, a customer's word and a UPI shop's 'link' record nothing more", async () => {
    const s = await boot();
    await s.inbound(CUSTOMER, LUNCH);
    await s.ownerPress("deposit", "received");
    assert.deepEqual((await s.status()).orders, { confirmed: 1 });
    await s.inbound(CUSTOMER, "balance o-1 cash");
    await s.inbound(OWNER_NUMBER, "balance o-1 link");
    assert.equal(lines(s, "record_balance").length, 0, "a customer cannot mark it, and a UPI shop has no link of its own to send");
    await s.inbound(OWNER_NUMBER, "balance o-1 cash");
    const marked = lines(s, "record_balance");
    assert.deepEqual(marked.map((r) => [r.booking, r.refs.balancePaise, r.refs.by]), [["o-1", "12000", "cash"]]);
    await s.inbound(OWNER_NUMBER, "balance o-1 upi");
    assert.equal(lines(s, "record_balance").length, 1, "never twice");
  });

  contract("an order paid in full up front has no balance to mark", async () => {
    const s = await boot({ settings: { advance: { mode: "full", holdMinutes: 30 } } });
    await s.inbound(CUSTOMER, LUNCH);
    const [deposit] = await items(s, "deposit");
    assert.equal(deposit.amountPaise, 24000, "the whole ₹240");
    await s.ownerPress("deposit", "received");
    await s.inbound(OWNER_NUMBER, "balance o-1 cash");
    assert.equal(lines(s, "record_balance").length, 0);
  });
});

describe("time running out on a UPI hold", () => {
  contract("a late advance is listed for 48 hours; after a customer said they paid, for 14 days", async () => {
    const s = await boot({ tickSeconds: 1 });
    await s.order();
    s.advance(31 * MIN); await beat();
    assert.deepEqual((await items(s, "late_deposit")).map((i) => [i.case, i.amountPaise]), [["o-1", 12000]]);
    s.advance(49 * 60 * MIN);
    assert.deepEqual(await items(s, "late_deposit"), [], "an old, forgotten hold is not listed for ever");

    const c = await boot({ tickSeconds: 1 });
    const { hash } = await c.order();
    await c.channelEvents([{ kind: "channel_request", id: "paid-1", channel: "web", op: "paid", handle: hash, upiRef: "431122334455" }]); await c.settle();
    c.advance(31 * MIN); await beat();
    c.advance(49 * 60 * MIN);
    assert.equal((await items(c, "late_deposit")).length, 1, "the customer said they paid: kept longer");
    c.advance(13 * 24 * 60 * MIN);
    assert.deepEqual(await items(c, "late_deposit"), [], "and not past 14 days");
  });

  contract("a slot's place is given back when the order holding it is cancelled, and when its hold runs out", async () => {
    const slots = [{ id: "lunch", from: "12:00", to: "13:00", names: { en: ["lunch"] }, cutoff: { daysBefore: 0, time: "09:00" }, maxOrders: 1 }, { id: "dinner", from: "19:00", to: "20:00", names: { en: ["dinner"] }, cutoff: { daysBefore: 0, time: "15:00" } }];
    const s = await boot({ tickSeconds: 1, settings: { pickup: { slots } } });
    const lunchOpen = async () => (await s.call("/internal/channel/offer")).body.days[1].slots.find((x: { id: string }) => x.id === "lunch").open;
    const first = await s.order();
    assert.equal(await lunchOpen(), false);
    await s.channelEvents([{ kind: "channel_request", id: "cancel-1", channel: "web", op: "cancel", handle: first.hash }]); await s.settle();
    assert.equal(await lunchOpen(), true, "the cancelled order's place is free");
    const second = await s.order({ phone: "+919855555555" });
    assert.equal((await s.request(second.hash)).body.status, "held");
    assert.equal(await lunchOpen(), false);
    s.advance(31 * MIN); await beat();
    assert.equal((await s.request(second.hash)).body.status, "expired");
    assert.equal(await lunchOpen(), true, "a hold that ran out gives its place back");
  });
});

describe("the licence, as Guard sees it", () => {
  contract("Guard's own licence refusal (402) of the advance link while the shop's file says 'in order': asked once, the customer told to contact the shop, the owner not asked, nothing kept", async () => {
    const s = await boot({ mode: "guards" });
    s.guards!.payments.answer(fixture("guard-responses.json").suspended, { times: 1, match: (c) => c.method === "POST" && /^\/v1\/payment_links$/u.test(c.path) });
    const ownerBefore = s.sent(OWNER_NUMBER).length;
    await s.inbound(CUSTOMER, lunchOn(s));
    assert.equal(s.guards!.of("payments", "POST", /^\/v1\/payment_links$/u).length, 1, "never tried again");
    assert.equal(s.sent(CUSTOMER).at(-1)!.text, "Online ordering is paused for now. Please contact Annapurna Tiffins directly.");
    const link = s.record().filter((r) => r.action === "create_advance_link").at(-1)!;
    assert.equal(link.outcome, "blocked");
    assert.equal(s.sent(OWNER_NUMBER).length, ownerBefore, "no 'link failed' to the owner: the licence held it back");
    const st = (await s.status()).orders;
    assert.equal(st.awaiting_advance, undefined, "nothing is kept to do later");
    assert.equal(st.confirmed, undefined);
  });
});

describe("the owner's cancel and refund from the chat (the assistant's Orders skill)", () => {
  contract("a cancel above the shop's refund limit: the tap sends the refund Guard holds, and the owner's yes at Guard releases exactly it", async () => {
    const s = await boot({ mode: "guards", settings: { ...ASSISTANT, refund: { limitInr: 100 } } });
    const { hash } = await s.order();
    await deliver(s, s.guards!.pay(links(s)[0].id));
    await s.inbound(OWNER_NUMBER, "cancel o-1");
    await s.tap(lastCard(s).yes, { from: OWNER_NUMBER });
    assert.equal((await s.request(hash)).body.status, "cancelled");
    assert.equal(refunds(s).length, 0, "₹120 above a ₹100 limit: held, not sent");
    assert.equal((await s.status()).refunds.waitingForOwner, 1);
    const [review] = s.guards!.stub.model.reviews("x", true);
    assert.equal(s.guards!.stub.model.decide(review.id, true, "owner-contract").status, 200);
    await s.events([{ kind: "approval_decision", approval: review.id, decision: "approve" }]); await s.settle();
    assert.deepEqual(refunds(s).map((r) => r.amount), [12000]);
  });

  contract("a cancel of an order still waiting for its advance: nothing moves, its link is closed, the customer is told nothing was charged; a big order waiting for the owner ends", async () => {
    const s = await boot({ mode: "guards", settings: ASSISTANT });
    await s.inbound(CUSTOMER, lunchOn(s));
    await s.inbound(OWNER_NUMBER, "cancel o-1");
    const card = lastCard(s);
    assert.match(card.text, /^Cancel order o-1 \(\+919844444444, .*\)\? No advance was paid\./u);
    await s.tap(card.yes, { from: OWNER_NUMBER });
    assert.equal(links(s)[0].status, "cancelled");
    assert.equal(refunds(s).length, 0);
    assert.match(s.sent(CUSTOMER).at(-1)!.text, /is cancelled\. Nothing was charged\./u);
    await s.inbound(RAJESH, `7 chicken meal ${s.orderDay().words} 12:00 pm pickup`);
    assert.equal((await s.status()).orders.awaiting_owner, 1);
    await s.inbound(OWNER_NUMBER, "cancel o-2");
    await s.tap(lastCard(s).yes, { from: OWNER_NUMBER });
    assert.deepEqual((await s.status()).orders, { cancelled: 2 });
    assert.equal(s.guards!.of("payments", "POST", /^\/v1\/payment_links$/u).length, 1, "the big order never had a link");
  });

  contract("a refund of an advance the owner kept: a standing order is cancelled first; after a late cancel the owner denied, the card refunds exactly the advance, once", async () => {
    const s = await boot({ mode: "guards", settings: { ...ASSISTANT, cancellation: { windowHours: 96 } } });
    await s.inbound(CUSTOMER, lunchOn(s));
    await deliver(s, s.guards!.pay(links(s)[0].id));
    await s.inbound(OWNER_NUMBER, "refund o-1");
    assert.match(s.sent(OWNER_NUMBER).at(-1)!.text, /cancel o-1/u, "an order that stands is cancelled, with its own card");
    await s.inbound(CUSTOMER, "cancel");
    await s.inbound(OWNER_NUMBER, "deny o-1");
    assert.equal(refunds(s).length, 0, "the late cancellation's advance is kept");
    await s.inbound(OWNER_NUMBER, "refund o-1");
    const card = lastCard(s);
    assert.match(card.text, /^Refund ₹120 of the advance to \+919844444444 \(o-1\)\?/u);
    await s.tap(card.yes, { from: OWNER_NUMBER });
    assert.deepEqual(refunds(s).map((r) => r.amount), [12000]);
    await s.tap(card.yes, { from: OWNER_NUMBER });
    assert.equal(refunds(s).length, 1, "a card is used once");
  });

  contract("a UPI shop: the owner's cancel of a paid order makes the owner owe exactly the advance, and the customer hears it will come from the owner", async () => {
    const s = await boot({ mode: "guards", example: "upi", settings: ASSISTANT });
    await s.inbound(CUSTOMER, lunchOn(s));
    await s.inbound(OWNER_NUMBER, `received ${upiCode(s)}`);
    assert.deepEqual((await s.status()).orders, { confirmed: 1 });
    await s.inbound(OWNER_NUMBER, "cancel o-1");
    await s.tap(lastCard(s).yes, { from: OWNER_NUMBER });
    assert.deepEqual((await s.status()).orders, { cancelled: 1 });
    assert.deepEqual((await items(s, "refund_owed")).map((i) => [i.case, i.amountPaise]), [["o-1", 12000]]);
    assert.match(s.sent(CUSTOMER).at(-1)!.text, /will send/u);
  });
});

// Two of stream W4's TypeScript findings (go/TRIAL.md), fixed on 23 Nov 2026 in the TypeScript and in Go the same way; before the fix the TypeScript failed these.
describe("findings fixed on both runtimes", () => {
  contract("an item taken off the menu while an order for it is open: the owner's page names it by its id, and the owner's mark still confirms the order", async () => {
    const s = await boot();
    const { hash } = await s.order({ lines: [{ itemId: "veg-thali", qty: 2 }, { itemId: "chicken-meal", qty: 1 }] });
    await s.stop();
    const file = join(s.client, "settings.json");
    const settings = JSON.parse(readFileSync(file, "utf8")) as { menu: { id: string }[] };
    writeFileSync(file, JSON.stringify({ ...settings, menu: settings.menu.filter((i) => i.id !== "chicken-meal") }));
    await s.start();
    const [deposit] = (await s.ownerView()).body.items as { what: string }[];
    assert.equal(deposit.what, "2 × veg thali, 1 × chicken-meal");
    await s.ownerPress("deposit", "received");
    const v = (await s.request(hash)).body;
    assert.equal(v.status, "confirmed");
    assert.match(v.messages.at(-1).text, /2 × veg thali, 1 × chicken-meal/u, "the confirmation names the item it no longer has by its id");
  });

  contract("the owner's cancel of a plan's waiting payment gives the plan up at the next beat: it is not left waiting for ever, and the customer can start again", async () => {
    const plans = (JSON.parse(readFileSync(new URL("../settings/annapurna-tiffins-plans.example.json", import.meta.url), "utf8")) as { plans: unknown }).plans;
    const s = await boot({ mode: "guards", tickSeconds: 1, settings: { ...ASSISTANT, plans } });
    await s.inbound(CUSTOMER, "I want the monthly lunch plan");
    assert.deepEqual(links(s).map((l) => l.amount), [240000]);
    await s.inbound(OWNER_NUMBER, "cancel o-1");
    await s.tap(lastCard(s).yes, { from: OWNER_NUMBER });
    assert.equal(links(s)[0].status, "cancelled");
    await beat();
    assert.ok(s.record().some((r) => r.action === "plan_lapse" && r.refs.period === "0"), "the plan is given up, not left waiting");
    await s.inbound(CUSTOMER, "I want the monthly lunch plan");
    assert.equal(links(s).length, 2, "the customer has no plan now, so asking again starts a new one with its own link (before: the stuck plan's unpaid month was shown)");
  });
});
