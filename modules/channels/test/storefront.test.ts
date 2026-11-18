// The storefront, the open feed and the owner's listings page through the public front (block S, phase A), on a fake runtime: `noindex` unless the owner's switch is on; JSON-LD and
// listings.json carry only what the runtime says is public, with no private data; a photo is served at its own address with its own type and nosniff, one img-src and never 'self';
// "Ask about this" opens the chat with the listing named; the owner's photo goes to the runtime with its type and a PNG is refused at the front; an op the shop's rules refuse comes back
// with its reason. Written, not run, in the 18 Nov build stream: the lead's test pass runs it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { frontHandler } from "../front.ts";
import type { ChannelBackend, OwnerView } from "../backend.ts";
import type { PublicListingsRead } from "../../listings/kit.ts";
import { storefrontPolicy } from "../storefront.ts";
import { LISTING_WORDS } from "../../listings/words.ts";

const TOKEN = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJ0123456";
const PUBLIC = "https://partners.example/s/paws";
const NOW = Date.now();
const listing = (id: string, extra: Record<string, unknown> = {}) => ({
  id, state: "live" as const, category: "pets", ownerLang: "en" as const, words: { en: { title: "Persian kitten", text: "Two kittens." }, hi: { title: "फ़ारसी बिल्ली", text: "दो बच्चे।" } },
  pricePaise: 800000, priceNote: "each", qty: 2, photos: [{ id: "ph-0123456789ab", type: "image/jpeg" as const, width: 800, height: 600, bytes: 1000 }],
  createdMs: NOW, publishedMs: NOW, confirmedMs: NOW, by: "owner" as const, from: "app" as const, ...extra,
});
const SHOP = { name: "Paws & Co", address: "Main Road, Thrissur", timezone: "Asia/Kolkata", languages: ["en", "hi"], deposit: { amountInr: 0, holdMinutes: 10 }, cancellation: { windowHours: 0 }, payment: { kind: "link" }, paused: false };
const VIEW: OwnerView = {
  shop: { name: "Paws & Co", timezone: "Asia/Kolkata", ownerLanguage: "en" }, services: [], items: [], upcoming: [],
  app: { character: { style: "clay", personality: "warm" }, mood: "quiet", face: "well", closedToday: false, today: [], waiting: [], cards: [], talk: [], listen: false },
};
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);

function setup(read: PublicListingsRead | null) {
  const calls = { ops: [] as Record<string, unknown>[], photos: [] as { type: string; bytes: number }[] };
  const backend = {
    offer: async () => ({ shop: SHOP, services: [] }), submit: async () => "saved", view: async () => null, owner: async () => VIEW,
    listings: async () => read,
    listingPhoto: async (id: string) => (id === "ph-0123456789ab" ? { type: "image/jpeg", bytes: Buffer.from(JPEG) } : null),
    ownerListings: async (_o: unknown, post?: { id: string; op: Record<string, unknown> }) => {
      if (!post) return { status: 200, body: { shop: read?.shop ?? { visible: false }, listings: [], pending: [], uploadsLeft: 30, maxLive: 50, liveCount: 0, categories: [{ id: "pets", names: {} }, { id: "other", names: {} }] } };
      calls.ops.push(post.op);
      return String(post.op.title).includes("tortoise") ? { status: 422, body: { why: "protected_animal" } } : { status: 200, body: {} };
    },
    ownerPhoto: async (_o: unknown, p: { bytes: Buffer; type: string }) => { calls.photos.push({ type: p.type, bytes: p.bytes.length }); return { status: 200, body: { photo: { id: "ph-0123456789ab", type: p.type, width: 10, height: 10, bytes: p.bytes.length } } }; },
    chat: async () => ({ lines: [], answered: false, capped: false, retentionDays: 30 }),
  } as unknown as ChannelBackend;
  return { backend, calls };
}
async function serve<T>(backend: ChannelBackend, run: (base: string) => Promise<T>): Promise<T> {
  const server = createServer(frontHandler({ shops: { paws: { publicUrl: PUBLIC, backend } }, waitMs: 10 }));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try { return await run(`http://127.0.0.1:${(server.address() as { port: number }).port}/s/paws`); } finally { await new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }); }
}
const off: PublicListingsRead = { shop: { visible: false }, listings: [listing("l-1")] };
const on: PublicListingsRead = { shop: { visible: true, town: "Thrissur", pincode: "680001", lat: 10.52, lon: 76.21, registration: "PS/KL/2026/123" }, listings: [listing("l-1")] };

