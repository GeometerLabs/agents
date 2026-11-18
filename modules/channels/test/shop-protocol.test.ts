// The shop's side of the open protocol through the public front (block S phase B2), on a fake runtime that signs with the real protocol: "do you still have these?" at POST /api/v1/check and as the
// MCP tool check_items for every kind of shop (Bookings, Orders, Fees, Stock orders), counted per SHOP and not per address, read only and carrying nothing about the buyer; the shop's signed Agent
// Card at /agent-card.json only while the owner's switch is on; and the feed and the page that link to it. Written, not run, in the 18 Nov build stream: the lead's test pass runs it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { frontHandler } from "../front.ts";
import type { ChannelBackend } from "../backend.ts";
import type { PublicListingsRead } from "../../listings/kit.ts";
import { createShopProtocol } from "../../runtime/shop-protocol.ts";
import { generateSigningKey, verifyCard, verifyDocument } from "../../signing/index.ts";
import { FRONT_LIMITS } from "../limits.ts";

const PUBLIC = "https://partners.example/s/paws";
const NOW = Date.now();
const listing = (id: string, extra: Record<string, unknown> = {}) => ({
  id, state: "live" as const, category: "pets", ownerLang: "en" as const, words: { en: { title: "Persian kitten", text: "Two kittens." } },
  pricePaise: 800000, priceNote: "each", qty: 2, photos: [], createdMs: NOW, publishedMs: NOW, confirmedMs: NOW, by: "owner" as const, from: "app" as const, ...extra,
});
const SHOP = { name: "Paws & Co", address: "Main Road", timezone: "Asia/Kolkata", languages: ["en", "hi"], deposit: { amountInr: 0, holdMinutes: 10 }, cancellation: { windowHours: 0 }, payment: { kind: "link" }, paused: false };
const on: PublicListingsRead = { shop: { visible: true, town: "Thrissur" }, listings: [listing("l-1")] };
const off: PublicListingsRead = { shop: { visible: false }, listings: [listing("l-1")] };

type Kind = "bookings" | "orders" | "fees" | "stock";
function world(read: PublicListingsRead, kind: Kind = "bookings", withProtocol = true) {
  const key = generateSigningKey();
  const protocol = createShopProtocol({ read: () => read, key: () => key, now: () => Date.now(), name: () => SHOP.name });
  const asked: unknown[] = [];
  const backend = {
    offer: async () => ({ shop: SHOP, services: [] }), orderOffer: async () => ({ kind: "orders", shop: SHOP, items: [], days: [] }), feesOffer: async () => ({ kind: "fees", shop: SHOP }),
    submit: async () => "saved", view: async () => null, listings: async () => read,
    ...(withProtocol ? {
      shopFeed: async (q: Parameters<typeof protocol.feed>[0]) => protocol.feed(q),
      shopCheck: async (q: { page: string; ids: string[] }) => { asked.push(q); return protocol.check(q); },
      shopCard: async (q: { page: string; card: Record<string, unknown> }) => { const c = protocol.card(q); return c === "bad" ? null : c; },
    } : {}),
  } as unknown as ChannelBackend;
  return { backend, key, asked, kind };
}
async function serve<T>(w: ReturnType<typeof world>, run: (base: string) => Promise<T>): Promise<T> {
  const server = createServer(frontHandler({ shops: { paws: { publicUrl: PUBLIC, backend: w.backend, ...(w.kind !== "bookings" ? { kind: w.kind } : {}) } }, waitMs: 10 }));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try { return await run(`http://127.0.0.1:${(server.address() as { port: number }).port}/s/paws`); } finally { await new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }); }
}
const post = (url: string, body: unknown, headers: Record<string, string> = { "content-type": "application/json" }) => fetch(url, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });

test("POST /api/v1/check answers for every kind of shop: signed by the shop's key, from just now, gone for what it does not list, and the question reaches the runtime as ids only", async () => {
  for (const kind of ["bookings", "orders", "fees", "stock"] as const) {
    const w = world(on, kind);
    await serve(w, async (b) => {
      const r = await post(`${b}/api/v1/check`, { format: "shop-check/1", ids: ["l-1", "l-9"], search: "kitten near me", buyer: { name: "Asha", phone: "+919876543210" } });
      assert.equal(r.status, 200, kind);
      assert.equal(r.headers.get("cache-control"), "no-store");
      const a = await r.json() as { format: string; page: string; at: string; items: { id: string; availability: string; price?: { value: string } }[] };
      assert.equal(a.format, "shop-check/1");
      assert.equal(a.page, `${PUBLIC}/`);
      assert.ok(Math.abs(Date.parse(a.at) - Date.now()) < 5_000, "stamped with the time it was made");
      assert.deepEqual(a.items.map((i) => [i.id, i.availability]), [["l-1", "in_stock"], ["l-9", "gone"]], kind);
      assert.equal(a.items[0].price?.value, "8000.00");
      assert.ok(verifyDocument(a, w.key.publicKey).ok, `${kind}: signed with the shop's key`);
      assert.deepEqual(w.asked, [{ page: PUBLIC, ids: ["l-1", "l-9"] }], "only the page and the ids reach the runtime: nothing about the buyer");
    });
  }
});

