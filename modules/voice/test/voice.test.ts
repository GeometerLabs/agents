// The voice module end to end with stand-ins only (no account, no network): the length of a voice note, the provider adapter's wire shapes, the media fetch's
// limits, and the service's promises (every failure is an answer; no call when the cost cannot be known; the cap; what is spoken). Plan B29.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readdirSync, utimesSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { oggOpusSeconds } from "../ogg.ts";
import { lowConfidence, sttCostMicroInr, ttsCostMicroInr } from "../speech.ts";
import { createSarvam, SARVAM_ROUTES } from "../sarvam.ts";
import { fetchAudio, MAX_AUDIO_BYTES } from "../media.ts";
import { createVoice, spokenForm } from "../voice.ts";
import { folderAudioHost, sweepAudio, memoryAudioHost, FOLDER_PREFIX } from "../links.ts";
import { fakeVoiceNote, scriptedSpeech, scriptedWire } from "../standin.ts";
import { fakeClock } from "../../core/clock.ts";

// A rate for the tests only: the builder's number from their invoice, never written in code outside a test.
const RATE = { sttInrPerMinute: 0.6, ttsInrPer1000Characters: 3 };
const NOTE = fakeVoiceNote(12);
const mediaFor = (bytes: Uint8Array = NOTE, urlHost = "media.stand-in") => {
  const lookup = scriptedWire({ "/v26.0/MEDIA1": { json: { url: `https://${urlHost}/whatsapp/audio?mid=MEDIA1&ext=1`, mime_type: "audio/ogg; codecs=opus", file_size: String(bytes.length) } } });
  const download = scriptedWire({ "/whatsapp/audio": { bytes, contentType: "audio/ogg" } });
  return { lookup, download, source: { lookup, download, version: "v26.0", downloadHosts: ["media.stand-in"] } };
};
const build = (o: { speech?: ReturnType<typeof scriptedSpeech>; bytes?: Uint8Array; repliesOn?: boolean; notesPerDay?: number } = {}) => {
  const speech = o.speech ?? scriptedSpeech();
  const m = mediaFor(o.bytes);
  const audio = memoryAudioHost();
  const voice = createVoice({ provider: speech, media: m.source, host: audio.host, rate: RATE, languages: ["hi", "en", "ml", "kn"], clock: fakeClock(Date.UTC(2026, 10, 12, 10)), repliesOn: o.repliesOn ?? true, ...(o.notesPerDay ? { notesPerDay: o.notesPerDay } : {}) });
  return { speech, m, audio, voice };
};

test("the length of a voice note is read from the audio; a file that is not Ogg Opus has none", () => {
  assert.ok(Math.abs(oggOpusSeconds(fakeVoiceNote(12.5))! - 12.5) < 0.01);
  assert.equal(oggOpusSeconds(new Uint8Array([1, 2, 3, 4])), null);
  assert.equal(oggOpusSeconds(new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0])), null); // an mp3
  assert.equal(oggOpusSeconds(new Uint8Array(0)), null);
});

test("a transcript is low when empty, language-less or under the line; an unknown confidence alone is not low", () => {
  const ok = { text: "book kar do", language: "hi" as const, confidence: 0.9 };
  assert.equal(lowConfidence(ok), false);
  assert.equal(lowConfidence({ ...ok, confidence: null }), false);
  assert.equal(lowConfidence({ ...ok, confidence: 0.3 }), true);
  assert.equal(lowConfidence({ ...ok, text: " . ... " }), true);
  assert.equal(lowConfidence({ ...ok, text: "" }), true);
  assert.equal(lowConfidence({ ...ok, language: null }), true);
});

test("costs are the builder's rate times the amount, rounded up, in micro-rupees", () => {
  assert.equal(sttCostMicroInr(RATE, 30), 300_000);
  assert.equal(sttCostMicroInr(RATE, 12), 120_000);
  assert.equal(ttsCostMicroInr(RATE, 200), 600_000);
  assert.equal(ttsCostMicroInr(RATE, 1), 3_000);
});

test("Sarvam adapter: the listen request names the pinned model and detects the language; the answer maps to our languages and the probability", async () => {
  let form: FormData | undefined;
  const wire = { async request(_m: string, path: string, o: { form?: FormData; json?: unknown }) {
    if (path === SARVAM_ROUTES.listen) { form = o.form; return { status: 200, contentType: "application/json", bytes: new Uint8Array(), json: { transcript: " कल सुबह बुक करना ", language_code: "hi-IN", language_probability: 0.91 } }; }
    return { status: 200, contentType: "application/json", bytes: new Uint8Array(), json: { audios: [Buffer.from("MP3DATA").toString("base64")] } };
  } };
  const sarvam = createSarvam({ baseUrl: "http://guard.stand-in", wire: wire as never });
  const t = await sarvam.transcribe({ bytes: NOTE, mime: "audio/ogg" }, ["hi", "en"]);
  assert.deepEqual(t, { text: "कल सुबह बुक करना", language: "hi", confidence: 0.91 });
  assert.equal(form!.get("model"), "saaras:v4");
  assert.equal(form!.get("language_code"), "unknown");
  assert.ok(form!.get("file") instanceof Blob);
  // a language the shop does not speak is not trusted; no probability is unknown, not zero
  const odd = createSarvam({ baseUrl: "http://guard.stand-in", wire: { async request() { return { status: 200, contentType: "", bytes: new Uint8Array(), json: { transcript: "x", language_code: "ta-IN" } }; } } as never });
  assert.deepEqual(await odd.transcribe({ bytes: NOTE, mime: "audio/ogg" }, ["hi"]), { text: "x", language: null, confidence: null });
  const spoken = await sarvam.synthesize("Namaste", "hi");
  assert.equal(Buffer.from(spoken.audio.bytes).toString(), "MP3DATA");
  assert.equal(spoken.audio.mime, "audio/mpeg");
  assert.equal(spoken.characters, 7);
});

