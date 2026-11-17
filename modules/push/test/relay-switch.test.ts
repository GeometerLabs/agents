// The runtime's switch between its own VAPID key and Streetlist's relay (W3, 17 Nov 2026): a phone is signed by the key it subscribed for, decided when it subscribes; a shop not
// served through the door keeps its own key and cannot take a relay phone; a relay phone's push goes out with no signature (the relay signs) and the shop's address name inside
// the encryption; an older store gains the column; the page's choice of key and worker is one function for render and subscribe. Written 17 Nov, not run when written.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createECDH, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeClock } from "../../core/clock.ts";
import { decryptPush, newVapidKeys } from "../crypto.ts";
import { PAGE_SLUG, pushCallProblem, slugOfPage } from "../hosts.ts";
import type { PushCall } from "../hosts.ts";
import { createPush } from "../push.ts";
import { createPushSender } from "../sender.ts";
import { openPushStore } from "../store.ts";
import { chatPolicy, pushChoice } from "../../channels/chat-front.ts";
import { BOOKINGS_SERVICES, readRuntimeConfig } from "../../runtime/config.ts";

const T0 = Date.UTC(2026, 10, 17, 9, 0);
const RELAY_KEY = newVapidKeys().publicKey;

function phone() {
  const ecdh = createECDH("prime256v1"); ecdh.generateKeys();
  const auth = randomBytes(16);
  return {
    sub: { endpoint: `https://fcm.googleapis.com/fcm/send/${randomBytes(8).toString("hex")}`, keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: auth.toString("base64url") } },
    open: (body: string) => JSON.parse(decryptPush(Buffer.from(body, "base64url"), { privateKey: ecdh.getPrivateKey(), publicKey: ecdh.getPublicKey(), auth }).toString()) as { title: string; body: string; tag: string; slug?: string },
  };
}

