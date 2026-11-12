// Turning a spoken reply into Ogg Opus, the one format WhatsApp shows as a voice-note bubble (Meta's audio page: `voice: true` needs .ogg with the OPUS codec, mono). Sarvam's
// current voices return WAV or MP3, not Opus, so a small encoder has to sit between. This file runs ONE command the builder names (`opusenc`, from the opus-tools package) with the
// WAV on its standard input and the Ogg Opus on its standard output; there is no encoder library in this code and no dependency. Without it the reply is MP3 and plays as a plain
// audio message, which is the default. A failed or missing encoder is not an error for the customer: the words went as text, and the spoken copy is simply not sent.
import { spawn } from "node:child_process";
import type { Audio } from "./speech.ts";

/** Longest the encoder may take; a reply of a few hundred characters encodes in well under a second. */
const ENCODE_TIMEOUT_MS = 10_000;
const MAX_OUT = 4 * 1024 * 1024;

export type Encoder = (wav: Audio) => Promise<Audio | null>;

/**
 * `command` is a program name or path (no arguments, no shell: it is not run through one). It is called as `command --quiet --bitrate 24 - -`, which opusenc reads as
 * "WAV from stdin, Ogg Opus to stdout" at a speech bitrate (24 kbit/s; a voice is clear well below music rates and the file is a few tens of kilobytes).
 */
export function opusEncoder(command: string, args: readonly string[] = ["--quiet", "--bitrate", "24", "-", "-"]): Encoder {
  return (wav) => new Promise((resolve) => {
    let done = false;
    const finish = (a: Audio | null) => { if (!done) { done = true; clearTimeout(timer); resolve(a); } };
    const child = spawn(command, [...args], { stdio: ["pipe", "pipe", "ignore"] });
    const timer = setTimeout(() => { child.kill("SIGKILL"); finish(null); }, ENCODE_TIMEOUT_MS);
    const out: Buffer[] = [];
    let size = 0;
    child.stdout.on("data", (c: Buffer) => { size += c.length; if (size > MAX_OUT) { child.kill("SIGKILL"); finish(null); } else out.push(c); });
    child.on("error", () => finish(null)); // no such program
    child.on("close", (code) => finish(code === 0 && size > 0 ? { bytes: new Uint8Array(Buffer.concat(out)), mime: "audio/ogg" } : null));
    child.stdin.on("error", () => undefined); // the program may exit before it has read everything
    child.stdin.end(Buffer.from(wav.bytes));
  });
}
