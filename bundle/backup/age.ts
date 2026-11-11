// age file encryption (https://age-encryption.org/v1) for X25519 recipients, with node:crypto and nothing else. A snapshot is encrypted to a PUBLIC key
// that is in geometer.json; the secret half is kept somewhere else and is needed only to restore. The format is the standard one, so the real `age`
// tool opens what this writes and this opens what `age` writes (bundle/test/age.test.ts has fixed vectors; test/proof checks it against the real tool).
import { createCipheriv, createDecipheriv, createHmac, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes } from "node:crypto";

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const polymod = (values: number[]): number => {
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3][i];
  }
  return chk;
};
const expand = (hrp: string) => [...[...hrp].map((c) => c.charCodeAt(0) >>> 5), 0, ...[...hrp].map((c) => c.charCodeAt(0) & 31)];
function convert(data: number[], from: number, to: number, pad: boolean): number[] {
  let acc = 0; let bits = 0; const out: number[] = [];
  for (const v of data) { acc = (acc << from) | v; bits += from; while (bits >= to) { bits -= to; out.push((acc >> bits) & ((1 << to) - 1)); } acc &= (1 << bits) - 1; }
  if (pad && bits > 0) out.push((acc << (to - bits)) & ((1 << to) - 1));
  else if (!pad && (bits >= from || (acc << (to - bits)) & ((1 << to) - 1))) throw new Error("not a valid age key (bad padding)");
  return out;
}
function bech32Encode(hrp: string, bytes: Uint8Array): string {
  const data = convert([...bytes], 8, 5, true);
  const check = polymod([...expand(hrp), ...data, 0, 0, 0, 0, 0, 0]) ^ 1;
  return `${hrp}1${[...data, ...Array.from({ length: 6 }, (_, i) => (check >>> (5 * (5 - i))) & 31)].map((d) => CHARSET[d]).join("")}`;
}
function bech32Decode(text: string, hrp: string): Uint8Array {
  const s = text.toLowerCase();
  const at = s.lastIndexOf("1");
  if (at < 1 || s.slice(0, at) !== hrp) throw new Error(`that is not an age key (it should start with ${hrp}1)`);
  const data = [...s.slice(at + 1)].map((c) => CHARSET.indexOf(c));
  if (data.some((d) => d < 0)) throw new Error("that is not an age key (a character that bech32 does not use)");
  if (polymod([...expand(hrp), ...data]) !== 1) throw new Error("that age key has a typing mistake in it (the checksum does not match)");
  return Uint8Array.from(convert(data.slice(0, -6), 5, 8, false));
}

const PKCS8_X25519 = Buffer.from("302e020100300506032b656e04220420", "hex");
const privateKeyFrom = (secret: Uint8Array) => createPrivateKey({ key: Buffer.concat([PKCS8_X25519, secret]), format: "der", type: "pkcs8" });
const rawPublic = (key: ReturnType<typeof createPublicKey>) => Buffer.from(key.export({ format: "jwk" }).x as string, "base64url");
const publicKeyFrom = (raw: Uint8Array) => createPublicKey({ key: { kty: "OKP", crv: "X25519", x: Buffer.from(raw).toString("base64url") }, format: "jwk" });
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64").replace(/=+$/u, "");
const unb64 = (s: string) => Buffer.from(s, "base64");
const hkdf = (ikm: Uint8Array, salt: Uint8Array, info: string) => Buffer.from(hkdfSync("sha256", ikm, salt, info, 32));

/** A new key pair: the recipient (age1..., goes in geometer.json) and the identity (AGE-SECRET-KEY-1..., kept off the server). */
export function generateIdentity(): { recipient: string; identity: string } {
  const { privateKey } = generateKeyPairSync("x25519");
  const d = Buffer.from(privateKey.export({ format: "jwk" }).d as string, "base64url");
  const identity = bech32Encode("age-secret-key-", d).toUpperCase();
  return { identity, recipient: recipientOf(identity) };
}

// The public half of an identity, so the server can be given only the recipient and never the secret that opens snapshots.
export function recipientOf(identity: string): string {
  return bech32Encode("age", rawPublic(createPublicKey(privateKeyFrom(bech32Decode(identity.trim(), "age-secret-key-")))));
}

const CHUNK = 64 * 1024;
const nonceFor = (counter: number, last: boolean) => { const n = Buffer.alloc(12); n.writeBigUInt64BE(BigInt(counter), 3); n[11] = last ? 1 : 0; return n; };

