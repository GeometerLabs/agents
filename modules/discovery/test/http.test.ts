// The directory over real HTTP (a server on a free local port): the people's page and the JSON search from one address, the order page, the font, the Agent Card, the MCP
// endpoint and the notices, with the privacy rules (no cookie ever, no referrer, per-address limits in memory) checked on every answer. Written 18 Nov 2026.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { DirectoryIndex } from "../index.ts";
import { ingestFeed } from "../ingest.ts";
import { createChecker } from "../check.ts";
import { directoryCard } from "../card.ts";
import { directoryHandler, languageOf, LIMITS } from "../http.ts";
import { generateSigningKey } from "../../signing/keys.ts";
import { verifyCard } from "../../signing/jws.ts";
import { signNotice } from "../../signing/sign.ts";
import type { Fetcher } from "../types.ts";
import { NOW, item, shop } from "./fixtures.ts";

const ORIGIN = "https://pages.example";
const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });

async function directory() {
  const index = new DirectoryIndex(":memory:");
  const s = shop("rani-pets", { lat: "10.527642" });
  index.addFeed(s.feedUrl, "config", NOW);
  ingestFeed(index, s.feedUrl, JSON.stringify(s.feed([item(s.page, "l-3")])), null, NOW);
  const asked: string[] = [];
  const fetch: Fetcher = async (_url, init) => {
    asked.push(init.body ?? "");
    const ids = (JSON.parse(init.body ?? "{}") as { ids: string[] }).ids;
    return { status: 200, headers: {}, body: JSON.stringify(s.answer(ids.map((id) => ({ id, availability: "in_stock" as const })))) };
  };
  const key = generateSigningKey();
  const clock = { now: NOW };
  const handler = directoryHandler({
    search: { index, checker: createChecker({ fetch, now: () => clock.now, timeoutMs: 100 }), origin: ORIGIN, now: () => clock.now }, origin: ORIGIN,
    card: () => directoryCard({ origin: ORIGIN, provider: { organization: "Geometer", url: ORIGIN }, key }), notices: { served: ["pages.example"], configured: [] }, now: () => clock.now,
  });
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const get = (path: string, headers: Record<string, string> = {}) => fetch2(`${base}${path}`, { headers });
  return { base, get, index, s, key, asked, clock, post: (path: string, body: unknown, headers: Record<string, string> = {}) => fetch2(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }) };
}
const fetch2 = globalThis.fetch;

/** What every answer must hold: no cookie, no referrer, nothing sniffed. */
function privacy(r: Response): void {
  assert.equal(r.headers.get("set-cookie"), null, "the directory never sets a cookie");
  assert.equal(r.headers.get("referrer-policy"), "no-referrer");
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
}

test("the search page: HTML by default, JSON when asked, the same results, never a cookie and never a referrer", async () => {
  const d = await directory();
  const start = await d.get("/search");
  assert.equal(start.status, 200);
  privacy(start);
  assert.match(start.headers.get("content-type")!, /^text\/html/u);
  assert.match(start.headers.get("content-security-policy")!, /form-action https:\/\/pages\.example\/search/u);
  assert.equal(start.headers.get("x-robots-tag"), "noindex");
  assert.match(await start.text(), /Search what local shops have/u);

  const page = await d.get("/search?q=persian+kitten&lang=ml", { accept: "text/html" });
  const html = await page.text();
  privacy(page);
  assert.ok(html.includes("പേർഷ്യൻ പൂച്ചക്കുട്ടി") && html.includes("കടയോട് സംസാരിക്കൂ"));
  const asJson = await d.get("/search?q=persian+kitten&lang=ml", { accept: "application/json" });
  privacy(asJson);
  const body = await asJson.json() as { format: string; results: { item: { id: string }; checked: boolean }[]; order: string };
  assert.equal(body.format, "directory-search/1");
  assert.deepEqual(body.results.map((r) => [r.item.id, r.checked]), [["l-3", true]]);
  assert.equal(body.order, "https://pages.example/order");
  assert.equal(asJson.headers.get("access-control-allow-origin"), "*");
  const byParam = await (await d.get("/search?q=kitten&format=json")).json() as { results: unknown[] };
  assert.equal(byParam.results.length, 1);
  assert.deepEqual(d.asked.map((b) => JSON.parse(b).ids), [["l-3"]], "the check for the same item was kept for a minute, so the shop was asked once");
  assert.ok(d.asked.every((b) => !/persian|kitten/iu.test(b)), "the shop never saw the words");
});

