// How long a WebM Opus recording is, read from the audio itself (plan item 11i: the owner's talk box records WebM on Android's Chrome, which cannot record Ogg).
// The length is needed for the same two things as a WhatsApp voice note's (ogg.ts): the 30-second limit and the cost per second. Used by voice.ts, which tries
// Ogg first and this second, by the file's own first bytes, never by the type the browser named.
//
// A recording made by the browser's MediaRecorder is written while it is made, so it carries no total length: its Segment and its Clusters have "unknown" sizes,
// and its Info has no Duration. So the length is counted the way a player would: each Cluster's Timecode plus each Opus block's own offset gives when the block
// starts, and the last block's start plus its own length (read from the Opus packet's first byte, RFC 6716 section 3.1) is when the audio ends. A file that has a
// Duration and no blocks (not what a recorder writes) is read from the Duration. Anything else is not one we can price: null, never a throw. The walk only reads,
// visits each byte at most once and stops at the end of the bytes it was given (at most the page's 256 KB).

const ID = {
  EBML: 0x1a45dfa3, DOCTYPE: 0x4282, SEGMENT: 0x18538067, INFO: 0x1549a966, TIMECODE_SCALE: 0x2ad7b1, DURATION: 0x4489, TRACKS: 0x1654ae6b, TRACK_ENTRY: 0xae,
  TRACK_NUMBER: 0xd7, CODEC_ID: 0x86, CLUSTER: 0x1f43b675, TIMECODE: 0xe7, SIMPLE_BLOCK: 0xa3, BLOCK_GROUP: 0xa0, BLOCK: 0xa1,
} as const;
/** The containers the walk steps into (their children follow at once, whether or not their size is known); every other element is stepped over. */
const MASTERS = new Set<number>([ID.SEGMENT, ID.INFO, ID.TRACKS, ID.TRACK_ENTRY, ID.CLUSTER, ID.BLOCK_GROUP]);

/** An element's ID (its marker bits kept, as the specification writes IDs) and its length in bytes, or undefined past the end or for a malformed first byte. */
function readId(b: Uint8Array, at: number): { id: number; len: number } | undefined {
  const first = b[at];
  if (first === undefined || first === 0) return undefined;
  const len = Math.clz32(first) - 23; // 1 for 1xxxxxxx ... 4 for 0001xxxx
  if (len > 4 || at + len > b.length) return undefined;
  let id = 0;
  for (let i = 0; i < len; i++) id = id * 256 + b[at + i];
  return { id, len };
}

/** An element's data size (null when it says "unknown") and the size field's own length. */
function readSize(b: Uint8Array, at: number): { size: number | null; len: number } | undefined {
  const first = b[at];
  if (first === undefined || first === 0) return undefined;
  const len = Math.clz32(first) - 23;
  if (len > 8 || at + len > b.length) return undefined;
  let value = first & (0xff >> len);
  let allOnes = value === 0xff >> len;
  for (let i = 1; i < len; i++) { value = value * 256 + b[at + i]; if (b[at + i] !== 0xff) allOnes = false; }
  return { size: allOnes ? null : value, len };
}

const uint = (b: Uint8Array, at: number, n: number): number => { let v = 0; for (let i = 0; i < n; i++) v = v * 256 + b[at + i]; return v; };

/** The length of one Opus packet in milliseconds, from its first byte (the TOC: the frame size by configuration, and how many frames). Undefined if unreadable. */
function opusPacketMs(b: Uint8Array, at: number, end: number): number | undefined {
  if (at >= end) return undefined;
  const toc = b[at];
  const config = toc >> 3;
  const frameMs = config < 12 ? [10, 20, 40, 60][config % 4] : config < 16 ? [10, 20][config % 2] : [2.5, 5, 10, 20][config % 4];
  const code = toc & 3;
  const frames = code === 0 ? 1 : code < 3 ? 2 : at + 1 < end ? b[at + 1] & 0x3f : 0;
  return frames > 0 ? frameMs * frames : undefined;
}

