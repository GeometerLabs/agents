// Geometer's own speech-to-text service as the DEFAULT speech provider (owner's direction, 12 Nov 2026: open-source models in one container Geometer runs, so partners do not need an
// account with anyone; the research picked AI4Bharat IndicConformer for Hindi, Malayalam and Kannada and Whisper for English). Listening only: the agent replies in text. This file is only the client for its two-route HTTP contract; which models sit behind it is the service's business (a separate research job chooses them).
// The contract, written here so the service and this client are built to the same page:
//   POST /stt             multipart/form-data, one part `file` (the voice note as it came: Ogg Opus, AMR, MP3 ...)
//                         -> 200 JSON { "text": "...", "language": "hi" | "en" | "ml" | "kn" | <another code>, "confidence": 0..1 (optional) }
// The base URL is the speech Guard (bundle/generate/speech.ts), which on the server's private network needs no key, and with a shared token otherwise (sent by Guard, never by this
// code). Its cost to the shop is zero rupees per call by default: Geometer's own server cost is covered elsewhere; the minutes are still recorded on every line.
import { ApiError } from "../core/faults.ts";
import { isObject, num, str } from "../core/http.ts";
import { LANGUAGES } from "../language/languages.ts";
import type { Language } from "../language/languages.ts";
import type { Audio, SpeechProvider, Transcript } from "./speech.ts";
import { createWire } from "./wire.ts";
import type { Wire } from "./wire.ts";

export const GEOMETER_SPEECH_ROUTES = { listen: "/stt" } as const;
/** Where the service listens on a server's private network (a container named geometer-speech); the speech Guard's upstream. */
export const GEOMETER_SPEECH_UPSTREAM = "geometer-speech:8080";

export interface GeometerSpeechConfig { baseUrl: string; agentToken?: string; timeoutMs?: number; /** For tests. */ wire?: Wire }

export function createGeometerSpeech(config: GeometerSpeechConfig): SpeechProvider {
  // generous: a CPU model takes longer than a hosted API, and the Guard's own limit is what ends a call that hangs
  const wire = config.wire ?? createWire(config.baseUrl, "Geometer speech", config.timeoutMs ?? 20_000, config.agentToken);
  return {
    name: "geometer", sttModel: "geometer-speech",

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
  };
}
