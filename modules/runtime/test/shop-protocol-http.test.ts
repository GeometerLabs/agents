// The runtime's routes for the shop's open protocol (modules/runtime/http.ts): the signed feed, check answer and card are made here with the shop's key for the shop's OWN page address only; the
// front's word is not enough to sign anything else; a notice is offered to the inbox (the internal token) only for a real change, once a minute, and only for a shop on the pages domain.
// Written, not run, in the 18 Nov build stream.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../http.ts";
import type { ServedRuntime } from "../http.ts";
import { createShopProtocol } from "../shop-protocol.ts";
import { generateSigningKey, verifyDocument, verifyNotice } from "../../signing/index.ts";
import type { PublicListingsRead } from "../../listings/kit.ts";

const PAGE = "https://pages.example/veena";
const BASE = "https://server.example/s/veena";
const listing = {
  id: "l-1", state: "live" as const, category: "pets", ownerLang: "en" as const, words: { en: { title: "Persian kitten", text: "" } }, pricePaise: 800000, photos: [],
  createdMs: 1_000, publishedMs: 1_000, confirmedMs: Date.now(), by: "owner" as const, from: "app" as const,
};

async function run(fn: (call: (path: string, init?: RequestInit) => Promise<{ status: number; body: any }>, o: { key: ReturnType<typeof generateSigningKey>; read: PublicListingsRead; set(r: PublicListingsRead): void; tick(ms: number): void }) => Promise<void>, o: { pages?: boolean; noKey?: boolean } = {}) {
  const key = generateSigningKey();
  let read: PublicListingsRead = { shop: { visible: true, town: "Thrissur" }, listings: [listing as never] };
  let now = Date.now();
  const signed = createShopProtocol({ read: () => read, key: () => (o.noKey ? undefined : key), now: () => now, name: () => "Veena Salon" });
  const runtime = {
    submit: () => ({ saved: 0, duplicates: 0 }), kick: () => undefined, status: () => ({}), refundContext: () => null, ready: () => ({ ok: true as const }),
    channel: { offer: async () => ({}), view: () => null, owner: () => ({}), listings: { signed } },
  } as unknown as ServedRuntime;
  const server = await startServer(runtime, { token: "internal-token", port: 0, channelToken: "channel-token", ...(o.pages === false ? {} : { pages: () => ({ base: BASE, url: PAGE }) }) });
  const call = async (path: string, init: RequestInit = {}) => { const r = await fetch(`${server.url}${path}`, init); return { status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) }; };
  try { await fn(call, { key, get read() { return read; }, set: (r) => { read = r; }, tick: (ms) => { now += ms; } } as never); } finally { await server.close(); }
}
const bearer = (token: string) => ({ authorization: `Bearer ${token}`, "content-type": "application/json" });
const post = (token: string, body: unknown): RequestInit => ({ method: "POST", headers: bearer(token), body: JSON.stringify(body) });

test("the signed feed, answer and card are made for the shop's own page, with the channel token; a page that is not the shop's gets nothing signed", async () => {
  await run(async (call, o) => {
    const feed = await call("/internal/channel/shop-feed", post("channel-token", { page: PAGE, name: "Veena Salon", languages: ["en", "hi", "xx"], chat: `${PAGE}/chat` }));
    assert.equal(feed.status, 200);
    assert.ok(verifyDocument(feed.body).ok);
    assert.deepEqual(feed.body.shop.languages, ["en", "hi"], "only the languages the shop knows");
    assert.equal(feed.body.shop.check, `${PAGE}/api/v1/check`);
    const viaBase = await call("/internal/channel/shop-feed", post("channel-token", { page: BASE, name: "Veena Salon", languages: ["en"] }));
    assert.equal(viaBase.status, 200, "the shop's own server address is also its page");
    for (const page of ["https://evil.example/veena", `${PAGE}/`, `${PAGE}.evil.example`, undefined, 3]) {
      assert.equal((await call("/internal/channel/shop-feed", post("channel-token", { page, name: "x", languages: [] }))).status, 400, String(page));
      assert.equal((await call("/internal/channel/shop-check", post("channel-token", { page, ids: ["l-1"] }))).status, 400, String(page));
    }
    assert.equal((await call("/internal/channel/shop-feed", post("channel-token", { page: PAGE, name: "", languages: [] }))).status, 400);
    assert.equal((await call("/internal/channel/shop-feed", post("channel-token", { page: PAGE, name: "x", languages: [], chat: "https://evil.example/chat" }))).status, 400, "a chat address off the page is not signed into the feed");
    const check = await call("/internal/channel/shop-check", post("channel-token", { page: PAGE, ids: ["l-1", "l-2"], buyer: "Asha" }));
    assert.equal(check.status, 200);
    assert.deepEqual(check.body.items.map((i: any) => [i.id, i.availability]), [["l-1", "in_stock"], ["l-2", "gone"]]);
    assert.ok(verifyDocument(check.body, o.key.publicKey).ok);
    assert.equal((await call("/internal/channel/shop-check", post("channel-token", { page: PAGE, ids: Array.from({ length: 11 }, (_, i) => `l-${i}`) }))).status, 400);
    const card = { supportedInterfaces: [{ url: `${PAGE}/api/v1` }], provider: { url: `${PAGE}/` } };
    assert.equal((await call("/internal/channel/shop-card", post("channel-token", { page: PAGE, card }))).status, 200);
    assert.equal((await call("/internal/channel/shop-card", post("channel-token", { page: PAGE, card: { ...card, provider: { url: "https://evil.example/" } } }))).status, 400, "the front cannot get another site's card signed");
  });
});

