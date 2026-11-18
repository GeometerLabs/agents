// "My feed changed" and the refresh of feeds: which notices are accepted (only feeds under the pages domains served, or the configured list), that a notice is only a
// hint (rate-limited re-reads, signature checked for a known shop), the 6-hour refresh with If-None-Match, and dropping a feed after a day of 404. Written 18 Nov 2026.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DirectoryIndex } from "../index.ts";
import { ingestFeed } from "../ingest.ts";
import { MAX_FEEDS, feedAllowed, handleNotice } from "../notices.ts";
import { DROP_AFTER_MS, MIN_REREAD_MS, REFRESH_MS, isDue, readFeedNow, refreshDue } from "../refresh.ts";
import { createLimiter } from "../limits.ts";
import { generateSigningKey } from "../../signing/keys.ts";
import { signNotice } from "../../signing/sign.ts";
import type { Fetcher } from "../types.ts";
import { NOW, item, shop } from "./fixtures.ts";

const served = ["pages.example"];
const notice = (s: ReturnType<typeof shop>, over: Record<string, unknown> = {}, key = s.key) => signNotice({ format: "shop-feed-changed/1", feed: s.feedUrl, updated: "2026-11-18T03:30:00.000Z", ...over }, key);

test("a notice is accepted for a feed under a served pages domain, or exactly one in the configured list, and for nothing else", () => {
  const ix = new DirectoryIndex(":memory:");
  const cfg = { index: ix, served, configured: ["https://builder.example/s/ravi/listings.json"], now: () => NOW };
  const s = shop("rani-pets");
  assert.equal(handleNotice(cfg, notice(s)).status, 202);
  assert.deepEqual(ix.feeds().map((f) => [f.url, f.source, f.wantedAt]), [[s.feedUrl, "notice", NOW]]);
  const builder = shop("ravi", { host: "builder.example" });
  const configured = { ...notice(builder), feed: "https://builder.example/s/ravi/listings.json" };
  assert.equal(handleNotice(cfg, configured).status, 202, "a configured address is allowed");
  for (const feed of ["https://evil.example/rani-pets/listings.json", "http://pages.example/rani-pets/listings.json", "https://pages.example/rani-pets/other.json", "https://pages.example:8443/rani-pets/listings.json", "https://pages.example/rani-pets/listings.json?x=1", "https://pages.example/a/b/listings.json", "https://user:pw@pages.example/rani-pets/listings.json", "https://builder.example/s/other/listings.json", "file:///etc/passwd", "not a url"]) {
    assert.equal(handleNotice(cfg, { ...notice(s), feed }).status, 403, feed);
  }
  assert.equal(ix.feeds().length, 2, "nothing refused was kept");
  assert.equal(feedAllowed("https://pages.example/rani-pets/listings.json", { served, configured: [] }), true);
});

test("a malformed notice is a 400, and a known shop's notice must be signed with its own key", () => {
  const ix = new DirectoryIndex(":memory:");
  const cfg = { index: ix, served, configured: [], now: () => NOW };
  for (const bad of [null, [], "x", { format: "shop-feed-changed/2" }, { format: "shop-feed-changed/1", feed: 5 }]) assert.equal(handleNotice(cfg, bad).status, 400);
  const s = shop("rani-pets");
  ix.addFeed(s.feedUrl, "config", NOW);
  ingestFeed(ix, s.feedUrl, JSON.stringify(s.feed([item(s.page, "l-3")])), null, NOW);
  assert.equal(handleNotice(cfg, notice(s, {}, generateSigningKey())).status, 403, "signed by a stranger");
  assert.equal(handleNotice(cfg, { ...notice(s), updated: "2026-11-19T00:00:00.000Z" }).status, 403, "changed after signing");
  assert.equal(handleNotice(cfg, notice(s)).status, 202);
});

test("the number of feeds is capped, so notices cannot fill the directory", () => {
  const ix = new DirectoryIndex(":memory:");
  for (let i = 0; i < MAX_FEEDS; i++) ix.addFeed(`https://pages.example/shop-${i}x/listings.json`, "notice", NOW);
  const s = shop("rani-pets");
  assert.equal(handleNotice({ index: ix, served, configured: [] }, notice(s)).status, 429);
});

test("per-address limits are counted in memory by a salted hash, are forgotten after the window, and are the same for every kind of request", () => {
  let t = 0;
  const lim = createLimiter({ notice: { max: 3, perMs: 60_000 } }, () => t);
  assert.deepEqual([1, 2, 3, 4].map(() => lim.take("notice", "203.0.113.9")), [true, true, true, false]);
  assert.equal(lim.take("notice", "198.51.100.7"), true, "another address has its own count");
  t = 61_000;
  assert.equal(lim.take("notice", "203.0.113.9"), true);
  assert.equal(lim.take("unlisted kind", "x"), true);
  t = 200_000; lim.take("notice", "z");
  assert.ok(lim.held() <= 3, "old windows are swept");
});

/** A fetcher that answers each feed address from a function, and logs the requests. */
function net(answer: (url: string, headers: Record<string, string>) => { status: number; body?: string; etag?: string } | "down") {
  const log: { url: string; headers: Record<string, string> }[] = [];
  const fetch: Fetcher = async (url, init) => {
    log.push({ url, headers: init.headers ?? {} });
    const a = answer(url, init.headers ?? {});
    if (a === "down") throw new Error("connection refused");
    return { status: a.status, headers: a.etag ? { etag: a.etag } : {}, body: a.body ?? "" };
  };
  return { fetch, log };
}

