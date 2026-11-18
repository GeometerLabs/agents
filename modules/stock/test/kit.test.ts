// The runtime's stock kit and what reads the count (modules/stock/kit.ts, the listings kit, the talk sources, the morning line's part, the words): the owner's page ops are checked for shape,
// pre-checked with the rules the step applies, done with the owner's authority in a step and recorded; a counted listing shows its count in the feed and sells itself at 0 without any change
// to the listing; an uncounted listing is as it was; the words are in four languages. Written, not run, in the 18 Nov build stream: the lead's test pass runs it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeClock } from "../../core/clock.ts";
import { createRecord } from "../../record/record.ts";
import { ownerAuthority } from "../../memory/memory.ts";
import { createListingsKit, stateOfPublic } from "../../listings/kit.ts";
import { buildFeed } from "../../listings/feed.ts";
import { draft, listingsOf, publish } from "../../listings/listings.ts";
import { listingSources } from "../../assistant/listing-card.ts";
import { morningFacts } from "../../assistant/templates.ts";
import { LANGUAGES } from "../../language/languages.ts";
import { checkText } from "../../language/check.ts";
import { checkOwnerStock, createStockKit } from "../kit.ts";
import type { OwnerStockEvent, StockOp } from "../kit.ts";
import { countOf, listingStockId, received, shopRecord, stockOf, supplyStockId } from "../stock.ts";
import { STOCK_LINE_WORDS, stockReviewLines } from "../words.ts";
import type { AssistantState } from "../../assistant/state.ts";

const NOW = 1_800_000_000_000;
type Store = { assistant?: AssistantState };
const kit = createStockKit<Store>({ owner: { whatsapp: "+919000000000", language: "en" }, items: () => [{ id: supplyStockId("rice"), name: "Rice 25 kg", unit: "bag" }] });
const listingsKit = createListingsKit<Store>({ owner: { whatsapp: "+919000000000", language: "en" }, timezone: "Asia/Kolkata" });
const world = () => { const clock = fakeClock(NOW); return { store: {} as Store, record: createRecord(clock) }; };
const ev = (op: StockOp, id = "r-1"): OwnerStockEvent => ({ kind: "owner_stock", id, op });
const run = (w: ReturnType<typeof world>, e: OwnerStockEvent, at = NOW) => kit.run(e, { store: w.store, record: w.record, nowMs: at });

/** A store with one live kitten listing (the owner's own quantity 2) published by the owner. */
function withKitten() {
  const w = world();
  const ls = listingsOf((w.store.assistant = { seq: 0, cards: [], refused: [], closedDays: [], undo: [], talk: [], limitChanges: [] }));
  const d = draft(ls, { category: "pets", ownerLang: "en", words: { en: { title: "Persian kitten", text: "" } }, pricePaise: 800000, qty: 2 }, { nowMs: NOW });
  assert.ok(d.ok);
  assert.ok(publish(ls, ownerAuthority("app"), "l-1", { nowMs: NOW }).ok);
  return w;
}

test("the body of an op is checked for shape; anything else is refused with a sentence", () => {
  assert.ok(checkOwnerStock({ id: "r-1", op: { op: "start", id: "listing:l-1", count: 2, low: 1 } }).ok);
  assert.ok(checkOwnerStock({ id: "r-1", op: { op: "correct", id: "menu:thali", to: 4, shown: 5 } }).ok);
  assert.ok(checkOwnerStock({ id: "r-1", op: { op: "sold", id: "supply:rice", qty: 1 } }).ok);
  assert.ok(checkOwnerStock({ id: "r-1", op: { op: "low", id: "supply:rice", low: null } }).ok);
  assert.ok(checkOwnerStock({ id: "r-1", op: { op: "stop", id: "supply:rice" } }).ok);
  assert.ok(!checkOwnerStock({ id: "bad id", op: { op: "stop", id: "supply:rice" } }).ok);
  assert.ok(!checkOwnerStock({ id: "r-1", op: { op: "stop", id: "../etc" } }).ok);
  assert.ok(!checkOwnerStock({ id: "r-1", op: { op: "start", id: "menu:thali", count: "many" } }).ok);
  assert.ok(!checkOwnerStock({ id: "r-1", op: { op: "launch", id: "menu:thali" } }).ok);
  assert.ok(!checkOwnerStock({ id: "r-1", op: { op: "correct", id: "menu:thali" } }).ok);
  assert.ok(!checkOwnerStock({ id: "r-1" }).ok);
  assert.equal(kit.takes({ kind: "owner_stock" }), true);
  assert.equal(kit.takes({ kind: "message" }), false);
});

