// The Streetlist app's push relay (W3, 17 Nov 2026): what it will sign and what it will not, that it signs and posts in one step and never hands a header back, that its own
// refusals can never make a runtime drop a good phone, its limits per shop and per phone, the key file, and the settings that turn it on. Written 17 Nov, not run when written.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newVapidKeys, readVapidHeader, vapidVerifies } from "../../modules/push/crypto.ts";
import { pushCallProblem } from "../../modules/push/hosts.ts";
import type { PushCall } from "../../modules/push/hosts.ts";
import { RELAY_LIMITS, RELAY_SIGNATURE_S, createRelay, makeRelayKeyFile, parseRelayKeys, readRelayKeys } from "../services/push-relay.ts";
import { pushHandler } from "../services/push.ts";
import { parseServer } from "../lib/server.ts";
import { serverConfig } from "./helpers.ts";

const keys = newVapidKeys();
const T0 = Date.UTC(2026, 10, 17, 9, 0);
const call = (extra: Partial<PushCall> = {}): PushCall => ({ host: "fcm.googleapis.com", path: "/fcm/send/abc:1", sub: "0123456789ab", ttl: 43200, urgency: "normal", topic: "customer-0123456789ab", relay: "glow-salon", body: Buffer.from("ciphertext-bytes-the-relay-cannot-read").toString("base64url"), ...extra });
const relay = (o: { now?: () => number; limits?: Partial<typeof RELAY_LIMITS> } = {}) => createRelay({ keys, shops: ["glow-salon", "vidya-tuition"], subject: "https://streetlist.in", now: o.now ?? (() => T0), ...(o.limits ? { limits: o.limits } : {}) });

test("a well-formed call from a known shop is signed with Streetlist's key: audience the push service, a short life, the shop's name gone, the ciphertext untouched", () => {
  const a = relay().sign(call());
  assert.ok(a.ok);
  const sent = (a as { ok: true; call: PushCall }).call;
  assert.equal(sent.relay, undefined, "the shop's name is not passed on to the push service's request");
  assert.equal(sent.body, call().body, "the relay passes the ciphertext on exactly");
  const h = readVapidHeader(sent.vapid!)!;
  assert.equal(h.k, keys.publicKey);
  assert.ok(vapidVerifies(h.t, keys.publicKey), "the signature verifies under Streetlist's public key");
  const claims = JSON.parse(Buffer.from(h.t.split(".")[1]!, "base64url").toString()) as { aud: string; exp: number; sub: string };
  assert.equal(claims.aud, "https://fcm.googleapis.com", "the audience is built from the checked host");
  assert.equal(claims.sub, "https://streetlist.in");
  assert.equal(claims.exp, Math.floor(T0 / 1000) + RELAY_SIGNATURE_S);
  assert.ok(RELAY_SIGNATURE_S <= 3600, "short-lived: a leaked header would be good for minutes");
});

test("it signs only what pushCallProblem allows, for a shop it knows, at a push service on the list; every refusal is a 400, never a status that drops a phone", () => {
  const r = relay();
  const refused = (c: unknown) => { const a = r.sign(c as PushCall); assert.equal(a.ok, false); return (a as { ok: false; status: number; error: string }); };
  for (const bad of [
    call({ relay: "someone-else" }), call({ host: "evil.example" }), call({ path: "//evil.example/x" }), call({ path: "/a/../b" }), call({ sub: "not-hex" }), call({ ttl: 99_999_999 }),
    call({ urgency: "urgent" as never }), call({ topic: "has spaces" }), call({ body: "not base64url!" }), call({ body: "A".repeat(6000) }), call({ vapid: "vapid t=a.b.c, k=abc" }), call({ relay: "../etc" }),
  ]) {
    const a = refused(bad);
    assert.equal(a.status, 400, JSON.stringify(bad).slice(0, 80));
    assert.ok(![401, 403, 404, 410].includes(a.status));
    assert.doesNotMatch(a.error, /vapid t=/u, "an error never carries a signature");
  }
  assert.equal(refused({ ...call(), relay: undefined }).status, 400, "a call with neither relay nor vapid is not a relay call");
  assert.equal(refused(null).status, 400);
  assert.ok(pushCallProblem(call()) === null, "the shared check accepts a relay call");
  assert.match(pushCallProblem(call({ vapid: "vapid t=a.b.c, k=abc" }))!, /relay/u);
});

test("limits: a shop's burst, its day and one phone's day each stop at their count with a 429, and clear as time passes", () => {
  let t = T0;
  const r = relay({ now: () => t, limits: { perShopPerMinute: 3, perShopPerDay: 5, perPhonePerDay: 4 } });
  const sign = (extra: Partial<PushCall> = {}) => r.sign(call(extra));
  assert.ok(sign().ok && sign().ok && sign().ok);
  const burst = sign();
  assert.equal(burst.ok, false);
  assert.equal((burst as { status: number }).status, 429);
  assert.ok(sign({ relay: "vidya-tuition" }).ok, "another shop has its own count");
  t += 61_000;
  assert.ok(sign({ sub: "ffffffffffff" }).ok, "the minute passed: a different phone of the same shop goes; the shop is now at 4 of 5 today");
  assert.ok(sign({ sub: "eeeeeeeeeeee" }).ok);
  assert.equal(sign({ sub: "dddddddddddd" }).ok, false, "the shop's day is used up");
  t += 25 * 3600_000;
  assert.ok(sign().ok, "a day later everything is clear");
  const phone = relay({ now: () => t, limits: { perShopPerMinute: 99, perShopPerDay: 99, perPhonePerDay: 2 } });
  assert.ok(phone.sign(call()).ok && phone.sign(call()).ok);
  assert.equal(phone.sign(call()).ok, false, "one phone is not flooded");
  assert.ok(phone.sign(call({ sub: "aaaaaaaaaaaa" })).ok, "another phone is fine");
});

