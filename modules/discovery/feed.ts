// Reading a shop feed (specs/shop-feed.md, "The document"): the limits, the fields, the money strings and the categories, checked one by one. Pure: it takes the
// text a shop's address answered and says what is in it, or why it is refused. It does NOT check the signature (trust.ts does, with the key the directory pinned).
//
// What is refused as a whole: more than 1 MB, not JSON, not "shop-feed/1", more than 200 items, a shop block that is not as the spec says, or an address in the
// feed that does not sit under the shop's own page. That last rule is a security rule: a feed may only speak for its own page, so one shop's feed cannot claim
// another shop's page (and with it the other shop's pinned key), and `check` cannot be made to point the directory at an address that is not the shop's.
// What is dropped, with a note: one malformed item. The signed feed is the shop's own; one bad listing must not hide the shop's others.
import { CATEGORIES, LANGS, MAX_FEED_BYTES, MAX_FEED_ITEMS } from "./types.ts";
import type { Category, Feed, FeedItem, FeedShop, Lang, Photo, Price } from "./types.ts";

export type FeedRead = { ok: true; feed: Feed; dropped: string[] } | { ok: false; reason: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number): string | undefined => (typeof v === "string" && v.length > 0 && v.length <= max && v.isWellFormed() ? v : undefined);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u;
const iso = (v: unknown): string | undefined => (typeof v === "string" && ISO.test(v) && !Number.isNaN(Date.parse(v)) ? v : undefined);
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/u;
/** Exact rupees: digits, a point, two places. No sign, no float, no exponent. */
export const MONEY = /^\d{1,9}\.\d{2}$/u;
const DEGREES = /^-?\d{1,3}(?:\.\d{1,6})?$/u;
const PINCODE = /^\d{6}$/u;

/** A web address that is https, has no user or password and no fragment (the item's `page` may have one: see `under`). */
function httpsUrl(v: unknown): URL | undefined {
  if (typeof v !== "string" || v.length > 500) return undefined;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && !u.username && !u.password ? u : undefined;
  } catch { return undefined; }
}
/** Is the address inside the shop's page (same origin, path at or under it)? */
const under = (page: URL, v: unknown): URL | undefined => { const u = httpsUrl(v); return u && u.origin === page.origin && u.pathname.startsWith(page.pathname) ? u : undefined; };

/** The feed's address for a shop page: `<page>listings.json`. */
export const feedUrlOf = (page: string): string => `${page}listings.json`;

function readShop(raw: unknown): { shop: FeedShop; page: URL } | string {
  if (!isObj(raw)) return "the shop is missing";
  const page = httpsUrl(raw.page);
  if (!page || page.search || page.hash || !page.pathname.endsWith("/")) return "the shop's page must be an https address ending in /";
  const name = str(raw.name, 120);
  if (!name) return "the shop has no name";
  const place = raw.place;
  if (!isObj(place)) return "the shop has no place";
  const town = str(place.town, 80);
  if (!town) return "the shop's place has no town";
  const out: FeedShop["place"] = { town };
  if (place.pincode !== undefined) { if (typeof place.pincode !== "string" || !PINCODE.test(place.pincode)) return "the pincode is not six digits"; out.pincode = place.pincode; }
  if (place.lat !== undefined || place.lon !== undefined) {
    if (typeof place.lat !== "string" || typeof place.lon !== "string" || !DEGREES.test(place.lat) || !DEGREES.test(place.lon) || Math.abs(Number(place.lat)) > 90 || Math.abs(Number(place.lon)) > 180) return "lat and lon must both be decimal degrees as strings with at most 6 places";
    out.lat = place.lat; out.lon = place.lon;
  }
  const chat = under(page, raw.chat), check = under(page, raw.check);
  if (!chat) return "the shop's chat address is not under its page";
  if (!check) return "the shop's check address is not under its page";
  let agentCard: string | undefined;
  if (raw.agentCard !== undefined) { const a = under(page, raw.agentCard); if (!a) return "the shop's agent card address is not under its page"; agentCard = a.href; }
  const languages = Array.isArray(raw.languages) ? raw.languages.filter((l): l is Lang => (LANGS as readonly unknown[]).includes(l)) : [];
  const shop: FeedShop = { name, page: page.href, languages, place: out, chat: chat.href, check: check.href };
  if (agentCard) shop.agentCard = agentCard;
  const trade = raw.trade === undefined ? undefined : str(raw.trade, 80);
  if (trade) shop.trade = trade;
  if (isObj(raw.registration)) {
    const r = raw.registration;
    const kind = str(r.kind, 40), number = str(r.number, 60);
    // the registration is the owner's word and always says so; a feed that claims another source is not trusted to say "checked"
    if (kind && number) shop.registration = { kind, number, source: "owner" };
  }
  return { shop, page };
}

function words(v: unknown, max: number): Partial<Record<Lang, string>> | undefined {
  if (!isObj(v)) return undefined;
  const out: Partial<Record<Lang, string>> = {};
  for (const lang of LANGS) {
    const w = v[lang];
    if (w === undefined) continue;
    const s = str(w, max);
    if (!s) return undefined;
    out[lang] = s;
  }
  return out;
}

