// The signed summary a shop paper carries in its link (plan item 17b, decision 40), so a shop owner can check a paper by scanning its QR or tapping the link in
// WhatsApp, with no file: the page on geometer.dev reads the summary from the address, checks its signature against Geometer's public list of signers, and shows
// whether the paper is genuine, who issued it, the period and the figures to compare with the printed page. Who uses this file: the templates' report and
// certificate code (through summary-sign.ts, which signs), the reference check in summary-sign.ts, and, in part 2, the website's /verify page.
//
// THIS FILE HAS NO node: IMPORTS, on purpose (as modules/qr/svg.ts), so the website can use the same encoder and parser. Signing and checking signatures are
// in summary-sign.ts (node:crypto); the page does them with WebCrypto.
//
// THE LINK
//   https://geometer.dev/verify/#s1.<payload>.<signature>
// `s1` is the version of this format. <payload> is the summary's bytes (below) and <signature> the 64-byte Ed25519 signature, each in base64url without padding.
// Everything is after the "#", which a browser never sends to a server, so nothing about the paper reaches Geometer. The older forms
// (#sha256:<digest>, #<code>, verify-link.ts) still work and are still printed on a paper that is not signed.
//
// WHAT IS SIGNED: the UTF-8 bytes of "geo-summary/1\n" followed by the payload bytes exactly as they sit in the link. The prefix keeps a summary's signature from
// ever being read as the signature of a document ("geo-document/1\n", sign.ts) or of anything else the same key signs. A checker verifies the bytes it decoded
// from the link and only then reads them; it never re-encodes before checking.
//
// THE PAYLOAD, in this order, nothing before or after:
//   layout    1 byte    which paper and which figures, from LAYOUTS (1 to 255; a number is never reused for something else)
//   source    1 byte    what the figures were counted from: 0 live, 1 test mode, 2 stand-in services (so a sample can never read as real money)
//   flags     1 byte    bit 0: the money figures are what the owner MARKED received or given back (a UPI shop, `paidBy: "owner-marked"`), not what a payment
//                       service confirmed. Every other bit is 0.
//   period    text      "2026-11" (a month), "2026-11-03" (a day: a go-live certificate's date) or "2026-11-01..2026-11-15" (any other range)
//   pathway   text      the agent's name as the paper has it ("bookings", "fees", "orders", or a builder's own agent), up to 32 bytes
//   shop      text      the shop's name as the paper prints it, up to 64 bytes (a longer name is cut at a whole character and ends with "…")
//   by        text      who set the shop up, as the paper says it ("Divya, Sri Sai Digital"), up to 64 bytes; empty when the paper names no one. On Geometer's
//                       partner server this is the only place the page names the partner, so it gets the same room as the shop's name
//   figures   1 byte count (at most 16), then each figure as an unsigned LEB128 number in its fewest bytes; money is in paise
//   key hint  8 bytes   the first 8 bytes of the signer's key id (the sha256 of its raw public key, sign.ts): which entry of the public list to try
//   digest    32 bytes  the sha256 of the full paper (its `digest`), so the file, when someone has it, can be matched to this summary
// A text is one byte, then the text: bit 7 of that byte says the text is in UTF-16LE (used only when it is strictly shorter than UTF-8, as Hindi, Malayalam and
// Kannada are), bits 0 to 6 give its length in bytes. It must decode cleanly and sit on one line, with no control or direction-changing characters.
//
// ONE SPELLING ONLY. A parser refuses anything the encoder would not write byte for byte: base64url that does not re-encode to the same text, a number written
// in more bytes than it needs, an unknown flag, a figure count that does not match a known layout, trailing bytes. So two different links never carry the same
// summary, and a changed character is never silently read as the same thing.
//
// WHAT IT SHOWS AND WHAT IT DOES NOT: a summary whose signature checks under a key on Geometer's list was signed by whoever holds that key, and has not changed
// since. It does not show that the figures are true (that needs the record and the payment, calendar and WhatsApp services' own records), and the key hint is
// only a hint: what counts is that the signature verifies under the public key the list gives for it.

