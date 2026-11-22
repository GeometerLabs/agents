// THE ORDER'S FLOW, as the outside sees it (group (ii) of the contract, README.md): an order from the shop's page and one on WhatsApp, each held at the shop's own prices, waiting
// for its advance, confirmed only when the owner marks the money (a UPI shop, the example), and every limit about the order itself said to the customer: the items the menu
// has, the size of an order, the days the shop takes, the way and its slot, the delivery list, the cut-off, the day's stock, the shelf count left after other holds, the day's
// count, a slot's own limit and the big-order line the owner approves. A "fakes" shop on the TEST clock at Mon 9 Nov 2026, 10:00 in India (the unit tests' instant: today's
// lunch closed at 09:00, tomorrow is Tue 10 Nov), observed through the page's view (which carries the order's messages), /status, the owner's page and agent.db. Expected
// values from test/agent, channels, slot-capacity, last-item, money-clarity, late-advance-card, reminder-balance and situations.
import { after, describe } from "node:test";
import assert from "node:assert/strict";
import { CUSTOMER, HOUR, MIN, RAJESH, START, SUNITA, at, beat, contract, makeShop } from "./harness.ts";
import type { Shop } from "./harness.ts";

const shops: Shop[] = [];
after(async () => { for (const s of shops) { await s.stop(); await s.cleanup(); } });
async function boot(o: Parameters<typeof makeShop>[0] = {}): Promise<Shop> { const s = await makeShop(o); shops.push(s); await s.start(); return s; }
const TUE = { year: 2026, month: 11, day: 10 };
const texts = async (s: Shop, hash: string): Promise<string[]> => ((await s.request(hash)).body.messages as { text: string }[]).map((m) => m.text);

