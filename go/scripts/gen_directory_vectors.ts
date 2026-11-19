// Writes go/internal/directory/testdata/vectors.json: what the TypeScript directory (modules/discovery) gives on a set of inputs, for the Go unit tests (vectors_test.go) to compare with.
// Run from the repository root:   node go/scripts/gen_directory_vectors.ts      (--check compares with the committed file)
// The inputs are chosen to be the ones the two languages could disagree on: scripts and marks, lower-casing, UTF-16 lengths, hostile addresses, dates V8 reads loosely, numbers JavaScript
// reads from text, a model's answer that is nearly right.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { skeleton } from "../../modules/discovery/romanise.ts";
import { normal, searchWords, wordsOf, haversineKm } from "../../modules/discovery/text.ts";
import { orderResults, turnHash } from "../../modules/discovery/order.ts";
import { readFeed } from "../../modules/discovery/feed.ts";
import { feedAllowed } from "../../modules/discovery/notices.ts";
import { cleanQuestion, readRules, readTypedSearch, requestOf } from "../../modules/discovery/assistant.ts";
import { readRequest, dayOf } from "../../modules/discovery/search.ts";
import { EMPTY_FORM, freshness, km, link, orderPage, searchPage } from "../../modules/discovery/page.ts";
import { DIRECTORY_WORDS } from "../../modules/discovery/words.ts";
import { languageOf } from "../../modules/discovery/http.ts";

const here = dirname(fileURLToPath(import.meta.url));
const file = join(here, "..", "internal", "directory", "testdata", "vectors.json");

const WORDS = ["kitten", "Persian KITTEN", "பூனை", "ΣΊΣΥΦΟΣ", "İstanbul", "billi", "बिल्ली", "फ़ारसी बिल्ली का बच्चा", "പൂച്ച", "പൂച്ചക്കുട്ടി", "പേർഷ്യൻ", "ചൈനീസ് ജ്വാല", "ಬೆಕ್ಕಿನ ಮರಿ", "ಬೆಕ್ಕು", "poocha", "bekku", "a‍b‌c", "é", "x".repeat(50), "Thrissur", "തൃശ്ശൂർ", "ತೃಶೂರ", "थ्रिस्सूर", "ൺ ൻ ർ ൽ ൾ", "क़ ख़ ग़ ज़ ड़ ढ़ फ़", "wazeer qix", "aaa eee ooo bookkeeper", "bhai chhota ghar", "ಕ್ಕ ಣ್ಣ", "संस्कृत", "1234 ₹8,000", "😀 cat 🐈", "", "   "];
const places = [{ lat: 10.527642, lon: 76.214435 }, { lat: 9.9312, lon: 76.2673 }, { lat: -33.8688, lon: 151.2093 }, { lat: 0, lon: 0 }, { lat: 89.9, lon: 179.9 }];

const out: Record<string, unknown> = {};
out.skeleton = WORDS.map((w) => ({ in: w, normal: normal(w), skeleton: skeleton(w), words: wordsOf(w), search: searchWords(w) }));
out.haversine = places.flatMap((a) => places.map((b) => ({ a, b, km: haversineKm(a, b), text: km(haversineKm(a, b)) })));
out.km = [0, 0.04, 0.05, 0.25, 0.75, 1.25, 1.35, 9.95, 9.999, 10, 10.5, 11.5, 99.5, 1234.5].map((n) => ({ n, text: km(n) }));

// the order
const cands = (n: number, mix: number) => Array.from({ length: n }, (_, i) => ({
  key: `https://p.example/shop-${i % 5}/|i-${i}`, shop: `https://p.example/shop-${i % 5}/`, fit: ((i * mix) % 3 === 0 ? 1 : 0) as 0 | 1,
  distanceKm: (i * mix) % 7 === 0 ? null : ((i * 13 * mix) % 90) + 0.5, sameTown: (i * mix) % 4 === 0, inStock: (i * mix) % 5 !== 0,
}));
out.order = [];
for (const place of ["point", "town", "none"] as const) for (const [n, mix] of [[3, 1], [12, 3], [40, 7], [25, 11]]) for (const seed of ["2026-11-19|kitten|", "2026-11-20|ಬೆಕ್ಕು|pets", "x"]) {
  const c = cands(n, mix);
  (out.order as unknown[]).push({ place, seed, candidates: c, ordered: orderResults(c, { place, seed }) });
}
out.turnHash = ["", "a", "abc", "2026-11-19|kitten|https://p.example/x/|l-3", "പൂച്ച", "😀", "\ud800"].map((t) => ({ in: t, hash: turnHash(t) }));
out.dayOf = [0, 1_700_000_000_000, 1_763_500_000_000, 1_763_579_999_999, 1_763_580_000_000, 1_763_580_000_001].map((ms) => ({ ms, day: dayOf(ms) }));

