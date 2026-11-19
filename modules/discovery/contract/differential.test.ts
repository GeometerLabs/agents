// The two services given the SAME requests over the SAME shops, answers compared: the search in four languages and Latin letters, every filter and refusal, every page state in four
// languages (the whole HTML, the response's nonce aside), the order page, the MCP endpoint, the notices, the assistant's answers to scripted model replies, and the headers that matter. A
// difference here is a difference a buyer, an assistant or a shop could see. Needs the Go binary (skipped, with the reason, when there is none).
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { GO_BIN, directoryWith, fakeShop, item, startFakeModel, typed, until } from "./harness.ts";
import type { Directory, FakeDoor, FakeModel } from "./harness.ts";

const SKIP_BOTH = existsSync(GO_BIN) ? false : `there is no Go binary at ${GO_BIN} (build it: cd go && go build -o bin/directory ./cmd/directory)`;
const closers: (() => Promise<void>)[] = [];
after(async () => { for (const c of closers) await c(); });

const KEPT = ["content-type", "cache-control", "x-robots-tag", "access-control-allow-origin", "permissions-policy", "retry-after", "allow", "referrer-policy", "x-content-type-options", "content-security-policy"];
async function pair(): Promise<{ ts: Directory; go: Directory; door: FakeDoor; model: FakeModel }> {
  const a = fakeShop("rani-pets", { name: "Rani Pets", town: "Thrissur", lat: "10.527642" });
  a.items = [item(a.page, "l-3"), item(a.page, "l-4", { title: { en: "Persian cat toy <b>&</b>" }, text: {}, price: { value: "1234567.50", currency: "INR" }, quantity: 1000 }), item(a.page, "l-5", { price: null, availability: "call_to_check", photos: [] })];
  const b = fakeShop("kochi-cycles", { name: "Kochi \"Cycles\" & Co", town: "Kochi", lat: "9.9312", lon: "76.2673" });
  b.items = [item(b.page, "b-1", { category: "vehicles_and_cycles", title: { en: "Second-hand bicycle", hi: "पुरानी साइकिल", ml: "പഴയ സൈക്കിൾ", kn: "ಹಳೆಯ ಸೈಕಲ್" }, text: {}, machineWritten: [], ownerLanguage: "en", price: { value: "3000.00", currency: "INR" } })];
  const model = await startFakeModel([typed({ words: ["kitten"], words_en: ["kitten"], category: "pets", place: "town", town: "Thrissur" })]);
  const first = await directoryWith([a, b], { assistant: { model } });
  const second = await directoryWith([a, b], { door: first.door, assistant: { model } });
  second.d.stop; // both start from the same fake door and shops
  closers.push(() => first.door.close(), () => model.close());
  return { ts: first.d, go: second.d, door: first.door, model };
}

const norm = (r: { status: number; text: string; headers: Headers }): unknown => {
  const csp = r.headers.get("content-security-policy") ?? "";
  const nonce = /'nonce-([A-Za-z0-9_-]+)'/u.exec(csp)?.[1];
  const headers: Record<string, string | null> = {};
  for (const k of KEPT) headers[k] = r.headers.get(k)?.replace(nonce ?? "\u0000", "NONCE") ?? null;
  let body: unknown = nonce ? r.text.replaceAll(nonce, "NONCE") : r.text;
  const type = r.headers.get("content-type") ?? "";
  if (type.startsWith("application/json")) { try { body = JSON.parse(r.text); } catch { /* keep the text */ } }
  return { status: r.status, headers, body };
};

