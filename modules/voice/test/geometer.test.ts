// Geometer's own speech service as the default provider (owner's direction, 12 Nov 2026), against a stand-in that speaks its two-route contract on localhost: the multipart
// upload arrives, the detected language and optional confidence come back, and the spoken reply is Ogg Opus that goes out as a voice message with no conversion. Also: the
// default when `provider` is left out, zero rupees per call with the seconds still recorded, and no key anywhere.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createGeometerSpeech, GEOMETER_SPEECH_ROUTES } from "../geometer.ts";
import { readSpeech } from "../config.ts";
import { createVoice } from "../voice.ts";
import { memoryAudioHost } from "../links.ts";
import { fakeVoiceNote, scriptedWire } from "../standin.ts";
import { fakeClock } from "../../core/clock.ts";

async function service(): Promise<{ url: string; seen: { url: string; type: string; body: Buffer }[]; close(): Promise<void> }> {
  const seen: { url: string; type: string; body: Buffer }[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      seen.push({ url: req.url!, type: String(req.headers["content-type"]), body: Buffer.concat(chunks) });
      if (req.url === GEOMETER_SPEECH_ROUTES.listen) { const b = JSON.stringify({ text: "कल सुबह बुक करना है", language: "hi", confidence: 0.88 }); res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(b) }); res.end(b); }
      else if (req.url === GEOMETER_SPEECH_ROUTES.speak) { const ogg = Buffer.from("OggS-opus-reply"); res.writeHead(200, { "content-type": "audio/ogg", "content-length": ogg.length }); res.end(ogg); }
      else { res.writeHead(404); res.end(); }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen, close: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}

test("the client speaks the contract: multipart in, text and language out; text in, Ogg Opus out, marked as opus", async () => {
  const s = await service();
  try {
    const p = createGeometerSpeech({ baseUrl: s.url });
    const heard = await p.transcribe({ bytes: fakeVoiceNote(5), mime: "audio/ogg" }, ["hi", "en"]);
    assert.deepEqual(heard, { text: "कल सुबह बुक करना है", language: "hi", confidence: 0.88 });
    assert.match(s.seen[0].type, /^multipart\/form-data/u);
    const spoke = await p.synthesize("नमस्ते", "hi");
    assert.equal(spoke.opus, true);
    assert.equal(spoke.audio.mime, "audio/ogg");
    assert.deepEqual(JSON.parse(s.seen[1].body.toString()), { text: "नमस्ते", language: "hi" });
    assert.ok(p.speaks.includes("ml") && p.speaks.includes("kn"));
  } finally { await s.close(); }
});

test("a language the shop does not speak, or an answer that is not Ogg, is not trusted", async () => {
  const odd = createGeometerSpeech({ baseUrl: "http://x.stand-in", wire: { async request(_m, path) { return path === GEOMETER_SPEECH_ROUTES.listen ? { status: 200, contentType: "application/json", bytes: new Uint8Array(), json: { text: "x", language: "ta" } } : { status: 200, contentType: "audio/mpeg", bytes: new Uint8Array([1]) }; } } });
  assert.deepEqual(await odd.transcribe({ bytes: fakeVoiceNote(3), mime: "audio/ogg" }, ["hi"]), { text: "x", language: null, confidence: null });
  await assert.rejects(odd.synthesize("hello", "en"), /no Ogg Opus/u);
});

test("left out, the provider is Geometer's own with no prices: zero rupees per call, the seconds still recorded, a reply that is a voice message", async () => {
  const errors: string[] = [];
  const config = readSpeech({ baseUrl: "http://g-speech:8080", media: { downloadBaseUrl: "http://g-media:8080", downloadHosts: ["m.example.com"] } }, "/shop", errors)!;
  assert.deepEqual(errors, []);
  assert.equal(config.provider, "geometer");
  assert.deepEqual(config.rate, { sttInrPerMinute: 0, ttsInrPer1000Characters: 0 });
  // a paid provider still needs its price
  const paid: string[] = [];
  readSpeech({ provider: "sarvam", baseUrl: "http://g-speech:8080", media: { downloadBaseUrl: "http://g-media:8080", downloadHosts: ["m.example.com"] } }, "/shop", paid);
  assert.ok(paid.some((e) => /speech\.rate is needed/u.test(e)));

  const s = await service();
  try {
    const voice = createVoice({
      provider: createGeometerSpeech({ baseUrl: s.url }), rate: config.rate, languages: ["hi", "en"], clock: fakeClock(Date.UTC(2026, 10, 12)), repliesOn: true, host: memoryAudioHost().host,
      media: { lookup: scriptedWire({}), download: scriptedWire({ "/a": { bytes: fakeVoiceNote(9), contentType: "audio/ogg" } }), version: "v26.0", downloadHosts: ["m.example.com"] },
    });
    const heard = await voice.hear({ url: "https://m.example.com/a" });
    assert.ok(heard.ok && heard.costMicroInr === 0 && Math.abs(heard.seconds - 9) < 0.01 && heard.provider === "geometer");
    const spoke = await voice.speak("Namaste", "hi");
    assert.ok(spoke && spoke.voice === true && spoke.costMicroInr === 0 && spoke.characters === 7);
  } finally { await s.close(); }
});
