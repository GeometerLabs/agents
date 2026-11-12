// Voice notes for Bookings (plan B29, decision 42) with stand-ins only: no account, no network. A voice note is turned into the words it says and then read exactly like a
// typed message; the reply is text only (the owner chose to listen in voice and reply in text); the cost is in the month's AI spend and in the cost meter's number; and every case that must not
// ask the speech provider (voice off, the owner, STOP, button mode, the AI cap) gets the existing line with the provider untouched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CUSTOMER, createWorld } from "../src/harness.ts";
import type { World } from "../src/harness.ts";
import { createVoice } from "../../../../modules/voice/voice.ts";
import type { VoiceService } from "../../../../modules/voice/voice.ts";
import { fakeVoiceNote, scriptedSpeech, scriptedWire } from "../../../../modules/voice/standin.ts";
import { sttCostMicroInr } from "../../../../modules/voice/speech.ts";
import { summarizeUsage } from "../../../../bundle/lib/usage.ts";
import { parseWhatsAppWebhook } from "../../../../modules/messaging/webhooks.ts";
import { checkEvents } from "../server/events.ts";
import { TEMPLATES } from "../src/language/templates.ts";
import { parseSettings } from "../src/settings.ts";
import { parseStore, serializeStore } from "../server/snapshot.ts";
import { readFileSync } from "node:fs";
import { createAudioDrop } from "../../../../modules/channels/owner-audio.ts";

// The builder's price for the tests only (never a real provider's price; the real one is the builder's setting).
const RATE = { sttInrPerMinute: 0.6 };
const SECONDS = 12;

function voiceWorld(o: { transcript?: { text: string; language: "hi" | "en" | "ml" | "kn" | null; confidence: number | null }; ai?: import("../../../../modules/understanding/ai-state.ts").AiPolicy; bytes?: Uint8Array; settings?: import("../src/settings.ts").Settings; pageAudio?: (ref: string) => import("../../../../modules/voice/turn.ts").PageAudio | undefined } = {}) {
  const speech = scriptedSpeech({ transcript: o.transcript ?? { text: "hello", language: "en", confidence: 0.94 } });
  const lookup = scriptedWire({ "/v26.0/MEDIA1": { json: { url: "https://media.stand-in/audio?mid=1", mime_type: "audio/ogg; codecs=opus", file_size: "300" } } });
  const download = scriptedWire({ "/audio": { bytes: o.bytes ?? fakeVoiceNote(SECONDS), contentType: "audio/ogg" } });
  let world: World | undefined;
  const voice: VoiceService = createVoice({
    provider: speech, media: { lookup, download, version: "v26.0", downloadHosts: ["media.stand-in"] }, rate: RATE, languages: ["hi", "en", "ml", "kn"],
    clock: { now: () => world!.clock.now() },
  });
  world = createWorld({ voice, ...(o.ai ? { ai: o.ai } : {}), ...(o.settings ? { settings: o.settings } : {}), ...(o.pageAudio ? { pageAudio: o.pageAudio } : {}) });
  return { w: world, speech, lookup, download };
}
/** The customer sends a voice note: the message the inbox would forward (voice on: it carries where the audio is). */
async function sendNote(w: World, from = CUSTOMER) {
  const message = w.messaging.receive(from, "", { voiceNote: true, media: { id: "MEDIA1", mime: "audio/ogg; codecs=opus" } });
  await w.agent.handle({ kind: "message", message });
  return message;
}
const kinds = (w: World, to = CUSTOMER) => w.messaging.sentTo(to).map((m) => m.kind);

test("a voice note is read like typed text: exactly the reply the typed words get, in text only; the record says it came by voice", async () => {
  const typed = createWorld();
  await typed.say("hello");
  const { w, speech } = voiceWorld();
  await sendNote(w);
  const sent = w.messaging.sentTo(CUSTOMER);
  assert.deepEqual(sent.map((m) => m.kind), typed.messaging.sentTo(CUSTOMER).map((m) => m.kind), "no audio, ever");
  assert.equal(sent[0].text, typed.messaging.sentTo(CUSTOMER)[0].text, "the words are exactly what a typed 'hello' gets");
  assert.deepEqual(speech.calls.map((c) => c.kind), ["transcribe"]);
  const received = w.record.entries().find((e) => e.action === "receive_message")!;
  const typedReceived = typed.record.entries().find((e) => e.action === "receive_message")!;
  assert.equal(received.refs!.via, "voice");
  assert.equal(received.refs!.speechProvider, "stand-in");
  assert.equal(received.refs!.speechSeconds, "12.0");
  assert.equal(received.refs!.step, typedReceived.refs!.step, "read by the same step as the typed message");
  assert.ok(Object.keys(typedReceived.refs!).every((k) => k in received.refs!), "it keeps everything typed text keeps");
});

