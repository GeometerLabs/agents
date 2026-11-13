// The owner's recordings from their page (integration of items 11d and 11e: the owner app's hold-to-record), held by the shop's runtime in MEMORY ONLY until the
// step that listens to them runs. Used by a template's runtime (templates/commerce/bookings/server/runtime.ts): the runtime's HTTP layer puts a recording here and
// saves an `owner_message` event that carries only this drop's reference (modules/channels/events.ts), never the audio; the agent's step takes the audio from here and
// hands it to the voice service (modules/voice). So a recording is never written to disk, never in the saved events and never in the record, the same promise as a
// WhatsApp voice note's. A restart forgets what was waiting: the owner is then asked to type it.
import { randomUUID } from "node:crypto";
import type { PageAudio } from "../voice/turn.ts";

/** The most a page recording may be: 30 seconds of Ogg or WebM Opus at the page's 24 kbps is about 90 KB; more is not one of the page's recordings. */
export const MAX_VOICE_BYTES = 256 * 1024;
/** How long a recording waits for its step: a step runs within seconds; a minute's Guard wait and a retry are well inside this. */
export const AUDIO_HELD_MS = 5 * 60_000;
/** At most this many recordings held at once (a shop has one owner): anything older goes first. */
export const AUDIO_HELD_MAX = 8;

export interface AudioDrop {
  /** Hold a recording; its reference, for the event. */
  put(bytes: Uint8Array, mime: string): string;
  /** The recording with this reference, while it is held. Not taken out: a step that runs again (after a Guard wait) finds it again, and the voice service answers it from memory. */
  get(ref: string): PageAudio | undefined;
}

/** A drop over the runtime's clock. */
export function createAudioDrop(o: { now: () => number; heldMs?: number; max?: number }): AudioDrop {
  const held = new Map<string, { at: number; bytes: Uint8Array; mime: string }>();
  const heldMs = o.heldMs ?? AUDIO_HELD_MS;
  const max = o.max ?? AUDIO_HELD_MAX;
  const sweep = () => { const now = o.now(); for (const [ref, a] of held) if (now - a.at >= heldMs) held.delete(ref); };
  return {
    put(bytes, mime) {
      sweep();
      while (held.size >= max) held.delete(held.keys().next().value as string);
      const ref = randomUUID();
      held.set(ref, { at: o.now(), bytes, mime });
      return ref;
    },
    get(ref) {
      sweep();
      const a = held.get(ref);
      return a ? { ref, bytes: a.bytes, mime: a.mime } : undefined;
    },
  };
}
