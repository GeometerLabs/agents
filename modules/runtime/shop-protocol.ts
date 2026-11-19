// The runtime's signing side of the shop's open protocol (specs/shop-feed.md, shop-check.md, agent-card.md): given what the PUBLIC may see of the shop's listings (the same read the page uses)
// and the shop's own key, it makes the signed feed, the signed answer to "do you still have these?", the signed Agent Card, and the signed "my feed changed" notice. The key is the runtime's
// and never leaves it; the public front asks for each document over the channel routes (http.ts) and passes it on.
//
// What it will sign, and what it will not: the feed and the answer are BUILT HERE from the runtime's own state, so nothing a caller sends can put a claim in them (the caller gives only the
// shop's page address, its name and languages, and the ids asked about). The card is built by the front (it knows the shop's operations) but is only signed if it is a card for THIS shop:
// every interface address and the provider address are under the shop's page, it is small, and it is plain JSON. No document is signed while the owner's switch is off (a card and a feed
// are not served then; a check answers every id gone, which is also signed, so a directory can drop the shop's items at once).
//
// The notice ("my feed changed") is only a hint (specs/shop-feed.md). `notice` says whether the feed's content changed since the last notice that was delivered, and never more than one a
// minute; `delivered` is the caller saying a notice reached the directory. A runtime that restarts has forgotten, and sends one notice: harmless, because a notice only asks for a re-read.
import { signCard } from "../signing/index.ts";
import type { SigningKey } from "../signing/index.ts";
import { buildFeed } from "../listings/feed.ts";
import { stateOfPublic } from "../listings/kit.ts";
import type { PublicListingsRead } from "../listings/kit.ts";
import { LANGS } from "../listings/listings.ts";
import type { Lang } from "../listings/listings.ts";
import { changeNotice, checkAnswer, feedFingerprint, shopFacts, signedFeed } from "../listings/protocol.ts";

/**
 * Is `value` an address inside the shop's page: https, the same origin, no user or password, and a path at or under the page's own path? Parsed with URL, so `<page>/../other` and
 * `<page>.evil.example` are what they really are (the same rule the directory's feed reader, go/internal/directory feed.go `under`, applies to a feed).
 */
export function underPage(page: string, value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const p = new URL(page);
    const u = new URL(value);
    const base = p.pathname.replace(/\/+$/u, "");
    return u.protocol === "https:" && p.protocol === "https:" && u.origin === p.origin && !u.username && !u.password && (u.pathname === base || u.pathname.startsWith(`${base}/`));
  } catch { return false; }
}

/** One notice at most this often per shop (specs/shop-feed.md). */
export const NOTICE_EVERY_MS = 60_000;
/** A card larger than this is not a card for a shop: it is refused unsigned. */
const MAX_CARD_BYTES = 32 * 1024;

/** The fingerprint a notice for "the shop stopped showing itself" carries: 43 base64url characters like a feed's, but no hash of a feed is this. */
const HIDDEN = "hidden".repeat(8).slice(0, 43).padEnd(43, "-");

export interface ShopProtocolOptions {
  read(): PublicListingsRead;
  /** The shop's key, or undefined when this store keeps none (a test double): nothing is then signed. */
  key(): SigningKey | undefined;
  now(): number;
  /** The shop's public name for the notice's fingerprint (a rename is a real change of the feed). */
  name?(): string | undefined;
}
type Doc = Record<string, unknown>;

export function createShopProtocol(o: ShopProtocolOptions) {
  let deliveredFingerprint: string | undefined;
  let deliveredAt = Number.NEGATIVE_INFINITY;
  const languagesOf = (given: readonly string[]): Lang[] => given.filter((l): l is Lang => (LANGS as readonly string[]).includes(l));
  return {
    /** The signed feed for this page, or null while the owner's switch is off (or there is no key). */
    feed(q: { page: string; name: string; languages: readonly string[]; chat?: string }): Doc | null {
      const key = o.key();
      const read = o.read();
      if (!key || !read.shop.visible) return null;
      const languages = languagesOf(q.languages);
      return signedFeed(read, shopFacts({ name: q.name, page: q.page, ...(languages.length > 0 ? { languages } : {}), ...(q.chat ? { chat: q.chat } : {}) }), o.now(), key) as unknown as Doc;
    },

    /** The signed answer to a check. With the switch off, every id is gone (signed all the same). Null only when there is no key. */
    check(q: { page: string; ids: readonly string[] }): Doc | null {
      const key = o.key();
      return key ? checkAnswer(o.read(), shopFacts({ name: "", page: q.page }), q.ids, o.now(), key) as unknown as Doc : null;
    },

    /** The card signed with the shop's key; "bad" for something that is not a card for this shop; null while the switch is off (or there is no key). */
    card(q: { page: string; card: unknown }): Doc | null | "bad" {
      const key = o.key();
      if (!key || !o.read().shop.visible) return null;
      const c = q.card;
      if (typeof c !== "object" || c === null || Array.isArray(c) || JSON.stringify(c).length > MAX_CARD_BYTES) return "bad";
      const card = c as Doc;
      const under = (u: unknown): boolean => underPage(q.page, u);
      const interfaces = card.supportedInterfaces;
      const provider = card.provider as { url?: unknown } | undefined;
      if (!Array.isArray(interfaces) || interfaces.length === 0 || !interfaces.every((i) => under((i as { url?: unknown } | null)?.url)) || !under(provider?.url)) return "bad";
      try { return signCard(card, key) as unknown as Doc; } catch { return "bad"; } // a card with no canonical form (a float, an undefined member) is not one we sign
    },

    /**
     * The notice to send now, or undefined: nothing changed since the last delivered notice, or one went less than a minute ago, or the switch is off. `page` is the shop's page on the pages
     * domain (its feed is `<page>/listings.json`). The fingerprint goes back in `delivered` once the notice has reached the directory.
     */
    notice(q: { page: string }): { notice: Doc; fingerprint: string } | undefined {
      const key = o.key();
      const read = o.read();
      const now = o.now();
      if (!key || now - deliveredAt < NOTICE_EVERY_MS) return undefined;
      // the owner turned the switch off after a notice went out: that is a change too (the feed is now a 404), and the directory should drop the shop at once, not at its next six-hourly read
      if (!read.shop.visible) {
        if (deliveredFingerprint === undefined || deliveredFingerprint === HIDDEN) return undefined;
        return { notice: changeNotice(`${q.page}/listings.json`, new Date(now).toISOString(), key) as unknown as Doc, fingerprint: HIDDEN };
      }
      const feed = buildFeed(stateOfPublic(read), shopFacts({ name: o.name?.() ?? "", page: q.page }), now);
      const fingerprint = feedFingerprint(feed);
      if (fingerprint === deliveredFingerprint) return undefined;
      return { notice: changeNotice(`${q.page}/listings.json`, feed.updated, key) as unknown as Doc, fingerprint };
    },

    /** A notice with this fingerprint reached the directory. */
    delivered(fingerprint: string): void { deliveredFingerprint = fingerprint; deliveredAt = o.now(); },
  };
}
export type ShopProtocol = ReturnType<typeof createShopProtocol>;
