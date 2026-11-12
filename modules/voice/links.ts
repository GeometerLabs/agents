// Putting a spoken reply where WhatsApp can fetch it (plan B29). WhatsApp takes an audio message by its https address, as it does a picture or a document, so the reply
// is written under a fresh random folder name into the folder the monthly report's pages are served from (runtime.json report.pagesDir, served read-only with no listing),
// the same way the UPI QR picture is (modules/payments/owner-marked/qr-image.ts). Unlike the picture it is SHORT-LIVED: the name is 128 random bits, and the file is
// deleted after `ttlMs` (WhatsApp fetches it within seconds of the send), by a timer and by a sweep at start and at every new file, so a crash does not leave one behind.
// The reply's words are already in the record, so the file holds nothing the customer is not sent as text too.
import { randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Audio } from "./speech.ts";

/** Serve this audio and give its https address, or null when it could not be made. */
export type AudioHost = (audio: Audio) => Promise<string | null>;

export const AUDIO_TTL_MS = 10 * 60_000;
/** Every file this makes sits in a folder with this name prefix, so a sweep never touches a report page. */
export const FOLDER_PREFIX = "voice-";
const EXT: Record<string, string> = { "audio/mpeg": "mp3", "audio/aac": "aac", "audio/ogg": "ogg" };

/** Delete every voice folder older than the life of a link. Safe to call any time. */
export function sweepAudio(dir: string, nowMs: number, ttlMs: number = AUDIO_TTL_MS): number {
  let removed = 0;
  let names: string[] = [];
  try { names = readdirSync(dir); } catch { return 0; }
  for (const name of names) {
    if (!name.startsWith(FOLDER_PREFIX)) continue;
    try { if (nowMs - statSync(join(dir, name)).mtimeMs >= ttlMs) { rmSync(join(dir, name), { recursive: true, force: true }); removed++; } } catch { /* gone already */ }
  }
  return removed;
}

/** Into a folder served read-only at `baseUrl` (https, no trailing slash). */
export function folderAudioHost(o: { dir: string; baseUrl: string; ttlMs?: number; now?: () => number; log?: (line: string) => void }): AudioHost {
  const ttl = o.ttlMs ?? AUDIO_TTL_MS;
  const now = o.now ?? Date.now;
  sweepAudio(o.dir, now(), ttl); // at start: whatever a crash left
  return async (audio) => {
    try {
      sweepAudio(o.dir, now(), ttl);
      const folder = FOLDER_PREFIX + randomBytes(16).toString("hex");
      const ext = EXT[audio.mime];
      if (!ext) return null; // only types WhatsApp plays as audio
      mkdirSync(join(o.dir, folder), { recursive: true, mode: 0o755 });
      writeFileSync(join(o.dir, folder, `reply.${ext}`), audio.bytes, { mode: 0o644 });
      setTimeout(() => { try { rmSync(join(o.dir, folder), { recursive: true, force: true }); } catch { /* swept later */ } }, ttl).unref();
      return `${o.baseUrl.replace(/\/+$/u, "")}/${folder}/reply.${ext}`;
    } catch (e) {
      o.log?.(`The spoken reply could not be written (${(e as Error).message}); the customer gets the words as text.`);
      return null;
    }
  };
}

/** In memory, for the tests and the hand check: `files` maps each address to the bytes behind it. */
export function memoryAudioHost(): { host: AudioHost; files: Map<string, Audio> } {
  const files = new Map<string, Audio>();
  let n = 0;
  return { files, host: async (audio) => { const link = `https://audio.stand-in/${++n}/reply.mp3`; files.set(link, audio); return link; } };
}
