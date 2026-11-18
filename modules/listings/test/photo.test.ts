// What the server checks about a photo (modules/listings/photo.ts): the kind from the bytes (a PNG renamed .jpg is refused), the size cap, the dimensions from the header, and the
// removal of the places and people a photo can carry (a JPEG's EXIF with GPS and its XMP, a WebP's EXIF and XMP chunks). Written, not run, in the 18 Nov build stream.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_PHOTO_BYTES, MAX_SIDE, PHOTO_ID, checkPhoto, photoIdOf } from "../photo.ts";

const seg = (marker: number, body: number[]): number[] => [0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body];
const text = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));
/** A minimal JPEG: SOI, JFIF, optional extra segments, a frame of the given size, the scan and EOI. */
function jpeg(w: number, h: number, extra: number[][] = []): Uint8Array {
  const sof = seg(0xc0, [8, h >> 8, h & 0xff, w >> 8, w & 0xff, 1, 1, 0x11, 0]);
  return Uint8Array.from([0xff, 0xd8, ...seg(0xe0, [...text("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]), ...extra.flat(), ...seg(0xdb, [0, ...new Array(64).fill(1)]), ...sof, ...seg(0xda, [1, 1, 0, 0, 63, 0]), 1, 2, 3, 0xff, 0xd9]);
}
const gps = seg(0xe1, [...text("Exif"), 0, 0, ...text("GPSLatitude 10.52 N GPSLongitude 76.21 E")]);
const xmp = seg(0xe1, [...text("http://ns.adobe.com/xap/1.0/"), 0, ...text("<x:xmpmeta>owner@example.com</x:xmpmeta>")]);
const iptc = seg(0xed, [...text("Photoshop 3.0"), 0, 1, 2, 3]);
const comment = seg(0xfe, text("taken at 12 Main Road"));
const icc = seg(0xe2, [...text("ICC_PROFILE"), 0, 1, 1, 9, 9]);
const has = (b: Uint8Array, s: string): boolean => Buffer.from(b).includes(Buffer.from(s));

test("a JPEG comes out without its EXIF GPS, XMP, IPTC and comment, and keeps its picture, size and colour profile", () => {
  const r = checkPhoto(jpeg(1200, 800, [gps, xmp, iptc, comment, icc]));
  assert.ok(r.ok);
  assert.deepEqual([r.type, r.width, r.height], ["image/jpeg", 1200, 800]);
  for (const bad of ["GPSLatitude", "Exif", "xmpmeta", "owner@example.com", "Photoshop", "12 Main Road"]) assert.ok(!has(r.bytes, bad), bad);
  assert.ok(has(r.bytes, "ICC_PROFILE") && has(r.bytes, "JFIF"));
  assert.deepEqual([...r.bytes.slice(0, 3)], [0xff, 0xd8, 0xff]);
  assert.deepEqual([...r.bytes.slice(-2)], [0xff, 0xd9]);
  assert.ok(checkPhoto(r.bytes).ok, "what is kept is itself a valid photo");
});

test("the kind is read from the bytes: a PNG renamed .jpg, a text file, an empty file and a cut-off JPEG are refused", () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, ...text("IHDR"), 0, 0, 1, 0, 0, 0, 1, 0, 8, 6, 0, 0, 0]);
  assert.deepEqual(checkPhoto(png), { ok: false, why: "not_a_photo" });
  assert.deepEqual(checkPhoto(Uint8Array.from(text("<script>alert(1)</script>"))), { ok: false, why: "not_a_photo" });
  assert.deepEqual(checkPhoto(new Uint8Array(0)), { ok: false, why: "empty" });
  const whole = jpeg(10, 10);
  assert.deepEqual(checkPhoto(whole.slice(0, whole.length - 6)), { ok: false, why: "unreadable" });
});

test("the size is capped, and so are the dimensions read from the header", () => {
  assert.deepEqual(checkPhoto(new Uint8Array(MAX_PHOTO_BYTES + 1).fill(0xff)), { ok: false, why: "too_big" });
  assert.deepEqual(checkPhoto(jpeg(MAX_SIDE + 1, 100)), { ok: false, why: "too_large_sides" });
  assert.deepEqual(checkPhoto(jpeg(0, 100)), { ok: false, why: "unreadable" });
  assert.ok(checkPhoto(jpeg(MAX_SIDE, 100)).ok);
});

/** A WebP with a lossy frame, EXIF and XMP chunks, in an extended file. */
function webp(w: number, h: number, flags = 0x08 | 0x04): Uint8Array {
  const chunk = (id: string, data: number[]) => [...text(id), data.length & 0xff, (data.length >> 8) & 0xff, 0, 0, ...data, ...(data.length % 2 ? [0] : [])];
  const dim = (n: number) => [(n - 1) & 0xff, ((n - 1) >> 8) & 0xff, 0];
  const vp8x = chunk("VP8X", [flags, 0, 0, 0, ...dim(w), ...dim(h)]);
  const vp8 = chunk("VP8 ", [0, 0, 0, 0x9d, 0x01, 0x2a, w & 0xff, w >> 8, h & 0xff, h >> 8, 1, 2]);
  const body = [...text("WEBP"), ...vp8x, ...vp8, ...chunk("EXIF", text("GPSLatitude 10.52")), ...chunk("XMP ", text("owner@example.com"))];
  return Uint8Array.from([...text("RIFF"), body.length & 0xff, (body.length >> 8) & 0xff, 0, 0, ...body]);
}

test("a WebP comes out without its EXIF and XMP chunks, with the flags cleared, and still reads", () => {
  const r = checkPhoto(webp(640, 480));
  assert.ok(r.ok);
  assert.deepEqual([r.type, r.width, r.height], ["image/webp", 640, 480]);
  assert.ok(!has(r.bytes, "GPSLatitude") && !has(r.bytes, "owner@example.com"));
  assert.equal(r.bytes[20] & 0x0c, 0, "the EXIF and XMP flags are cleared");
  assert.ok(checkPhoto(r.bytes).ok);
});

test("an animated WebP is refused", () => {
  assert.deepEqual(checkPhoto(webp(64, 64, 0x02)), { ok: false, why: "animated" });
});

test("a photo's id comes from its own bytes, never from a name, and has the shape every route checks", () => {
  const a = checkPhoto(jpeg(100, 100));
  assert.ok(a.ok);
  const id = photoIdOf(a.bytes);
  assert.match(id, PHOTO_ID);
  assert.equal(id, photoIdOf(Uint8Array.from(a.bytes)));
  assert.ok(!/\.\.|\/|jpg/u.test(id), "no path, no name");
});
