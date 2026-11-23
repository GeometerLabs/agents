// "KEEP ONE FOR ME", THE PICKUP HOLD (24 Nov 2026; the shop starter's job 3, decision 63), as the outside sees an Orders shop whose advance mode is "none"
// (go/internal/orders agent_hold.go): no payment link and no money; the owner, not the model, picks the listed item a photo or model number shows and accepts each hold; the
// unit is held until the end of the agreed pickup slot and "held for you" is said only after the shop accepted AND the unit is reserved; staff mark it collected (WhatsApp or
// the owner's page), which books it off the shared stock count once; expiry or cancellation releases it once. Two people asking for the last unit get at most one active hold,
// and a retry keeps the hold it has.
// A "fakes" shop on the TEST clock (Mon 9 Nov 2026, 10:00 in India): Ganesh Electricals (settings/ganesh-electricals-hold.example.json), whose MCB 16A has one a day,
// a morning slot 10:00 to 13:00 (orders close at 12:00) and an evening slot 16:00 to 19:00.
import { after, describe } from "node:test";
import assert from "node:assert/strict";
import { CUSTOMER, MIN, OWNER_NUMBER, RAJESH, START, SUNITA, beat, contract, makeShop } from "./harness.ts";
import type { Shop, ShopOptions } from "./harness.ts";
import { holdsOf } from "../report/data.ts";

const shops: Shop[] = [];
after(async () => { for (const s of shops) { await s.stop(); await s.cleanup(); } });
async function boot(o: ShopOptions = {}): Promise<Shop> { const s = await makeShop({ example: "hold", ...o }); shops.push(s); await s.start(); return s; }

type Item = { kind: string; case: string; digest: string; actions: string[]; amountPaise: number; what?: string; pick?: string };
const items = async (s: Shop, kind: string): Promise<Item[]> => ((await s.ownerView()).body.items as Item[]).filter((i) => i.kind === kind);
const holdLines = (s: Shop, step: string) => s.record().filter((r) => r.action === "pickup_hold" && r.outcome === "confirmed" && r.refs.step === step);
const say = async (s: Shop, from: string, text: string, extra?: Record<string, unknown>) => { await s.inbound(from, text, extra ? { extra } : {}); await s.settle(); };
/** No money anywhere: no link, no payment, no ledger request, no books line. */
const noMoney = (s: Shop) => {
  const money = s.record().filter((r) => ["create_advance_link", "record_payment", "upi_paid_claim", "upi_request_closed", "refund"].includes(r.action) || r.refs.amountPaise !== undefined || r.refs.entryId !== undefined);
  assert.deepEqual(money, [], "no payment link, payment, claim or books line");
};

