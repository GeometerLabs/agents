// The shop's side of the open protocol (specs/shop-feed.md, specs/shop-check.md): the signed feed, the signed answer to "do you still have these?", and the signed "my feed changed"
// notice. SERVER SIDE only (it signs with node:crypto, through modules/signing); it is called by the shop's own runtime, which holds the shop's key, and by nothing else. The public
// front never sees the key: it asks the runtime for a signed document and passes it on.
//
// Everything here is made from what the PUBLIC may already see (`PublicListingsRead`: live listings, the owner's price, a counted listing's stock count, sold-out ones already left out),
// through the same item builder the feed uses (feed.ts `feedItem`), so a check answer can never say more than the feed, or something different from it. Pure apart from the signature: no
// disk, no network, no clock (the caller passes the time), so a test can pin both.
//
// A check changes nothing and writes nothing: it reads a copy the runtime made of the saved state.
import { createHash } from "node:crypto";
import { canonicalJson, signAnswer, signFeed, signNotice } from "../signing/index.ts";
import type { Sealed, SigningKey } from "../signing/index.ts";
import { buildFeed, feedItem } from "./feed.ts";
import type { Feed, FeedItem, FeedShop } from "./feed.ts";
import { publicListings } from "./listings.ts";
import { stateOfPublic } from "./kit.ts";
import type { PublicListingsRead } from "./kit.ts";

export const CHECK_FORMAT = "shop-check/1";
export const NOTICE_FORMAT = "shop-feed-changed/1";
/** At most this many ids in one question (specs/shop-check.md). */
export const MAX_CHECK_IDS = 10;
/** A listing id as the shop gives it ("l-3"); the check accepts the same shape the directory reads from a feed. */
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/u;

/** The shop's addresses the signed documents carry. `page` has no trailing slash, as everywhere in feed.ts. */
export function shopFacts(o: { name: string; page: string; languages?: FeedShop["languages"]; chat?: string; trade?: string }): FeedShop {
  return {
    name: o.name, page: o.page, ...(o.languages ? { languages: o.languages } : {}), ...(o.chat ? { chat: o.chat } : {}), ...(o.trade ? { trade: o.trade } : {}),
    check: `${o.page}/api/v1/check`, agentCard: `${o.page}/agent-card.json`,
  };
}

/** The feed, signed with the shop's key: `signature { alg, keyId, key, sig }` over the canonical JSON of the feed without it. */
export const signedFeed = (read: PublicListingsRead, shop: FeedShop, nowMs: number, key: SigningKey): Sealed<Feed> => signFeed(buildFeed(stateOfPublic(read), shop, nowMs), key);

/**
 * What changed in a feed, for the "my feed changed" notice: a hash of the feed without `updated` (and without its signature, which it never has here). The feed's own `updated` moves only
 * when a listing's own times move, but an item also changes when it goes from "in stock" to "call to check" by the clock, so the notice follows the content, not that one member.
 */
export const feedFingerprint = (feed: Feed): string => {
  const { updated: _updated, ...content } = feed;
  return createHash("sha256").update(canonicalJson(content)).digest("base64url");
};

/** The notice for a feed address: `{ format, feed, updated, keyId, sig }`, signed with the shop's key. */
export const changeNotice = (feedUrl: string, updated: string, key: SigningKey) => signNotice({ format: NOTICE_FORMAT, feed: feedUrl, updated }, key);

/** The ids of a check question, or why not. `ids` is 1 to 10 distinct-looking item ids; `format`, when given, must be `shop-check/1`. Nothing else is read from the question. */
export function checkIds(body: unknown): { ok: true; ids: string[] } | { ok: false; error: string } {
  const o = typeof body === "object" && body !== null && !Array.isArray(body) ? body as Record<string, unknown> : undefined;
  if (!o) return { ok: false, error: 'Send {"ids": ["l-3", "l-7"]}: one to ten item ids.' };
  if (o.format !== undefined && o.format !== CHECK_FORMAT) return { ok: false, error: `format, when given, is "${CHECK_FORMAT}".` };
  if (!Array.isArray(o.ids) || o.ids.length === 0) return { ok: false, error: "ids is a list of one to ten item ids." };
  if (o.ids.length > MAX_CHECK_IDS) return { ok: false, error: `Ask about at most ${MAX_CHECK_IDS} items at a time.` };
  if (!o.ids.every((id): id is string => typeof id === "string" && ID.test(id))) return { ok: false, error: "Each id is an item id such as l-3." };
  return { ok: true, ids: [...new Set(o.ids as string[])] };
}

/** One answered item: what the feed says of it, less the words and photos. `gone` carries nothing else, so it cannot tell a sold item from one that never was. */
export type CheckItem = { id: string; availability: "gone" } | (Pick<FeedItem, "id" | "availability" | "price" | "confirmed"> & { quantity?: number });

/**
 * The answer to "do you still have these?", signed with the shop's key and stamped with `at` (a directory ignores one more than two minutes old). `page` is the shop page as the feed
 * writes it (`shop.page`, with its trailing slash): the directory refuses an answer that names another page. An id that is not a public listing now, whatever the reason (sold, removed,
 * hidden for want of a confirm, a counted listing at 0, never existed), is `gone`. With the owner's switch off nothing is public, so every id is `gone`.
 */
export function checkAnswer(read: PublicListingsRead, shop: FeedShop, ids: readonly string[], nowMs: number, key: SigningKey): Sealed<{ format: typeof CHECK_FORMAT; page: string; at: string; items: CheckItem[] }> {
  const live = read.shop.visible ? new Map(publicListings(stateOfPublic(read), nowMs).map((l) => [l.id, l])) : new Map();
  const items: CheckItem[] = ids.slice(0, MAX_CHECK_IDS).map((id) => {
    const l = live.get(id);
    if (!l) return { id, availability: "gone" as const };
    const f = feedItem(shop, l, nowMs);
    return { id: f.id, availability: f.availability, price: f.price, ...(f.quantity !== undefined ? { quantity: f.quantity } : {}), confirmed: f.confirmed };
  });
  return signAnswer({ format: CHECK_FORMAT, page: `${shop.page}/`, at: new Date(nowMs).toISOString(), items }, key);
}