test("nothing found and a request that does not work each have their own status and page", async () => {
  const d = await directory();
  const none = await d.get("/search?q=zebra");
  assert.equal(none.status, 200);
  assert.match(await none.text(), /Nothing found/u);
  const bad = await d.get("/search?q=kitten&lat=10.5");
  assert.equal(bad.status, 400);
  assert.match(await bad.text(), /lat and lon must both be decimal degrees/u);
  const badJson = await d.get("/search?format=json&category=guns");
  assert.equal(badJson.status, 400);
  assert.match(((await badJson.json()) as { error: string }).error, /category must be one of/u);
});

test("a language comes from ?lang= first, then the browser's list, then English", () => {
  assert.equal(languageOf("kn", "hi"), "kn");
  assert.equal(languageOf(null, "ml-IN,ml;q=0.9,en;q=0.5"), "ml");
  assert.equal(languageOf("xx", "fr, hi;q=0.8"), "hi");
  assert.equal(languageOf(null, undefined), "en");
});

test("per-address limits: the visitor's address is the last X-Forwarded-For entry, each address has its own count, and the busy page says wait a minute", async () => {
  const d = await directory();
  for (let i = 0; i < LIMITS.search.max; i++) assert.equal((await d.get("/search?q=kitten", { "x-forwarded-for": "198.51.100.1" })).status, 200, `search ${i + 1}`);
  const over = await d.get("/search?q=kitten", { "x-forwarded-for": "203.0.113.50, 198.51.100.1" });
  assert.equal(over.status, 429);
  assert.equal(over.headers.get("retry-after"), "60");
  assert.match(await over.text(), /Please wait a minute/u);
  assert.equal((await d.get("/search?q=kitten", { "x-forwarded-for": "198.51.100.2" })).status, 200, "another address is not held back");
  const j = await d.get("/search?q=kitten&format=json", { "x-forwarded-for": "198.51.100.1" });
  assert.equal(j.status, 429);
  d.clock.now += 61_000;
  assert.equal((await d.get("/search?q=kitten", { "x-forwarded-for": "198.51.100.1" })).status, 200, "a minute later it is allowed again");
});

test("the order page is public and cacheable, the font is a year-long file, and other paths are a plain 404", async () => {
  const d = await directory();
  const order = await d.get("/order?lang=hi");
  privacy(order);
  assert.equal(order.status, 200);
  assert.equal(order.headers.get("cache-control"), "public, max-age=300");
  assert.match(await order.text(), /पैसे से कभी नहीं/u);
  const font = await d.get("/search/font.woff2");
  assert.equal(font.status, 200);
  assert.equal(font.headers.get("content-type"), "font/woff2");
  assert.match(font.headers.get("cache-control")!, /immutable/u);
  assert.equal(Buffer.from(await font.arrayBuffer()).subarray(0, 4).toString(), "wOF2");
  assert.equal((await d.get("/nothing-here")).status, 404);
  assert.equal((await d.get("/healthz")).status, 200);
});

test("the Agent Card is served at the well-known address, signed, with open access for programs", async () => {
  const d = await directory();
  const r = await d.get("/.well-known/agent-card.json");
  privacy(r);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("access-control-allow-origin"), "*");
  const card = await r.json() as { name: string; supportedInterfaces: { url: string }[] };
  assert.equal(card.name, "Directory of local shops");
  assert.equal(card.supportedInterfaces[0].url, "https://pages.example/mcp");
  assert.ok(verifyCard(card, d.key.publicKey));
});

