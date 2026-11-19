// Search, the order, the pages, the Agent Card, the MCP endpoint and the per-address limits as the directory's outside sees them. The directory is a separate process
// (DIRECTORY_IMPL=ts|go); the shops are fakes behind a fake door. The order rotates by day, so the tests check the order's PROPERTIES (fit, distance bands, in stock first, shops
// taking turns, at most three of one shop in the first ten, the same answer twice), never a fixed sequence.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createPublicKey, verify } from "node:crypto";
import { SKIP, directoryWith, fakeShop, item } from "./harness.ts";
import type { Directory, FakeDoor, FakeShop } from "./harness.ts";

const cleanups: (() => Promise<void>)[] = [];
after(async () => { for (const c of cleanups) await c(); });
async function up(shops: FakeShop[], o: Parameters<typeof directoryWith>[1] = {}): Promise<{ d: Directory; door: FakeDoor }> {
  const r = await directoryWith(shops, o);
  cleanups.push(() => r.door.close());
  return r;
}

const BIKE = (page: string, id = "b-1", over: Record<string, unknown> = {}) => item(page, id, { category: "vehicles_and_cycles", title: { en: "Second-hand bicycle", hi: "पुरानी साइकिल", ml: "പഴയ സൈക്കിൾ", kn: "ಹಳೆಯ ಸೈಕಲ್" }, text: {}, machineWritten: [], ownerLanguage: "en", price: { value: "3000.00", currency: "INR" }, ...over });
async function market() {
  const rani = fakeShop("rani-pets", { name: "Rani Pets", town: "Thrissur", lat: "10.527642" });
  const cycles = fakeShop("kochi-cycles", { name: "Kochi Cycles", town: "Kochi", lat: "9.9312", lon: "76.2673" });
  cycles.items = [BIKE(cycles.page)];
  const r = await up([rani, cycles]);
  return { ...r, rani, cycles };
}

test("words in four languages and in Latin letters find the same listing", { skip: SKIP }, async () => {
  const { d, rani } = await market();
  const ids = async (q: string) => ((await d.searchJson({ q })).body.results as any[]).map((r) => r.shop.page + r.item.id);
  const kitten = [rani.page + "l-3"];
  for (const q of ["persian kitten", "KITTEN", "फ़ारसी", "बिल्ली", "പൂച്ച", "പൂച്ചക്കുട്ടി", "ಬೆಕ್ಕಿನ", "billi", "poocha", "bekku", "pets"]) assert.deepEqual(await ids(q), kitten, `a search for ${q}`);
});

test("search: the words, the filters and the refusals", { skip: SKIP }, async () => {
  const { d, rani, cycles } = await market();
  const pages = async (q: Record<string, string>) => ((await d.searchJson(q)).body?.results ?? []).map((r: any) => r.shop.page);
  assert.deepEqual(await pages({ q: "bicycle" }), [cycles.page]);
  assert.deepEqual(await pages({ q: "साइकिल" }), [cycles.page]);
  assert.deepEqual(await pages({ category: "pets" }), [rani.page]);
  assert.deepEqual((await pages({})).sort(), [cycles.page, rani.page].sort());
  assert.deepEqual(await pages({ q: "nothing-here-xyz" }), []);
  // filler words say what a person is doing, not what they want
  assert.deepEqual(await pages({ q: "kitten near me" }), [rani.page]);
  // a place word counts toward every word but never makes an item a match by itself
  assert.deepEqual(await pages({ q: "kitten thrissur" }), [rani.page]);
  assert.deepEqual(await pages({ q: "bicycle thrissur" }), [cycles.page], "the bicycle matches one word: shown after the ones that match all");
  // a radius keeps shops inside it
  assert.deepEqual(await pages({ lat: "10.52", lon: "76.21", radius_km: "10" }), [rani.page]);
  assert.deepEqual((await pages({ lat: "10.52", lon: "76.21", radius_km: "500" })).sort(), [cycles.page, rani.page].sort());
  assert.deepEqual(await pages({ town: "Kochi", lat: "", lon: "" }), (await pages({ town: "Kochi" })));
  // the distance is shown rounded to a tenth, null without a point
  const near = (await d.searchJson({ q: "kitten", lat: "10.52", lon: "76.21" })).body.results[0];
  assert.equal(typeof near.shop.distanceKm, "number");
  assert.equal(near.shop.distanceKm, Math.round(near.shop.distanceKm * 10) / 10);
  assert.equal((await d.searchJson({ q: "kitten" })).body.results[0].shop.distanceKm, null);
  // what is wrong with a request is said in plain words, with 400
  const bad = async (q: Record<string, string>) => { const r = await d.searchJson(q); assert.equal(r.status, 400, JSON.stringify(q)); return r.body.error as string; };
  assert.match(await bad({ category: "weapons" }), /category must be one of pets, food, clothes/u);
  assert.match(await bad({ lat: "10.5" }), /lat and lon must both be decimal degrees/u);
  assert.match(await bad({ lat: "91", lon: "10" }), /lat and lon/u);
  assert.match(await bad({ lat: "1e1", lon: "10" }), /lat and lon/u);
  assert.match(await bad({ radius_km: "0" }), /radius_km must be between 1 and 500/u);
  assert.match(await bad({ radius_km: "abc" }), /radius_km/u);
  // an unknown language is not an error: the page's own rule (the Accept-Language, else English) decides, and the answer carries the listing's words in English
  assert.equal((await d.searchJson({ q: "kitten", lang: "fr" })).body.results[0].item.lang, "en");
  assert.match(await bad({ offset: "5" }), /offset must be 0, 10, 20/u);
  assert.match(await bad({ offset: "200" }), /offset/u);
  assert.equal((await d.searchJson({ q: "kitten", offset: "10" })).body.results.length, 0);
});

