// Stand-ins for the tests and the hand check (no account, no network): a speech provider that answers from a script, and a pair of wires that behave like Meta's
// media routes. The Ogg Opus builder makes a file whose length `oggOpusSeconds` reads, so the length logic is tested on real bytes; the WebM Opus builder makes one
// laid out as the browser's MediaRecorder writes it (unknown sizes, no Duration), which `webmOpusSeconds` reads.
import type { Audio, SpeechProvider, Transcript } from "./speech.ts";
import type { Language } from "../language/languages.ts";
import type { Wire, WireReply } from "./wire.ts";

/** A minimal valid-looking Ogg Opus file of `seconds` seconds: an OpusHead page (pre-skip 312) and a last page whose granule position is the sample count. */
export function fakeVoiceNote(seconds: number): Uint8Array {
  // One Ogg page: "OggS", version 0, the header type, the 8-byte granule position, serial, sequence, checksum (unchecked by the reader), one segment, the payload.
  const page = (header: number, granule: bigint, payload: Uint8Array): number[] => {
    const h = new Uint8Array(28);
    h.set([0x4f, 0x67, 0x67, 0x53, 0, header]);
    new DataView(h.buffer).setBigUint64(6, granule, true);
    h[26] = 1; h[27] = payload.length;
    return [...h, ...payload];
  };
  const head = new Uint8Array([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64, 1, 1, 312 & 255, 312 >> 8, 0x80, 0xbb, 0, 0, 0, 0, 0]);
  const last = page(4, BigInt(Math.round(seconds * 48_000)) + 312n, new Uint8Array([1, 2, 3]));
  return new Uint8Array([...page(2, 0n, head), ...last]);
}

/**
 * A WebM Opus file of `seconds` seconds, laid out as Chrome's MediaRecorder writes a recording (item 11i: the owner's talk box on Android): the EBML header
 * (DocType webm), a Segment and Clusters of unknown size, Info with the timecode scale and no Duration, one A_OPUS track, a Cluster every 5 seconds and one
 * SimpleBlock per 20 ms Opus packet (TOC 0xf8: CELT, 20 ms, one frame). The audio bytes are filler: only the length is read from it.
 */
export function fakeWebmVoiceNote(seconds: number): Uint8Array {
  const size = (n: number | null): number[] => (n === null ? [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff] : [0x01, 0, 0, 0, (n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
  const el = (id: number[], data: number[]): number[] => [...id, ...size(data.length), ...data];
  const text = (t: string): number[] => [...t].map((c) => c.charCodeAt(0));
  const out: number[] = [...el([0x1a, 0x45, 0xdf, 0xa3], el([0x42, 0x82], text("webm")))];
  out.push(0x18, 0x53, 0x80, 0x67, ...size(null)); // Segment, size unknown
  out.push(...el([0x15, 0x49, 0xa9, 0x66], el([0x2a, 0xd7, 0xb1], [0x0f, 0x42, 0x40]))); // Info: TimecodeScale 1 ms
  out.push(...el([0x16, 0x54, 0xae, 0x6b], el([0xae], [...el([0xd7], [1]), ...el([0x86], text("A_OPUS"))]))); // Tracks: track 1, Opus
  const packets = Math.round(seconds * 50);
  for (let i = 0; i < packets; i++) {
    const ms = i * 20;
    if (ms % 5000 === 0) out.push(0x1f, 0x43, 0xb6, 0x75, ...size(null), ...el([0xe7], [(ms >>> 8) & 255, ms & 255])); // a Cluster, size unknown, and its Timecode
    const rel = ms % 5000;
    out.push(...el([0xa3], [0x81, (rel >>> 8) & 255, rel & 255, 0x80, 0xf8, 1, 2, 3]));
  }
  return new Uint8Array(out);
}

export interface ScriptedSpeech extends SpeechProvider {
  /** Calls made, in order, with what each was given: the test's independent witness that nothing was asked when it should not be. */
  calls: { kind: "transcribe"; detail: string }[];
  /** What the next transcribe answers (a function so a test can fail it). */
  nextTranscript: Transcript | Error;
}

export function scriptedSpeech(o: { transcript?: Transcript } = {}): ScriptedSpeech {
  const s: ScriptedSpeech = {
    name: "stand-in", sttModel: "stand-in-listen",
    calls: [], nextTranscript: o.transcript ?? { text: "kal subah haircut book karna hai", language: "hi", confidence: 0.93 },
    async transcribe(audio: Audio): Promise<Transcript> {
      s.calls.push({ kind: "transcribe", detail: `${audio.mime} ${audio.bytes.length}` });
      if (s.nextTranscript instanceof Error) throw s.nextTranscript;
      return s.nextTranscript;
    },
  };
  return s;
}

/** A wire that answers from a table of path -> reply, and remembers every request (so a test can see exactly what was asked, and what was not). */
export function scriptedWire(answers: Record<string, Partial<WireReply> & { json?: unknown }>): Wire & { requests: { method: string; path: string; query?: Record<string, unknown> }[] } {
  const requests: { method: string; path: string; query?: Record<string, unknown> }[] = [];
  return {
    requests,
    async request(method, path, options = {}) {
      requests.push({ method, path, ...(options.query ? { query: options.query } : {}) });
      const a = answers[path];
      if (!a) return { status: 404, contentType: "application/json", bytes: new Uint8Array(), json: { error: "not found" } };
      return { status: a.status ?? 200, contentType: a.contentType ?? "application/octet-stream", bytes: a.bytes ?? new Uint8Array(), ...(a.json !== undefined ? { json: a.json } : {}) };
    },
  };
}