/**
 * A real summary link, for the example values Meta's template review and the native review sheets show: the first test vector (modules/test/summary-vectors.json,
 * signed with a throwaway key whose private half was never written down), Glow Salon's sample month. SAMPLE_DIGEST is the digest that vector carries.
 */
export const SAMPLE_SUMMARY_LINK = "https://geometer.dev/verify/#s1.AQAABzIwMjctMDIIYm9va2luZ3MKR2xvdyBTYWxvbhZEaXZ5YSwgU3JpIFNhaSBEaWdpdGFsCCaAtmvAuAIFAwIBAQAD7HYMdtfjVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVU.vv5O7CGK4abVQwEqt804NE5labc4lCf_1zxL3gxqPdd0PpWcfm9nMIYTIxLlfw1xZHrM0O_po3wKDN00iDnaCg";
export const SAMPLE_DIGEST = `sha256:${"5".repeat(64)}`;

/** The format's version, the start of the fragment. */
export const SUMMARY_VERSION = "s1";
/** What the signature covers, before the payload: the domain of a summary's signature. */
export const SUMMARY_DOMAIN = "geo-summary/1\n";
export const VERIFY_PAGE = "https://geometer.dev/verify/";
/** Bytes of the key id carried as a hint, and the most bytes in each text. */
export const KEY_HINT_BYTES = 8;
export const MAX_SHOP_BYTES = 64;
export const MAX_BY_BYTES = 64;
export const MAX_PATHWAY_BYTES = 32;
export const MAX_FIGURES = 16;
const DIGEST_BYTES = 32;
export const SIGNATURE_BYTES = 64;
const ELLIPSIS = "\u2026";

export type SummarySource = "live" | "test-mode" | "stand-in";
/** The byte for each source is its place here. Never reorder: a link already printed would read differently. */
export const SUMMARY_SOURCES: readonly SummarySource[] = ["live", "test-mode", "stand-in"];
const OWNER_MARKED_FLAG = 0b1;

export type PaperKind = "monthly-report" | "monthly-certificate" | "go-live-certificate";
/** A count, or an amount of money in paise. */
export type FigureKind = "count" | "money";
export interface Figure { id: string; kind: FigureKind }

/**
 * Which figures a summary carries, in which order, for each paper. The page holds the words for each figure id in its four languages. A new layout gets the next
 * number; an existing one is never changed, so a printed paper keeps reading the same. The figures are the ones the printed page and the owner's WhatsApp message
 * lead with (the cards and the message's lines), so the reader can hold the page and the screen side by side.
 */
export interface Layout { id: number; paper: PaperKind; template: string; figures: readonly Figure[] }

const count = (id: string): Figure => ({ id, kind: "count" });
const money = (id: string): Figure => ({ id, kind: "money" });

export const LAYOUTS: readonly Layout[] = [
  // Bookings' monthly report: its cards and the WhatsApp message's lines (report/whatsapp.ts).
  { id: 1, paper: "monthly-report", template: "bookings", figures: [count("bookingsMade"), money("deposits"), money("givenBack"), count("stoppedByLimits"), count("asked"), count("approved"), count("saidNo"), count("notConfirmed")] },
  // Bookings' monthly record certificate: what it says was counted, in the order it lists them (report/certificate.ts countedPairs).
  { id: 2, paper: "monthly-certificate", template: "bookings", figures: [count("bookingsMade"), count("cancelled"), money("deposits"), money("givenBack"), count("asked"), count("approved"), count("saidNo"), count("stoppedByLimits"), count("notConfirmed")] },
  // Every template's go-live certificate: held N of M situations, K failed, J things not tested.
  { id: 3, paper: "go-live-certificate", template: "any", figures: [count("held"), count("total"), count("failed"), count("notTested")] },
  // Fees' monthly report: its cards and its message's lines.
  { id: 4, paper: "monthly-report", template: "fees", figures: [money("collected"), money("givenBack"), money("stillToCollect"), count("remindersSent"), money("takenOff"), count("asked"), count("approved"), count("saidNo"), count("stoppedByLimits")] },
  // Orders' monthly report: its cards and its message's lines.
  { id: 5, paper: "monthly-report", template: "orders", figures: [money("collected"), money("givenBack"), money("stillToCollect"), count("ordersTaken"), count("cancelled"), count("asked"), count("approved"), count("saidNo"), count("stoppedByLimits")] },
];