test("Sarvam adapter: which models speak which languages (v3 speaks Malayalam, v4 Flash does not)", () => {
  assert.ok(createSarvam({ baseUrl: "http://g.stand-in" }).speaks.includes("ml"));
  assert.ok(!createSarvam({ baseUrl: "http://g.stand-in", ttsModel: "bulbul:v4-flash" }).speaks.includes("ml"));
});

test("media: Meta's two steps; only the path and query go to the download Guard; the lookup and download are the only requests", async () => {
  const m = mediaFor();
  const audio = await fetchAudio(m.source, { id: "MEDIA1" });
  assert.equal(audio.bytes.length, NOTE.length);
  assert.equal(audio.mime, "audio/ogg; codecs=opus");
  assert.deepEqual(m.lookup.requests, [{ method: "GET", path: "/v26.0/MEDIA1" }]);
  assert.deepEqual(m.download.requests, [{ method: "GET", path: "/whatsapp/audio", query: { mid: "MEDIA1", ext: "1" } }]);
});

test("media: an address on another host, over http, a bad id, an oversized or empty file are all refused", async () => {
  await assert.rejects(fetchAudio(mediaFor(NOTE, "evil.example").source, { id: "MEDIA1" }), /not on a host/u);
  await assert.rejects(fetchAudio(mediaFor().source, { id: "../etc/passwd" }), /usable media reference/u);
  await assert.rejects(fetchAudio(mediaFor().source, { url: "http://media.stand-in/whatsapp/audio" }), /not on a host/u);
  await assert.rejects(fetchAudio(mediaFor(new Uint8Array(0)).source, { id: "MEDIA1" }), /empty/u);
  const big = mediaFor(); big.lookup.requests.length = 0;
  const huge = scriptedWire({ "/v26.0/MEDIA1": { json: { url: "https://media.stand-in/x", file_size: String(MAX_AUDIO_BYTES + 1) } } });
  await assert.rejects(fetchAudio({ ...big.source, lookup: huge }, { id: "MEDIA1" }), /longer than the limit/u);
  // Gupshup: the callback carries the url itself, so there is no lookup
  const g = mediaFor();
  assert.equal((await fetchAudio(g.source, { url: "https://media.stand-in/whatsapp/audio?mid=1", mime: "audio/ogg" })).bytes.length, NOTE.length);
  assert.equal(g.lookup.requests.length, 0);
});

test("hear: a good note gives the words, the language, its length and its cost; the provider was asked once", async () => {
  const t = build();
  const heard = await t.voice.hear({ id: "MEDIA1" });
  assert.ok(heard.ok);
  if (heard.ok) { assert.equal(heard.text, "kal subah haircut book karna hai"); assert.equal(heard.language, "hi"); assert.ok(Math.abs(heard.seconds - 12) < 0.01); assert.equal(heard.costMicroInr, 120_000); assert.equal(heard.provider, "stand-in"); }
  assert.equal(t.speech.calls.length, 1);
});

test("hear: every failure is an answer and the provider is not asked when it should not be", async () => {
  const long = build({ bytes: fakeVoiceNote(45) });
  const tooLong = await long.voice.hear({ id: "MEDIA1" });
  assert.ok(!tooLong.ok && tooLong.reason === "too_long" && tooLong.costMicroInr === 0 && Math.abs(tooLong.seconds! - 45) < 0.01);
  assert.equal(long.speech.calls.length, 0, "too long: nothing sent to the provider");
  const mp3 = build({ bytes: new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0]) });
  assert.equal((await mp3.voice.hear({ id: "MEDIA1" })).ok, false);
  assert.equal(mp3.speech.calls.length, 0, "no readable length: not sent on, because it could not be priced");
  const down = build(); down.speech.nextTranscript = new Error("Sarvam answered 500");
  const r = await down.voice.hear({ id: "MEDIA1" });
  assert.ok(!r.ok && r.reason === "failed");
  const none = build({ speech: scriptedSpeech({ transcript: { text: "", language: "hi", confidence: 0.9 } }) });
  const low = await none.voice.hear({ id: "MEDIA1" });
  assert.ok(!low.ok && low.reason === "low_confidence" && low.costMicroInr === 120_000, "a note that was listened to and could not be used still cost something, and says so");
  const nomedia = build(); nomedia.m.download.requests.length = 0;
  const gone = await nomedia.voice.hear({ id: "NOPE" });
  assert.ok(!gone.ok && gone.reason === "failed");
});

