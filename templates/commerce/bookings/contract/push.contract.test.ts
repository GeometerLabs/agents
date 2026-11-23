// A CUSTOMER'S WEB PUSH (24 Nov 2026; the TypeScript runtime's item 11h, server/runtime.ts `push.customer` on the channel outbox's onKeep, and http.ts's customer_* ops): a
// customer who allowed alerts on their booking's own page, or a chat guest the shop has answered, hears the page's next message on their phone. Every push goes through the
// shop's push Guard (the fake Guard of modules/test/contract/push-harness.ts, which keeps what it is sent, and, when the built geo-guard is there, the real Guard with the push
// Guard's own spec in front of it), encrypted for that phone alone (RFC 8291) and signed with the shop's key (VAPID). Held to what the TypeScript did:
//   - exactly one push per kept message per phone, the page's own words fitted as every notification (fitNotification), the shop's name as the title, the tag "update", the
//     customer's route `/v1/push/customer`, a 12-hour TTL, normal urgency and one topic per phone;
//   - a subscription the push service says is gone (410) is removed; the Guard's refusal at its daily count is not tried again, and the phone keeps its subscription;
//   - "delete my chat" (the chat identity's forget) ends a guest's alerts; a handle with no page subscribes nothing; nothing before the first answer;
//   - the push never replaces the page's message: the page shows it whatever the push did.
// A "fakes" shop with its stand-in WhatsApp (runtime.json `services.messaging` named, so it keeps it) and push turned on as the deployer does (enablePush).
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { fitNotification } from "../../../../modules/push/sender.ts";
import type { PushCall } from "../../../../modules/push/hosts.ts";
import { GUARD_TOKEN, enablePush, softBrowser, startFakeGuard } from "../../../../modules/test/contract/push-harness.ts";
import { readVapidHeader, vapidVerifies } from "../../../../modules/push/crypto.ts";
import type { FakeGuard, SoftBrowser } from "../../../../modules/test/contract/push-harness.ts";
import { PUSH_LIMITS, pushGuardDef, pushSpec } from "../../../../bundle/generate/guards.ts";
import { credential, skipWithoutBinary, startRealGuard } from "../../../../bundle/test/real-guard.ts";
import type { RealGuard } from "../../../../bundle/test/real-guard.ts";
import { SKIP, contract, makeShop, openStart, sleep } from "./harness.ts";
import type { Shop, ShopOptions } from "./harness.ts";

const shops: Shop[] = [];
const guards: FakeGuard[] = [];
const real: RealGuard[] = [];
after(async () => {
  for (const s of shops) { await s.stop(); await s.cleanup(); }
  for (const g of guards) await g.close();
  for (const g of real) await g.stop();
});