describe("the pickup hold: asked in words, accepted by the shop", () => {
  contract("a listed item asked for a pickup time waits for the shop; 'held for you' only after the owner's yes, with no link and no money", async () => {
    const s = await boot();
    await say(s, CUSTOMER, "1 MCB 16A today evening");
    assert.deepEqual(s.templatesTo(CUSTOMER), ["hold_asked_shop"], "asked, never 'held'");
    assert.deepEqual(s.templatesTo(CUSTOMER, "owner"), ["owner_hold_ask"]);
    assert.equal((await items(s, "hold_ask")).length, 1, "the hold waits on the owner's page");
    assert.deepEqual(await items(s, "hold"), [], "nothing is held yet");
    await say(s, OWNER_NUMBER, "approve o-1");
    assert.deepEqual(s.templatesTo(CUSTOMER), ["hold_asked_shop", "hold_held"]);
    assert.deepEqual(s.templatesTo(CUSTOMER, "owner"), ["owner_hold_ask", "owner_hold_held"]);
    const held = await items(s, "hold");
    assert.equal(held.length, 1);
    assert.deepEqual(held[0].actions, ["collected"]);
    assert.equal(holdLines(s, "held").length, 1);
    assert.equal(holdLines(s, "enquiry").length, 1);
    noMoney(s);
  });

  contract("the owner's no: the customer hears the shop cannot keep it, and nothing is held", async () => {
    const s = await boot();
    await say(s, CUSTOMER, "1 MCB 16A today evening");
    await say(s, OWNER_NUMBER, "deny o-1");
    assert.deepEqual(s.templatesTo(CUSTOMER), ["hold_asked_shop", "hold_declined"]);
    assert.deepEqual(await items(s, "hold"), []);
  });

  contract("two people asking for the last unit (one today, one tomorrow): the shop says yes to both, only the first is held; the second hears 'we usually carry it'", async () => {
    const s = await boot();
    await say(s, CUSTOMER, "1 MCB 16A today evening");
    await say(s, RAJESH, "1 MCB 16A tomorrow morning");
    await say(s, OWNER_NUMBER, "approve o-1");
    await say(s, OWNER_NUMBER, "approve o-2");
    assert.deepEqual(s.templatesTo(CUSTOMER).at(-1), "hold_held");
    assert.deepEqual(s.templatesTo(RAJESH), ["hold_asked_shop", "hold_usually"]);
    assert.equal((await items(s, "hold")).length, 1, "at most one active hold of the last unit");
    assert.equal(holdLines(s, "held").length, 1);
  });

  contract("a retry keeps the hold: while the shop is asked, one card; once held, the same hold, no second card and no new time", async () => {
    const s = await boot();
    await say(s, CUSTOMER, "1 MCB 16A today evening");
    await say(s, CUSTOMER, "1 MCB 16A today evening");
    assert.deepEqual(s.templatesTo(CUSTOMER), ["hold_asked_shop", "hold_still_asking"]);
    assert.deepEqual(s.templatesTo(CUSTOMER, "owner"), ["owner_hold_ask"], "one card");
    await say(s, OWNER_NUMBER, "approve o-1");
    const before = (await items(s, "hold"))[0].digest;
    await say(s, CUSTOMER, "1 MCB 16A today evening");
    assert.equal(s.templatesTo(CUSTOMER).at(-1), "hold_held");
    assert.equal((await items(s, "hold"))[0].digest, before, "the same hold, the same time");
    assert.equal(holdLines(s, "held").length, 1);
    assert.deepEqual(s.templatesTo(CUSTOMER, "owner"), ["owner_hold_ask", "owner_hold_held"]);
  });
});

describe("the pickup hold: a pickup time that has already ended", () => {
  contract("at 14:00 the morning (10:00 to 13:00) is over even though the shop's cut-off is later: nothing is asked of the owner and nothing is held", async () => {
    const s = await boot({ at: START + 4 * 60 * MIN, settings: { pickup: { slots: [{ id: "morning", from: "10:00", to: "13:00", names: { en: ["morning"], kn: ["ಬೆಳಿಗ್ಗೆ"] } }, { id: "evening", from: "16:00", to: "19:00", names: { en: ["evening"], kn: ["ಸಂಜೆ"] } }] } } });
    await say(s, CUSTOMER, "1 MCB 16A today morning");
    assert.deepEqual(s.templatesTo(CUSTOMER), ["after_cutoff"]);
    assert.deepEqual(s.templatesTo(CUSTOMER, "owner"), []);
    assert.deepEqual(await items(s, "hold_ask"), []);
  });
});

