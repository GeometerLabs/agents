// Writes go/internal/directory/testdata/vectors.json: what the TypeScript directory (modules/discovery) gives on a set of inputs, for the Go unit tests (vectors_test.go) to compare with.
// Run from the repository root:   node go/scripts/gen_directory_vectors.ts      (--check compares with the committed file)
// The inputs are chosen to be the ones the two languages could disagree on: scripts and marks, lower-casing, UTF-16 lengths, hostile addresses, dates V8 reads loosely, numbers JavaScript
// reads from text, a model's answer that is nearly right.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { skeleton } from "../../modules/discovery/romanise.ts";
import { normal, searchWords, wordsOf, haversineKm } from "../../modules/discovery/text.ts";
import { orderResults, turnHash } from "../../modules/discovery/order.ts";
import { readFeed } from "../../modules/discovery/feed.ts";
import { feedAllowed } from "../../modules/discovery/notices.ts";
import { cleanQuestion, readRules, readTypedSearch, requestOf } from "../../modules/discovery/assistant.ts";
import { readRequest, dayOf } from "../../modules/discovery/search.ts";
import { freshness, km, link } from "../../modules/discovery/page.ts";
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

mkdirSync(dirname(file), { recursive: true });
const text = `${JSON.stringify(out, (_k, v) => (typeof v === "number" && !Number.isFinite(v) ? String(v) : v === undefined ? null : v))}\n`;
if (process.argv.includes("--check")) {
  if (!existsSync(file) || readFileSync(file, "utf8") !== text) { console.error("stale: testdata/vectors.json"); process.exit(1); }
  console.log("fresh");
} else { writeFileSync(file, text); console.log(`wrote ${text.length} bytes`); }