// addresses: what `new URL` makes of them, and the rules built on it
const URLS = ["https://pages.example/rani-pets/", "https://Pages.Example:443/rani-pets/", "https://pages.example:8443/x/", "https://pages.example/a/./b/../c/", "https://pages.example/a/%2e%2e/b", "https://pages.example/a\\b/", "https://pages.example\\evil.example/", "https://user@pages.example/x/", "https://user:pw@pages.example/x/", "https://pages.example/x y/", "https://pages.example/ü/é?q=ü r#f ü", "https://pages.example/x/?", "https://pages.example/x/#", "https://pages.example/x?a=1&b=%20#frag", "https://127.0.0.1/x/", "https://0x7f.1/x/", "https://2130706433/x/", "https://[::1]/x/", "https://xn--bcher-kva.example/", "https://bücher.example/", "https://PAGES.example./x/", "https://pages..example/x/", "https://pages.example:0/x/", "https://pages.example:65536/x/", "https://pages.example:/x/", "http://pages.example/x/", "HTTPS://pages.example/x/", " https://pages.example/x/", "https://pages.example/x/\n", "https://pages.example/x/\tm", "https://pages.example", "https://pages.example?x=1", "https://pages.example#a", "https:pages.example/x/", "https:///pages.example/x/", "https://pages.example/%41/%7e/%zz", "https://a.b/ x", "https://pages.example/rani-pets/listings.json", "https://pages.example/a/b/listings.json", "https://pages.example/Rani/listings.json", "https://pages.example/x/listings.json?", "https://pages.example/x/listings.json#", "https://localhost/y/listings.json", "https://intranet.internal/z/listings.json", ""];
out.urls = URLS.map((s) => {
  let u: URL | null = null;
  try { u = new URL(s); } catch { /* not an address */ }
  return { in: s, url: u ? { href: u.href, origin: u.origin, hostname: u.hostname, port: u.port, pathname: u.pathname, search: u.search, hash: u.hash, protocol: u.protocol, username: u.username, password: u.password } : null,
    allowed: feedAllowed(s, { served: ["pages.example"], configured: ["https://builder.example/feed/listings.json"] }) };
});

// dates
const DATES = ["2026-11-18T03:30:00.000Z", "2026-11-18T03:30:00Z", "2026-02-30T00:00:00Z", "2026-02-31T00:00:00.123Z", "2026-13-01T00:00:00Z", "2026-00-10T00:00:00Z", "2026-01-32T00:00:00Z", "2026-01-01T24:00:00Z", "2026-01-01T24:00:00.000Z", "2026-01-01T24:00:01Z", "2026-01-01T23:60:00Z", "2026-01-01T23:59:60Z", "2026-01-01T25:00:00Z", "2026-11-18", "2026-11", "2026", "2026-11-18T03:30", "2026-11-18T03:30:00", "2026-11-18T03:30:00+05:30", "2026-11-18T03:30:00.5Z", "2026-11-18T03:30:00.123456Z", "0000-01-01T00:00:00Z", "Wed, 18 Nov 2026 03:30:00 GMT", "tomorrow", "", "2026-11-18 03:30:00Z", " 2026-11-18T03:30:00Z"];
out.dates = DATES.map((s) => ({ in: s, ms: Number.isNaN(Date.parse(s)) ? null : Date.parse(s) }));
out.numbers = ["", " ", "12", " 12 ", "1e2", "0x10", "0b11", "0o7", "1_0", "Infinity", "-Infinity", "inf", "nan", "NaN", "12px", "+5", "-5", ".5", "5.", "1,5", "٣", "١٢", "0", "00012", "1e400", "-0"].map((s) => ({ in: s, n: Number.isNaN(Number(s)) ? "NaN" : Number.isFinite(Number(s)) ? Number(s) : String(Number(s)) }));

