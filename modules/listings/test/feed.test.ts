// The open data (modules/listings/feed.ts): listings.json and the schema.org JSON-LD carry only public listings, the owner's price, the place and the photos' exact addresses, nothing
// private, and the JSON for a script block cannot be ended by a shop's own words. Written, not run, in the 18 Nov build stream.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DAY } from "../../core/time.ts";
import { ownerAuthority } from "../../memory/memory.ts";
import { FEED_FORMAT, buildFeed, buildJsonLd, jsonForScript, photoPath } from "../feed.ts";
import { draft, emptyListings, markSold, publish, setShop, HIDE_AFTER_MS } from "../listings.ts";
import type { DraftInput } from "../listings.ts";

const NOW = 1_800_000_000_000;
const owner = ownerAuthority("app");
const shop = { name: "Paws & Co", page: "https://pages.streetlist.in/s/paws", phone: "+91 98765 43210" };
const photo = { id: "ph-0123456789ab", type: "image/jpeg" as const, width: 800, height: 600, bytes: 1000 };
const make = (s: ReturnType<typeof emptyListings>, input: Partial<DraftInput> = {}) => {
  const d = draft(s, { category: "pets", ownerLang: "en", words: { en: { title: "Persian kitten", text: "Two kittens" }, hi: { title: "फ़ारसी बिल्ली का बच्चा", text: "दो बच्चे" } }, pricePaise: 800000, priceNote: "each", qty: 2, photos: [photo], ...input }, { nowMs: NOW });
  assert.ok(d.ok);
  const p = publish(s, owner, d.value.id, { nowMs: NOW });
  assert.ok(p.ok);
  return p.value;
};

test("the feed carries live public listings only, in its documented shape", () => {
  const s = emptyListings();
  setShop(s, owner, { visible: true, town: "Thrissur", pincode: "680001", point: { lat: 10.52, lon: 76.21 }, registration: "PS/KL/2026/123" });
  const a = make(s);
  const sold = make(s, { words: { en: { title: "Sold cat", text: "" } } });
  markSold(s, owner, sold.id, { nowMs: NOW });
  draft(s, { category: "other", ownerLang: "en", words: { en: { title: "A draft", text: "" } } }, { nowMs: NOW });
  const old = make(s, { words: { en: { title: "Old one", text: "" } } });
  const f = buildFeed(s, shop, NOW + HIDE_AFTER_MS - DAY);
  assert.equal(f.format, FEED_FORMAT);
  assert.deepEqual(f.shop.place, { town: "Thrissur", pincode: "680001", lat: 10.52, lon: 76.21, country: "IN" });
  assert.deepEqual(f.shop.registration, { text: "PS/KL/2026/123", by: "the owner says" });
  assert.deepEqual(f.listings.map((l) => l.id).sort(), [a.id, old.id].sort());
  const l = f.listings.find((x) => x.id === a.id)!;
  assert.deepEqual(l.price, { amount: 8000, currency: "INR", note: "each" });
  assert.equal(l.freshness, "check");
  assert.deepEqual(l.machineWritten, ["hi"]);
  assert.equal(l.photos[0].url, `https://pages.streetlist.in/s/paws${photoPath(photo.id, photo.type)}`);
  assert.ok(!/\/p\//u.test(l.photos[0].url), "not the door's stable page address");
  const later = buildFeed(s, shop, NOW + HIDE_AFTER_MS + 1);
  assert.equal(later.listings.length, 0, "nothing past 30 days without a confirm");
});

test("a listing with no price says nothing about one (ask the shop)", () => {
  const s = emptyListings();
  const l = make(s, { pricePaise: undefined, priceNote: undefined });
  const f = buildFeed(s, shop, NOW);
  assert.equal(f.listings[0].price, undefined);
  const ld = buildJsonLd(s, shop, "en", NOW) as { "@graph": { offers?: { price?: string } }[] };
  assert.equal(ld["@graph"][1].offers?.price, undefined);
  assert.equal(l.pricePaise, undefined);
});

test("nothing private is in the feed or the JSON-LD: no customer's number, no draft, no owner's number unless given as the shop's public one", () => {
  const s = emptyListings();
  make(s);
  const quiet = buildFeed(s, { name: "Paws", page: shop.page }, NOW);
  assert.ok(!JSON.stringify(quiet).includes("98765"));
  assert.equal(quiet.shop.phone, undefined);
  const withPhone = buildFeed(s, shop, NOW);
  assert.equal(withPhone.shop.phone, shop.phone);
  assert.ok(!/"by"|"from"|digest|confirmedMs|askedMs/u.test(JSON.stringify(withPhone.listings)));
});

test("JSON-LD: the shop is a Store with its place, each public listing a Product with an INR Offer in stock", () => {
  const s = emptyListings();
  setShop(s, owner, { town: "Thrissur", pincode: "680001", point: { lat: 10.52, lon: 76.21 } });
  const l = make(s);
  const ld = buildJsonLd(s, shop, "hi", NOW) as { "@context": string; "@graph": Record<string, any>[] };
  assert.equal(ld["@context"], "https://schema.org");
  const [store, product] = ld["@graph"];
  assert.equal(store["@type"], "Store");
  assert.equal(store.address.addressLocality, "Thrissur");
  assert.equal(store.geo.latitude, 10.52);
  assert.equal(product["@type"], "Product");
  assert.equal(product.name, "फ़ारसी बिल्ली का बच्चा");
  assert.equal(product.offers.priceCurrency, "INR");
  assert.equal(product.offers.price, "8000");
  assert.equal(product.offers.availability, "https://schema.org/InStock");
  assert.equal(product.image[0], `${shop.page}${photoPath(photo.id, photo.type)}`);
  assert.ok(product["@id"].endsWith(`#${l.id}`));
});

test("JSON for a script block cannot be ended or broken by a shop's own words", () => {
  const out = jsonForScript({ name: "</script><script>alert(1)</script> & \u2028 <!--" });
  assert.ok(!/[<>&\u2028\u2029]/u.test(out));
  assert.deepEqual(JSON.parse(out), { name: "</script><script>alert(1)</script> & \u2028 <!--" });
});