test("the relay never opens a push: no decryption code in it, and it never returns the signed header", () => {
  const source = readFileSync(new URL("../services/push-relay.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /decryptPush|createDecipheriv|createECDH|hkdfSync/u, "it holds no way to read a push");
  const handler = readFileSync(new URL("../services/push.ts", import.meta.url), "utf8");
  assert.doesNotMatch(handler, /answer\([^)]*vapid/u, "the sender never answers with a header");
});

/** The sender as a server, with a fake push service behind it that records what it was sent. */
async function senderWith(relayOn: boolean) {
  const reached: { url: string; headers: Record<string, string>; body: Buffer }[] = [];
  const handler = pushHandler({
    ...(relayOn ? { relay: relay() } : {}),
    fetchImpl: (async (url: string, init: RequestInit) => { reached.push({ url, headers: init.headers as Record<string, string>, body: Buffer.from(init.body as Uint8Array) }); return new Response(null, { status: 201 }); }) as unknown as typeof fetch,
  });
  const server = createServer((req, res) => { void handler(req, res); });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const at = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const post = (body: unknown) => fetch(`${at}/v1/push/customer`, { method: "POST", body: JSON.stringify(body) });
  return { reached, post, close: () => server.close() };
}

test("through the sender: a relay call is signed and posted in one step, the answer is only the push service's status, the posted bytes are the ciphertext", async () => {
  const s = await senderWith(true);
  try {
    const r = await s.post(call());
    assert.equal(r.status, 201);
    const text = await r.text();
    assert.deepEqual(JSON.parse(text), { status: 201 });
    assert.doesNotMatch(text, /vapid|signature|t=/u);
    assert.equal(s.reached.length, 1);
    assert.equal(s.reached[0]!.url, "https://fcm.googleapis.com/fcm/send/abc:1");
    assert.equal(s.reached[0]!.body.toString(), "ciphertext-bytes-the-relay-cannot-read");
    const header = readVapidHeader(s.reached[0]!.headers.authorization!)!;
    assert.equal(header.k, keys.publicKey, "Streetlist's key, which the shop never held");
    assert.ok(vapidVerifies(header.t, keys.publicKey));
    // a call refused by the relay never reaches a push service, and is a 400 or 429 (never a status that drops a phone)
    for (const bad of [call({ relay: "stranger" }), call({ host: "evil.example" })]) assert.equal((await s.post(bad)).status, 400);
    assert.equal(s.reached.length, 1);
  } finally { s.close(); }
});

test("a server without the relay answers a relay call 503 (try later), and a shop's own signed call still goes as before", async () => {
  const s = await senderWith(false);
  try {
    assert.equal((await s.post(call())).status, 503);
    assert.equal(s.reached.length, 0);
    const own = { ...call(), relay: undefined, vapid: "vapid t=aaa.bbb.ccc, k=BBBB" };
    delete (own as { relay?: string }).relay;
    assert.equal((await s.post(own)).status, 201, "a shop not on Streetlist keeps signing with its own key");
    assert.equal(s.reached[0]!.headers.authorization, "vapid t=aaa.bbb.ccc, k=BBBB");
  } finally { s.close(); }
});

test("the key file: made once at 0600 and never overwritten; its public half must be its private key's own", () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-"));
  try {
    const file = join(dir, "streetlist_vapid.json");
    const pub = makeRelayKeyFile(file);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(readRelayKeys(file).publicKey, pub);
    assert.throws(() => makeRelayKeyFile(file), /already exists/u);
    const stored = JSON.parse(readFileSync(file, "utf8"));
    assert.throws(() => parseRelayKeys(JSON.stringify({ ...stored, publicKey: newVapidKeys().publicKey })), /not the public half/u);
    assert.throws(() => parseRelayKeys("{}"), /P-256/u);
    assert.throws(() => parseRelayKeys("nope"), /not JSON/u);
    writeFileSync(join(dir, "x"), "y");
    assert.ok(existsSync(join(dir, "x")));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("geometer.json: pushRelay needs pages and a 65-byte public key; the private half is never accepted here", () => {
  const base = { schema: 1, id: "partner-1", domain: "partners.example", reviewedBy: "me", model: { wire: "openai", model: "x" }, panel: { enabled: true, mode: "hosted" }, fleet: { url: "https://fleet.example", keyFile: "fleet.key" }, pages: { domain: "streetlist.in", extraDomains: [] } };
  assert.deepEqual(parseServer({ ...base, pushRelay: { publicKey: keys.publicKey } }).errors.filter((e) => /pushRelay/u.test(e)), []);
  assert.ok(parseServer({ ...base, pushRelay: { publicKey: "short" } }).errors.some((e) => /pushRelay/u.test(e)));
  assert.ok(parseServer({ ...base, pushRelay: { publicKey: keys.publicKey, privateJwk: keys.privateJwk } }).errors.some((e) => /pushRelay/u.test(e)), "a private key cannot ride in geometer.json");
  const { pages: _pages, ...noPages } = base;
  assert.ok(parseServer({ ...noPages, pushRelay: { publicKey: keys.publicKey } }).errors.some((e) => /needs "pages"/u.test(e)));
  assert.equal(serverConfig().pushRelay, undefined);
});
