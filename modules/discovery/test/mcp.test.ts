// The directory's MCP endpoint (search_listings, get_listing, shop_page) and its A2A Agent Card: the tools are read-only and follow the same JSON-RPC handling as a shop's
// endpoint, a refusal is a tool result with isError, and the card has the A2A 1.0.1 field names, says only what is served, and is signed. Written 18 Nov 2026.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DirectoryIndex } from "../index.ts";
import { ingestFeed } from "../ingest.ts";
import { createChecker } from "../check.ts";
import { DIRECTORY_TOOLS, DIRECTORY_TOOL_NAMES, directoryServer } from "../mcp.ts";
import { directoryCard } from "../card.ts";
import { serverPost } from "../../channels/mcp.ts";
import { generateSigningKey } from "../../signing/keys.ts";
import { verifyCard } from "../../signing/jws.ts";
import type { Fetcher } from "../types.ts";
import { NOW, item, shop } from "./fixtures.ts";

const ORIGIN = "https://pages.example";

function setup(answers: "in_stock" | "gone" | "silent" = "in_stock") {
  const index = new DirectoryIndex(":memory:");
  const s = shop("rani-pets", { lat: "10.527642" });
  index.addFeed(s.feedUrl, "config", NOW);
  ingestFeed(index, s.feedUrl, JSON.stringify(s.feed([item(s.page, "l-3"), item(s.page, "l-4", { title: { en: "Labrador puppy" }, text: {} })])), null, NOW);
  const asked: string[] = [];
  const fetch: Fetcher = async (_url, init) => {
    asked.push(init.body ?? "");
    if (answers === "silent") throw new Error("down");
    const ids = (JSON.parse(init.body ?? "{}") as { ids: string[] }).ids;
    return { status: 200, headers: {}, body: JSON.stringify(s.answer(ids.map((id) => answers === "gone" ? { id, availability: "gone" as const } : { id, availability: "in_stock" as const, price: { value: "7000.00", currency: "INR" as const } }))) };
  };
  const deps = { index, checker: createChecker({ fetch, now: () => NOW, timeoutMs: 50 }), origin: ORIGIN, now: () => NOW };
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await serverPost(directoryServer(deps), { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
    return (r.body as { result: { structuredContent: any; isError: boolean; content: { text: string }[] } }).result;
  };
  return { s, deps, call, asked };
}

test("the handshake and the tool list: three read-only tools with schemas, in the same style as a shop's endpoint", async () => {
  const { deps } = setup();
  const server = directoryServer(deps);
  const init = await serverPost(server, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
  const result = (init.body as { result: { protocolVersion: string; serverInfo: { name: string }; instructions: string } }).result;
  assert.equal(result.protocolVersion, "2025-06-18");
  assert.equal(result.serverInfo.name, "geometer-directory");
  assert.match(result.instructions, /fair order that no payment can change/u);
  const list = await serverPost(server, { jsonrpc: "2.0", id: 2, method: "tools/list" });
  const tools = (list.body as { result: { tools: { name: string; inputSchema: { type: string }; annotations: { readOnlyHint: boolean } }[] } }).result.tools;
  assert.deepEqual(tools.map((t) => t.name), ["search_listings", "get_listing", "shop_page"]);
  assert.deepEqual(DIRECTORY_TOOL_NAMES, tools.map((t) => t.name));
  for (const t of tools) assert.deepEqual([t.inputSchema.type, t.annotations.readOnlyHint], ["object", true], t.name);
  assert.equal((await serverPost(server, { jsonrpc: "2.0", method: "notifications/initialized" })).status, 202);
  assert.equal(DIRECTORY_TOOLS.length, 3);
});

test("search_listings: the same results as the page, confirmed by the shop; the shop is asked about ids only", async () => {
  const { call, asked, s } = setup();
  const r = await call("search_listings", { q: "persian kitten", lang: "ml" });
  assert.equal(r.isError, false);
  assert.equal(r.structuredContent.format, "directory-search/1");
  assert.deepEqual(r.structuredContent.results.map((x: any) => [x.item.id, x.checked, x.item.price.value]), [["l-3", true, "7000.00"]]);
  assert.equal(r.structuredContent.results[0].item.title, "പേർഷ്യൻ പൂച്ചക്കുട്ടി");
  assert.equal(r.structuredContent.results[0].chat, `${s.page}chat?about=l-3`);
  assert.deepEqual(asked.map((b) => JSON.parse(b)), [{ format: "shop-check/1", ids: ["l-3"] }]);
  const bad = await call("search_listings", { category: "guns" });
  assert.equal(bad.isError, true);
  assert.match(bad.content[0].text, /bad_request: category must be one of/u);
});

test("get_listing: all the listing's words, the shop's own confirmation, and 'gone' is a refusal; an unknown shop or id is not_found", async () => {
  const ok = setup();
  const r = await ok.call("get_listing", { shop: ok.s.page, id: "l-3" });
  assert.equal(r.isError, false);
  assert.deepEqual([r.structuredContent.checked, r.structuredContent.item.availability, r.structuredContent.item.price.value], [true, "in_stock", "7000.00"]);
  assert.equal(r.structuredContent.item.title.hi, "फ़ारसी बिल्ली का बच्चा");
  assert.deepEqual(r.structuredContent.item.machineWritten, ["en", "hi", "kn"]);
  assert.equal((await ok.call("get_listing", { shop: ok.s.page, id: "nope" })).isError, true);
  assert.match((await ok.call("get_listing", { shop: "https://pages.example/other/", id: "l-3" })).content[0].text, /not_found/u);
  const gone = setup("gone");
  assert.match((await gone.call("get_listing", { shop: gone.s.page, id: "l-3" })).content[0].text, /not_found: The shop says this listing is gone/u);
  const quiet = setup("silent");
  const q = await quiet.call("get_listing", { shop: quiet.s.page, id: "l-3" });
  assert.deepEqual([q.structuredContent.checked, q.structuredContent.item.availability, q.structuredContent.item.price.value], [false, "call_to_check", "8000.00"]);
});

test("shop_page: the shop and its listings, the registration only as the owner's word; a held shop is not found", async () => {
  const { call, s, deps } = setup();
  const r = await call("shop_page", { shop: s.page, lang: "hi" });
  assert.equal(r.structuredContent.shop.name, "rani-pets");
  assert.equal(r.structuredContent.shop.chat, `${s.page}chat`);
  assert.deepEqual(r.structuredContent.listings.map((l: any) => l.id), ["l-3", "l-4"]);
  assert.equal(r.structuredContent.listings[0].title, "फ़ारसी बिल्ली का बच्चा");
  deps.index.hold(s.page, s.key.keyId, { keyId: "x".repeat(43), key: "k" }, NOW);
  assert.equal((await call("shop_page", { shop: s.page })).isError, true);
  assert.equal((await call("search_listings", { q: "kitten" })).structuredContent.results.length, 0);
});

test("an unknown tool is a protocol error, and a batch works like a shop's endpoint", async () => {
  const { deps } = setup();
  const server = directoryServer(deps);
  const bad = await serverPost(server, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "buy_listing", arguments: {} } });
  assert.equal((bad.body as { error: { code: number } }).error.code, -32602);
  const batch = await serverPost(server, [{ jsonrpc: "2.0", id: 1, method: "ping" }, { jsonrpc: "2.0", id: 2, method: "tools/list" }]);
  assert.equal((batch.body as unknown[]).length, 2);
});