function setup(o: { relay?: boolean; pageUrl?: string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "relay-switch-"));
  const store = openPushStore(join(dir, "push.sqlite"));
  const clock = fakeClock(T0);
  const calls: PushCall[] = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => { calls.push(JSON.parse(String(init.body)) as PushCall); return new Response("{}", { status: 201 }); }) as unknown as typeof fetch;
  const sender = createPushSender({
    store, guard: { baseUrl: "http://g-glow-push:8080" }, subject: () => "https://streetlist.in/glow-salon", clock, fetchImpl,
    ...(o.relay ? { relay: { shop: "glow-salon", slug: () => slugOfPage(o.pageUrl ?? "https://streetlist.in/glow-salon") } } : {}),
  });
  const push = createPush({ store, sender, shopName: "Glow Salon", clock, on: true, ...(o.relay ? { relayKey: RELAY_KEY } : {}) });
  return { store, sender, push, calls, done: () => { store.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test("a shop with a relay takes a phone for Streetlist's key; a shop without one refuses it, and the owner's phones are always the shop's own", () => {
  const withRelay = setup({ relay: true }); const without = setup();
  try {
    assert.ok(withRelay.push.subscribe("web:aaaa", phone().sub, "streetlist").ok);
    assert.equal(withRelay.push.relayKey(), RELAY_KEY);
    const refused = without.push.subscribe("web:aaaa", phone().sub, "streetlist");
    assert.equal(refused.ok, false);
    assert.match((refused as { why: string }).why, /does not send through the Streetlist app/u);
    assert.equal(without.push.relayKey(), undefined);
    assert.ok(without.push.subscribe("web:aaaa", phone().sub).ok, "its own key, as before");
  } finally { withRelay.done(); without.done(); }
});

test("a relay phone's push has no signature and names the shop to the relay; the shop's address name is inside the encryption, the tag is the shop's own", async () => {
  const s = setup({ relay: true });
  try {
    const p = phone();
    assert.ok(s.push.subscribe("web:aaaa", p.sub, "streetlist").ok);
    assert.equal(s.push.customer("web:aaaa", "Your slot is confirmed").length, 1);
    await s.sender.pass();
    assert.equal(s.calls.length, 1);
    const c = s.calls[0]!;
    assert.equal(c.vapid, undefined, "the shop cannot sign for a key it does not hold");
    assert.equal(c.relay, "glow-salon");
    assert.equal(pushCallProblem(c), null);
    assert.equal(c.host, "fcm.googleapis.com");
    const inside = p.open(c.body);
    assert.equal(inside.body, "Your slot is confirmed");
    assert.equal(inside.slug, "glow-salon", "the app's worker opens this shop's chat from it");
    assert.equal(JSON.stringify(c).includes("Your slot"), false, "no plain words outside the encryption");
  } finally { s.done(); }
});

test("a phone on the shop's own key is signed by the shop as before, whether or not the shop has a relay; no slug travels", async () => {
  for (const relay of [true, false]) {
    const s = setup({ relay });
    try {
      const p = phone();
      assert.ok(s.push.subscribe("web:aaaa", p.sub).ok);
      s.push.customer("web:aaaa", "Hello");
      await s.sender.pass();
      const c = s.calls[0]!;
      assert.match(c.vapid ?? "", /^vapid t=.+, k=/u);
      assert.equal(c.relay, undefined);
      assert.equal(p.open(c.body).slug, undefined);
    } finally { s.done(); }
  }
});

test("a relay phone on a shop that lost its relay is refused once and never tried again; nothing is sent unsigned", async () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-switch-"));
  try {
    const store = openPushStore(join(dir, "push.sqlite"));
    const calls: PushCall[] = [];
    const clock = fakeClock(T0);
    store.subscribe("web:aaaa", phone().sub, T0, "streetlist");
    store.enqueue("web:aaaa", "customer", { title: "Glow", body: "x", tag: "update" }, T0);
    const sender = createPushSender({ store, guard: { baseUrl: "http://g" }, subject: () => "https://p/x", clock, fetchImpl: (async (_u: string, init: RequestInit) => { calls.push(JSON.parse(String(init.body))); return new Response("{}", { status: 201 }); }) as unknown as typeof fetch });
    await sender.pass();
    assert.deepEqual(calls, []);
    assert.equal(store.counts(0).refused, 1);
    store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("an older store (no signer column) gains it once, keeps its phones as the shop's own", () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-switch-"));
  try {
    const file = join(dir, "old.sqlite");
    const old = new DatabaseSync(file);
    old.exec(`CREATE TABLE subs (id TEXT PRIMARY KEY, who TEXT NOT NULL, host TEXT NOT NULL, path TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, made_at INTEGER NOT NULL, dead_at INTEGER, dead_why TEXT, UNIQUE (host, path));
      INSERT INTO subs (id, who, host, path, p256dh, auth, made_at) VALUES ('aabbccddeeff', 'owner', 'fcm.googleapis.com', '/x', 'AA', 'BB', 1);`);
    old.close();
    const store = openPushStore(file);
    assert.equal(store.phones("owner"), 1);
    const again = openPushStore(file); // opening twice never fails on a column that is already there
    again.close();
    const row = new DatabaseSync(file).prepare("SELECT signer FROM subs").get() as { signer: string };
    assert.equal(row.signer, "own");
    store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the page's key and worker are one choice: the Streetlist app's through the door when the shop has a relay, else the shop's own", () => {
  const key = { publicKey: "OWNKEY", relayKey: "RELAYKEY" };
  const door = "https://streetlist.in/glow-salon";
  assert.deepEqual(pushChoice(key, true, door), { key: "RELAYKEY", via: { sw: "https://streetlist.in/sw.js", scope: "https://streetlist.in/" }, signer: "streetlist" });
  assert.deepEqual(pushChoice(key, false, door), { key: "OWNKEY", signer: "own" }, "a page not through the door keeps the shop's key and its own worker");
  assert.deepEqual(pushChoice({ publicKey: "OWNKEY" }, true, door), { key: "OWNKEY", signer: "own" }, "no relay: the shop's own key even through the door");
  assert.equal(pushChoice(undefined, true, door), undefined);
  assert.equal(pushChoice({ relayKey: "x" }, true, door), undefined);
});

test("the chat page's policy names the app's worker and manifest at their exact addresses only through the door, never 'self'", () => {
  const base = "https://streetlist.in/glow-salon/chat";
  const plain = chatPolicy(base, "N");
  assert.doesNotMatch(plain, /manifest-src/u);
  assert.match(plain, /worker-src https:\/\/streetlist\.in\/glow-salon\/chat\/sw\.js(;|$)/u);
  const app = chatPolicy(base, "N", { origin: "https://streetlist.in", worker: true });
  assert.match(app, /worker-src https:\/\/streetlist\.in\/glow-salon\/chat\/sw\.js https:\/\/streetlist\.in\/sw\.js;/u);
  assert.match(app, /manifest-src https:\/\/streetlist\.in\/manifest\.webmanifest/u);
  assert.doesNotMatch(app, /'self'/u);
  assert.doesNotMatch(chatPolicy(base, "N", { origin: "https://streetlist.in", worker: false }), /streetlist\.in\/sw\.js/u, "no relay: no root worker");
});

test("the address name: the first path part of the page, only in the shape fleet allows", () => {
  assert.equal(slugOfPage("https://streetlist.in/glow-salon"), "glow-salon");
  assert.equal(slugOfPage("https://streetlist.in/glow-salon/"), "glow-salon");
  for (const bad of [undefined, "", "not a url", "https://streetlist.in/", "https://streetlist.in/UPPER", "https://streetlist.in/a--b", "https://streetlist.in/12345"]) assert.equal(slugOfPage(bad), undefined, String(bad));
  assert.ok(PAGE_SLUG.test("glow-salon"));
});

test("runtime.json: the relay's two fields are both or neither, the key is a P-256 public key, and an older runtime would refuse them (the bundle drops them first)", () => {
  const base = { mode: "live", host: "0.0.0.0", port: 8787, dataDir: "data", tickSeconds: 30, services: { payments: { baseUrl: "http://g1" }, calendar: { baseUrl: "http://g2", calendarId: "c" }, push: { baseUrl: "http://g3" } } };
  const withPush = (push: Record<string, unknown>) => ({ ...base, services: { ...base.services, push } });
  const check = (r: unknown) => readRuntimeConfig(r, "/shop", BOOKINGS_SERVICES);
  assert.equal(check(withPush({ baseUrl: "http://g3" })).ok, true, "the base runtime.json is valid");
  assert.equal(check(withPush({ baseUrl: "http://g3", relayKey: RELAY_KEY, relayShop: "glow-salon" })).ok, true, "the two fields do not break a valid runtime.json");
  assert.equal(check(withPush({ baseUrl: "http://g3", relayKey: RELAY_KEY })).ok, false, "a key with no shop name");
  assert.equal(check(withPush({ baseUrl: "http://g3", relayKey: "short", relayShop: "glow-salon" })).ok, false, "not a P-256 public key");
});
