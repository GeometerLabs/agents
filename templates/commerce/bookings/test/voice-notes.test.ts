// Voice notes for Bookings (plan B29, decision 42) with stand-ins only: no account, no network. A voice note is turned into the words it says and then read exactly like a
// typed message; the reply goes as text and as a spoken audio message; the cost is in the month's AI spend and in the cost meter's number; and every case that must not
// ask the speech provider (voice off, the owner, STOP, button mode, the AI cap) gets the existing line with the provider untouched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CUSTOMER, createWorld } from "../src/harness.ts";
import type { World } from "../src/harness.ts";
import { createVoice } from "../../../../modules/voice/voice.ts";
import type { VoiceService } from "../../../../modules/voice/voice.ts";
import { fakeVoiceNote, scriptedSpeech, scriptedWire } from "../../../../modules/voice/standin.ts";
import { memoryAudioHost } from "../../../../modules/voice/links.ts";
import { sttCostMicroInr, ttsCostMicroInr } from "../../../../modules/voice/speech.ts";
import { summarizeUsage } from "../../../../bundle/lib/usage.ts";
import { parseWhatsAppWebhook } from "../../../../modules/messaging/webhooks.ts";
import { checkEvents } from "../server/events.ts";
import { TEMPLATES } from "../src/language/templates.ts";

// The builder's price for the tests only (never a real provider's price; the real one is the builder's setting).
const RATE = { sttInrPerMinute: 0.6, ttsInrPer1000Characters: 3 };
const SECONDS = 12;

function voiceWorld(o: { transcript?: { text: string; language: "hi" | "en" | "ml" | "kn" | null; confidence: number | null }; repliesOn?: boolean; ai?: import("../../../../modules/understanding/ai-state.ts").AiPolicy; bytes?: Uint8Array } = {}) {
  const speech = scriptedSpeech({ transcript: o.transcript ?? { text: "hello", language: "en", confidence: 0.94 } });
  const lookup = scriptedWire({ "/v26.0/MEDIA1": { json: { url: "https://media.stand-in/audio?mid=1", mime_type: "audio/ogg; codecs=opus", file_size: "300" } } });
  const download = scriptedWire({ "/audio": { bytes: o.bytes ?? fakeVoiceNote(SECONDS), contentType: "audio/ogg" } });
  const hosted = memoryAudioHost();
  let world: World | undefined;
  const voice: VoiceService = createVoice({
    provider: speech, media: { lookup, download, version: "v26.0", downloadHosts: ["media.stand-in"] }, host: hosted.host, rate: RATE, languages: ["hi", "en", "ml", "kn"],
    clock: { now: () => world!.clock.now() }, repliesOn: o.repliesOn ?? true,
  });
  world = createWorld({ voice, ...(o.ai ? { ai: o.ai } : {}) });
  return { w: world, speech, lookup, download, hosted };
}
/** The customer sends a voice note: the message the inbox would forward (voice on: it carries where the audio is). */
async function sendNote(w: World, from = CUSTOMER) {
  const message = w.messaging.receive(from, "", { voiceNote: true, media: { id: "MEDIA1", mime: "audio/ogg; codecs=opus" } });
  await w.agent.handle({ kind: "message", message });
  return message;
}
const kinds = (w: World, to = CUSTOMER) => w.messaging.sentTo(to).map((m) => m.kind);

test("a voice note is read like typed text: the same reply as the typed words, then the same words spoken; the record says it came by voice", async () => {
  const typed = createWorld();
  await typed.say("hello");
  const { w, speech, hosted } = voiceWorld();
  await sendNote(w);
  const sent = w.messaging.sentTo(CUSTOMER);
  assert.deepEqual(sent.map((m) => m.kind), [...typed.messaging.sentTo(CUSTOMER).map((m) => m.kind), "audio"], "the typed reply, then one spoken copy");
  assert.equal(sent[0].text, typed.messaging.sentTo(CUSTOMER)[0].text, "the words are exactly what a typed 'hello' gets");
  assert.ok(hosted.files.has(sent.at(-1)!.audio!.link), "the audio is at an https address the host serves");
  assert.deepEqual(speech.calls.map((c) => c.kind), ["transcribe", "synthesize"]);
  const received = w.record.entries().find((e) => e.action === "receive_message")!;
  const typedReceived = typed.record.entries().find((e) => e.action === "receive_message")!;
  assert.equal(received.refs!.via, "voice");
  assert.equal(received.refs!.speechProvider, "stand-in");
  assert.equal(received.refs!.speechSeconds, "12.0");
  assert.equal(received.refs!.step, typedReceived.refs!.step, "read by the same step as the typed message");
  assert.ok(Object.keys(typedReceived.refs!).every((k) => k in received.refs!), "it keeps everything typed text keeps");
  const audioEntry = w.record.entries().find((e) => e.refs?.audio === "voice")!;
  assert.equal(audioEntry.outcome, "confirmed");
  assert.equal(audioEntry.action, "send_message");
});

