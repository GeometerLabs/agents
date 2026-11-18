// A search with checks: a shop's answer changes the price and drops what is gone; a shop that is silent, slow, wrongly signed or replaying an old answer is shown from the
// index with "Call to check"; the shop receives item ids and nothing else; answers are kept 60 seconds; the request is cleaned. Written 18 Nov 2026.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DirectoryIndex } from "../index.ts";
import { ingestFeed } from "../ingest.ts";
import { createChecker } from "../check.ts";
import { dayOf, readRequest, searchListings, wordsFor } from "../search.ts";
import type { Fetcher } from "../types.ts";
import { generateSigningKey } from "../../signing/keys.ts";
import { signAnswer } from "../../signing/sign.ts";
import { NOW, item, shop } from "./fixtures.ts";
import type { TestShop } from "./fixtures.ts";

const ORIGIN = "https://pages.example";

/** An index with the given shops loaded (each with the kitten l-3 and the dog l-4), a checker over a scripted fetcher, and the log of what was asked. */
function world(shops: TestShop[], answers: Record<string, (body: { format: string; ids: string[] }) => Promise<unknown> | unknown>, clock = { now: NOW }) {
  const index = new DirectoryIndex(":memory:");
  for (const s of shops) {
    index.addFeed(s.feedUrl, "config", NOW);
    ingestFeed(index, s.feedUrl, JSON.stringify(s.feed([item(s.page, "l-3"), item(s.page, "l-4", { title: { en: "Labrador puppy", ml: "ലാബ്രഡോർ" }, text: {} })])), null, NOW);
  }
  const asked: { url: string; method: string; headers: Record<string, string>; body: string }[] = [];
  const fetch: Fetcher = async (url, init) => {
    asked.push({ url, method: init.method, headers: init.headers ?? {}, body: init.body ?? "" });
    const handler = answers[url];
    if (!handler) throw new Error("no route");
    const out = await handler(JSON.parse(init.body ?? "{}"));
    return { status: 200, headers: {}, body: JSON.stringify(out) };
  };
  const checker = createChecker({ fetch, now: () => clock.now, timeoutMs: 50 });
  return { index, asked, deps: { index, checker, origin: ORIGIN, now: () => clock.now }, clock };
}
const checkUrl = (s: TestShop) => `${s.page}api/v1/check`;

test("a shop's answer sets the price and freshness, gone is dropped, and the result carries the chat link with the item", async () => {
  const a = shop("rani-pets", { lat: "10.527642" });
  const w = world([a], { [checkUrl(a)]: (b) => a.answer(b.ids.map((id) => id === "l-3" ? { id, availability: "in_stock" as const, price: { value: "7500.00", currency: "INR" as const, note: "each" }, confirmed: "2026-11-18T08:00:00.000Z" } : { id, availability: "gone" as const })) });
  const r = await searchListings(w.deps, { q: "kitten puppy", lang: "en" });
  assert.ok(r.ok);
  assert.deepEqual(r.answer.results.map((x) => x.item.id), ["l-3"], "l-4 is gone and not shown");
  const first = r.answer.results[0];
  assert.equal(first.item.price?.value, "7500.00", "the shop's price now, not the index's");
  assert.equal(first.checked, true);
  assert.equal(first.item.availability, "in_stock");
  assert.equal(first.item.confirmed, "2026-11-18T08:00:00.000Z");
  assert.equal(first.chat, `${a.page}chat?about=l-3`);
  assert.equal(first.shop.name, "rani-pets");
  assert.equal(r.answer.format, "directory-search/1");
  assert.equal(r.answer.order, "https://pages.example/order");
  assert.equal(r.answer.next, null);
});

test("a shop that does not answer keeps the index's data and shows Call to check; the buyer still sees the item", async () => {
  const quiet = shop("quiet-shop");
  const w = world([quiet], {});
  const r = await searchListings(w.deps, { q: "kitten" });
  assert.ok(r.ok);
  assert.equal(r.answer.results.length, 1, "the kitten");
  const x = r.answer.results[0];
  assert.deepEqual([x.checked, x.item.availability, x.item.price?.value], [false, "call_to_check", "8000.00"]);
});

