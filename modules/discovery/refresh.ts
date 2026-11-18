// Reading feeds from the network (specs/directory.md, "Which feeds it reads"): one read of one feed, and the pass that reads every feed that is due. SERVER SIDE:
// it writes the index; the network is the `Fetcher` handed in (the bundle's service gives it the door's guarded transport), so the module opens no socket itself.
//
// When a feed is due:
//   - a notice hinted that it changed (`wanted`), and the feed was last read more than a minute ago (at most once a minute per feed, whoever asks);
//   - it was never read;
//   - it was last read more than 6 hours ago (a directory that gets no notices still keeps up).
// Every read after the first sends If-None-Match with the shop's ETag, so an unchanged feed costs a 304.
// What the answer does:
//   200   the text goes through ingestFeed (checks and key pin); a refused feed leaves the index as it was and records why.
//   304   nothing changed.
//   404/410  the feed is "gone": remembered since when; after a whole day of it the feed and its items are dropped (a shop that turned listing off answers 404).
//   anything else, or no answer   recorded and tried again next time; the shop's items stay (a shop's server being down for a day does not remove it).
import { ingestFeed } from "./ingest.ts";
import type { Ingested } from "./ingest.ts";
import { MAX_FEED_BYTES } from "./types.ts";
import type { Fetcher } from "./types.ts";
import type { DirectoryIndex, FeedRow } from "./index.ts";

export const REFRESH_MS = 6 * 3_600_000;
export const MIN_REREAD_MS = 60_000;
export const DROP_AFTER_MS = 24 * 3_600_000;

export type ReadResult = "accepted" | "unchanged" | "held" | "refused" | "gone" | "dropped" | "error";
export interface ReadDeps { index: DirectoryIndex; fetch: Fetcher; now?: () => number; timeoutMs?: number }

/** Read one feed now and act on the answer. Never throws. */
export async function readFeedNow(deps: ReadDeps, url: string): Promise<{ result: ReadResult; detail?: Ingested | string }> {
  const now = (deps.now ?? Date.now)();
  const row = deps.index.feed(url);
  if (!row) return { result: "error", detail: "not a feed the directory knows" };
  let res: Awaited<ReturnType<Fetcher>>;
  try {
    res = await deps.fetch(url, { method: "GET", headers: { accept: "application/json", ...(row.etag && row.hasBody ? { "if-none-match": row.etag } : {}) }, timeoutMs: deps.timeoutMs ?? 10_000, maxBytes: MAX_FEED_BYTES });
  } catch (e) { deps.index.touch(url, now, `no answer: ${(e as Error).message}`); return { result: "error", detail: (e as Error).message }; }
  if (res.status === 304) { deps.index.db.prepare("UPDATE feeds SET gone_since = NULL WHERE url = ?").run(url); deps.index.touch(url, now, null); return { result: "unchanged" }; }
  if (res.status === 404 || res.status === 410) {
    deps.index.touch(url, now, `the feed answered ${res.status}`);
    const since = deps.index.markGone(url, now);
    if (now - since >= DROP_AFTER_MS) { deps.index.dropFeed(url); return { result: "dropped" }; }
    return { result: "gone" };
  }
  if (res.status !== 200) { deps.index.touch(url, now, `the feed answered ${res.status}`); return { result: "error", detail: `status ${res.status}` }; }
  const done = ingestFeed(deps.index, url, res.body, res.headers.etag ?? null, now);
  if (done.state === "accepted") return { result: "accepted", detail: done };
  deps.index.touch(url, now, done.state === "refused" ? done.reason : "signed by another key than the one pinned; held for a person");
  return { result: done.state === "held" ? "held" : "refused", detail: done };
}

/** Is this feed due for a read now? (The rules in the header.) */
export function isDue(f: FeedRow, now: number): boolean {
  if (f.checkedAt === null) return true;
  if (f.wantedAt !== null && now - f.checkedAt >= MIN_REREAD_MS) return true;
  return now - f.checkedAt >= REFRESH_MS;
}

/** One pass: read every feed that is due, a few at a time. Returns what each read did. */
export async function refreshDue(deps: ReadDeps, concurrency = 4): Promise<Record<string, ReadResult>> {
  const now = (deps.now ?? Date.now)();
  const due = deps.index.feeds().filter((f) => isDue(f, now));
  const out: Record<string, ReadResult> = {};
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, due.length) }, async () => {
    while (next < due.length) { const f = due[next++]; out[f.url] = (await readFeedNow(deps, f.url)).result; }
  }));
  return out;
}
