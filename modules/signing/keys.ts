// Ed25519 keys as the open formats write them (specs/shop-feed.md, "The signature"): the public key as SPKI DER in base64url, and its id, the base64url
// SHA-256 of the raw 32-byte key. Only node:crypto; no dependency. A shop makes its key once, keeps it in its own folder and takes it along when it
// changes its Operator, so a directory that knew the shop still knows it; a directory that only reads keeps public keys and never a private one.
//
// This file does not hold the private key anywhere: the caller keeps `privateText` (PKCS#8 DER, base64url) where it keeps its secrets.
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { publicKeyFromRaw } from "../licence/token.ts";

/** What a signer holds: the key itself, and the two text forms the formats carry (`publicKey` goes in a feed; `keyId` names it everywhere). */
export interface SigningKey { privateKey: KeyObject; publicKey: string; keyId: string }

/** The first twelve bytes of every Ed25519 SPKI DER public key; the 32 bytes after them are the raw key. */
const SPKI_PREFIX = "302a300506032b6570032100";

/** The raw 32 bytes of a public key given as SPKI DER base64url, or undefined when the text is not exactly that. */
export function rawOfPublic(publicKey: string): Buffer | undefined {
  if (!/^[A-Za-z0-9_-]+$/u.test(publicKey)) return undefined;
  const der = Buffer.from(publicKey, "base64url");
  if (der.length !== 44 || der.subarray(0, 12).toString("hex") !== SPKI_PREFIX || der.toString("base64url") !== publicKey) return undefined;
  return der.subarray(12);
}

/** The key id of a public key (SPKI DER base64url): base64url of SHA-256 over the raw 32 bytes. Throws for text that is not an Ed25519 public key. */
export function keyIdOf(publicKey: string): string {
  const raw = rawOfPublic(publicKey);
  if (!raw) throw new Error("Not an Ed25519 public key (expected SPKI DER in base64url).");
  return createHash("sha256").update(raw).digest("base64url");
}

/** The public key as the formats write it, from a key object. */
export const publicTextOf = (key: KeyObject): string => createPublicKey(key).export({ type: "spki", format: "der" }).toString("base64url");

/** The key object for a public key text, or undefined when the text is not a well-formed Ed25519 public key. */
export function publicKeyObject(publicKey: string): KeyObject | undefined {
  const raw = rawOfPublic(publicKey);
  return raw ? publicKeyFromRaw(raw) : undefined;
}

/** A signer from a private key object. */
export function signingKeyOf(privateKey: KeyObject): SigningKey {
  const publicKey = publicTextOf(privateKey);
  return { privateKey, publicKey, keyId: keyIdOf(publicKey) };
}

/** A new key pair. The caller stores `privateText(key)` and keeps it private. */
export const generateSigningKey = (): SigningKey => signingKeyOf(generateKeyPairSync("ed25519").privateKey);

/** The private key as text to store: PKCS#8 DER, base64url. Anyone who reads this can sign as the key's owner. */
export const privateText = (key: SigningKey): string => key.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64url");

/** A signer from the text `privateText` wrote. */
export const signingKeyFromText = (text: string): SigningKey => signingKeyOf(createPrivateKey({ key: Buffer.from(text, "base64url"), format: "der", type: "pkcs8" }));