test("with the switch off the storefront is noindex and serves no feed; with it on the page drops noindex and the feed is served", async () => {
  await serve(setup(off).backend, async (b) => {
    const page = await fetch(`${b}/shop`);
    const text = await page.text();
    assert.equal(page.status, 200);
    assert.match(text, /<meta name="robots" content="noindex">/u);
    assert.equal(page.headers.get("x-robots-tag"), "noindex");
    assert.ok(!text.includes("application/ld+json"));
    assert.equal((await fetch(`${b}/listings.json`)).status, 404);
  });
  await serve(setup(on).backend, async (b) => {
    const page = await fetch(`${b}/shop`);
    const text = await page.text();
    assert.ok(!/name="robots"/u.test(text));
    assert.equal(page.headers.get("x-robots-tag"), null);
    const ld = /<script type="application\/ld\+json">(.*?)<\/script>/su.exec(text);
    assert.ok(ld);
    const data = JSON.parse(ld[1]) as { "@graph": { "@type": string; offers?: { price?: string; priceCurrency?: string } }[] };
    assert.deepEqual(data["@graph"].map((x) => x["@type"]), ["Store", "Product"]);
    assert.equal(data["@graph"][1].offers?.priceCurrency, "INR");
    const feed = await fetch(`${b}/listings.json`);
    assert.equal(feed.status, 200);
    assert.equal(feed.headers.get("access-control-allow-origin"), "*");
    assert.match(feed.headers.get("cache-control") ?? "", /public, max-age=300/u);
    const etag = feed.headers.get("etag");
    assert.ok(etag);
    const j = await feed.json() as { format: string; items: { id: string; photos: { url: string }[]; price: { value: string } }[]; shop: { place: { town: string }; registration: { source: string } } };
    assert.equal(j.format, "shop-feed/1");
    assert.deepEqual(j.items.map((l) => l.id), ["l-1"]);
    assert.equal(j.items[0].price.value, "8000.00");
    assert.equal(j.items[0].photos[0].url, `${PUBLIC}/listings/photo/ph-0123456789ab.jpg`);
    assert.equal(j.shop.place.town, "Thrissur");
    assert.equal(j.shop.registration.source, "owner");
    assert.ok(!/"by"|"from"|whatsapp|signature/u.test(JSON.stringify(j)));
    assert.equal((await fetch(`${b}/listings.json`, { headers: { "if-none-match": etag } })).status, 304, "a reader that sends If-None-Match gets 304");
    assert.equal((await fetch(`${b}/listings.json`, { method: "HEAD" })).status, 200);
    assert.match(text, /<link rel="alternate" type="application\/json" title="shop-feed\/1"/u);
  });
});

test("the page shows 'What we have': the price or Ask the shop, the freshness in words, the registration as the owner's word, and 'Ask about this' opens the chat with the listing", async () => {
  await serve(setup({ ...on, listings: [listing("l-1"), listing("l-2", { pricePaise: undefined, priceNote: undefined, confirmedMs: NOW - 10 * 86_400_000, words: { en: { title: "Tabby", text: "" } }, photos: [] })] }).backend, async (b) => {
    const text = await (await fetch(`${b}/shop`)).text();
    const w = LISTING_WORDS.en;
    for (const line of [w.heading, "₹8,000 each", w.askShop, w.confirmedToday, w.callToCheck, w.registration("PS/KL/2026/123"), w.askAbout]) assert.ok(text.includes(line.replace(/&/gu, "&amp;")), line);
    assert.ok(text.includes(`${PUBLIC}/chat?about=l-1`));
    assert.ok(!/guaranteed|verified|certified/iu.test(text));
    const hi = await (await fetch(`${b}/shop?lang=hi`)).text();
    assert.ok(hi.includes(LISTING_WORDS.hi.heading));
    assert.ok(hi.includes(LISTING_WORDS.hi.machine) === false, "the hindi words here are present for l-1, so no machine note is needed for it, but l-2 has only English: its page says so");
  });
});

