// Signing an A2A Agent Card the way the A2A specification asks (version 1.0.1, docs/specification.md section 8.4, "Agent Card Signing"): a JSON Web
// Signature (RFC 7515) over the card's RFC 8785 canonical JSON without its `signatures` member. The signature goes in the card as
//   "signatures": [ { "protected": base64url(header), "signature": base64url(sig) } ]
// The protected header is {"alg":"EdDSA","typ":"JOSE","kid":<key id>}; EdDSA with Ed25519 is the JOSE name from RFC 8037. The signing input is
// base64url(header) + "." + base64url(canonical payload), as RFC 7515 section 5.1 says.
//
// The key id (`kid`) is the same key id the shop's feed uses (keys.ts keyIdOf), so one key signs the feed, the check answers and the card, and a reader
// who pinned the key for the feed can check the card with it. The card builder must leave out members that hold only a default value, as the
// specification's section 8.4.1 says; this file signs exactly the card it is given.
import { sign as edSign, verify as edVerify } from "node:crypto";
import { canonicalJson } from "./canonical.ts";
import { keyIdOf, publicKeyObject } from "./keys.ts";
import type { SigningKey } from "./keys.ts";

const b64 = (text: string): string => Buffer.from(text, "utf8").toString("base64url");

export interface CardSignature { protected: string; signature: string }

/** The JWS signing input for a card: base64url(protected header) "." base64url(canonical card without `signatures`). */
function signingInput(card: Record<string, unknown>, protectedText: string): Buffer {
  const { signatures: _drop, ...body } = card;
  return Buffer.from(`${protectedText}.${b64(canonicalJson(body))}`, "ascii");
}

/** The card with its `signatures` member set to one signature by this key (any earlier signatures are replaced). */
export function signCard<T extends object>(card: T, key: SigningKey): T & { signatures: CardSignature[] } {
  const protectedText = b64(JSON.stringify({ alg: "EdDSA", typ: "JOSE", kid: key.keyId }));
  const body = { ...(card as Record<string, unknown>) };
  delete body.signatures;
  const signature = edSign(null, signingInput(body, protectedText), key.privateKey).toString("base64url");
  return { ...(body as T), signatures: [{ protected: protectedText, signature }] };
}

/** Does one of the card's signatures verify under this public key (SPKI DER base64url)? A card with no signature, or with a header for another key id, does not. */
export function verifyCard(card: unknown, publicKey: string): boolean {
  const key = publicKeyObject(publicKey);
  if (!key || typeof card !== "object" || card === null) return false;
  const c = card as Record<string, unknown>;
  if (!Array.isArray(c.signatures)) return false;
  const kid = keyIdOf(publicKey);
  for (const s of c.signatures as unknown[]) {
    const sig = s as Partial<CardSignature> | null;
    if (!sig || typeof sig.protected !== "string" || typeof sig.signature !== "string") continue;
    try {
      const header = JSON.parse(Buffer.from(sig.protected, "base64url").toString("utf8")) as { alg?: unknown; kid?: unknown };
      if (header.alg !== "EdDSA" || header.kid !== kid) continue;
      if (edVerify(null, signingInput(c, sig.protected), key, Buffer.from(sig.signature, "base64url"))) return true;
    } catch { /* a malformed signature is not a valid one: try the next */ }
  }
  return false;
}
