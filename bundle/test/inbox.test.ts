// The server's one inbox: a webhook for shop A can only ever reach shop A's runtime, even when two shops share one Meta app (and so one app secret).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { signMeta, signRazorpay } from "../../pathways/bookings/src/adapters/live/webhooks.ts";
import { createRouter } from "../lib/router.ts";
import { loadRouter } from "../services/inbox.ts";
import type { InboxShopConfig } from "../services/inbox.ts";

const listen = (server: Server) => new Promise<number>((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as { port: number }).port)));
const close = (server: Server) => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); });

function fakeRuntime() {
  const received: { token: string; events: unknown[] }[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => { received.push({ token: String(req.headers.authorization), events: (JSON.parse(Buffer.concat(chunks).toString()) as { events: unknown[] }).events }); res.writeHead(200, { "content-type": "application/json" }); res.end('{"saved":1,"duplicates":0}'); });
  });
  return { received, server };
}

const SHARED_APP_SECRET = "one-meta-app-for-both-shops";
const metaBody = (phoneNumberId: string, from = "919811111111", id = "wamid.1") => JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "w", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { display_phone_number: "1", phone_number_id: phoneNumberId }, messages: [{ from, id, timestamp: "1793700000", type: "text", text: { body: "hello" } }] } }] }] });
const razorpayBody = JSON.stringify({ event: "payment.captured", created_at: 1793700000, payload: { payment: { entity: { id: "pay_1", order_id: "o", amount: 20000, currency: "INR", status: "captured", notes: {} } } } });

async function setup() {
  const a = fakeRuntime(); const b = fakeRuntime();
  const [pa, pb] = [await listen(a.server), await listen(b.server)];
  const secrets: Record<string, string> = {};
  const shop = (name: string, port: number, razorpay: string, phone: string, owner: string): InboxShopConfig => {
    for (const [k, v] of Object.entries({ internal_token: `internal-token-of-${name}-0123456789`, relay_token: `relay-token-of-${name}-0123456789`, razorpay_webhook_secret: razorpay, whatsapp_app_secret: SHARED_APP_SECRET, whatsapp_verify_token: `verify-${name}-0123456789` })) secrets[`/s/${name}/${k}`] = v;
    return { runtimeUrl: `http://127.0.0.1:${port}`, relayUrl: "http://127.0.0.1:1/c/x", ownerWhatsapp: owner, phoneNumberId: phone, verification: "meta-signature", secretsDir: `/s/${name}` };
  };
  const router = loadRouter({ shops: { "shop-a": shop("shop-a", pa, "razorpay-secret-of-a", "111111111111111", "+919800000001"), "shop-b": shop("shop-b", pb, "razorpay-secret-of-b", "222222222222222", "+919800000002") } }, (p) => secrets[p], () => undefined);
  const front = createServer(router);
  const port = await listen(front);
  const post = (path: string, body: string, headers: Record<string, string>) => fetch(`http://127.0.0.1:${port}${path}`, { method: "POST", body, headers: { "content-type": "application/json", ...headers } });
  return { a, b, post, secrets, port, done: async () => { await close(front); await close(a.server); await close(b.server); } };
}

test("a Razorpay event for shop A is checked with A's secret and goes to A's runtime only", async () => {
  const w = await setup(); try {
    const r = await w.post("/c/shop-a/webhooks/razorpay", razorpayBody, { "x-razorpay-signature": signRazorpay(razorpayBody, "razorpay-secret-of-a"), "x-razorpay-event-id": "evt_1" });
    assert.equal(r.status, 200);
    assert.equal(w.a.received.length, 1); assert.equal(w.b.received.length, 0);
    assert.equal(w.a.received[0].token, "Bearer internal-token-of-shop-a-0123456789", "A's runtime is given A's own token");
  } finally { await w.done(); }
});

test("shop A's signature does not open shop B's door, and B's runtime hears nothing", async () => {
  const w = await setup(); try {
    const r = await w.post("/c/shop-b/webhooks/razorpay", razorpayBody, { "x-razorpay-signature": signRazorpay(razorpayBody, "razorpay-secret-of-a"), "x-razorpay-event-id": "evt_2" });
    assert.equal(r.status, 401);
    assert.deepEqual([w.a.received.length, w.b.received.length], [0, 0]);
    assert.equal((await w.post("/c/shop-c/webhooks/razorpay", razorpayBody, {})).status, 404, "no such shop");
    assert.equal((await w.post("/c/../webhooks/razorpay", razorpayBody, {})).status, 404);
    assert.equal((await w.post("/webhooks/razorpay", razorpayBody, {})).status, 404, "the old single-shop path is not served");
  } finally { await w.done(); }
});

test("two shops on ONE Meta app share a signature secret: a message for B's number posted to A's door is verified, then dropped", async () => {
  const w = await setup(); try {
    const forB = metaBody("222222222222222");
    const r = await w.post("/c/shop-a/webhooks/whatsapp", forB, { "x-hub-signature-256": signMeta(forB, SHARED_APP_SECRET) });
    assert.equal(r.status, 200, "Meta is not made to retry");
    assert.deepEqual(await r.json(), { forwarded: 0 });
    assert.deepEqual([w.a.received.length, w.b.received.length], [0, 0], "it reached neither runtime");
    const forA = metaBody("111111111111111");
    assert.equal((await w.post("/c/shop-a/webhooks/whatsapp", forA, { "x-hub-signature-256": signMeta(forA, SHARED_APP_SECRET) })).status, 200);
    assert.deepEqual([w.a.received.length, w.b.received.length], [1, 0]);
    const own = metaBody("222222222222222", "919811111111", "wamid.2");
    await w.post("/c/shop-b/webhooks/whatsapp", own, { "x-hub-signature-256": signMeta(own, SHARED_APP_SECRET) });
    assert.deepEqual([w.a.received.length, w.b.received.length], [1, 1]);
  } finally { await w.done(); }
});

test("Meta's handshake uses the shop's own verify token", async () => {
  const w = await setup(); try {
    const get = (shop: string, token: string) => fetch(`http://127.0.0.1:${w.port}/c/${shop}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=1234`);
    assert.equal((await get("shop-a", "verify-shop-a-0123456789")).status, 200);
    assert.equal((await get("shop-a", "verify-shop-b-0123456789")).status, 403);
  } finally { await w.done(); }
});

test("an inbox with a secret file missing refuses to start and names the file, never a value", () => {
  assert.throws(() => loadRouter({ shops: { x: { runtimeUrl: "http://r", relayUrl: "http://l", ownerWhatsapp: "+919800000001", phoneNumberId: "1", verification: "meta-signature", secretsDir: "/s/x" } } }, () => undefined, () => undefined), /secret file internal_token is missing or empty in \/s\/x/);
  const router = createRouter({}, () => undefined);
  assert.ok(typeof router === "function");
});
