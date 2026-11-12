// The panel's voice-notes switch and the speech-key page (plan B29): off by default, nothing written without prices and a host, every other key of runtime.json kept, the words in
// four languages, the key through the write-only inbox and never repeated.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyVoice, keepSpeech, voiceFormOf, voiceOf } from "../voice.ts";
import { voicePage, voiceLinkWord } from "../views-voice.ts";
import { serverKeyShapeOk, SERVER_SECRET_NAMES } from "../server-contract.ts";
import { LANGUAGES } from "../../../modules/language/languages.ts";

const RUNTIME = { mode: "live", tickSeconds: 30, services: { messaging: { phoneNumberId: "106540352242922" } } };
const form = (o: Record<string, string>) => voiceFormOf(o);

test("a shop with no speech block is off; the page's default is off", () => {
  assert.deepEqual(voiceOf(RUNTIME), { on: false, provider: "geometer", replies: true });
  assert.deepEqual(voiceOf(undefined), { on: false, provider: "geometer", replies: true });
});

test("turning it on needs both prices and a host; with them the block holds who things are and nothing else, and the rest of runtime.json is untouched", () => {
  assert.deepEqual(applyVoice(RUNTIME, form({ on: "1", provider: "sarvam", stt: "0.5", tts: "", host: "media.example.com" })), { ok: false, fields: ["tts"] }, "a paid provider needs both prices");
  assert.deepEqual(applyVoice(RUNTIME, form({ on: "1", stt: "abc", tts: "3", host: "not a host" })), { ok: false, fields: ["stt", "host"] });
  const free = applyVoice(RUNTIME, form({ on: "1", host: "media.example.com", replies: "1" }));
  assert.ok(free.ok && JSON.stringify(free.runtime.speech) === JSON.stringify({ provider: "geometer", rate: { sttInrPerMinute: 0, ttsInrPer1000Characters: 0 }, media: { downloadHosts: ["media.example.com"] }, replies: true }), "Geometer's own service is the default and needs no prices");
  const on = applyVoice(RUNTIME, form({ on: "1", provider: "sarvam", stt: "0.5", tts: "3", host: "Media.Example.com", replies: "1" }));
  assert.ok(on.ok);
  if (on.ok) {
    assert.deepEqual(on.runtime.speech, { provider: "sarvam", rate: { sttInrPerMinute: 0.5, ttsInrPer1000Characters: 3 }, media: { downloadHosts: ["media.example.com"] }, replies: true });
    assert.deepEqual({ ...on.runtime, speech: undefined }, { ...RUNTIME, speech: undefined });
    assert.ok(!JSON.stringify(on.runtime.speech).match(/key|token|secret/iu), "no key in the block");
    assert.deepEqual(voiceOf(on.runtime as never), { on: true, provider: "sarvam", replies: true, sttInrPerMinute: 0.5, ttsInrPer1000Characters: 3, downloadHost: "media.example.com" });
    const off = applyVoice(on.runtime, form({}));
    assert.ok(off.ok && !("speech" in off.runtime), "off removes the block");
    const quiet = applyVoice(on.runtime, form({ on: "1", provider: "sarvam", stt: "0.5", tts: "3", host: "media.example.com" }));
    assert.ok(quiet.ok && (quiet.runtime.speech as { replies: boolean }).replies === false, "replies unticked: listen only");
  }
});

test("what the builder added by hand survives the switch being saved again, and a re-made runtime.json keeps the block", () => {
  const by = { ...RUNTIME, speech: { provider: "sarvam", opusEncoder: "opusenc", maxSeconds: 20, rate: { sttInrPerMinute: 1, ttsInrPer1000Characters: 1 }, media: { downloadHosts: ["a.example"], lookupBaseUrl: "x" } } };
  const again = applyVoice(by, form({ on: "1", provider: "sarvam", stt: "0.6", tts: "3", host: "b.example", replies: "1" }));
  assert.ok(again.ok);
  if (again.ok) { const sp = again.runtime.speech as Record<string, any>; assert.equal(sp.opusEncoder, "opusenc"); assert.equal(sp.maxSeconds, 20); assert.equal(sp.media.lookupBaseUrl, "x"); assert.deepEqual(sp.media.downloadHosts, ["b.example"]); }
  assert.deepEqual(keepSpeech({ mode: "live" }, by).speech, by.speech);
  assert.deepEqual(keepSpeech({ mode: "live" }, RUNTIME), { mode: "live" });
});

test("the page is in four languages and says the switch does nothing without the server's key", () => {
  for (const lang of LANGUAGES) {
    const c = { lang, csrf: "t", w: { common: { back: "back" } } } as never;
    const withKey = voicePage(c, { id: "glow", name: "Glow", state: { on: false, provider: "geometer", replies: true }, keyInPlace: true });
    const without = voicePage(c, { id: "glow", name: "Glow", state: { on: true, provider: "geometer", replies: true, sttInrPerMinute: 0.5, ttsInrPer1000Characters: 3, downloadHost: "m.example" }, keyInPlace: false });
    assert.match(withKey, /action="\/shops\/glow\/voice"/u);
    assert.doesNotMatch(withKey, /name="on" value="1" checked/u, "off by default");
    assert.match(without, /name="on" value="1" checked/u);
    assert.notEqual(withKey, without);
    assert.ok(voiceLinkWord(lang).length > 0);
  }
  assert.notEqual(voiceLinkWord("en"), voiceLinkWord("hi"));
});

test("the speech key is one of the server's write-only secrets, checked by shape and never echoed", () => {
  assert.ok((SERVER_SECRET_NAMES as readonly string[]).includes("speech_key"));
  assert.equal(serverKeyShapeOk("speech_key", "  sk_abcdefgh1234  "), true);
  assert.equal(serverKeyShapeOk("speech_key", "short"), false);
  assert.equal(serverKeyShapeOk("speech_key", "has a space inside"), false);
});
