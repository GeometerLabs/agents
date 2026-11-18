// The public front for a listings-only shop (kind "listings", 18 Nov 2026): its own address and its QR code open the storefront ("What we have"), the storefront and the open feed
// are served, the chat is not (no agent answers it, and no page points at it), the customer-side routes of other kinds are not there, and the owner's page still is.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { frontHandler } from "../front.ts";
import type { ChannelBackend, OwnerView } from "../backend.ts";
import type { PublicListingsRead } from "../../listings/kit.ts";

const PUBLIC = "https://partners.example/s/sree-pets";
const NOW = Date.now();
const read: PublicListingsRead = {
  shop: { visible: true, town: "Thrissur" },
  listings: [{ id: "l-1", state: "live", category: "pets", ownerLang: "en", words: { en: { title: "Persian kitten", text: "Two kittens." } }, pricePaise: 800000, photos: [], createdMs: NOW, publishedMs: NOW, confirmedMs: NOW, by: "owner", from: "app" } as never],
};
const VIEW: OwnerView = { shop: { name: "Sree Pets", timezone: "Asia/Kolkata", ownerLanguage: "en" }, kind: "listings", services: [], items: [], upcoming: [] };
const backend = {
  offer: async () => ({ kind: "listings", shop: { name: "Sree Pets", timezone: "Asia/Kolkata", languages: ["en", "ml"], address: "Thrissur", paused: false } }),
  feesOffer: undefined,
  submit: async () => "saved", view: async () => null, owner: async () => VIEW, listings: async () => read, listingPhoto: async () => null,
  chat: async () => ({ lines: [], answered: false, capped: false, retentionDays: 30 }), // a backend that HAS a chat: the front must still not offer it for this kind
} as unknown as ChannelBackend;

async function serve<T>(run: (base: string) => Promise<T>): Promise<T> {
  const server = createServer(frontHandler({ shops: { "sree-pets": { publicUrl: PUBLIC, backend, kind: "listings" } }, waitMs: 10 }));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try { return await run(`http://127.0.0.1:${(server.address() as { port: number }).port}/s/sree-pets`); } finally { await new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }); }
}

test("the shop's own address goes to its storefront, which is served with its feed", async () => {
  await serve(async (b) => {
    const root = await fetch(`${b}/`, { redirect: "manual" });
    assert.ok([301, 302, 303, 307].includes(root.status), `a redirect, got ${root.status}`);
    assert.equal(root.headers.get("location"), `${PUBLIC}/shop`);
    const page = await fetch(`${b}/shop`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Persian kitten/u);
    const feed = await fetch(`${b}/listings.json`);
    assert.equal(feed.status, 200);
    const j = await feed.json() as { format: string; shop: { languages?: string[] } };
    assert.equal(j.format, "shop-feed/1");
  });
});

test("no chat is offered or served, and no customer-side route of another kind is there", async () => {
  await serve(async (b) => {
    for (const path of ["/chat", "/chat/font.woff2", "/api/v1/services", "/mcp", "/book", "/menu"]) assert.equal((await fetch(`${b}${path}`)).status, 404, path);
    const text = await (await fetch(`${b}/shop`)).text();
    assert.ok(!text.includes("/chat"), "no page points at the chat; 'Ask about this' is not drawn");
  });
});

test("the owner's page is still there (it asks for the owner's credential, as for any shop)", async () => {
  await serve(async (b) => {
    const r = await fetch(`${b}/owner`, { redirect: "manual" });
    assert.notEqual(r.status, 404, "the owner's way in is served for a listings-only shop");
  });
});
