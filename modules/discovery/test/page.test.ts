// The people's page: every state in all four languages, the card's words (price or "Ask the shop", freshness in words, distance, the shop's name, "Chat with the shop"),
// machine-written words marked, a photo only from the directory's own address, nothing unescaped, no script but the one by its nonce, and the order page linked from every
// page. Written 18 Nov 2026.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DIRECTORY_WORDS } from "../words.ts";
import { EMPTY_FORM, freshness, link, orderPage, pagePolicy, searchPage } from "../page.ts";
import type { PageContext, SearchView } from "../page.ts";
import type { SearchAnswer, SearchResultItem } from "../search.ts";
import { LANGS } from "../types.ts";
import type { Lang } from "../types.ts";
import { NOW } from "./fixtures.ts";

const ORIGIN = "https://pages.example";
const ctx = (lang: Lang): PageContext => ({ origin: ORIGIN, lang, now: NOW, nonce: "N0NCE", fontUrl: "/search/font.woff2" });

function result(over: { item?: Partial<SearchResultItem["item"]>; shop?: Partial<SearchResultItem["shop"]>; checked?: boolean } = {}): SearchResultItem {
  return {
    shop: { name: "Rani Pets", page: `${ORIGIN}/rani-pets/`, town: "Thrissur", distanceKm: 1.4, ...over.shop },
    item: { id: "l-3", title: "Persian kitten", lang: "en", machineWritten: false, price: { value: "8000.00", currency: "INR", note: "each" }, photo: `${ORIGIN}/rani-pets/photo/ph-9.jpg`, availability: "in_stock", confirmed: "2026-11-18T03:00:00.000Z", category: "pets", ...over.item },
    chat: `${ORIGIN}/rani-pets/chat?about=l-3`, checked: over.checked ?? true,
  };
}
const answer = (results: SearchResultItem[], next: string | null = null): SearchAnswer => ({ format: "directory-search/1", results, order: `${ORIGIN}/order`, next });
const page = (lang: Lang, view: SearchView, form = EMPTY_FORM) => searchPage(ctx(lang), form, view);

test("every language has every line, none empty, none a copy of English, and none of the words that are never used", () => {
  const en = DIRECTORY_WORDS.en;
  const flat = (w: unknown, path = ""): [string, string][] => typeof w === "string" ? [[path, w]] : typeof w === "function" ? [[path, (w as (...a: unknown[]) => string)(3, "kitten", 1.4)]] : Array.isArray(w) ? w.flatMap((x, i) => flat(x, `${path}.${i}`)) : Object.entries(w as object).flatMap(([k, v]) => flat(v, `${path}.${k}`));
  const english = new Map(flat(en));
  for (const lang of LANGS) {
    const mine = flat(DIRECTORY_WORDS[lang]);
    assert.deepEqual(mine.map(([k]) => k), [...english.keys()], `${lang} has the same lines as English`);
    for (const [k, text] of mine) {
      assert.ok(text.trim() !== "", `${lang} ${k} is empty`);
      assert.ok(!/\b(safe|guaranteed|proves?|certified|100%|earn|income|bot|founder)\b/iu.test(text), `${lang} ${k} uses a word we never use`);
      if (lang !== "en" && !["km", "language"].includes(k.slice(1)) && english.get(k)!.length > 12) assert.notEqual(text, english.get(k), `${lang} ${k} is English`);
    }
  }
});

