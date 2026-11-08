// The QR encoder and its picture, against vectors that do not come from this encoder:
//  - Reed-Solomon: the worked example "HELLO WORLD" at version 1-M (its 16 data codewords and the 10 error-correction codewords the standard's method gives;
//    the same numbers are in Thonky's QR tutorial and in the qrcode npm package, MIT, version 1.5.3);
//  - the format bits for level M and every mask, and the version bits, as the standard's tables print them (ISO/IEC 18004 annex C and D);
//  - two whole symbols made by the qrcode npm package (1.5.3, byte mode, level M), copied here once as rows of hex. Our encoder must give the same modules,
//    and pick the same mask by itself. (When this was written it matched that package on 72 of 72 symbols: nine texts of 1 to 1,200 bytes, every mask.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { crc32, inflateSync } from "node:zlib";
import { alignmentPositions, byteCapacity, encodeQr, formatBits, reedSolomon, versionBits } from "../qr.ts";
import { qrPng } from "../png.ts";

test("Reed-Solomon: the worked example HELLO WORLD at 1-M gives the standard's ten codewords", () => {
  const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
  assert.deepEqual(reedSolomon(data, 10), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
});

test("format bits for level M, masks 0 to 7, and version bits 7, 8, 20 and 40, as the standard's tables print them", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map(formatBits), [0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0]);
  assert.deepEqual([7, 8, 20, 40].map(versionBits), [0x07c94, 0x085bc, 0x149a6, 0x28c69]);
});

test("alignment pattern centres, as the standard's annex E lists them", () => {
  assert.deepEqual(alignmentPositions(1), []);
  assert.deepEqual(alignmentPositions(2), [6, 18]);
  assert.deepEqual(alignmentPositions(7), [6, 22, 38]);
  assert.deepEqual(alignmentPositions(22), [6, 26, 50, 74, 98]);
  assert.deepEqual(alignmentPositions(32), [6, 34, 60, 86, 112, 138]);
  assert.deepEqual(alignmentPositions(40), [6, 30, 58, 86, 114, 142, 170]);
});

test("capacity at level M in byte mode: 14 bytes at version 1, 213 at version 10, 2,331 at version 40", () => {
  assert.equal(byteCapacity(1), 14);
  assert.equal(byteCapacity(10), 213);
  assert.equal(byteCapacity(40), 2331);
});

const rows = (hex: string[], size: number) => hex.map((h) => BigInt(`0x${h}`).toString(2).padStart(size, "0"));
const ours = (dark: boolean[][]) => dark.map((r) => r.map((d) => (d ? "1" : "0")).join(""));

test("a UPI link: the same symbol, module for module, as an independent encoder, with the same mask chosen", () => {
  const text = "upi://pay?pa=glowsalon@okicici&pn=Glow%20Salon&am=200.00&tn=Glow%20Salon%20b-1&cu=INR";
  const reference = ["1fc4aabf77f", "104ff99e441", "17592dea15d", "175db3b765d", "1758aee0b5d", "1054598e541", "1fd5555557f", "16d1e4300", "17c0aa7ed7c", "1d91c721bf9", "f64c4319a", "1a2944b34f8", "13ebdd158ac", "db41086db5", "167cc5fba4a", "8760e637b", "11c02c3fa85", "1326f660bd3", "1a770442980", "32d4224f81", "1c5f05f303e", "10bfba2cdfd", "f60cdd7948", "33ea1831e8", "f71ba6faa0", "1f9685a0b71", "cea644b840", "31397a60f9", "1862fe4e946", "1f039193093", "1749ca0097e", "1003a79504a", "1056ca1ddf6", "16bfe8513", "1fc1589f550", "105bbccb310", "1755e0b65f7", "1755ef68224", "175e254f758", "1044c0d577a", "1fdc544e8c0"];
  const qr = encodeQr(text);
  assert.equal(qr.version, 6);
  assert.equal(qr.mask, 2);
  assert.deepEqual(ours(qr.dark), rows(reference, 41));
});

test("HELLO WORLD in byte mode with mask 4: the same 21 by 21 symbol as an independent encoder", () => {
  const reference = ["1fd97f", "104241", "174a5d", "17525d", "175d5d", "105241", "1fd57f", "1300", "117ef9", "2170f", "7e6d2", "1f1880", "1f5566", "15eb", "1fdd5a", "104bb3", "175ac6", "17491b", "174e38", "104280", "1fdff5"];
  const qr = encodeQr("HELLO WORLD", { mask: 4 });
  assert.equal(qr.version, 1);
  assert.deepEqual(ours(qr.dark), rows(reference, 21));
  assert.equal(encodeQr("HELLO WORLD").mask, 4, "and it picks mask 4 by itself");
});

test("a payee name in another script still fits (it is about three times longer once percent-encoded), and too much text is refused in plain words", () => {
  const name = encodeURIComponent("ग्लो सैलून और स्पा, कोच्चि"); // a long Hindi name
  const qr = encodeQr(`upi://pay?pa=9876543210@ybl&pn=${name}&am=1500.00&tn=f-3.2&cu=INR`);
  assert.ok(qr.version <= 12, `version ${qr.version}`);
  assert.throws(() => encodeQr("x".repeat(3000)), /more than a QR code at level M can hold/);
});

function readPng(png: Buffer): { width: number; pixels: number[][] } {
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let at = 8;
  const chunks: { type: string; data: Buffer }[] = [];
  while (at < png.length) {
    const len = png.readUInt32BE(at);
    chunks.push({ type: png.toString("latin1", at + 4, at + 8), data: png.subarray(at + 8, at + 8 + len) });
    at += 12 + len;
  }
  assert.deepEqual(chunks.map((c) => c.type), ["IHDR", "IDAT", "IEND"]);
  const width = chunks[0].data.readUInt32BE(0);
  assert.equal(chunks[0].data.readUInt32BE(4), width);
  assert.equal(chunks[0].data[8], 1, "one bit per pixel");
  assert.equal(chunks[0].data[9], 0, "greyscale");
  const raw = inflateSync(chunks[1].data);
  const rowBytes = Math.ceil(width / 8);
  const pixels: number[][] = [];
  for (let y = 0; y < width; y++) {
    assert.equal(raw[y * (rowBytes + 1)], 0, "filter: none");
    pixels.push(Array.from({ length: width }, (_, x) => (raw[y * (rowBytes + 1) + 1 + (x >> 3)] >> (7 - (x & 7))) & 1));
  }
  return { width, pixels };
}

test("the PNG: signature, chunks with their CRC, a quiet zone of four modules, and every module drawn as a black or white square", () => {
  const qr = encodeQr("upi://pay?pa=a1@ybl&pn=A&am=1.00&cu=INR");
  const png = qrPng(qr, { scale: 3 });
  const { width, pixels } = readPng(png);
  assert.equal(width, (qr.size + 8) * 3);
  for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) {
    const mx = Math.floor(x / 3) - 4, my = Math.floor(y / 3) - 4;
    const dark = mx >= 0 && my >= 0 && mx < qr.size && my < qr.size && qr.dark[my][mx];
    if (pixels[y][x] !== (dark ? 0 : 1)) assert.fail(`pixel ${x},${y}`);
  }
  // each chunk's CRC covers its type and data
  let at = 8;
  while (at < png.length) {
    const len = png.readUInt32BE(at);
    assert.equal(png.readUInt32BE(at + 8 + len), crc32(png.subarray(at + 4, at + 8 + len)) >>> 0);
    at += 12 + len;
  }
});
