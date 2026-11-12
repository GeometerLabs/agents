// Sarvam as an OPTIONAL speech-to-text provider (plan B29); Geometer's own service (geometer.ts) is the default. Listening only. Written from Sarvam's published API, read 12 Nov 2026, and not yet run against the real service (Deferred.md):
//  - listen: POST /speech-to-text, multipart `file`, `model` (saaras:v4 recommended), `language_code` ("unknown" detects it); answers { transcript, language_code,
//            language_probability }. The plain endpoint is for audio under 30 seconds. https://docs.sarvam.ai/api-reference-docs/speech-to-text/transcribe
//  - the key: Sarvam wants it in `api-subscription-key`. This file never sees it: the base URL is a Guard in front of api.sarvam.ai and the Guard adds the header
//            (bundle/generate/guards.ts speechGuardDef), as the model Guard adds the model's key.
import { ApiError } from "../core/faults.ts";
import { isObject, num, str } from "../core/http.ts";
import type { Language } from "../language/languages.ts";
import type { Audio, SpeechProvider, Transcript } from "./speech.ts";
import { createWire } from "./wire.ts";
import type { Wire } from "./wire.ts";

export const SARVAM_UPSTREAM = "api.sarvam.ai:443";
/** The route Sarvam's Guard lists (bundle/generate/guards.ts) and this adapter calls. */
export const SARVAM_ROUTES = { listen: "/speech-to-text" } as const;

/** Sarvam's BCP-47 codes for our four languages, both ways. */
export const SARVAM_CODE: Record<Language, string> = { hi: "hi-IN", en: "en-IN", ml: "ml-IN", kn: "kn-IN" };
const FROM_CODE = new Map(Object.entries(SARVAM_CODE).map(([l, c]) => [c, l as Language]));

export interface SarvamConfig {
  /** A Guard in front of api.sarvam.ai. */
  baseUrl: string;
  agentToken?: string;
  /** Default "saaras:v4". The Guard cannot pin this (the field is in a multipart body), so the adapter does, and the record names the model it asked for. */
  sttModel?: string;
  timeoutMs?: number;
  /** For tests: the wire to use instead of a real one. */
  wire?: Wire;
}

export function createSarvam(config: SarvamConfig): SpeechProvider {
  const sttModel = config.sttModel ?? "saaras:v4";
  const wire = config.wire ?? createWire(config.baseUrl, "Sarvam", config.timeoutMs ?? 8_000, config.agentToken);

  return {
    name: "sarvam", sttModel,

    async transcribe(audio: Audio, shopLanguages): Promise<Transcript> {
      const form = new FormData();
      // The Blob copy keeps the bytes in memory only; nothing is written anywhere.
      form.set("file", new Blob([audio.bytes as BlobPart], { type: audio.mime }), "voice-note");
      form.set("model", sttModel);
      form.set("language_code", "unknown"); // customers mix languages; the probability it returns is the only confidence Sarvam gives
      const reply = await wire.request("POST", SARVAM_ROUTES.listen, { form });
      if (reply.status < 200 || reply.status >= 300 || !isObject(reply.json)) throw new ApiError(reply.status, `Sarvam answered ${reply.status} to a voice note.`);
      const heard = str(reply.json.language_code);
      const language = heard ? FROM_CODE.get(heard) : undefined;
      const probability = num(reply.json.language_probability);
      return {
        text: (str(reply.json.transcript) ?? "").trim(),
        // a language the shop does not speak is not trusted, whatever Sarvam heard
        language: language && shopLanguages.includes(language) ? language : null,
        confidence: probability !== undefined && probability >= 0 && probability <= 1 ? probability : null,
      };
    },
  };
}
