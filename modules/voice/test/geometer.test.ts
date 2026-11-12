// Geometer's own speech-to-text service as the default provider (owner's direction, 12 Nov 2026), against a stand-in that speaks its one-route contract on localhost
// (`POST /stt`: audio in, text and the detected language out). Listening only. Also: the default when `provider` is left out, zero rupees per call with the seconds still
// recorded, and no key anywhere.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createGeometerSpeech, GEOMETER_SPEECH_ROUTES } from "../geometer.ts";
import { readSpeech } from "../config.ts";
import { createVoice } from "../voice.ts";
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
      else { res.writeHead(404); res.end(); }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen, close: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}

test("the client speaks the contract: the voice note goes to POST /stt as multipart, the text, language and confidence come back; nothing else is called", async () => {
  assert.equal(GEOMETER_SPEECH_ROUTES.listen, "/stt");
  const s = await service();
  try {
    const heard = await createGeometerSpeech({ baseUrl: s.url }).transcribe({ bytes: fakeVoiceNote(5), mime: "audio/ogg" }, ["hi", "en"]);
    assert.deepEqual(heard, { text: "कल सुबह बुक करना है", language: "hi", confidence: 0.88 });
    assert.equal(s.seen.length, 1);
    assert.equal(s.seen[0].url, "/stt");
    assert.match(s.seen[0].type, /^multipart\/form-data/u);
  } finally { await s.close(); }
});

test("a language the shop does not speak is not trusted, and a missing confidence is unknown, not zero", async () => {
  const odd = createGeometerSpeech({ baseUrl: "http://x.stand-in", wire: { async request() { return { status: 200, contentType: "application/json", bytes: new Uint8Array(), json: { text: "x", language: "ta" } }; } } });
  assert.deepEqual(await odd.transcribe({ bytes: fakeVoiceNote(3), mime: "audio/ogg" }, ["hi"]), { text: "x", language: null, confidence: null });
  const broken = createGeometerSpeech({ baseUrl: "http://x.stand-in", wire: { async request() { return { status: 500, contentType: "", bytes: new Uint8Array() }; } } });
  await assert.rejects(broken.transcribe({ bytes: fakeVoiceNote(3), mime: "audio/ogg" }, ["hi"]), /answered 500/u);
});

test("left out, the provider is Geometer's own with no price: zero rupees per call, the seconds still recorded", async () => {
  const errors: string[] = [];
  const config = readSpeech({ baseUrl: "http://g-speech:8080", media: { downloadBaseUrl: "http://g-media:8080", downloadHosts: ["m.example.com"] } }, "/shop", errors)!;
  assert.deepEqual(errors, []);
  assert.equal(config.provider, "geometer");
  assert.deepEqual(config.rate, { sttInrPerMinute: 0 });
  const paid: string[] = [];
  readSpeech({ provider: "sarvam", baseUrl: "http://g-speech:8080", media: { downloadBaseUrl: "http://g-media:8080", downloadHosts: ["m.example.com"] } }, "/shop", paid);
  assert.ok(paid.some((e) => /speech\.rate is needed/u.test(e)), "a paid provider still needs its price");
  const withSpeakKeys: string[] = [];
  readSpeech({ baseUrl: "http://g-speech:8080", replies: true, rate: { sttInrPerMinute: 0, ttsInrPer1000Characters: 1 }, media: { downloadBaseUrl: "http://g-media:8080", downloadHosts: ["m.example.com"] } }, "/shop", withSpeakKeys);
  assert.ok(withSpeakKeys.some((e) => /replies/u.test(e)) && withSpeakKeys.some((e) => /rate/u.test(e)), "the settings for spoken replies no longer exist");

  const s = await service();
  try {
    const voice = createVoice({
      provider: createGeometerSpeech({ baseUrl: s.url }), rate: config.rate, languages: ["hi", "en"], clock: fakeClock(Date.UTC(2026, 10, 12)),
      media: { lookup: scriptedWire({}), download: scriptedWire({ "/a": { bytes: fakeVoiceNote(9), contentType: "audio/ogg" } }), version: "v26.0", downloadHosts: ["m.example.com"] },
    });
    const heard = await voice.hear({ url: "https://m.example.com/a" });
    assert.ok(heard.ok && heard.costMicroInr === 0 && Math.abs(heard.seconds - 9) < 0.01 && heard.provider === "geometer");
  } finally { await s.close(); }
});
