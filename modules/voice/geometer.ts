// Geometer's own speech service as the DEFAULT speech provider (owner's direction, 12 Nov 2026: open-source models in one container Geometer runs, so partners do not need an
// account with anyone). This file is only the client for its two-route HTTP contract; which models sit behind it is the service's business (a separate research job chooses them).
// The contract, written here so the service and this client are built to the same page:
//   POST /v1/transcribe   multipart/form-data, one part `file` (the voice note as it came: Ogg Opus, AMR, MP3 ...)
//                         -> 200 JSON { "text": "...", "language": "hi" | "en" | "ml" | "kn" | <another code>, "confidence": 0..1 (optional) }
//   POST /v1/speak        JSON { "text": "...", "language": "hi" | "en" | "ml" | "kn" }
//                         -> 200 body: Ogg Opus, mono, content-type audio/ogg (so the reply is a real voice-note bubble with no conversion)
// The base URL is the speech Guard (bundle/generate/speech.ts), which on the server's private network needs no key, and with a shared token otherwise (sent by Guard, never by this
// code). Its cost to the shop is zero rupees per call by default: Geometer's own server cost is covered elsewhere; the minutes are still recorded on every line.
import { ApiError } from "../core/faults.ts";
import { isObject, num, str } from "../core/http.ts";
import { LANGUAGES } from "../language/languages.ts";
import type { Language } from "../language/languages.ts";
import type { Audio, SpeechProvider, Spoken, Transcript } from "./speech.ts";
import { createWire } from "./wire.ts";
import type { Wire } from "./wire.ts";

export const GEOMETER_SPEECH_ROUTES = { listen: "/v1/transcribe", speak: "/v1/speak" } as const;
/** Where the service listens on a server's private network (a container named geometer-speech); the speech Guard's upstream. */
export const GEOMETER_SPEECH_UPSTREAM = "geometer-speech:8080";

export interface GeometerSpeechConfig { baseUrl: string; agentToken?: string; timeoutMs?: number; /** For tests. */ wire?: Wire }

export function createGeometerSpeech(config: GeometerSpeechConfig): SpeechProvider {
  // generous: a CPU model takes longer than a hosted API, and the Guard's own limit is what ends a call that hangs
  const wire = config.wire ?? createWire(config.baseUrl, "Geometer speech", config.timeoutMs ?? 20_000, config.agentToken);
  return {
    name: "geometer", sttModel: "geometer-speech", ttsModel: "geometer-speech", maxCharacters: 1_000, speaks: LANGUAGES,

    async transcribe(audio: Audio, shopLanguages): Promise<Transcript> {
      const form = new FormData();
      form.set("file", new Blob([audio.bytes as BlobPart], { type: audio.mime }), "voice-note");
      const reply = await wire.request("POST", GEOMETER_SPEECH_ROUTES.listen, { form });
      if (reply.status < 200 || reply.status >= 300 || !isObject(reply.json)) throw new ApiError(reply.status, `The speech service answered ${reply.status} to a voice note.`);
      const heard = str(reply.json.language);
      const language = (LANGUAGES as readonly string[]).includes(heard ?? "") ? (heard as Language) : undefined;
      const confidence = num(reply.json.confidence);
      return {
        text: (str(reply.json.text) ?? "").trim(),
        language: language && shopLanguages.includes(language) ? language : null,
        confidence: confidence !== undefined && confidence >= 0 && confidence <= 1 ? confidence : null,
      };
    },

    async synthesize(text: string, language: Language): Promise<Spoken> {
      const reply = await wire.request("POST", GEOMETER_SPEECH_ROUTES.speak, { json: { text, language } });
      if (reply.status < 200 || reply.status >= 300 || reply.bytes.length === 0 || !/ogg/iu.test(reply.contentType)) throw new ApiError(reply.status, `The speech service gave no Ogg Opus audio for the reply (${reply.status}).`);
      return { audio: { bytes: reply.bytes, mime: "audio/ogg" }, characters: text.length, opus: true };
    },
  };
}
