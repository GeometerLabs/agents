// A tar writer and reader for the shop export: plain "ustar" files in a gzip stream, so the download opens with any tool (tar, 7-Zip, the Finder, the Windows Explorer).
// No dependencies: node:zlib does the gzip. Only regular files, names up to 255 characters, mode 0644, a fixed time (the export's own time, so the same files make the same bytes).
import { gunzipSync, gzipSync } from "node:zlib";

const BLOCK = 512;

function octal(value: number, width: number): string {
  return `${value.toString(8).padStart(width - 1, "0")}\0`;
}

function header(path: string, size: number, mtimeSec: number): Buffer {
  const b = Buffer.alloc(BLOCK);
  let name = path;
  let prefix = "";
  if (Buffer.byteLength(path) > 100) {
    const cut = path.lastIndexOf("/", 155);
    if (cut <= 0 || Buffer.byteLength(path.slice(cut + 1)) > 100 || Buffer.byteLength(path.slice(0, cut)) > 155) throw new Error(`The file name ${path} is too long for a tar file.`);
    prefix = path.slice(0, cut);
    name = path.slice(cut + 1);
  }
  b.write(name, 0, 100, "utf8");
  b.write(octal(0o644, 8), 100, 8, "ascii");
  b.write(octal(0, 8), 108, 8, "ascii");
  b.write(octal(0, 8), 116, 8, "ascii");
  b.write(octal(size, 12), 124, 12, "ascii");
  b.write(octal(mtimeSec, 12), 136, 12, "ascii");
  b.write("        ", 148, 8, "ascii"); // the checksum is counted with these eight as spaces
  b.write("0", 156, 1, "ascii");
  b.write("ustar\0", 257, 6, "ascii");
  b.write("00", 263, 2, "ascii");
  b.write(prefix, 345, 155, "utf8");
  let sum = 0;
  for (const byte of b) sum += byte;
  b.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
  return b;
}

/** The files as a .tar.gz. The order is the order of the map. */
export function toTarGz(files: ReadonlyMap<string, Buffer>, mtimeMs: number): Buffer {
  const parts: Buffer[] = [];
  const mtimeSec = Math.floor(mtimeMs / 1000);
  for (const [path, content] of files) {
    parts.push(header(path, content.length, mtimeSec), content);
    const pad = (BLOCK - (content.length % BLOCK)) % BLOCK;
    if (pad > 0) parts.push(Buffer.alloc(pad));
  }
  parts.push(Buffer.alloc(BLOCK * 2));
  return gzipSync(Buffer.concat(parts), { level: 9 });
}

/** Read a .tar.gz this file made (regular files only). Used by the check and the tests; a tool that reads any tar reads these too. */
export function fromTarGz(archive: Buffer): Map<string, Buffer> {
  const tar = gunzipSync(archive);
  const out = new Map<string, Buffer>();
  let at = 0;
  while (at + BLOCK <= tar.length) {
    const head = tar.subarray(at, at + BLOCK);
    if (head.every((x) => x === 0)) break;
    const text = (from: number, len: number) => head.subarray(from, from + len).toString("utf8").replace(/\0.*$/su, "");
    const size = parseInt(text(124, 12).trim() || "0", 8);
    const prefix = text(345, 155);
    const path = prefix ? `${prefix}/${text(0, 100)}` : text(0, 100);
    at += BLOCK;
    out.set(path, Buffer.from(tar.subarray(at, at + size)));
    at += Math.ceil(size / BLOCK) * BLOCK;
  }
  return out;
}