test("a Fees centre and a Stock orders shop answer /api/v1/check and nothing else under /api, and have no MCP endpoint", async () => {
  for (const kind of ["fees", "stock"] as const) {
    await serve(world(on, kind), async (b) => {
      assert.equal((await post(`${b}/api/v1/check`, { ids: ["l-1"] })).status, 200);
      assert.equal((await fetch(`${b}/api/v1/services`)).status, 404, `${kind}: no booking API`);
      assert.equal((await fetch(`${b}/api/v1/check`)).status, 404, `${kind}: GET is not the check`);
      assert.equal((await post(`${b}/mcp`, { jsonrpc: "2.0", id: 1, method: "tools/list" })).status, 404, `${kind}: no MCP`);
    });
  }
});

test("a bad question is refused with a reason: more than ten ids, none, not JSON, not a list", async () => {
  await serve(world(on), async (b) => {
    const ids = Array.from({ length: 11 }, (_, i) => `l-${i}`);
    for (const body of [{ ids }, { ids: [] }, {}, { ids: "l-1" }, { ids: ["../etc"] }, { format: "shop-check/2", ids: ["l-1"] }]) {
      const r = await post(`${b}/api/v1/check`, body);
      assert.equal(r.status, 400, JSON.stringify(body).slice(0, 40));
      assert.equal(((await r.json()) as { error: { code: string } }).error.code, "bad_request");
    }
    assert.equal((await post(`${b}/api/v1/check`, "ids=l-1", { "content-type": "text/plain" })).status, 415);
    assert.equal((await post(`${b}/api/v1/check`, "{not json")).status, 400);
    assert.equal((await post(`${b}/api/v1/check`, { ids: Array.from({ length: 10 }, (_, i) => `l-${i}`) })).status, 200, "ten is allowed");
  });
});

test("a check is counted per shop, about 600 a minute, and not against the address's own page and read limits (a directory asks every shop from one address)", async () => {
  await serve(world(on), async (b) => {
    // more than the per-address read limit (120 a minute): every one answers
    for (let i = 0; i < 130; i++) assert.equal((await post(`${b}/api/v1/check`, { ids: ["l-1"] })).status, 200, `check ${i}`);
    // the page's own reads from the same address are still allowed
    assert.equal((await fetch(`${b}/api/v1`)).status, 200);
    // up to the shop's own limit, then it says wait
    for (let i = 130; i < FRONT_LIMITS.check.max; i++) await post(`${b}/api/v1/check`, { ids: ["l-1"] });
    const over = await post(`${b}/api/v1/check`, { ids: ["l-1"] });
    assert.equal(over.status, 429);
    assert.equal(((await over.json()) as { error: { code: string } }).error.code, "too_many");
  });
});

test("a shop whose runtime cannot sign, or that shows no listings, says so (503); nothing unsigned is ever sent in its place", async () => {
  await serve(world(on, "bookings", false), async (b) => {
    const r = await post(`${b}/api/v1/check`, { ids: ["l-1"] });
    assert.equal(r.status, 503);
    assert.equal(((await r.json()) as { error: { code: string } }).error.code, "unavailable");
    assert.equal((await fetch(`${b}/listings.json`)).status, 404, "no signed feed means no feed");
    assert.equal((await fetch(`${b}/agent-card.json`)).status, 404);
  });
});

test("with the switch off a check answers every id gone (signed), and there is no feed and no card", async () => {
  const w = world(off);
  await serve(w, async (b) => {
    const a = await (await post(`${b}/api/v1/check`, { ids: ["l-1"] })).json() as { items: { availability: string }[] };
    assert.deepEqual(a.items.map((i) => i.availability), ["gone"]);
    assert.ok(verifyDocument(a, w.key.publicKey).ok);
    assert.equal((await fetch(`${b}/listings.json`)).status, 404);
    assert.equal((await fetch(`${b}/agent-card.json`)).status, 404);
    assert.ok(!(await (await fetch(`${b}/shop`)).text()).includes("agent-card.json"), "the page links to no card while it shows nothing");
  });
});

