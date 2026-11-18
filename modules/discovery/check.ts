// Asking a shop to confirm (specs/shop-check.md), from the directory's side: "do you still have l-3 and l-7?", the shop answers from its own record and signs the
// answer. This file sends the question, checks the answer and keeps what it learned for 60 seconds.
//
// What the question carries: the format name and the item ids. Never the search words, the place or anything about the buyer (a shop must not learn who searched or for
// what), and the function that sends it takes no such thing. Where it goes: the shop's `check` address from its feed, which feed.ts has already required to sit under
// the shop's own page.
//
// What the answer must be, or it is ignored (the item is then shown from the index with "Call to check", exactly as for a shop that did not answer):
//   - HTTP 200, JSON, under 64 KB, in time (about 1.5 seconds: the buyer is waiting);
//   - format shop-check/1, naming this shop's page;
//   - signed by the key the directory pinned for this shop page (a wrongly signed answer is as good as none);
//   - made just now: `at` within two minutes of the directory's clock, so a recorded "in stock" cannot be played back tomorrow;
//   - only items that were asked about, each with an availability the spec knows.
// `gone` is believed too (it only removes an item); the answer cannot add an item the feed never had, because only asked-for ids are read.
import { verifyDocument } from "../signing/sign.ts";
import { MAX_CHECK_IDS } from "./types.ts";
import type { Availability, CheckedItem, Fetcher, Price } from "./types.ts";
import { MONEY } from "./feed.ts";

export const CHECK_TIMEOUT_MS = 1500;
export const CHECK_CACHE_MS = 60_000;
export const MAX_ANSWER_BYTES = 64 * 1024;
/** How far an answer's `at` may be from the directory's clock, either way. */
export const MAX_ANSWER_SKEW_MS = 2 * 60_000;

export interface CheckTarget { page: string; check: string; key: string }
export type CheckOutcome = { state: "answered"; items: Map<string, CheckedItem> } | { state: "silent"; why: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function readItem(raw: unknown, asked: Set<string>): CheckedItem | undefined {
  if (!isObj(raw) || typeof raw.id !== "string" || !asked.has(raw.id)) return undefined;
  if (raw.availability === "gone") return { id: raw.id, availability: "gone" };
  if (raw.availability !== "in_stock" && raw.availability !== "call_to_check") return undefined;
  const out: CheckedItem = { id: raw.id, availability: raw.availability as Availability };
  if (raw.price === null) out.price = null;
  else if (isObj(raw.price)) {
    if (typeof raw.price.value !== "string" || !MONEY.test(raw.price.value) || raw.price.currency !== "INR") return undefined;
    const price: Price = { value: raw.price.value, currency: "INR" };
    if (typeof raw.price.note === "string" && raw.price.note.length <= 40) price.note = raw.price.note;
    out.price = price;
  } else if (raw.price !== undefined) return undefined;
  if (Number.isSafeInteger(raw.quantity) && (raw.quantity as number) >= 0) out.quantity = raw.quantity as number;
  if (typeof raw.confirmed === "string" && !Number.isNaN(Date.parse(raw.confirmed))) out.confirmed = raw.confirmed;
  return out;
}

/** A promise that gives up after `ms` (the fetcher has its own timeout; this is the belt to its braces), and never leaves its timer behind. */
function within<T>(ms: number, p: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([p, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("timed out")), ms); })]).finally(() => clearTimeout(timer));
}

export interface ShopChecker {
  /** Ask one shop about at most 10 of its items. Items it did not answer for are absent from the map. */
  check(shop: CheckTarget, ids: string[]): Promise<CheckOutcome>;
}

/** The checker over a Fetcher: with the 60-second memory of what each shop said about each item. */
export function createChecker(o: { fetch: Fetcher; now?: () => number; timeoutMs?: number; cacheMs?: number }): ShopChecker {
  const now = o.now ?? Date.now;
  const cacheMs = o.cacheMs ?? CHECK_CACHE_MS;
  const kept = new Map<string, { item: CheckedItem; at: number }>();
  const MAX_KEPT = 5000;
  return {
    async check(shop, ids) {
      const wanted = [...new Set(ids)].slice(0, MAX_CHECK_IDS);
      const t = now();
      const items = new Map<string, CheckedItem>();
      const toAsk: string[] = [];
      for (const id of wanted) {
        const hit = kept.get(`${shop.page}|${id}`);
        if (hit && t - hit.at < cacheMs) items.set(id, hit.item); else toAsk.push(id);
      }
      if (toAsk.length === 0) return { state: "answered", items };
      let res: Awaited<ReturnType<Fetcher>>;
      try {
        const timeoutMs = o.timeoutMs ?? CHECK_TIMEOUT_MS;
        // the question is the format name and the ids, and nothing else: that is the whole of what a shop learns
        res = await within(timeoutMs + 200, o.fetch(shop.check, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ format: "shop-check/1", ids: toAsk }), timeoutMs, maxBytes: MAX_ANSWER_BYTES }));
      } catch (e) { return items.size > 0 ? { state: "answered", items } : { state: "silent", why: (e as Error).message }; }
      if (res.status !== 200 || res.body.length > MAX_ANSWER_BYTES) return items.size > 0 ? { state: "answered", items } : { state: "silent", why: `the shop answered ${res.status}` };
      let doc: unknown;
      try { doc = JSON.parse(res.body); } catch { return items.size > 0 ? { state: "answered", items } : { state: "silent", why: "not JSON" }; }
      const bad = (why: string): CheckOutcome => (items.size > 0 ? { state: "answered", items } : { state: "silent", why });
      if (!isObj(doc) || doc.format !== "shop-check/1" || doc.page !== shop.page || !Array.isArray(doc.items)) return bad("not an answer for this shop");
      const verified = verifyDocument(doc, shop.key);
      if (!verified.ok) return bad(`the answer is not signed by the shop's key (${verified.reason})`);
      const at = typeof doc.at === "string" ? Date.parse(doc.at) : NaN;
      if (Number.isNaN(at) || Math.abs(at - t) > MAX_ANSWER_SKEW_MS) return bad("the answer is not from just now");
      const asked = new Set(toAsk);
      for (const raw of doc.items) {
        const item = readItem(raw, asked);
        if (!item) continue;
        items.set(item.id, item);
        if (kept.size >= MAX_KEPT) kept.delete(kept.keys().next().value as string);
        kept.set(`${shop.page}|${item.id}`, { item, at: t });
      }
      return { state: "answered", items };
    },
  };
}
