// What the server checks about a photo before it keeps it (block S, phase A): a listing's photo comes only through the owner's app, where the phone has already resized it
// (longest side 1600 px) and re-encoded it as JPEG on a canvas, which drops the location. The server does not trust that: it reads the bytes itself, in plain code with no
// dependency and no disk, and this file is PURE so the agents can import it.
//
//  - The kind is read from the file's first bytes (a JPEG's FF D8 FF, a WebP's RIFF....WEBP), never from the name or the type the phone said: a PNG renamed ".jpg" is refused.
//  - The size is capped (1.5 MB) and the dimensions are read from the header (and capped), so nothing huge is stored or later decoded by anyone.
//  - Anything that can carry a place or a person is cut out and the cleaned bytes are what is kept: a JPEG's APP1 (EXIF with the GPS, and XMP), APP13 (Photoshop/IPTC), its
//    comments and other application segments except the plain JFIF header and the colour profile; a WebP's EXIF and XMP chunks, with the flags that announce them cleared.
//    An animated WebP is refused (a still photo is all a listing needs).
//  - The name is never used for anything: a photo's name everywhere is its own id (`photoIdOf`), made from the cleaned bytes.
import { createHash } from "node:crypto";
import type { Photo } from "./listings.ts";

/** The largest file kept (about 1.5 MB: a 1600 px JPEG is far smaller), and the largest side of a photo that is accepted. */
export const MAX_PHOTO_BYTES = 1_500_000;
export const MAX_SIDE = 4096;
/** What the phone aims for: the longest side after its resize. */
export const PHONE_SIDE = 1600;

export type PhotoRefusal = "empty" | "too_big" | "not_a_photo" | "unreadable" | "too_large_sides" | "animated";
export type PhotoCheck = { ok: true; type: Photo["type"]; width: number; height: number; bytes: Uint8Array } | { ok: false; why: PhotoRefusal };

const refuse = (why: PhotoRefusal): { ok: false; why: PhotoRefusal } => ({ ok: false, why });

/** Check, read the dimensions of and clean a photo's bytes. Never throws: a file it cannot read is refused. */
export function checkPhoto(input: Uint8Array): PhotoCheck {
  if (input.length === 0) return refuse("empty");
  if (input.length > MAX_PHOTO_BYTES) return refuse("too_big");
  try {
    if (input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff) return cleanJpeg(input);
    if (input.length > 12 && ascii(input, 0, 4) === "RIFF" && ascii(input, 8, 12) === "WEBP") return cleanWebp(input);
  } catch { return refuse("unreadable"); }
  return refuse("not_a_photo");
}

const ascii = (b: Uint8Array, from: number, to: number): string => String.fromCharCode(...b.subarray(from, to));
const sizeOk = (w: number, h: number): boolean => w >= 1 && h >= 1 && w <= MAX_SIDE && h <= MAX_SIDE;

// ---- JPEG ---------------------------------------------------------------------------------------------------------------------------------------

/** The segments a JPEG keeps besides its image data: the JFIF header (APP0) and the colour profile (APP2, "ICC_PROFILE"), and the tables and frame the image needs. */
function keepsSegment(marker: number, body: Uint8Array): boolean {
  if (marker === 0xe0) return true; // JFIF
  if (marker === 0xe2) return ascii(body, 0, Math.min(11, body.length)) === "ICC_PROFILE"; // a colour profile, not an Exif-like APP2 (FlashPix, MPF)
  if (marker >= 0xe1 && marker <= 0xef) return false; // APP1 (EXIF, XMP), APP13 (IPTC), the other application data
  if (marker === 0xfe) return false; // comments
  return true; // the tables (DQT, DHT, DRI) and the frame (SOF) the image needs
}

function cleanJpeg(b: Uint8Array): PhotoCheck {
  const out: number[] = [0xff, 0xd8];
  const kept: Uint8Array[] = [];
  let width = 0;
  let height = 0;
  let i = 2;
  for (;;) {
    if (i + 4 > b.length) return refuse("unreadable");
    if (b[i] !== 0xff) return refuse("unreadable");
    while (b[i + 1] === 0xff) i += 1; // fill bytes
    const marker = b[i + 1];
    if (marker === 0xd9) return refuse("unreadable"); // the end before any image data
    const length = (b[i + 2] << 8) | b[i + 3];
    if (length < 2 || i + 2 + length > b.length) return refuse("unreadable");
    const body = b.subarray(i + 4, i + 2 + length);
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      if (body.length < 5) return refuse("unreadable");
      height = (body[1] << 8) | body[2];
      width = (body[3] << 8) | body[4];
    }
    if (marker === 0xda) {
      // the start of the image data: everything from here to the end is the image, copied as it is
      if (width === 0 || height === 0) return refuse("unreadable");
      if (!sizeOk(width, height)) return refuse("too_large_sides");
      const head = Uint8Array.from(out);
      const parts = [head, ...kept, b.subarray(i)];
      const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
      let at = 0;
      for (const p of parts) { bytes.set(p, at); at += p.length; }
      if (bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) return refuse("unreadable"); // a cut-off file
      return { ok: true, type: "image/jpeg", width, height, bytes };
    }
    if (keepsSegment(marker, body)) kept.push(b.subarray(i, i + 2 + length));
    i += 2 + length;
  }
}