export const layoutOf = (id: number): Layout | undefined => LAYOUTS.find((l) => l.id === id);

/** A summary, as the encoder takes it and the parser gives it back. */
export interface PaperSummary {
  layout: number;
  source: SummarySource;
  /** The money figures are what the owner marked (a UPI shop), not what a payment service confirmed. */
  ownerMarked: boolean;
  period: string;
  pathway: string;
  shop: string;
  /** Who set the shop up, as the paper says it; "" when it names no one. */
  by: string;
  figures: number[];
  /** The first 8 bytes of the signer's key id, as 16 hex digits. */
  keyHint: string;
  /** The full paper's digest: "sha256:" and 64 hex digits. */
  digest: string;
}

export class SummaryError extends Error {}

// ---- text ------------------------------------------------------------------------------------------------------------------------------------------

const utf8 = new TextEncoder();
const strictUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const strictUtf16 = new TextDecoder("utf-16le", { fatal: true, ignoreBOM: true });
/** Bit 7 of a text's length byte: the text is in UTF-16LE. Bits 0 to 6 are its length in bytes (no text is longer than 64). */
const WIDE = 0x80;

/** UTF-16LE, two bytes per code unit, low byte first. */
function utf16(s: string): Uint8Array {
  const out = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); out[2 * i] = c & 255; out[2 * i + 1] = c >> 8; }
  return out;
}

/**
 * The bytes a text is carried in: UTF-16LE when that is strictly shorter than UTF-8, else UTF-8. Hindi, Malayalam and Kannada letters take three bytes each in UTF-8
 * and two in UTF-16, so a shop's name in its own script costs a third less of the QR code; a name in Latin letters stays UTF-8. The rule leaves one spelling per text.
 */
export function textBytes(s: string): { wide: boolean; bytes: Uint8Array } {
  const narrow = utf8.encode(s);
  const wide = utf16(s);
  return wide.length < narrow.length ? { wide: true, bytes: wide } : { wide: false, bytes: narrow };
}
/** How many bytes a text costs in a summary. */
export const carriedLength = (s: string): number => textBytes(s).bytes.length;
/** A lone half of a surrogate pair cannot be written as UTF-8 and would read back differently: a summary never carries one. */
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u;
/** Line breaks, tabs and other control characters, the Unicode line and paragraph separators, the characters that change the direction text is drawn in, and the invisible zero-width space and byte-order mark. */
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u200b\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/u; // ZWJ and ZWNJ (U+200C, U+200D) stay: Malayalam and Kannada need them
const PERIOD = /^(\d{4})-(0[1-9]|1[0-2])(?:-(0[1-9]|[12]\d|3[01]))?(?:\.\.(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01]))?$/u;

/** Is this a period the format can carry: a month, a day, or a range of two days (and a range only between two days)? */
export function isPeriod(period: string): boolean {
  const m = PERIOD.exec(period);
  if (!m) return false;
  if (m[4] !== undefined && m[3] === undefined) return false; // "2026-11..2026-11-15": a range runs from a day
  if (m[4] !== undefined && `${m[1]}-${m[2]}-${m[3]}` > `${m[4]}-${m[5]}-${m[6]}`) return false;
  return true;
}

const graphemes = (s: string): string[] => (typeof Intl !== "undefined" && "Segmenter" in Intl
  ? [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s)].map((g) => g.segment)
  : [...s]);