test("hear: the day's limit is read from the caller's saved count; at the limit nothing is asked of the provider", async () => {
  const t = build({ notesPerDay: 2 });
  assert.equal((await t.voice.hear({ id: "MEDIA1" }, { notesToday: 0 })).ok, true);
  assert.equal((await t.voice.hear({ id: "MEDIA2" }, { notesToday: 1 })).ok, false, "MEDIA2 is not on the stand-in's table, so the fetch fails; the limit is not the reason");
  const third = await t.voice.hear({ id: "MEDIA3" }, { notesToday: 2 });
  assert.ok(!third.ok && third.reason === "daily_cap");
  assert.equal(t.speech.calls.length, 1);
});

test("hear and speak: the same note, or the same reply, asked again (a step run again after a Guard wait) is answered from memory with no second call and the same cost", async () => {
  const t = build();
  const first = await t.voice.hear({ id: "MEDIA1" });
  const again = await t.voice.hear({ id: "MEDIA1" });
  assert.deepEqual(again, first);
  assert.equal(t.speech.calls.filter((c) => c.kind === "transcribe").length, 1);
  assert.equal(t.m.lookup.requests.length, 1, "not even fetched twice");
  const a = await t.voice.speak("Your booking is confirmed.", "en");
  const b = await t.voice.speak("Your booking is confirmed.", "en");
  assert.deepEqual(b, a);
  assert.equal(t.speech.calls.filter((c) => c.kind === "synthesize").length, 1);
  // a failed fetch is not remembered (it may be transient and cost nothing)
  const failing = build();
  assert.ok(!(await failing.voice.hear({ id: "NOPE" })).ok);
  assert.ok(!(await failing.voice.hear({ id: "NOPE" })).ok);
  assert.equal(failing.m.lookup.requests.length, 2);
});

test("speak: links and payment addresses are not spoken; replies off, a language the model cannot speak, or nothing left give null with no call", async () => {
  const t = build();
  const spoke = await t.voice.speak("Your booking is confirmed. Pay here https://rzp.io/l/abc or upi://pay?pa=a@b today.", "en");
  assert.ok(spoke);
  assert.equal(t.speech.calls.at(-1)!.detail, "en Your booking is confirmed. Pay here or today.");
  assert.equal(spoke!.costMicroInr, ttsCostMicroInr(RATE, spoke!.characters));
  assert.ok(t.audio.files.has(spoke!.link));
  const off = build({ repliesOn: false });
  assert.equal(await off.voice.speak("hello", "en"), null);
  assert.equal(off.speech.calls.length, 0);
  const noMl = build({ speech: scriptedSpeech({ speaks: ["hi", "en"] }) });
  assert.equal(await noMl.voice.speak("ഹലോ", "ml"), null);
  assert.equal(noMl.speech.calls.length, 0);
  assert.equal(await t.voice.speak("https://only.a/link", "en"), null);
});

test("speak: a provider failure is null, not a throw; a long reply is cut at a sentence", async () => {
  const t = build();
  t.speech.synthesize = async () => { throw new Error("down"); };
  assert.equal(await t.voice.speak("hello", "en"), null);
  const sentence = "This is one sentence of the reply. ";
  const cut = spokenForm(sentence.repeat(30), 100);
  assert.ok(cut.length <= 100 && cut.endsWith("."), cut);
});

test("links: the folder host writes under a random name, serves mp3, and a sweep removes old ones and nothing else", async () => {
  const dir = mkdtempSync(join(tmpdir(), "voice-links-"));
  mkdirSync(join(dir, "report-page")); writeFileSync(join(dir, "report-page", "index.html"), "keep");
  const host = folderAudioHost({ dir, baseUrl: "https://pages.stand-in/", ttlMs: 600_000 });
  const link = await host({ bytes: new Uint8Array([1, 2, 3]), mime: "audio/mpeg" });
  assert.match(link!, /^https:\/\/pages\.stand-in\/voice-[0-9a-f]{32}\/reply\.mp3$/u);
  const folder = readdirSync(dir).find((n) => n.startsWith(FOLDER_PREFIX))!;
  assert.ok(existsSync(join(dir, folder, "reply.mp3")));
  assert.equal(await host({ bytes: new Uint8Array([1]), mime: "audio/wav" }), null, "a type WhatsApp does not play as audio is not served");
  const old = new Date(Date.now() - 3_600_000);
  utimesSync(join(dir, folder), old, old);
  assert.equal(sweepAudio(dir, Date.now(), 600_000), 1);
  assert.ok(!existsSync(join(dir, folder)));
  assert.ok(existsSync(join(dir, "report-page", "index.html")), "a report page is never touched");
});