test("the refresh: a feed never read is read, an unchanged one is asked again after 6 hours with If-None-Match, a hint is read at most once a minute", async () => {
  const s = shop("rani-pets");
  const ix = new DirectoryIndex(":memory:");
  ix.addFeed(s.feedUrl, "config", NOW);
  const body = JSON.stringify(s.feed([item(s.page, "l-3")]));
  const n = net((_u, h) => (h["if-none-match"] === '"v1"' ? { status: 304 } : { status: 200, body, etag: '"v1"' }));
  let t = NOW;
  const deps = { index: ix, fetch: n.fetch, now: () => t };
  assert.deepEqual(await refreshDue(deps), { [s.feedUrl]: "accepted" });
  assert.equal(ix.feed(s.feedUrl)!.etag, '"v1"');
  assert.deepEqual(await refreshDue(deps), {}, "nothing is due straight after");
  t += REFRESH_MS - 1000;
  assert.deepEqual(await refreshDue(deps), {}, "not yet 6 hours");
  t += 1000;
  assert.deepEqual(await refreshDue(deps), { [s.feedUrl]: "unchanged" });
  assert.equal(n.log.at(-1)!.headers["if-none-match"], '"v1"');
  // a hint: read at once only if the last read was over a minute ago
  t += 10_000;
  handleNotice({ index: ix, served, configured: [], now: () => t }, notice(s));
  assert.deepEqual(await refreshDue(deps), {}, "10 seconds after the last read: not yet");
  t += MIN_REREAD_MS;
  assert.deepEqual(await refreshDue(deps), { [s.feedUrl]: "unchanged" });
  assert.equal(ix.feed(s.feedUrl)!.wantedAt, null, "the hint is used up");
  assert.ok(isDue({ ...ix.feed(s.feedUrl)!, checkedAt: null }, t));
});

test("a feed that answers 404 or 410 is dropped, with its items, after a whole day; one good answer in between starts the day again", async () => {
  const s = shop("rani-pets");
  const ix = new DirectoryIndex(":memory:");
  ix.addFeed(s.feedUrl, "config", NOW);
  let status = 200;
  const body = JSON.stringify(s.feed([item(s.page, "l-3")]));
  const n = net(() => ({ status, body: status === 200 ? body : "" }));
  let t = NOW;
  const deps = { index: ix, fetch: n.fetch, now: () => t };
  await readFeedNow(deps, s.feedUrl);
  assert.equal(ix.counts().items, 1);
  status = 404;
  const after = async (ms: number) => { t += ms; return (await readFeedNow(deps, s.feedUrl)).result; };
  assert.equal(await after(REFRESH_MS), "gone");
  assert.equal(await after(REFRESH_MS), "gone");
  assert.equal(ix.counts().items, 1, "the items stay while the feed is only recently gone");
  status = 200;
  assert.equal(await after(REFRESH_MS), "accepted");
  assert.equal(ix.feed(s.feedUrl)!.goneSince, null, "a good answer clears the gone clock");
  status = 410;
  assert.equal(await after(REFRESH_MS), "gone");
  assert.equal(await after(DROP_AFTER_MS - 1000), "gone");
  assert.equal(await after(1000), "dropped");
  assert.equal(ix.counts().items, 0);
  assert.equal(ix.feed(s.feedUrl), undefined);
});

test("a shop that is down for a day is not dropped; a refused feed changes nothing and says why", async () => {
  const s = shop("rani-pets");
  const ix = new DirectoryIndex(":memory:");
  ix.addFeed(s.feedUrl, "config", NOW);
  const good = JSON.stringify(s.feed([item(s.page, "l-3")]));
  let mode: "good" | "down" | "500" | "junk" | "tampered" = "good";
  const tampered = JSON.parse(good); tampered.items[0].price.value = "1.00";
  const n = net(() => mode === "down" ? "down" : mode === "500" ? { status: 500 } : mode === "junk" ? { status: 200, body: "<html>" } : mode === "tampered" ? { status: 200, body: JSON.stringify(tampered) } : { status: 200, body: good });
  let t = NOW;
  const deps = { index: ix, fetch: n.fetch, now: () => t };
  await readFeedNow(deps, s.feedUrl);
  for (const m of ["down", "500", "junk", "tampered"] as const) {
    mode = m; t += 6 * 3_600_000 * 5; // far more than a day
    const r = await readFeedNow(deps, s.feedUrl);
    assert.ok(["error", "refused"].includes(r.result), m);
    assert.equal(ix.counts().items, 1, `${m}: the shop's items stay`);
    assert.equal(ix.item(s.page, "l-3")!.item.price!.value, "8000.00", `${m}: the old price stays`);
    assert.ok(ix.feed(s.feedUrl)!.error, `${m}: the reason is recorded`);
  }
  assert.equal(ix.feed(s.feedUrl)!.goneSince, null);
});

test("a feed signed by another key is held when it is read: the shop leaves the search and the change is listed", async () => {
  const s = shop("rani-pets");
  const ix = new DirectoryIndex(":memory:");
  ix.addFeed(s.feedUrl, "config", NOW);
  const impostor = shop("rani-pets");
  let doc = JSON.stringify(s.feed([item(s.page, "l-3")]));
  const n = net(() => ({ status: 200, body: doc }));
  const deps = { index: ix, fetch: n.fetch, now: () => NOW };
  assert.equal((await readFeedNow(deps, s.feedUrl)).result, "accepted");
  doc = JSON.stringify(impostor.feed([item(s.page, "l-3")]));
  assert.equal((await readFeedNow(deps, s.feedUrl)).result, "held");
  assert.equal(ix.counts().items, 0);
  assert.equal(ix.keyChanges().length, 1);
});
