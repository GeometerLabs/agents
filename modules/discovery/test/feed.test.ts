// Reading a shop feed: the spec's limits, fields, money strings and categories, the rule that every address sits under the shop's own page, and the
// key-pinning decision. Written 18 Nov 2026.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFeed, feedUrlOf, readFeed } from "../feed.ts";
import { trustFeed } from "../trust.ts";
import { generateSigningKey } from "../../signing/keys.ts";
import { item, shop } from "./fixtures.ts";

const s = shop("rani-pets", { lat: "10.527642" });
const read = (doc: unknown, url = s.feedUrl) => readFeed(doc, url);

test("a good feed is read: the shop, its place with the map point, the items in every language", () => {
  const r = parseFeed(JSON.stringify(s.feed([item(s.page, "l-3")])), s.feedUrl);
  assert.ok(r.ok);
  assert.equal(r.feed.shop.name, "rani-pets");
  assert.deepEqual(r.feed.shop.place, { town: "Thrissur", lat: "10.527642", lon: "76.214435" });
  assert.equal(r.feed.items[0].title.ml, "പേർഷ്യൻ പൂച്ചക്കുട്ടി");
  assert.equal(r.feed.items[0].price?.value, "8000.00");
  assert.deepEqual(r.dropped, []);
  assert.equal(feedUrlOf(s.page), s.feedUrl);
});

test("what is refused as a whole: over 1 MB, not JSON, another format, over 200 items, a feed at the wrong address", () => {
  assert.deepEqual(parseFeed("x".repeat(1_000_001), s.feedUrl), { ok: false, reason: "the feed is over 1 MB" });
  assert.equal(parseFeed("{", s.feedUrl).ok, false);
  assert.equal(read({ ...s.feed([]), format: "shop-feed/2" }).ok, false);
  const many = Array.from({ length: 201 }, (_, i) => item(s.page, `l-${i}`));
  assert.match((read(s.feed(many)) as { reason: string }).reason, /more than 200/u);
  assert.equal(read(s.feed(Array.from({ length: 200 }, (_, i) => item(s.page, `l-${i}`)))).ok, true, "exactly 200 is fine");
  assert.match((read(s.feed([]), "https://pages.example/other/listings.json") as { reason: string }).reason, /address/u);
});

test("every address in the feed must sit under the shop's own page, so a feed cannot speak for another shop or point the directory elsewhere", () => {
  const doc = s.feed([item(s.page, "l-3")]) as { shop: Record<string, unknown> };
  for (const field of ["chat", "check", "agentCard"]) {
    const bad = structuredClone(doc); bad.shop[field] = "https://evil.example/x";
    assert.equal(read(bad).ok, false, field);
    const sibling = structuredClone(doc); sibling.shop[field] = "https://pages.example/other-shop/chat";
    assert.equal(read(sibling).ok, false, `${field} under another shop`);
  }
  const claim = structuredClone(doc); claim.shop.page = "https://pages.example/other-shop/";
  assert.equal(read(claim).ok, false, "a feed at rani-pets/listings.json cannot say its page is other-shop");
  const http = structuredClone(doc); http.shop.chat = `http://pages.example/rani-pets/chat`;
  assert.equal(read(http).ok, false, "https only");
});

test("a bad item is dropped with a note and the shop's other items stay: price floats, bad category, three photos at most, a photo off the page, a duplicate id", () => {
  const items = [
    item(s.page, "l-1"),
    item(s.page, "l-2", { price: { value: "80", currency: "INR" } }),
    item(s.page, "l-3", { price: { value: "80.5", currency: "INR" } }),
    item(s.page, "l-4", { category: "weapons" as never }),
    item(s.page, "l-5", { photos: Array.from({ length: 4 }, () => ({ url: `${s.page}p.jpg`, type: "image/jpeg" as const })) }),
    item(s.page, "l-6", { photos: [{ url: "https://cdn.example/p.jpg", type: "image/jpeg" }] }),
    item(s.page, "l-7", { photos: [{ url: `${s.page}p.png`, type: "image/png" as never }] }),
    item(s.page, "l-1"),
    item(s.page, "l-8", { price: null }),
    item(s.page, "l-9", { price: { value: 8000 as never, currency: "INR" } }),
    item(s.page, "l-10", { availability: "gone" as never }),
    item(s.page, "l-11", { page: "https://pages.example/other-shop/#l-11" }),
    item(s.page, "l-12", { title: {} }),
  ];
  const r = read(s.feed(items));
  assert.ok(r.ok);
  assert.deepEqual(r.feed.items.map((i) => i.id), ["l-1", "l-8"]);
  assert.equal(r.feed.items[1].price, null, "null price is 'ask the shop'");
  assert.equal(r.dropped.length, 11);
});

test("the map point is both or none, with at most 6 places; the registration is always the owner's word", () => {
  const doc = s.feed([]) as { shop: { place: Record<string, string>; registration?: unknown } };
  for (const place of [{ town: "T", lat: "10.5" }, { town: "T", lat: "10.1234567", lon: "76" }, { town: "T", lat: "91", lon: "76" }, { town: "T", lat: "ten", lon: "76" }, { town: "T", pincode: "6800" }]) {
    const bad = structuredClone(doc); bad.shop.place = place;
    assert.equal(read(bad).ok, false, JSON.stringify(place));
  }
  const reg = structuredClone(doc); reg.shop.registration = { kind: "pet-shop", number: "KL/1", source: "verified" };
  const r = read(reg);
  assert.ok(r.ok);
  assert.equal(r.feed.shop.registration?.source, "owner", "a feed cannot claim the number was checked");
});

test("keys: the first key is pinned, the same key is the same, another key is a change, and an unsigned or damaged feed is refused", () => {
  const doc = s.feed([item(s.page, "l-3")]);
  const first = trustFeed(doc, undefined);
  assert.equal(first.state, "first");
  assert.ok(first.state === "first");
  assert.equal(trustFeed(doc, first.pin).state, "same");
  const other = shop("rani-pets", { key: generateSigningKey() });
  const changed = trustFeed(other.feed([item(s.page, "l-3")]), first.pin);
  assert.equal(changed.state, "changed");
  assert.ok(changed.state === "changed" && changed.pinned.keyId === first.pin.keyId && changed.offered.keyId === other.key.keyId);
  const { signature: _s, ...unsigned } = doc as Record<string, unknown>;
  assert.equal(trustFeed(unsigned, undefined).state, "refused");
  const cheaper = structuredClone(doc) as { items: { price: { value: string } }[] };
  cheaper.items[0].price.value = "1.00";
  assert.equal(trustFeed(cheaper, first.pin).state, "refused", "a changed price fails the signature");
});
