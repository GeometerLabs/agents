// The shapes a directory works with, written once (types only: no code, no import, so any file may use them). They follow specs/shop-feed.md,
// specs/shop-check.md and specs/directory.md exactly; a change here is a change to those documents.

/** The four languages the words are in (the same list as modules/language). */
export type Lang = "en" | "hi" | "ml" | "kn";
export const LANGS: readonly Lang[] = ["en", "hi", "ml", "kn"];

export const CATEGORIES = ["pets", "food", "clothes", "home", "electronics", "vehicles_and_cycles", "services", "other"] as const;
export type Category = (typeof CATEGORIES)[number];

/** Freshness as a feed or a check says it. A directory never shows `gone`. */
export type Availability = "in_stock" | "call_to_check";

/** The owner's price: exact rupees as a decimal string with two places (never a float). `null` elsewhere means "ask the shop". */
export interface Price { value: string; currency: "INR"; note?: string }

export interface Photo { url: string; type: "image/jpeg" | "image/webp"; width?: number; height?: number }

export interface FeedShop {
  name: string;
  /** The shop's page, always ending in "/". Every other address in the feed sits under it. */
  page: string;
  trade?: string;
  languages: Lang[];
  place: { town: string; pincode?: string; lat?: string; lon?: string };
  chat: string;
  check: string;
  agentCard?: string;
  registration?: { kind: string; number: string; source: "owner" };
}

export interface FeedItem {
  id: string;
  page: string;
  category: Category;
  title: Partial<Record<Lang, string>>;
  text: Partial<Record<Lang, string>>;
  ownerLanguage: Lang;
  machineWritten: Lang[];
  price: Price | null;
  quantity?: number;
  photos: Photo[];
  availability: Availability;
  confirmed: string;
}

/** A feed once read and checked (the signature is checked by trust.ts, not here). */
export interface Feed { format: "shop-feed/1"; updated: string; shop: FeedShop; items: FeedItem[] }

export const MAX_FEED_BYTES = 1_000_000;
export const MAX_FEED_ITEMS = 200;
export const MAX_CHECK_IDS = 10;

/** One item as the check answer gives it. */
export interface CheckedItem { id: string; availability: Availability | "gone"; price?: Price | null; quantity?: number; confirmed?: string }

/**
 * How the directory reaches the network, handed in by whoever runs it (so the module opens no socket itself, and a test needs no network). A call that cannot be
 * answered (no connection, a refused address, a timeout, a body over `maxBytes`) THROWS; an answer with any status returns.
 */
export type Fetcher = (url: string, init: { method: "GET" | "POST"; headers?: Record<string, string>; body?: string; timeoutMs: number; maxBytes: number }) => Promise<{ status: number; headers: Record<string, string>; body: string }>;
