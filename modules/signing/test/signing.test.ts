// Canonical JSON (RFC 8785 for our value set) and Ed25519 signatures of the feed, the check answer, the notice and the Agent Card. The first tests use
// the RFC's own examples (its section 3.2.3 sorting data, Appendix C's address record and Appendix B's integer rows) so the writer is checked against the
// specification, not only against itself. Written 18 Nov 2026.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CanonicalError, canonicalJson } from "../canonical.ts";
import { generateSigningKey, keyIdOf, privateText, publicKeyObject, rawOfPublic, signingKeyFromText } from "../keys.ts";
import { signAnswer, signFeed, signNotice, signValue, verifyDocument, verifyNotice, verifyValue } from "../sign.ts";
import { signCard, verifyCard } from "../jws.ts";

test("RFC 8785 section 3.2.3: member names sort by UTF-16 code units (the surrogate pair of the emoji sorts before U+FB33)", () => {
  const input = JSON.parse(`{"\\u20ac":"Euro Sign","\\r":"Carriage Return","\\ufb33":"Hebrew Letter Dalet With Dagesh","1":"One","\\ud83d\\ude00":"Emoji: Grinning Face","\\u0080":"Control","\\u00f6":"Latin Small Letter O With Diaeresis"}`);
  const expected = '{"\\r":"Carriage Return","1":"One","\u0080":"Control","ö":"Latin Small Letter O With Diaeresis","€":"Euro Sign","😀":"Emoji: Grinning Face","דּ":"Hebrew Letter Dalet With Dagesh"}';
  assert.equal(canonicalJson(input), expected);
});

test("RFC 8785 Appendix C: the address record comes out as address, city, name, state, zip, on one line", () => {
  const record = { name: "John Doe", address: "2000 Sunset Boulevard", city: "Los Angeles", zip: "90001", state: "CA" };
  assert.equal(canonicalJson(record), '{"address":"2000 Sunset Boulevard","city":"Los Angeles","name":"John Doe","state":"CA","zip":"90001"}');
});

test("RFC 8785 section 3.2.2.2 and Appendix B: strings escape the JSON way, integers are written plainly, minus zero is 0", () => {
  assert.equal(canonicalJson("a\n\t\"\\\u000f\u007f"), '"a\\n\\t\\"\\\\\\u000f\u007f"', "control characters as \\u00xx in lowercase, DEL left as it is");
  assert.equal(canonicalJson([0, -0, 9007199254740992 - 1, -9007199254740991, 12]), "[0,0,9007199254740991,-9007199254740991,12]");
  assert.equal(canonicalJson({ b: [true, false, null], a: {} }), '{"a":{},"b":[true,false,null]}');
});

test("what has no canonical form is refused, loudly: floats, NaN, undefined members, dates, maps, lone surrogates", () => {
  for (const bad of [1.5, NaN, Infinity, 9007199254740992, { a: undefined }, new Date(0), new Map(), "\ud800", { "\ud800": 1 }, () => 1, 10n]) {
    assert.throws(() => canonicalJson(bad), CanonicalError, String(bad));
  }
  assert.throws(() => canonicalJson({ a: { b: [1, 0.25] } }), /\.a\.b\[1\]/u, "the message says where");
});

test("a key: the id is the base64url SHA-256 of the raw 32 bytes, the public text is SPKI DER, and the private text round-trips", () => {
  const key = generateSigningKey();
  assert.equal(rawOfPublic(key.publicKey)!.length, 32);
  assert.equal(key.keyId, keyIdOf(key.publicKey));
  assert.equal(key.keyId.length, 43);
  assert.match(key.keyId, /^[A-Za-z0-9_-]{43}$/u);
  const again = signingKeyFromText(privateText(key));
  assert.equal(again.publicKey, key.publicKey);
  assert.equal(rawOfPublic("not a key"), undefined);
  assert.equal(publicKeyObject(key.publicKey + "A"), undefined);
  assert.throws(() => keyIdOf("AAAA"));
});