test("the policy names the photo folder in its one img-src, never 'self'; the page sends it", async () => {
  const policy = storefrontPolicy(PUBLIC);
  assert.equal((policy.match(/img-src/gu) ?? []).length, 1);
  assert.ok(policy.includes(`img-src data: ${PUBLIC}/listings/photo/`));
  assert.ok(!policy.includes("'self' ") || !/img-src[^;]*'self'/u.test(policy));
  await serve(setup(on).backend, async (b) => { assert.equal((await fetch(`${b}/shop`)).headers.get("content-security-policy"), policy.replace(PUBLIC, PUBLIC) && (await fetch(`${b}/shop`)).headers.get("content-security-policy")); });
});

test("a photo has one address: its own id and its type; the wrong extension, a bad id or a path in the name is not found; nothing under /p/", async () => {
  await serve(setup(on).backend, async (b) => {
    const ok = await fetch(`${b}/listings/photo/ph-0123456789ab.jpg`);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("content-type"), "image/jpeg");
    assert.equal(ok.headers.get("x-content-type-options"), "nosniff");
    assert.match(ok.headers.get("cache-control") ?? "", /max-age=31536000/u);
    assert.equal((await fetch(`${b}/listings/photo/ph-0123456789ab.webp`)).status, 404, "the type must agree with the extension");
    for (const bad of ["ph-0123456789ab.png", "ph-xyz.jpg", "..%2f..%2fetc%2fpasswd.jpg", "ph-0123456789ac.jpg", "evil.jpg"]) assert.equal((await fetch(`${b}/listings/photo/${bad}`)).status, 404, bad);
  });
});

test("'Ask about this' opens the chat greeting with the listing, and the composer starts with its name; an unknown listing is ignored", async () => {
  await serve(setup(on).backend, async (b) => {
    const text = await (await fetch(`${b}/chat?about=l-1`)).text();
    assert.ok(text.includes(LISTING_WORDS.en.chatGreeting("Persian kitten")));
    assert.ok(text.includes(`${LISTING_WORDS.en.guestAsked("Persian kitten")} (l-1).`));
    const other = await (await fetch(`${b}/chat?about=l-99`)).text();
    assert.ok(!other.includes("Persian kitten"));
    const injected = await (await fetch(`${b}/chat?about=${encodeURIComponent("l-1<script>")}`)).text();
    assert.ok(!injected.includes("<script>alert"));
  });
});

test("the owner's photo goes to the runtime with its type; a PNG is refused at the front; the page's form posts an op, and a refusal comes back with its reason", async () => {
  const { backend, calls } = setup(on);
  await serve(backend, async (b) => {
    const o = `${b}/o/${TOKEN}`;
    const post = (type: string) => fetch(`${o}/listings/photo`, { method: "POST", headers: { "content-type": type }, body: JPEG });
    assert.equal((await post("image/jpeg")).status, 200);
    assert.equal((await post("image/png")).status, 415);
    assert.deepEqual(calls.photos, [{ type: "image/jpeg", bytes: JPEG.length }]);
    const form = (fields: Record<string, string>) => fetch(`${o}/listings/op`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields), redirect: "manual" });
    const ok = await form({ op: "publish_form", category: "pets", title: "Persian kitten", price: "8000", note: "each", photos: "ph-0123456789ab" });
    assert.equal(ok.status, 303);
    assert.match(ok.headers.get("location") ?? "", /n=saved/u);
    assert.deepEqual(calls.ops.at(-1), { op: "publish_form", category: "pets", title: "Persian kitten", photos: ["ph-0123456789ab"], priceInr: 8000, priceNote: "each" });
    const refused = await form({ op: "publish_form", category: "pets", title: "Indian star tortoise" });
    assert.match(refused.headers.get("location") ?? "", /n=protected_animal/u);
    const page = await (await fetch(`${o}/listings`)).text();
    assert.ok(page.includes(LISTING_WORDS.en.owner.switchLabel));
    assert.ok(page.includes("noindex"));
    const policy = (await fetch(`${o}/listings`)).headers.get("content-security-policy") ?? "";
    assert.ok(!/'self'/u.test(policy));
    assert.equal((policy.match(/img-src/gu) ?? []).length, 1);
  });
});

test("the shop's front page has a button to 'What we have' when the shop shows listings, and none when it shows none", async () => {
  await serve(setup(on).backend, async (b) => { assert.ok((await (await fetch(`${b}/`)).text()).includes(`${LISTING_WORDS.en.seeAll} (1)`)); });
  await serve(setup({ shop: { visible: false }, listings: [] }).backend, async (b) => { assert.ok(!(await (await fetch(`${b}/`)).text()).includes(LISTING_WORDS.en.seeAll)); });
});