/**
 * Text as a summary carries it: on one line (every run of spaces, tabs and line breaks one space), without control or direction-changing characters, and costing at
 * most `maxBytes` (carriedLength). A longer text is cut at a whole character (a letter with its marks, never half of one) and ends with "…", so the reader sees it was cut.
 */
export function fitText(text: string, maxBytes: number): string {
  const plain = text.replace(/\s+/gu, " ").replace(new RegExp(UNSAFE.source, "gu"), "").replace(new RegExp(LONE_SURROGATE.source, "gu"), "").trim();
  if (carriedLength(plain) <= maxBytes) return plain;
  let out = "";
  for (const g of graphemes(plain)) {
    if (carriedLength(out + g + ELLIPSIS) > maxBytes) break;
    out += g;
  }
  return `${out.trimEnd()}${ELLIPSIS}`;
}

// ---- base64url, one spelling only ---------------------------------------------------------------------------------------------------------------------

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function toBase64url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const chars = Math.min(4, Math.ceil(((bytes.length - i) * 8) / 6));
    for (let c = 0; c < chars; c++) out += B64[(n >> (18 - 6 * c)) & 63];
  }
  return out;
}

/** base64url without padding, refused unless it is exactly what toBase64url writes for the bytes it gives (no stray bits in the last character, no padding). */
export function fromBase64url(text: string): Uint8Array {
  if (text.length % 4 === 1) throw new SummaryError("The link is cut short or has an extra character.");
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of text) {
    const v = B64.indexOf(ch);
    if (v < 0) throw new SummaryError("The link has a character that cannot be in it.");
    value = (value << 6) | v;
    bits += 6;
    if (bits >= 8) { bits -= 8; out.push((value >> bits) & 255); }
  }
  const bytes = Uint8Array.from(out);
  if (toBase64url(bytes) !== text) throw new SummaryError("The link has been changed: one of its characters is not as it was written.");
  return bytes;
}

const hexOf = (bytes: Uint8Array): string => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
function bytesOfHex(hex: string, length: number, what: string): Uint8Array {
  if (!new RegExp(`^[0-9a-f]{${length * 2}}$`, "u").test(hex)) throw new SummaryError(`${what} must be ${length * 2} lower-case hex digits.`);
  return Uint8Array.from(hex.match(/../gu)!.map((h) => parseInt(h, 16)));
}

// ---- the payload ---------------------------------------------------------------------------------------------------------------------------------------

/** The bytes of a summary. Throws on anything the format cannot carry: it never cuts or changes what it is given (summaryOf in summary-sign.ts fits the texts first). */
export function encodeSummary(s: PaperSummary): Uint8Array {
  const out: number[] = [];
  const text = (value: string, max: number, what: string, allowEmpty: boolean) => {
    if (UNSAFE.test(value) || LONE_SURROGATE.test(value) || value !== value.trim() || /\s{2,}/u.test(value)) throw new SummaryError(`${what} must be one line of text with no control characters.`);
    const { wide, bytes } = textBytes(value);
    if (bytes.length > max || (!allowEmpty && bytes.length === 0)) throw new SummaryError(`${what} must cost ${allowEmpty ? "0" : "1"} to ${max} bytes.`);
    out.push((wide ? WIDE : 0) | bytes.length, ...bytes);
  };
  if (!Number.isInteger(s.layout) || s.layout < 1 || s.layout > 255) throw new SummaryError("The layout is a number from 1 to 255.");
  const layout = layoutOf(s.layout);
  const source = SUMMARY_SOURCES.indexOf(s.source);
  if (source < 0) throw new SummaryError(`The source is one of ${SUMMARY_SOURCES.join(", ")}.`);
  if (!isPeriod(s.period)) throw new SummaryError(`"${s.period}" is not a period: write 2026-11, 2026-11-03 or 2026-11-01..2026-11-15.`);
  if (s.figures.length > MAX_FIGURES) throw new SummaryError(`A summary carries at most ${MAX_FIGURES} figures.`);
  if (layout && s.figures.length !== layout.figures.length) throw new SummaryError(`Layout ${s.layout} carries ${layout.figures.length} figures, not ${s.figures.length}.`);
  for (const n of s.figures) if (!Number.isSafeInteger(n) || n < 0) throw new SummaryError(`A figure is a whole number of 0 or more (got ${n}).`);
  out.push(s.layout, source, s.ownerMarked ? OWNER_MARKED_FLAG : 0);
  out.push(s.period.length, ...utf8.encode(s.period)); // ASCII digits and dashes: never shorter in UTF-16
  text(s.pathway, MAX_PATHWAY_BYTES, "The agent's name", false);
  text(s.shop, MAX_SHOP_BYTES, "The shop's name", false);
  text(s.by, MAX_BY_BYTES, "Who set it up", true);
  out.push(s.figures.length);
  for (let n of s.figures) {
    // unsigned LEB128: seven bits at a time, low bits first, the top bit saying another byte follows. Division, not bit shifts: a figure may pass 2^31.
    while (n >= 128) { out.push((n % 128) | 128); n = Math.floor(n / 128); }
    out.push(n);
  }
  out.push(...bytesOfHex(s.keyHint, KEY_HINT_BYTES, "The key hint"));
  const digest = /^sha256:([0-9a-f]{64})$/u.exec(s.digest)?.[1];
  if (!digest) throw new SummaryError("The digest is sha256: and 64 hex digits.");
  out.push(...bytesOfHex(digest, DIGEST_BYTES, "The digest"));
  return Uint8Array.from(out);
}