test("the same requests, the same answers", { skip: SKIP_BOTH }, async () => {
  const { ts, go } = await pair();
  // the Go one is started by directoryWith as the harness's default implementation; make it Go explicitly
  await go.stop(); await go.start("go");
  await until("go to have read the shops", async () => ((await go.searchJson({ q: "kitten" })).body.results?.length ?? 0) > 0);
  const compare = async (what: string, path: string, o: Parameters<Directory["call"]>[1] = {}) => {
    const who = ts.visitor();
    const [x, y] = [await ts.call(path, { ...o, who }), await go.call(path, { ...o, who })];
    assert.deepEqual(norm(y), norm(x), `${what}: ${path}`);
  };
  const qs = ["kitten", "persian", "പൂച്ച", "ಬೆಕ್ಕಿನ", "बिल्ली", "billi", "poocha", "bekku", "bicycle", "साइकिल", "pets", "kitten thrissur", "bicycle thrissur", "nothing-here", "kitten near me", "%E0%B4%AA%E0%B5%82%E0%B4%9A%E0%B5%8D%E0%B4%9A", "a+b", "<script>"];
  for (const lang of ["", "&lang=hi", "&lang=ml", "&lang=kn"]) for (const q of qs) {
    await compare("json", `/search?format=json&q=${q}${lang}`);
    await compare("page", `/search?q=${q}${lang}`);
  }
  for (const extra of ["&lat=10.52&lon=76.21", "&lat=10.52&lon=76.21&radius_km=10", "&town=Kochi", "&town=%E0%B4%A4%E0%B5%83%E0%B4%B6%E0%B5%8D%E0%B4%B6%E0%B5%82%E0%B5%BC", "&category=pets", "&category=weapons", "&lat=10", "&radius_km=0", "&offset=10", "&offset=5", "&lat=1e1&lon=2", "&lang=fr"]) {
    await compare("filters json", `/search?format=json&q=kitten${extra}`);
    await compare("filters page", `/search?q=kitten${extra}`);
  }
  for (const path of ["/search", "/search?lang=hi", "/search?lang=ml", "/search?lang=kn", "/search?category=pets", "/order", "/order/", "/order?lang=hi", "/order?lang=ml", "/order?lang=kn", "/healthz", "/nowhere", "/search/ask", "/feed-changed", "/mcp", "/search/../order", "/search%2Fx", "/.well-known/agent-card.json"]) {
    if (path === "/.well-known/agent-card.json") {
      const [x, y] = [await ts.call(path), await go.call(path)];
      const { signatures: _a, ...bx } = x.body, { signatures: _b, ...by } = y.body;
      assert.deepEqual(by, bx, "the card's body");
      assert.equal(y.body.signatures[0].protected.length > 0, true);
      continue;
    }
    await compare("page", path);
  }
  await compare("accept json", "/search?q=kitten", { headers: { accept: "application/json" } });
  await compare("accept both", "/search?q=kitten", { headers: { accept: "text/html,application/json" } });
  await compare("accept-language", "/search", { headers: { "accept-language": "kn-IN, en;q=0.5" } });
  for (const body of [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }, { jsonrpc: "2.0", id: "a", method: "tools/list" },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "search_listings", arguments: { q: "kitten", lang: "hi" } } },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_listing", arguments: { shop: "https://pages.example/rani-pets/", id: "l-4" } } },
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "shop_page", arguments: { shop: "https://pages.example/rani-pets/", lang: "ml" } } },
    { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "get_listing", arguments: { shop: "https://pages.example/rani-pets/", id: "nope" } } },
    { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "ask", arguments: { question: "kitten near Thrissur" } } },
    { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: 5 } }, { jsonrpc: "2.0", id: 8, method: "nope" }, { jsonrpc: "1.0", id: 9, method: "ping" }, { id: 10 }, null, 5, [], [{ jsonrpc: "2.0", id: 1, method: "ping" }, { jsonrpc: "2.0", method: "notifications/initialized" }],
  ]) await compare("mcp", "/mcp", { body });
  // notices: refused ones answer the same
  const shop = fakeShop("rani-pets");
  for (const body of [{}, [], { format: "shop-feed-changed/1" }, shop.notice({ feed: "https://other.example/x/listings.json" }), shop.notice({ feed: "https://pages.example/x/other.json" })]) await compare("notice", "/feed-changed", { body });
  // the assistant over a form: the page and the JSON
  for (const lang of ["en", "hi", "ml", "kn"]) {
    for (const accept of ["application/json", "text/html"]) await compare("ask", "/search/ask", { form: { ask: "Persian kitten near Thrissur?", lang }, headers: { accept, origin: "https://pages.example" } });
  }
  await compare("ask, empty", "/search/ask", { form: { ask: " " }, headers: { origin: "https://pages.example" } });
  await compare("ask, other site", "/search/ask", { form: { ask: "kitten" }, headers: { origin: "https://evil.example" } });
});
