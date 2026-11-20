// Writes go/internal/voice/testdata/voice-vectors.json: what the TypeScript voice module makes of some audio and some prices, for the Go twin (internal/voice) to be proved equal on:
// the length of Ogg Opus and WebM Opus notes (modules/voice/ogg.ts, webm.ts, over the stand-in's own files, modules/voice/standin.ts), a file that is neither, and the cost of
// listening (speech.ts sttCostMicroInr). Run from the repository root:   node go/scripts/gen_voice_vectors.ts        (add --check to only compare with the committed file)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fakeVoiceNote, fakeWebmVoiceNote } from "../../modules/voice/standin.ts";
import { oggOpusSeconds } from "../../modules/voice/ogg.ts";
import { webmOpusSeconds } from "../../modules/voice/webm.ts";
import { sttCostMicroInr } from "../../modules/voice/speech.ts";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "internal", "voice", "testdata", "voice-vectors.json");
const b64 = (b: Uint8Array): string => Buffer.from(b).toString("base64");
const audio = [];
for (const s of [1, 5, 12, 29, 31, 60]) {
  const ogg = fakeVoiceNote(s);
  const webm = fakeWebmVoiceNote(s);
  audio.push({ bytes: b64(ogg), ogg: oggOpusSeconds(ogg), webm: webmOpusSeconds(ogg) });
  audio.push({ bytes: b64(webm), ogg: oggOpusSeconds(webm), webm: webmOpusSeconds(webm) });
}
const junk = new TextEncoder().encode("ID3 this is not a voice note");
audio.push({ bytes: b64(junk), ogg: oggOpusSeconds(junk), webm: webmOpusSeconds(junk) });
audio.push({ bytes: b64(fakeVoiceNote(12).slice(0, 60)), ogg: oggOpusSeconds(fakeVoiceNote(12).slice(0, 60)), webm: null });
const costs = [];
for (const rate of [0, 0.6, 1.25, 30]) for (const seconds of [0.5, 1, 12, 29.98, 60]) costs.push({ rate, seconds, micro: sttCostMicroInr({ sttInrPerMinute: rate }, seconds) });
const text = `${JSON.stringify({ audio, costs })}\n`;
if (process.argv.includes("--check")) {
  if (readFileSync(OUT, "utf8") !== text) { console.error(`${OUT} is out of date: run node go/scripts/gen_voice_vectors.ts`); process.exit(1); }
  console.log("voice vectors are fresh");
} else { writeFileSync(OUT, text); console.log(`wrote ${OUT}`); }
