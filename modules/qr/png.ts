// A QR code as a PNG picture: black on white, a quiet zone of four modules (the standard asks for at least four), each module a square of pixels.
// One-bit greyscale, compressed with the deflate that Node has built in (node:zlib), so no dependency. The PNG layout is the W3C's PNG specification
// (third edition): the signature, IHDR, one IDAT, IEND, each chunk with its CRC-32.
//
// This file uses node:zlib, so an agent never imports it directly: the server gives the agent a way to make and host the picture (see payments/owner-marked/qr-image.ts), and the
// browser demo, which has no node:zlib, simply has none.
import { crc32, deflateSync } from "node:zlib";
import type { QrCode } from "./qr.ts";
import { encodeQr } from "./qr.ts";

const SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "latin1");
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)) >>> 0, 8 + data.length);
  return out;
}

export interface PngOptions {
  /** Pixels per module. Default 8: a version 10 code is then 520 pixels across with its quiet zone. */
  scale?: number;
  /** Modules of white around the code. Default 4, the standard's least. */
  border?: number;
}

/** The PNG bytes of a QR code. */
export function qrPng(qr: QrCode, options: PngOptions = {}): Buffer {
  const scale = options.scale ?? 8;
  const border = options.border ?? 4;
  if (!Number.isInteger(scale) || scale < 1 || !Number.isInteger(border) || border < 0) throw new Error("scale and border must be whole numbers");
  const width = (qr.size + 2 * border) * scale;
  const rowBytes = Math.ceil(width / 8);
  const raw = Buffer.alloc((rowBytes + 1) * width, 0xff); // white everywhere; each row's first byte is its filter (0, none)
  for (let py = 0; py < width; py++) {
    const row = py * (rowBytes + 1);
    raw[row] = 0;
    const y = Math.floor(py / scale) - border;
    // pad bits past the last pixel stay 1 (white), as the bytes were filled
    for (let px = 0; px < width; px++) {
      const x = Math.floor(px / scale) - border;
      const isDark = y >= 0 && y < qr.size && x >= 0 && x < qr.size && qr.dark[y][x];
      if (isDark) raw[row + 1 + (px >>> 3)] &= ~(0x80 >>> (px & 7)); // 0 is black in one-bit greyscale
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(width, 4);
  header[8] = 1; // bit depth
  header[9] = 0; // greyscale
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering (every row says "none")
  header[12] = 0; // not interlaced
  return Buffer.concat([SIGNATURE, chunk("IHDR", header), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", new Uint8Array(0))]);
}

/** The PNG of the QR code of a text (a `upi://pay` link). */
export const textQrPng = (text: string, options?: PngOptions): Buffer => qrPng(encodeQr(text), options);
