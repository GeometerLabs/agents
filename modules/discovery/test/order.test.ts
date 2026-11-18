// The fair order (specs/directory.md "The order"): each rule alone, the taking of turns, the cap of three per shop in the first ten, and the proof that nothing
// but the six allowed fields can reach the order: not a price, a plan, a payment, an Operator, advertising, size or popularity. Written 18 Nov 2026.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BAND_EDGES_KM, ORDER_FIELDS, PER_SHOP_IN_FIRST_PAGE, UNKNOWN_BAND, orderResults, turnHash } from "../order.ts";
import type { Candidate, OrderQuery } from "../order.ts";

const c = (key: string, over: Partial<Candidate> = {}): Candidate => ({ key, shop: over.shop ?? `shop-${key}`, fit: 0, distanceKm: 1, sameTown: true, inStock: true, ...over });
const point: OrderQuery = { place: "point", seed: "2026-11-18|kitten|" };

test("fit first: every word before some words, whatever the distance", () => {
  assert.deepEqual(orderResults([c("some-near", { fit: 1, distanceKm: 0.1 }), c("all-far", { fit: 0, distanceKm: 80 })], point), ["all-far", "some-near"]);
});

test("distance in bands: nearer band first; inside one band the distance itself does not matter", () => {
  const list = [c("d60", { distanceKm: 60 }), c("d7", { distanceKm: 7 }), c("d1", { distanceKm: 1.9 }), c("d3", { distanceKm: 3 }), c("d30", { distanceKm: 30 }), c("d12", { distanceKm: 12 })];
  assert.deepEqual(orderResults(list, point), ["d1", "d3", "d7", "d12", "d30", "d60"]);
  assert.deepEqual(BAND_EDGES_KM, [2, 5, 10, 25, 50]);
  // 0.2 km and 1.9 km are the same band: which is first is decided by taking turns, not by 1.7 km
  const same = [c("a", { distanceKm: 0.2 }), c("b", { distanceKm: 1.9 })];
  const firsts = new Set<string>();
  for (let day = 1; day <= 30; day++) firsts.add(orderResults(same, { place: "point", seed: `2026-11-${day}|x|` })[0]);
  assert.equal(firsts.size, 2, "over 30 days each of two shops in one band is first sometimes");
});

test("no map point on a shop: near only in the buyer's own town, otherwise last; only a town: that town first; no place: all alike", () => {
  const unknown = [c("far-no-point", { distanceKm: null, sameTown: false }), c("town-no-point", { distanceKm: null, sameTown: true }), c("known", { distanceKm: 40, sameTown: false })];
  assert.deepEqual(orderResults(unknown, point), ["town-no-point", "known", "far-no-point"]);
  assert.equal(UNKNOWN_BAND, 6);
  assert.deepEqual(orderResults([c("elsewhere", { sameTown: false, distanceKm: null }), c("here", { sameTown: true, distanceKm: null })], { place: "town", seed: "s" }), ["here", "elsewhere"]);
  const none = ["a", "b", "c"].map((k) => c(k, { distanceKm: k === "a" ? 90 : 1, sameTown: false }));
  assert.equal(new Set(orderResults(none, { place: "none", seed: "s" })).size, 3);
  // with no place, the distance a caller happens to carry is not used: changing it changes nothing
  assert.deepEqual(orderResults(none, { place: "none", seed: "s" }), orderResults(none.map((x) => ({ ...x, distanceKm: 1 })), { place: "none", seed: "s" }));
});

test("freshness: in stock before call to check within a band, but not across bands", () => {
  const list = [c("stale-near", { inStock: false, distanceKm: 1 }), c("fresh-near", { inStock: true, distanceKm: 1.5 }), c("fresh-far", { inStock: true, distanceKm: 8 })];
  assert.deepEqual(orderResults(list, point), ["fresh-near", "stale-near", "fresh-far"]);
});