describe("an order from the shop's page", () => {
  contract("is held at the shop's own prices in its own conversation, with the shop's UPI to pay, and the owner's mark on their page confirms it", async () => {
    const s = await boot();
    const { hash } = await s.order({ name: "Asha Verma" });
    const view = (await s.request(hash)).body;
    assert.equal(view.status, "held");
    assert.equal(view.ref, "o-1");
    assert.equal(view.channel, "web");
    assert.deepEqual(view.lines.map((l: { itemId: string; qty: number; priceInr: number; names: { en: string } }) => [l.itemId, l.qty, l.priceInr, l.names.en]), [["veg-thali", 2, 120, "veg thali"]]);
    assert.deepEqual([view.totalInr, view.advanceInr, view.date, view.mode, view.slot], [240, 120, "2026-11-10", "pickup", { id: "lunch", fromMs: at(TUE, 12), toMs: at(TUE, 13) }]);
    assert.ok(view.holdExpiresAt >= START + 30 * MIN && view.holdExpiresAt < START + 31 * MIN, "the settings' 30 minutes from the step's own moment, inside tomorrow's cut-off");
    assert.equal(view.pay.kind, "upi");
    assert.deepEqual([view.pay.amountPaise, view.pay.leftPaise, view.pay.payTo], [12000, 12000, { id: "annapurna@okicici", name: "Annapurna Tiffins" }]);
    assert.match(view.pay.link, /^upi:\/\/pay\?pa=annapurna@okicici/u);
    assert.deepEqual([view.canCancel, view.canSayPaid, view.claimed], [true, true, false]);
    assert.ok(view.messages.some((m: { text: string }) => /2 × veg thali .*Total ₹240.*pay ₹120/su.test(m.text)), JSON.stringify(view.messages));
    assert.deepEqual((await s.status()).orders, { awaiting_advance: 1 });

    const owner = (await s.ownerView()).body;
    assert.equal(owner.items.length, 1);
    const [item] = owner.items;
    assert.deepEqual([item.kind, item.case, item.amountPaise, item.channel, item.what, item.startMs], ["deposit", "o-1", 12000, "web", "2 × veg thali", at(TUE, 12)]);
    assert.deepEqual(item.customer, { phone: SUNITA, name: "Asha Verma" }, "the name and number the customer typed");
    assert.match(item.digest, /^[0-9a-f]{32}$/u);
    assert.equal(item.code, undefined, "the owner's one-use code never leaves the runtime");
    const record = s.record();
    const made = record.find((r) => r.action === "channel_order" && r.outcome === "confirmed")!;
    assert.match(made.conversation, /^web:[0-9a-f]{16}$/u, "its own conversation, never the typed number");
    assert.ok(record.some((r) => r.action === "hold_stock" && r.outcome === "confirmed" && r.booking === "o-1"));
    assert.ok(!record.some((r) => r.conversation === SUNITA), "nothing is in the typed number's name");

    const stale = await s.channelEvents([{ kind: "owner_action", id: "p-0", action: "received", case: "o-1", digest: "f".repeat(32) }], { owner: true });
    assert.equal(stale.status, 200); await s.settle();
    assert.equal((await s.request(hash)).body.status, "held", "a digest that is not what waits now does nothing");
    await s.ownerPress("deposit", "received");
    const done = (await s.request(hash)).body;
    assert.equal(done.status, "confirmed");
    assert.equal(done.pay, undefined);
    assert.ok(done.messages.at(-1).text.length > 0);
    assert.deepEqual((await s.status()).orders, { confirmed: 1 });
    const after = s.record();
    assert.ok(after.some((r) => r.action === "confirm_order" && r.outcome === "confirmed" && r.booking === "o-1"));
    assert.ok(after.some((r) => r.refs.markedBy === "owner" && r.booking === "o-1"), "the money is the owner's mark");
    const coming = (await s.ownerView()).body;
    assert.deepEqual(coming.items, []);
    assert.deepEqual(coming.upcoming.map((u: { case: string; what: string; state: string; channel: string }) => [u.case, u.what, u.state, u.channel]), [["o-1", "2 × veg thali", "confirmed", "web"]]);
  });

  contract("a request the shop cannot take is refused before anything is held, said as a reason, and the same request again is one", async () => {
    const s = await boot();
    const refused = async (o: Parameters<Shop["order"]>[0]): Promise<string> => { const { hash } = await s.order(o); const v = (await s.request(hash)).body; assert.equal(v.status, "refused", JSON.stringify(v)); return v.reason; };
    assert.equal(await refused({ lines: [{ itemId: "pizza", qty: 1 }] }), "unknown_item");
    assert.equal(await refused({ lines: [{ itemId: "veg-thali", qty: 11 }] }), "too_many_items");
    assert.equal(await refused({ date: "2026-11-20" }), "bad_date", "more than seven days ahead");
    assert.equal(await refused({ date: "2026-11-08" }), "bad_date", "yesterday");
    assert.equal(await refused({ date: "2026-11-31" }), "bad_date", "a day that does not exist");
    assert.equal(await refused({ mode: "pickup", slotId: "lunch-home" }), "bad_slot");
    assert.equal(await refused({ mode: "delivery", slotId: "lunch-home", address: "MG Road, Ernakulam" }), "outside_area");
    assert.deepEqual((await s.status()).orders, {}, "nothing was held or kept");
    assert.ok(s.record().filter((r) => r.action === "channel_order").every((r) => r.outcome === "blocked"));
    // a refused request still counts in its number's starts of the day (the per-number limit), so the order taken next is another number's
    const a = await s.order({ id: "same-1", phone: "+919844440000" });
    const again = await s.channelEvents([{ kind: "channel_request", id: "same-1", channel: "web", op: "order", handle: a.hash, lines: [{ itemId: "veg-thali", qty: 2 }], date: "2026-11-10", mode: "pickup", slotId: "lunch", name: "Asha", phone: "+919844440000", language: "en" }]);
    assert.equal(again.body.duplicates, 1);
    await s.settle();
    assert.deepEqual((await s.status()).orders, { awaiting_advance: 1 });
    const delivered = await s.order({ mode: "delivery", slotId: "dinner-home", address: "Flat 2, Infopark road", phone: "+919855555555" });
    const v = (await s.request(delivered.hash)).body;
    assert.deepEqual([v.status, v.mode, v.area, v.slot.id], ["held", "delivery", "Infopark", "dinner-home"], "a delivery names its place on the list, never the address as typed");
  });

  contract("the page's offer counts what is held: what is left of each item, a day that is full, today's closed lunch; and two customers for the last ones get one hold", async () => {
    const s = await boot({ settings: { orders: { maxPerDay: 2, maxItemsPerOrder: 10, daysAhead: 7 }, owner: { approveOverInr: 0 } } }); // no big-order line: 7 chicken meals are held at once
    const offer0 = (await s.call("/internal/channel/offer")).body;
    const today = offer0.days[0];
    assert.equal(today.date, "2026-11-09");
    assert.deepEqual(today.slots.map((x: { id: string; open: boolean }) => [x.id, x.open]), [["lunch", false], ["dinner", true], ["lunch-home", false], ["dinner-home", true]], "lunch closed at 09:00, dinner closes at 15:00");
    assert.deepEqual(offer0.days[1].left, { "veg-thali": 12, "chicken-meal": 8, curd: 30 });
    await s.order({ lines: [{ itemId: "chicken-meal", qty: 7 }] });
    const offer1 = (await s.call("/internal/channel/offer")).body;
    assert.equal(offer1.days[1].left["chicken-meal"], 1);
    assert.equal(offer1.days[1].full, false);
    const second = await s.order({ lines: [{ itemId: "chicken-meal", qty: 2 }], phone: "+919855555555" });
    const v2 = (await s.request(second.hash)).body;
    assert.equal(v2.status, "not_held", "only one left: nothing is held for two");
    assert.match(v2.messages.at(-1).text, /only 1 chicken meal left/u);
    const third = await s.order({ lines: [{ itemId: "chicken-meal", qty: 1 }], phone: "+919866666666" });
    assert.equal((await s.request(third.hash)).body.status, "held");
    assert.equal((await s.call("/internal/channel/offer")).body.days[1].full, true, "the day's two places are taken");
    const fourth = await s.order({ lines: [{ itemId: "curd", qty: 1 }], phone: "+919877777777" });
    const v4 = (await s.request(fourth.hash)).body;
    assert.equal(v4.status, "not_held");
    assert.match(v4.messages.at(-1).text, /cannot take any more orders for/u);
    assert.ok(s.record().some((r) => r.action === "check_order" && r.outcome === "blocked"));
  });

  contract("a slot with its own limit is full for the next order and shown as not open; another slot is still taken", async () => {
    const s = await boot({ settings: { pickup: { slots: [{ id: "lunch", from: "12:00", to: "13:00", names: { en: ["lunch"] }, cutoff: { daysBefore: 0, time: "09:00" }, maxOrders: 1 }, { id: "dinner", from: "19:00", to: "20:00", names: { en: ["dinner"] }, cutoff: { daysBefore: 0, time: "15:00" } }] } } });
    await s.order();
    const second = await s.order({ phone: "+919855555555" });
    const v = (await s.request(second.hash)).body;
    assert.equal(v.status, "not_held");
    assert.match(v.messages.at(-1).text, /is full/u);
    const lunch = (await s.call("/internal/channel/offer")).body.days[1].slots.find((x: { id: string }) => x.id === "lunch");
    assert.equal(lunch.open, false, "a full slot is not offered");
    const dinner = await s.order({ slotId: "dinner", phone: "+919866666666" });
    assert.equal((await s.request(dinner.hash)).body.status, "held");
  });

  contract("the per-number limit: a number with unpaid orders from the page is refused another until one is paid or ends", async () => {
    const s = await boot();
    const reasons: string[] = [];
    for (let i = 0; i < 4; i++) {
      const { hash } = await s.order({ lines: [{ itemId: "curd", qty: 1 }] });
      const v = (await s.request(hash)).body;
      reasons.push(v.status === "refused" ? v.reason : v.status);
    }
    assert.ok(reasons.includes("phone_busy"), JSON.stringify(reasons));
    assert.equal(reasons[0], "held");
  });

  contract("'I have paid' on the page marks nothing paid: it is shown to the owner with the reference typed, and only the owner's mark confirms", async () => {
    const s = await boot();
    const { hash } = await s.order();
    await s.channelEvents([{ kind: "channel_request", id: "paid-1", channel: "web", op: "paid", handle: hash, upiRef: "431122334455" }]); await s.settle();
    const view = (await s.request(hash)).body;
    assert.deepEqual([view.status, view.claimed], ["held", true]);
    const [item] = (await s.ownerView()).body.items;
    assert.equal(item.kind, "deposit");
    assert.equal(item.upiRef, "431122334455");
    assert.equal(typeof item.claimedAtMs, "number");
    assert.ok(s.record().some((r) => r.action === "upi_paid_claim" || r.notes.includes("says they paid")));
    assert.ok(!s.record().some((r) => r.action === "confirm_order"));
  });

  contract("cancel from the page before paying: the order ends at once, its request is closed and its stock is free again", async () => {
    const s = await boot({ settings: { owner: { approveOverInr: 0 } } });
    const { hash } = await s.order({ lines: [{ itemId: "chicken-meal", qty: 8 }] });
    assert.equal((await s.call("/internal/channel/offer")).body.days[1].left["chicken-meal"], 0);
    await s.channelEvents([{ kind: "channel_request", id: "cancel-1", channel: "web", op: "cancel", handle: hash }]); await s.settle();
    const view = (await s.request(hash)).body;
    assert.equal(view.status, "cancelled");
    assert.equal(view.canCancel, false);
    assert.match(view.messages.at(-1).text, /cancelled\. Nothing was charged/u);
    assert.equal((await s.call("/internal/channel/offer")).body.days[1].left["chicken-meal"], 8);
    assert.deepEqual((await s.ownerView()).body.items, [], "nothing to mark any more");
    assert.ok(s.record().some((r) => r.action === "cancel_order" && r.outcome === "confirmed"));
  });

  contract("a big order above the owner's line waits for the owner, nothing held; approve lets the customer pay, deny ends it", async () => {
    const s = await boot();
    const big = await s.order({ lines: [{ itemId: "chicken-meal", qty: 7 }] });            // ₹1,120 > ₹1,000
    const v = (await s.request(big.hash)).body;
    assert.equal(v.status, "checking");
    assert.equal(v.pay, undefined, "no request to pay before the owner says yes");
    assert.deepEqual((await s.status()).orders, { awaiting_owner: 1 });
    const [item] = (await s.ownerView()).body.items;
    assert.deepEqual([item.kind, item.amountPaise, item.actions], ["big_order", 112000, ["approve", "deny"]]);
    await s.ownerPress("big_order", "approve");
    const held = (await s.request(big.hash)).body;
    assert.equal(held.status, "held");
    assert.equal(held.pay.amountPaise, 56000, "half of ₹1,120");
    const other = await s.order({ lines: [{ itemId: "veg-thali", qty: 9 }], phone: "+919855555555" });   // ₹1,080
    assert.equal((await s.request(other.hash)).body.status, "checking");
    await s.ownerPress("big_order", "deny", { case: "o-2" });
    const denied = (await s.request(other.hash)).body;
    assert.equal(denied.status, "cancelled");
    assert.match(denied.messages.at(-1).text, /cannot take your order/u);
    assert.ok(s.record().some((r) => r.action === "owner_decision" && r.outcome === "confirmed" && r.refs.command === "deny"));
  });
});

