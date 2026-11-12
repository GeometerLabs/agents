// The voice service the agents are handed (plan B29, decision 42): `hear` turns a voice note into the text of a typed message, `speak` turns a reply into a short-lived
// https address of audio. Like `qrImage`, the agent is given this and never imports node-only or provider code. The service decides nothing about the shop: whether
// voice is on, and whether the month's AI cap or button mode lets it run, is asked by the agent before it calls (templates/commerce/bookings/src/agent.ts).
//
// What it promises:
//  - every failure is a plain answer, never a throw: a voice note that cannot be read ("failed", "too_long", "unreadable", "low_confidence", "daily_cap") makes the
//    agent send the line it already sends, asking the customer to type. Nothing here waits for a Guard that is down (the wire's timeouts are short and no retry runs);
//  - the audio is held in memory for the call and dropped; what comes back is words, a length and a cost, which is all the record keeps;
//  - a call whose cost cannot be known is not made: a partner's shop must not be able to spend what the meter cannot see (the rate is required by the config);
//  - a daily cap on voice notes (the Guard's own daily count is the durable one; this one stops a burst within a run).
import type { Clock } from "../core/clock.ts";
import type { Language } from "../language/languages.ts";
import { oggOpusSeconds } from "./ogg.ts";
import { fetchAudio } from "./media.ts";
import type { MediaRef, MediaSource } from "./media.ts";
import { lowConfidence, sttCostMicroInr, ttsCostMicroInr } from "./speech.ts";
import type { SpeechProvider, SpeechRate } from "./speech.ts";
import type { AudioHost } from "./links.ts";

export type NotHeard = "failed" | "too_long" | "unreadable" | "low_confidence" | "daily_cap";

export type Heard =
  | { ok: true; text: string; language: Language; seconds: number; costMicroInr: number; provider: string; model: string; confidence: number | null }
  /** `costMicroInr` is what was already spent on a note that still could not be used (a call was made); 0 when no call was. */
  | { ok: false; reason: NotHeard; costMicroInr: number; provider: string; model: string; seconds?: number };

export interface Spoke { link: string; characters: number; costMicroInr: number; provider: string; model: string }

export interface VoiceService {
  hear(ref: MediaRef): Promise<Heard>;
  /** The words as audio at an https address, or null (not in this language, nothing to say, too long a failure, or the host could not serve it). Never throws. */
  speak(text: string, language: Language): Promise<Spoke | null>;
  /** Whether replies go as voice notes too (the shop can turn this off and keep listening). */
  repliesOn: boolean;
}

export interface VoiceDeps {
  provider: SpeechProvider;
  media: MediaSource;
  host: AudioHost;
  rate: SpeechRate;
  languages: readonly Language[];
  clock: Clock;
  repliesOn: boolean;
  /** Longest voice note to listen to; Sarvam's plain endpoint is for under 30 seconds. */
  maxSeconds?: number;
  /** Voice notes listened to in a day (UTC); default 200. */
  notesPerDay?: number;
  /** Characters of one spoken reply; default 400, and never above what the provider takes. */
  replyCharacters?: number;
  /** Where a failure goes in plain words (the runtime's log), never what was said. */
  log?: (line: string) => void;
}

export const DEFAULT_MAX_SECONDS = 30;
export const DEFAULT_NOTES_PER_DAY = 200;
export const DEFAULT_REPLY_CHARACTERS = 400;

/**
 * What of a reply is spoken: the words without any link or payment address (a voice cannot say them usefully, and the text message beside it carries them), cut at
 * a sentence end when long. Empty when nothing is left to say.
 */
export function spokenForm(text: string, limit: number): string {
  const plain = text.replace(/\b(?:https?|upi):\/\/\S+/giu, " ").replace(/\s+/gu, " ").trim();
  if (plain.length <= limit) return plain;
  const cut = plain.slice(0, limit);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "), cut.lastIndexOf("। "));
  return (end > limit / 2 ? cut.slice(0, end + 1) : cut).trim();
}

export function createVoice(deps: VoiceDeps): VoiceService {
  const { provider } = deps;
  const maxSeconds = deps.maxSeconds ?? DEFAULT_MAX_SECONDS;
  const perDay = deps.notesPerDay ?? DEFAULT_NOTES_PER_DAY;
  const limit = Math.min(deps.replyCharacters ?? DEFAULT_REPLY_CHARACTERS, provider.maxCharacters);
  let day = "";
  let today = 0;
  const no = (reason: NotHeard, extra: { costMicroInr?: number; seconds?: number } = {}): Heard =>
    ({ ok: false, reason, costMicroInr: extra.costMicroInr ?? 0, provider: provider.name, model: provider.sttModel, ...(extra.seconds !== undefined ? { seconds: extra.seconds } : {}) });

  return {
    repliesOn: deps.repliesOn,

    async hear(ref) {
      const d = new Date(deps.clock.now()).toISOString().slice(0, 10);
      if (d !== day) { day = d; today = 0; }
      if (today >= perDay) return no("daily_cap");
      let audio;
      try { audio = await fetchAudio(deps.media, ref); } catch (e) { deps.log?.(`A voice note could not be fetched (${(e as Error).message}).`); return no("failed"); }
      // The length is read from the audio itself: it is needed for the limit and for the cost, and nothing else gives it. A file with no readable length is not sent on.
      const seconds = oggOpusSeconds(audio.bytes);
      if (seconds === null) return no("unreadable");
      if (seconds > maxSeconds) return no("too_long", { seconds });
      today += 1; // counted when a call is about to be made, so a failing provider cannot be hammered either
      let transcript;
      try { transcript = await provider.transcribe(audio, deps.languages); }
      catch (e) { deps.log?.(`A voice note could not be transcribed (${(e as Error).message}).`); return no("failed", { seconds }); }
      const cost = sttCostMicroInr(deps.rate, seconds);
      if (lowConfidence(transcript)) return no("low_confidence", { costMicroInr: cost, seconds });
      return { ok: true, text: transcript.text, language: transcript.language!, seconds, costMicroInr: cost, provider: provider.name, model: provider.sttModel, confidence: transcript.confidence };
    },

    async speak(text, language) {
      if (!deps.repliesOn || !provider.speaks.includes(language)) return null;
      const words = spokenForm(text, limit);
      if (words === "") return null;
      try {
        const spoken = await provider.synthesize(words, language);
        const link = await deps.host(spoken.audio);
        if (!link) return null;
        return { link, characters: spoken.characters, costMicroInr: ttsCostMicroInr(deps.rate, spoken.characters), provider: provider.name, model: provider.ttsModel };
      } catch (e) {
        deps.log?.(`A spoken reply could not be made (${(e as Error).message}); the words went as text.`);
        return null;
      }
    },
  };
}
