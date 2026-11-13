// Passkeys (WebAuthn level 2) checked on the shop's own server, with node:crypto only (plan item 11h, decision 46: the owner's sign-in is never mediated by Geometer
// or Firebase, and the modules have no dependencies). Used by the runtime's owner access (owner-access.ts), which is the authority: it makes each challenge, keeps
// each credential's public key, and calls these two checks. The public front only carries the browser's answers to it.
//
// What is checked, and why each:
//   - clientDataJSON: the ceremony's type, the challenge the runtime made (one use, short-lived: owner-access.ts), and the exact origin of the shop's owner view
//     (from the pages file's ownerBase), never crossOrigin. Every shop on the pages domain shares one origin and one RP ID, so these alone do not tell shops
//     apart: that is done by each runtime keeping its own credentials (a passkey made for another shop is simply unknown here) and its own user id.
//   - authenticatorData: the RP ID's hash, user presence and user verification (the fingerprint or screen lock: decision 45 asks for them), and the counter.
//   - the signature over authenticatorData and the hash of clientDataJSON, by the key stored at registration (ES256, EdDSA or RS256).
// Attestation is not asked for ("none"): which phone made the key does not matter here, and checking it would mean trusting vendors' certificates. So at
// registration only the credential's own data is read; its attestation statement is ignored.
import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import type { JsonWebKey } from "node:crypto";

// ---- a small CBOR reader (RFC 8949): only what WebAuthn's objects use -------------------------------------------------------------------------------------------

export type Cbor = number | bigint | string | boolean | null | undefined | Buffer | Cbor[] | Map<Cbor, Cbor>;

/** Read one CBOR item at `at`; returns it and where the next begins. Definite lengths only (browsers write nothing else); anything else is refused. */
export function readCbor(buf: Buffer, at = 0, depth = 0): { value: Cbor; next: number } {
  if (depth > 16) throw new Error("CBOR nested too deep.");
  if (at >= buf.length) throw new Error("CBOR ends early.");
  const first = buf[at];
  const major = first >> 5;
  const info = first & 31;
  let p = at + 1;
  const need = (n: number) => { if (p + n > buf.length) throw new Error("CBOR ends early."); };
  let arg: number | bigint;
  if (info < 24) arg = info;
  else if (info === 24) { need(1); arg = buf[p]; p += 1; }
  else if (info === 25) { need(2); arg = buf.readUInt16BE(p); p += 2; }
  else if (info === 26) { need(4); arg = buf.readUInt32BE(p); p += 4; }
  else if (info === 27) { need(8); const big = buf.readBigUInt64BE(p); p += 8; arg = big <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(big) : big; }
  else throw new Error("CBOR with an indefinite length or a reserved code is not read.");
  const len = (): number => { if (typeof arg !== "number") throw new Error("CBOR length too large."); return arg; };
  switch (major) {
    case 0: return { value: arg, next: p };
    case 1: return { value: typeof arg === "number" ? -1 - arg : -1n - arg, next: p };
    case 2: { const n = len(); need(n); return { value: Buffer.from(buf.subarray(p, p + n)), next: p + n }; }
    case 3: { const n = len(); need(n); return { value: buf.subarray(p, p + n).toString("utf8"), next: p + n }; }
    case 4: {
      const items: Cbor[] = [];
      for (let i = 0, n = len(); i < n; i++) { const r = readCbor(buf, p, depth + 1); items.push(r.value); p = r.next; }
      return { value: items, next: p };
    }
    case 5: {
      const map = new Map<Cbor, Cbor>();
      for (let i = 0, n = len(); i < n; i++) {
        const k = readCbor(buf, p, depth + 1); const v = readCbor(buf, k.next, depth + 1);
        if (map.has(k.value)) throw new Error("CBOR map with a key twice.");
        map.set(k.value, v.value); p = v.next;
      }
      return { value: map, next: p };
    }
    case 6: { const r = readCbor(buf, p, depth + 1); return { value: r.value, next: r.next }; } // a tag: its content (WebAuthn's objects carry none that matter)
    default:
      if (info === 20) return { value: false, next: p };
      if (info === 21) return { value: true, next: p };
      if (info === 22) return { value: null, next: p };
      if (info === 23) return { value: undefined, next: p };
      throw new Error("CBOR floats and other simple values are not read.");
  }
}

// ---- authenticator data -------------------------------------------------------------------------------------------------------------------------------------