test("the MCP endpoint answers POST with JSON, 202 for a notice, 405 for GET, 400 for junk, and counts a tool call as a search", async () => {
  const d = await directory();
  const list = await d.post("/mcp", { jsonrpc: "2.0", id: 1, method: "tools/list" });
  privacy(list);
  assert.deepEqual(((await list.json()) as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name), ["search_listings", "get_listing", "shop_page"]);
  const call = await d.post("/mcp", { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "search_listings", arguments: { q: "kitten" } } });
  assert.equal(((await call.json()) as { result: { structuredContent: { results: unknown[] } } }).result.structuredContent.results.length, 1);
  assert.equal((await d.post("/mcp", { jsonrpc: "2.0", method: "notifications/initialized" })).status, 202);
  assert.equal((await d.get("/mcp")).status, 405);
  assert.equal((await d.post("/mcp", "{nope")).status, 400);
  assert.equal((await d.post("/mcp", `{"x":"${"a".repeat(20_000)}"}`)).status, 400, "over 16 KB");
  for (let i = 0; i < LIMITS.search.max; i++) await d.post("/mcp", { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "search_listings", arguments: { q: "kitten" } } }, { "x-forwarded-for": "198.51.100.9" });
  assert.equal((await d.post("/mcp", { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "search_listings", arguments: { q: "kitten" } } }, { "x-forwarded-for": "198.51.100.9" })).status, 429);
});

test("POST /feed-changed: an unknown origin is refused, a feed under the pages domain is a hint, a known shop's notice must be signed by it; GET is 405", async () => {
  const d = await directory();
  const stranger = shop("rani-pets", { host: "evil.example" });
  const refused = await d.post("/feed-changed", signNotice({ format: "shop-feed-changed/1", feed: stranger.feedUrl, updated: "2026-11-18T03:30:00.000Z" }, stranger.key));
  assert.equal(refused.status, 403);
  const ok = await d.post("/feed-changed", signNotice({ format: "shop-feed-changed/1", feed: d.s.feedUrl, updated: "2026-11-18T03:30:00.000Z" }, d.s.key));
  privacy(ok);
  assert.equal(ok.status, 202);
  assert.notEqual(d.index.feed(d.s.feedUrl)!.wantedAt, null, "the feed is marked to be read again");
  const forged = await d.post("/feed-changed", signNotice({ format: "shop-feed-changed/1", feed: d.s.feedUrl, updated: "2026-11-18T03:30:00.000Z" }, generateSigningKey()));
  assert.equal(forged.status, 403);
  assert.equal((await d.post("/feed-changed", "{nope")).status, 400);
  assert.equal((await d.get("/feed-changed")).status, 405);
  assert.equal((await d.post("/feed-changed", "x".repeat(3000))).status, 400, "over 2 KB");
  for (let i = 0; i < LIMITS.notice.max; i++) await d.post("/feed-changed", "{}", { "x-forwarded-for": "198.51.100.77" });
  assert.equal((await d.post("/feed-changed", "{}", { "x-forwarded-for": "198.51.100.77" })).status, 429);
});

test("counts: a day's searches and results are the only record, and the database holds no table of searches or addresses", async () => {
  const d = await directory();
  await d.get("/search?q=kitten", { "x-forwarded-for": "198.51.100.5" });
  await d.get("/search?q=zebra", { "x-forwarded-for": "198.51.100.5" });
  assert.deepEqual(d.index.countsOf("2026-11-18"), { searches: 2, results: 1 });
  const tables = (d.index.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
  for (const t of tables) assert.ok(!/search|query|visitor|address|session|cookie/iu.test(t.replace("items_fts", "")), `a table called ${t} would keep what a person searched`);
  const dump = JSON.stringify(d.index.db.prepare("SELECT * FROM counts").all());
  assert.ok(!dump.includes("198.51.100.5") && !dump.includes("zebra"));
});
