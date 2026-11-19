// Writes the test vectors of the Go QR encoder (internal/qr/testdata/vectors.json): what modules/qr/qr.ts and svg.ts give on a set of texts (short, a UPI link, 200 and 600 bytes,
// a text on a version boundary, Hindi, Malayalam and Kannada), made by RUNNING the TypeScript. The matrix is saved as rows of "0"/"1" characters. The Go test compares exactly.
// Run from the repository root:  node go/scripts/gen_qr_vectors.ts   (--check only compares)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { byteCapacity, encodeQr } from "../../modules/qr/qr.ts";
import { qrSvg, textQrSvg } from "../../modules/qr/svg.ts";

const here = dirname(fileURLToPath(import.meta.url));
const INTERNAL = join(here, "..", "internal");
export const OUT = INTERNAL;

const TEXTS: string[] = [
  "x", "HELLO WORLD", "https://geometer.dev/verify/#sha256:" + "ab".repeat(32),
  "upi://pay?pa=shop@upi&pn=" + encodeURIComponent("Sri Lakshmi Stores") + "&am=1250.00&cu=INR&tn=Order%20417",
  "upi://pay?pa=a@b&pn=" + encodeURIComponent("ഗ്ലോ ಕನ್ನಡ हिंदी"),
  "ഹരിതം സ്റ്റോർ — കൊച്ചി", "ಕನ್ನಡ ಅಂಗಡಿ ಬೆಂಗಳೂರು", "हिंदी दुकान दिल्ली ₹1,250",
  "é".repeat(100), "z".repeat(200), "q".repeat(600),
  "y".repeat(14), "y".repeat(15), "y".repeat(26), "y".repeat(27), "y".repeat(213), "y".repeat(214), "y".repeat(1100),
];

export function generate(): Map<string, string> {
  const out = new Map<string, string>();
  const cases = TEXTS.map((text) => {
    const qr = encodeQr(text);
    return { text, version: qr.version, mask: qr.mask, rows: qr.dark.map((r) => r.map((d) => (d ? "1" : "0")).join("")), svg: qrSvg(qr), textSvg: textQrSvg(text) };
  });
  const options = [
    { text: "https://geometer.dev/pay", border: 0, label: 'Scan "me" <to> pay & go', width: 220 },
    { text: "upi://pay?pa=a@b", border: 2, label: "", width: 0 },
    { text: "plain", border: undefined, label: "UPI", width: 0 },
  ].map((o) => ({ ...o, svg: qrSvg(encodeQr(o.text), { ...(o.border !== undefined ? { border: o.border } : {}), ...(o.label ? { label: o.label } : {}), ...(o.width ? { width: o.width } : {}) }) }));
  const masks = [0, 1, 2, 3, 4, 5, 6, 7].map((m) => { const qr = encodeQr("mask " + m, { mask: m }); return { text: "mask " + m, mask: m, version: qr.version, rows: qr.dark.map((r) => r.map((d) => (d ? "1" : "0")).join("")) }; });
  // every version 1 to 40, filled to its capacity, so both hand-copied level-M tables, the alignment positions (version 32 has its own step) and the version information are all compared
  const versions = Array.from({ length: 40 }, (_, i) => i + 1).map((v) => {
    const text = "Q".repeat(byteCapacity(v));
    const qr = encodeQr(text, { minVersion: v });
    return { version: v, length: text.length, mask: qr.mask, size: qr.size, rowsSha256: createHash("sha256").update(qr.dark.map((r) => r.map((d) => (d ? "1" : "0")).join("")).join("\n")).digest("hex") };
  });
  const tooLong = (() => { try { encodeQr("w".repeat(2400)); return null; } catch (e) { return (e as Error).message; } })();
  out.set("qr/testdata/vectors.json", JSON.stringify({ cases, options, masks, versions, tooLong }, null, 0) + "\n");
  return out;
}

export function staleFiles(root = INTERNAL): string[] {
  return [...generate()].filter(([name, text]) => !existsSync(join(root, name)) || readFileSync(join(root, name), "utf8") !== text).map(([name]) => name);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--check")) {
    const stale = staleFiles();
    if (stale.length) { console.error(`out of date: ${stale.join(", ")}  (run node go/scripts/gen_qr_vectors.ts)`); process.exit(1); }
  } else {
    for (const [name, text] of generate()) { mkdirSync(dirname(join(INTERNAL, name)), { recursive: true }); writeFileSync(join(INTERNAL, name), text); }
  }
}