test("the cost is in the month's AI spend and in the cost meter's model spend, once each: listening and speaking", async () => {
  const { w } = voiceWorld();
  await sendNote(w);
  const spoken = w.messaging.sentTo(CUSTOMER).at(-1)!;
  const listen = sttCostMicroInr(RATE, SECONDS);
  const speak = ttsCostMicroInr(RATE, Number(w.record.entries().find((e) => e.refs?.audio === "voice")!.refs!.characters));
  assert.ok(spoken.audio);
  assert.equal(w.store.ai!.costMicroInr, listen + speak, "the allowance sees both");
  assert.deepEqual(w.store.ai!.speech, { notes: 1, replies: 1 });
  const usage = summarizeUsage(w.record.entries(), {});
  assert.equal(usage.modelMicroInr, listen + speak, "fleet's AI cap reads this number");
  assert.equal(usage.messages, 1, "one customer message, not two");
  assert.equal(usage.repliesByLanguage && Object.values(usage.repliesByLanguage).reduce((a, b) => a + b, 0), 1, "the spoken copy is not a second reply");
});

test("a note that cannot be made out gets the existing line, in text only, and the call that was made is still counted", async () => {
  const { w, speech } = voiceWorld({ transcript: { text: "", language: "hi", confidence: 0.2 } });
  await sendNote(w);
  assert.deepEqual(w.messaging.sentTo(CUSTOMER).map((m) => [m.kind, m.text]), [["text", TEMPLATES.hi.voice_note({} as never)]]);
  assert.deepEqual(speech.calls.map((c) => c.kind), ["transcribe"]);
  const entry = w.record.entries().find((e) => e.action === "receive_message")!;
  assert.equal(entry.refs!.voice, "low_confidence");
  assert.equal(entry.refs!.costMicroInr, String(sttCostMicroInr(RATE, SECONDS)));
  assert.equal(w.store.ai!.costMicroInr, sttCostMicroInr(RATE, SECONDS));
  assert.equal(summarizeUsage(w.record.entries(), {}).modelMicroInr, sttCostMicroInr(RATE, SECONDS));
});

test("no call to the speech provider when it must not be made: the owner, STOP, button mode, the AI cap", async () => {
  // the owner's voice note is a command and is typed: the existing line, no listening
  const a = voiceWorld();
  await sendNote(a.w, a.w.owner);
  assert.equal(a.speech.calls.length, 0);
  assert.equal(a.w.messaging.sentTo(a.w.owner).length, 1, "the owner got the one line");
  // STOP
  const b = voiceWorld();
  await b.w.say("STOP");
  const before = b.w.messaging.outbox().length;
  await sendNote(b.w);
  assert.equal(b.speech.calls.length, 0);
  assert.equal(b.w.messaging.outbox().length, before);
  // button mode (set from outside) and the AI cap (model off): voice is model spend, so it stops with the rest
  const c = voiceWorld({ ai: { override: () => "buttons" } });
  await sendNote(c.w);
  assert.equal(c.speech.calls.length, 0);
  assert.equal(c.w.messaging.sentTo(CUSTOMER).filter((m) => m.kind === "text").map((m) => m.text)[0], TEMPLATES.hi.voice_note({} as never));
  const d = voiceWorld({ ai: { model: () => "off" } });
  await sendNote(d.w);
  assert.equal(d.speech.calls.length, 0);
  assert.equal(d.lookup.requests.length + d.download.requests.length, 0, "not even the audio was fetched");
});

