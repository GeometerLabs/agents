// The voice service the agents are handed (plan B29, decision 42): `hear` turns a customer's voice note into the text of a typed message. LISTEN IN VOICE, REPLY IN TEXT (owner's
// decision, 12 Nov 2026: a spoken reply is hard to hear well and can feel uncanny, so the agent never speaks). Like `qrImage`, the agent is given this and never imports node-only or
// provider code. The service decides nothing about the shop: whether voice is on, and whether the month's AI cap or button mode lets it run, is asked by the agent before it calls.
//
// What it promises:
//  - every failure is a plain answer, never a throw: a voice note that cannot be read ("failed", "too_long", "unreadable", "low_confidence", "daily_cap") makes the agent send the
//    line it already sends, asking the customer to type. Nothing here waits for a Guard that is down (the wire's timeouts are short and no retry runs);
//  - the audio is held in memory for the call and dropped; what comes back is words, a length and a cost, which is all the record keeps;
//  - a call whose cost cannot be known is not made: the price is required by the config for a paid provider, and is zero for Geometer's own service;
//  - the same note asked twice (a step that runs again after a Guard wait) is answered from memory, never paid for twice.
import type { Clock } from "../core/clock.ts";
import type { Language } from "../language/languages.ts";
import { oggOpusSeconds } from "./ogg.ts";
import { fetchAudio } from "./media.ts";
import type { MediaRef, MediaSource } from "./media.ts";
import { lowConfidence, sttCostMicroInr } from "./speech.ts";
import type { SpeechProvider, SpeechRate } from "./speech.ts";

export type NotHeard = "failed" | "too_long" | "unreadable" | "low_confidence" | "daily_cap";

export type Heard =
  | { ok: true; text: string; language: Language; seconds: number; costMicroInr: number; provider: string; model: string; confidence: number | null }
  /** `costMicroInr` is what was already spent on a note that still could not be used (a call was made); 0 when no call was. */
  | { ok: false; reason: NotHeard; costMicroInr: number; provider: string; model: string; seconds?: number };

export interface VoiceService {
  /**
   * Listen to a note. `notesToday` is how many notes the shop has already listened to today, read by the caller from the shop's SAVED state (so the day's limit survives a
   * restart); at the limit nothing is asked of the provider. The same note (same media id or address) asked twice within half an hour gets the first answer again with
   * no call: a step that runs again after a Guard wait must not pay twice.
   */
  hear(ref: MediaRef, o?: { notesToday?: number }): Promise<Heard>;
}

export interface VoiceDeps {
  provider: SpeechProvider;
  media: MediaSource;
  rate: SpeechRate;
  languages: readonly Language[];
  clock: Clock;
  /** Longest voice note to listen to; the plain speech-to-text endpoints are for under 30 seconds. */
  maxSeconds?: number;
  /** Voice notes listened to in a day (the shop's local day); default 200. The count is kept in the shop's saved state (ai-state.ts addSpeech), not here. */
  notesPerDay?: number;
  /** Where a failure goes in plain words (the runtime's log), never what was said. */
  log?: (line: string) => void;
}

export const DEFAULT_MAX_SECONDS = 30;
export const DEFAULT_NOTES_PER_DAY = 200;

export function createVoice(deps: VoiceDeps): VoiceService {
  const { provider } = deps;
  const maxSeconds = deps.maxSeconds ?? DEFAULT_MAX_SECONDS;
  const perDay = deps.notesPerDay ?? DEFAULT_NOTES_PER_DAY;
  // Answers already given, for a step that runs again: keyed by the note's media id or address, kept half an hour, at most 200. A "failed" fetch is not kept (it may be
  // transient and made no charge); every other answer is, with its cost, so the surviving run counts the money once.
  const heardBefore = new Map<string, { at: number; heard: Heard }>();
  const no = (reason: NotHeard, extra: { costMicroInr?: number; seconds?: number } = {}): Heard =>
    ({ ok: false, reason, costMicroInr: extra.costMicroInr ?? 0, provider: provider.name, model: provider.sttModel, ...(extra.seconds !== undefined ? { seconds: extra.seconds } : {}) });
  const remember = (memo: string, heard: Heard): Heard => {
    if (memo) { heardBefore.set(memo, { at: deps.clock.now(), heard }); if (heardBefore.size > 200) heardBefore.delete(heardBefore.keys().next().value as string); }
    return heard;
  };

  return {
    async hear(ref, o = {}) {
      const memo = ref.id ?? ref.url ?? "";
      const before = memo ? heardBefore.get(memo) : undefined;
      if (before && deps.clock.now() - before.at < 30 * 60_000) return before.heard;
      if ((o.notesToday ?? 0) >= perDay) return no("daily_cap");
      let audio;
      try { audio = await fetchAudio(deps.media, ref); } catch (e) { deps.log?.(`A voice note could not be fetched (${(e as Error).message}).`); return no("failed"); }
      // The length is read from the audio itself: it is needed for the limit and for the cost, and nothing else gives it. A file with no readable length is not sent on.
      const seconds = oggOpusSeconds(audio.bytes);
      if (seconds === null) return no("unreadable");
      if (seconds > maxSeconds) return remember(memo, no("too_long", { seconds }));
      let transcript;
      try { transcript = await provider.transcribe(audio, deps.languages); }
      catch (e) { deps.log?.(`A voice note could not be transcribed (${(e as Error).message}).`); return no("failed", { seconds }); }
      const cost = sttCostMicroInr(deps.rate, seconds);
      if (lowConfidence(transcript)) return remember(memo, no("low_confidence", { costMicroInr: cost, seconds }));
      return remember(memo, { ok: true, text: transcript.text, language: transcript.language!, seconds, costMicroInr: cost, provider: provider.name, model: provider.sttModel, confidence: transcript.confidence });
    },
  };
}