describe("the pickup hold: a photo or a model number goes to the owner", () => {
  contract("a photo is an item enquiry, never a payment claim; the owner picks the listed item, the customer hears 'in stock' and its price, and the time they give holds it without a second ask", async () => {
    const s = await boot();
    await say(s, CUSTOMER, "", { image: true });
    assert.deepEqual(s.templatesTo(CUSTOMER), ["hold_enquiry_asked"]);
    assert.deepEqual(s.templatesTo(CUSTOMER, "owner"), ["owner_hold_enquiry"]);
    await say(s, CUSTOMER, "", { image: true });
    assert.equal(s.templatesTo(CUSTOMER).at(-1), "hold_still_asking", "a second photo makes no second card");
    assert.deepEqual(s.templatesTo(CUSTOMER, "owner"), ["owner_hold_enquiry"]);
    await say(s, OWNER_NUMBER, "pick o-1 mcb 16a");
    assert.deepEqual(s.templatesTo(CUSTOMER).slice(-2), ["hold_offer", "ask_when"], "in stock at its price, then when");
    await say(s, CUSTOMER, "today evening");
    assert.equal(s.templatesTo(CUSTOMER).at(-1), "hold_held");
    assert.deepEqual(s.templatesTo(CUSTOMER, "owner"), ["owner_hold_enquiry", "owner_hold_held"], "the owner's pick was the shop's yes");
    assert.equal(holdLines(s, "enquiry").length, 1, "one enquiry for the order");
    noMoney(s);
  });

  contract("a model number the reader cannot place goes to the owner; words that name no listed item are asked again; 'deny' says the shop cannot keep it", async () => {
    const s = await boot();
    await say(s, CUSTOMER, "do you have havells 1.5 sq mm wire 90m");
    assert.deepEqual(s.templatesTo(CUSTOMER), ["hold_enquiry_asked"]);
    await say(s, OWNER_NUMBER, "pick o-1 copper pipe");
    assert.ok(s.templatesTo(CUSTOMER, "owner").includes("owner_hold_pick_unclear"));
    await say(s, OWNER_NUMBER, "deny o-1");
    assert.equal(s.templatesTo(CUSTOMER).at(-1), "hold_declined");
    assert.deepEqual(await items(s, "hold_pick"), []);
  });

  contract("the owner's page shows ONE photo card with a button per listed item (each with its price) and 'we don't have it'; a press picks the item", async () => {
    const s = await boot();
    await say(s, CUSTOMER, "", { image: true });
    const picks = await items(s, "hold_pick");
    assert.deepEqual(picks.map((p) => [p.pick ?? "", p.amountPaise, p.actions.join()]), [["led-9w", 12000, "approve"], ["ext-board", 45000, "approve"], ["mcb-16a", 25000, "approve"], ["", 0, "deny"]]);
    const mcb = picks.find((p) => p.pick === "mcb-16a")!;
    const a = await s.channelEvents([{ kind: "owner_action", id: "press-pick-1", action: "approve", case: mcb.case, digest: mcb.digest }], { owner: true });
    assert.equal(a.status, 200);
    await s.settle();
    assert.deepEqual(s.templatesTo(CUSTOMER).slice(-2), ["hold_offer", "ask_when"]);
    assert.deepEqual(await items(s, "hold_pick"), [], "answered: the card is gone");
    const again = await s.channelEvents([{ kind: "owner_action", id: "press-pick-2", action: "approve", case: mcb.case, digest: mcb.digest }], { owner: true });
    assert.equal(again.status, 200);
    await s.settle();
    assert.ok(s.record().some((r) => r.action === "owner_page_action" && r.outcome === "blocked"), "the same press again does nothing");
  });

  contract("STOP while the enquiry waits: the owner's pick sends the customer nothing", async () => {
    const s = await boot();
    await say(s, CUSTOMER, "", { image: true });
    await say(s, CUSTOMER, "STOP");
    const before = s.templatesTo(CUSTOMER).length;
    await say(s, OWNER_NUMBER, "pick o-1 mcb 16a");
    assert.equal(s.templatesTo(CUSTOMER).length, before, "STOP ends every message");
  });
});