describe("an order on WhatsApp", () => {
  contract("one sentence is understood, held at the menu price, and the owner's mark confirms it; the owner hears what to prepare", async () => {
    const s = await boot();
    await s.inbound(CUSTOMER, "2 veg thali 10 nov 12:00 pm pickup");
    assert.deepEqual((await s.status()).orders, { awaiting_advance: 1 });
    assert.deepEqual(s.templatesTo(CUSTOMER), ["quote_and_link"]);
    assert.deepEqual(s.templatesTo(CUSTOMER, "owner"), ["owner_upi_expected"], "the owner is told a UPI payment is coming, with the code");
    const [item] = (await s.ownerView()).body.items;
    assert.deepEqual([item.kind, item.channel, item.customer, item.amountPaise], ["deposit", "whatsapp", { phone: CUSTOMER }, 12000]);
    await s.inbound(CUSTOMER, "I have paid");
    assert.deepEqual((await s.status()).orders, { awaiting_advance: 1 }, "a word is not a payment");
    await s.ownerPress("deposit", "received");
    assert.deepEqual((await s.status()).orders, { confirmed: 1 });
    assert.equal(s.templatesTo(CUSTOMER).at(-1), "upi_order_confirmed");
    assert.ok(s.templatesTo(CUSTOMER, "owner").includes("owner_order_confirmed"));
  });

  contract("a weekday is read back before anything is held; a missing way and slot are asked; a delivery takes its address from the next message", async () => {
    const s = await boot();
    await s.inbound(CUSTOMER, "2 veg thali wednesday 12 pm pickup");
    assert.deepEqual((await s.status()).orders, { enquiry: 1 }, "nothing held before the yes");
    assert.ok(["confirm_details", "confirm_buttons"].includes(s.templatesTo(CUSTOMER).at(-1)!));
    await s.inbound(CUSTOMER, "yes");
    assert.deepEqual((await s.status()).orders, { awaiting_advance: 1 });
    await s.inbound(RAJESH, "1 chicken meal 10 nov delivery");
    assert.ok(["ask_slot"].includes(s.templatesTo(RAJESH).at(-1)!), JSON.stringify(s.templatesTo(RAJESH)));
    await s.inbound(RAJESH, "dinner", { reply: { id: "slot:dinner-home", kind: "list" } });
    assert.equal(s.templatesTo(RAJESH).at(-1), "ask_address");
    await s.inbound(RAJESH, "MG Road, Ernakulam");
    assert.equal(s.templatesTo(RAJESH).at(-1), "outside_area");
    await s.inbound(RAJESH, "Flat 2, Infopark road");
    assert.equal(s.templatesTo(RAJESH).at(-1), "quote_and_link");
    assert.deepEqual((await s.status()).orders, { awaiting_advance: 2 });
  });

  contract("the limits on WhatsApp: today's closed lunch, too many items, more than the day's stock; the customer is told and nothing is held", async () => {
    const s = await boot();
    await s.inbound(CUSTOMER, "1 veg thali 9 nov 12:00 pm pickup");
    assert.equal(s.templatesTo(CUSTOMER).at(-1), "after_cutoff");
    await s.inbound(RAJESH, "11 veg thali 10 nov 12:00 pm pickup");
    assert.equal(s.templatesTo(RAJESH).at(-1), "too_many_items");
    await s.inbound(SUNITA, "9 chicken meal 10 nov 12:00 pm pickup");
    assert.ok(["out_of_stock", "sold_out"].includes(s.templatesTo(SUNITA).at(-1)!), JSON.stringify(s.templatesTo(SUNITA)));
    assert.equal((await s.status()).orders.awaiting_advance, undefined);
  });

  contract("STOP is final: the owner is told once, and nothing more goes to the customer, not even a reply", async () => {
    const s = await boot();
    await s.inbound(CUSTOMER, "STOP");
    assert.ok(s.record().some((r) => r.action === "opt_out" && r.conversation === CUSTOMER));
    assert.deepEqual(s.templatesTo(CUSTOMER, "owner"), ["owner_opted_out"]);
    await s.inbound(CUSTOMER, "2 veg thali 10 nov 12:00 pm pickup");
    await s.inbound(CUSTOMER, "hello");
    assert.deepEqual(s.templatesTo(CUSTOMER), [], "nothing was sent to them");
    assert.deepEqual((await s.status()).orders, {});
  });

  contract("a voice note on a shop without voice is answered 'please type', and nothing of it is kept", async () => {
    const s = await boot();
    await s.inbound(CUSTOMER, "", { extra: { voiceNote: true } });
    assert.deepEqual(s.templatesTo(CUSTOMER), ["voice_note"]);
  });
});

