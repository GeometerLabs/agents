// A QR code encoder, written here so the repository keeps its rule of no dependencies. It does one thing: text in byte mode (UTF-8) at error-correction
// level M (about 15% of the code can be lost and still read), any version 1 to 40, the mask chosen by the standard's penalty rules.
//
// It follows ISO/IEC 18004:2015 (the QR code standard): the bit stream (section 7.4), the Reed-Solomon codes over GF(256) with the polynomial
// x^8 + x^4 + x^3 + x^2 + 1 (7.5), the split into blocks and their interleaving (7.6), the function patterns and the order the data goes in (7.7),
// the eight masks and the four penalty rules (7.8), and the format and version information with their BCH codes (7.9, 7.10). The two tables below are
// the standard's table 9 for level M. Tests check it against worked examples and against an independent encoder (modules/payments/upi/test/qr.test.ts).
//
// Level M and byte mode are fixed on purpose: a UPI link is plain ASCII except for a payee name in another script, and level M is what payment QR codes
// usually use; a phone camera reads it from a WhatsApp image without trouble.

/** For level M, version 1 to 40 (index 0 is version 1): how many error-correction codewords each block has, and how many blocks there are. ISO/IEC 18004 table 9. */
const EC_PER_BLOCK_M = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
const BLOCKS_M = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49];
/** Level M's two bits in the format information (L = 01, M = 00, Q = 11, H = 10). */
const LEVEL_M_BITS = 0b00;

export interface QrCode {
  version: number;
  /** Modules on a side: 17 + 4 × version. */
  size: number;
  /** The mask that was used (0 to 7). */
  mask: number;
  /** `dark[y][x]`: true for a dark module. Row by row, from the top left. No quiet zone: the picture adds it. */
  dark: boolean[][];
}

// ---- GF(256) and Reed-Solomon -----------------------------------------------------------------------------------------------

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}
const mul = (a: number, b: number): number => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** The generator polynomial of degree `n`: (x - α^0)(x - α^1)...(x - α^(n-1)), its coefficients from the highest power down, the leading 1 left out. */
function generator(n: number): number[] {
  let poly = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) { next[j] ^= poly[j]; next[j + 1] ^= mul(poly[j], EXP[i]); }
    poly = next;
  }
  return poly.slice(1);
}

/** The `n` error-correction codewords of these data codewords: the remainder of data × x^n divided by the generator. */
export function reedSolomon(data: readonly number[], n: number): number[] {
  const gen = generator(n);
  const rem = new Array<number>(n).fill(0);
  for (const byte of data) {
    const factor = byte ^ rem[0];
    rem.shift();
    rem.push(0);
    for (let i = 0; i < n; i++) rem[i] ^= mul(gen[i], factor);
  }
  return rem;
}

// ---- sizes --------------------------------------------------------------------------------------------------------------------

/** The modules left for data and error correction once the function patterns are drawn (all of it is whole codewords plus 0 to 7 remainder bits). */
function rawModules(version: number): number {
  let n = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    n -= (25 * align - 10) * align - 55;
    if (version >= 7) n -= 36;
  }
  return n;
}

/** How many data codewords a version holds at level M. */
export function dataCodewords(version: number): number {
  return Math.floor(rawModules(version) / 8) - EC_PER_BLOCK_M[version - 1] * BLOCKS_M[version - 1];
}

/** The bits a byte-mode segment of `n` bytes needs in this version: the mode (4), the count (8 bits up to version 9, 16 above), the bytes. */
const segmentBits = (version: number, n: number): number => 4 + (version <= 9 ? 8 : 16) + 8 * n;

/** The most bytes a level-M code of this version can carry in byte mode. */
export function byteCapacity(version: number): number {
  const bits = dataCodewords(version) * 8 - 4 - (version <= 9 ? 8 : 16);
  return Math.min(Math.floor(bits / 8), version <= 9 ? 255 : 65535);
}

// ---- the codewords ------------------------------------------------------------------------------------------------------------