test("the order: fit, then distance bands, then in stock, shops taking turns, three of one shop at most in the first ten, the same twice", { skip: SKIP }, async () => {
  const page = (slug: string) => `https://pages.example/${slug}/`;
  const mkShop = (slug: string, town: string, lat: string, n: number, over: (i: number) => Record<string, unknown> = () => ({})) => {
    const s = fakeShop(slug, { name: slug, town, lat, lon: "76.2" });
    s.items = Array.from({ length: n }, (_, i) => item(page(slug), `i-${i}`, { title: { en: `Kitten ${i}` }, text: {}, ...over(i) }));
    return s;
  };
  const a = mkShop("shop-a", "Thrissur", "10.50", 5), b = mkShop("shop-b", "Thrissur", "10.51", 5), c = mkShop("shop-c", "Thrissur", "10.52", 5);
  const far = mkShop("shop-far", "Kozhikode", "11.25", 3);
  const { d } = await up([a, b, c, far]);
  const run = async (q: Record<string, string>) => (await d.searchJson(q)).body;
  const first = await run({ q: "kitten", lat: "10.51", lon: "76.2" });
  const shopsOf = (r: any[]) => r.map((x) => x.shop.name);
  assert.equal(first.results.length, 10);
  assert.equal(first.next, "10");
  // nearest band first: the Kozhikode shop (about 90 km) is after every Thrissur shop
  const all = [...first.results, ...(await run({ q: "kitten", lat: "10.51", lon: "76.2", offset: "10" })).results];
  assert.equal(all.length, 18);
  assert.equal(new Set(all.map((x: any) => x.shop.name + x.item.id)).size, 18, "no listing twice across pages");
  // the cap holds a shop's fourth listing back so a farther shop may stand in the first ten, but the far shop never leads
  assert.notEqual(all[0].shop.name, "shop-far");
  const nearOne = mkShop("band-near", "Thrissur", "10.50", 2), farOne = mkShop("band-far", "Kozhikode", "11.25", 2), midOne = mkShop("band-mid", "Thrissur", "10.60", 2);
  const { d: d4 } = await up([nearOne, farOne, midOne]);
  assert.deepEqual((await d4.searchJson({ q: "kitten", lat: "10.50", lon: "76.2" })).body.results.map((x: any) => x.shop.name).filter((n: string, i: number, a: string[]) => a.indexOf(n) === i).slice(-1), ["band-far"]);
  // shops take turns: no shop three times in the first ten when others have items; the first places alternate
  const counts = new Map<string, number>();
  for (const n of shopsOf(first.results)) counts.set(n, (counts.get(n) ?? 0) + 1);
  assert.ok([...counts.values()].every((n) => n <= 3), JSON.stringify([...counts]));
  assert.notEqual(first.results[0].shop.name, first.results[1].shop.name);
  // the same search the same day gives the same order, and the page's offset only moves along it
  assert.deepEqual(shopsOf((await run({ q: "kitten", lat: "10.51", lon: "76.2" })).results.map((x: any) => x)), shopsOf(first.results));
  assert.deepEqual((await run({ q: "kitten", lat: "10.51", lon: "76.2" })).results.map((x: any) => x.item.id), first.results.map((x: any) => x.item.id));
  // in stock before call to check, inside a distance band: a shop that does not answer is "call to check" after one that does
  const stocked = mkShop("shop-stocked", "Thrissur", "10.50", 1), silent = mkShop("shop-silent", "Thrissur", "10.50", 1);
  silent.checkAnswer = () => null;
  const { d: d3 } = await up([stocked, silent]);
  for (let i = 0; i < 3; i++) assert.deepEqual((await d3.searchJson({ q: "kitten", lat: "10.5", lon: "76.2" })).body.results.map((x: any) => x.shop.name), ["shop-stocked", "shop-silent"]);
  // fit: a listing with every word comes before one with some
  const two = fakeShop("two-words"); two.items = [item(two.page, "both", { title: { en: "Persian kitten" } }), item(two.page, "one", { title: { en: "Persian rug" }, category: "home", text: {} })];
  const { d: d2 } = await up([two]);
  assert.deepEqual((await d2.searchJson({ q: "persian kitten" })).body.results.map((x: any) => x.item.id), ["both", "one"]);
  // a town only: the buyer's town first
  const t = (await d.searchJson({ q: "kitten", town: "Kozhikode" })).body.results;
  assert.equal(t[0].shop.name, "shop-far");
});