test("start, correct, sold and stop run in a step with the owner's authority and leave one record line each", () => {
  const w = world();
  run(w, ev({ op: "start", id: "supply:rice", count: 6, low: 2 }, "r-1"));
  const s = stockOf(w.store.assistant!);
  assert.equal(countOf(s, "supply:rice"), 6);
  assert.equal(s.lines[0].name, "Rice 25 kg", "the line takes the item's own name and unit when the page sent none");
  assert.equal(s.lines[0].unit, "bag");
  run(w, ev({ op: "sold", id: "supply:rice", qty: 2 }, "r-2"));
  run(w, ev({ op: "sold", id: "supply:rice", qty: 2 }, "r-2"));
  assert.equal(countOf(s, "supply:rice"), 4, "the page's request id is the key: a double tap counts once");
  run(w, ev({ op: "correct", id: "supply:rice", to: 9, shown: 4 }, "r-3"));
  assert.equal(countOf(s, "supply:rice"), 9);
  run(w, ev({ op: "stop", id: "supply:rice" }, "r-4"));
  assert.equal(s.lines.length, 0);
  const lines = w.record.entries().filter((e) => e.action === "stock");
  assert.equal(lines.filter((e) => e.outcome === "confirmed").length, 5, "start, sold, the repeated sold (confirmed, no change), correct, stop");
  assert.ok(lines.every((e) => e.refs.item === "supply:rice" && e.refs.by === "owner"));
});

test("a refused op changes nothing, is recorded as blocked, and the page's pre-check says why before the step", () => {
  const w = world();
  assert.equal(kit.check(w.store, ev({ op: "correct", id: "menu:thali", to: 3 }), NOW), "no_such_line");
  assert.equal(kit.check(w.store, ev({ op: "start", id: "menu:thali", count: -3 }), NOW), "bad_count");
  assert.equal(kit.check(w.store, ev({ op: "start", id: "menu:thali", count: 3 }), NOW), undefined);
  assert.equal(w.store.assistant, undefined, "the pre-check works on a copy and makes nothing");
  run(w, ev({ op: "start", id: "menu:thali", count: -3 }));
  assert.equal(stockOf(w.store.assistant!).lines.length, 0);
  assert.equal(w.record.entries().at(-1)?.outcome, "blocked");
  run(w, ev({ op: "start", id: "menu:thali", count: 3 }, "r-2"));
  assert.equal(kit.check(w.store, ev({ op: "start", id: "menu:thali", count: 3 }, "r-3"), NOW), "exists");
});

test("the owner's view lists low and sold-out items first and offers the uncounted listings and template items to count", () => {
  const w = withKitten();
  let v = kit.ownerView(w.store, NOW);
  assert.deepEqual(v.candidates.map((c) => c.id).sort(), ["listing:l-1", "supply:rice"]);
  assert.equal(v.rows.length, 0);
  run(w, ev({ op: "start", id: "listing:l-1", count: 2, low: 1 }));
  v = kit.ownerView(w.store, NOW);
  assert.equal(v.rows[0].name, "Persian kitten");
  assert.deepEqual(v.candidates.map((c) => c.id), ["supply:rice"]);
  run(w, ev({ op: "sold", id: "listing:l-1", qty: 1 }, "r-2"));
  v = kit.ownerView(w.store, NOW);
  assert.equal(v.attention, 1);
  assert.equal(v.rows[0].isLow, true);
});

test("a counted listing shows its count as its quantity in the feed and sells itself at 0; the listing's own fields never change", () => {
  const w = withKitten();
  const before = JSON.stringify(listingsOf(w.store.assistant!));
  let pub = listingsKit.publicRead(w.store, NOW);
  assert.equal(pub.listings[0].qty, 2, "uncounted: the owner's own quantity, as before");
  run(w, ev({ op: "start", id: "listing:l-1", count: 5 }));
  pub = listingsKit.publicRead(w.store, NOW);
  assert.equal(pub.listings[0].qty, 5, "counted: the count");
  const feed = buildFeed(stateOfPublic(pub), { name: "Pet Corner", page: "https://example.test/s/pet-corner" }, NOW);
  assert.equal(feed.items[0].quantity, 5);
  run(w, ev({ op: "sold", id: "listing:l-1", qty: 5 }, "r-2"));
  assert.equal(listingsKit.publicRead(w.store, NOW).listings.length, 0, "at 0 it is off the page and out of the feed");
  assert.equal(listingsKit.publicPhoto(w.store, "ph-0123456789ab", NOW), undefined);
  assert.equal(JSON.stringify(listingsOf(w.store.assistant!)), before, "nothing was written to the listing: its words, price and card digest are as the owner made them");
  const row = listingsKit.ownerView(w.store, NOW).listings[0];
  assert.equal(row.soldOut, true);
  assert.equal(row.counted, true);
  assert.equal(listingSources(listingsOf(w.store.assistant!), NOW, w.store.assistant!.stock).length, 0, "the shop's talk cannot offer a listing that has sold itself");
  run(w, ev({ op: "correct", id: "listing:l-1", to: 1 }, "r-3"));
  assert.equal(listingsKit.publicRead(w.store, NOW).listings[0].qty, 1, "the owner's correction brings it back");
});

test("an uncounted listing is exactly as it was: no stock state is made by reading it", () => {
  const w = withKitten();
  const pub = listingsKit.publicRead(w.store, NOW);
  assert.equal(pub.listings[0].qty, 2);
  listingsKit.ownerView(w.store, NOW);
  assert.equal(w.store.assistant!.stock, undefined);
  assert.match(listingSources(listingsOf(w.store.assistant!), NOW)[0].text, /Quantity: 2\./u);
});