// requests
const REQS: Record<string, unknown>[] = [{}, { q: "kitten near me" }, { q: "  x  " }, { q: "a".repeat(300) }, { category: "pets" }, { category: "weapons" }, { category: "" }, { lat: "10.5", lon: "76.2" }, { lat: "10.5" }, { lat: "91", lon: "0" }, { lat: "1e1", lon: "0" }, { lat: 10.5, lon: 76.2 }, { lat: "-0.5", lon: "180" }, { lat: "10.1234567", lon: "1" }, { town: "  Thrissur  " }, { radius_km: "5" }, { radius_km: 5 }, { radius_km: "" }, { radius_km: "0" }, { radius_km: "500" }, { radius_km: "501" }, { radius_km: "abc" }, { radius_km: null }, { radius_km: "0x10" }, { lang: "hi" }, { lang: "fr" }, { lang: "" }, { offset: "0" }, { offset: "10" }, { offset: "190" }, { offset: "200" }, { offset: "5" }, { offset: "1e1" }, { offset: 20 }, { offset: "" }, { offset: -10 }, { offset: "10.0" }, { q: "ಬೆಕ್ಕು", lat: "10", lon: "76", town: "x" }];
out.requests = REQS.map((r) => {
  const x = readRequest(r);
  return x.ok ? { in: r, ok: true, words: x.query.words, category: x.query.category ?? null, point: x.query.point ?? null, town: x.query.town ?? null, radiusKm: x.query.radiusKm ?? null, place: x.place, lang: x.lang, offset: x.offset } : { in: r, ok: false, error: x.error };
});
out.languageOf = [[null, undefined], ["hi", undefined], ["fr", "ml-IN,en;q=0.8"], [null, "kn"], [null, "xx, hi;q=0.9"], [null, " EN-gb"], [null, "ML"], [null, ""], ["", "hi"], [null, "ಕ್ನ"]].map(([p, a]) => ({ param: p, accept: a ?? null, lang: languageOf(p as string | null, a as string | undefined) }));

// the assistant
const QUESTIONS = ["Persian kitten near Thrissur?", "kitten, call me on 98470 12345 or mail ravi@example.com, see https://x.example/a, my name is Ravi Kumar, house no 12/4 MG Road Thrissur", "മെയിൽ ravi@x.in ഫോൺ ९८४७०१२३४५ എന്റെ പേര് രവി കുമാർ", "मेरा नाम रवि sharma, घर नंबर 12 में बिल्ली", "ನನ್ನ ಹೆಸರು ರವಿ ಬೆಕ್ಕು ಮನೆ ೧೨", "call 15-11-2026 or 9847012345", "xname is Ravi", "myname is Ravi", "name: Ravi Kumar kitten", "my  name\tis   Ravi  Kumar", "NAME IS RAVI kumar", "flat 3 plot 4 d no 5 h.no 6 door 7", "12/4A", "MG Road", "the Anna Salai road", "roadside stand", "apartments", "Green Apartments x", "kitten ".repeat(60), "ab" + "\u{1F600}".repeat(400), "www.example.com/a?b=c and https://q.example", "x@y.z a@b.cd", "+91 98470 12345", "(0487) 234-5678", "1 2 3 4 5 6 7 8 9 0 1", "kitten within 10 km under 5000", "kitten near me", "KITTEN NEARBY", "nearbyx", "xnear me", "near me.", "within 10 kms of here", "within 10 kilometres", "5 किमी में", "5 कि.मी", "under Rs. 5,000", "budget of ₹ 2,500", "less than 12 rupees", "300 or less", "5000 से कम", "up to 9999999999", "max 1,000,000", "maximum 3", "within 0 km", "within 501 km", "mera paas", "मेरे पास बिल्ली", "എന്റെ അടുത്ത് പൂച്ച", "ನನ್ನ ಹತ್ತಿರ ಬೆಕ್ಕು"];
out.clean = QUESTIONS.map((q) => ({ in: q, clean: cleanQuestion(q), rules: readRules(q), rulesOfClean: readRules(cleanQuestion(q)) }));
const T = (o: Record<string, unknown>) => ({ words: ["kitten"], words_en: ["kitten"], category: "pets", place: "town", town: "Thrissur", radius_km: null, max_price: null, ...o });
const TYPED: unknown[] = [T({}), T({ category: "any", place: "none", town: "" }), T({ place: "near_me", town: "" }), T({ radius_km: 10, max_price: 5000 }), T({ radius_km: 10.0 }), T({ radius_km: 1.5 }), T({ radius_km: 0 }), T({ radius_km: 501 }), T({ max_price: 10_000_000 }), T({ max_price: 10_000_001 }), T({ max_price: "5" }), T({ words: [] }), T({ words: ["a", "b", "c", "d", "e", "f", "g", "h"] }), T({ words: ["a", "b", "c", "d", "e", "f", "g", "h", "i"] }), T({ words: ["kit-ten", "it's"] }), T({ words: ["-kitten"] }), T({ words: ["kit ten"] }), T({ words: ["x".repeat(30)] }), T({ words: ["x".repeat(31)] }), T({ words: ["ಬೆಕ್ಕು", "പൂച്ച", "बिल्ली"] }), T({ words: [" kitten "] }), T({ words: [1] }), T({ words: "kitten" }), T({ words_en: null }), T({ town: "  Thrissur  " }), T({ town: "St. Mary's-Town 2" }), T({ town: "2Town" }), T({ town: "x".repeat(80) }), T({ town: "x".repeat(81) }), T({ town: "" }), T({ place: "none", town: "Thrissur" }), T({ place: "elsewhere" }), T({ category: "weapons" }), T({ category: 5 }), { ...T({}), extra: 1 }, (() => { const t: Record<string, unknown> = T({}); delete t.town; return t; })(), [], null, "x", 5, {}];
out.typed = TYPED.map((r) => ({ in: r, typed: readTypedSearch(r) }));
out.requestOf = TYPED.map((r) => readTypedSearch(r)).filter(Boolean).flatMap((t) => [false, true].map((en) => ({ typed: t, english: en, request: requestOf(t!, { lang: "hi", lat: "10.5", lon: "76.2" }, en), requestNoPoint: requestOf(t!, { lang: "en" }, en) })));