/** A summary from its bytes, refusing anything encodeSummary would not have written exactly so. The layout may be one this file does not know (a newer paper). */
export function decodeSummary(bytes: Uint8Array): PaperSummary {
  let at = 0;
  const need = (n: number) => { if (at + n > bytes.length) throw new SummaryError("The summary is cut short."); };
  const byte = (): number => { need(1); return bytes[at++]; };
  const take = (n: number): Uint8Array => { need(n); const b = bytes.slice(at, at + n); at += n; return b; };
  const text = (max: number, what: string, allowEmpty: boolean): string => {
    const head = byte();
    const wide = (head & WIDE) !== 0;
    const length = head & ~WIDE;
    if (length > max || (!allowEmpty && length === 0) || (wide && length % 2 !== 0)) throw new SummaryError(`${what} has the wrong length.`);
    const raw = take(length);
    let value: string;
    try { value = (wide ? strictUtf16 : strictUtf8).decode(raw); } catch { throw new SummaryError(`${what} is not text.`); }
    if (UNSAFE.test(value) || LONE_SURROGATE.test(value) || value !== value.trim() || /\s{2,}/u.test(value)) throw new SummaryError(`${what} has characters a summary never carries.`);
    if (textBytes(value).wide !== wide) throw new SummaryError(`${what} is written in the longer of its two encodings, which the format never does.`);
    return value;
  };

  const layout = byte();
  if (layout === 0) throw new SummaryError("The layout is 1 to 255.");
  const sourceByte = byte();
  const source = SUMMARY_SOURCES[sourceByte];
  if (source === undefined) throw new SummaryError("The source is not one this format knows.");
  const flags = byte();
  if ((flags & ~OWNER_MARKED_FLAG) !== 0) throw new SummaryError("The summary has a flag this format does not know.");
  const period = text(22, "The period", false); // "2026-11-01..2026-11-15" is the longest
  if (!isPeriod(period)) throw new SummaryError("The period is not a month, a day or a range of days.");
  const pathway = text(MAX_PATHWAY_BYTES, "The agent's name", false);
  const shop = text(MAX_SHOP_BYTES, "The shop's name", false);
  const by = text(MAX_BY_BYTES, "Who set it up", true);
  const howMany = byte();
  if (howMany > MAX_FIGURES) throw new SummaryError("The summary has too many figures.");
  const known = layoutOf(layout);
  if (known && howMany !== known.figures.length) throw new SummaryError(`Layout ${layout} carries ${known.figures.length} figures, not ${howMany}.`);
  const figures: number[] = [];
  for (let i = 0; i < howMany; i++) {
    let value = 0;
    let scale = 1;
    for (let k = 0; ; k++) {
      if (k === 8) throw new SummaryError("A figure is too large.");
      const b = byte();
      value += (b & 127) * scale;
      scale *= 128;
      if ((b & 128) === 0) {
        if (b === 0 && k > 0) throw new SummaryError("A figure is written in more bytes than it needs."); // a last byte of 0 adds nothing: not the one spelling
        break;
      }
    }
    if (!Number.isSafeInteger(value)) throw new SummaryError("A figure is too large.");
    figures.push(value);
  }
  const keyHint = hexOf(take(KEY_HINT_BYTES));
  const digest = `sha256:${hexOf(take(DIGEST_BYTES))}`;
  if (at !== bytes.length) throw new SummaryError("The summary has bytes after its end.");
  return { layout, source, ownerMarked: (flags & OWNER_MARKED_FLAG) !== 0, period, pathway, shop, by, figures, keyHint, digest };
}

