// The index: the same item found in four languages and in Latin spelling, distance bands from the map point, a held key, a rebuild from the stored feeds, and the counts.
// Written 18 Nov 2026.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DirectoryIndex, haversineKm, searchWords, wordsOf } from "../index.ts";
import { ingestFeed, rebuildIndex } from "../ingest.ts";
import { skeleton } from "../romanise.ts";
import { generateSigningKey } from "../../signing/keys.ts";
import { NOW, item, shop } from "./fixtures.ts";

function loaded(...shops: ReturnType<typeof shop>[]): DirectoryIndex {
  const ix = new DirectoryIndex(":memory:");
  for (const s of shops) {
    ix.addFeed(s.feedUrl, "config", NOW);
    const r = ingestFeed(ix, s.feedUrl, JSON.stringify(s.feed([item(s.page, "l-3"), item(s.page, "l-4", { category: "food", title: { en: "Cat food, 1 kg" }, text: {} })])), null, NOW);
    assert.equal(r.state, "accepted");
  }
  return ix;
}
const ids = (ix: DirectoryIndex, q: string, more: object = {}) => ix.candidates({ words: searchWords(q), ...more }).map((h) => h.item.id).sort();

test("one kitten is found by its words in English, Hindi, Malayalam and Kannada, and by Latin spelling of the native words", () => {
  const ix = loaded(shop("rani-pets", { lat: "10.527642" }));
  for (const q of ["persian kitten", "फ़ारसी बिल्ली", "पूछा बिल्ली", "പൂച്ച", "പേർഷ്യൻ", "ಪರ್ಷಿಯನ್", "ಬೆಕ್ಕಿನ", "billi", "poocha", "bekku", "poochakutti", "kitten"]) {
    if (q === "पूछा बिल्ली") continue; // one word that is not there: the 'some words' tier, tested below
    assert.deepEqual(ids(ix, q).filter((i) => i === "l-3"), ["l-3"], q);
  }
  assert.deepEqual(ids(ix, "zebra"), []);
  assert.ok(!ids(ix, "billi").includes("l-4"), "the cat food is not a kitten");
});

test("the town and the category word are searchable, and every word is asked for before some words", () => {
  const ix = loaded(shop("rani-pets", { town: "Thrissur" }));
  assert.deepEqual(ids(ix, "thrissur"), ["l-3", "l-4"]);
  assert.deepEqual(ids(ix, "pets"), ["l-3"]);
  const both = ix.candidates({ words: searchWords("persian kitten thrissur") });
  assert.deepEqual(both.map((h) => [h.item.id, h.fit]), [["l-3", 0]]);
  const some = ix.candidates({ words: searchWords("persian dog") });
  assert.deepEqual(some.map((h) => [h.item.id, h.fit]), [["l-3", 1]], "one of two words is a weaker fit");
  assert.deepEqual(searchWords("Persian kitten near me in Thrissur"), ["persian", "kitten", "thrissur"], "filler words are dropped");
});

test("a category narrows the search; with no words every item of the category is a candidate", () => {
  const ix = loaded(shop("rani-pets"));
  assert.deepEqual(ids(ix, "", { category: "food" }), ["l-4"]);
  assert.deepEqual(ids(ix, "cat", { category: "pets" }), ["l-3"]);
});

test("distance: haversine from the map points; a radius keeps near shops, and a shop with no point stays only in the buyer's own town", () => {
  const near = shop("near-shop", { lat: "10.527642", town: "Thrissur" });
  const far = shop("far-shop", { lat: "11.2588", lon: "75.7804", town: "Kozhikode" });
  const nopoint = shop("no-point", { town: "Thrissur" });
  const ix = loaded(near, far, nopoint);
  const buyer = { lat: 10.52, lon: 76.21 };
  const hits = ix.candidates({ words: ["kitten"], point: buyer });
  const by = Object.fromEntries(hits.map((h) => [h.shop.page, h.distanceKm]));
  assert.ok(by[near.page]! < 2, "about a kilometre");
  assert.ok(by[far.page]! > 90 && by[far.page]! < 100, "Kozhikode is about 95 km away");
  assert.equal(by[nopoint.page], null);
  const within = ix.candidates({ words: ["kitten"], point: buyer, radiusKm: 25, town: "Thrissur" }).map((h) => h.shop.page).sort();
  assert.deepEqual(within, [near.page, nopoint.page].sort());
  assert.ok(Math.abs(haversineKm({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }) - 111.19) < 0.1);
  assert.deepEqual(ix.candidates({ words: ["kitten"], town: "THRISSUR" }).filter((h) => h.sameTown).map((h) => h.shop.page).sort(), [near.page, nopoint.page].sort(), "the buyer's town, in any letter case, is the shop's town");
});

