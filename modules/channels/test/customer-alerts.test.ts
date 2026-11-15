// Alerts on an order's page and on a parent's page (release-flow batch 3, 14 Nov 2026), through the real public front over HTTP with a stand-in runtime backend: the page
// offers "Tell me on this phone" with its own worker and a content policy that names exactly this page's two addresses; the worker is served only to a page that can have
// alerts; a subscription goes to the runtime keyed by the page's handle (an order) or by the parent's link hash (a fee), and a wrong shape or another site's page is refused.
// Also: a shop's pages.json gives every customer page its phone and map link, and names the Operator for the door in a header.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { frontHandler } from "../front.ts";
import type { FrontShop } from "../front.ts";
import type { ChannelBackend } from "../backend.ts";
import { handleHash, newHandle, parentLinkHash } from "../handle.ts";
import { CONTACT_HEADER } from "../contact-bar.ts";

const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });

const calls: { body: Record<string, unknown> }[] = [];
const push: NonNullable<ChannelBackend["push"]> = async (body) => {
  calls.push({ body });
  if (body.op === "key") return { status: 200, body: { on: true, publicKey: "BPublicKeyOfTheShop" } };
  if (body.op === "customer_state") return { status: 200, body: { on: true, phones: 0 } };
  if (body.op === "customer_subscribe") return { status: 200, body: { on: true, phones: 1 } };
  return { status: 400, body: { error: "no" } };
};
const SHOP = { name: "Glow Kitchen", timezone: "Asia/Kolkata", languages: ["en"] as const, payment: { kind: "upi" as const, payee: "glow@okicici" }, paused: false };
const orderView = { status: "confirmed" as const, ref: "o-1", channel: "web", lines: [{ itemId: "thali", names: { en: "Thali", hi: "थाली", ml: "താലി", kn: "ಥಾಲಿ" }, qty: 1, priceInr: 100 }], totalInr: 100, advanceInr: 50, date: "2026-11-17", mode: "pickup" as const, slot: { id: "l", fromMs: 1_794_000_000_000, toMs: 1_794_003_600_000 }, canCancel: false, canSayPaid: false, messages: [] };

async function front(shop: Omit<FrontShop, "publicUrl">) {
  const holder: Record<string, FrontShop> = {};
  const server = createServer(frontHandler({ shops: holder }));
  servers.push(server);
  const port = await new Promise<number>((r) => server.listen(0, "127.0.0.1", () => r((server.address() as { port: number }).port)));
  const origin = `http://127.0.0.1:${port}`;
  holder.glow = { publicUrl: `${origin}/s/glow`, ...shop } as FrontShop;
  return { origin, get: (path: string) => fetch(`${origin}/s/glow${path}`), post: (path: string, body: unknown, headers: Record<string, string> = {}) => fetch(`${origin}/s/glow${path}`, { method: "POST", headers: { "content-type": "application/json", origin, ...headers }, body: JSON.stringify(body) }) };
}

test("an order's page offers alerts with its own worker, and a subscription reaches the runtime keyed by the page's handle", async () => {
  const handle = newHandle();
  const backend = { orderOffer: async () => ({ kind: "orders", shop: { ...SHOP, advance: { mode: "part", percent: 50, holdMinutes: 30 }, cancellation: { windowHours: 4 } }, items: [], days: [], maxItemsPerOrder: 20 }), orderView: async (h: string) => (h === handleHash(handle) ? orderView : null), push } as unknown as ChannelBackend;
  const f = await front({ backend, kind: "orders" });
  const page = await f.get(`/order/${handle}`);
  const text = await page.text();
  assert.equal(page.status, 200);
  assert.match(text, /id="alerts"/u, "the page has the alerts box");
  const policy = page.headers.get("content-security-policy") ?? "";
  assert.match(policy, new RegExp(`worker-src [^;]*/order/${handle}/sw\\.js`, "u"));
  assert.match(policy, new RegExp(`connect-src [^;]*/order/${handle}/push`, "u"));
  assert.equal((await f.get(`/order/${handle}/sw.js`)).headers.get("content-type"), "text/javascript; charset=utf-8");
  assert.equal((await f.get(`/order/${newHandle()}/sw.js`)).status, 404, "no worker for a page that does not exist");
  const sub = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: "x", auth: "y" } };
  const taken = await f.post(`/order/${handle}/push`, { subscription: sub });
  assert.equal(taken.status, 200);
  assert.deepEqual(calls.at(-1)!.body, { op: "customer_subscribe", handle: handleHash(handle), subscription: sub });
  assert.equal((await f.post(`/order/${handle}/push`, { subscription: sub }, { origin: "https://evil.example" })).status, 403, "another site's page is refused");
});

