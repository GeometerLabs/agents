// A search, start to finish (specs/directory.md, "Search: asking the index, then the shops"): candidates from the index, put in THE order (order.ts), the first ten
// confirmed by their shops (check.ts) in parallel, what a shop says is gone dropped, and the answer written as `directory-search/1`. The people's page, the JSON
// API and the MCP tools all call `searchListings`, so they cannot disagree.
//
// No model runs here and no word of the search leaves the directory: a shop is asked about item ids only. A shop that does not answer (or answers wrongly signed, or
// late) keeps what the index knew and is shown as "Call to check": the buyer still sees the item, and is told plainly it was not confirmed.
// Not a ranking: the confirmed answers only change an item's FRESHNESS (in stock before call-to-check, within a band), and the order is made again by order.ts.
import { CATEGORIES } from "./types.ts";
import type { Availability, Category, Lang, Price } from "./types.ts";
import { LANGS } from "./types.ts";
import { FIRST_PAGE, orderResults } from "./order.ts";
import type { Candidate } from "./order.ts";
import { searchWords } from "./text.ts";
import type { DirectoryIndex, Hit, IndexQuery } from "./index.ts";
import type { ShopChecker } from "./check.ts";

export interface SearchRequest { q?: unknown; category?: unknown; lat?: unknown; lon?: unknown; town?: unknown; radius_km?: unknown; lang?: unknown; offset?: unknown }

/** One result as the API and the page show it (specs/directory.md "The search API"). */
export interface SearchResultItem {
  shop: { name: string; page: string; town: string; distanceKm: number | null };
  item: { id: string; title: string; lang: Lang; machineWritten: boolean; price: Price | null; photo: string | null; availability: Availability; confirmed: string; category: Category };
  chat: string;
  checked: boolean;
}
export interface SearchAnswer { format: "directory-search/1"; results: SearchResultItem[]; order: string; next: string | null }
export type Searched = { ok: true; answer: SearchAnswer; cleaned: { words: string[]; category?: Category; place: "point" | "town" | "none"; town?: string; lang: Lang } } | { ok: false; error: string };

const DEGREES = /^-?\d{1,3}(?:\.\d{1,6})?$/u;
const isLang = (v: unknown): v is Lang => (LANGS as readonly unknown[]).includes(v);

/** The buyer's request, cleaned: the words, category, point, town, radius and language, or what is wrong with it. */
export function readRequest(r: SearchRequest): { ok: true; query: IndexQuery; place: "point" | "town" | "none"; lang: Lang; offset: number } | { ok: false; error: string } {
  const text = (v: unknown, max: number): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, max) : undefined);
  const query: IndexQuery = { words: searchWords(text(r.q, 200) ?? "") };
  const category = text(r.category, 40);
  if (category !== undefined) {
    if (!(CATEGORIES as readonly string[]).includes(category)) return { ok: false, error: `category must be one of ${CATEGORIES.join(", ")}` };
    query.category = category as Category;
  }
  const lat = text(r.lat, 12), lon = text(r.lon, 12);
  if (lat !== undefined || lon !== undefined) {
    if (lat === undefined || lon === undefined || !DEGREES.test(lat) || !DEGREES.test(lon) || Math.abs(Number(lat)) > 90 || Math.abs(Number(lon)) > 180) return { ok: false, error: "lat and lon must both be decimal degrees" };
    query.point = { lat: Number(lat), lon: Number(lon) };
  }
  const town = text(r.town, 80);
  if (town !== undefined) query.town = town;
  if (r.radius_km !== undefined && r.radius_km !== "") {
    const km = Number(r.radius_km);
    if (!Number.isFinite(km) || km < 1 || km > 500) return { ok: false, error: "radius_km must be between 1 and 500" };
    query.radiusKm = km;
  }
  const lang = r.lang === undefined || r.lang === "" ? "en" : r.lang;
  if (!isLang(lang)) return { ok: false, error: "lang must be en, hi, ml or kn" };
  const offset = r.offset === undefined || r.offset === "" ? 0 : Number(r.offset);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 190 || offset % FIRST_PAGE !== 0) return { ok: false, error: "offset must be 0, 10, 20 ... up to 190" };
  return { ok: true, query, place: query.point ? "point" : query.town ? "town" : "none", lang, offset };
}