test("a delivery reaches a counted listing that shares the rice line by alias", () => {
  const w = withKitten();
  const s = stockOf(w.store.assistant!);
  run(w, ev({ op: "start", id: "supply:rice", count: 1 }));
  s.lines[0].aliases = [listingStockId("l-1")]; // linked by the owner or the panel
  received(s, shopRecord("stock-orders"), "supply:rice", "delivery:po-1", 4, "bag", { nowMs: NOW });
  assert.equal(listingsKit.publicRead(w.store, NOW).listings[0].qty, 5);
});

test("the morning line says 'running low' in all four languages, with the number checked against its facts", () => {
  for (const language of LANGUAGES) {
    const facts = morningFacts({ language, timeZone: "Asia/Kolkata", shop: "Pet Corner", today: { year: 2026, month: 11, day: 18 }, parts: [{ low: 2 }], moneyPaise: 0, waiting: 0 });
    assert.ok(facts.values.today.includes(STOCK_LINE_WORDS[language].morningLow(facts.values.today.match(/\d+|[०-९൦-൯೦-೯]+/u)?.[0] ?? "2")), language);
    assert.ok(checkText(facts.values.today, facts.check).ok, `${language}: the morning part passes the outgoing check`);
  }
});

test("every line is in all four languages, with the same ids on the review sheets, and none says a promise the shop cannot keep", () => {
  const en = Object.keys(stockReviewLines("en")).sort();
  for (const language of LANGUAGES) {
    const lines = stockReviewLines(language);
    assert.deepEqual(Object.keys(lines).sort(), en, `${language} has every line`);
    for (const [id, text] of Object.entries(lines)) {
      assert.ok(text.trim().length > 0, `${language} ${id} is not empty`);
      assert.ok(!/\b(safe|guaranteed?|proves?|certified|100%|earn|income|bot|founder)\b/iu.test(text), `${language} ${id}: ${text}`);
    }
  }
  assert.notEqual(stockReviewLines("hi").title, stockReviewLines("en").title);
  assert.match(stockReviewLines("hi").title, /[ऀ-ॿ]/u);
  assert.match(stockReviewLines("ml").title, /[ഀ-ൿ]/u);
  assert.match(stockReviewLines("kn").title, /[ಀ-೿]/u);
  for (const language of LANGUAGES) {
    const w = STOCK_LINE_WORDS[language];
    assert.match(w.reorderAsk("Rice 5 kg", 3, "Ravi Traders"), /Ravi Traders/u);
    assert.match(w.runningLow("Rice 5 kg", 3), /3/u);
  }
});

// ---- "Still have it? Yes" on a listing that sold itself: the card and the page's Confirm button agree ------------------------------------------------

test("Yes has two doors and they agree: the morning card's Yes and the page's Confirm both set the count to the number the owner first said, once", async () => {
  const { createListings } = await import("../../assistant/listing-card.ts");
  for (const door of ["card", "page"] as const) {
    const w = withKitten();
    run(w, ev({ op: "start", id: "listing:l-1", count: 1 }, `start-${door}`));
    run(w, ev({ op: "sold", id: "listing:l-1", qty: 1 }, `sold-${door}`));
    assert.equal(listingsKit.publicRead(w.store, NOW).listings.length, 0, "sold itself");
    const l = listingsOf(w.store.assistant!).items[0];
    if (door === "page") {
      listingsKit.run({ kind: "owner_listing", id: "c-1", op: { op: "confirm", id: "l-1", confirmedMs: l.confirmedMs! } }, { store: w.store, record: w.record, nowMs: NOW + 1000 });
    } else {
      const logged: string[] = [];
      const listings = createListings({ store: w.store, nowMs: () => NOW + 1000, ownerLanguage: "en", log: (action) => { logged.push(action); } });
      const done = await listings.skill.execute({ kind: "listing_ask", skill: "listings", case: "listing:l-1", fields: { title: "Persian kitten", confirmedMs: l.confirmedMs!, answer: "yes" } });
      assert.equal(done.ok, true);
      assert.ok(logged.includes("stock"), "the correction is recorded");
    }
    assert.equal(countOf(stockOf(w.store.assistant!), "listing:l-1"), 2, `${door}: the owner first said 2 kittens`);
    assert.equal(listingsKit.publicRead(w.store, NOW + 1000).listings.length, 1, `${door}: it shows again`);
  }
});

test("a Confirm on a counted listing that still has stock changes no count", () => {
  const w = withKitten();
  run(w, ev({ op: "start", id: "listing:l-1", count: 3 }));
  const l = listingsOf(w.store.assistant!).items[0];
  listingsKit.run({ kind: "owner_listing", id: "c-2", op: { op: "confirm", id: "l-1", confirmedMs: l.confirmedMs! } }, { store: w.store, record: w.record, nowMs: NOW + 1000 });
  assert.equal(countOf(stockOf(w.store.assistant!), "listing:l-1"), 3);
});
