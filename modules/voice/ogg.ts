// How long a voice note is, read from the audio itself. Neither Meta's webhook nor Sarvam's answer gives a length, and the length is needed twice: Sarvam's
// plain endpoint takes only short audio, and the cost is counted per second. A WhatsApp voice note is Ogg Opus; the last Ogg page's "granule position" is the number
// of samples at 48 kHz (RFC 7845), so the length is that over 48,000 less the pre-skip in the header. Any other kind of file (an mp3 someone forwarded) has no length here:
// null, and the caller asks the customer to type rather than send audio it cannot price.
const OGG_MAGIC = [0x4f, 0x67, 0x67, 0x53]; // "OggS"

function isPageAt(b: Uint8Array, i: number): boolean {
  return i + 27 <= b.length && OGG_MAGIC.every((m, k) => b[i + k] === m);
}

/** Seconds of an Ogg Opus file, or null when it is not one we can read. Reads only; changes nothing. */
export function oggOpusSeconds(bytes: Uint8Array): number | null {
  if (!isPageAt(bytes, 0)) return null;
  // The first packet must be the Opus header "OpusHead" (page header 27 bytes + segment table); its pre-skip is two bytes at offset 10 of that packet.
  const segments = bytes[26];
  const head = 27 + segments;
  const tag = String.fromCharCode(...bytes.slice(head, head + 8));
  if (tag !== "OpusHead" || head + 12 > bytes.length) return null;
  const preSkip = bytes[head + 10] | (bytes[head + 11] << 8);
  // The last page: search backwards for "OggS" so a file that ends mid-page still gives its last whole page.
  let last = -1;
  for (let i = bytes.length - 27; i >= 0; i--) if (isPageAt(bytes, i)) { last = i; break; }
  if (last < 0) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset + last + 6, 8);
  const granule = view.getBigUint64(0, true);
  if (granule === 0xffffffffffffffffn || granule === 0n) return null; // -1 means "no packet finishes on this page"
  const samples = Number(granule) - preSkip;
  return samples > 0 ? samples / 48_000 : null;
}
