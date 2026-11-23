// A CUSTOMER'S WEB PUSH from an Orders shop (24 Nov 2026; the TypeScript runtime's item 11h: server/runtime.ts `push.customer` on the channel outbox's onKeep, and http.ts's
// customer_* ops). The case the gap was about: a shop with NO WhatsApp, whose customers hear of their order only on its page, now reaches the phone that allowed alerts on that
// page (and the Guard's refusal at its daily count is not tried again). Every push goes through the shop's push Guard (the fake Guard of modules/test/contract/push-harness.ts, which keeps what it is sent), encrypted for that phone alone and
// signed with the shop's key. Held to what the TypeScript did: one push per kept message per phone, the page's own words fitted as every notification, the shop's name as the
// title, the tag "update", the customer's route, a 12-hour TTL, normal urgency and one topic per phone; an order from MCP has alerts as a page order does; a phone the push
// service says is gone (410) is removed; a phone that stopped alerts (customer_unsubscribe) hears nothing more; the page keeps its message whatever the push did.
// The Bookings contract (push.contract.test.ts there) has the Guard's daily count, with the real geo-guard, and the chat guest's alerts.
import { after, describe } from "node:test";
import assert from "node:assert/strict";
import { fitNotification } from "../../../../modules/push/sender.ts";
import type { PushCall } from "../../../../modules/push/hosts.ts";
import { GUARD_TOKEN, enablePush, softBrowser, startFakeGuard } from "../../../../modules/test/contract/push-harness.ts";
import { readVapidHeader, vapidVerifies } from "../../../../modules/push/crypto.ts";
import type { FakeGuard, SoftBrowser } from "../../../../modules/test/contract/push-harness.ts";
import { contract, makeShop, sleep } from "./harness.ts";
import type { Shop, ShopOptions } from "./harness.ts";

const shops: Shop[] = [];
const guards: FakeGuard[] = [];
after(async () => {
  for (const s of shops) { await s.stop(); await s.cleanup(); }
  for (const g of guards) await g.close();
});

/** A shop with push on, as the deployer turns it on; NO WhatsApp unless `whatsapp` (runtime.json `services` naming no messaging). */
async function boot(o: ShopOptions & { whatsapp?: boolean } = {}): Promise<{ s: Shop; guard: FakeGuard }> {
  const guard = await startFakeGuard(); guards.push(guard);
  const s = await makeShop({ ...o, runtime: { ...(o.runtime ?? {}), services: o.whatsapp ? { messaging: {} } : {} } });
  shops.push(s);
  enablePush(s, guard);
  await s.start();
  return { s, guard };
}

const push = (s: Shop, body: Record<string, unknown>) => s.call("/internal/channel/push", { body });

/** The push harness's VAPID check on the SHOP's clock (a fakes shop runs on the test clock, days before the machine's): the header verifies under the shop's key, for that push
 * service, signed by the shop's page, and not expired at the shop's now. */
function signedByShop(s: Shop, call: PushCall, publicKey: string): boolean {
  const v = readVapidHeader(call.vapid ?? "");
  if (!v || v.k !== publicKey || !vapidVerifies(v.t, publicKey)) return false;
  const claims = JSON.parse(Buffer.from(v.t.split(".")[1], "base64url").toString("utf8")) as { aud: string; exp: number; sub: string };
  return claims.aud === `https://${call.host}` && claims.exp > s.now() / 1000 && /^https?:\/\//u.test(claims.sub);
}

async function heard(s: Shop, guard: FakeGuard, n: number): Promise<void> {
  for (let i = 0; i < 200 && guard.calls.length < n; i++) await sleep(50);
  await sleep(400);
  assert.equal(guard.calls.length, n, `${n} push(es) to the Guard:\n${s.log()}`);
}

const newest = async (s: Shop, hash: string): Promise<string> => (await s.request(hash)).body.messages.at(-1).text;

function opened(call: PushCall, b: SoftBrowser): { title: string; body: string; tag: string } {
  assert.equal(call.host, new URL(b.subscription.endpoint).hostname);
  assert.deepEqual([call.ttl, call.urgency, call.topic], [12 * 60 * 60, "normal", `customer-${call.sub}`]);
  return b.open(call);
}

describe("a customer's alerts on their order's page", () => {
  contract("a shop with no WhatsApp: the order's next message goes to the phone that allowed alerts, once, through the push Guard, in the page's own words; the Guard's daily count holds", async () => {
    const { s, guard } = await boot({ settings: { owner: { approveOverInr: 0 } } });
    const { hash } = await s.order();
    const b = softBrowser("updates.push.services.mozilla.com");
    assert.deepEqual((await push(s, { op: "customer_subscribe", handle: hash, subscription: b.subscription })).body, { on: true, phones: 1 });
    assert.equal(guard.calls.length, 0);
    // the Guard refuses it at its daily count (its refusal names the reason, monorepo docs/guard-for-pathways.md: `guard.reason_code: "limit_exceeded"`)
    guard.answer = { status: 403, reason: "limit_exceeded" };
    await s.channelEvents([{ kind: "channel_request", id: "cancel-1", channel: "web", op: "cancel", handle: hash }]); await s.settle();
    await heard(s, guard, 1);
    await sleep(1500);
    assert.equal(guard.calls.length, 1, "a push the Guard refused is never tried again");
    assert.equal((await push(s, { op: "customer_state", handle: hash })).body.phones, 1, "and the phone keeps its subscription");
    const [{ path, authorization, call }] = guard.calls;
    assert.deepEqual([path, authorization], ["/v1/push/customer", `Bearer ${GUARD_TOKEN}`]);
    const words = await newest(s, hash);
    assert.match(words, /cancelled\. Nothing was charged/u, "the page keeps its message");
    assert.deepEqual(opened(call, b), { title: s.settings.name, body: fitNotification(words), tag: "update" });
    assert.ok(signedByShop(s, call, (await push(s, { op: "key" })).body.publicKey), "signed with the shop's own key");
  });

  contract("an order from MCP has alerts as a page order does; a phone that stopped alerts hears nothing more; a phone the push service says is gone is removed", async () => {
    const { s, guard } = await boot({ whatsapp: true, settings: { owner: { approveOverInr: 0 } } });
    const mcp = await s.order({ channel: "mcp", id: "o-mcp" });
    const b1 = softBrowser(), b2 = softBrowser();
    assert.equal((await push(s, { op: "customer_subscribe", handle: mcp.hash, subscription: b1.subscription })).status, 200);
    assert.equal((await push(s, { op: "customer_subscribe", handle: mcp.hash, subscription: b2.subscription })).body.phones, 2);
    // the second phone stops its alerts: only the first hears the cancel
    assert.equal((await push(s, { op: "customer_unsubscribe", handle: mcp.hash })).status, 400, "the endpoint to stop is named");
    assert.deepEqual((await push(s, { op: "customer_unsubscribe", handle: mcp.hash, endpoint: b2.subscription.endpoint })).body, { on: true, phones: 1 });
    guard.answer = { status: 410 };
    await s.channelEvents([{ kind: "channel_request", id: "cancel-1", channel: "mcp", op: "cancel", handle: mcp.hash }]); await s.settle();
    await heard(s, guard, 1);
    assert.equal(opened(guard.calls[0].call, b1).body, fitNotification(await newest(s, mcp.hash)));
    for (let i = 0; i < 40 && (await push(s, { op: "customer_state", handle: mcp.hash })).body.phones !== 0; i++) await sleep(50);
    assert.equal((await push(s, { op: "customer_state", handle: mcp.hash })).body.phones, 0, "the phone the push service dropped is removed");
  });
});