test("a signature checks; a changed price, a changed member name or another key does not", () => {
  const key = generateSigningKey();
  const other = generateSigningKey();
  const doc = { format: "shop-feed/1", items: [{ id: "l-3", price: { value: "8000.00", currency: "INR" } }] };
  const sig = signValue(doc, key);
  assert.equal(sig.length, 86);
  assert.ok(verifyValue(doc, sig, key.publicKey));
  assert.ok(verifyValue(JSON.parse(JSON.stringify(doc)), sig, key.publicKey), "the same content in another key order is the same bytes");
  assert.ok(!verifyValue({ ...doc, items: [{ id: "l-3", price: { value: "800.00", currency: "INR" } }] }, sig, key.publicKey), "a changed price");
  assert.ok(!verifyValue({ ...doc, extra: 1 }, sig, key.publicKey), "an added member");
  assert.ok(!verifyValue(doc, sig, other.publicKey), "another key");
  assert.ok(!verifyValue(doc, sig.slice(0, -1) + (sig.endsWith("A") ? "B" : "A"), key.publicKey), "a damaged signature");
  assert.ok(!verifyValue(doc, "short", key.publicKey) && !verifyValue(doc, sig, "junk") && !verifyValue({ a: 1.5 }, sig, key.publicKey));
});

test("a feed: signed with its key inside, checked on first sight, and refused after any change", () => {
  const key = generateSigningKey();
  const feed = signFeed({ format: "shop-feed/1", updated: "2026-11-18T03:30:00.000Z", items: [{ id: "l-3", price: { value: "8000.00", currency: "INR" } }] }, key);
  assert.deepEqual(Object.keys(feed.signature).sort(), ["alg", "key", "keyId", "sig"]);
  assert.deepEqual(verifyDocument(feed), { ok: true, keyId: key.keyId });
  assert.deepEqual(verifyDocument(feed, key.publicKey), { ok: true, keyId: key.keyId }, "with the pinned key too");
  const cheaper = structuredClone(feed); (cheaper.items[0].price as { value: string }).value = "80.00";
  assert.deepEqual(verifyDocument(cheaper), { ok: false, reason: "bad_signature" });
  const swapped = signFeed({ ...structuredClone(feed) }, generateSigningKey());
  assert.deepEqual(verifyDocument(swapped, key.publicKey), { ok: false, reason: "key_mismatch" }, "a feed carrying another key than the pinned one is not checked against its own");
  assert.deepEqual(verifyDocument({ format: "x" }), { ok: false, reason: "no_signature" });
  assert.deepEqual(verifyDocument({ a: 1, signature: { alg: "RS256", keyId: "k", sig: "s" } }), { ok: false, reason: "wrong_alg" });
  assert.deepEqual(verifyDocument({ a: 1, signature: { alg: "Ed25519", keyId: "k", sig: "s" } }), { ok: false, reason: "no_key" });
  const wrongId = structuredClone(feed); wrongId.signature.keyId = "x".repeat(43);
  assert.deepEqual(verifyDocument(wrongId), { ok: false, reason: "key_mismatch" });
});

test("a check answer carries no key and is checked with the pinned one; a notice carries keyId and sig", () => {
  const key = generateSigningKey();
  const answer = signAnswer({ format: "shop-check/1", page: "https://p.example/rani/", at: "2026-11-18T09:12:00.000Z", items: [{ id: "l-7", availability: "gone" }] }, key);
  assert.equal(answer.signature.key, undefined);
  assert.ok(verifyDocument(answer, key.publicKey).ok);
  assert.deepEqual(verifyDocument(answer), { ok: false, reason: "no_key" });
  assert.ok(!verifyDocument({ ...answer, items: [{ id: "l-7", availability: "in_stock" }] }, key.publicKey).ok, "gone cannot be turned into in_stock");
  const notice = signNotice({ format: "shop-feed-changed/1", feed: "https://p.example/rani/listings.json", updated: "2026-11-18T03:30:00.000Z" }, key);
  assert.equal(notice.keyId, key.keyId);
  assert.ok(verifyNotice(notice, key.publicKey).ok);
  assert.ok(!verifyNotice({ ...notice, feed: "https://p.example/other/listings.json" }, key.publicKey).ok);
  assert.ok(!verifyNotice(notice, generateSigningKey().publicKey).ok);
});

test("an Agent Card: signed as a JWS (EdDSA, typ JOSE, kid = the key id) over the canonical card without its signatures", () => {
  const key = generateSigningKey();
  const card = signCard({ name: "Rani Pets", description: "A pet shop", version: "1", skills: [] }, key);
  assert.equal(card.signatures.length, 1);
  assert.deepEqual(JSON.parse(Buffer.from(card.signatures[0].protected, "base64url").toString()), { alg: "EdDSA", typ: "JOSE", kid: key.keyId });
  assert.ok(verifyCard(card, key.publicKey));
  assert.ok(!verifyCard({ ...card, name: "Other" }, key.publicKey));
  assert.ok(!verifyCard(card, generateSigningKey().publicKey));
  assert.ok(!verifyCard({ name: "x" }, key.publicKey));
  assert.ok(verifyCard(signCard(card, key), key.publicKey), "signing again replaces the old signature, it does not stack");
});
