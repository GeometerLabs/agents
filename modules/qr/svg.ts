// A QR code as an inline SVG, for a page that may load nothing from outside (modules/report/page.ts has a content policy that forbids it). Black on white with a
// quiet zone of four modules, the standard's least. Each row's dark runs are joined into one rectangle, so a version 3 code is a few hundred characters of path.
// No node: imports, so the browser demo can use it as well as the server.
import type { QrCode } from "./qr.ts";
import { encodeQr } from "./qr.ts";

export interface SvgOptions {
  /** Modules of white around the code. Default 4, the standard's least. */
  border?: number;
  /** The words a screen reader says for the picture (this function escapes them). Left out, the picture is hidden from screen readers. */
  label?: string;
  /** The width in CSS pixels. Default: left to the stylesheet. */
  width?: number;
}

const escapeAttribute = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The SVG text of a QR code. */
export function qrSvg(qr: QrCode, options: SvgOptions = {}): string {
  const border = options.border ?? 4;
  const total = qr.size + 2 * border;
  let path = "";
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (!qr.dark[y][x]) continue;
      let run = 1;
      while (x + run < qr.size && qr.dark[y][x + run]) run++;
      path += `M${x + border} ${y + border}h${run}v1h-${run}z`;
      x += run - 1;
    }
  }
  const label = options.label ? ` role="img" aria-label="${escapeAttribute(options.label)}"` : ` aria-hidden="true"`;
  const width = options.width ? ` width="${options.width}" height="${options.width}"` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}"${width}${label} shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}

/** The SVG text of the QR code for this text. */
export const textQrSvg = (text: string, options?: SvgOptions): string => qrSvg(encodeQr(text), options);