describe("the clock's beat", () => {
  contract("a hold nobody pays ends by itself: the page says expired, the stock is free again, and the owner may still mark money that came late", async () => {
    const s = await boot({ tickSeconds: 1, settings: { owner: { approveOverInr: 0 } } });
    const { hash } = await s.order({ lines: [{ itemId: "chicken-meal", qty: 8 }] });
    s.advance(31 * MIN); await beat();
    const view = (await s.request(hash)).body;
    assert.equal(view.status, "expired");
    assert.match(view.messages.at(-1).text, /hold on your order .* has ended/u);
    assert.deepEqual((await s.status()).orders, { expired: 1 });
    assert.equal((await s.call("/internal/channel/offer")).body.days[1].left["chicken-meal"], 8);
    assert.ok(s.record().some((r) => r.action === "release_stock" && r.outcome === "confirmed"));
    const [late] = (await s.ownerView()).body.items;
    assert.equal(late.kind, "late_deposit", "a UPI payment made as the time ran out can still be marked");
    await s.ownerPress("late_deposit", "received");
    assert.equal((await s.request(hash)).body.status, "expired", "a late mark never confirms by itself");
    const owed = (await s.ownerView()).body.items.find((i: { kind: string }) => i.kind === "refund_owed");
    assert.ok(owed, "the owner owes it back, or keeps it for an order taken by hand");
    assert.deepEqual(owed.actions, ["refunded", "kept"]);
  });

  contract("a confirmed order is reminded before its slot when the shop asks for it, and becomes done when the slot has ended", async () => {
    const s = await boot({ tickSeconds: 1, settings: { reminder: { hoursBefore: 2 } } });
    const { hash } = await s.order();
    await s.ownerPress("deposit", "received");
    const before = (await texts(s, hash)).length;
    s.advance(at(TUE, 10, 5) - s.now()); await beat();
    const during = await texts(s, hash);
    assert.equal(during.length, before + 1, JSON.stringify(during));
    assert.match(during.at(-1)!, /^Reminder: your order/u);
    s.advance(at(TUE, 13, 5) - s.now()); await beat();
    assert.equal((await s.request(hash)).body.status, "done");
    assert.deepEqual((await s.status()).orders, { completed: 1 });
    assert.ok(s.record().some((r) => r.action === "complete_order" && r.outcome === "confirmed"));
    assert.equal((await texts(s, hash)).length, before + 1, "one reminder only");
    void HOUR;
  });
});