// age file encryption to one X25519 recipient, in 64 KiB chunks like the age format, so any standard age tool can open the output.
export function encrypt(plain: Uint8Array, recipient: string): Buffer {
  const rpk = bech32Decode(recipient.trim(), "age");
  if (rpk.length !== 32) throw new Error("that is not an age recipient (a public key is 32 bytes)");
  const fileKey = randomBytes(16);
  const { privateKey: esk, publicKey: epkKey } = generateKeyPairSync("x25519");
  const epk = rawPublic(epkKey);
  const shared = diffieHellman({ privateKey: esk, publicKey: publicKeyFrom(rpk) });
  const wrapKey = hkdf(shared, Buffer.concat([epk, rpk]), "age-encryption.org/v1/X25519");
  const wrap = createCipheriv("chacha20-poly1305", wrapKey, Buffer.alloc(12), { authTagLength: 16 });
  const wrapped = Buffer.concat([wrap.update(fileKey), wrap.final(), wrap.getAuthTag()]);
  const body = b64(wrapped).match(/.{1,64}/gu)?.join("\n") ?? "";
  const head = `age-encryption.org/v1\n-> X25519 ${b64(epk)}\n${body}\n---`;
  const mac = createHmac("sha256", hkdf(fileKey, Buffer.alloc(0), "header")).update(head).digest();
  const nonce = randomBytes(16);
  const payloadKey = hkdf(fileKey, nonce, "payload");
  const parts: Buffer[] = [Buffer.from(`${head} ${b64(mac)}\n`), nonce];
  const total = Math.max(1, Math.ceil(plain.length / CHUNK));
  for (let i = 0; i < total; i++) {
    const c = createCipheriv("chacha20-poly1305", payloadKey, nonceFor(i, i === total - 1), { authTagLength: 16 });
    parts.push(Buffer.concat([c.update(plain.subarray(i * CHUNK, (i + 1) * CHUNK)), c.final(), c.getAuthTag()]));
  }
  return Buffer.concat(parts);
}

// The inverse of encrypt. Throws on a wrong key or a damaged file rather than returning partial plaintext, since every chunk is authenticated.
export function decrypt(file: Uint8Array, identity: string): Buffer {
  const secret = bech32Decode(identity.trim(), "age-secret-key-");
  const me = privateKeyFrom(secret);
  const mine = rawPublic(createPublicKey(me));
  const buf = Buffer.from(file);
  const endOfHeader = buf.indexOf("\n--- ");
  const macEnd = endOfHeader < 0 ? -1 : buf.indexOf("\n", endOfHeader + 5);
  if (!buf.toString("latin1", 0, 22).startsWith("age-encryption.org/v1\n") || macEnd < 0) throw new Error("this is not an age file");
  const header = buf.toString("latin1", 0, endOfHeader + 4); // through the three dashes
  const given = unb64(buf.toString("latin1", endOfHeader + 5, macEnd));
  const stanzas = header.split("\n").slice(1, -1);
  let fileKey: Buffer | undefined;
  for (let i = 0; i < stanzas.length && !fileKey; i++) {
    const m = /^-> X25519 (\S+)$/u.exec(stanzas[i]);
    if (!m) continue;
    let body = ""; i++;
    while (i < stanzas.length && !stanzas[i].startsWith("-> ")) body += stanzas[i++];
    i--;
    try {
      const epk = unb64(m[1]);
      const shared = diffieHellman({ privateKey: me, publicKey: publicKeyFrom(epk) });
      const d = createDecipheriv("chacha20-poly1305", hkdf(shared, Buffer.concat([epk, mine]), "age-encryption.org/v1/X25519"), Buffer.alloc(12), { authTagLength: 16 });
      const wrapped = unb64(body);
      d.setAuthTag(wrapped.subarray(16));
      fileKey = Buffer.concat([d.update(wrapped.subarray(0, 16)), d.final()]);
    } catch { /* not for this key */ }
  }
  if (!fileKey) throw new Error("this key cannot open this file");
  const expected = createHmac("sha256", hkdf(fileKey, Buffer.alloc(0), "header")).update(header).digest();
  if (!expected.equals(given)) throw new Error("the file's header was changed (its checksum does not match)");
  const nonce = buf.subarray(macEnd + 1, macEnd + 17);
  const payloadKey = hkdf(fileKey, nonce, "payload");
  const payload = buf.subarray(macEnd + 17);
  const out: Buffer[] = [];
  const size = CHUNK + 16;
  const count = Math.max(1, Math.ceil(payload.length / size));
  for (let i = 0; i < count; i++) {
    const chunk = payload.subarray(i * size, (i + 1) * size);
    const d = createDecipheriv("chacha20-poly1305", payloadKey, nonceFor(i, i === count - 1), { authTagLength: 16 });
    d.setAuthTag(chunk.subarray(chunk.length - 16));
    out.push(Buffer.concat([d.update(chunk.subarray(0, chunk.length - 16)), d.final()]));
  }
  return Buffer.concat(out);
}
