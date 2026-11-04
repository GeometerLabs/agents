// Sealing and checking a report or certificate.
//
// The signed bytes: "geo-document/1\n" followed by the canonical JSON of `document` (keys sorted, no spaces, UTF-8).
// The digest is the sha256 of the canonical JSON alone, written "sha256:<hex>". Ed25519 (node:crypto) signs the bytes
// above. The file on disk is the canonical JSON of the whole envelope plus one newline, byte for byte, so a changed
// byte or a re-spaced file fails ("not in canonical form") instead of passing as long as the numbers still parse.
//
// These are the conventions geometer-verify uses (a domain prefix on signed bytes, "sha256:" digests, "key:" ids made from
// the sha256 of the raw public key, hex signatures), but this is NOT geometer-verify's format: it writes integers as
// strings and uses strict schemas. Until the two are joined (see Explanation.md), only verify-report.ts reads these files.
//
// What a signature shows: whoever holds the key signed exactly these bytes, and they have not changed since. It does not
// show the numbers are true, and a key found inside the file proves nothing about who the signer is: anyone can sign a
// changed document with their own key. Only a key the caller names as trusted tells you who signed.
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { canonicalJson } from "../record/record.ts";
import { digestOf, sha256, verificationCode } from "./digest.ts";

export const FORMAT = "geometer-document/1";
export const SIGNED_PREFIX = "geo-document/1\n";

export interface Signature {
  algorithm: "ed25519";
  keyId: string; // "key:" + sha256 of the raw public key
  publicKey: string; // the raw 32-byte public key, hex
  value: string; // the 64-byte signature, hex
}

export interface Envelope<T = unknown> {
  format: typeof FORMAT;
  document: T;
  digest: string;
  code: string;
  signature: Signature | null;
}

const toBytes = (document: unknown): Buffer => Buffer.from(SIGNED_PREFIX + canonicalJson(document), "utf8");

/** The raw public key (hex) of a key object, public or private. */
export function publicKeyHex(key: KeyObject): string {
  const x = (key.type === "public" ? key : createPublicKey(key)).export({ format: "jwk" }).x as string;
  return Buffer.from(x, "base64url").toString("hex");
}

/** "key:" plus the sha256 of the raw public key bytes. */
export const keyIdOf = (publicKey: string): string => `key:${sha256(Buffer.from(publicKey, "hex")).slice("sha256:".length)}`;

function publicKeyObject(hex: string): KeyObject {
  return createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(hex, "hex").toString("base64url") }, format: "jwk" });
}

/** Read a private key from a PEM file the caller names. A key other people can read is refused, as ssh does. */
export function loadPrivateKey(path: string): KeyObject {
  if (!existsSync(path)) throw new Error(`There is no key file at ${path}. Make one with: node pathways/bookings/scripts/report-key.ts <a folder outside the repository>`);
  const mode = statSync(path).mode & 0o777;
  if ((mode & 0o077) !== 0) throw new Error(`The key file ${path} can be read by other people (mode ${mode.toString(8)}). Run: chmod 600 ${path}`);
  const key = createPrivateKey(readFileSync(path));
  if (key.asymmetricKeyType !== "ed25519") throw new Error(`${path} is not an Ed25519 key.`);
  return key;
}

/** Make an envelope: the digest and code always, and a signature when a key is given. */
export function seal<T>(document: T, key?: KeyObject): Envelope<T> {
  const digest = digestOf(document);
  let signature: Signature | null = null;
  if (key) {
    const publicKey = publicKeyHex(key);
    signature = { algorithm: "ed25519", keyId: keyIdOf(publicKey), publicKey, value: sign(null, toBytes(document), key).toString("hex") };
  }
  return { format: FORMAT, document, digest, code: verificationCode(digest), signature };
}

/** The exact bytes to write to a file. */
export const envelopeFile = (envelope: Envelope): string => `${canonicalJson(envelope)}\n`;

// ---- checking ------------------------------------------------------------------------------------------------------

export interface Check { name: string; ok: boolean; detail: string }

export interface Verification {
  /** Everything that was checked passed. Says nothing about whether the numbers are true. */
  unchanged: boolean;
  signed: boolean;
  /** Signed by a key the caller named. False when none was named. */
  trusted: boolean;
  keyId: string | null;
  checks: Check[];
  /** What this check does not show, in plain words. Always non-empty. */
  notChecked: string[];
  /** The result in one or two plain sentences. */
  summary: string;
  envelope?: Envelope;
}

