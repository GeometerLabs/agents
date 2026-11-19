// The shop's open data (block S, phase A): the same listings as the storefront, in two open forms that anyone can read without asking us: schema.org JSON-LD inside the
// storefront page, and a small documented JSON file at `<the shop's page>/listings.json`. Both are made here from the shop's own saved listings and are PURE: no disk, no network.
// They exist only while the owner's switch "Show my shop on Streetlist and in search" is on (the front checks it), and they carry only what a visitor to the page may already see:
// public listings (live, not hidden, not sold), the shop's name, place and page, the photos' exact addresses and the price the OWNER set. Never a customer's number or name, never the
// owner's number unless the shop's page already shows it, never a draft or a sold listing.
//
// listings.json is documented for anyone who wants to read it (a directory, an AI assistant, another site): `format` is a version string. A change that breaks a reader gets a new
// version; adding a field does not. Anyone can rebuild a search index from these files, which is the point: the shop's data is the shop's.
import { EXTENSION } from "./photo.ts";
import { LANGS, freshnessOf, publicListings, textIn } from "./listings.ts";
import type { Lang, Listing, ListingsState } from "./listings.ts";

export const FEED_FORMAT = "shop-feed/1";
/** The spec's limits: at most 1 MB and 200 items (a shop shows at most 50, so the item limit is a guard, not a squeeze). */
export const FEED_MAX_ITEMS = 200;
export const FEED_MAX_BYTES = 1_000_000;

export interface FeedShop {
  name: string;
  /** The shop's public page, absolute, no trailing slash ("https://pages.streetlist.in/s/glow-salon"). */
  page: string;
  /** The shop's public contact number only when its page already shows one (the shop's settings contact). Used for schema.org only: shop-feed/1 has no phone field. */
  phone?: string;
  /** The languages the shop answers in, the owner's first. */
  languages?: Lang[];
  /** The shop's chat address, when it has a chat. */
  chat?: string;
  /** Where a directory asks "do you still have these?" (shop-check/1), `<page>/api/v1/check`. Left out: the feed names none (the unsigned form the page's tests read). */
  check?: string;
  /** The shop's Agent Card, `<page>/agent-card.json`. Left out: the feed names none. */
  agentCard?: string;
  /** The shop's trade in plain words, when the runtime can see it. Left out otherwise (the runtime cannot see the panel's meta today: modules/listings/README.md). */
  trade?: string;
}

/** A photo's exact public address, under the shop's page (not the door's stable `/p/...` page address). */
export const photoPath = (id: string, type: "image/jpeg" | "image/webp"): string => `/listings/photo/${id}.${EXTENSION[type]}`;
const photoUrl = (shop: FeedShop, p: Listing["photos"][number]): string => `${shop.page}${photoPath(p.id, p.type)}`;
const listingUrl = (shop: FeedShop, l: Listing): string => `${shop.page}/shop#${l.id}`;

const rupees = (paise: number): string => (paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2));
/** Exact rupees as a decimal string with two places, never a float ("8000.00"). */
const decimal = (paise: number): string => `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, "0")}`;
/** Degrees as a string with at most 6 decimals, so every language reads them alike. */
const degrees = (n: number): string => String(Number(n.toFixed(6)));
/** The spec writes the vehicles category in full. */
const SPEC_CATEGORY: Record<string, string> = { vehicles: "vehicles_and_cycles" };

export interface Feed {
  format: typeof FEED_FORMAT;
  updated: string;
  shop: {
    name: string; page: string; languages: Lang[]; trade?: string;
    place?: { town: string; pincode?: string; lat?: string; lon?: string };
    chat?: string; check?: string; agentCard?: string;
    registration?: { kind: "pet-shop"; number: string; source: "owner" };
  };
  items: FeedItem[];
}

export interface FeedItem {
  id: string; page: string; category: string;
  title: Partial<Record<Lang, string>>; text: Partial<Record<Lang, string>>;
  ownerLanguage: Lang; machineWritten: Lang[];
  price: { value: string; currency: "INR"; note?: string } | null;
  quantity?: number;
  photos: { url: string; type: string; width: number; height: number }[];
  availability: "in_stock" | "call_to_check";
  confirmed: string;
}