test("the order never reads a price, a plan or a name: the same shops with other prices and names are in the same order", { skip: SKIP }, async () => {
  const mk = (slug: string, name: string, price: string) => { const s = fakeShop(slug, { name, town: "Thrissur", lat: "10.5" }); s.items = [item(s.page, "x-1", { price: { value: price, currency: "INR" } })]; return s; };
  const one = await up([mk("p-1", "Zebra Pets", "100.00"), mk("p-2", "Alpha Pets", "99999.00"), mk("p-3", "Mid Pets", "5.00")]);
  const two = await up([mk("p-1", "Alpha Pets", "99999.00"), mk("p-2", "Mid Pets", "5.00"), mk("p-3", "Zebra Pets", "100.00")]);
  const slugs = async (d: Directory) => ((await d.searchJson({ q: "kitten", lat: "10.5", lon: "76.2" })).body.results as any[]).map((r) => r.shop.page.split("/")[3]);
  assert.deepEqual(await slugs(one.d), await slugs(two.d));
});

const privacy = (r: { headers: Headers }): void => {
  assert.equal(r.headers.get("set-cookie"), null, "the directory never sets a cookie");
  assert.equal(r.headers.get("referrer-policy"), "no-referrer");
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
};

test("the pages: a page for people in four languages, each state with a page of its own, the order page, the font, and never a cookie", { skip: SKIP }, async () => {
  const { d } = await market();
  const start = await d.call("/search");
  assert.equal(start.status, 200);
  privacy(start);
  assert.match(start.headers.get("content-type")!, /^text\/html; charset=utf-8/u);
  assert.equal(start.headers.get("x-robots-tag"), "noindex");
  assert.equal(start.headers.get("cache-control"), "no-store");
  const csp = start.headers.get("content-security-policy")!;
  assert.match(csp, /default-src 'none'/u);
  assert.match(csp, /form-action https:\/\/pages\.example\/search https:\/\/pages\.example\/search\/ask/u);
  const nonce = /script-src 'nonce-([A-Za-z0-9_-]+)'/u.exec(csp)![1];
  assert.ok(start.text.includes(`<script nonce="${nonce}">`), "the one script is by this response's nonce");
  assert.notEqual(/script-src 'nonce-([A-Za-z0-9_-]+)'/u.exec((await d.call("/search")).headers.get("content-security-policy")!)![1], nonce, "a new nonce each time");
  assert.equal(start.headers.get("permissions-policy"), "geolocation=(self), camera=(), microphone=(), payment=()");
  assert.match(start.text, /<html lang="en">/u);
  assert.ok(!start.text.includes('action="/search/ask"'), "no ask box without the assistant");
  const titles = new Set<string>();
  for (const lang of ["en", "hi", "ml", "kn"]) {
    const r = await d.call(`/search?lang=${lang}`);
    assert.match(r.text, new RegExp(`<html lang="${lang}">`, "u"));
    titles.add(/<h1>([^<]*)<\/h1>/u.exec(r.text)![1]);
  }
  assert.equal(titles.size, 4, "the heading is in each language");
  assert.match((await d.call("/search", { headers: { "accept-language": "ml-IN,en;q=0.8" } })).text, /<html lang="ml">/u);
  // results
  const res = await d.call("/search?q=kitten");
  assert.equal(res.status, 200);
  assert.ok(res.text.includes("Rani Pets") && res.text.includes("₹8,000") && res.text.includes("Persian kitten"));
  assert.ok(res.text.includes("https://pages.example/rani-pets/chat?about=l-3"));
  assert.ok(res.text.includes('<img src="https://pages.example/rani-pets/photo/ph-9.jpg"'), "a photo served from the pages domain is shown");
  // none, bad, escaping
  const none = await d.call("/search?q=zzzzzz");
  assert.equal(none.status, 200);
  assert.ok(none.text.includes('class="state-page card"'));
  const bad = await d.call("/search?q=kitten&category=weapons");
  assert.equal(bad.status, 400);
  assert.ok(bad.text.includes('role="alert"'));
  const xss = await d.call(`/search?${new URLSearchParams({ q: '"><script>alert(1)</script>' })}`);
  assert.ok(!xss.text.includes("<script>alert(1)</script>"));
  assert.ok(xss.text.includes("&quot;&gt;&lt;script&gt;"));
  // JSON when asked
  const j = await d.call("/search?q=kitten", { headers: { accept: "application/json" } });
  assert.match(j.headers.get("content-type")!, /^application\/json/u);
  assert.equal(j.headers.get("access-control-allow-origin"), "*");
  assert.equal(j.body.results.length, 1);
  assert.equal((await d.call("/search?q=kitten", { headers: { accept: "text/html,application/json" } })).headers.get("content-type")!.startsWith("text/html"), true);
  // the order page, the font, the card, health, anything else
  const order = await d.call("/order/");
  assert.equal(order.status, 200);
  privacy(order);
  assert.equal(order.headers.get("cache-control"), "public, max-age=300");
  assert.ok(order.text.includes('<ol class="order">'));
  assert.match((await d.call("/order?lang=hi")).text, /<html lang="hi">/u);
  const font = await d.call("/search/font.woff2");
  assert.equal(font.status, 200);
  assert.equal(font.headers.get("content-type"), "font/woff2");
  assert.match(font.headers.get("cache-control")!, /immutable/u);
  assert.equal((await d.call("/healthz")).text, "ok");
  const nowhere = await d.call("/nowhere");
  assert.equal(nowhere.status, 404);
  assert.equal(nowhere.text, "Not here");
  assert.equal((await d.call("/search/ask")).status, 404, "no assistant, no ask");
  assert.equal((await d.call("/search/ask", { form: { ask: "kitten" } })).status, 404);
});

