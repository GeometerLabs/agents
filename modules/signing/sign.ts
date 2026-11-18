// Signing and checking the typed records that travel between programs: a shop's feed, a shop's check answer and a "my feed changed" notice
// (specs/shop-feed.md, specs/shop-check.md). Every signature is Ed25519 over the canonical JSON bytes (canonical.ts) of the record WITHOUT its
// signature, written as base64url with no padding.
//
// Three shapes carry a signature, one function pair each, so no reader writes its own:
//   feed      { ..., signature: { alg: "Ed25519", keyId, key, sig } }   the public key travels in the feed, so a reader can check it on first sight
//   answer    { ..., signature: { alg: "Ed25519", keyId, sig } }        a check answer: no key; the reader already holds the one it pinned
//   notice    { ..., keyId, sig }                                       a "my feed changed" notice
//
// Checking a signature proves only that the holder of that key wrote these exact bytes. WHICH key a shop may use is a separate decision (a reader pins
// the first key it saw for a shop page: modules/discovery/keys), so these functions return the key id and leave the trust to the caller.
import { sign as edSign, verify as edVerify } from "node:crypto";
import { canonicalBytes } from "./canonical.ts";
import { keyIdOf, publicKeyObject, rawOfPublic } from "./keys.ts";
import type { SigningKey } from "./keys.ts";

export const ALG = "Ed25519";
/** An Ed25519 signature is 64 bytes: 86 base64url characters without padding. */
const SIG = /^[A-Za-z0-9_-]{86}$/u;

/** The signature of a value (its canonical bytes), base64url. */
export const signValue = (value: unknown, key: SigningKey): string => edSign(null, canonicalBytes(value), key.privateKey).toString("base64url");

/** Does `sig` sign exactly the canonical bytes of `value` under this public key (SPKI DER base64url)? False for anything malformed. */
export function verifyValue(value: unknown, sig: string, publicKey: string): boolean {
  if (typeof sig !== "string" || !SIG.test(sig)) return false;
  const key = publicKeyObject(publicKey);
  if (!key) return false;
  let bytes: Uint8Array;
  try { bytes = canonicalBytes(value); } catch { return false; } // a value with no canonical form was never signed
  const raw = Buffer.from(sig, "base64url");
  return raw.length === 64 && raw.toString("base64url") === sig && edVerify(null, bytes, key, raw);
}

export type Sealed<T> = T & { signature: { alg: typeof ALG; keyId: string; key?: string; sig: string } };

/** A feed: the document with its signature member added (the key included). Any `signature` already in the document is replaced. */
export function signFeed<T extends object>(doc: T, key: SigningKey): Sealed<T> {
  const { signature: _drop, ...body } = doc as T & { signature?: unknown };
  return { ...(body as T), signature: { alg: ALG, keyId: key.keyId, key: key.publicKey, sig: signValue(body, key) } };
}

/** A check answer: the same, without the key (the asker already holds it). */
export function signAnswer<T extends object>(doc: T, key: SigningKey): Sealed<T> {
  const { signature: _drop, ...body } = doc as T & { signature?: unknown };
  return { ...(body as T), signature: { alg: ALG, keyId: key.keyId, sig: signValue(body, key) } };
}

/** A "my feed changed" notice: `keyId` and `sig` are members of the notice, and the signature covers the notice without `sig`. */
export function signNotice<T extends object>(notice: T, key: SigningKey): T & { keyId: string; sig: string } {
  const { sig: _drop, ...body } = notice as T & { sig?: unknown };
  const withId = { ...(body as T), keyId: key.keyId };
  return { ...withId, sig: signValue(withId, key) };
}

export type Verified = { ok: true; keyId: string } | { ok: false; reason: "no_signature" | "bad_shape" | "wrong_alg" | "key_mismatch" | "no_key" | "bad_signature" };

const asObject = (v: unknown): Record<string, unknown> | undefined => (typeof v === "object" && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : undefined);

/**
 * Check a feed or an answer: `doc.signature` against `publicKey` (the key the reader holds for this shop) or, when the reader holds none yet and the
 * signature carries one (a feed on first sight), against the key it carries. The key id the signature names must be the id of the key used. Returns the
 * key id that signed; whether that key is the one the shop is allowed to use is the caller's pinning decision.
 */
export function verifyDocument(doc: unknown, publicKey?: string): Verified {
  const d = asObject(doc);
  if (!d || d.signature === undefined) return { ok: false, reason: "no_signature" };
  const s = asObject(d.signature);
  if (!s || typeof s.keyId !== "string" || typeof s.sig !== "string" || (s.key !== undefined && typeof s.key !== "string")) return { ok: false, reason: "bad_shape" };
  if (s.alg !== ALG) return { ok: false, reason: "wrong_alg" };
  const key = publicKey ?? (s.key as string | undefined);
  if (key === undefined) return { ok: false, reason: "no_key" };
  if (!rawOfPublic(key)) return { ok: false, reason: "bad_shape" };
  if (keyIdOf(key) !== s.keyId) return { ok: false, reason: "key_mismatch" };
  // a feed that carries its own key must carry the key the reader holds, if it holds one
  if (publicKey !== undefined && typeof s.key === "string" && s.key !== publicKey) return { ok: false, reason: "key_mismatch" };
  const { signature: _drop, ...body } = d;
  return verifyValue(body, s.sig, key) ? { ok: true, keyId: s.keyId } : { ok: false, reason: "bad_signature" };
}

/** Check a notice against the public key the reader holds for the shop. */
export function verifyNotice(notice: unknown, publicKey: string): Verified {
  const n = asObject(notice);
  if (!n || typeof n.sig !== "string" || typeof n.keyId !== "string") return { ok: false, reason: "no_signature" };
  if (!rawOfPublic(publicKey)) return { ok: false, reason: "bad_shape" };
  if (keyIdOf(publicKey) !== n.keyId) return { ok: false, reason: "key_mismatch" };
  const { sig, ...body } = n;
  return verifyValue(body, sig as string, publicKey) ? { ok: true, keyId: n.keyId } : { ok: false, reason: "bad_signature" };
}