// the page's words and small formatters
out.freshness = [["2026-11-19T01:00:00.000Z", 1_763_513_000_000], ["2026-11-18T01:00:00.000Z", 1_763_513_000_000], ["2026-11-10T20:00:00.000Z", 1_763_513_000_000], ["2026-11-19T20:00:00.000Z", 1_763_513_000_000], ["2025-01-01T00:00:00.000Z", 1_763_513_000_000]].flatMap(([c, now]) => (["en", "hi", "ml", "kn"] as const).map((l) => ({ confirmed: c, now, lang: l, text: freshness(DIRECTORY_WORDS[l], c as string, now as number) })));
out.link = [["/search", { q: "a b", category: "", lang: "hi" }], ["/search", { q: "ಬೆಕ್ಕು&x=1", town: "St. Mary's", lat: "10.5" }], ["/order", { lang: undefined }], ["/search", { q: "*-._~!'()" }]].map(([p, o]) => ({ path: p, params: Object.entries(o as object), link: link(p as string, o as Record<string, string | undefined>) }));

// ---- feeds: a good feed and one change at a time, read by the TypeScript reader (feed.test.ts's cases, and the edges it did not try). Written 19 Nov 2026, before the TypeScript
// directory was deleted (decision 61, wave 1c): from then on this file is the source.
const FP = "https://pages.example/rani-pets/";
const goodItem = (id: string, o: Record<string, unknown> = {}): Record<string, unknown> => ({
  id, page: `${FP}#${id}`, category: "pets", title: { en: "Persian kitten", ml: "പേർഷ്യൻ പൂച്ചക്കുട്ടി" }, text: { en: "Two kittens." }, ownerLanguage: "ml", machineWritten: ["en"],
  price: { value: "8000.00", currency: "INR", note: "each" }, quantity: 2, photos: [{ url: `${FP}photo/ph-9.jpg`, type: "image/jpeg", width: 1200, height: 900 }], availability: "in_stock", confirmed: "2026-11-18T10:00:00.000Z", ...o,
});
const goodFeed = (shop: Record<string, unknown> = {}, items: unknown[] = [goodItem("l-3")], top: Record<string, unknown> = {}): Record<string, unknown> => ({
  format: "shop-feed/1", updated: "2026-11-18T10:00:00.000Z",
  shop: { name: "Rani Pets", page: FP, trade: "pet shop", languages: ["ml", "en", "fr"], place: { town: "Thrissur", pincode: "680001", lat: "10.527642", lon: "76.214435" }, chat: `${FP}chat`, check: `${FP}api/v1/check`, agentCard: `${FP}agent-card.json`, registration: { kind: "GSTIN", number: "32ABCDE1234F1Z5", source: "checked" }, ...shop },
  items, signature: { alg: "Ed25519", keyId: "k", key: "x", sig: "y" }, ...top,
});
const place = (o: Record<string, unknown>) => ({ place: { town: "Thrissur", ...o } });
const FEEDS: [string, unknown, string?][] = [
  ["good", goodFeed()], ["not an object", [1]], ["format 2", goodFeed({}, undefined, { format: "shop-feed/2" })], ["no updated", goodFeed({}, undefined, { updated: "yesterday" })], ["updated no Z", goodFeed({}, undefined, { updated: "2026-11-18T10:00:00" })],
  ["updated 4 fraction digits", goodFeed({}, undefined, { updated: "2026-11-18T10:00:00.1234Z" })], ["updated 30 Feb", goodFeed({}, undefined, { updated: "2026-02-30T10:00:00Z" })],
  ["no shop", goodFeed({}, undefined, { shop: "x" })], ["http page", goodFeed({ page: "http://pages.example/rani-pets/" })], ["page no slash", goodFeed({ page: "https://pages.example/rani-pets" })], ["page query", goodFeed({ page: `${FP}?a=1` })],
  ["no name", goodFeed({ name: "" })], ["long name", goodFeed({ name: "n".repeat(121) })], ["name 120", goodFeed({ name: "n".repeat(120) })], ["lone surrogate name", goodFeed({ name: "Rani \ud800" })],
  ["no place", goodFeed({ place: undefined })], ["no town", goodFeed(place({ town: "" }))], ["pincode 4", goodFeed(place({ pincode: "6800" }))], ["pincode number", goodFeed(place({ pincode: 680001 }))],
  ["lat no lon", goodFeed(place({ lat: "10.5" }))], ["lat 7 places", goodFeed(place({ lat: "10.5276421", lon: "76.2" }))], ["lat 91", goodFeed(place({ lat: "91", lon: "76.2" }))], ["lat words", goodFeed(place({ lat: "ten", lon: "76.2" }))],
  ["lat number", goodFeed(place({ lat: 10.5, lon: 76.2 }))], ["lon 180", goodFeed(place({ lat: "-90", lon: "-180.000000" }))],
  ["chat elsewhere", goodFeed({ chat: "https://evil.example/chat" })], ["chat sibling", goodFeed({ chat: "https://pages.example/other-shop/chat" })], ["chat http", goodFeed({ chat: "http://pages.example/rani-pets/chat" })],
  ["chat dot-dot", goodFeed({ chat: `${FP}../other/chat` })], ["check elsewhere", goodFeed({ check: "https://evil.example/check" })], ["no check", goodFeed({ check: undefined })],
  ["card elsewhere", goodFeed({ agentCard: "https://evil.example/card" })], ["no card", goodFeed({ agentCard: undefined })], ["no trade", goodFeed({ trade: undefined })], ["empty trade", goodFeed({ trade: "" })],
  ["registration half", goodFeed({ registration: { kind: "GSTIN" } })], ["no registration", goodFeed({ registration: undefined })], ["languages junk", goodFeed({ languages: "ml" })],
  ["not at its address", goodFeed({ page: "https://pages.example/other-shop/" })], ["items not a list", goodFeed({}, undefined, { items: {} })],
  ["200 items", goodFeed({}, Array.from({ length: 200 }, (_, i) => goodItem(`i-${i}`)))], ["201 items", goodFeed({}, Array.from({ length: 201 }, (_, i) => goodItem(`i-${i}`)))],
  ["bad items dropped", goodFeed({}, [
    goodItem("ok-1"), "junk", goodItem("../x"), goodItem("i-page", { page: "https://evil.example/#x" }), goodItem("i-cat", { category: "weapons" }), goodItem("i-title", { title: {} }), goodItem("i-title-fr", { title: { fr: "chaton" } }),
    goodItem("i-title-empty", { title: { en: "" } }), goodItem("i-text", { text: { en: 5 } }), goodItem("i-owner", { ownerLanguage: "fr" }), goodItem("i-mw", { machineWritten: ["fr"] }), goodItem("i-price-int", { price: { value: "8000", currency: "INR" } }),
    goodItem("i-price-80.5", { price: { value: "80.5", currency: "INR" } }), goodItem("i-price-num", { price: { value: 8000, currency: "INR" } }), goodItem("i-price-usd", { price: { value: "8000.00", currency: "USD" } }),
    goodItem("i-price-note", { price: { value: "8000.00", currency: "INR", note: "" } }), goodItem("i-price-null", { price: null }), goodItem("i-price-gone", { price: undefined }), goodItem("i-4-photos", { photos: Array.from({ length: 4 }, (_, j) => ({ url: `${FP}photo/${j}.jpg`, type: "image/jpeg" })) }),
    goodItem("i-png", { photos: [{ url: `${FP}photo/a.png`, type: "image/png" }] }), goodItem("i-photo-off", { photos: [{ url: "https://cdn.example/a.jpg", type: "image/jpeg" }] }), goodItem("i-webp", { photos: [{ url: `${FP}photo/a.webp`, type: "image/webp", width: 1.5, height: -1 }] }),
    goodItem("i-gone", { availability: "gone" }), goodItem("i-unknown", { availability: "maybe" }), goodItem("i-ctc", { availability: "call_to_check" }), goodItem("i-no-confirmed", { confirmed: "yesterday" }),
    goodItem("i-qty-neg", { quantity: -1 }), goodItem("i-qty-frac", { quantity: 1.5 }), goodItem("i-qty-max", { quantity: 1_000_000 }), goodItem("i-qty-over", { quantity: 1_000_001 }), goodItem("i-no-qty", { quantity: undefined }), goodItem("ok-1"),
    goodItem("i-long-title", { title: { en: "t".repeat(201) } }), goodItem("i-title-200", { title: { en: "t".repeat(200) } }), goodItem("i-no-text", { text: undefined }),
  ])],
];
const feeds = FEEDS.map(([name, doc]) => {
  const r = readFeed(JSON.parse(JSON.stringify(doc ?? null)), `${FP}listings.json`);
  return { name, doc: JSON.parse(JSON.stringify(doc ?? null)), ...(r.ok ? { ok: true, feed: r.feed, dropped: r.dropped } : { ok: false, reason: r.reason }) };
});