test("a slow shop is given about a second and a half, then shown from the index", async () => {
  const slow = shop("slow-shop");
  const w = world([slow], { [checkUrl(slow)]: () => new Promise(() => undefined) });
  const t0 = Date.now();
  const r = await searchListings(w.deps, { q: "kitten" });
  assert.ok(r.ok && r.answer.results[0].checked === false);
  assert.ok(Date.now() - t0 < 2000, "the test's checker waits 50 ms; the real one 1.5 s");
});

test("a wrongly signed answer, an answer from another shop's key, and a replayed old answer are ignored", async () => {
  const a = shop("rani-pets"), b = shop("ravi-pets"), c = shop("old-answers");
  const stranger = generateSigningKey();
  const w = world([a, b, c], {
    [checkUrl(a)]: (q) => signAnswer({ format: "shop-check/1", page: a.page, at: "2026-11-18T09:00:00.000Z", items: q.ids.map((id) => ({ id, availability: "in_stock", price: { value: "1.00", currency: "INR" } })) }, stranger),
    [checkUrl(b)]: (q) => { const doc = b.answer(q.ids.map((id) => ({ id, availability: "in_stock" as const, price: { value: "8000.00", currency: "INR" as const } }))) as { items: { price: { value: string } }[] }; doc.items[0].price.value = "1.00"; return doc; },
    [checkUrl(c)]: (q) => c.answer(q.ids.map((id) => ({ id, availability: "in_stock" as const, price: { value: "1.00", currency: "INR" as const } })), "2026-11-18T07:00:00.000Z"),
  });
  const r = await searchListings(w.deps, { q: "kitten" });
  assert.ok(r.ok);
  assert.equal(r.answer.results.length, 3);
  for (const x of r.answer.results) assert.deepEqual([x.checked, x.item.price?.value, x.item.availability], [false, "8000.00", "call_to_check"], x.shop.name);
});

test("the shop is asked about item ids only: no search words, no place, no cookie, no buyer", async () => {
  const a = shop("rani-pets", { lat: "10.527642" });
  const w = world([a], { [checkUrl(a)]: (q) => a.answer(q.ids.map((id) => ({ id, availability: "in_stock" as const }))) });
  await searchListings(w.deps, { q: "persian kitten thrissur", lat: "10.52", lon: "76.21", town: "Thrissur", lang: "ml" });
  assert.equal(w.asked.length, 1);
  const call = w.asked[0];
  assert.equal(call.method, "POST");
  assert.deepEqual(JSON.parse(call.body), { format: "shop-check/1", ids: ["l-3"] });
  for (const secret of ["persian", "kitten", "thrissur", "10.52", "76.21", "ml"]) assert.ok(!call.body.toLowerCase().includes(`"${secret}`) && !call.url.includes(secret), `the shop must not see "${secret}"`);
  assert.deepEqual(Object.keys(call.headers).sort(), ["accept", "content-type"]);
});

test("answers are kept 60 seconds: the same item is not asked about again inside the minute, and is asked about again after it", async () => {
  const a = shop("rani-pets");
  const clock = { now: NOW };
  const w = world([a], { [checkUrl(a)]: (q) => a.answer(q.ids.map((id) => ({ id, availability: "in_stock" as const })), new Date(clock.now).toISOString()) }, clock);
  await searchListings(w.deps, { q: "kitten" });
  clock.now += 59_000;
  await searchListings(w.deps, { q: "kitten" });
  assert.equal(w.asked.length, 1);
  clock.now += 2_000;
  await searchListings(w.deps, { q: "kitten" });
  assert.equal(w.asked.length, 2);
});