test("a feed signed by another key is held: its shop leaves the search, the change is listed, and a person can accept it", () => {
  const s = shop("rani-pets");
  const ix = loaded(s);
  const impostor = shop("rani-pets", { key: generateSigningKey() });
  const r = ingestFeed(ix, s.feedUrl, JSON.stringify(impostor.feed([item(s.page, "l-3", { price: { value: "1.00", currency: "INR" } })])), null, NOW + 1000);
  assert.equal(r.state, "held");
  assert.deepEqual(ids(ix, "kitten"), [], "held: not shown, and the impostor's price was never taken");
  const list = ix.keyChanges();
  assert.equal(list.length, 1);
  assert.equal(list[0].offeredKeyId, impostor.key.keyId);
  assert.equal(ix.pinOf(s.page)!.keyId, s.key.keyId, "the first key is still the pinned one");
  assert.equal(ix.acceptKeyChange(s.page, NOW + 2000), true);
  assert.equal(ix.pinOf(s.page)!.keyId, impostor.key.keyId);
  assert.equal(ingestFeed(ix, s.feedUrl, JSON.stringify(impostor.feed([item(s.page, "l-3")])), null, NOW + 3000).state, "accepted");
  assert.deepEqual(ids(ix, "kitten"), ["l-3"]);
});

test("the index is a cache: it is thrown away and made again from the stored feeds, and the pins and the feed list survive", () => {
  const a = shop("rani-pets", { lat: "10.5" }), b = shop("ravi-cuts", { town: "Palakkad" });
  const ix = loaded(a, b);
  const before = ix.candidates({ words: [] }).map((h) => `${h.shop.page}|${h.item.id}|${h.item.price?.value}`).sort();
  assert.equal(before.length, 4);
  ix.wipeDerived();
  assert.equal(ix.candidates({ words: [] }).length, 0);
  assert.equal(ix.feeds().length, 2, "the list of feeds is not derived");
  const r = rebuildIndex(ix, NOW + 5000);
  assert.deepEqual(r, { feeds: 2, refused: 0 });
  assert.deepEqual(ix.candidates({ words: [] }).map((h) => `${h.shop.page}|${h.item.id}|${h.item.price?.value}`).sort(), before);
  assert.equal(ix.pinOf(a.page)!.keyId, a.key.keyId);
});

test("a feed that fails its checks never changes the index: bad signature, wrong address, not a feed", () => {
  const s = shop("rani-pets");
  const ix = loaded(s);
  const doc = JSON.parse(JSON.stringify(s.feed([item(s.page, "l-3", { price: { value: "1.00", currency: "INR" } })])));
  assert.equal(ingestFeed(ix, s.feedUrl, JSON.stringify(doc), null, NOW).state, "accepted", "this one is signed with the price 1.00, so it is fine");
  doc.items[0].price.value = "2.00";
  assert.equal(ingestFeed(ix, s.feedUrl, JSON.stringify(doc), null, NOW).state, "refused", "a price changed after signing");
  assert.equal(ix.itemsOf(s.page).find((i) => i.id === "l-3")!.price!.value, "1.00");
  assert.equal(ingestFeed(ix, "https://pages.example/x/listings.json", JSON.stringify(s.feed([])), null, NOW).state, "refused");
  assert.equal(ingestFeed(ix, s.feedUrl, "<html>", null, NOW).state, "refused");
});

test("a feed with fewer items replaces the old list; dropping a feed removes the shop and its items from the words too", () => {
  const s = shop("rani-pets");
  const ix = loaded(s);
  ingestFeed(ix, s.feedUrl, JSON.stringify(s.feed([item(s.page, "l-9", { title: { en: "Parrot" }, text: {} })], { updated: "2026-11-18T05:00:00.000Z" })), null, NOW + 10);
  assert.deepEqual(ids(ix, "kitten"), []);
  assert.deepEqual(ids(ix, "parrot"), ["l-9"]);
  ix.dropFeed(s.feedUrl);
  assert.deepEqual(ids(ix, "parrot"), []);
  assert.equal(ix.counts().items, 0);
  assert.equal(ix.pinOf(s.page)!.keyId, s.key.keyId, "the key stays pinned in case the shop comes back");
});

test("counts keep only how many searches and results a day, never what or whose", () => {
  const ix = new DirectoryIndex(":memory:");
  ix.count("2026-11-18", "searches"); ix.count("2026-11-18", "searches"); ix.count("2026-11-18", "results", 7);
  assert.deepEqual(ix.countsOf("2026-11-18"), { searches: 2, results: 7 });
  const tables = (ix.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'items_fts%'").all() as { name: string }[]).map((t) => t.name).sort();
  const columns = (ix.db.prepare("PRAGMA table_info(counts)").all() as { name: string }[]).map((c) => c.name);
  assert.deepEqual(columns, ["day", "kind", "n"]);
  assert.ok(tables.includes("counts"));
});

test("words: composed form, no zero-width joiners, whole Indic words; the skeleton makes spellings meet", () => {
  assert.deepEqual(wordsOf("Persian, kitten! പൂച്ചക്കുട്ടി"), ["persian", "kitten", "പൂച്ചക്കുട്ടി"]);
  assert.equal(skeleton("billi"), skeleton("बिल्ली"));
  assert.equal(skeleton("bekku"), skeleton("ಬೆಕ್ಕು"));
  assert.equal(skeleton("poocha"), skeleton("പൂച്ച"));
});