test("only the channel token reaches the channel routes; the internal token and no token do not; GET is refused", async () => {
  await run(async (call) => {
    const body = { page: PAGE, name: "x", languages: [] };
    assert.equal((await call("/internal/channel/shop-feed", post("internal-token", body))).status, 401);
    assert.equal((await call("/internal/channel/shop-feed", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).status, 401);
    assert.equal((await call("/internal/channel/shop-feed", { headers: bearer("channel-token") })).status, 405);
  });
});

test("with the switch off there is no feed and no card (404) and a check answers every id gone; a store with no key signs nothing", async () => {
  await run(async (call, o) => {
    o.set({ shop: { visible: false }, listings: [listing as never] });
    assert.equal((await call("/internal/channel/shop-feed", post("channel-token", { page: PAGE, name: "x", languages: [] }))).status, 404);
    assert.equal((await call("/internal/channel/shop-card", post("channel-token", { page: PAGE, card: { supportedInterfaces: [{ url: `${PAGE}/api/v1` }], provider: { url: `${PAGE}/` } } }))).status, 404);
    const check = await call("/internal/channel/shop-check", post("channel-token", { page: PAGE, ids: ["l-1"] }));
    assert.deepEqual(check.body.items, [{ id: "l-1", availability: "gone" }]);
  });
  await run(async (call) => {
    assert.equal((await call("/internal/channel/shop-feed", post("channel-token", { page: PAGE, name: "x", languages: [] }))).status, 404);
    assert.equal((await call("/internal/channel/shop-check", post("channel-token", { page: PAGE, ids: ["l-1"] }))).status, 404);
  }, { noKey: true });
});

test("the notice: offered to the inbox with the internal token for a real change, acknowledged once delivered, never twice a minute; the channel token cannot ask for it", async () => {
  await run(async (call, o) => {
    assert.equal((await call("/internal/feed-notice", { headers: bearer("channel-token") })).status, 401);
    assert.equal((await call("/internal/feed-notice")).status, 401);
    const due = await call("/internal/feed-notice", { headers: bearer("internal-token") });
    assert.equal(due.status, 200);
    assert.equal(due.body.notice.feed, `${PAGE}/listings.json`, "the feed address a directory accepts: on the pages domain");
    assert.ok(verifyNotice(due.body.notice, o.key.publicKey).ok);
    assert.equal((await call("/internal/feed-notice", post("internal-token", { fingerprint: "short" }))).status, 400);
    assert.equal((await call("/internal/feed-notice", post("internal-token", { fingerprint: due.body.fingerprint }))).status, 200);
    o.tick(61_000);
    assert.equal((await call("/internal/feed-notice", { headers: bearer("internal-token") })).status, 204, "nothing changed since");
    o.set({ shop: { visible: true, town: "Thrissur" }, listings: [{ ...listing, pricePaise: 700000 } as never] });
    const changed = await call("/internal/feed-notice", { headers: bearer("internal-token") });
    assert.equal(changed.status, 200, "a changed price is a real change");
    assert.notEqual(changed.body.fingerprint, due.body.fingerprint);
    await call("/internal/feed-notice", post("internal-token", { fingerprint: changed.body.fingerprint }));
    o.set({ shop: { visible: true, town: "Thrissur" }, listings: [{ ...listing, pricePaise: 600000 } as never] });
    assert.equal((await call("/internal/feed-notice", { headers: bearer("internal-token") })).status, 204, "less than a minute since the last");
  });
});

test("a shop with no address on the pages domain sends no notice (a directory would refuse its feed address), and one with no pages file signs nothing for the front", async () => {
  await run(async (call) => {
    assert.equal((await call("/internal/feed-notice", { headers: bearer("internal-token") })).status, 204);
  }, { pages: false });
  await run(async (call) => {
    assert.equal((await call("/internal/channel/shop-feed", post("channel-token", { page: PAGE, name: "x", languages: [] }))).status, 400);
  }, { pages: false });
});
