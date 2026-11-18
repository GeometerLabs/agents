// Taking one feed's text into the index: read it (feed.ts), check its signature and key (trust.ts), and put it in (index.ts), or hold it or refuse it. The single
// place a feed becomes index rows, whether the text just came off the network or is being read again from the copy the index kept (a rebuild), so the two cannot
// disagree about what a good feed is. SERVER SIDE (it writes the index).
import { parseFeed } from "./feed.ts";
import { trustFeed } from "./trust.ts";
import type { DirectoryIndex } from "./index.ts";

export type Ingested =
  | { state: "accepted"; shop: string; items: number; dropped: string[]; newKey: boolean }
  | { state: "held"; shop: string }     // signed by a key other than the pinned one: not shown, listed for a person
  | { state: "refused"; reason: string };

/**
 * Take a feed's text (read from `feedUrl`) into the index. `etag` is what the shop answered with, kept for the next conditional read. `fromStore` is a rebuild reading its
 * own kept copy again: a copy signed by an earlier key than the pinned one (a person accepted a key change and the new feed is not read yet) is skipped, not held again.
 */
export function ingestFeed(index: DirectoryIndex, feedUrl: string, text: string, etag: string | null, now: number, fromStore = false): Ingested {
  const read = parseFeed(text, feedUrl);
  if (!read.ok) return { state: "refused", reason: read.reason };
  const doc = JSON.parse(text) as unknown;
  const page = read.feed.shop.page;
  const trust = trustFeed(doc, index.pinOf(page));
  if (trust.state === "refused") return { state: "refused", reason: trust.reason };
  if (trust.state === "changed") {
    if (fromStore) return { state: "refused", reason: "the kept copy was signed with an earlier key than the pinned one" };
    index.hold(page, trust.pinned.keyId, trust.offered, now);
    return { state: "held", shop: page };
  }
  index.ingest(feedUrl, read.feed, trust.pin, text, etag, now);
  return { state: "accepted", shop: page, items: read.feed.items.length, dropped: read.dropped, newKey: trust.state === "first" };
}

/**
 * Throw the derived tables away and make them again from the feeds the index kept. Returns how many feeds were read again and how many were not accepted.
 * A shop that was held for a key change stays held: the kept copy is the one signed by the pinned key, so reading it would release the shop, and the change a person has not
 * looked at yet must not disappear with the cache. The changes are noted first and put back after.
 */
export function rebuildIndex(index: DirectoryIndex, now: number): { feeds: number; refused: number } {
  const stored = index.storedFeeds();
  const pending = index.keyChanges();
  index.wipeDerived();
  let refused = 0;
  for (const f of stored) if (ingestFeed(index, f.url, f.body, f.etag, f.fetchedAt ?? now, true).state !== "accepted") refused++;
  for (const c of pending) index.hold(c.page, c.pinnedKeyId, { keyId: c.offeredKeyId, key: c.offeredKey }, c.seenAt);
  return { feeds: stored.length, refused };
}