test("results come in the fair order: the shops of one band take turns, and a shop that was silent comes after one that confirmed, in its band", async () => {
  const shops = ["a", "b", "c"].map((n) => shop(`shop-${n}`));
  const w = world(shops, {
    [checkUrl(shops[0])]: () => { throw new Error("down"); },
    [checkUrl(shops[1])]: (q) => shops[1].answer(q.ids.map((id) => ({ id, availability: "in_stock" as const }))),
    [checkUrl(shops[2])]: (q) => shops[2].answer(q.ids.map((id) => ({ id, availability: "in_stock" as const }))),
  });
  const r = await searchListings(w.deps, { q: "kitten" });
  assert.ok(r.ok);
  assert.deepEqual(r.answer.results.map((x) => x.checked), [true, true, false]);
});

test("the words come in the buyer's language, else the owner's, and say when an assistant wrote them", async () => {
  const a = shop("rani-pets");
  const w = world([a], {});
  const ml = await searchListings(w.deps, { q: "kitten", lang: "ml" });
  const hi = await searchListings(w.deps, { q: "kitten", lang: "hi" });
  assert.ok(ml.ok && hi.ok);
  assert.deepEqual([ml.answer.results[0].item.title, ml.answer.results[0].item.machineWritten], ["പേർഷ്യൻ പൂച്ചക്കുട്ടി", false]);
  assert.deepEqual([hi.answer.results[0].item.title, hi.answer.results[0].item.machineWritten], ["फ़ारसी बिल्ली का बच्चा", true]);
  assert.deepEqual(wordsFor({ ml: "x" }, "ml", [], "kn"), { text: "x", lang: "ml", machineWritten: false });
  assert.deepEqual(wordsFor({ en: "e" }, "ml", ["en"], "kn"), { text: "e", lang: "en", machineWritten: true });
});

test("more than ten results continue with an offset; the first ten are the ones checked", async () => {
  const shops = Array.from({ length: 12 }, (_, i) => shop(`shop-${i}`));
  const w = world(shops, Object.fromEntries(shops.map((s) => [checkUrl(s), (q: { ids: string[] }) => s.answer(q.ids.map((id) => ({ id, availability: "in_stock" as const })))])));
  const first = await searchListings(w.deps, { q: "kitten" });
  assert.ok(first.ok);
  assert.equal(first.answer.results.length, 10);
  assert.equal(first.answer.next, "10");
  assert.equal(w.asked.length, 10);
  const second = await searchListings(w.deps, { q: "kitten", offset: "10" });
  assert.ok(second.ok);
  assert.equal(second.answer.results.length, 2);
  assert.equal(second.answer.next, null);
  assert.equal(new Set([...first.answer.results, ...second.answer.results].map((x) => x.shop.page)).size, 12, "every shop once, no repeats across pages");
});

test("the request is cleaned: bad category, half a map point, wrong language, bad offset and radius are refused in plain words", () => {
  for (const bad of [{ category: "guns" }, { lat: "10.5" }, { lat: "x", lon: "y" }, { lat: "95", lon: "0" }, { lang: "fr" }, { offset: "5" }, { offset: "-10" }, { radius_km: "0" }, { radius_km: "9999" }]) {
    const r = readRequest(bad);
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.ok(!r.ok && r.error.length > 10);
  }
  const good = readRequest({ q: "  Persian kitten near me  ", category: "pets", lat: "10.52", lon: "76.21", radius_km: "25", lang: "hi" });
  assert.ok(good.ok);
  assert.deepEqual(good.query, { words: ["persian", "kitten"], category: "pets", point: { lat: 10.52, lon: 76.21 }, radiusKm: 25 });
  assert.equal(good.place, "point");
  assert.equal(readRequest({ town: "Thrissur" }).ok && (readRequest({ town: "Thrissur" }) as { place: string }).place, "town");
});

test("a search is counted and nothing about it is kept: the day's counts only", async () => {
  const a = shop("rani-pets");
  const w = world([a], {});
  await searchListings(w.deps, { q: "kitten" });
  await searchListings(w.deps, { q: "puppy" });
  assert.deepEqual(w.index.countsOf(dayOf(NOW)), { searches: 2, results: 2 });
  assert.equal(dayOf(Date.parse("2026-11-18T19:00:00.000Z")), "2026-11-19", "the day changes at midnight in India");
});