function readItem(raw: unknown, page: URL): FeedItem | string {
  if (!isObj(raw)) return "not an object";
  if (typeof raw.id !== "string" || !ID.test(raw.id)) return "bad id";
  const id = raw.id;
  const itemPage = under(page, raw.page);
  if (!itemPage) return `${id}: its page is not under the shop's page`;
  if (!(CATEGORIES as readonly unknown[]).includes(raw.category)) return `${id}: unknown category`;
  const title = words(raw.title, 200);
  if (!title || Object.keys(title).length === 0) return `${id}: no title`;
  const text = words(raw.text ?? {}, 2000);
  if (!text) return `${id}: bad text`;
  if (!(LANGS as readonly unknown[]).includes(raw.ownerLanguage)) return `${id}: no owner language`;
  const machine = Array.isArray(raw.machineWritten) ? raw.machineWritten : [];
  if (machine.some((l) => !(LANGS as readonly unknown[]).includes(l))) return `${id}: bad machineWritten`;
  let price: Price | null = null;
  if (raw.price !== null && raw.price !== undefined) {
    const p = raw.price;
    if (!isObj(p) || typeof p.value !== "string" || !MONEY.test(p.value) || p.currency !== "INR") return `${id}: bad price`;
    price = { value: p.value, currency: "INR" };
    if (p.note !== undefined) { const note = str(p.note, 40); if (!note) return `${id}: bad price note`; price.note = note; }
  }
  const photosRaw = raw.photos === undefined ? [] : raw.photos;
  if (!Array.isArray(photosRaw) || photosRaw.length > 3) return `${id}: at most 3 photos`;
  const photos: Photo[] = [];
  for (const ph of photosRaw) {
    if (!isObj(ph)) return `${id}: bad photo`;
    const u = under(page, ph.url);
    if (!u || (ph.type !== "image/jpeg" && ph.type !== "image/webp")) return `${id}: a photo must be a JPEG or WebP under the shop's page`;
    const photo: Photo = { url: u.href, type: ph.type };
    if (Number.isSafeInteger(ph.width) && (ph.width as number) > 0) photo.width = ph.width as number;
    if (Number.isSafeInteger(ph.height) && (ph.height as number) > 0) photo.height = ph.height as number;
    photos.push(photo);
  }
  if (raw.availability !== "in_stock" && raw.availability !== "call_to_check") return `${id}: availability must be in_stock or call_to_check`;
  const confirmed = iso(raw.confirmed);
  if (!confirmed) return `${id}: no confirmed date`;
  const item: FeedItem = { id, page: itemPage.href, category: raw.category as Category, title, text, ownerLanguage: raw.ownerLanguage as Lang, machineWritten: machine as Lang[], price, photos, availability: raw.availability, confirmed };
  if (raw.quantity !== undefined) { if (!Number.isSafeInteger(raw.quantity) || (raw.quantity as number) < 0 || (raw.quantity as number) > 1_000_000) return `${id}: bad quantity`; item.quantity = raw.quantity as number; }
  return item;
}

/** Read a feed from the text the shop's address answered. `feedUrl` is the address it was read from: it must be `<shop page>listings.json`. */
export function parseFeed(text: string, feedUrl: string): FeedRead {
  if (Buffer.byteLength(text, "utf8") > MAX_FEED_BYTES) return { ok: false, reason: "the feed is over 1 MB" };
  let doc: unknown;
  try { doc = JSON.parse(text); } catch { return { ok: false, reason: "the feed is not JSON" }; }
  return readFeed(doc, feedUrl);
}

/** The same for a document already parsed (the signature member is ignored here). */
export function readFeed(doc: unknown, feedUrl: string): FeedRead {
  if (!isObj(doc) || doc.format !== "shop-feed/1") return { ok: false, reason: "the feed is not shop-feed/1" };
  const updated = iso(doc.updated);
  if (!updated) return { ok: false, reason: "the feed has no valid `updated`" };
  const s = readShop(doc.shop);
  if (typeof s === "string") return { ok: false, reason: s };
  if (feedUrlOf(s.shop.page) !== feedUrl) return { ok: false, reason: "the feed is not at the address its shop's page names (<page>listings.json)" };
  if (!Array.isArray(doc.items)) return { ok: false, reason: "the feed has no items list" };
  if (doc.items.length > MAX_FEED_ITEMS) return { ok: false, reason: `the feed has more than ${MAX_FEED_ITEMS} items` };
  const items: FeedItem[] = [], dropped: string[] = [], seen = new Set<string>();
  for (const raw of doc.items) {
    const r = readItem(raw, s.page);
    if (typeof r === "string") { dropped.push(r); continue; }
    if (seen.has(r.id)) { dropped.push(`${r.id}: listed twice`); continue; }
    seen.add(r.id);
    items.push(r);
  }
  return { ok: true, feed: { format: "shop-feed/1", updated, shop: s.shop, items }, dropped };
}