describe("the pickup hold: collected, expired, cancelled", () => {
  contract("staff mark it collected (WhatsApp): the hold stands and is done; a second mark changes nothing", async () => {
    const s = await boot();
    await say(s, CUSTOMER, "1 MCB 16A today evening");
    await say(s, OWNER_NUMBER, "approve o-1");
    await say(s, OWNER_NUMBER, "collected o-1");
    assert.equal(s.templatesTo(CUSTOMER, "owner").at(-1), "owner_hold_collected");
    assert.equal(holdLines(s, "collected").length, 1);
    assert.ok(s.record().some((r) => r.action === "complete_order" && r.booking === "o-1"));
    assert.deepEqual(await items(s, "hold"), []);
    await say(s, OWNER_NUMBER, "collected o-1");
    assert.equal(s.templatesTo(OWNER_NUMBER, "owner").at(-1), "owner_hold_none");
    assert.equal(holdLines(s, "collected").length, 1, "collected once");
    noMoney(s);
  });

  contract("the owner's page 'collected' and the shared stock count: a hold takes nothing off the count, collection lowers it once", async () => {
    const s = await boot({ settings: { assistant: {} } });
    const stockOp = async (id: string, op: Record<string, unknown>) => { const a = await s.call("/internal/channel/owner-stock", { owner: s.owner, body: { id, op } }); if (a.status === 200) await s.settle(); return a; };
    const count = async () => ((await s.call("/internal/channel/owner-stock", { owner: s.owner })).body.rows as { id: string; count: number }[]).find((r) => r.id === "menu:led-9w")?.count;
    assert.equal((await stockOp("s-1", { op: "start", id: "menu:led-9w", count: 2 })).status, 200);
    await say(s, CUSTOMER, "2 LED bulb 9W today evening");
    await say(s, OWNER_NUMBER, "approve o-1");
    assert.equal(s.templatesTo(CUSTOMER).at(-1), "hold_held");
    assert.equal(await count(), 2, "a hold does not lower the count");
    await say(s, SUNITA, "1 LED bulb 9W today evening");
    await say(s, OWNER_NUMBER, "approve o-2");
    assert.equal(s.templatesTo(SUNITA).at(-1), "hold_usually", "the count less the held two leaves none");
    await s.ownerPress("hold", "collected");
    assert.equal(holdLines(s, "collected").length, 1);
    assert.equal(await count(), 0, "collected: booked off the count once");
    await say(s, RAJESH, "hello");
    assert.equal(await count(), 0, "a later step books nothing twice");
  });

  contract("the pickup time ends: the hold is released once, the customer and the owner are told, and the unit is free for the next person", async () => {
    const s = await boot({ tickSeconds: 1 });
    await say(s, CUSTOMER, "1 MCB 16A today morning");
    await say(s, OWNER_NUMBER, "approve o-1");
    assert.equal(s.templatesTo(CUSTOMER).at(-1), "hold_held");
    s.advance(3 * 60 * MIN + MIN); await beat(); // 13:01, after the morning slot's end
    await beat();
    assert.equal(s.templatesTo(CUSTOMER).at(-1), "hold_ended");
    assert.equal(s.templatesTo(CUSTOMER).filter((t) => t === "hold_ended").length, 1);
    assert.equal(s.record().filter((r) => r.action === "release_stock" && r.booking === "o-1").length, 1, "released once");
    assert.ok(s.templatesTo(CUSTOMER, "owner").includes("owner_hold_ended"));
    await say(s, RAJESH, "1 MCB 16A today evening");
    await say(s, OWNER_NUMBER, "approve o-2");
    assert.equal(s.templatesTo(RAJESH).at(-1), "hold_held", "the released unit is held for the next person");
    // a late collection of the first hold would promise the one unit twice: refused, and the owner is told nothing was marked
    await say(s, OWNER_NUMBER, "collected o-1");
    assert.equal(holdLines(s, "collected").length, 0);
    assert.equal(s.templatesTo(OWNER_NUMBER, "owner").at(-1), "owner_hold_none");
    assert.equal((await items(s, "hold")).length, 1, "the second customer's hold stands");
  });

  contract("a late collection, when nobody else holds the unit, is recorded against the original hold", async () => {
    const s = await boot({ tickSeconds: 1 });
    await say(s, CUSTOMER, "1 MCB 16A today morning");
    await say(s, OWNER_NUMBER, "approve o-1");
    s.advance(3 * 60 * MIN + MIN); await beat();
    assert.equal(s.templatesTo(CUSTOMER).at(-1), "hold_ended");
    await say(s, OWNER_NUMBER, "collected o-1");
    assert.equal(holdLines(s, "collected").length, 1);
    assert.equal(s.record().filter((r) => r.action === "pickup_hold" && r.outcome === "confirmed" && r.refs.late === "true").length, 1);
  });

  contract("a changed request while held lets the old hold go (the owner is told) and asks the shop again; a cancel before the owner's pick drops the card", async () => {
    const s = await boot();
    await say(s, CUSTOMER, "1 MCB 16A today evening");
    await say(s, OWNER_NUMBER, "approve o-1");
    await say(s, CUSTOMER, "1 extension board today evening");
    assert.ok(s.templatesTo(CUSTOMER, "owner").includes("owner_hold_cancelled"), "the owner hears the MCB is free again");
    assert.equal(holdLines(s, "cancelled").length, 1);
    assert.equal(s.templatesTo(CUSTOMER).at(-1), "hold_asked_shop");
    assert.equal((await items(s, "hold_ask")).length, 1);
    await say(s, SUNITA, "", { image: true });
    await say(s, SUNITA, "cancel");
    assert.equal(s.templatesTo(SUNITA).at(-1), "cancelled_draft");
    assert.deepEqual(await items(s, "hold_pick"), [], "the photo's card is gone");
  });
});

