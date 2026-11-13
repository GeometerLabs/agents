// A software passkey for tests and the Docker proof (plan item 11h): it answers navigator.credentials.create and .get the way a phone does (attestation "none",
// ES256 or Ed25519, the user present and verified, a counter), so the runtime's checks (webauthn.ts, owner-access.ts) can be driven without a browser. It
// writes its own CBOR, so passing these tests shows the runtime agrees with this file; modules/channels/test/fixtures/passkey-chromium.json holds answers made
// by a real Chromium authenticator, which webauthn.test.ts checks too.
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import type { KeyObject } from "node:crypto";

type C = number | string | Buffer | C[] | Map<C, C> | boolean;
/** CBOR, definite lengths, as authenticators write it. */
export function cbor(v: C): Buffer {
  const head = (major: number, n: number): Buffer => {
    if (n < 24) return Buffer.from([(major << 5) | n]);
    if (n < 256) return Buffer.from([(major << 5) | 24, n]);
    if (n < 65536) { const b = Buffer.alloc(3); b[0] = (major << 5) | 25; b.writeUInt16BE(n, 1); return b; }
    const b = Buffer.alloc(5); b[0] = (major << 5) | 26; b.writeUInt32BE(n, 1); return b;
  };
  if (typeof v === "boolean") return Buffer.from([v ? 0xf5 : 0xf4]);
  if (typeof v === "number") return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === "string") { const b = Buffer.from(v, "utf8"); return Buffer.concat([head(3, b.length), b]); }
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (Array.isArray(v)) return Buffer.concat([head(4, v.length), ...v.map(cbor)]);
  return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
}

const sha = (b: Buffer | string) => createHash("sha256").update(b).digest();
const u = (b: Buffer) => b.toString("base64url");

export interface SoftPasskey { credId: Buffer; key: KeyObject; alg: -7 | -8; count: number; rpId: string; userId?: string }

/** The COSE form of the passkey's public key. */
function coseOf(p: SoftPasskey): Map<C, C> {
  const jwk = p.key.export({ format: "jwk" }) as { x: string; y?: string };
  if (p.alg === -8) return new Map<C, C>([[1, 1], [3, -8], [-1, 6], [-2, Buffer.from(jwk.x, "base64url")]]);
  return new Map<C, C>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, "base64url")], [-3, Buffer.from(jwk.y!, "base64url")]]);
}

/** Flags: user present and verified (0x05), plus attested data (0x40) at registration. `flags` overrides for a test of a phone that did not verify. */
function authData(p: SoftPasskey, o: { attested?: boolean; flags?: number; rpId?: string }): Buffer {
  const count = Buffer.alloc(4); count.writeUInt32BE(p.count);
  const flags = o.flags ?? (0x05 | (o.attested ? 0x40 : 0));
  const parts = [sha(o.rpId ?? p.rpId), Buffer.from([flags]), count];
  if (o.attested) { const len = Buffer.alloc(2); len.writeUInt16BE(p.credId.length); parts.push(Buffer.alloc(16), len, p.credId, cbor(coseOf(p))); }
  return Buffer.concat(parts);
}

/** A new passkey for an RP ID. `count` starts where the test says (a synced passkey says 0 for ever). */
export function newSoftPasskey(rpId: string, o: { alg?: -7 | -8; count?: number } = {}): SoftPasskey {
  const alg = o.alg ?? -7;
  const { privateKey } = alg === -8 ? generateKeyPairSync("ed25519") : generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return { credId: sha(`${Math.random()}${Date.now()}`), key: privateKey, alg, count: o.count ?? 0, rpId };
}

/** navigator.credentials.create's answer, for the options the runtime gave (its challenge and user id), from `origin`. */
export function softRegister(p: SoftPasskey, options: { challenge: string; user?: { id: string } }, origin: string, o: { type?: string; flags?: number; rpId?: string } = {}): { clientDataJSON: string; attestationObject: string } {
  if (options.user) p.userId = options.user.id;
  const clientDataJSON = Buffer.from(JSON.stringify({ type: o.type ?? "webauthn.create", challenge: options.challenge, origin, crossOrigin: false }));
  const attestationObject = cbor(new Map<C, C>([["fmt", "none"], ["attStmt", new Map()], ["authData", authData(p, { attested: true, ...(o.flags !== undefined ? { flags: o.flags | 0x40 } : {}), ...(o.rpId ? { rpId: o.rpId } : {}) })]]));
  return { clientDataJSON: u(clientDataJSON), attestationObject: u(attestationObject) };
}

/** navigator.credentials.get's answer: the counter moves on by one unless the passkey always says 0 (`still`). */
export function softSignin(p: SoftPasskey, options: { challenge: string }, origin: string, o: { still?: boolean; type?: string; flags?: number; rpId?: string; userHandle?: string } = {}): { id: string; clientDataJSON: string; authenticatorData: string; signature: string; userHandle?: string } {
  if (!o.still) p.count += 1;
  const clientDataJSON = Buffer.from(JSON.stringify({ type: o.type ?? "webauthn.get", challenge: options.challenge, origin, crossOrigin: false }));
  const data = authData(p, { ...(o.flags !== undefined ? { flags: o.flags } : {}), ...(o.rpId ? { rpId: o.rpId } : {}) });
  const signed = Buffer.concat([data, sha(clientDataJSON)]);
  const signature = p.alg === -8 ? sign(null, signed, p.key) : sign("sha256", signed, { key: p.key, dsaEncoding: "der" });
  const userHandle = o.userHandle ?? p.userId;
  return { id: u(p.credId), clientDataJSON: u(clientDataJSON), authenticatorData: u(data), signature: u(signature), ...(userHandle ? { userHandle } : {}) };
}