/** Seconds of a WebM (or Matroska) file with an Opus track, or null when it is not one we can read. Reads only; changes nothing. */
export function webmOpusSeconds(bytes: Uint8Array): number | null {
  const head = readId(bytes, 0);
  if (!head || head.id !== ID.EBML) return null;
  const headSize = readSize(bytes, head.len);
  if (!headSize || headSize.size === null) return null;
  const headEnd = head.len + headSize.len + headSize.size;
  // the header's DocType must say webm or matroska
  let docType = "";
  for (let at = head.len + headSize.len; at < headEnd;) {
    const id = readId(bytes, at); if (!id) return null;
    const size = readSize(bytes, at + id.len); if (!size || size.size === null) return null;
    const data = at + id.len + size.len;
    if (id.id === ID.DOCTYPE) docType = String.fromCharCode(...bytes.subarray(data, Math.min(data + size.size, bytes.length)));
    at = data + size.size;
  }
  if (docType !== "webm" && docType !== "matroska") return null;

  let scaleNs = 1_000_000; // TimecodeScale's default: timecodes in milliseconds
  let durationTicks: number | undefined;
  const codecs = new Map<number, string>();
  let entry: { number?: number; codec?: string } | undefined;
  let clusterTicks: number | undefined;
  let lastStart = -1; // in ticks
  let lastMs = 0;
  let blocks = 0;
  const closeEntry = () => { if (entry?.number !== undefined && entry.codec !== undefined) codecs.set(entry.number, entry.codec); entry = undefined; };

  for (let at = headEnd; at < bytes.length;) {
    const id = readId(bytes, at);
    if (!id) break;
    const size = readSize(bytes, at + id.len);
    if (!size) break;
    const data = at + id.len + size.len;
    if (MASTERS.has(id.id)) {
      if (id.id === ID.TRACK_ENTRY) { closeEntry(); entry = {}; }
      if (id.id === ID.CLUSTER) { closeEntry(); clusterTicks = undefined; }
      at = data; // step in: the children follow
      continue;
    }
    if (size.size === null) break; // only containers may have an unknown size
    const end = data + size.size;
    if (id.id === ID.TIMECODE_SCALE && size.size <= 8 && end <= bytes.length) scaleNs = uint(bytes, data, size.size) || scaleNs;
    else if (id.id === ID.DURATION && end <= bytes.length && (size.size === 4 || size.size === 8)) {
      const view = new DataView(bytes.buffer, bytes.byteOffset + data, size.size);
      durationTicks = size.size === 4 ? view.getFloat32(0) : view.getFloat64(0);
    } else if (id.id === ID.TRACK_NUMBER && entry && size.size <= 8 && end <= bytes.length) entry.number = uint(bytes, data, size.size);
    else if (id.id === ID.CODEC_ID && entry && end <= bytes.length) entry.codec = String.fromCharCode(...bytes.subarray(data, end));
    else if (id.id === ID.TIMECODE && size.size <= 8 && end <= bytes.length) { closeEntry(); clusterTicks = uint(bytes, data, size.size); }
    else if ((id.id === ID.SIMPLE_BLOCK || id.id === ID.BLOCK) && clusterTicks !== undefined) {
      closeEntry();
      // a block: its track (a size-like number), its offset from the cluster's timecode (signed 16 bits), flags, then the frame (no lacing from a recorder)
      const track = readSize(bytes, data);
      const head = track ? data + track.len : -1;
      if (track && track.size !== null && head + 3 <= Math.min(end, bytes.length) && (codecs.size === 0 || codecs.get(track.size) === "A_OPUS")) {
        const rel = (bytes[head] << 24 >> 16) | bytes[head + 1];
        const laced = (bytes[head + 2] & 0x06) !== 0;
        const start = clusterTicks + rel;
        if (start >= lastStart) {
          lastStart = start;
          lastMs = laced ? 20 : opusPacketMs(bytes, head + 3, Math.min(end, bytes.length)) ?? 20;
        }
        blocks += 1;
      }
    }
    at = end;
  }
  closeEntry();
  // an Opus track must be there (when the tracks were read at all)
  if (codecs.size > 0 && ![...codecs.values()].includes("A_OPUS")) return null;
  if (blocks > 0 && lastStart >= 0) {
    const seconds = (lastStart * scaleNs) / 1e9 + lastMs / 1000;
    return seconds > 0 && Number.isFinite(seconds) ? seconds : null;
  }
  if (durationTicks !== undefined && durationTicks > 0 && Number.isFinite(durationTicks)) return (durationTicks * scaleNs) / 1e9;
  return null;
}