describe("the pickup hold: what is NOT an enquiry, and what the owner's pick covers", () => {
  contract("'thanks' or a question with no model number does not ping the owner or count as an enquiry", async () => {
    const s = await boot();
    await say(s, CUSTOMER, "thanks");
    await say(s, CUSTOMER, "what time do you close");
    assert.deepEqual(s.templatesTo(CUSTOMER, "owner"), []);
    assert.equal(holdLines(s, "enquiry").length, 0);
  });

  contract("the owner's pick is a yes for one of the item: asking for more goes back to the shop", async () => {
    const s = await boot();
    await say(s, CUSTOMER, "", { image: true });
    await say(s, OWNER_NUMBER, "pick o-1 LED bulb 9W");
    await say(s, CUSTOMER, "3 LED bulb 9W today evening");
    assert.equal(s.templatesTo(CUSTOMER).at(-1), "hold_asked_shop", "three were never picked: the shop is asked");
    assert.deepEqual(s.templatesTo(CUSTOMER, "owner"), ["owner_hold_enquiry", "owner_hold_ask"]);
  });

  contract("the customer lets go of the hold: released at once, the owner is told, nothing to pay", async () => {
    const s = await boot();
    await say(s, CUSTOMER, "1 MCB 16A today evening");
    await say(s, OWNER_NUMBER, "approve o-1");
    await say(s, CUSTOMER, "cancel");
    assert.equal(s.templatesTo(CUSTOMER).at(-1), "hold_cancelled");
    assert.ok(s.templatesTo(CUSTOMER, "owner").includes("owner_hold_cancelled"));
    assert.deepEqual(await items(s, "hold"), []);
    await say(s, RAJESH, "1 MCB 16A today evening");
    await say(s, OWNER_NUMBER, "approve o-2");
    assert.equal(s.templatesTo(RAJESH).at(-1), "hold_held");
  });
});

describe("the pickup hold: the monthly page's numbers, and the shop's page", () => {
  contract("the report counts enquiries (answered or not), holds collected, holds that ended, and collections per ten enquiries, from the runtime's own record", async () => {
    const s = await boot({ tickSeconds: 1 });
    await say(s, CUSTOMER, "1 MCB 16A today morning");
    await say(s, OWNER_NUMBER, "approve o-1");
    await say(s, OWNER_NUMBER, "collected o-1");
    await say(s, RAJESH, "1 LED bulb 9W today morning");
    await say(s, OWNER_NUMBER, "approve o-2");
    await say(s, SUNITA, "", { image: true }); // never answered: still an enquiry
    s.advance(3 * 60 * MIN + MIN); await beat(); await beat();
    const entries = s.record().map((r, seq) => ({ ...r, seq, decisions: [], time: "" })) as never;
    assert.deepEqual(holdsOf(entries), { enquiries: 3, collected: 1, expired: 1, perTen: 3 });
  });

  contract("the shop's order page and its API take no order on a hold shop: it says to ask on WhatsApp", async () => {
    const s = await boot();
    const r = await s.order({ lines: [{ itemId: "mcb-16a", qty: 1 }], slotId: "evening" });
    const v = (await s.request(r.hash)).body;
    assert.deepEqual([v.status, v.reason], ["refused", "whatsapp_only"]);
    assert.deepEqual(await items(s, "hold"), []);
  });
});
