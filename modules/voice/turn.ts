// What every template's agent does with a voice note, written once (plan B29): decide whether to listen, listen, count what it cost, and give the record its marks. Bookings, Orders
// and Fees each call this from their own message handler; what differs between them (how they log, how they say the "please type" line) stays in the agent. Used only by agents
// that were handed a voice service; without one `listen` returns null and the agent behaves exactly as it did before voice existed.
import type { InboundMessage } from "../messaging/messaging.ts";
import type { Heard, NotHeard, VoiceService } from "./voice.ts";

/** Why a voice note was not used, in the record's words. */
export const VOICE_WHY: Record<NotHeard, string> = {
  failed: "it could not be fetched or the speech provider did not answer", too_long: "it is longer than the limit for voice notes", unreadable: "it is not a recording whose length could be read",
  low_confidence: "the provider could not make out words it was sure of", daily_cap: "the day's limit for voice notes is reached",
};

export type HeardOk = Extract<Heard, { ok: true }>;

/** A recording the owner made on their page: the bytes as the runtime holds them in memory, their type, and the reference its event carries (never the audio). */
export interface PageAudio { ref: string; bytes: Uint8Array; mime: string }

/** The record's marks for a message that came by voice (refs are strings). */
export const voiceMarks = (h: HeardOk): Record<string, string> => ({ via: "voice", speechProvider: h.provider, speechModel: h.model, speechSeconds: h.seconds.toFixed(1), speechMicroInr: String(h.costMicroInr) });

/** The record's refs for a note that could not be used: why, and (when a call was made and charged) the cost as a rules-read message so the cost meter counts it. */
export function failedMarks(h: Extract<Heard, { ok: false }>): Record<string, string> {
  return { voice: h.reason, ...(h.costMicroInr > 0 ? { step: "rules", provider: h.provider, model: h.model, inputTokens: "0", outputTokens: "0", costMicroInr: String(h.costMicroInr), ...(h.seconds !== undefined ? { speechSeconds: h.seconds.toFixed(1) } : {}) } : {}) };
}

export interface VoiceTurnDeps {
  voice?: VoiceService;
  /** The agent's reader (modules/understanding/reader.ts). */
  reader: { voiceAllowed(): boolean; countSpeech(costMicroInr: number): void; notesToday(): number };
  /** The owner and the other approvers: their messages are commands and are typed, never listened to. */
  isCommander(phone: string): boolean;
  optedOut(phone: string): boolean;
}

/**
 * Listen to a voice note if voice is on and allowed right now. Returns what was heard, the reason it was not, or null when no listening was tried (voice off, no media
 * reference, a commander, STOP, or the shop out of AI allowance: the provider is not asked in any of those). The cost of a call that was made is counted in the month's AI
 * spend whether or not the note could be used.
 */
export function createListener(d: VoiceTurnDeps) {
  return async function listen(msg: InboundMessage & { audio?: PageAudio }): Promise<Heard | null> {
    if (!d.voice || (!msg.media && !msg.audio) || d.isCommander(msg.from) || d.optedOut(msg.from) || !d.reader.voiceAllowed()) return null;
    // the owner's recording from their page (items 11d and 11e) is already in hand, kept in the runtime's memory only; a WhatsApp note is fetched by its reference
    const heard = msg.audio
      ? await d.voice.hearAudio({ bytes: msg.audio.bytes, mime: msg.audio.mime }, { notesToday: d.reader.notesToday(), memo: msg.audio.ref })
      : await d.voice.hear(msg.media!, { notesToday: d.reader.notesToday() });
    // a cached answer (a step that ran again) was counted by the first run, whose state was thrown away; counting it here is what makes the surviving state right
    if (heard.ok || heard.costMicroInr > 0) d.reader.countSpeech(heard.costMicroInr);
    return heard;
  };
}
