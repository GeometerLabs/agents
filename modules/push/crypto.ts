// Web push's two pieces of cryptography (plan item 11h, decision 45), with node:crypto only (the modules have no dependencies):
//
//   - the message's encryption, RFC 8291 over RFC 8188's "aes128gcm" content coding: the push service (Google's, Mozilla's, Apple's) carries only ciphertext, and only the
//     browser that subscribed can read it (it holds the private key and the auth secret its subscription named);
//   - the shop's signature on each push, VAPID (RFC 8292): a short ES256 JWT for the push service's origin, so a subscription made with the shop's public key accepts
//     pushes only from the shop's server.
//
// Used by modules/push/sender.ts (encrypt, sign) and by the tests and the Docker proof, which play the browser (decrypt). Checked against both RFCs' own examples
// (modules/push/test/crypto.test.ts). Two different signature encodings live here on purpose: a JWT's ES256 signature is the raw 64 bytes (r and s), never DER.
import { createCipheriv, createDecipheriv, createECDH, createPrivateKey, createPublicKey, createSign, createVerify, generateKeyPairSync, hkdfSync, randomBytes } from "node:crypto";
import type { KeyObject } from "node:crypto";

const b64u = (b: Uint8Array): string => Buffer.from(b).toString("base64url");
const fromB64u = (s: string): Buffer => Buffer.from(s, "base64url");

/** A P-256 public key as browsers give it: 65 bytes, 0x04 then x and y. */
export const isUncompressedP256 = (key: Buffer): boolean => key.length === 65 && key[0] === 0x04;

/** RFC 8188's record size the sender writes. One record carries the whole message (a push is at most about 4 KB). */
export const RECORD_SIZE = 4096;
/** The longest message the sender encrypts: under the 4 KB push services take, after the 86-byte header, the delimiter and the tag. */
export const MAX_PLAINTEXT = 3000;

/** What a subscription names for encryption: the browser's public key (p256dh) and its 16-byte auth secret. */
export interface SubscriptionKeys { p256dh: Buffer; auth: Buffer }

/** The keys the RFC 8291 key derivation needs, then RFC 8188's content key and nonce from them. */
function derive(ecdhSecret: Buffer, auth: Buffer, uaPublic: Buffer, asPublic: Buffer, salt: Buffer): { key: Buffer; nonce: Buffer } {
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0", "latin1"), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync("sha256", ecdhSecret, auth, keyInfo, 32));
  return {
    key: Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0", "latin1"), 16)),
    nonce: Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0", "latin1"), 12)),
  };
}

/**
 * Encrypt one push message for one subscription. A fresh sender key pair and salt every time (`fixed` is only for the RFC's example). `padTo` pads the plaintext
 * up to a multiple of that many bytes, so the length of what the push service carries says less about the words. Returns the whole body: the header (salt, record
 * size, the sender's public key) and the one record.
 */
export function encryptPush(plaintext: Buffer, keys: SubscriptionKeys, o: { padTo?: number; fixed?: { salt: Buffer; senderPrivate: Buffer } } = {}): Buffer {
  if (!isUncompressedP256(keys.p256dh)) throw new Error("The subscription's p256dh is not a P-256 public key.");
  if (keys.auth.length !== 16) throw new Error("The subscription's auth secret is not 16 bytes.");
  if (plaintext.length > MAX_PLAINTEXT) throw new Error(`A push message is at most ${MAX_PLAINTEXT} bytes.`);
  const ecdh = createECDH("prime256v1");
  if (o.fixed) ecdh.setPrivateKey(o.fixed.senderPrivate); else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const salt = o.fixed?.salt ?? randomBytes(16);
  const { key, nonce } = derive(ecdh.computeSecret(keys.p256dh), keys.auth, keys.p256dh, asPublic, salt);
  const pad = o.padTo && o.padTo > 1 ? (o.padTo - ((plaintext.length + 1) % o.padTo)) % o.padTo : 0;
  // the last (and only) record: the words, the delimiter 0x02, then zeros
  const record = Buffer.concat([plaintext, Buffer.from([0x02]), Buffer.alloc(pad)]);
  const cipher = createCipheriv("aes-128-gcm", key, nonce);
  const sealed = Buffer.concat([cipher.update(record), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(RECORD_SIZE);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, sealed]);
}