/** A small independent reader of the spec's card signature (a JWS over the RFC 8785 form with `signatures` left out), so the check does not use the signing module under test. */
function cardSignatureOk(card: any, publicKeyDer: string): boolean {
  const { signatures, ...body } = card;
  const canon = (v: unknown): string => Array.isArray(v) ? `[${v.map(canon).join(",")}]` : v !== null && typeof v === "object" ? `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canon((v as any)[k])}`).join(",")}}` : JSON.stringify(v);
  const sig = signatures[0];
  const input = `${sig.protected}.${Buffer.from(canon(body)).toString("base64url")}`;
  const key = createPublicKey({ key: Buffer.from(publicKeyDer, "base64url"), format: "der", type: "spki" });
  return verify(null, Buffer.from(input), key, Buffer.from(sig.signature, "base64url"));
}

test("the Agent Card is the directory's own, signed with the key it keeps in its folder, and stays the same across a restart", { skip: SKIP }, async () => {
  const { d } = await market();
  const r = await d.call("/.well-known/agent-card.json");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("access-control-allow-origin"), "*");
  assert.equal(r.headers.get("cache-control"), "public, max-age=300");
  const card = r.body;
  assert.equal(card.name, "Directory of local shops");
  assert.deepEqual(card.supportedInterfaces.map((i: any) => [i.protocolBinding, i.url]), [["MCP", "https://pages.example/mcp"], ["HTTPS-JSON", "https://pages.example/search"]]);
  assert.equal(card.supportedInterfaces[0].protocolVersion, "2025-11-25");
  assert.deepEqual(card.skills.map((s: any) => s.id), ["search_listings", "get_listing", "shop_page"]);
  assert.deepEqual(card.provider, { organization: "Geometer", url: "https://pages.example" });
  assert.ok(!card.description.includes(" in Kerala"));
  const header = JSON.parse(Buffer.from(card.signatures[0].protected, "base64url").toString("utf8"));
  assert.deepEqual([header.alg, header.typ], ["EdDSA", "JOSE"]);
  // the key is in the folder (PKCS#8, base64url) and its id is the card's `kid`
  const { createPrivateKey } = await import("node:crypto");
  const priv = createPrivateKey({ key: Buffer.from((await import("./harness.ts")).readKey(d.dataDir), "base64url"), format: "der", type: "pkcs8" });
  const pub = createPublicKey(priv).export({ type: "spki", format: "der" }).toString("base64url");
  const { createHash } = await import("node:crypto");
  const rawKey = Buffer.from(pub, "base64url").subarray(-32);
  assert.equal(header.kid, createHash("sha256").update(rawKey).digest("base64url"));
  assert.ok(cardSignatureOk(card, pub), "the signature checks against the spec's own rule");
  await d.stop();
  await d.start();
  assert.equal((await d.call("/.well-known/agent-card.json")).body.signatures[0].protected, card.signatures[0].protected);
  const { body: _x, ...rest } = card; void rest;
});

test("the Agent Card names the area when the config does", { skip: SKIP }, async () => {
  const { d } = await up([fakeShop("any-shop")], { area: "Kerala" });
  assert.match((await d.call("/.well-known/agent-card.json")).body.description, /Finds what local shops have in Kerala:/u);
});

const rpc = (id: number | null, method: string, params?: unknown) => ({ jsonrpc: "2.0", ...(id === null ? {} : { id }), method, ...(params !== undefined ? { params } : {}) });

test("the MCP endpoint: initialize, the tools, search, one listing, one shop, and its refusals", { skip: SKIP }, async () => {
  const { d, rani } = await market();
  const post = (body: unknown, who?: string) => d.call("/mcp", { body, who });
  const init = await post(rpc(1, "initialize", { protocolVersion: "2025-06-18" }));
  assert.equal(init.status, 200);
  assert.equal(init.headers.get("access-control-allow-origin"), "*");
  assert.equal(init.body.result.protocolVersion, "2025-06-18");
  assert.equal(init.body.result.serverInfo.name, "geometer-directory");
  assert.equal(init.body.result.serverInfo.title, "Directory of local shops");
  assert.equal((await post(rpc(1, "initialize", { protocolVersion: "1999-01-01" }))).body.result.protocolVersion, "2025-11-25");
  assert.deepEqual((await post(rpc(2, "ping"))).body.result, {});
  const list = await post(rpc(3, "tools/list"));
  assert.deepEqual(list.body.result.tools.map((t: any) => t.name), ["search_listings", "get_listing", "shop_page"]);
  assert.ok(list.body.result.tools.every((t: any) => t.annotations.readOnlyHint === true));
  const call = (name: string, args: unknown) => post(rpc(4, "tools/call", { name, arguments: args }));
  const s = await call("search_listings", { q: "kitten", lang: "ml" });
  assert.equal(s.body.result.isError, false);
  assert.equal(s.body.result.structuredContent.results[0].item.title, "പേർഷ്യൻ പൂച്ചക്കുട്ടി");
  assert.equal(JSON.parse(s.body.result.content[0].text).format, "directory-search/1");
  const g = await call("get_listing", { shop: rani.page, id: "l-3", lang: "hi" });
  assert.equal(g.body.result.structuredContent.item.id, "l-3");
  assert.equal(g.body.result.structuredContent.checked, true);
  assert.equal(g.body.result.structuredContent.chat, `${rani.page}chat?about=l-3`);
  assert.deepEqual(Object.keys(g.body.result.structuredContent.item.title).sort(), ["en", "hi", "kn", "ml"]);
  const sp = await call("shop_page", { shop: rani.page });
  assert.equal(sp.body.result.structuredContent.shop.name, "Rani Pets");
  assert.equal(sp.body.result.structuredContent.listings[0].id, "l-3");
  const missing = await call("get_listing", { shop: rani.page, id: "nope" });
  assert.equal(missing.body.result.isError, true);
  assert.equal(missing.body.result.structuredContent.error.code, "not_found");
  assert.equal((await call("shop_page", { shop: "https://pages.example/nobody/" })).body.result.structuredContent.error.code, "not_found");
  assert.equal((await call("search_listings", { category: "weapons" })).body.result.structuredContent.error.code, "bad_request");
  // over MCP the language is the tool's own argument: an unknown one is a refusal there (the page, by contrast, falls back to the browser's language)
  assert.equal((await call("search_listings", { lang: "fr" })).body.result.structuredContent.error.code, "bad_request");
  assert.equal((await call("search_listings", { q: "kitten", radius_km: 5, lat: 10.5, lon: 76.2 })).body.result.structuredContent.results[0].shop.distanceKm, null, "a number is not a string: the point is ignored");
  assert.equal((await post(rpc(5, "tools/call", { name: "buy", arguments: {} }))).body.error.code, -32602);
  assert.equal((await post(rpc(6, "resources/list"))).body.error.code, -32601);
  assert.equal((await post({ jsonrpc: "1.0", id: 7, method: "ping" })).body.error.code, -32600);
  const note = await post(rpc(null, "notifications/initialized"));
  assert.equal(note.status, 202);
  assert.equal(note.text, "");
  const batch = await post([rpc(1, "ping"), rpc(null, "notifications/initialized"), rpc(2, "tools/list")]);
  assert.equal(batch.body.length, 2);
  assert.equal((await post([])).status, 400);
  assert.equal((await post(Array.from({ length: 21 }, (_, i) => rpc(i + 1, "ping")))).status, 400);
  assert.equal((await d.call("/mcp", { method: "GET" })).status, 405);
  assert.equal((await d.call("/mcp", { raw: "{" })).body.error.code, -32700);
  assert.equal((await d.call("/mcp", { raw: JSON.stringify({ pad: "x".repeat(17_000) }) })).body.error.code, -32700);
});

test("limits per address: 40 searches, 90 protocol calls, 120 page views a minute; another address is not affected", { skip: SKIP }, async () => {
  const { d } = await market();
  const who = d.visitor();
  const codes: number[] = [];
  for (let i = 0; i < 42; i++) codes.push((await d.call("/search?format=json&q=kitten", { who })).status);
  assert.deepEqual(codes.slice(0, 40), Array(40).fill(200));
  assert.deepEqual(codes.slice(40), [429, 429]);
  const stopped = await d.call("/search?format=json&q=kitten", { who });
  assert.equal(stopped.headers.get("retry-after"), "60");
  assert.match(stopped.body.error, /Too many searches/u);
  const page = await d.call("/search?q=kitten", { who });
  assert.equal(page.status, 429);
  assert.ok(page.text.includes('role="status"'), "the page says 'wait a minute' in its own state");
  assert.equal((await d.call("/search?format=json&q=kitten")).status, 200, "another visitor");
  // the MCP: tool calls count as searches (the same budget), the protocol's own messages have their own
  assert.equal((await d.call("/mcp", { who, body: rpc(1, "tools/call", { name: "search_listings", arguments: {} }) })).status, 429);
  const mcpWho = d.visitor();
  const pings: number[] = [];
  for (let i = 0; i < 92; i++) pings.push((await d.call("/mcp", { who: mcpWho, body: rpc(i + 1, "ping") })).status);
  assert.deepEqual([pings[89], pings[90], pings[91]], [200, 429, 429]);
  // the last address in X-Forwarded-For is the visitor (the door appends the real one)
  const forged = d.visitor();
  for (let i = 0; i < 40; i++) await d.call("/search?format=json", { who: `1.1.1.${i}, ${forged}` });
  assert.equal((await d.call("/search?format=json", { who: `9.9.9.9, ${forged}` })).status, 429);
  // pages
  const pageWho = d.visitor();
  let last = 0;
  for (let i = 0; i < 121; i++) last = (await d.call("/order", { who: pageWho })).status;
  assert.equal(last, 429);
  assert.equal((await d.call("/healthz", { who: pageWho })).status, 200, "the health check is never limited");
});
