// Vector cases for go/internal/qr: the TypeScript encoder (modules/qr/qr.ts), SVG writer (svg.ts) and PNG writer (png.ts) run on a set of texts, with what they made written down:
// the matrix as rows of 0 and 1 (the whole matrix for small codes, its SHA-256 for large ones), the SVG text, and for a PNG its structure and its decompressed scanlines (zlib's
// compressed bytes are not compared: see go/internal/qr/image.go). Deterministic: no clock, no randomness.
import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import { byteCapacity, encodeQr } from "../../../modules/qr/qr.ts";
import { qrSvg } from "../../../modules/qr/svg.ts";
import { qrPng } from "../../../modules/qr/png.ts";

const sha = (b: string | Uint8Array) => createHash("sha256").update(b).digest("hex");

/** Texts of every size class: real UPI links, other scripts, edge sizes, and for each version the longest text that fits it and one byte more. */
function texts(): { text: string; options?: { minVersion?: number; mask?: number } }[] {
  const out: { text: string; options?: { minVersion?: number; mask?: number } }[] = [];
  const upi = "upi://pay?pa=glowsalon@okaxis&pn=Glow%20Salon&am=600.00&cu=INR&tn=Deposit%20for%20Haircut%20b-3&tr=b-3";
  const add = (text: string, options?: { minVersion?: number; mask?: number }) => out.push(options ? { text, options } : { text });
  for (const t of ["", "a", "ab", "HELLO WORLD", "https://geometer.dev", upi, "upi://pay?pa=a@b&pn=%E0%A4%A6%E0%A5%81%E0%A4%95%E0%A4%BE%E0%A4%A8&am=1.00&cu=INR", "दुकान की शर्तें 日本語 é ß ☃ 😀", "0123456789".repeat(5), "x".repeat(14), "x".repeat(15), "x".repeat(26), "x".repeat(27), "\u0000\u0001ÿ", "emoji 😀 mask test", "A".repeat(100), upi + upi]) add(t);
  for (let mask = 0; mask < 8; mask++) { add(upi, { mask }); add("hello", { mask }); }
  for (const minVersion of [1, 2, 5, 7, 10, 20, 40]) add("hello", { minVersion });
  add(upi, { minVersion: 7, mask: 3 });
  add("x", { minVersion: 41 }); // no version: an error
  add("x", { mask: 8 });
  add("x", { mask: -1 });
  for (let v = 1; v <= 40; v++) {
    const cap = byteCapacity(v);
    let s = "";
    for (let i = 0; s.length < cap; i++) s += String.fromCharCode(33 + ((i * 7 + v) % 90)); // ASCII, so a char is a byte
    add(s);
    add(s + "!");
  }
  add("y".repeat(2331)); // the most version 40 holds
  add("y".repeat(2332)); // one more: an error
  return out;
}

function encodeCase(c: { text: string; options?: { minVersion?: number; mask?: number } }): any {
  try {
    const q = encodeQr(c.text, c.options);
    const rows = q.dark.map((r) => r.map((d) => (d ? "1" : "0")).join(""));
    return { ...c, version: q.version, size: q.size, mask: q.mask, sha: sha(rows.join("\n")), ...(q.size <= 45 ? { rows } : {}) };
  } catch (e) { return { ...c, error: (e as Error).message }; }
}

const SVG_TEXTS = ["hello", "upi://pay?pa=glowsalon@okaxis&pn=Glow%20Salon&am=600.00&cu=INR&tn=Deposit&tr=b-3", "x".repeat(150), ""];
const SVG_OPTIONS: any[] = [{}, { border: 0 }, { border: 1 }, { border: 10 }, { label: "UPI QR for \"Glow\" <Salon> & Co" }, { label: "" }, { width: 240 }, { width: 0 }, { label: "pay", width: 120, border: 2 }, { width: -5 }, { label: "दुकान é 日本" }];

function pngInfo(png: Buffer) {
  const chunks: { type: string; data: Buffer }[] = [];
  for (let i = 8; i < png.length;) { const len = png.readUInt32BE(i); chunks.push({ type: png.toString("latin1", i + 4, i + 8), data: png.subarray(i + 8, i + 8 + len) }); i += 12 + len; }
  const idat = Buffer.concat(chunks.filter((c) => c.type === "IDAT").map((c) => c.data));
  const raw = inflateSync(idat);
  return { signature: png.subarray(0, 8).toString("hex"), chunkTypes: chunks.map((c) => c.type), ihdr: chunks[0].data.toString("hex"), iend: png.subarray(png.length - 12).toString("hex"), rawLength: raw.length, rawSha: sha(raw), width: chunks[0].data.readUInt32BE(0) };
}

export function qrVectors(): unknown {
  const matrices = texts().map(encodeCase);
  const svgs: unknown[] = [];
  for (const text of SVG_TEXTS) for (const options of SVG_OPTIONS) { const s = qrSvg(encodeQr(text), options); svgs.push({ text, options, svg: s }); }
  const pngs: unknown[] = [];
  const pngTexts = ["hello", "upi://pay?pa=glowsalon@okaxis&pn=Glow%20Salon&am=600.00&cu=INR&tn=Deposit&tr=b-3", "x".repeat(150), "y".repeat(500)];
  const pngOptions: any[] = [{}, { scale: 1 }, { scale: 3, border: 0 }, { scale: 5, border: 2 }, { scale: 8, border: 4 }, { scale: 2, border: 7 }, { scale: 0 }, { scale: 1.5 }, { border: -1 }, { border: 0.5 }];
  for (const text of pngTexts) for (const options of pngOptions) {
    try { pngs.push({ text, options, ...pngInfo(qrPng(encodeQr(text), options)) }); } catch (e) { pngs.push({ text, options, error: (e as Error).message }); }
  }
  return { matrices, svgs, pngs };
}

export async function files(): Promise<[string, unknown][]> {
  return [["qr/testdata/qr-vectors.json", qrVectors()]];
}