test("voice off (no voice service) is exactly as before: the line, no media asked for, nothing spoken", async () => {
  const w = createWorld();
  const message = w.messaging.receive(CUSTOMER, "", { voiceNote: true, media: { id: "MEDIA1" } });
  await w.agent.handle({ kind: "message", message });
  assert.deepEqual(w.messaging.sentTo(CUSTOMER).map((m) => [m.kind, m.text]), [["text", TEMPLATES.hi.voice_note({} as never)]]);
  assert.equal(w.store.ai, undefined, "no AI state was even created");
});

test("replies turned off: the note is listened to and the reply is text only", async () => {
  const { w, speech } = voiceWorld({ repliesOn: false });
  await sendNote(w);
  assert.ok(!kinds(w).includes("audio"));
  assert.deepEqual(speech.calls.map((c) => c.kind), ["transcribe"]);
});

test("a spoken copy that WhatsApp refuses changes nothing: the words were sent, and the record says the audio failed", async () => {
  const { w } = voiceWorld();
  w.messaging.inject("sendAudio", "error");
  await sendNote(w);
  assert.ok(kinds(w).includes("interactive") || kinds(w).includes("text"));
  assert.ok(!kinds(w).includes("audio"));
  const entry = w.record.entries().find((e) => e.refs?.audio === "voice")!;
  assert.equal(entry.outcome, "failed");
  assert.equal(w.store.ai!.speech!.replies, 1, "the provider was paid for the audio it made");
});

test("only the turn that answers a voice note is spoken: a typed message afterwards gets text only", async () => {
  const { w, speech } = voiceWorld();
  await sendNote(w);
  const spoken = speech.calls.filter((c) => c.kind === "synthesize").length;
  await w.say("hello");
  assert.equal(speech.calls.filter((c) => c.kind === "synthesize").length, spoken);
});

test("the language they spoke is the language of the reply when their words do not say", async () => {
  const { w, speech } = voiceWorld({ transcript: { text: "zzz qqq", language: "ml", confidence: 0.9 } });
  await sendNote(w);
  assert.equal(w.store.customers.get(CUSTOMER)!.language, "ml");
  assert.ok(speech.calls.some((c) => c.kind === "synthesize" && c.detail.startsWith("ml ")));
});

test("the inbox carries where the audio is only when voice is on, and the runtime's event check accepts only that shape", () => {
  const hook = { entry: [{ changes: [{ field: "messages", value: { messages: [{ from: "919811111111", id: "wamid.n", timestamp: "1", type: "audio", audio: { id: "MEDIA1", mime_type: "audio/ogg; codecs=opus", sha256: "abc", voice: true, url: "https://files.stand-in/a?x=1" } }] } }] }] };
  assert.deepEqual(parseWhatsAppWebhook(hook).map((m) => m.media), [undefined]);
  assert.deepEqual(parseWhatsAppWebhook(hook, { voiceMedia: true })[0].media, { id: "MEDIA1", url: "https://files.stand-in/a?x=1", mime: "audio/ogg; codecs=opus" });
  const bad = { ...hook, entry: [{ changes: [{ field: "messages", value: { messages: [{ from: "919811111111", id: "wamid.n", timestamp: "1", type: "audio", audio: { id: "../x", url: "http://insecure/a" } }] } }] }] };
  assert.equal(parseWhatsAppWebhook(bad, { voiceMedia: true })[0].media, undefined, "an id that could change a path and a plain-http address are dropped");
  const ok = checkEvents({ events: [{ kind: "message", message: { id: "m", from: "+91", text: "", timestamp: 1, voiceNote: true, media: { id: "MEDIA1" } } }] });
  assert.ok(ok.ok);
  for (const media of [{ id: "../x" }, { url: "http://x" }, { id: "a", extra: 1 }, {}, "x"]) {
    assert.ok(!checkEvents({ events: [{ kind: "message", message: { id: "m", from: "+91", text: "", timestamp: 1, voiceNote: true, media } }] }).ok, JSON.stringify(media));
  }
  assert.ok(!checkEvents({ events: [{ kind: "message", message: { id: "m", from: "+91", text: "hi", timestamp: 1, media: { id: "MEDIA1" } } }] }).ok, "media is only for a voice note");
});
