// Web push's cryptography (modules/push/crypto.ts) against the two RFCs' own published examples, so these tests show agreement with the standard and not only
// with this code's own encoder: RFC 8291 Appendix A (the encrypted message, byte for byte) and RFC 8292 section 2.4 (the example JWT verifies under its key).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createECDH, randomBytes } from "node:crypto";
import { MAX_PLAINTEXT, decryptPush, encryptPush, newVapidKeys, readVapidHeader, vapidHeader, vapidVerifies } from "../crypto.ts";

const u = (s: string) => Buffer.from(s.replace(/\s+/gu, ""), "base64url");

// RFC 8291, Appendix A
const PLAINTEXT = "When I grow up, I want to be a watermelon";
const AS_PRIVATE = u("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw");
const AS_PUBLIC = u("BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8");
const UA_PRIVATE = u("q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94");
const UA_PUBLIC = u("BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4");
const SALT = u("DGv6ra1nlYgDCS1FRnbzlw");
const AUTH = u("BTBZMqHH6r4Tts7J_aSIgg");
const BODY = u(`DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml
  mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT
  pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN`);

test("RFC 8291 Appendix A: the same keys and salt give the RFC's message byte for byte", () => {
  assert.equal(BODY.length, 144, "the example's body (its Content-Length 145 counts a line ending)");
  const body = encryptPush(Buffer.from(PLAINTEXT), { p256dh: UA_PUBLIC, auth: AUTH }, { fixed: { salt: SALT, senderPrivate: AS_PRIVATE } });
  assert.equal(body.toString("base64url"), BODY.toString("base64url"));
  assert.deepEqual(body.subarray(21, 86), AS_PUBLIC, "the header names the sender's public key");
});

test("RFC 8291 Appendix A: the browser's side opens the RFC's message", () => {
  assert.equal(decryptPush(BODY, { privateKey: UA_PRIVATE, publicKey: UA_PUBLIC, auth: AUTH }).toString(), PLAINTEXT);
});

test("a fresh key and salt each time, padding hides the length, and only the subscriber can read it", () => {
  const browser = createECDH("prime256v1"); browser.generateKeys();
  const auth = randomBytes(16);
  const keys = { p256dh: browser.getPublicKey(), auth };
  const a = encryptPush(Buffer.from("Refund ₹500 waits for you"), keys, { padTo: 128 });
  const b = encryptPush(Buffer.from("Refund ₹500 waits for you"), keys, { padTo: 128 });
  assert.notDeepEqual(a.subarray(0, 16), b.subarray(0, 16), "a new salt each time");
  assert.equal(a.length, 86 + 128 + 16, "header, one padded record of 128 bytes, the tag");
  assert.equal(encryptPush(Buffer.from("x".repeat(120)), keys, { padTo: 128 }).length, a.length, "a different length of words, the same size on the wire");
  const me = { privateKey: browser.getPrivateKey(), publicKey: browser.getPublicKey(), auth };
  assert.equal(decryptPush(a, me).toString(), "Refund ₹500 waits for you");
  const other = createECDH("prime256v1"); other.generateKeys();
  assert.throws(() => decryptPush(a, { privateKey: other.getPrivateKey(), publicKey: other.getPublicKey(), auth }), "another browser's key opens nothing");
  assert.throws(() => decryptPush(a, { ...me, auth: randomBytes(16) }), "nor does the right key with another auth secret");
  assert.throws(() => encryptPush(Buffer.alloc(MAX_PLAINTEXT + 1), keys), /at most/u);
  assert.throws(() => encryptPush(Buffer.from("x"), { p256dh: Buffer.alloc(65), auth }), /P-256/u);
  assert.throws(() => encryptPush(Buffer.from("x"), { p256dh: keys.p256dh, auth: Buffer.alloc(8) }), /16 bytes/u);
});

// RFC 8292, section 2.4 (Figure 1): the example JWT and its public key
const RFC8292_JWT = [
  "eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9",
  "eyJhdWQiOiJodHRwczovL3B1c2guZXhhbXBsZS5uZXQiLCJleHAiOjE0NTM1MjM3NjgsInN1YiI6Im1haWx0bzpwdXNoQGV4YW1wbGUuY29tIn0",
  "i3CYb7t4xfxCDquptFOepC9GAu_HLGkMlMuCGSK2rpiUfnK9ojFwDXb1JrErtmysazNjjvW2L9OkSSHzvoD1oA",
].join(".");
const RFC8292_KEY = "BA1Hxzyi1RUM1b5wjxsn7nGxAszw2u61m164i3MrAIxHF6YK5h4SDYic-dRuU_RCPCfA5aq9ojSwk5Y2EmClBPs";

test("RFC 8292 section 2.4: the example JWT verifies under the example key (raw r||s, not DER), and a changed claim does not", () => {
  assert.deepEqual(JSON.parse(Buffer.from(RFC8292_JWT.split(".")[1], "base64url").toString()), { aud: "https://push.example.net", exp: 1453523768, sub: "mailto:push@example.com" });
  assert.equal(vapidVerifies(RFC8292_JWT, RFC8292_KEY), true);
  const [h, , s] = RFC8292_JWT.split(".");
  const forged = Buffer.from(JSON.stringify({ aud: "https://push.example.net", exp: 1953523768, sub: "mailto:push@example.com" })).toString("base64url");
  assert.equal(vapidVerifies(`${h}.${forged}.${s}`, RFC8292_KEY), false);
  assert.deepEqual(readVapidHeader(`vapid t=${RFC8292_JWT}, k=${RFC8292_KEY}`), { t: RFC8292_JWT, k: RFC8292_KEY });
});

test("the shop's header: ES256 for the push service's origin, at most 24 hours, the page as the contact; it verifies only under the shop's own key", () => {
  const keys = newVapidKeys();
  assert.equal(Buffer.from(keys.publicKey, "base64url").length, 65);
  const value = vapidHeader(keys, { audience: "https://fcm.googleapis.com", subject: "https://pages.example/glow", nowS: 1_800_000_000 });
  const parts = readVapidHeader(value)!;
  assert.equal(parts.k, keys.publicKey);
  const claims = JSON.parse(Buffer.from(parts.t.split(".")[1], "base64url").toString());
  assert.deepEqual(claims, { aud: "https://fcm.googleapis.com", exp: 1_800_000_000 + 12 * 3600, sub: "https://pages.example/glow" });
  assert.equal(Buffer.from(parts.t.split(".")[2], "base64url").length, 64, "a JWT's ES256 signature is the raw 64 bytes");
  assert.equal(vapidVerifies(parts.t, keys.publicKey), true);
  assert.equal(vapidVerifies(parts.t, newVapidKeys().publicKey), false);
});