// ---- WebP ---------------------------------------------------------------------------------------------------------------------------------------

function cleanWebp(b: Uint8Array): PhotoCheck {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const riffSize = view.getUint32(4, true);
  if (riffSize + 8 > b.length || riffSize < 12) return refuse("unreadable");
  const end = riffSize + 8;
  const chunks: { id: string; data: Uint8Array }[] = [];
  let i = 12;
  while (i + 8 <= end) {
    const id = ascii(b, i, i + 4);
    const size = view.getUint32(i + 4, true);
    if (i + 8 + size > end) return refuse("unreadable");
    chunks.push({ id, data: b.subarray(i + 8, i + 8 + size) });
    i += 8 + size + (size % 2);
  }
  if (chunks.length === 0) return refuse("unreadable");
  let width = 0;
  let height = 0;
  const vp8x = chunks.find((c) => c.id === "VP8X");
  if (chunks.some((c) => c.id === "ANIM" || c.id === "ANMF") || (vp8x && (vp8x.data[0] & 0x02) !== 0)) return refuse("animated");
  const image = chunks.find((c) => c.id === "VP8 " || c.id === "VP8L");
  if (!image) return refuse("unreadable");
  const d = image.data;
  if (image.id === "VP8 ") {
    if (d.length < 10 || d[3] !== 0x9d || d[4] !== 0x01 || d[5] !== 0x2a) return refuse("unreadable");
    width = (d[6] | (d[7] << 8)) & 0x3fff;
    height = (d[8] | (d[9] << 8)) & 0x3fff;
  } else {
    if (d.length < 5 || d[0] !== 0x2f) return refuse("unreadable");
    width = 1 + (((d[2] & 0x3f) << 8) | d[1]);
    height = 1 + (((d[4] & 0x0f) << 10) | (d[3] << 2) | ((d[2] & 0xc0) >> 6));
  }
  if (!sizeOk(width, height)) return refuse("too_large_sides");
  // keep everything except the chunks that can carry a place or a person; clear the flags that announce them (EXIF 0x08, XMP 0x04)
  const keep = chunks.filter((c) => c.id !== "EXIF" && c.id !== "XMP ");
  const pieces: Uint8Array[] = [];
  for (const c of keep) {
    const data = c.id === "VP8X" ? Uint8Array.from(c.data) : c.data;
    if (c.id === "VP8X") data[0] = data[0] & ~(0x08 | 0x04);
    const head = new Uint8Array(8);
    head.set(Uint8Array.from(c.id, (ch) => ch.charCodeAt(0)), 0);
    new DataView(head.buffer).setUint32(4, data.length, true);
    pieces.push(head, data);
    if (data.length % 2 === 1) pieces.push(new Uint8Array(1));
  }
  const bodyLength = 4 + pieces.reduce((n, p) => n + p.length, 0);
  const bytes = new Uint8Array(8 + bodyLength);
  bytes.set(Uint8Array.from("RIFF", (ch) => ch.charCodeAt(0)), 0);
  new DataView(bytes.buffer).setUint32(4, bodyLength, true);
  bytes.set(Uint8Array.from("WEBP", (ch) => ch.charCodeAt(0)), 8);
  let at = 12;
  for (const p of pieces) { bytes.set(p, at); at += p.length; }
  return { ok: true, type: "image/webp", width, height, bytes };
}

/** A photo's id: "ph-" and 12 hex digits of the cleaned bytes' hash (the same bytes are the same photo). */
export const photoIdOf = (bytes: Uint8Array): string => `ph-${createHash("sha256").update(bytes).digest("hex").slice(0, 12)}`;
export const PHOTO_ID = /^ph-[0-9a-f]{12}$/u;

/** The file extension a photo's public address carries (the type is also sent as the response's own, with nosniff). */
export const EXTENSION: Record<Photo["type"], string> = { "image/jpeg": "jpg", "image/webp": "webp" };