/** The words of an item in the buyer's language, else the owner's, else English, else any; and whether an assistant wrote them. */
export function wordsFor(title: Partial<Record<Lang, string>>, ownerLanguage: Lang, machine: readonly Lang[], lang: Lang): { text: string; lang: Lang; machineWritten: boolean } {
  const pick = [lang, ownerLanguage, "en" as Lang, ...LANGS].find((l) => title[l] !== undefined)!;
  return { text: title[pick]!, lang: pick, machineWritten: machine.includes(pick) };
}

const keyOf = (h: Hit): string => `${h.shop.page}|${h.item.id}`;
const candidateOf = (h: Hit, inStock: boolean): Candidate => ({ key: keyOf(h), shop: h.shop.page, fit: h.fit, distanceKm: h.distanceKm, sameTown: h.sameTown, inStock });

export interface SearchDeps { index: DirectoryIndex; checker: ShopChecker; /** The directory's own address, for the link to the page that states the order. */ origin: string; now?: () => number }

/** A day as YYYY-MM-DD in India's time (the day the rotation changes on). */
export const dayOf = (ms: number): string => new Date(ms + 5.5 * 3_600_000).toISOString().slice(0, 10);

export async function searchListings(deps: SearchDeps, request: SearchRequest): Promise<Searched> {
  const read = readRequest(request);
  if (!read.ok) return read;
  const now = (deps.now ?? Date.now)();
  const { query, place, lang, offset } = read;
  const hits = deps.index.candidates(query);
  const byKey = new Map(hits.map((h) => [keyOf(h), h]));
  const seed = `${dayOf(now)}|${query.words.join(" ")}|${query.category ?? ""}`;
  const ordered = orderResults(hits.map((h) => candidateOf(h, h.item.availability === "in_stock")), { place, seed });
  const page = ordered.slice(offset, offset + FIRST_PAGE).map((k) => byKey.get(k)!);

  // ask each shop about its items on this page, all shops at once
  const perShop = new Map<string, Hit[]>();
  for (const h of page) (perShop.get(h.shop.page) ?? perShop.set(h.shop.page, []).get(h.shop.page)!).push(h);
  const outcomes = new Map<string, Awaited<ReturnType<ShopChecker["check"]>>>();
  await Promise.all([...perShop.entries()].map(async ([shopPage, items]) => {
    const shop = items[0].shop;
    outcomes.set(shopPage, await deps.checker.check({ page: shop.page, check: shop.check, key: shop.key }, items.map((h) => h.item.id)));
  }));

  // what the shops said: gone is dropped; an answer replaces the index's price and freshness; no answer means "call to check"
  const shown: { hit: Hit; availability: Availability; price: Price | null; confirmed: string; checked: boolean }[] = [];
  for (const h of page) {
    const out = outcomes.get(h.shop.page)!;
    const said = out.state === "answered" ? out.items.get(h.item.id) : undefined;
    if (said?.availability === "gone") continue;
    if (said) shown.push({ hit: h, availability: said.availability as Availability, price: said.price !== undefined ? said.price : h.item.price, confirmed: said.confirmed ?? h.item.confirmed, checked: true });
    else shown.push({ hit: h, availability: "call_to_check", price: h.item.price, confirmed: h.item.confirmed, checked: false });
  }
  // freshness may have changed, so the order is made again by the one order function (never by hand)
  const reorder = orderResults(shown.map((s) => candidateOf(s.hit, s.availability === "in_stock")), { place, seed });
  const byShown = new Map(shown.map((s) => [keyOf(s.hit), s]));
  const results: SearchResultItem[] = reorder.map((k) => {
    const s = byShown.get(k)!, { shop, item } = s.hit;
    const title = wordsFor(item.title, item.ownerLanguage, item.machineWritten, lang);
    return {
      shop: { name: shop.name, page: shop.page, town: shop.town, distanceKm: s.hit.distanceKm === null ? null : Math.round(s.hit.distanceKm * 10) / 10 },
      item: { id: item.id, title: title.text, lang: title.lang, machineWritten: title.machineWritten, price: s.price, photo: item.photos[0]?.url ?? null, availability: s.availability, confirmed: s.confirmed, category: item.category },
      chat: `${shop.chat}?about=${encodeURIComponent(item.id)}`, checked: s.checked,
    };
  });
  deps.index.count(dayOf(now), "searches");
  deps.index.count(dayOf(now), "results", results.length);
  return { ok: true, answer: { format: "directory-search/1", results, order: `${deps.origin}/order`, next: ordered.length > offset + FIRST_PAGE ? String(offset + FIRST_PAGE) : null }, cleaned: { words: query.words, ...(query.category ? { category: query.category } : {}), place, ...(query.town ? { town: query.town } : {}), lang } };
}