/**
 * What a browser does with a push body: read the header, derive the same key from its private key and auth secret, open the one record and strip the padding.
 * Here for the tests and the Docker proof, which play the browser; the server never decrypts.
 */
export function decryptPush(body: Buffer, browser: { privateKey: Buffer; publicKey: Buffer; auth: Buffer }): Buffer {
  if (body.length < 21) throw new Error("Too short for an aes128gcm header.");
  const salt = body.subarray(0, 16);
  const idLength = body[20];
  const asPublic = body.subarray(21, 21 + idLength);
  const sealed = body.subarray(21 + idLength);
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(browser.privateKey);
  const { key, nonce } = derive(ecdh.computeSecret(asPublic), browser.auth, browser.publicKey, asPublic, salt);
  const decipher = createDecipheriv("aes-128-gcm", key, nonce);
  decipher.setAuthTag(sealed.subarray(sealed.length - 16));
  const record = Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - 16)), decipher.final()]);
  let end = record.length - 1;
  while (end >= 0 && record[end] === 0) end -= 1;
  if (end < 0 || record[end] !== 0x02) throw new Error("The record has no last-record delimiter.");
  return record.subarray(0, end);
}

// ---- VAPID (RFC 8292) -------------------------------------------------------------------------------------------------------------------------------------------

/** The shop's VAPID key pair: the private key as a JWK (kept only in the runtime's own data), the public key as browsers take it (65 bytes, base64url). */
export interface VapidKeys { privateJwk: { kty: "EC"; crv: "P-256"; x: string; y: string; d: string }; publicKey: string }

export function newVapidKeys(): VapidKeys {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = privateKey.export({ format: "jwk" }) as VapidKeys["privateJwk"];
  return { privateJwk: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, d: jwk.d }, publicKey: b64u(Buffer.concat([Buffer.from([4]), fromB64u(jwk.x), fromB64u(jwk.y)])) };
}

/** A public key as browsers give it (65 bytes, base64url) as a key object. */
export function p256PublicKey(uncompressed: string): KeyObject {
  const raw = fromB64u(uncompressed);
  if (!isUncompressedP256(raw)) throw new Error("Not a P-256 public key.");
  return createPublicKey({ key: { kty: "EC", crv: "P-256", x: b64u(raw.subarray(1, 33)), y: b64u(raw.subarray(33)) }, format: "jwk" });
}

/** How long a signature lasts. RFC 8292 allows up to 24 hours; a shorter one leaks less if a push is ever logged on the way. */
export const VAPID_TTL_S = 12 * 60 * 60;

/**
 * The Authorization header's value for one push service: `vapid t=<JWT>, k=<public key>`. `aud` is the push service's origin; `sub` is how the service can reach
 * whoever runs the sender: the shop's own page address (never a person's e-mail).
 */
export function vapidHeader(keys: VapidKeys, o: { audience: string; subject: string; nowS: number }): string {
  const header = b64u(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(Buffer.from(JSON.stringify({ aud: o.audience, exp: o.nowS + VAPID_TTL_S, sub: o.subject })));
  const signer = createSign("SHA256");
  signer.update(`${header}.${claims}`);
  const signature = signer.sign({ key: createPrivateKey({ key: keys.privateJwk, format: "jwk" }), dsaEncoding: "ieee-p1363" });
  return `vapid t=${header}.${claims}.${b64u(signature)}, k=${keys.publicKey}`;
}

/** Does a VAPID JWT verify under a public key (65 bytes, base64url)? For the tests (RFC 8292's own example) and the proof's stand-in push service. */
export function vapidVerifies(jwt: string, publicKey: string): boolean {
  const [h, c, s] = jwt.split(".");
  if (!h || !c || !s) return false;
  const verifier = createVerify("SHA256");
  verifier.update(`${h}.${c}`);
  try { return verifier.verify({ key: p256PublicKey(publicKey), dsaEncoding: "ieee-p1363" }, fromB64u(s)); } catch { return false; }
}

/** The parts of a `vapid t=..., k=...` header, or undefined. */
export function readVapidHeader(value: string): { t: string; k: string } | undefined {
  const m = /^vapid t=([A-Za-z0-9_.-]+),\s*k=([A-Za-z0-9_-]+)$/u.exec(value.trim());
  return m ? { t: m[1], k: m[2] } : undefined;
}