/** A key the caller trusts, as a raw public key (64 hex digits), a key id ("key:..."), or a PEM public-key file. */
export function trustedKeyId(spec: string): string {
  if (/^key:[0-9a-f]{64}$/.test(spec)) return spec;
  if (/^[0-9a-f]{64}$/.test(spec)) return keyIdOf(spec);
  if (existsSync(spec)) return keyIdOf(publicKeyHex(createPublicKey(readFileSync(spec))));
  throw new Error(`"${spec}" is not a public key file, a 64-digit public key or a key id ("key:" and 64 digits).`);
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const ENVELOPE_KEYS = ["code", "digest", "document", "format", "signature"];
const SIGNATURE_KEYS = ["algorithm", "keyId", "publicKey", "value"];
const sameKeys = (o: Record<string, unknown>, keys: string[]) => JSON.stringify(Object.keys(o).sort()) === JSON.stringify(keys);

/** Check the text of a report or certificate file. `trust` lists keys (see trustedKeyId) the caller trusts. */
export function verifyEnvelopeText(text: string, trust: string[] = []): Verification {
  const checks: Check[] = [];
  const notChecked = ["That the numbers are true. That needs the record itself and the payment, calendar and WhatsApp services' own records."];
  const fail = (summary: string): Verification => ({ unchanged: false, signed: false, trusted: false, keyId: null, checks, notChecked, summary });
  const record = (name: string, ok: boolean, detail: string) => { checks.push({ name, ok, detail }); return ok; };

  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch (e) {
    record("The file is one JSON document", false, `It cannot be read as JSON (${(e as Error).message}).`);
    return fail("This file has been changed or is not a report or certificate. Do not rely on it.");
  }
  record("The file is one JSON document", true, "It reads as JSON.");
  if (!record("The file is in the one canonical form, byte for byte", `${canonicalJson(parsed)}\n` === text, "A document is written with sorted keys, no spaces and one newline at the end. Any other spelling, even with the same numbers, is refused.")) {
    return fail("The file is not in the exact form it was issued in, so something in it has been changed. Do not rely on it.");
  }
  if (!record("It has the fields of a report or certificate, and no others", isObject(parsed) && sameKeys(parsed, ENVELOPE_KEYS) && parsed.format === FORMAT, `Expected exactly: ${ENVELOPE_KEYS.join(", ")}, with format "${FORMAT}".`)) {
    return fail("This is not a Geometer report or certificate file. Do not rely on it.");
  }
  const envelope = parsed as Envelope;

  const digestOk = record("The digest matches the document", typeof envelope.digest === "string" && envelope.digest === digestOf(envelope.document), "The sha256 of the document's canonical bytes was worked out again and compared with the digest written in the file.");
  const codeOk = record("The short code matches the digest", typeof envelope.digest === "string" && /^sha256:[0-9a-f]{64}$/.test(envelope.digest) && envelope.code === verificationCode(envelope.digest), "The code is worked out from the digest again.");

  let signed = false;
  let signatureOk = true;
  let keyId: string | null = null;
  if (envelope.signature === null) {
    record("Signature", true, "There is no signature in this file.");
    notChecked.push("Who issued it. This file is not signed, so only the digest could be checked.");
  } else if (!isObject(envelope.signature) || !sameKeys(envelope.signature, SIGNATURE_KEYS) || envelope.signature.algorithm !== "ed25519"
    || !/^[0-9a-f]{64}$/.test(envelope.signature.publicKey) || !/^[0-9a-f]{128}$/.test(envelope.signature.value)) {
    signatureOk = record("The signature has the right fields", false, `Expected exactly ${SIGNATURE_KEYS.join(", ")}, an Ed25519 signature.`);
  } else {
    signed = true;
    keyId = envelope.signature.keyId;
    const idOk = record("The key id matches the public key in the file", keyIdOf(envelope.signature.publicKey) === envelope.signature.keyId, "The key id is worked out from the public key again.");
    let valid = false;
    try { valid = verify(null, toBytes(envelope.document), publicKeyObject(envelope.signature.publicKey), Buffer.from(envelope.signature.value, "hex")); } catch { valid = false; }
    const sigOk = record("The signature is valid for this document and this key", valid, "Ed25519 over the document's canonical bytes with the key written in the file.");
    signatureOk = idOk && sigOk;
  }

  const unchanged = digestOk && codeOk && signatureOk;
  let trusted = false;
  if (trust.length > 0) {
    trusted = signed && signatureOk && trust.includes(keyId as string);
    record("Signed by a key you trust", trusted, trusted ? `The signing key is ${keyId}, which you named.` : signed ? `The signing key is ${keyId}, which is not one you named.` : "The file is not signed.");
  } else if (signed) {
    notChecked.push(`Who holds ${keyId}. A key written inside a file proves nothing about who it belongs to: anyone can change a document and sign it again with their own key. Name a key you trust with --trust-key to check this.`);
  }
  if (!unchanged) {
    return { unchanged, signed, trusted, keyId, checks, notChecked, summary: "Something in this file has been changed, or the signature does not fit. Do not rely on it.", envelope };
  }
  if (isObject(envelope.document) && envelope.document.anchor === null) {
    notChecked.push("Guard's ledger. This document has no ledger anchor yet, so nothing links it to Guard's hash-chained record.");
  }
  const summary = !signed ? "Unchanged since the digest was made, but this file is not signed, so it does not show who issued it."
    : trust.length === 0 ? `Unchanged since ${keyId} signed it. This does not show who holds that key, and it does not show the numbers are true.`
      : trusted ? `Unchanged since a key you trust (${keyId}) signed it. This does not show the numbers are true.`
        : `Unchanged since ${keyId} signed it, but that is not a key you named as trusted.`;
  return { unchanged, signed, trusted, keyId, checks, notChecked, summary, envelope };
}
