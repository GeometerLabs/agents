// The Ogg Opus step for real voice-note bubbles (plan B29), with a stand-in encoder (a tiny Node script that behaves like `opusenc - -`: WAV on stdin, Ogg on stdout), because
// no encoder program is assumed to be on this machine. Covers: the encoder is run without a shell and its output used; a failing or missing encoder gives no spoken copy rather
// than a wrong one; the service marks the result as a voice note; Meta's body carries `voice: true` only for it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { opusEncoder } from "../encode.ts";
import { createVoice } from "../voice.ts";
import { fakeVoiceNote, scriptedSpeech, scriptedWire } from "../standin.ts";
import { memoryAudioHost } from "../links.ts";
import { audioBody } from "../../messaging/whatsapp.ts";
import { fakeClock } from "../../core/clock.ts";

const dir = mkdtempSync(join(tmpdir(), "opus-"));
const script = (name: string, body: string) => { const p = join(dir, name); writeFileSync(p, `#!/usr/bin/env node\n${body}\n`); chmodSync(p, 0o755); return p; };
// "encodes" by prefixing OggS and keeping the input length, so the test can see the bytes went through
const GOOD = script("good", `const c=[];process.stdin.on("data",d=>c.push(d));process.stdin.on("end",()=>process.stdout.write(Buffer.concat([Buffer.from("OggS"),...c])));`);
const BAD = script("bad", `process.stdin.resume();process.stdin.on("end",()=>process.exit(3));`);

test.after(() => rmSync(dir, { recursive: true, force: true }));

test("the encoder program is given the WAV and its output is the Ogg; a nonzero exit or a missing program is null", async () => {
  const out = await opusEncoder(GOOD, [])({ bytes: new Uint8Array([1, 2, 3]), mime: "audio/wav" });
  assert.equal(out!.mime, "audio/ogg");
  assert.equal(Buffer.from(out!.bytes).toString("latin1"), "OggS\u0001\u0002\u0003");
  assert.equal(await opusEncoder(BAD, [])({ bytes: new Uint8Array([1]), mime: "audio/wav" }), null);
  assert.equal(await opusEncoder(join(dir, "no-such-program"), [])({ bytes: new Uint8Array([1]), mime: "audio/wav" }), null);
});

test("with an encoder the spoken reply is a voice note (Ogg) and says so; if encoding fails there is no spoken copy at all", async () => {
  const mk = (encoder: ReturnType<typeof opusEncoder>) => {
    const host = memoryAudioHost();
    return { host, voice: createVoice({ provider: scriptedSpeech(), media: { lookup: scriptedWire({}), download: scriptedWire({}), version: "v26.0", downloadHosts: [] }, host: host.host, rate: { sttInrPerMinute: 1, ttsInrPer1000Characters: 1 }, languages: ["en"], clock: fakeClock(Date.UTC(2026, 10, 12)), repliesOn: true, encoder }) };
  };
  const good = mk(opusEncoder(GOOD, []));
  const spoke = await good.voice.speak("Hello there", "en");
  assert.equal(spoke!.voice, true);
  assert.equal(good.host.files.get(spoke!.link)!.mime, "audio/ogg");
  const bad = mk(opusEncoder(BAD, []));
  assert.equal(await bad.voice.speak("Hello there", "en"), null);
  assert.equal(bad.host.files.size, 0, "nothing was hosted");
  // and without an encoder it stays an MP3 plain audio message
  const plain = createVoice({ provider: scriptedSpeech(), media: { lookup: scriptedWire({}), download: scriptedWire({}), version: "v26.0", downloadHosts: [] }, host: memoryAudioHost().host, rate: { sttInrPerMinute: 1, ttsInrPer1000Characters: 1 }, languages: ["en"], clock: fakeClock(Date.UTC(2026, 10, 12)), repliesOn: true });
  assert.equal((await plain.speak("Hello there", "en"))!.voice, false);
});

test("Meta's audio body carries voice: true only for an Ogg Opus reply", () => {
  assert.deepEqual(audioBody("+919811111111", { link: "https://p.example/a.ogg", text: "x", voice: true }).audio, { link: "https://p.example/a.ogg", voice: true });
  assert.deepEqual(audioBody("+919811111111", { link: "https://p.example/a.mp3", text: "x" }).audio, { link: "https://p.example/a.mp3" });
});
