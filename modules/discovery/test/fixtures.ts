// Hand-made shops, signed feeds and signed check answers for the directory's tests. The shop side (modules/listings) builds the real ones; these follow
// specs/shop-feed.md and specs/shop-check.md exactly, so the directory is tested against the specs and not against another program's code. Written 18 Nov 2026.
import { generateSigningKey } from "../../signing/keys.ts";
import { signAnswer, signFeed } from "../../signing/sign.ts";
import type { SigningKey } from "../../signing/keys.ts";
import type { CheckedItem, FeedItem } from "../types.ts";

export const NOW = Date.parse("2026-11-18T09:00:00.000Z");
export const DAY = "2026-11-18";

/** One shop: its page, its key and how to make a feed or a check answer for it. */
export interface TestShop { page: string; feedUrl: string; key: SigningKey; feed(items: FeedItem[], over?: { place?: Record<string, string>; updated?: string; name?: string }): Record<string, unknown>; answer(items: CheckedItem[], at?: string): Record<string, unknown> }

export function item(page: string, id: string, over: Partial<FeedItem> = {}): FeedItem {
  return {
    id, page: `${page}#${id}`, category: "pets",
    title: { en: "Persian kitten", hi: "फ़ारसी बिल्ली का बच्चा", ml: "പേർഷ്യൻ പൂച്ചക്കുട്ടി", kn: "ಪರ್ಷಿಯನ್ ಬೆಕ್ಕಿನ ಮರಿ" },
    text: { en: "Two kittens, vaccinated by the vet, from our own cat.", ml: "രണ്ട് പൂച്ചക്കുട്ടികൾ" },
    ownerLanguage: "ml", machineWritten: ["en", "hi", "kn"], price: { value: "8000.00", currency: "INR", note: "each" }, quantity: 2,
    photos: [{ url: `${page}photo/ph-9.jpg`, type: "image/jpeg", width: 1200, height: 900 }], availability: "in_stock", confirmed: "2026-11-17T04:10:00.000Z", ...over,
  };
}

export function shop(slug: string, o: { name?: string; town?: string; lat?: string; lon?: string; host?: string; key?: SigningKey } = {}): TestShop {
  const page = `https://${o.host ?? "pages.example"}/${slug}/`;
  const key = o.key ?? generateSigningKey();
  const place: Record<string, string> = { town: o.town ?? "Thrissur", ...(o.lat ? { lat: o.lat, lon: o.lon ?? "76.214435" } : {}) };
  return {
    page, feedUrl: `${page}listings.json`, key,
    feed: (items, over = {}) => signFeed({
      format: "shop-feed/1", updated: over.updated ?? "2026-11-18T03:30:00.000Z",
      shop: { name: over.name ?? o.name ?? slug, page, trade: "pet shop", languages: ["ml", "en"], place: { ...place, ...over.place }, chat: `${page}chat`, check: `${page}api/v1/check`, agentCard: `${page}agent-card.json` },
      items,
    }, key),
    answer: (items, at = "2026-11-18T09:00:00.000Z") => signAnswer({ format: "shop-check/1", page, at, items }, key),
  };
}