test("taking turns: the order rotates by day and by search, is the same for the same day and search, and shops alternate item by item", () => {
  const shops = ["a", "b", "c", "d"].flatMap((s) => [1, 2].map((n) => c(`${s}${n}`, { shop: s })));
  const day1 = orderResults(shops, { place: "point", seed: "2026-11-18|kitten|" });
  assert.deepEqual(orderResults(shops, { place: "point", seed: "2026-11-18|kitten|" }), day1, "stable for the same day and search");
  const firsts = new Set<string>();
  for (let day = 1; day <= 28; day++) firsts.add(orderResults(shops, { place: "point", seed: `2026-11-${String(day).padStart(2, "0")}|kitten|` })[0][0]);
  assert.equal(firsts.size, 4, "over four weeks every one of four shops is first on some day");
  const other = new Set<string>();
  for (const q of ["kitten", "puppy", "cat", "dog", "fish", "bird", "goat", "hen"]) other.add(orderResults(shops, { place: "point", seed: `2026-11-18|${q}|` })[0][0]);
  assert.ok(other.size > 1, "another search rotates the shops too");
  // alternation: the first four places hold one item of each of the four shops
  assert.equal(new Set(day1.slice(0, 4).map((k) => k[0])).size, 4);
});

test("at most 3 items of one shop in the first 10, while other shops have items; when only one shop matches, all its items show", () => {
  const greedy = Array.from({ length: 8 }, (_, i) => c(`g${i}`, { shop: "greedy", distanceKm: 0.5 }));
  const others = Array.from({ length: 9 }, (_, i) => c(`o${i}`, { shop: `other-${i}`, distanceKm: 20 }));
  const out = orderResults([...greedy, ...others], point);
  assert.equal(out.slice(0, 10).filter((k) => k.startsWith("g")).length, PER_SHOP_IN_FIRST_PAGE);
  assert.equal(out.length, 17, "nothing is lost: the held-back items follow");
  assert.equal(new Set(out).size, 17);
  assert.equal(out.slice(10).filter((k) => k.startsWith("g")).length, 5, "the rest of the greedy shop's items come after the first ten");
  const alone = orderResults(greedy, point);
  assert.equal(alone.length, 8);
  assert.equal(new Set(alone).size, 8, "one shop alone still shows all it has");
});

test("the order function reads only the allowed fields: the same candidates with other properties attached give the same order", () => {
  const base = ["a", "b", "c", "d", "e", "f"].map((k, i) => c(k, { shop: `s${i % 3}`, distanceKm: i * 3, fit: i % 2 ? 1 : 0, inStock: i % 3 !== 0 }));
  const plain = orderResults(base, point);
  const loaded = base.map((x, i) => ({ ...x, price: 1000 - i, plan: i % 2 ? "paid" : "free", payment: i, operator: `op-${i}`, advertising: true, shopSize: 500 - i, searches: i * 99, name: String(5 - i), rowid: 6 - i }));
  assert.deepEqual(orderResults(loaded as Candidate[], point), plain);
  assert.deepEqual(orderResults([...loaded].reverse() as Candidate[], point), plain, "arrival order changes nothing either");
});

test("the allowed fields are exactly these six, in the code and in the list the test keeps", () => {
  const source = readFileSync(new URL("../order.ts", import.meta.url), "utf8");
  const block = /export interface Candidate \{([\s\S]*?)\n\}/u.exec(source)![1];
  const members = [...block.matchAll(/^\s{2}(\w+)\??:/gmu)].map((m) => m[1]);
  assert.deepEqual(members, ["key", "shop", "fit", "distanceKm", "sameTown", "inStock"]);
  assert.deepEqual([...ORDER_FIELDS], members);
  // the code (comments removed) never names what must not matter
  const code = source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/.*$/gmu, "");
  for (const word of ["price", "plan", "payment", "paid", "operator", "advert", "sponsor", "popular", "rowid", "size", "name", "arrival", "rank", "bm25", "Date", "Math.random"]) assert.ok(!new RegExp(`\\b${word}`, "iu").test(code), `order.ts must not use "${word}"`);
});

test("the hash is stable: the same text, the same 16 hex digits, and different texts differ", () => {
  assert.equal(turnHash("2026-11-18|kitten|shop"), turnHash("2026-11-18|kitten|shop"));
  assert.match(turnHash("x"), /^[0-9a-f]{16}$/u);
  assert.notEqual(turnHash("a"), turnHash("b"));
});