test("the Agent Card: A2A 1.0.1 field names, only the interfaces that are served, JSON in and out, three skills, and a valid signature", () => {
  const key = generateSigningKey();
  const card = directoryCard({ origin: ORIGIN, provider: { organization: "Geometer", url: ORIGIN }, area: "Kerala", key }) as any;
  for (const field of ["name", "description", "supportedInterfaces", "provider", "version", "capabilities", "defaultInputModes", "defaultOutputModes", "skills", "signatures"]) assert.ok(card[field] !== undefined, field);
  assert.deepEqual(card.supportedInterfaces.map((i: any) => [i.url, i.protocolBinding, typeof i.protocolVersion]), [[`${ORIGIN}/mcp`, "MCP", "string"], [`${ORIGIN}/search`, "HTTPS-JSON", "string"]]);
  assert.ok(!JSON.stringify(card).match(/JSONRPC|GRPC|HTTP\+JSON/u), "no A2A message endpoint is claimed");
  assert.deepEqual(card.skills.map((s: any) => s.id), ["search_listings", "get_listing", "shop_page"]);
  for (const s of card.skills) for (const f of ["id", "name", "description", "tags"]) assert.ok(Array.isArray(s[f]) ? s[f].length > 0 : String(s[f]).length > 0, `${s.id}.${f}`);
  assert.deepEqual(card.defaultInputModes, ["application/json"]);
  assert.ok(card.description.includes("Kerala") && card.description.includes("never by payment"));
  // section 8.4.1: no member that only holds a default value (an empty list or an empty string) except the required ones
  const empties: string[] = [];
  const walk = (v: unknown, path: string) => { if (Array.isArray(v)) { if (v.length === 0) empties.push(path); v.forEach((x, i) => walk(x, `${path}[${i}]`)); } else if (v && typeof v === "object") Object.entries(v).forEach(([k, x]) => walk(x, `${path}.${k}`)); else if (v === "") empties.push(path); };
  walk(card, "card");
  assert.deepEqual(empties, []);
  assert.ok(verifyCard(card, key.publicKey));
  assert.ok(!verifyCard({ ...card, description: "x" }, key.publicKey));
  assert.equal(JSON.parse(Buffer.from(card.signatures[0].protected, "base64url").toString()).kid, key.keyId);
});
