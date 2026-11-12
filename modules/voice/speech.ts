// The speech provider interface (plan B29, decision 42): turn a customer's voice note into text. (Listening only: the agent replies in text; spoken replies were removed by the owner, 12 Nov 2026.) One small interface so Geometer's own speech service (geometer.ts, the default)
// is not the only way in: Sarvam (sarvam.ts, optional) or a model a builder hosts is one more file that returns the same shape. Used by voice.ts (the one
// service the agents are handed) and by the tests' stand-in (standin.ts). Nothing here holds a key: the base URL an adapter is given is a Guard in front of the provider.
import type { Language } from "../language/languages.ts";

/** Audio held in memory for one call. Inbound audio is never written to disk and never put in a saved event or the record. */
export interface Audio { bytes: Uint8Array; mime: string }

export interface Transcript {
  /** What was said, as text. Empty when nothing could be made out. */
  text: string;
  /** The language the provider heard, mapped to ours; null when it named none or one the shop does not speak. */
  language: Language | null;
  /**
   * 0 to 1, or null when the provider gives none. Sarvam gives no confidence for a transcript, only the probability of the language it detected, so an adapter
   * puts that here and `lowConfidence` below treats a missing number as unknown, not as good.
   */
  confidence: number | null;
}


export interface SpeechProvider {
  /** The provider's short name as the record and the cost meter write it: "sarvam". */
  name: string;
  /** The models the adapter is pinned to, as the record writes them. */
  sttModel: string;
  /** Throws on any failure; the service turns every failure into "ask the customer to type". */
  transcribe(audio: Audio, shopLanguages: readonly Language[]): Promise<Transcript>;
}

/** The provider's price per minute listened, in rupees, as the BUILDER reads it off their invoice or the provider's page (runtime.json speech.rate). Never written in code. Zero for Geometer's own service. */
export interface SpeechRate { sttInrPerMinute: number }

/** Micro-rupees (millionths) for listening to `seconds`, rounded up. */
export const sttCostMicroInr = (rate: SpeechRate, seconds: number): number => Math.max(0, Math.ceil(rate.sttInrPerMinute * (seconds / 60) * 1_000_000 - 1e-9)) + 0; // + 0: never -0 for a zero rate

/** A transcript below this probability is not trusted. A placeholder until real voice notes in Malayalam and Kannada have been listened to (Deferred.md). */
export const LOW_CONFIDENCE_BELOW = 0.5;

/**
 * Is this transcript too thin to act on? Empty or only punctuation, no language we can name, or a stated confidence under the line. An unknown confidence (null) is
 * NOT low by itself: Sarvam gives none when the language is told to it; the other checks still hold.
 */
export function lowConfidence(t: Transcript, below: number = LOW_CONFIDENCE_BELOW): boolean {
  if (!/[\p{L}\p{N}]/u.test(t.text)) return true;
  if (t.language === null) return true;
  return t.confidence !== null && t.confidence < below;
}
