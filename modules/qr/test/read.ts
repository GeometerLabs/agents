// Reading a QR code back, for the tests: the data modules in the encoder's own order, the mask taken off, the interleaving undone, the mode and the length read, the
// bytes returned. It uses the encoder's layout (functionModules, dataModuleOrder, masks), so it shows that what the encoder wrote is what its own layout says it is, and
// that the error-correction codewords it wrote are the ones the data gives. The independent check of the layout is the reference symbols in qr.test.ts.
import { dataCodewords, dataModuleOrder, finalCodewords, masks } from "../qr.ts";
import type { QrCode } from "../qr.ts";

export function readQr(qr: QrCode): string {
  const order = dataModuleOrder(qr.version);
  const bits = order.map(([x, y]) => (qr.dark[y][x] !== masks(qr.mask, x, y) ? 1 : 0));
  const stream: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) stream.push(bits.slice(i, i + 8).reduce((n, b) => (n << 1) | b, 0));
  const n = dataCodewords(qr.version);
  if (n > 256) throw new Error("the reader marks data codewords with one byte each, so it handles codes of up to 256 data codewords");
  // Where each data codeword went: finalCodewords on 0..n-1 shows, for each place in the stream, which data codeword sits there.
  const placed = finalCodewords(Array.from({ length: n }, (_, i) => i), qr.version).slice(0, n);
  const data = new Array<number>(n);
  placed.forEach((original, place) => { data[original] = stream[place]; });
  const again = finalCodewords(data, qr.version);
  if (JSON.stringify(again) !== JSON.stringify(stream.slice(0, again.length))) throw new Error("the error-correction codewords do not fit the data");
  const take = (from: number, length: number) => { let v = 0; for (let i = 0; i < length; i++) v = (v << 1) | ((data[(from + i) >>> 3] >>> (7 - ((from + i) & 7))) & 1); return v; };
  if (take(0, 4) !== 0b0100) throw new Error("not byte mode");
  const countBits = qr.version <= 9 ? 8 : 16;
  const length = take(4, countBits);
  const bytes = Uint8Array.from({ length }, (_, i) => take(4 + countBits + 8 * i, 8));
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

/** The dark modules an SVG made by `qrSvg` draws (its path of one-module-high rectangles), as a matrix. */
export const darkFromSvg = (svg: string, size: number, border = 4): boolean[][] => {
  const grid = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  for (const m of svg.match(/d="([^"]*)"/)![1].matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    const [x, y, w] = [Number(m[1]) - border, Number(m[2]) - border, Number(m[3])];
    for (let i = 0; i < w; i++) grid[y][x + i] = true;
  }
  return grid;
};
