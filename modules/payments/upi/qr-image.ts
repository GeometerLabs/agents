// Making the QR picture of a `upi://pay` link and putting it where WhatsApp can fetch it. WhatsApp does not make a `upi://` link tappable, so the customer gets the
// QR code as an image message (sent by its https address, as a document is) and the link and the amount as text.
//
// The agent is handed one of these as `qrImage` (it never imports this file: it uses node:zlib, which the browser demo does not have).
//  - On a server: the picture is written under a fresh random folder name into the folder the monthly report's pages are served from (runtime.json
//    `report.pagesDir`, served read-only with no listing at `report.pageBaseUrl`). The name is 128 random bits, so the address cannot be guessed; the picture holds
//    nothing the customer is not sent anyway (the shop's UPI ID, its name, the amount and the reference).
//  - In the tests and the hand check: kept in memory, so a test can read the very bytes that would have been sent.
// With neither, there is no picture and the customer gets the text (the link, the UPI ID and the amount), which is enough to pay by hand.
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { textQrPng } from "../../qr/png.ts";

/** Make the picture of this text and host it; the https address, or null when it could not be made. */
export type QrImageMaker = (text: string) => Promise<string | null>;

/** Into a folder served read-only at `baseUrl` (https, no trailing slash). */
export function folderQrImages(o: { dir: string; baseUrl: string; log?: (line: string) => void }): QrImageMaker {
  return async (text) => {
    try {
      const name = randomBytes(16).toString("hex");
      mkdirSync(join(o.dir, name), { recursive: true, mode: 0o755 });
      writeFileSync(join(o.dir, name, "upi-qr.png"), textQrPng(text), { mode: 0o644 });
      return `${o.baseUrl.replace(/\/+$/u, "")}/${name}/upi-qr.png`;
    } catch (e) {
      o.log?.(`The UPI QR picture could not be written (${(e as Error).message}); the customer gets the link as text.`);
      return null;
    }
  };
}

/** In memory, for the tests and the hand check: `files` maps each address to the PNG bytes behind it. */
export function memoryQrImages(): { make: QrImageMaker; files: Map<string, Buffer> } {
  const files = new Map<string, Buffer>();
  let n = 0;
  return { files, make: async (text) => { const link = `https://qr.stand-in/${++n}/upi-qr.png`; files.set(link, textQrPng(text)); return link; } };
}
