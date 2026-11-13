// Plan item 11i: the owner's talk box on Android records WebM Opus (Chrome's MediaRecorder cannot record Ogg), so the voice service reads a WebM recording's
// length from its bytes, as it reads a WhatsApp voice note's (ogg.ts): for the 30-second limit and the cost. Checked on a real recording Chromium made with
// MediaRecorder (fixtures/chromium-recording.webm, 3 seconds from the browser's test microphone), on files laid out the same way (standin.ts), and on
// files that are not WebM Opus at all.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webmOpusSeconds } from "../webm.ts";
import { oggOpusSeconds } from "../ogg.ts";
import { createVoice } from "../voice.ts";
import { fakeVoiceNote, fakeWebmVoiceNote, scriptedSpeech, scriptedWire } from "../standin.ts";

const CHROMIUM = new Uint8Array(readFileSync(new URL("./fixtures/chromium-recording.webm", import.meta.url)));

test("a real Chromium recording (MediaRecorder, audio/webm;codecs=opus: unknown sizes, no duration) is as long as its packets say", () => {
  // Recorded for 3 seconds from Chromium's test microphone on a busy machine: its 60 ms packets have gaps (cause not looked into). ffprobe lists the last packet
  // at 2.43 s, lasting 60 ms: 2.49 s, which is what the reader must say.
  const seconds = webmOpusSeconds(CHROMIUM);
  assert.ok(seconds !== null && Math.abs(seconds - 2.49) < 0.005, `read ${seconds} s; its packets end at 2.49 s`);
  assert.equal(oggOpusSeconds(CHROMIUM), null, "it is not Ogg");
});

test("a WebM recording's length comes from its last Opus block, across clusters; a cut-off file gives what it holds", () => {
  for (const s of [0.5, 3, 12, 29.98, 31, 45]) assert.ok(Math.abs(webmOpusSeconds(fakeWebmVoiceNote(s))! - s) < 0.001, `${s} s`);
  const cut = webmOpusSeconds(fakeWebmVoiceNote(12).subarray(0, 4000));
  assert.ok(cut !== null && cut > 3 && cut < 6, "a recording cut short is as long as what arrived");
});

test("anything that is not WebM or Matroska with Opus has no length here: an Ogg note, an mp3, junk, nothing, a WebM with another codec", () => {
  assert.equal(webmOpusSeconds(fakeVoiceNote(12)), null);
  assert.equal(webmOpusSeconds(new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0])), null);
  assert.equal(webmOpusSeconds(new Uint8Array([1, 2, 3])), null);
  assert.equal(webmOpusSeconds(new Uint8Array(0)), null);
  const vorbis = fakeWebmVoiceNote(5);
  const at = Buffer.from(vorbis).indexOf("A_OPUS");
  vorbis.set([..."A_VORB"].map((c) => c.charCodeAt(0)), at);
  assert.equal(webmOpusSeconds(vorbis), null, "only Opus is priced");
  const header = fakeWebmVoiceNote(5);
  header.set([..."junk"].map((c) => c.charCodeAt(0)), Buffer.from(header).indexOf("webm"));
  assert.equal(webmOpusSeconds(header), null, "the header must say webm or matroska");
});

test("hearAudio: a WebM recording from the owner's page is heard with its length and cost, and one over the limit is not sent on", async () => {
  const speech = scriptedSpeech({ transcript: { text: "close tomorrow", language: "en", confidence: 0.95 } });
  const voice = createVoice({ provider: speech, media: { lookup: scriptedWire({}), download: scriptedWire({}), version: "v26.0", downloadHosts: [] }, rate: { sttInrPerMinute: 0.6 }, languages: ["en", "hi"], clock: { now: () => 0 } });
  const heard = await voice.hearAudio({ bytes: fakeWebmVoiceNote(12), mime: "audio/webm; codecs=opus" }, { memo: "rec-1" });
  assert.ok(heard.ok && Math.abs(heard.seconds - 12) < 0.001 && heard.costMicroInr === 120_000);
  assert.match(speech.calls[0].detail, /^audio\/webm; codecs=opus /u, "the provider gets the recording as it came, with its type");
  const real = await voice.hearAudio({ bytes: CHROMIUM, mime: "audio/webm; codecs=opus" }, { memo: "rec-2" });
  assert.ok(real.ok, "the real recording too");
  const long = await voice.hearAudio({ bytes: fakeWebmVoiceNote(45), mime: "audio/webm; codecs=opus" }, { memo: "rec-3" });
  assert.ok(!long.ok && long.reason === "too_long");
  assert.equal(speech.calls.length, 2, "too long: nothing sent to the provider");
});