/** One public listing as the feed writes it. The check answer (protocol.ts) takes its price, quantity, availability and confirmed time from this same function, so the two can never say different things. */
export function feedItem(shop: FeedShop, l: Listing, nowMs: number): FeedItem {
  return {
    id: l.id, page: listingUrl(shop, l), category: SPEC_CATEGORY[l.category] ?? l.category,
    title: Object.fromEntries(LANGS.filter((k) => l.words[k]).map((k) => [k, l.words[k]!.title])) as Partial<Record<Lang, string>>,
    // a language with no text (the owner's plain form writes the title only) is left out, not written as "": a reader refuses an empty string (go/internal/directory feed.go), and the item with it
    text: Object.fromEntries(LANGS.filter((k) => l.words[k]?.text).map((k) => [k, l.words[k]!.text])) as Partial<Record<Lang, string>>,
    ownerLanguage: l.ownerLang, machineWritten: LANGS.filter((k) => l.words[k] && k !== l.ownerLang),
    price: l.pricePaise !== undefined ? { value: decimal(l.pricePaise), currency: "INR" as const, ...(l.priceNote ? { note: l.priceNote } : {}) } : null,
    // a whole number only: a signature is made over canonical JSON, which has no floats (a stock count is always whole, but a signed file must not depend on that)
    ...(l.qty !== undefined && Number.isSafeInteger(l.qty) && l.qty >= 0 ? { quantity: l.qty } : {}),
    photos: l.photos.slice(0, 3).map((p) => ({ url: photoUrl(shop, p), type: p.type, width: p.width, height: p.height })),
    availability: freshnessOf(l, nowMs) === "fresh" ? "in_stock" as const : "call_to_check" as const,
    confirmed: new Date(l.confirmedMs ?? l.publishedMs ?? l.createdMs).toISOString(),
  };
}

/**
 * The open feed (listings.json), exactly shop-feed/1 (specs/shop-feed.md): public listings only, unsigned. The shop's runtime signs it (protocol.ts `signedFeed`); `shop.check`,
 * `shop.agentCard` and `shop.trade` are written when the caller gives them (the runtime always gives the first two; it cannot see the trade).
 */
export function buildFeed(state: ListingsState, shop: FeedShop, nowMs: number): Feed {
  const s = state.shop;
  const owner = state.items.find((l) => l.state !== "draft")?.ownerLang;
  const languages = shop.languages ?? (owner ? [owner, ...LANGS.filter((k) => k !== owner)] : [...LANGS]);
  const items = publicListings(state, nowMs).slice(0, FEED_MAX_ITEMS).map((l) => feedItem(shop, l, nowMs));
  // "updated": the last time anything in the shop's listings changed (a confirm, a sale, a removal, a publish), so a reader's ETag moves only when the file does
  const times = state.items.flatMap((l) => [l.createdMs, l.publishedMs, l.confirmedMs, l.soldMs, l.removedMs].filter((t): t is number => t !== undefined));
  const updated = new Date(times.length > 0 ? Math.max(...times) : nowMs).toISOString();
  return {
    format: FEED_FORMAT, updated,
    shop: {
      name: shop.name, page: `${shop.page}/`, languages,
      ...(shop.trade ? { trade: shop.trade } : {}),
      ...(s.town ? { place: { town: s.town, ...(s.pincode ? { pincode: s.pincode } : {}), ...(s.lat !== undefined && s.lon !== undefined ? { lat: degrees(s.lat), lon: degrees(s.lon) } : {}) } } : {}),
      ...(shop.chat ? { chat: shop.chat } : {}),
      ...(shop.check ? { check: shop.check } : {}),
      ...(shop.agentCard ? { agentCard: shop.agentCard } : {}),
      ...(s.registration ? { registration: { kind: "pet-shop" as const, number: s.registration, source: "owner" as const } } : {}),
    },
    items,
  };
}

/** schema.org data for the storefront page: the shop as a Store with its place, and each public listing as a Product with an Offer (price in INR, in stock). */
export function buildJsonLd(state: ListingsState, shop: FeedShop, lang: Lang, nowMs: number): Record<string, unknown> {
  const s = state.shop;
  const id = `${shop.page}#shop`;
  const place = {
    ...(s.town ? { addressLocality: s.town } : {}), ...(s.pincode ? { postalCode: s.pincode } : {}), addressCountry: "IN",
  };
  const business = {
    "@type": "Store", "@id": id, name: shop.name, url: `${shop.page}/shop`,
    address: { "@type": "PostalAddress", ...place },
    ...(s.lat !== undefined && s.lon !== undefined ? { geo: { "@type": "GeoCoordinates", latitude: s.lat, longitude: s.lon } } : {}),
    ...(shop.phone ? { telephone: shop.phone } : {}),
  };
  const products = publicListings(state, nowMs).map((l) => {
    const t = textIn(l, lang);
    return {
      "@type": "Product", "@id": listingUrl(shop, l), name: t.title, ...(t.text ? { description: t.text } : {}), category: l.category, inLanguage: t.lang,
      ...(l.photos.length > 0 ? { image: l.photos.map((p) => photoUrl(shop, p)) } : {}),
      offers: {
        "@type": "Offer", url: listingUrl(shop, l), priceCurrency: "INR", availability: "https://schema.org/InStock", seller: { "@id": id },
        ...(l.pricePaise !== undefined ? { price: rupees(l.pricePaise) } : {}),
      },
    };
  });
  return { "@context": "https://schema.org", "@graph": [business, ...products] };
}

/**
 * JSON for the inside of a `<script type="application/ld+json">` block. The page's html`` escaping would turn quotes into entities and break JSON, so this is written as raw markup and
 * escaped for a script instead: `<`, `>`, `&` and the two line separators become \uXXXX escapes, so nothing a shop wrote (a title with "</script>") can end the block.
 */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/gu, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