export const FLAG_UP = 0x01;
export const FLAG_UV = 0x04;
export const FLAG_BE = 0x08;
export const FLAG_BS = 0x10;
export const FLAG_AT = 0x40;
export const FLAG_ED = 0x80;

export interface AuthData { rpIdHash: Buffer; flags: number; signCount: number; credential?: { aaguid: Buffer; id: Buffer; publicKey: Map<Cbor, Cbor> } }

export function readAuthData(data: Buffer): AuthData {
  if (data.length < 37) throw new Error("Authenticator data is too short.");
  const flags = data[32];
  const out: AuthData = { rpIdHash: Buffer.from(data.subarray(0, 32)), flags, signCount: data.readUInt32BE(33) };
  let p = 37;
  if (flags & FLAG_AT) {
    if (data.length < p + 18) throw new Error("Attested credential data is too short.");
    const aaguid = Buffer.from(data.subarray(p, p + 16));
    const idLength = data.readUInt16BE(p + 16);
    p += 18;
    if (idLength < 16 || idLength > 1023 || data.length < p + idLength) throw new Error("The credential id has a length WebAuthn does not allow.");
    const id = Buffer.from(data.subarray(p, p + idLength));
    p += idLength;
    const key = readCbor(data, p);
    if (!(key.value instanceof Map)) throw new Error("The credential's public key is not a COSE key.");
    out.credential = { aaguid, id, publicKey: key.value };
    p = key.next;
  }
  if (flags & FLAG_ED) p = readCbor(data, p).next;
  if (p !== data.length) throw new Error("Authenticator data has bytes left over.");
  return out;
}

// ---- COSE keys --------------------------------------------------------------------------------------------------------------------------------------------

/** The algorithms a passkey may use here, as COSE numbers: ES256 (most phones), EdDSA, RS256 (Windows Hello). */
export const ALGORITHMS = [-7, -8, -257] as const;
export type Algorithm = (typeof ALGORITHMS)[number];

/** A COSE public key as a JWK and its algorithm, or an error for anything else (a key whose shape does not match its algorithm included). */
export function coseKey(cose: Map<Cbor, Cbor>): { jwk: JsonWebKey; alg: Algorithm } {
  const kty = cose.get(1); const alg = cose.get(3);
  const bytes = (k: number, length?: number): string => {
    const v = cose.get(k);
    if (!Buffer.isBuffer(v) || (length !== undefined && v.length !== length)) throw new Error("The COSE key's coordinates are not what its algorithm needs.");
    return v.toString("base64url");
  };
  if (alg === -7 && kty === 2 && cose.get(-1) === 1) return { alg, jwk: { kty: "EC", crv: "P-256", x: bytes(-2, 32), y: bytes(-3, 32) } };
  if (alg === -8 && kty === 1 && cose.get(-1) === 6) return { alg, jwk: { kty: "OKP", crv: "Ed25519", x: bytes(-2, 32) } };
  if (alg === -257 && kty === 3) return { alg, jwk: { kty: "RSA", n: bytes(-1), e: bytes(-2) } };
  throw new Error(`A key of type ${String(kty)} with algorithm ${String(alg)} is not accepted (ES256, EdDSA or RS256).`);
}

/** Does `signature` sign `data` under this key? WebAuthn's ES256 signature is DER (unlike a JWT's). */
export function signatureVerifies(key: { jwk: JsonWebKey; alg: Algorithm }, data: Buffer, signature: Buffer): boolean {
  try {
    const k = createPublicKey({ key: key.jwk, format: "jwk" });
    if (key.alg === -8) return verifySignature(null, data, k, signature);
    if (key.alg === -7) return verifySignature("sha256", data, { key: k, dsaEncoding: "der" }, signature);
    if (k.asymmetricKeyDetails?.modulusLength !== undefined && k.asymmetricKeyDetails.modulusLength < 2048) return false;
    return verifySignature("sha256", data, k, signature);
  } catch { return false; }
}

// ---- the two ceremonies -------------------------------------------------------------------------------------------------------------------------------------

/** What the runtime expects: the challenge it made (base64url), the owner view's origin and its RP ID (the origin's host). */
export interface Expected { challenge: string; origin: string; rpId: string }

export class PasskeyError extends Error {}

const sha256 = (b: Buffer | string): Buffer => createHash("sha256").update(b).digest();