test("the cost of listening is in the month's AI spend and in the cost meter's model spend, once", async () => {
  const { w } = voiceWorld();
  await sendNote(w);
  const listen = sttCostMicroInr(RATE, SECONDS);
  assert.equal(w.store.ai!.costMicroInr, listen, "the allowance sees it");
  assert.equal(w.store.ai!.speech!.notes, 1);
  assert.equal(w.store.ai!.speech!.today, 1);
  const usage = summarizeUsage(w.record.entries(), {});
  assert.equal(usage.modelMicroInr, listen, "fleet's AI cap reads this number");
  assert.equal(usage.messages, 1, "one customer message, not two");
});

test("a note that cannot be made out gets the existing line, in text only, and the call that was made is still counted", async () => {
  const { w, speech } = voiceWorld({ transcript: { text: "", language: "hi", confidence: 0.2 } });
  await sendNote(w);
  assert.deepEqual(w.messaging.sentTo(CUSTOMER).map((m) => [m.kind, m.text]), [["text", TEMPLATES.hi.voice_note_retry({} as never)]]);
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
  assert.equal(c.w.messaging.sentTo(CUSTOMER).filter((m) => m.kind === "text").map((m) => m.text)[0], TEMPLATES.hi.voice_note_retry({} as never));
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

test("the language they spoke is the language of the reply when their words do not say", async () => {
  const { w } = voiceWorld({ transcript: { text: "zzz qqq", language: "ml", confidence: 0.9 } });
  await sendNote(w);
  assert.equal(w.store.customers.get(CUSTOMER)!.language, "ml");
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

// ---- the seams the first tests did not touch ----------------------------------------------------------------------------------

test("the month's voice counts and cost survive a restart: the saved state round-trips, and a store from before voice loads", async () => {
  const { w } = voiceWorld();
  await sendNote(w);
  const back = parseStore(serializeStore(w.store));
  assert.deepEqual(back.ai!.speech, w.store.ai!.speech);
  assert.equal(back.ai!.speech!.today, 1, "the day's count comes back with it");
  assert.equal(back.ai!.costMicroInr, w.store.ai!.costMicroInr);
  const older = JSON.parse(serializeStore(w.store)); delete older.ai.speech;
  assert.equal(parseStore(JSON.stringify(older)).ai!.speech, undefined);
  assert.equal(serializeStore(createWorld().store).includes("speech"), false, "a shop with voice off saves the same bytes as before");
});

test("a voice note that says 'I paid' on a UPI shop is recorded as voice, with its cost, ", async () => {
  const upi = parseSettings(JSON.parse(readFileSync(new URL("../settings/glow-salon-upi.example.json", import.meta.url), "utf8")));
  const speech = scriptedSpeech({ transcript: { text: "I have paid", language: "en", confidence: 0.95 } });
  const m = (() => { const lookup = scriptedWire({ "/v26.0/MEDIA1": { json: { url: "https://media.stand-in/audio", file_size: "300" } } }); const download = scriptedWire({ "/audio": { bytes: fakeVoiceNote(SECONDS), contentType: "audio/ogg" } }); return { lookup, download }; })();
  let world: World | undefined;
  const voice = createVoice({ provider: speech, media: { ...m, version: "v26.0", downloadHosts: ["media.stand-in"] }, rate: RATE, languages: ["hi", "en"], clock: { now: () => world!.clock.now() }});
  world = createWorld({ settings: upi, voice });
  await world.say("haircut tomorrow at 6pm");
  await sendNote(world);
  const claim = world.record.entries().filter((e) => e.action === "receive_message").at(-1)!;
  assert.equal(claim.refs!.via, "voice");
  assert.equal(claim.refs!.costMicroInr, String(sttCostMicroInr(RATE, SECONDS)), "the meter sees the listening");
  assert.ok(world.messaging.sentTo(CUSTOMER).every((x) => x.kind !== "audio"), "and the reply is text");
  assert.equal(summarizeUsage(world.record.entries(), {}).modelMicroInr >= sttCostMicroInr(RATE, SECONDS), true);
});


// ---- the owner's voice notes with the shop's assistant (B29 with item 11e) ----------------------------------------------------------------------------------
const withAssistant = () => parseSettings({ ...JSON.parse(readFileSync(new URL("../settings/glow-salon.example.json", import.meta.url), "utf8")), assistant: {} });

test("with the assistant, the owner's voice note is heard and read like their typed words: \"close tomorrow\" closes the day; the cost is in the month's spend and on an owner_assistant line", async () => {
  const { w, speech } = voiceWorld({ settings: withAssistant(), transcript: { text: "close tomorrow", language: "en", confidence: 0.95 } });
  await sendNote(w, w.owner);
  assert.equal(speech.calls.length, 1, "the owner is listened to when the shop has the assistant");
  assert.deepEqual(w.store.assistant?.closedDays, ["2026-11-04"], "the spoken words did what the typed words do");
  assert.match(w.lastTextTo(w.owner), /^Closed Wed 4 Nov\./u, "the answer is text");
  const listen = sttCostMicroInr(RATE, SECONDS);
  const heard = w.record.entries().find((e) => e.action === "owner_assistant" && e.refs.intent === "voice_note")!;
  assert.ok(heard, "the hearing is on an owner_assistant line");
  assert.deepEqual([heard.outcome, heard.refs.via, heard.refs.costMicroInr, heard.refs.step], ["confirmed", "voice", String(listen), "rules"]);
  assert.ok(!JSON.stringify(heard).includes("close tomorrow"), "the owner's words are not kept on the line");
  assert.equal(w.store.ai!.costMicroInr, listen, "the month's AI spend has it");
  assert.equal(w.store.ai!.speech!.notes, 1, "and the day's count of notes");
  const usage = summarizeUsage(w.record.entries(), {});
  assert.equal(usage.modelMicroInr, listen, "the cost meter counts it as the shop's AI spend");
  assert.equal(usage.messages, 0, "an owner's note is never counted as a customer message");
});

test("a spoken fixed phrase goes through the fixed phrases first, and its cost is still on the owner_assistant line", async () => {
  const { w } = voiceWorld({ settings: withAssistant(), transcript: { text: "today", language: "en", confidence: 0.95 } });
  await sendNote(w, w.owner);
  assert.equal(w.lastTextTo(w.owner), "No bookings today.", "the fixed \"today\" answered it");
  assert.deepEqual(w.record.entries().filter((e) => e.action === "owner_assistant").map((e) => e.refs.intent), ["voice_note"], "the assistant did not read it: only the hearing is on its line");
  assert.equal(summarizeUsage(w.record.entries(), {}).modelMicroInr, sttCostMicroInr(RATE, SECONDS));
});

test("the owner keeps the \"please type\" line, with no listening, when voice is off, when the assistant is off, and in button mode", async () => {
  const line = TEMPLATES.en.voice_note({} as never);
  // voice off, assistant on
  const off = createWorld({ settings: withAssistant() });
  await off.agent.handle({ kind: "message", message: off.messaging.receive(off.owner, "", { voiceNote: true, media: { id: "MEDIA1" } }) });
  assert.equal(off.lastTextTo(off.owner), line);
  // voice on, assistant off
  const plain = voiceWorld();
  await sendNote(plain.w, plain.w.owner);
  assert.equal(plain.speech.calls.length, 0);
  assert.equal(plain.w.lastTextTo(plain.w.owner), line);
  // button mode, with both on: voice is model spend, so it stops with the rest
  const buttons = voiceWorld({ settings: withAssistant(), ai: { override: () => "buttons" } });
  await sendNote(buttons.w, buttons.w.owner);
  assert.equal(buttons.speech.calls.length, 0);
  assert.equal(buttons.w.lastTextTo(buttons.w.owner), line);
});

test("an owner's note that cannot be made out: they are asked to type it, and the call made is counted", async () => {
  const { w, speech } = voiceWorld({ settings: withAssistant(), transcript: { text: "", language: "en", confidence: 0.2 } });
  await sendNote(w, w.owner);
  assert.equal(speech.calls.length, 1);
  assert.equal(w.lastTextTo(w.owner), "I couldn't make out that voice note. Please type it.");
  assert.deepEqual(w.store.assistant?.closedDays ?? [], []);
  assert.equal(summarizeUsage(w.record.entries(), {}).modelMicroInr, sttCostMicroInr(RATE, SECONDS));
});

test("a recording from the owner's page (items 11d and 11e): heard from memory by the same listener, read by the assistant, answered on the page; gone after a restart, the owner is asked to type", async () => {
  const drop = createAudioDrop({ now: () => Date.UTC(2026, 10, 3, 4, 30) });
  const ref = drop.put(fakeVoiceNote(SECONDS), "audio/ogg; codecs=opus");
  const { w, speech, lookup, download } = voiceWorld({ settings: withAssistant(), transcript: { text: "close tomorrow", language: "en", confidence: 0.95 }, pageAudio: (r) => drop.get(r) });
  const toOwner = w.messaging.sentTo(w.owner).length;
  await w.agent.handle({ kind: "owner_message", id: "page-voice-1", text: "", voice: ref });
  assert.equal(speech.calls.length, 1, "listened to once");
  assert.equal(lookup.requests.length + download.requests.length, 0, "the audio was in hand: nothing fetched from WhatsApp");
  assert.deepEqual(w.store.assistant?.closedDays, ["2026-11-04"]);
  assert.deepEqual(w.store.assistant!.talk.map((l) => [l.from, l.text.split(".")[0]]), [["owner", "close tomorrow"], ["assistant", "Closed Wed 4 Nov"]], "the words and the answer are on the page");
  assert.equal(w.messaging.sentTo(w.owner).length, toOwner, "nothing to the owner's WhatsApp");
  assert.equal(summarizeUsage(w.record.entries(), {}).modelMicroInr, sttCostMicroInr(RATE, SECONDS), "the cost is counted as for a WhatsApp note");
  assert.ok(!JSON.stringify(w.store).includes("OggS"), "the audio is nowhere in the saved state");
  // a recording the runtime no longer holds (a restart): nothing is listened to, the owner is asked to type
  await w.agent.handle({ kind: "owner_message", id: "page-voice-2", text: "", voice: "not-held" });
  assert.equal(speech.calls.length, 1);
  assert.equal(w.store.assistant!.talk.at(-1)?.text, "I couldn't make out that voice note. Please type it.");
});