/** The bytes a summary's signature covers: the domain, then the payload exactly as carried. */
export function signedBytes(payload: Uint8Array): Uint8Array {
  const domain = utf8.encode(SUMMARY_DOMAIN);
  const out = new Uint8Array(domain.length + payload.length);
  out.set(domain, 0);
  out.set(payload, domain.length);
  return out;
}

// ---- the link -------------------------------------------------------------------------------------------------------------------------------------------

/** `https://geometer.dev/verify/#s1.<payload>.<signature>` */
export function summaryLinkOf(payload: Uint8Array, signature: Uint8Array): string {
  if (signature.length !== SIGNATURE_BYTES) throw new SummaryError(`A signature is ${SIGNATURE_BYTES} bytes.`);
  return `${VERIFY_PAGE}#${SUMMARY_VERSION}.${toBase64url(payload)}.${toBase64url(signature)}`;
}

/** What a link carries, read but NOT yet checked: the signature must be verified over `signed` before anything in `summary` is shown as genuine. */
export interface ReadSummary { payload: Uint8Array; signature: Uint8Array; signed: Uint8Array; summary: PaperSummary }

/**
 * Read a summary link: the whole address, or what follows its "#" (with or without the "#"). Anything after a "&" is ignored, as the /verify contract says of
 * parts it does not know (base64url never contains "&"). Throws SummaryError, in plain words, for anything that is not exactly an s1 summary.
 */
export function readSummaryLink(link: string): ReadSummary {
  const hash = link.indexOf("#");
  const fragment = (hash >= 0 ? link.slice(hash + 1) : link).split("&")[0];
  const parts = fragment.split(".");
  if (parts[0] !== SUMMARY_VERSION) throw new SummaryError("This is not a summary link this page can read (it does not start with s1).");
  if (parts.length !== 3) throw new SummaryError("The link is cut short or has extra parts.");
  const payload = fromBase64url(parts[1]);
  const signature = fromBase64url(parts[2]);
  if (signature.length !== SIGNATURE_BYTES) throw new SummaryError("The signature in the link is not the right length.");
  return { payload, signature, signed: signedBytes(payload), summary: decodeSummary(payload) };
}

/** Is this fragment (or address) an s1 summary rather than one of the older forms (#sha256:..., #<code>)? Says nothing about whether it is genuine. */
export const isSummaryLink = (link: string): boolean => (link.includes("#") ? link.slice(link.indexOf("#") + 1) : link).startsWith(`${SUMMARY_VERSION}.`);

/** The figures of a summary with their ids and kinds, for a layout this file knows; null for one it does not (the page then shows no figures, never a guess). */
export function labelledFigures(s: PaperSummary): { id: string; kind: FigureKind; value: number }[] | null {
  const layout = layoutOf(s.layout);
  if (!layout || layout.figures.length !== s.figures.length) return null;
  return layout.figures.map((f, i) => ({ ...f, value: s.figures[i] }));
}