/** The client data, checked: the type, the challenge, the origin, and never a page framed by another site. */
function checkClientData(raw: Buffer, type: "webauthn.create" | "webauthn.get", e: Expected): void {
  let c: { type?: unknown; challenge?: unknown; origin?: unknown; crossOrigin?: unknown };
  try { c = JSON.parse(raw.toString("utf8")); } catch { throw new PasskeyError("The browser's client data is not JSON."); }
  if (c.type !== type) throw new PasskeyError(`The browser's answer is for ${String(c.type)}, not ${type}.`);
  if (c.challenge !== e.challenge) throw new PasskeyError("The answer is for another challenge.");
  if (c.origin !== e.origin) throw new PasskeyError(`The answer came from ${String(c.origin)}, not this shop's page.`);
  if (c.crossOrigin === true) throw new PasskeyError("The answer came from a page framed by another site.");
}

/** The authenticator data's RP ID and flags: this RP ID, the person present and verified (fingerprint or screen lock). */
function checkAuthData(a: AuthData, e: Expected): void {
  if (!a.rpIdHash.equals(sha256(e.rpId))) throw new PasskeyError("The passkey is for another site.");
  if (!(a.flags & FLAG_UP)) throw new PasskeyError("The phone did not see the owner there.");
  if (!(a.flags & FLAG_UV)) throw new PasskeyError("The phone did not check the owner's fingerprint or screen lock.");
}

/** A credential as the runtime keeps it: its id, its public key and algorithm, its counter. */
export interface StoredCredential { id: string; jwk: JsonWebKey; alg: Algorithm; signCount: number; backedUp: boolean }

/**
 * A registration (navigator.credentials.create). Returns the credential to keep. The attestation statement is not read (attestation "none" was asked for); the
 * attested credential data in the authenticator data is.
 */
export function verifyRegistration(a: { clientDataJSON: Buffer; attestationObject: Buffer }, e: Expected): StoredCredential {
  checkClientData(a.clientDataJSON, "webauthn.create", e);
  let att: Cbor;
  try { att = readCbor(a.attestationObject).value; } catch (err) { throw new PasskeyError(`The attestation object is not CBOR (${(err as Error).message}).`); }
  if (!(att instanceof Map) || !Buffer.isBuffer(att.get("authData")) || typeof att.get("fmt") !== "string") throw new PasskeyError("The attestation object has no authenticator data.");
  let auth: AuthData;
  try { auth = readAuthData(att.get("authData") as Buffer); } catch (err) { throw new PasskeyError((err as Error).message); }
  checkAuthData(auth, e);
  if (!auth.credential) throw new PasskeyError("The registration carries no credential.");
  let key: { jwk: JsonWebKey; alg: Algorithm };
  try { key = coseKey(auth.credential.publicKey); } catch (err) { throw new PasskeyError((err as Error).message); }
  try { createPublicKey({ key: key.jwk, format: "jwk" }); } catch { throw new PasskeyError("The credential's public key is not a valid key."); }
  return { id: auth.credential.id.toString("base64url"), ...key, signCount: auth.signCount, backedUp: (auth.flags & FLAG_BE) !== 0 };
}

/**
 * A sign-in (navigator.credentials.get), for a credential the runtime found by the id the browser sent. Returns the new counter. The counter rule: when either the
 * stored or the new value is not 0, the new one must be higher (a copied key shows itself by going back); a synced passkey that always says 0 is accepted.
 */
export function verifyAssertion(a: { clientDataJSON: Buffer; authenticatorData: Buffer; signature: Buffer }, credential: StoredCredential, e: Expected): { signCount: number } {
  checkClientData(a.clientDataJSON, "webauthn.get", e);
  let auth: AuthData;
  try { auth = readAuthData(a.authenticatorData); } catch (err) { throw new PasskeyError((err as Error).message); }
  checkAuthData(auth, e);
  if (!signatureVerifies(credential, Buffer.concat([a.authenticatorData, sha256(a.clientDataJSON)]), a.signature)) throw new PasskeyError("The signature does not match this passkey.");
  if ((auth.signCount !== 0 || credential.signCount !== 0) && auth.signCount <= credential.signCount) throw new PasskeyError("The passkey's counter went back: it may have been copied.");
  return { signCount: auth.signCount };
}

/** The RP ID and origin for an owner view's address: the origin's host is the RP ID (one per pages domain, or the builder's own domain). */
export function relyingParty(ownerBase: string): { rpId: string; origin: string } {
  const u = new URL(ownerBase);
  return { rpId: u.hostname, origin: u.origin };
}