test("a parent's page offers alerts keyed by the parent's link hash; the worker needs a link that opens something", async () => {
  const link = newHandle();
  const view = { ref: "p-0123456789ab", students: [{ name: "Aarav", batch: { en: "Maths", hi: "", ml: "", kn: "" } }], dues: [] };
  const backend = { feesOffer: async () => ({ kind: "fees", shop: SHOP }), parentView: async (h: string) => (h === parentLinkHash(link) ? view : null), feeConfirmView: async () => null, push } as unknown as ChannelBackend;
  const f = await front({ backend, kind: "fees" });
  const page = await f.get(`/f/${link}`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /id="alerts"/u);
  assert.match(page.headers.get("content-security-policy") ?? "", new RegExp(`worker-src [^;]*/f/${link}/sw\\.js`, "u"));
  assert.equal((await f.get(`/f/${link}/sw.js`)).status, 200);
  assert.equal((await f.get(`/f/${newHandle()}/sw.js`)).status, 404, "a link that opens nothing gets no worker");
  const sub = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: "x", auth: "y" } };
  assert.equal((await f.post(`/f/${link}/push`, { subscription: sub })).status, 200);
  assert.deepEqual(calls.at(-1)!.body, { op: "customer_subscribe", handle: parentLinkHash(link), subscription: sub }, "the runtime finds the parent by the link's hash now");
});

test("every customer page shows the shop's phone and map link, and a door request names the Operator in a header the door strips", async () => {
  const handle = newHandle();
  const pages = { schema: 1 as const, base: "https://s.example/s/glow", ownerBase: "https://s.example/s/glow/owner", slug: "glow", url: "https://pages.example/glow", phone: "+918012345678", map: "https://maps.app.goo.gl/AbC123", partner: { name: "Divya", phone: "+919800000000" } };
  const backend = { orderOffer: async () => ({ kind: "orders", shop: { ...SHOP, advance: { mode: "part", percent: 50, holdMinutes: 30 }, cancellation: { windowHours: 4 } }, items: [], days: [], maxItemsPerOrder: 20 }), orderView: async () => null, push } as unknown as ChannelBackend;
  const f = await front({ backend, kind: "orders", pages: () => pages });
  const text = await (await f.get(`/order/${handle}`)).text();
  assert.match(text, /href="tel:\+918012345678"/u, "even the page for an order that is not found has the shop's number");
  assert.match(text, /href="https:\/\/maps\.app\.goo\.gl\/AbC123"/u);
  const viaDoor = await fetch(`${f.origin}/s/glow/order/${handle}`, { headers: { "x-geometer-door": "glow" } });
  const header = viaDoor.headers.get(CONTACT_HEADER);
  assert.ok(header, "a door request carries the Operator's contact for the door");
  assert.deepEqual(JSON.parse(Buffer.from(header!, "base64url").toString("utf8")), { n: "Divya", p: "+919800000000" });
  assert.equal((await f.get(`/order/${handle}`)).headers.get(CONTACT_HEADER), null, "a request that did not come through the door gets none");
});

test("when the shop's runtime does not answer, the page is in the visitor's language and names the Operator (not one English line)", async () => {
  const pages = { schema: 1 as const, base: "https://s.example/s/glow", ownerBase: "https://s.example/s/glow/owner", partner: { name: "Divya", phone: "+919800000000" } };
  const backend = { orderOffer: async () => { throw new Error("the runtime is not answering"); }, push } as unknown as ChannelBackend;
  const f = await front({ backend, kind: "orders", pages: () => pages });
  const r = await fetch(`${f.origin}/s/glow/`, { headers: { "accept-language": "hi" } });
  const text = await r.text();
  assert.equal(r.status, 503);
  assert.match(text, /lang="hi"/u);
  assert.match(text, /href="tel:\+919800000000"/u); assert.match(text, /wa\.me\/919800000000/u);
});
