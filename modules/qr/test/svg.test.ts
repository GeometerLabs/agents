// The SVG picture: it draws exactly the modules of the matrix, loads nothing, and the matrix reads back as the text it was made from.
import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeQr } from "../qr.ts";
import { qrSvg, textQrSvg } from "../svg.ts";
import { darkFromSvg, readQr } from "./read.ts";

test("the encoder's matrix reads back as the text: short and long text, other scripts, several versions, every mask", () => {
  const texts = ["HELLO WORLD", "https://geometer.dev/verify/#sha256:" + "ab".repeat(32), "upi://pay?pa=a@b&pn=" + encodeURIComponent("ഗ്ലോ ಕನ್ನಡ हिंदी"), "x", "é".repeat(100), "z".repeat(213)];
  const seen = new Set<number>();
  for (const t of texts) { const qr = encodeQr(t); seen.add(qr.version); assert.equal(readQr(qr), t); }
  for (const mask of [0, 1, 2, 3, 4, 5, 6, 7]) assert.equal(readQr(encodeQr("mask " + mask, { mask })), "mask " + mask);
  assert.ok(seen.size >= 4, "several versions were read back");
});

test("the SVG draws exactly the dark modules of the matrix, and loads nothing from outside", () => {
  const qr = encodeQr("https://geometer.dev/verify/#sha256:" + "0f".repeat(32));
  const svg = qrSvg(qr, { label: 'Scan "me" <now>' });
  assert.deepEqual(darkFromSvg(svg, qr.size), qr.dark);
  assert.ok(svg.startsWith("<svg ") && svg.endsWith("</svg>"));
  assert.ok(svg.includes(`viewBox="0 0 ${qr.size + 8} ${qr.size + 8}"`));
  assert.ok(svg.includes('role="img" aria-label="Scan &quot;me&quot; &lt;now&gt;"'), "the label is escaped");
  assert.ok(!/href|<script|<image|url\(|<style|on\w+=/i.test(svg), "nothing fetched or run");
  assert.ok(textQrSvg("a").includes('aria-hidden="true"'), "no label: hidden from screen readers");
});
