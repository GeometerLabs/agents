// Web push on the shop's runtime (plan item 11h, decision 45): which subscriptions are taken (only the push services the Guard allows, real P-256 keys), the owner's
// phones and choice, the queue and what each push service answer does to it (sent, gone, refused by the Guard's count and never tried again, tried later), the
// owner's messages routed by choice (WhatsApp, push, both, nothing), and the address rule shared by the runtime and the server's push sender.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createECDH, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeClock } from "../../core/clock.ts";
import { createFakeMessaging } from "../../messaging/messaging.ts";
import { decryptPush } from "../crypto.ts";
import { PUSH_HOSTS, pushCallProblem } from "../hosts.ts";
import type { PushCall } from "../hosts.ts";
import { createPush, ownerRoute, pushMessaging } from "../push.ts";
import { createPushSender, fitNotification } from "../sender.ts";
import { MAX_TRIES, OWNER_PHONES, openPushStore, subscriptionProblem } from "../store.ts";

const T0 = Date.UTC(2026, 10, 16, 3, 30);
function browser(endpoint = `https://fcm.googleapis.com/fcm/send/${randomBytes(8).toString("hex")}`) {
  const ecdh = createECDH("prime256v1"); ecdh.generateKeys();
  const auth = randomBytes(16);
  return { sub: { endpoint, keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: auth.toString("base64url") } }, open: (b: string) => JSON.parse(decryptPush(Buffer.from(b, "base64url"), { privateKey: ecdh.getPrivateKey(), publicKey: ecdh.getPublicKey(), auth }).toString()) };
}
function setup(answer: (call: PushCall, route: string) => number = () => 201) {
  const dir = mkdtempSync(join(tmpdir(), "push-"));
  const store = openPushStore(join(dir, "push.sqlite"));
  const clock = fakeClock(T0);
  const calls: { route: string; call: PushCall; auth?: string }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const route = new URL(url).pathname;
    const call = JSON.parse(String(init.body)) as PushCall;
    calls.push({ route, call, auth: (init.headers as Record<string, string>).authorization });
    const status = answer(call, route);
    return new Response(status === 403 ? JSON.stringify({ error: "refused by the Guard", guard: { reason_code: "limit_exceeded" } }) : "{}", { status });
    // (a 401 here is the push service's own: the subscription's key is not the shop's)
  }) as unknown as typeof fetch;
  const sender = createPushSender({ store, guard: { baseUrl: "http://g-glow-push:8080", agentToken: "agent-token" }, subject: () => "https://pages.example/glow", clock, fetchImpl });
  const push = createPush({ store, sender, shopName: "Glow", clock, on: true });
  return { store, sender, push, clock, calls, done: () => { store.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test("a subscription is taken only at a push service the Guard allows, with a real P-256 key and a 16-byte secret", () => {
  for (const host of PUSH_HOSTS) assert.equal(subscriptionProblem(browser(`https://${host}/x/y`).sub), null, host);
  assert.match(subscriptionProblem(browser("https://push.evil.example/x").sub)!, /not one this shop sends to/u);
  assert.match(subscriptionProblem(browser("http://fcm.googleapis.com/x").sub)!, /plain https/u);
  assert.match(subscriptionProblem(browser("https://fcm.googleapis.com:8443/x").sub)!, /plain https/u);
  const b = browser();
  assert.match(subscriptionProblem({ ...b.sub, keys: { ...b.sub.keys, p256dh: Buffer.alloc(65, 4).toString("base64url") } })!, /point on P-256/u);
  assert.match(subscriptionProblem({ ...b.sub, keys: { ...b.sub.keys, auth: "AAAA" } })!, /16 bytes/u);
  assert.match(subscriptionProblem({ endpoint: "x" })!, /subscription is/u);
});

test("the owner keeps at most five phones; the same address again is the same phone; the choice is WhatsApp until the owner picks", () => {
  const s = setup(); try {
    const phones = Array.from({ length: OWNER_PHONES + 2 }, () => browser());
    for (const p of phones) assert.ok(s.push.subscribe("owner", p.sub).ok);
    assert.equal(s.push.ownerPhones(), OWNER_PHONES, "the oldest went");
    assert.ok(s.push.subscribe("owner", phones.at(-1)!.sub).ok);
    assert.equal(s.push.ownerPhones(), OWNER_PHONES, "the same phone again is one phone");
    assert.equal(s.push.choice(), "whatsapp");
    s.push.setChoice("both"); assert.equal(s.push.choice(), "both");
    assert.throws(() => s.store.setChoice("sms" as never));
    assert.equal(s.push.unsubscribe("owner", phones.at(-1)!.sub.endpoint), true);
    assert.equal(s.push.ownerPhones(), OWNER_PHONES - 1);
  } finally { s.done(); }
});

test("a push goes to the shop's push Guard as the JSON it checks: host, path, the phone's short id, the VAPID header, ciphertext only; the phone opens it", async () => {
  const s = setup(); try {
    const phone = browser();
    s.push.subscribe("owner", phone.sub);
    const ids = s.push.owner("Asha says she paid ₹200 for Mon 16 Nov, 10:30 am. Please check your UPI app.");
    assert.equal(ids.length, 1);
    await s.sender.pass();
    assert.equal(s.calls.length, 1);
    const { route, call, auth } = s.calls[0];
    assert.equal(route, "/v1/push/owner");
    assert.equal(auth, "Bearer agent-token", "the runtime's own credential at its push Guard");
    assert.equal(pushCallProblem(call), null);
    assert.equal(call.host, "fcm.googleapis.com");
    assert.equal(call.path, new URL(phone.sub.endpoint).pathname);
    assert.match(call.sub, /^[0-9a-f]{12}$/u);
    assert.ok(!JSON.stringify(call).includes("Asha") && !JSON.stringify(call).includes("₹200"), "nothing on the way can read it");
    assert.deepEqual(phone.open(call.body), { title: "Glow", body: "Asha says she paid ₹200 for Mon 16 Nov, 10:30 am. Please check your UPI app.", tag: "owner" });
    assert.deepEqual(s.store.counts(T0), { sent: 1 });
    assert.equal(fitNotification("x".repeat(500)).length, 300);
  } finally { s.done(); }
});

test("what the push service or the Guard answers: 410 forgets the phone, the Guard's count refuses and is never tried again, a 503 is tried later and then given up", async () => {
  let status = 410;
  const s = setup(() => status); try {
    const gone = browser(); s.push.subscribe("owner", gone.sub);
    s.push.owner("one"); await s.sender.pass();
    assert.equal(s.push.ownerPhones(), 0, "a 410: the phone dropped the subscription, so it is forgotten");
    assert.deepEqual(s.store.counts(T0), { gone: 1 });

    status = 403;
    const capped = browser(); s.push.subscribe("owner", capped.sub);
    s.push.owner("two"); await s.sender.pass();
    s.clock.advance(60 * 60_000); await s.sender.pass();
    assert.equal(s.calls.filter((c) => c.call.path === new URL(capped.sub.endpoint).pathname).length, 1, "the Guard's daily count said no: not tried again");
    assert.equal(s.store.counts(T0).refused, 1);

    status = 503;
    s.push.owner("three"); await s.sender.pass();
    const tried = () => s.calls.filter((c) => c.call.path === new URL(capped.sub.endpoint).pathname).length;
    assert.equal(tried(), 2);
    await s.sender.pass();
    assert.equal(tried(), 2, "not before its wait");
    for (let i = 0; i < MAX_TRIES + 2; i++) { s.clock.advance(60 * 60_000); await s.sender.pass(); }
    assert.equal(tried(), 1 + MAX_TRIES, "tried a few times, then given up");
    assert.equal(s.store.counts(T0).failed, 1);
  } finally { s.done(); }
});

test("a customer's page: alerts only for that page's own conversation, and only to phones that allowed them", async () => {
  const s = setup(); try {
    const p = browser("https://updates.push.services.mozilla.com/wpush/v2/abc");
    assert.deepEqual(s.push.customer("web:0123456789abcdef", "You're booked!"), [], "nobody allowed alerts: nothing queued");
    s.push.subscribe("web:0123456789abcdef", p.sub);
    assert.equal(s.push.customer("web:fedcba9876543210", "another page's news").length, 0);
    assert.equal(s.push.customer("web:0123456789abcdef", "You're booked!").length, 1);
    await s.sender.pass();
    assert.equal(s.calls[0].route, "/v1/push/customer");
    assert.equal(p.open(s.calls[0].call.body).body, "You're booked!");
  } finally { s.done(); }
});

test("the owner's messages by the owner's choice: WhatsApp, push or both; push alone without WhatsApp; never push alone while no phone has alerts", async () => {
  const s = setup(); const clock = s.clock; try {
    const OWNER = "+919000000000";
    const wa = createFakeMessaging(clock);
    wa.receive(OWNER, "hi");
    wa.receive("+919811111111", "hi");
    const m = pushMessaging(wa, s.push, OWNER, clock);
    assert.equal(ownerRoute(s.push, true), "whatsapp", "no phone with alerts: WhatsApp");
    const a = await m.sendText(OWNER, "first");
    assert.ok(!a.id.startsWith("push-"));
    s.push.subscribe("owner", browser().sub);
    s.push.setChoice("push");
    assert.equal(ownerRoute(s.push, true), "push");
    const b = await m.sendText(OWNER, "second");
    assert.ok(b.id.startsWith("push-") && (await m.getMessage(b.id))?.text === "second", "a push stands in for the send, and is found by its id");
    assert.equal(await m.isWindowOpen(OWNER), true, "push alone: free text, no template needed");
    s.push.setChoice("both");
    const c = await m.sendText(OWNER, "third");
    assert.ok(!c.id.startsWith("push-"), "both: the WhatsApp message is the one recorded");
    assert.deepEqual(wa.outbox().filter((x) => x.to === OWNER).map((x) => x.text), ["first", "third"]);
    assert.equal(Object.values(s.store.counts(T0)).reduce((n, x) => n + x, 0), 2, "push: the second and the third");
    // a customer is never pushed through the owner's route
    await m.sendText("+919811111111", "to a customer");
    assert.equal(wa.outbox().at(-1)!.to, "+919811111111");

    // no WhatsApp at all
    const none = pushMessaging(undefined, s.push, OWNER, clock);
    assert.ok((await none.sendText(OWNER, "by push")).id.startsWith("push-"));
    await assert.rejects(none.sendText("+919811111111", "x"), /no WhatsApp/u, "nobody else can be reached");
    s.push.unsubscribe("owner", ""); // nothing
    const lonely = setup(); try {
      const n = pushMessaging(undefined, lonely.push, OWNER, lonely.clock);
      assert.equal(ownerRoute(lonely.push, false), "none");
      await assert.rejects(n.sendText(OWNER, "x"), /nothing was sent/u, "no WhatsApp and no phone: nothing goes, and the record will say so");
    } finally { lonely.done(); }
  } finally { s.done(); }
});

test("the address rule the runtime and the push sender share: only the host Guard checked, a path that cannot leave it", () => {
  const base: PushCall = { host: "fcm.googleapis.com", path: "/fcm/send/abc:def-1", sub: "0123456789ab", ttl: 60, urgency: "high", vapid: "vapid t=a.b.c, k=AAAA", body: "AAAA" };
  assert.equal(pushCallProblem(base), null);
  assert.match(pushCallProblem({ ...base, host: "evil.example" })!, /host/u);
  for (const path of ["//evil.example/x", "/a/../b", "/@evil.example", "no-slash"]) assert.match(pushCallProblem({ ...base, path })!, /path/u, path);
  assert.match(pushCallProblem({ ...base, ttl: -1 })!, /ttl/u);
  assert.match(pushCallProblem({ ...base, body: "not base64!" })!, /body/u);
});

test("the pages' own scripts and workers are well-formed JavaScript (their behaviour in a browser is tested by hand: modules/Deferred.md)", async () => {
  const { ALERTS_SCRIPT, CUSTOMER_SW } = await import("../pages.ts");
  const { PASSKEY_SCRIPT } = await import("../../channels/owner-passkey-page.ts");
  const { OWNER_APP_SW } = await import("../../assistant/app/pwa.ts");
  // item 11i: the owner's app runs one script made of the dark/light switch, the talk box's part and the alerts' part (look.ts themeScript)
  const { themeScript } = await import("../../channels/look.ts");
  const { talkScript } = await import("../../assistant/app/talk.ts");
  const OWNER_APP_SCRIPT = themeScript([talkScript("https://pages.example/glow/owner"), ALERTS_SCRIPT]);
  for (const [name, code] of Object.entries({ ALERTS_SCRIPT, CUSTOMER_SW, PASSKEY_SCRIPT, OWNER_APP_SW, OWNER_APP_SCRIPT })) assert.doesNotThrow(() => new Function(code), name);
  assert.match(OWNER_APP_SW, /addEventListener\("push"/u);
  assert.match(OWNER_APP_SW, /addEventListener\("notificationclick"/u);
  assert.doesNotMatch(CUSTOMER_SW, /addEventListener\("fetch"/u, "a customer's worker keeps and fetches nothing");
});

test("a push service's own 401 (the phone subscribed with another key: a restored server) forgets that phone; the Guard's 403 names its reason and only refuses", async () => {
  const s = setup(() => 401); try {
    s.push.subscribe("owner", browser().sub);
    s.push.owner("x"); await s.sender.pass();
    assert.equal(s.push.ownerPhones(), 0);
    assert.deepEqual(s.store.counts(T0), { gone: 1 });
  } finally { s.done(); }
});
