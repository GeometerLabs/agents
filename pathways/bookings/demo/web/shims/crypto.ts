// Stand-in for the two things the template takes from node:crypto, for the browser build. The build points `node:crypto` here.
//
//  - createHash("sha256").update(text).digest("hex"): the action record fingerprints its inputs (modules/record/record.ts), and it does so
//    synchronously, so WebCrypto (which answers later) cannot be used without changing the record. This is plain SHA-256 in JavaScript.
//    The tests compare it with Node's own on text in several scripts, so a browser's fingerprints equal a live shop's.
//  - randomInt(max): the approvals relay's one-use codes (modules/approvals/code.ts), from the browser's own random numbers.

const primes: number[] = [];
for (let n = 2; primes.length < 64; n++) if (primes.every((p) => n % p !== 0)) primes.push(n);
const fraction = (x: number) => Math.floor((x - Math.floor(x)) * 2 ** 32);
/** SHA-256's constants are the first 32 bits of the fractional parts of the cube roots (round constants) and square roots (start values) of the first primes. */
const K = Uint32Array.from(primes.map((p) => fraction(Math.cbrt(p))));
const START = Uint32Array.from(primes.slice(0, 8).map((p) => fraction(Math.sqrt(p))));

const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

function sha256(bytes: Uint8Array): Uint8Array {
  const length = bytes.length;
  const padded = new Uint8Array(((length + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(length / 0x20000000)); // the length in bits, as 64 bits
  view.setUint32(padded.length - 4, (length << 3) >>> 0);

  const h = Uint32Array.from(START);
  const w = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = w[i - 16] + s0 + w[i - 7] + s1; // a Uint32Array keeps the low 32 bits
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  h.forEach((word, i) => outView.setUint32(i * 4, word));
  return out;
}

export interface Hash {
  update(data: string | Uint8Array): Hash;
  digest(encoding?: "hex"): string | Uint8Array;
}

export function createHash(algorithm: string): Hash {
  if (algorithm !== "sha256") throw new Error(`The browser build can only make sha256 fingerprints, not ${algorithm}.`);
  const parts: Uint8Array[] = [];
  const hash: Hash = {
    update(data) {
      parts.push(typeof data === "string" ? new TextEncoder().encode(data) : data);
      return hash;
    },
    digest(encoding) {
      const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
      let at = 0;
      for (const p of parts) { all.set(p, at); at += p.length; }
      const out = sha256(all);
      if (encoding === undefined) return out;
      if (encoding !== "hex") throw new Error(`The browser build can only give a fingerprint as hex, not ${encoding}.`);
      return Array.from(out, (b) => b.toString(16).padStart(2, "0")).join("");
    },
  };
  return hash;
}

/** A whole number from min up to but not including max (or from 0 up to the one argument), drawn without bias. */
export function randomInt(minOrMax: number, max?: number): number {
  const min = max === undefined ? 0 : minOrMax;
  const top = max === undefined ? minOrMax : max;
  const range = top - min;
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(top) || range <= 0 || range > 2 ** 32) throw new RangeError("randomInt needs whole numbers with max above min, and a range of at most 2^32.");
  const limit = 2 ** 32 - (2 ** 32 % range);
  const draw = new Uint32Array(1);
  do globalThis.crypto.getRandomValues(draw); while (draw[0] >= limit);
  return min + (draw[0] % range);
}