/** The data codewords for these bytes in this version: mode, count, the bytes, the terminator, then the pad bytes 0xEC 0x11 in turn. */
export function dataCodewordsFor(bytes: Uint8Array, version: number): number[] {
  const bits: number[] = [];
  const put = (value: number, length: number) => { for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
  put(0b0100, 4);
  put(bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  const capacity = dataCodewords(version) * 8;
  if (bits.length > capacity) throw new Error("the text does not fit this version");
  put(0, Math.min(4, capacity - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((n, b) => (n << 1) | b, 0));
  for (let pad = 0xec; out.length < dataCodewords(version); pad ^= 0xec ^ 0x11) out.push(pad);
  return out;
}

/** The data codewords split into blocks, each with its error correction, interleaved as the standard sends them. */
export function finalCodewords(data: readonly number[], version: number): number[] {
  const blocks = BLOCKS_M[version - 1];
  const ecLen = EC_PER_BLOCK_M[version - 1];
  const raw = Math.floor(rawModules(version) / 8);
  const shortBlocks = blocks - (raw % blocks);
  const shortLen = Math.floor(raw / blocks); // a short block's length, data and error correction together
  const split: { data: number[]; ec: number[] }[] = [];
  for (let i = 0, k = 0; i < blocks; i++) {
    const len = shortLen - ecLen + (i < shortBlocks ? 0 : 1);
    const d = data.slice(k, k + len);
    k += len;
    split.push({ data: d, ec: reedSolomon(d, ecLen) });
  }
  const out: number[] = [];
  for (let i = 0; i <= shortLen - ecLen; i++) for (const b of split) if (i < b.data.length) out.push(b.data[i]);
  for (let i = 0; i < ecLen; i++) for (const b of split) out.push(b.ec[i]);
  return out;
}

// ---- the matrix ---------------------------------------------------------------------------------------------------------------

/** Where the alignment patterns' centres are, on each axis (ISO/IEC 18004 annex E). */
export function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const size = 17 + 4 * version;
  const step = version === 32 ? 26 : Math.ceil((size - 13) / (count * 2 - 2)) * 2;
  const out = [6];
  for (let pos = size - 7; out.length < count; pos -= step) out.splice(1, 0, pos);
  return out;
}

/** The 15 format bits for level M and a mask: BCH(15,5) with the generator 0x537, then XOR 0x5412. */
export function formatBits(mask: number): number {
  const data = (LEVEL_M_BITS << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

/** The 18 version bits (version 7 and up): BCH(18,6) with the generator 0x1F25. */
export function versionBits(version: number): number {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

interface Grid { size: number; dark: boolean[][]; fixed: boolean[][] }

function emptyGrid(size: number): Grid {
  return { size, dark: Array.from({ length: size }, () => new Array<boolean>(size).fill(false)), fixed: Array.from({ length: size }, () => new Array<boolean>(size).fill(false)) };
}

const setFixed = (g: Grid, x: number, y: number, dark: boolean) => { g.dark[y][x] = dark; g.fixed[y][x] = true; };

function drawFunctionPatterns(g: Grid, version: number): void {
  const size = g.size;
  for (let i = 0; i < size; i++) { setFixed(g, 6, i, i % 2 === 0); setFixed(g, i, 6, i % 2 === 0); } // timing patterns
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      setFixed(g, x, y, d !== 2 && d !== 4); // dark ring, light ring, dark 3x3 centre, light separator
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  const align = alignmentPositions(version);
  for (let i = 0; i < align.length; i++) for (let j = 0; j < align.length; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === align.length - 1) || (i === align.length - 1 && j === 0)) continue; // under a finder
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setFixed(g, align[i] + dx, align[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  drawFormat(g, 0); // reserve the format areas (drawn again with the real mask)
  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const bit = ((bits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3), b = Math.floor(i / 3);
      setFixed(g, a, b, bit);
      setFixed(g, b, a, bit);
    }
  }
}

function drawFormat(g: Grid, mask: number): void {
  const bits = formatBits(mask);
  const bit = (i: number) => ((bits >>> i) & 1) === 1;
  const size = g.size;
  // around the top-left finder
  for (let i = 0; i <= 5; i++) setFixed(g, 8, i, bit(i));
  setFixed(g, 8, 7, bit(6));
  setFixed(g, 8, 8, bit(7));
  setFixed(g, 7, 8, bit(8));
  for (let i = 9; i < 15; i++) setFixed(g, 14 - i, 8, bit(i));
  // the copy, split between the other two finders
  for (let i = 0; i < 8; i++) setFixed(g, size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) setFixed(g, 8, size - 15 + i, bit(i));
  setFixed(g, 8, size - 8, true); // the dark module
}

/** The codewords' bits, placed two columns at a time from the bottom right, up and down in turn, skipping the timing column. */
function drawCodewords(g: Grid, codewords: readonly number[]): void {
  const size = g.size;
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (g.fixed[y][x]) continue;
        if (i < codewords.length * 8) g.dark[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
        i++; // a remainder bit past the last codeword stays light
      }
    }
  }
}

/** Whether the mask flips the module at (x, y). ISO/IEC 18004 table 10. */
export function masks(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    case 7: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: throw new Error(`no mask ${mask}`);
  }
}

function applyMask(g: Grid, mask: number): void {
  for (let y = 0; y < g.size; y++) for (let x = 0; x < g.size; x++) if (!g.fixed[y][x] && masks(mask, x, y)) g.dark[y][x] = !g.dark[y][x];
}

/** The standard's four penalty rules (ISO/IEC 18004 7.8.3), added up. The mask with the lowest total is used. */
export function penalty(dark: boolean[][]): number {
  const size = dark.length;
  let score = 0;
  const at = (x: number, y: number, rows: boolean) => (rows ? dark[y][x] : dark[x][y]);
  for (const rows of [true, false]) {
    for (let a = 0; a < size; a++) {
      // rule 1: five or more of the same colour in a row: 3, and 1 more for each beyond five
      let run = 1;
      for (let b = 1; b <= size; b++) {
        if (b < size && at(b, a, rows) === at(b - 1, a, rows)) { run++; continue; }
        if (run >= 5) score += 3 + (run - 5);
        run = 1;
      }
      // rule 3: the finder's 1:1:3:1:1 with four light modules on one side: 40 each
      for (let b = 0; b + 11 <= size; b++) {
        let word = 0;
        for (let k = 0; k < 11; k++) word = (word << 1) | (at(b + k, a, rows) ? 1 : 0);
        if (word === 0b10111010000 || word === 0b00001011101) score += 40;
      }
    }
  }
  // rule 2: each 2x2 block of one colour: 3
  for (let y = 0; y + 1 < size; y++) for (let x = 0; x + 1 < size; x++) {
    const c = dark[y][x];
    if (c === dark[y][x + 1] && c === dark[y + 1][x] && c === dark[y + 1][x + 1]) score += 3;
  }
  // rule 4: 10 for each full 5% the share of dark modules is away from 50%
  let darkCount = 0;
  for (const row of dark) for (const d of row) if (d) darkCount++;
  score += Math.floor(Math.abs((darkCount * 100) / (size * size) - 50) / 5) * 10;
  return score;
}

/** The smallest version (at least `minVersion`) that holds these bytes at level M, or undefined when none does. */
export function versionFor(byteLength: number, minVersion = 1): number | undefined {
  for (let v = Math.max(1, minVersion); v <= 40; v++) if (segmentBits(v, byteLength) <= dataCodewords(v) * 8) return v;
  return undefined;
}

/** Encode text as a QR code: byte mode (UTF-8), level M. `mask` forces one mask (for the tests); left out, the standard's penalty picks it. */
export function encodeQr(text: string, options: { minVersion?: number; mask?: number } = {}): QrCode {
  const bytes = new TextEncoder().encode(text);
  const version = versionFor(bytes.length, options.minVersion);
  if (version === undefined) throw new Error(`The text is ${bytes.length} bytes, more than a QR code at level M can hold.`);
  const codewords = finalCodewords(dataCodewordsFor(bytes, version), version);
  const size = 17 + 4 * version;
  const base = emptyGrid(size);
  drawFunctionPatterns(base, version);
  drawCodewords(base, codewords);
  let best: { mask: number; grid: Grid; score: number } | undefined;
  for (const mask of options.mask !== undefined ? [options.mask] : [0, 1, 2, 3, 4, 5, 6, 7]) {
    const g: Grid = { size, dark: base.dark.map((r) => [...r]), fixed: base.fixed };
    applyMask(g, mask);
    drawFormat(g, mask);
    const score = penalty(g.dark);
    if (!best || score < best.score) best = { mask, grid: g, score };
  }
  return { version, size, mask: best!.mask, dark: best!.grid.dark };
}