test("the start page, in four languages: the form with labelled fields, examples to tap, the link to the order, one script by its nonce and nothing loaded from elsewhere", () => {
  for (const lang of LANGS) {
    const w = DIRECTORY_WORDS[lang];
    const h = page(lang, { state: "start" });
    assert.match(h, new RegExp(`<html lang="${lang}">`, "u"));
    assert.ok(h.includes(w.startTitle) && h.includes(w.searchLabel) && h.includes(w.search));
    assert.match(h, /<label for="q">/u);
    assert.match(h, /<input id="q" name="q" type="search"/u);
    assert.match(h, /<label for="town">/u);
    assert.match(h, /<select id="category" name="category">/u);
    assert.ok(h.includes(`<details class="choices"><summary>${w.choices}</summary>`), "kind, distance and town are folded away until wanted");
    assert.ok(h.includes('href="/order'), "the order page is linked from every page");
    assert.ok(h.includes('<meta name="robots" content="noindex">'), "search pages are not for search engines");
    assert.equal([...h.matchAll(/<script/gu)].length, 1);
    assert.ok(h.includes('<script nonce="N0NCE">'));
    assert.ok(!/<script[^>]*src=|<link |<iframe|http:\/\//u.test(h), "nothing loaded from elsewhere");
    assert.ok(h.includes('id="near" class="quiet" hidden'), "the location button is hidden until the script shows it");
    for (const example of w.examples) assert.ok(h.includes(`q=${encodeURIComponent(example).replace(/%20/gu, "+")}`), `${lang}: ${example}`);
    assert.ok(h.includes("font-face") && h.includes("/search/font.woff2"));
    assert.ok(h.includes("max-width") || h.includes("viewport"), "phone first");
  }
});

test("a result card: price, freshness in words, distance, the shop, a chat link whose name says what it opens", () => {
  const h = page("en", { state: "results", answer: answer([result()]) }, { ...EMPTY_FORM, q: "persian kitten" });
  assert.ok(h.includes("₹8,000"), "rupees with Indian grouping, no .00");
  assert.ok(h.includes(">each<"), "the shop's own note");
  assert.ok(h.includes("Confirmed today"));
  assert.ok(h.includes("1.4 km away"));
  assert.ok(h.includes("Rani Pets"));
  assert.ok(h.includes('href="https://pages.example/rani-pets/chat?about=l-3"'));
  assert.ok(h.includes('aria-label="Chat with the shop: Rani Pets, about Persian kitten"'));
  assert.ok(h.includes(">Chat with the shop<"), "the visible words are inside the accessible name");
  assert.ok(h.includes("1 result for “persian kitten”"));
  assert.ok(h.includes('<img src="https://pages.example/rani-pets/photo/ph-9.jpg" alt="Photo of Persian kitten"'));
  assert.ok(!h.includes("Call to check"));
  const hi = page("hi", { state: "results", answer: answer([result()]) });
  assert.ok(hi.includes('href="https://pages.example/rani-pets/chat?about=l-3&amp;lang=hi"'), "the shop's chat opens in the same language");
  assert.ok(hi.includes(DIRECTORY_WORDS.hi.chat) && !hi.includes("Chat with the shop"));
});

test("not confirmed shows 'Call to check' with the reason, an unanswered shop is counted in a note, and a missing price is 'Ask the shop'", () => {
  const h = page("en", { state: "results", answer: answer([result({ checked: false, item: { price: null, availability: "call_to_check" } }), result({ item: { id: "l-4" } })]) });
  assert.ok(h.includes("Call to check") && h.includes("The shop did not say just now"));
  assert.ok(h.includes("Ask the shop"));
  assert.ok(h.includes("1 shop did not answer just now"));
  assert.ok(h.includes('role="status"'));
  const none = page("ml", { state: "results", answer: answer([result({ checked: false })]) });
  assert.ok(none.includes(DIRECTORY_WORDS.ml.callToCheck) && none.includes(DIRECTORY_WORDS.ml.unanswered(1)));
});

test("freshness in words: today, yesterday, days ago (counted in India's days), and the town when there is no distance", () => {
  const w = DIRECTORY_WORDS.en;
  assert.equal(freshness(w, "2026-11-18T01:00:00.000Z", NOW), "Confirmed today");
  assert.equal(freshness(w, "2026-11-17T04:10:00.000Z", NOW), "Confirmed yesterday");
  assert.equal(freshness(w, "2026-11-15T04:10:00.000Z", NOW), "Confirmed 3 days ago");
  const h = page("en", { state: "results", answer: answer([result({ shop: { distanceKm: null } })]) });
  assert.ok(h.includes("In Thrissur"));
  assert.ok(page("en", { state: "results", answer: answer([result({ shop: { distanceKm: 23.6 } })]) }).includes("24 km away"));
});

test("words an assistant wrote are marked; a photo from another address is not shown (a flat tile in the kind's colour instead)", () => {
  const h = page("en", { state: "results", answer: answer([result({ item: { machineWritten: true, photo: "https://cdn.example/p.jpg" } })]) });
  assert.ok(h.includes('class="tag">Words by an assistant<'));
  assert.ok(!h.includes("cdn.example") && !h.includes("<img"));
  assert.ok(h.includes('class="ph k-pets no"') && h.includes("<span>Pets</span>"));
  assert.ok(h.includes(".k-pets{--k:#f2a516;--ki:#3d1708}") && h.includes(".k-food{--k:#177a5e"), "the tiles wear the signboard paints, with the text colour that reads on each");
  assert.ok(!page("en", { state: "results", answer: answer([result()]) }).includes("Words by an assistant"));
});

test("whatever the shop or the buyer typed is escaped", () => {
  const evil = `<script>alert(1)</script>"><img src=x onerror=alert(2)>`;
  const h = page("en", { state: "results", answer: answer([result({ item: { title: evil, price: { value: "10.00", currency: "INR", note: evil } }, shop: { name: evil, town: evil } })]) }, { ...EMPTY_FORM, q: evil, town: evil });
  assert.ok(!h.includes("<script>alert") && !h.includes("<img src=x") && !h.includes('onerror=alert(2)>'));
  assert.equal([...h.matchAll(/<script/gu)].length, 1, "only the page's own script");
});

test("the other states each have a page of their own: nothing found, a request that did not work, wait a minute, not working", () => {
  for (const lang of LANGS) {
    const w = DIRECTORY_WORDS[lang];
    assert.ok(page(lang, { state: "none" }).includes(w.noneTitle) && page(lang, { state: "none" }).includes(w.clear));
    const bad = page(lang, { state: "bad", message: "lat and lon must both be decimal degrees" });
    assert.ok(bad.includes(w.badTitle) && bad.includes("lat and lon must both") && bad.includes('role="alert"'));
    assert.ok(page(lang, { state: "busy" }).includes(w.busyTitle));
    assert.ok(page(lang, { state: "down" }).includes(w.downTitle));
  }
  assert.ok(page("en", { state: "results", answer: answer([result()], "10") }).includes('href="/search?offset=10"'), "show more continues the same search");
  const more = page("hi", { state: "results", answer: answer([result()], "10") }, { ...EMPTY_FORM, q: "बिल्ली", category: "pets" });
  assert.ok(more.includes("offset=10") && more.includes("category=pets") && more.includes("lang=hi"));
});

test("the form keeps what was typed, and a map point is shown as set", () => {
  const h = page("en", { state: "none" }, { q: "kitten", category: "pets", town: "Thrissur", lat: "10.52", lon: "76.21", radius_km: "25" });
  assert.ok(h.includes('<details class="choices" open>'), "a choice made opens the fold");
  assert.ok(h.includes('value="kitten"') && h.includes('<option value="pets" selected>') && h.includes('value="Thrissur"') && h.includes('<option value="25" selected>'));
  assert.ok(h.includes('name="lat" value="10.52"') && h.includes('name="lon" value="76.21"'));
  assert.ok(h.includes('<p class="note" id="near-set">Your location is set</p>'));
  assert.ok(page("en", { state: "start" }).includes('id="near-set" hidden'));
});

test("the language links keep the search, and the current language is not a link", () => {
  const h = page("en", { state: "none" }, { ...EMPTY_FORM, q: "kitten" });
  assert.ok(h.includes('<b aria-current="true" lang="en">English</b>'));
  assert.ok(h.includes('href="/search?q=kitten&amp;lang=ml"') && h.includes('hreflang="kn"'));
  assert.equal(link("/order", { lang: undefined }), "/order");
});

test("the order page states the rule in plain words, in four languages, and links back; it carries no script", () => {
  for (const lang of LANGS) {
    const w = DIRECTORY_WORDS[lang], h = orderPage(ctx(lang));
    assert.ok(h.includes(w.orderTitle) && h.includes(w.orderNever) && h.includes(w.orderNeverBody));
    for (const step of w.orderSteps) assert.ok(h.includes(step.slice(0, 20)));
    assert.equal(w.orderSteps.length, 4);
    assert.ok(h.includes(w.back) && !h.includes("<script"));
    assert.ok(!h.includes('content="noindex"'), "the rule is meant to be found");
  }
  assert.ok(orderPage(ctx("en")).includes("No payment, plan or Operator changes the order"));
});

test("the content policy loads this origin's photos and the font only, runs one script by its nonce, and posts only to /search", () => {
  const p = pagePolicy(ORIGIN, "abc");
  assert.ok(p.includes("default-src 'none'") && p.includes("img-src 'self' data:") && p.includes("font-src 'self'") && p.includes("script-src 'nonce-abc'"));
  assert.ok(p.includes("form-action https://pages.example/search") && p.includes("connect-src 'none'") && p.includes("frame-ancestors 'none'"));
});
