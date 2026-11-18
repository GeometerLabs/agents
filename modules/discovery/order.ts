// THE order of search results (specs/directory.md, "The order"; the owner's rule of 16 Nov 2026: "never by payment, plan or Operator"). This is the only place
// a result list is put in order: the search page, the JSON search and the MCP tools all call `orderResults`, and the check step calls it again after a shop's
// answer changed how fresh an item is. There is no other sort in the directory.
//
// The order, and nothing else:
//   1. Fit.        Items that match every word of the search, then items that match some of them. (A category, when the search names one, is a filter before this.)
//   2. Distance.   Nearer first, in bands: 0-2, 2-5, 5-10, 10-25, 25-50, over 50 km. With only a town: the buyer's town first, then the rest. With no place: all alike.
//   3. Freshness.  In stock before "call to check", within a band.
//   4. Taking turns. Shops in the same band take turns: the order of shops, and of a shop's items, is shuffled by a hash of the DAY and the SEARCH, so no shop is
//                  always first and nobody can buy a spot. Shops then alternate (one item each, round and round). At most 3 items of one shop in the first 10, as
//                  long as other shops have items to put there.
//
// What it is NOT allowed to know: a price, a plan, a payment, an Operator, advertising, a shop's size, how often it is searched, its name or when it arrived.
// So the function does not receive them: its input type (`Candidate`) has only the fields below, `orderResults` copies those fields one by one (never a spread),
// and the test fails if a field is added or if an extra field on an object changes the result. The rotation is the LAST tie-break, and what is left after it is
// the item's key compared as text (a total order is needed so two runs agree; two different hashes tying is not a realistic case).
//
// Pure: it uses a small built-in hash (FNV-1a, two lanes), no import, no clock: the caller passes the day. So it can run anywhere an agent runs.

/** What the order may look at. Nothing else is read, whatever else an object carries. */
export interface Candidate {
  /** An opaque name for the item (shop page + item id), returned in order. Compared as text only after every other tie is gone. */
  key: string;
  /** The shop, as an opaque name (its page address): used to take turns and to count items per shop. Never compared by its letters except to break a tie of hashes. */
  shop: string;
  /** 0: matches every word of the search (or the search has no words); 1: matches some of them. */
  fit: 0 | 1;
  /** Kilometres from the buyer's point to the shop's map point; null when either is not known. */
  distanceKm: number | null;
  /** The shop's town is the buyer's town. */
  sameTown: boolean;
  /** The item is in stock (the owner confirmed it recently), as opposed to "call to check". */
  inStock: boolean;
}

/** The buyer's side: how they gave their place, and the seed of the rotation. */
export interface OrderQuery {
  /** "point": the buyer gave a map point; "town": only a town; "none": no place. */
  place: "point" | "town" | "none";
  /** The day and the search: `${YYYY-MM-DD}|${the normalised search}`. The same search on the same day always gives the same order; another day or search rotates it. */
  seed: string;
}

/** The names of the fields `orderResults` reads. A test compares this list with the real input type and with the source, so a new field must be added here on purpose. */
export const ORDER_FIELDS: readonly string[] = ["key", "shop", "fit", "distanceKm", "sameTown", "inStock"];

/** The upper edge of each distance band in kilometres; a shop beyond the last is in band 5, a shop whose distance is unknown is in band 6. */
export const BAND_EDGES_KM: readonly number[] = [2, 5, 10, 25, 50];
export const UNKNOWN_BAND = 6;
/** How many items of one shop may stand in the first FIRST_PAGE places, when other shops have items to fill them. */
export const PER_SHOP_IN_FIRST_PAGE = 3;
export const FIRST_PAGE = 10;

