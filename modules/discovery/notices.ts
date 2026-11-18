// "My feed changed" (specs/shop-feed.md, "My feed changed"; specs/directory.md, "Which feeds it reads"). A shop that turned listing on tells its directory that its feed
// changed. The notice is only a HINT: the directory never takes a listing from it, it reads the feed again (refresh.ts, at most once a minute per feed) and believes only
// what the signed feed says.
//
// What is accepted: a notice for a feed address under one of the pages domains this directory serves (https://<domain>/<slug>/listings.json), or exactly one of the feed
// addresses in the directory's own configured list. Anything else is refused, so nobody can make the directory read an address of their choosing or fill it with junk.
// When the directory already holds the shop's key, the notice must be signed with it (a notice that names a known shop and is not signed by that shop is refused: it cannot
// even be used to make the directory read the feed more often). For a shop it has not met, there is no key yet to check against, and the hint is taken: all it does is
// get the feed read, where the real checks are. The number of feeds is capped, and the caller limits notices per address.
import { verifyNotice } from "../signing/sign.ts";
import type { DirectoryIndex } from "./index.ts";

export const MAX_FEEDS = 5000;
export const MAX_NOTICE_BYTES = 2048;

export interface NoticeConfig { index: DirectoryIndex; /** The pages domains this directory serves (host names, no scheme). */ served: readonly string[]; /** Feed addresses the directory was set up to read. */ configured: readonly string[]; now?: () => number }
export interface NoticeAnswer { status: number; body: { ok: boolean; message: string } }

const SLUG_FEED = /^\/[a-z0-9][a-z0-9-]{1,38}[a-z0-9]\/listings\.json$/u;
const refuse = (status: number, message: string): NoticeAnswer => ({ status, body: { ok: false, message } });

/** May the directory read this feed address because a notice named it? */
export function feedAllowed(url: string, cfg: Pick<NoticeConfig, "served" | "configured">): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash) return false;
  if (cfg.configured.includes(u.href)) return true;
  return cfg.served.includes(u.hostname) && !u.port && SLUG_FEED.test(u.pathname);
}

/** Handle one notice (the parsed JSON body). */
export function handleNotice(cfg: NoticeConfig, body: unknown): NoticeAnswer {
  const n = body as Record<string, unknown> | null;
  if (typeof n !== "object" || n === null || Array.isArray(n) || n.format !== "shop-feed-changed/1" || typeof n.feed !== "string" || typeof n.updated !== "string" || typeof n.keyId !== "string" || typeof n.sig !== "string") return refuse(400, "That is not a shop-feed-changed/1 notice.");
  if (!feedAllowed(n.feed, cfg)) return refuse(403, "This directory does not read that address.");
  const now = (cfg.now ?? Date.now)();
  const page = n.feed.slice(0, -"listings.json".length);
  const pin = cfg.index.pinOf(page);
  if (pin) {
    // a known shop: the notice must be the shop's own
    if (!verifyNotice(n, pin.key).ok) return refuse(403, "The notice is not signed with this shop's key.");
  } else if (!n.feed.endsWith("/listings.json")) return refuse(400, "A feed is at <shop page>/listings.json.");
  if (!cfg.index.feed(n.feed) && cfg.index.feedCount() >= MAX_FEEDS) return refuse(429, "This directory is full of feeds.");
  cfg.index.addFeed(n.feed, "notice", now);
  cfg.index.want(n.feed, now);
  return { status: 202, body: { ok: true, message: "Thank you: the feed will be read again soon." } };
}