/** A shop with WhatsApp and push on, its push Guard the given one (a fake Guard by default); `token` is the credential it presents, when not the fake's. */
async function boot(o: ShopOptions = {}, guard?: FakeGuard, token?: string): Promise<{ s: Shop; guard: FakeGuard }> {
  const g = guard ?? await startFakeGuard();
  if (!guard) guards.push(g);
  const s = await makeShop({ ...o, runtime: { ...(o.runtime ?? {}), services: { messaging: {} } } });
  shops.push(s);
  enablePush(s, g);
  if (token) writeFileSync(join(s.root, "secrets", "push_agent_token"), token);
  await s.start();
  return { s, guard: g };
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

/** Wait until the Guard has heard `n` calls in all (the sender runs outside the shop's steps), then a little longer to see that no more come. */
async function heard(s: Shop, guard: { calls: unknown[] }, n: number): Promise<void> {
  for (let i = 0; i < 200 && guard.calls.length < n; i++) await sleep(50);
  await sleep(400);
  assert.equal(guard.calls.length, n, `${n} push(es) to the Guard:\n${s.log()}`);
}

/** The page's newest message (a booking's page). */
const newest = async (s: Shop, hash: string): Promise<string> => (await s.request(hash)).body.messages.at(-1).text;

/** What a call carries, opened by the browser it was meant for, and the call's own shape checked against the TypeScript's. */
function opened(call: PushCall, b: SoftBrowser): { title: string; body: string; tag: string } {
  assert.equal(call.host, new URL(b.subscription.endpoint).hostname);
  assert.equal(call.path, new URL(b.subscription.endpoint).pathname);
  assert.deepEqual([call.ttl, call.urgency, call.topic], [12 * 60 * 60, "normal", `customer-${call.sub}`]);
  return b.open(call);
}

describe("a customer's alerts on their booking's page", () => {
  contract("the page's next message reaches the phone that allowed alerts, once, through the push Guard, in the page's own words", async () => {
    const { s, guard } = await boot();
    const { hash } = await s.book();
    // before the customer allows alerts: nothing is pushed, and the page says so
    assert.deepEqual((await push(s, { op: "customer_state", handle: hash })).body, { on: true, phones: 0 });
    const b = softBrowser();
    const sub = await push(s, { op: "customer_subscribe", handle: hash, subscription: b.subscription });
    assert.deepEqual([sub.status, sub.body], [200, { on: true, phones: 1 }]);
    assert.equal(guard.calls.length, 0, "the booking's first message came before the phone allowed alerts");
    // a handle with no page subscribes nothing, and a malformed one is told so
    assert.equal((await push(s, { op: "customer_subscribe", handle: "0".repeat(64), subscription: softBrowser().subscription })).status, 404);
    assert.equal((await push(s, { op: "customer_state", handle: "AB".repeat(32) })).status, 400);
    assert.equal((await push(s, { op: "customer_subscribe", handle: hash, subscription: { endpoint: "https://evil.example/x", keys: b.subscription.keys } })).status, 400, "only the push services the Guard allows");
    // the customer cancels on the page: the shop's answer is kept for the page and pushed to the phone
    await s.channelEvents([{ kind: "channel_request", id: "c-1", channel: "web", op: "cancel", handle: hash }]); await s.settle();
    await heard(s, guard, 1);
    const [{ path, authorization, call }] = guard.calls;
    assert.equal(path, "/v1/push/customer");
    assert.equal(authorization, `Bearer ${GUARD_TOKEN}`);
    const words = await newest(s, hash);
    const said = opened(call, b);
    assert.deepEqual(said, { title: s.settings.name, body: fitNotification(words), tag: "update" });
    assert.ok(!JSON.stringify(call).includes(words.slice(0, 12)), "nothing on the way can read it");
    const key = (await push(s, { op: "key" })).body.publicKey as string;
    assert.ok(signedByShop(s, call, key), "signed with the shop's own key, for that push service");
  });

  contract("a phone the push service says is gone (410) is removed; at the Guard's daily count the push is not tried again, the phone stays, and the page keeps its message", async () => {
    const { s, guard } = await boot();
    const first = await s.book({ id: "b-1" });
    const b1 = softBrowser();
    assert.equal((await push(s, { op: "customer_subscribe", handle: first.hash, subscription: b1.subscription })).status, 200);
    guard.answer = { status: 410 };
    await s.channelEvents([{ kind: "channel_request", id: "c-1", channel: "web", op: "cancel", handle: first.hash }]); await s.settle();
    await heard(s, guard, 1);
    for (let i = 0; i < 40 && (await push(s, { op: "customer_state", handle: first.hash })).body.phones !== 0; i++) await sleep(50);
    assert.equal((await push(s, { op: "customer_state", handle: first.hash })).body.phones, 0, "the dropped subscription is removed");
    // the Guard's refusal by a limit names its reason (monorepo docs/guard-for-pathways.md: `guard.reason_code: "limit_exceeded"`)
    const second = await s.book({ id: "b-2", startMs: openStart(s.now(), 3), phone: "+919822222222" });
    const b2 = softBrowser();
    assert.equal((await push(s, { op: "customer_subscribe", handle: second.hash, subscription: b2.subscription })).status, 200);
    guard.answer = { status: 403, reason: "limit_exceeded" };
    await s.channelEvents([{ kind: "channel_request", id: "c-2", channel: "web", op: "cancel", handle: second.hash }]); await s.settle();
    await heard(s, guard, 2);
    await sleep(1500);
    assert.equal(guard.calls.length, 2, "a refused push is never tried again (the count is the point)");
    assert.equal((await push(s, { op: "customer_state", handle: second.hash })).body.phones, 1, "the phone keeps its subscription");
    assert.equal((await s.request(second.hash)).body.status, "cancelled", "the page has its message whatever the push did");
    assert.equal(opened(guard.calls[1].call, b2).body, fitNotification(await newest(s, second.hash)));
  });

  // the one case that needs the built geo-guard: skipped without it, saying why (contract()'s own skip covers the Go program)
  test("the shop's real push Guard in front: its daily count for the shop's customers holds, and the push it refused is not tried again", { skip: SKIP ?? skipWithoutBinary }, async () => {
    // the push service the real Guard sends to: the fake Guard, used here only as the thing that keeps what reaches it
    const service = await startFakeGuard(); guards.push(service);
    const agent = credential();
    const g = await startRealGuard({
      def: pushGuardDef(), spec: pushSpec({ tenant: "glow-salon", name: "glow-salon-push", version: 1, reviewedBy: "contract" }, { ...PUSH_LIMITS, customerPerDay: 1 }),
      tenant: "glow-salon", deployment: "glow-salon-push", upstreamPort: Number(new URL(service.url).port), agents: [{ id: "runtime-glow-salon", token: agent.token }],
    });
    real.push(g);
    // the runtime posts to the real Guard and presents the credential it knows; what passes reaches the stand-in push service
    const { s } = await boot({}, { ...service, url: g.agentUrl }, agent.token);
    const one = await s.book({ id: "b-1" });
    const two = await s.book({ id: "b-2", startMs: openStart(s.now(), 3), phone: "+919822222222" });
    const b1 = softBrowser(), b2 = softBrowser();
    assert.equal((await push(s, { op: "customer_subscribe", handle: one.hash, subscription: b1.subscription })).status, 200);
    assert.equal((await push(s, { op: "customer_subscribe", handle: two.hash, subscription: b2.subscription })).status, 200);
    await s.channelEvents([{ kind: "channel_request", id: "c-1", channel: "web", op: "cancel", handle: one.hash }]); await s.settle();
    await heard(s, service, 1);
    assert.equal(opened(service.calls[0].call, b1).body, fitNotification(await newest(s, one.hash)));
    await s.channelEvents([{ kind: "channel_request", id: "c-2", channel: "web", op: "cancel", handle: two.hash }]); await s.settle();
    await sleep(2500);
    assert.equal(service.calls.length, 1, `the Guard's count of one push a day held:\n${s.log()}`);
    assert.match(s.log(), /refused by the push Guard \(limit_exceeded\)/u, "the runtime read it as the Guard's refusal");
    assert.equal((await push(s, { op: "customer_state", handle: two.hash })).body.phones, 1, "a refusal by the Guard never drops the phone");
    assert.equal((await s.request(two.hash)).body.status, "cancelled");
  });
});

describe("a chat guest's alerts", () => {
  contract("offered only after the shop's first answer; the next answer is pushed to the guest's phone; 'delete my chat' ends them", async () => {
    const { s, guard } = await boot();
    const g = s.guest();
    const b = softBrowser();
    assert.equal((await push(s, { op: "customer_subscribe", handle: g.hash, subscription: b.subscription })).status, 404, "a guest the shop has never seen takes none");
    await s.chat(g.hash, "I want a haircut tomorrow at 6pm");
    const sub = await push(s, { op: "customer_subscribe", handle: g.hash, subscription: b.subscription });
    assert.deepEqual([sub.status, sub.body], [200, { on: true, phones: 1, answered: true }]);
    await s.chat(g.hash, "what time do you open?");
    await heard(s, guard, 1);
    const thread = (await s.call(`/internal/channel/chat?handle=${g.hash}`)).body.lines as { who: string; text: string }[];
    const last = thread.filter((l) => l.who === "shop").at(-1)!.text;
    assert.deepEqual(opened(guard.calls[0].call, b), { title: s.settings.name, body: fitNotification(last), tag: "update" });
    // "delete my chat": the keys, the words and the alerts go
    const forgot = await s.call("/internal/channel/chat-id", { body: { op: "forget", handle: g.hash, language: "en" } });
    assert.equal(forgot.status, 200, JSON.stringify(forgot.body));
    await s.settle(); // the words go by a step
    assert.equal((await push(s, { op: "customer_state", handle: g.hash })).status, 404, "the thread is gone, and with it the page with alerts");
    const db = new DatabaseSync(join(s.dataDir, "push.sqlite"), { readOnly: true });
    try { assert.deepEqual(db.prepare("SELECT dead_why FROM subs").all().map((r) => r.dead_why), ["forgotten"], "the subscription ended as forgotten"); } finally { db.close(); }
    await s.chat(g.hash, "hello again");
    await heard(s, guard, 1);
  });
});