// ---- pages: the search page in every state and the order page, rendered by the TypeScript (page.test.ts's cases), at a fixed instant with a fixed nonce. The style sheet is the
// same on every page and is kept as its hash (the Go test hashes its own the same way). Written 19 Nov 2026 with the feeds above; from then on this file is the source.
const NOW = Date.parse("2026-11-19T06:00:00.000Z");
const R = (o: Record<string, any>) => ({
  shop: { name: "Rani Pets", page: FP, town: "Thrissur", distanceKm: 1.4, ...o.shop },
  item: { id: "l-3", title: "Persian kitten", lang: "en", machineWritten: false, price: { value: "8000.00", currency: "INR", note: "each" }, photo: `${FP}photo/ph-9.jpg`, availability: "in_stock", confirmed: "2026-11-19T01:00:00.000Z", category: "pets", ...o.item },
  chat: `${FP}chat?about=${o.item?.id ?? "l-3"}`, checked: true, ...o.top,
});
const RESULTS = [
  R({}),
  R({ item: { id: "l-4", title: "പേർഷ്യൻ പൂച്ചക്കുട്ടി", lang: "ml", machineWritten: true, photo: null, price: { value: "1234567.50", currency: "INR" } } }),
  R({ shop: { name: "Silent Tailor", page: "https://pages.example/silent-tailor/", town: "Thrissur", distanceKm: null }, item: { id: "s-1", title: "Cotton kurta", category: "clothes", availability: "call_to_check", confirmed: "2026-11-16T01:00:00.000Z", photo: null }, top: { checked: false, chat: "https://pages.example/silent-tailor/chat?about=s-1" } }),
  R({ item: { id: "l-5", price: null, photo: null, category: "food", confirmed: "2026-11-18T01:00:00.000Z" } }),
  R({ shop: { name: "<script>alert(1)</script> & \"Co\"", page: "https://pages.example/gone-shop/", town: "Kunnamkulam <b>", distanceKm: 24.36 }, item: { id: "g-2", title: "Parrot <img src=x onerror=alert(1)>", price: { value: "999.00", currency: "INR", note: "<b>each</b>" }, photo: null, category: "other" }, top: { chat: "https://pages.example/gone-shop/chat?about=g-2" } }),
  R({ shop: { distanceKm: null }, item: { id: "m-1", category: "vehicles_and_cycles", photo: null, confirmed: "2025-01-01T00:00:00.000Z" } }),
];
const answer = (results: unknown[], next: string | null) => ({ format: "directory-search/1", results, order: "https://pages.example/order", next });
const FORM_FULL = { q: "kitten <b>", category: "pets", town: "", lat: "10.52", lon: "76.21", radius_km: "10" };
const VIEWS: [string, Record<string, unknown>, Record<string, unknown>, { line: string | null; notice: string | null } | undefined, boolean][] = [
  ["start", EMPTY_FORM, { state: "start" }, undefined, false], ["start with the assistant", EMPTY_FORM, { state: "start" }, undefined, true],
  ["results", FORM_FULL, { state: "results", answer: answer(RESULTS, "10") }, undefined, false],
  ["results by town", { ...EMPTY_FORM, q: "kurta", town: "Thrissur <i>", category: "clothes" }, { state: "results", answer: answer(RESULTS.slice(2, 4), null) }, undefined, false],
  ["results with the assistant's line", { ...FORM_FULL, ask: "Persian kitten near me <b>?" }, { state: "results", answer: answer(RESULTS.slice(0, 2), null) }, { line: "2 listings of \"kitten\" <b> at 1 shop.", notice: null }, true],
  ["results searched as typed", { ...EMPTY_FORM, q: "kitten", ask: "kitten" }, { state: "results", answer: answer(RESULTS.slice(0, 1), null) }, { line: null, notice: "Your words were searched as typed." }, true],
  ["none", { ...EMPTY_FORM, q: "zebra" }, { state: "none" }, undefined, false], ["bad", { ...EMPTY_FORM, q: "x", category: "weapons" }, { state: "bad", message: "category must be one of <b>pets</b>" }, undefined, false],
  ["busy", { ...EMPTY_FORM, q: "kitten" }, { state: "busy" }, undefined, false], ["down", { ...EMPTY_FORM, q: "kitten" }, { state: "down" }, undefined, true],
];
const styleHash = (html: string): string => html.replace(/<style>([\s\S]*?)<\/style>/u, (_m, css: string) => `<style>sha256:${createHash("sha256").update(css).digest("hex")}</style>`);
const pages: unknown[] = [];
for (const lang of ["en", "hi", "ml", "kn"] as const) {
  const ctx = { origin: "https://pages.example", lang, now: NOW, nonce: "NONCE", fontUrl: "/search/font.woff2" };
  for (const [name, form, view, assist, assistant] of VIEWS) pages.push({ name, lang, assistant, form, view, assist: assist ?? null, html: styleHash(searchPage({ ...ctx, assistant }, form as never, view as never, assist)) });
  pages.push({ name: "order", lang, assistant: false, form: null, view: null, assist: null, html: styleHash(orderPage(ctx)) });
}
const pagesFile = join(here, "..", "internal", "directory", "testdata", "pages.json.gz");
const pagesText = JSON.stringify({ now: NOW, pages });
const feedsFile = join(here, "..", "internal", "directory", "testdata", "feeds.json.gz");
const feedsText = JSON.stringify({ url: `${FP}listings.json`, feeds });

mkdirSync(dirname(file), { recursive: true });
const text = `${JSON.stringify(out, (_k, v) => (typeof v === "number" && !Number.isFinite(v) ? String(v) : v === undefined ? null : v))}\n`;
if (process.argv.includes("--check")) {
  let stale = false;
  if (!existsSync(file) || readFileSync(file, "utf8") !== text) { console.error("stale: testdata/vectors.json"); stale = true; }
  if (!existsSync(pagesFile) || gunzipSync(readFileSync(pagesFile)).toString("utf8") !== pagesText) { console.error("stale: testdata/pages.json.gz"); stale = true; }
  if (!existsSync(feedsFile) || gunzipSync(readFileSync(feedsFile)).toString("utf8") !== feedsText) { console.error("stale: testdata/feeds.json.gz"); stale = true; }
  if (stale) process.exit(1);
  console.log("fresh");
} else {
  writeFileSync(file, text); writeFileSync(pagesFile, gzipSync(Buffer.from(pagesText), { level: 9 })); writeFileSync(feedsFile, gzipSync(Buffer.from(feedsText), { level: 9 }));
  console.log(`wrote ${text.length} bytes, ${pagesText.length} bytes of pages and ${feedsText.length} bytes of feeds`);
}
