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

test("the feed is exactly shop-feed/1: live public listings only, strings for money and places, the spec's names", () => {
  const s = emptyListings();
  setShop(s, owner, { visible: true, town: "Thrissur", pincode: "680001", point: { lat: 10.52, lon: 76.21 }, registration: "PS/KL/2026/123" });
  const a = make(s);
  const sold = make(s, { words: { en: { title: "Sold cat", text: "" } } });
  markSold(s, owner, sold.id, { nowMs: NOW });
  draft(s, { category: "other", ownerLang: "en", words: { en: { title: "A draft", text: "" } } }, { nowMs: NOW });
  const old = make(s, { words: { en: { title: "Old one", text: "" } }, category: "vehicles" });
  const f = buildFeed(s, { ...shop, languages: ["en", "hi"], chat: `${shop.page}/chat` }, NOW + HIDE_AFTER_MS - DAY);
  assert.equal(f.format, "shop-feed/1");
  assert.equal(FEED_FORMAT, "shop-feed/1");
  assert.deepEqual(f.shop.place, { town: "Thrissur", pincode: "680001", lat: "10.52", lon: "76.21" });
  assert.deepEqual(f.shop.registration, { kind: "pet-shop", number: "PS/KL/2026/123", source: "owner" });
  assert.deepEqual(f.shop.languages, ["en", "hi"]);
  assert.equal(f.shop.page, `${shop.page}/`);
  assert.ok(!("signature" in f) && !("check" in f.shop) && !("agentCard" in f.shop), "the key, the check and the Agent Card are not built yet");
  assert.deepEqual(f.items.map((l) => l.id).sort(), [a.id, old.id].sort());
  const l = f.items.find((x) => x.id === a.id)!;
  assert.deepEqual(l.price, { value: "8000.00", currency: "INR", note: "each" });
  assert.equal(l.availability, "call_to_check");
  assert.deepEqual(l.machineWritten, ["hi"]);
  assert.equal(l.ownerLanguage, "en");
  assert.equal(l.quantity, 2);
  assert.equal(l.photos[0].url, `https://pages.streetlist.in/s/paws${photoPath(photo.id, photo.type)}`);
  assert.ok(!/\/p\//u.test(l.photos[0].url), "not the door's stable page address");
  assert.equal(f.items.find((x) => x.id === old.id)!.category, "vehicles_and_cycles");
  assert.match(l.confirmed, /^\d{4}-\d\d-\d\dT/u);
  assert.equal(buildFeed(s, shop, NOW + HIDE_AFTER_MS + 1).items.length, 0, "nothing past 30 days without a confirm");
  assert.equal(buildFeed(s, shop, NOW).items.find((x) => x.id === a.id)!.availability, "in_stock");
});

test("a listing with no price has price null (ask the shop); money is a string, never a float", () => {
  const s = emptyListings();
  make(s, { pricePaise: undefined, priceNote: undefined });
  assert.equal(buildFeed(s, shop, NOW).items[0].price, null);
  const ld = buildJsonLd(s, shop, "en", NOW) as { "@graph": { offers?: { price?: string } }[] };
  assert.equal(ld["@graph"][1].offers?.price, undefined);
  const t = emptyListings();
  make(t, { pricePaise: 12550 });
  assert.equal(buildFeed(t, shop, NOW).items[0].price?.value, "125.50");
});

test("nothing private is in the feed or the JSON-LD: no customer's number, no draft, no owner's number; the page's public phone only in schema.org", () => {
  const s = emptyListings();
  make(s);
  const f = buildFeed(s, { name: "Paws", page: shop.page }, NOW);
  assert.ok(!JSON.stringify(f).includes("98765"));
  assert.ok(!/"by"|"from"|digest|confirmedMs|askedMs|phone|telephone/u.test(JSON.stringify(f)));
  assert.ok(JSON.stringify(buildJsonLd(s, shop, "en", NOW)).includes("+91 98765 43210"));
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
