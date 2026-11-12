// Stand-ins for the tests and the hand check (no account, no network): a speech provider that answers from a script, and a pair of wires that behave like Meta's
// media routes. The Ogg Opus builder makes a file whose length `oggOpusSeconds` reads, so the length logic is tested on real bytes.
import type { Audio, SpeechProvider, Spoken, Transcript } from "./speech.ts";
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

export interface ScriptedSpeech extends SpeechProvider {
  /** Calls made, in order, with what each was given: the test's independent witness that nothing was asked when it should not be. */
  calls: { kind: "transcribe" | "synthesize"; detail: string }[];
  /** What the next transcribe answers (a function so a test can fail it). */
  nextTranscript: Transcript | Error;
}

export function scriptedSpeech(o: { speaks?: readonly Language[]; transcript?: Transcript } = {}): ScriptedSpeech {
  const s: ScriptedSpeech = {
    name: "stand-in", sttModel: "stand-in-listen", ttsModel: "stand-in-speak", maxCharacters: 2_500, speaks: o.speaks ?? ["hi", "en", "ml", "kn"],
    calls: [], nextTranscript: o.transcript ?? { text: "kal subah haircut book karna hai", language: "hi", confidence: 0.93 },
    async transcribe(audio: Audio): Promise<Transcript> {
      s.calls.push({ kind: "transcribe", detail: `${audio.mime} ${audio.bytes.length}` });
      if (s.nextTranscript instanceof Error) throw s.nextTranscript;
      return s.nextTranscript;
    },
    async synthesize(text: string, language: Language): Promise<Spoken> {
      s.calls.push({ kind: "synthesize", detail: `${language} ${text}` });
      return { audio: { bytes: new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3]), mime: "audio/mpeg" }, characters: text.length };
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