/** The band of one candidate. */
function bandOf(c: { distanceKm: number | null; sameTown: boolean }, place: OrderQuery["place"]): number {
  if (place === "none") return 0;
  if (place === "town") return c.sameTown ? 0 : 1;
  if (c.distanceKm === null) return c.sameTown ? 0 : UNKNOWN_BAND; // a shop with no map point counts as near only when it is in the buyer's own town
  const i = BAND_EDGES_KM.findIndex((edge) => c.distanceKm! <= edge);
  return i < 0 ? BAND_EDGES_KM.length : i;
}

/** A 64-bit-ish hash of a text as two FNV-1a lanes (32 bits each), written as 16 hex digits: stable everywhere, not secret, only a fair shuffle. */
export function turnHash(text: string): string {
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ (c + i), 0x85ebca6b) >>> 0;
    b = (b ^ (b >>> 13)) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

interface Row { key: string; shop: string; fit: number; band: number; fresh: number; turn: string }

/**
 * The keys of the candidates in the fair order. Every candidate is returned once. `Candidate` objects may carry other properties (a caller's own bookkeeping):
 * they are not read.
 */
export function orderResults(candidates: readonly Candidate[], query: OrderQuery): string[] {
  // an explicit copy of the allowed fields, one by one: nothing else of the object is ever looked at
  const rows: Row[] = candidates.map((c) => ({
    key: c.key, shop: c.shop, fit: c.fit,
    band: bandOf({ distanceKm: c.distanceKm, sameTown: c.sameTown }, query.place),
    fresh: c.inStock ? 0 : 1,
    turn: turnHash(`${query.seed}|${c.key}`),
  }));
  // group by (fit, band, fresh): groups go in that order; inside a group the shops take turns
  const groups = new Map<string, Row[]>();
  for (const r of rows) { const g = `${r.fit}/${r.band}/${r.fresh}`; (groups.get(g) ?? groups.set(g, []).get(g)!).push(r); }
  const sorted = [...groups.entries()].sort(([x], [y]) => compareGroups(x, y));
  const list: Row[] = [];
  for (const [, members] of sorted) list.push(...takeTurns(members, query.seed));
  return capFirstPage(list);
}

const compareGroups = (x: string, y: string): number => {
  const a = x.split("/").map(Number), b = y.split("/").map(Number);
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
};

/** Shops in the group in the order of their turn hash; then one item of each shop in turn, round and round. A shop's own items are in the order of their turn hash too. */
function takeTurns(members: Row[], seed: string): Row[] {
  const byShop = new Map<string, Row[]>();
  for (const r of members) (byShop.get(r.shop) ?? byShop.set(r.shop, []).get(r.shop)!).push(r);
  const shops = [...byShop.keys()].map((shop) => ({ shop, turn: turnHash(`${seed}|shop|${shop}`) })).sort((p, q) => (p.turn < q.turn ? -1 : p.turn > q.turn ? 1 : p.shop < q.shop ? -1 : 1));
  const queues = shops.map((s) => byShop.get(s.shop)!.sort((p, q) => (p.turn < q.turn ? -1 : p.turn > q.turn ? 1 : p.key < q.key ? -1 : 1)));
  const out: Row[] = [];
  for (let round = 0; queues.some((q) => q.length > round); round++) for (const q of queues) if (q.length > round) out.push(q[round]);
  return out;
}

/** At most PER_SHOP_IN_FIRST_PAGE of a shop in the first FIRST_PAGE places; what was held back follows, in its own order, and fills the places if no other shop can. */
function capFirstPage(list: Row[]): string[] {
  const taken: Row[] = [], held: Row[] = [], count = new Map<string, number>();
  for (const r of list) {
    const n = count.get(r.shop) ?? 0;
    if (taken.length < FIRST_PAGE && n >= PER_SHOP_IN_FIRST_PAGE) { held.push(r); continue; }
    taken.push(r); count.set(r.shop, n + 1);
  }
  // `taken` is longer than the first page only when the cap stopped mattering; held items go right after the places other shops could fill
  const firstPage = taken.slice(0, FIRST_PAGE), rest = taken.slice(FIRST_PAGE);
  return [...firstPage, ...held, ...rest].map((r) => r.key);
}