test("the MCP tool check_items is the same operation: read only, signed, and the limit is the shop's (Bookings and Orders)", async () => {
  for (const kind of ["bookings", "orders"] as const) {
    const w = world(on, kind);
    await serve(w, async (b) => {
      const list = await (await post(`${b}/mcp`, { jsonrpc: "2.0", id: 1, method: "tools/list" })).json() as { result: { tools: { name: string; annotations: { readOnlyHint: boolean }; inputSchema: object }[] } };
      const tool = list.result.tools.find((t) => t.name === "check_items")!;
      assert.ok(tool, kind);
      assert.equal(tool.annotations.readOnlyHint, true);
      assert.ok(!JSON.stringify(tool.inputSchema).includes("price"));
      const call = await (await post(`${b}/mcp`, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "check_items", arguments: { ids: ["l-1", "l-2"] } } })).json() as { result: { isError: boolean; structuredContent: { items: { id: string; availability: string }[] } } };
      assert.equal(call.result.isError, false);
      assert.deepEqual(call.result.structuredContent.items.map((i) => [i.id, i.availability]), [["l-1", "in_stock"], ["l-2", "gone"]]);
      assert.ok(verifyDocument(call.result.structuredContent, w.key.publicKey).ok);
      const bad = await (await post(`${b}/mcp`, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "check_items", arguments: { ids: [] } } })).json() as { result: { isError: boolean } };
      assert.equal(bad.result.isError, true);
      // the API's own index lists it too
      const index = await (await fetch(`${b}/api/v1`)).json() as { operations: { name: string; method: string; path: string }[] };
      assert.deepEqual(index.operations.find((o) => o.name === "check_items"), { name: "check_items", method: "POST", path: "/api/v1/check" });
    });
  }
});

test("the Agent Card: signed with the shop's key, A2A field names, only the interfaces this kind of shop serves, the shop's own skills, and the page and feed link to it", async () => {
  for (const kind of ["bookings", "orders", "fees", "stock"] as const) {
    const w = world(on, kind);
    await serve(w, async (b) => {
      const r = await fetch(`${b}/agent-card.json`);
      assert.equal(r.status, 200, kind);
      assert.equal(r.headers.get("access-control-allow-origin"), "*");
      assert.equal((await fetch(`${b}/agent-card.json`, { method: "HEAD" })).status, 200);
      const card = await r.json() as any;
      assert.ok(verifyCard(card, w.key.publicKey), `${kind}: signed`);
      for (const f of ["name", "description", "supportedInterfaces", "provider", "version", "capabilities", "defaultInputModes", "defaultOutputModes", "skills", "signatures"]) assert.ok(card[f] !== undefined, `${kind}.${f}`);
      assert.equal(card.name, "Paws & Co");
      assert.deepEqual(card.provider, { organization: "Paws & Co", url: `${PUBLIC}/` });
      const bindings = card.supportedInterfaces.map((i: any) => [i.url, i.protocolBinding]);
      const mcp = kind === "bookings" || kind === "orders";
      assert.deepEqual(bindings, [...(mcp ? [[`${PUBLIC}/mcp`, "MCP"]] : []), [`${PUBLIC}/api/v1`, "HTTPS-JSON"]], kind);
      assert.ok(!/JSONRPC|GRPC|HTTP\+JSON/u.test(JSON.stringify(card)), "no A2A message endpoint is claimed");
      const ids = card.skills.map((s: any) => s.id);
      assert.deepEqual(ids.slice(0, 2), ["show_listings", "check_items"]);
      assert.equal(ids.filter((i: string) => i === "check_items").length, 1);
      if (kind === "bookings") assert.ok(ids.includes("start_booking") && ids.includes("list_services"));
      if (kind === "orders") assert.ok(ids.includes("start_order") && ids.includes("list_items"));
      if (!mcp) assert.deepEqual(ids, ["show_listings", "check_items"]);
      for (const s of card.skills) { assert.deepEqual(s.inputModes, ["application/json"]); assert.ok(s.examples.length >= 1 && s.tags.length >= 1, s.id); }
      // the card's own words never claim what the shop does not do
      assert.ok(!/guaranteed|verified|certified|safe\b/iu.test(JSON.stringify(card)));
      const feed = await (await fetch(`${b}/listings.json`)).json() as { shop: { agentCard: string; check: string } };
      assert.equal(feed.shop.agentCard, `${PUBLIC}/agent-card.json`);
      assert.equal(feed.shop.check, `${PUBLIC}/api/v1/check`);
      assert.match(await (await fetch(`${b}/shop`)).text(), /<link rel="alternate" type="application\/json" title="A2A Agent Card" href="https:\/\/partners\.example\/s\/paws\/agent-card\.json">/u);
    });
  }
});

test("a card is a read: other methods are refused and a reader's If-None-Match gets 304", async () => {
  await serve(world(on), async (b) => {
    assert.equal((await post(`${b}/agent-card.json`, {})).status, 405);
    const r = await fetch(`${b}/agent-card.json`);
    const etag = r.headers.get("etag")!;
    assert.ok(etag);
    assert.equal((await fetch(`${b}/agent-card.json`, { headers: { "if-none-match": etag } })).status, 304);
  });
});
