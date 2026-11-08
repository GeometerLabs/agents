// The link a signed paper carries to geometer.dev's check page, and the QR code of it. The contract is the website's (public-web docs/Deferred.md, P22):
//   https://geometer.dev/verify/#<digest or code>[&key=key:<64 hex>]
// Everything sits after the "#", which a browser never sends to a server, so nothing about a paper reaches Geometer. The full digest is preferred because it names
// exactly one file; the 8-character code is 40 bits, so it finds a paper but does not name one for certain.
//
// The key part is left out of every link this repository prints. A key named in the link is shown on the page as "from the link", and a paper cannot vouch for
// its own signer: the key id on the paper is the one in the file, which anyone who changed the paper and signed it again would also have changed. A key the reader got
// from the person they trust (the partner, Geometer's team) is the check, so the paper says where to get one rather than carrying one. `verifyLink` takes a `key`
// only for a caller that holds a key the reader has already been given another way.
import { qrSvg } from "../qr/svg.ts";
import { encodeQr } from "../qr/qr.ts";
import type { Envelope } from "./sign.ts";

export const VERIFY_URL = "https://geometer.dev/verify/";

/** `https://geometer.dev/verify/#sha256:<64 hex>`, with `&key=key:<64 hex>` after it when the caller gives a key id. */
export function verifyLink(envelope: Pick<Envelope, "digest">, key?: string): string {
  if (!/^sha256:[0-9a-f]{64}$/.test(envelope.digest)) throw new Error("A link needs the full digest: sha256: and 64 hex digits.");
  if (key !== undefined && !/^key:[0-9a-f]{64}$/.test(key)) throw new Error("A key in a link is key: and 64 hex digits.");
  return `${VERIFY_URL}#${envelope.digest}${key ? `&key=${key}` : ""}`;
}

/** The short form for a line of text, without the host: `/verify/#7K2M-9QXD` (the code the paper prints). */
export const verifyCodePath = (envelope: Pick<Envelope, "code">): string => `/verify/#${envelope.code}`;

/** The inline SVG of the QR code of `verifyLink`. */
export function verifyQrSvg(envelope: Pick<Envelope, "digest">, label: string, key?: string): string {
  return qrSvg(encodeQr(verifyLink(envelope, key)), { label });
}
