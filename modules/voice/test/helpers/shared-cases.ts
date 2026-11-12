// The voice-note cases every template must pass the same way (plan B29): Bookings, Orders and Fees each call `voiceCases` with their own harness. The harnesses differ in
// names; the behaviour under test does not: a voice note is read like typed text, the reply is also spoken, the cost is counted, a note that cannot be used gets the "could
// not make out" line (and the old line when voice is off), nobody is listened to who must not be, and the day's limit lives in the saved state.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createVoice } from "../../voice.ts";
import type { VoiceService } from "../../voice.ts";
import { fakeVoiceNote, scriptedSpeech, scriptedWire } from "../../standin.ts";
import { memoryAudioHost } from "../../links.ts";
import { sttCostMicroInr } from "../../speech.ts";
import { summarizeUsage } from "../../../../bundle/lib/usage.ts";

export const RATE = { sttInrPerMinute: 0.6, ttsInrPer1000Characters: 3 };
const SECONDS = 12;

interface Messaging { receive(from: string, text: string, o?: object): never; sentTo(n: string): { kind: string; text: string }[]; outbox(): unknown[] }
interface AnyWorld { messaging: Messaging; record: { entries(): { action: string; refs: Record<string, string>; outcome: string }[] }; agent: { handle(e: object): Promise<void> }; store: { ai?: { costMicroInr: number; speech?: { notes: number; replies: number; today?: number; day?: string } } }; clock: { now(): number }; owner: string; say(text: string, o?: { from?: string }): Promise<unknown> }

export interface Harness<W extends AnyWorld> {
  name: string;
  create(o: { voice?: VoiceService; ai?: object }): W;
  customer: string;
  /** A message every template answers with its menu. */
  greeting: string;
  /** What the shop says when voice is off. */
  offLine: (w: W) => string;
}

export function voiceCases<W extends AnyWorld>(h: Harness<W>): void {
  const make = (o: { transcript?: { text: string; language: "hi" | "en" | "ml" | "kn" | null; confidence: number | null }; ai?: object; notesPerDay?: number } = {}) => {
    const speech = scriptedSpeech({ transcript: o.transcript ?? { text: h.greeting, language: "en", confidence: 0.94 } });
    const lookup = scriptedWire({ "/v26.0/MEDIA1": { json: { url: "https://media.stand-in/audio", file_size: "300" } }, "/v26.0/MEDIA2": { json: { url: "https://media.stand-in/audio", file_size: "300" } } });
    const download = scriptedWire({ "/audio": { bytes: fakeVoiceNote(SECONDS), contentType: "audio/ogg" } });
    let w: W | undefined;
    const voice = createVoice({ provider: speech, media: { lookup, download, version: "v26.0", downloadHosts: ["media.stand-in"] }, host: memoryAudioHost().host, rate: RATE, languages: ["hi", "en", "ml", "kn"], clock: { now: () => w!.clock.now() }, repliesOn: true, ...(o.notesPerDay ? { notesPerDay: o.notesPerDay } : {}) });
    w = h.create({ voice, ...(o.ai ? { ai: o.ai } : {}) });
    return { w, speech };
  };
  const note = async (w: W, from = h.customer, id?: string, mediaId = "MEDIA1") => {
    const message = w.messaging.receive(from, "", { voiceNote: true, media: { id: mediaId, mime: "audio/ogg; codecs=opus" }, ...(id ? { id } : {}) });
    await w.agent.handle({ kind: "message", message });
  };

  test(`${h.name}: a voice note is read like typed text, the reply is also spoken, and the cost is counted once`, async () => {
    const typed = h.create({});
    await typed.say(h.greeting);
    const { w, speech } = make();
    await note(w);
    const sent = w.messaging.sentTo(h.customer);
    assert.deepEqual(sent.map((m) => m.kind), [...typed.messaging.sentTo(h.customer).map((m) => m.kind), "audio"]);
    assert.equal(sent[0].text, typed.messaging.sentTo(h.customer)[0].text, "the words are what the typed message gets");
    const received = w.record.entries().find((e) => e.action === "receive_message")!;
    assert.equal(received.refs.via, "voice");
    assert.equal(received.refs.speechSeconds, "12.0");
    const audio = w.record.entries().find((e) => e.refs?.audio === "voice")!;
    assert.equal(audio.outcome, "confirmed");
    assert.deepEqual(speech.calls.map((c) => c.kind), ["transcribe", "synthesize"]);
    const spent = w.store.ai!.costMicroInr;
    assert.equal(spent, sttCostMicroInr(RATE, SECONDS) + Math.ceil(RATE.ttsInrPer1000Characters * (Number(audio.refs.characters) / 1000) * 1_000_000 - 1e-9));
    assert.equal(summarizeUsage(w.record.entries() as never, {}).modelMicroInr, spent, "the cost meter and the allowance agree");
  });

  test(`${h.name}: a note that cannot be made out gets the could-not-make-out line in text only; with voice off the old line stays`, async () => {
    const { w, speech } = make({ transcript: { text: "", language: "hi", confidence: 0.1 } });
    await note(w);
    const texts = w.messaging.sentTo(h.customer);
    assert.equal(texts.length, 1);
    assert.equal(texts[0].kind, "text");
    assert.notEqual(texts[0].text, h.offLine(w), "voice is on: it does not say it cannot listen");
    assert.match(texts[0].text, /voice note|वॉइस|വോയ്|ವಾಯ್ಸ್/u);
    assert.deepEqual(speech.calls.map((c) => c.kind), ["transcribe"]);
    const off = h.create({});
    const message = off.messaging.receive(h.customer, "", { voiceNote: true, media: { id: "MEDIA1" } });
    await off.agent.handle({ kind: "message", message });
    assert.equal(off.messaging.sentTo(h.customer)[0].text, h.offLine(off), "voice off: exactly the line it always was");
    assert.equal(off.store.ai, undefined);
  });

  test(`${h.name}: no listening for the owner, after STOP, in button mode or under the AI cap`, async () => {
    const owner = make(); await note(owner.w, owner.w.owner); assert.equal(owner.speech.calls.length, 0);
    const stop = make(); await stop.w.say("STOP"); const before = stop.w.messaging.outbox().length; await note(stop.w); assert.equal(stop.speech.calls.length, 0); assert.equal(stop.w.messaging.outbox().length, before);
    const buttons = make({ ai: { override: () => "buttons" } }); await note(buttons.w); assert.equal(buttons.speech.calls.length, 0);
    const capped = make({ ai: { model: () => "off" } }); await note(capped.w); assert.equal(capped.speech.calls.length, 0);
  });

  test(`${h.name}: the day's limit is in the saved state, so it holds after a restart`, async () => {
    const { w, speech } = make({ notesPerDay: 1 });
    await note(w, h.customer, "wamid.a");
    assert.equal(w.store.ai!.speech!.today, 1);
    // a restart reads the saved state back: the count comes with it
    const reread = JSON.parse(JSON.stringify(w.store.ai));
    assert.equal(reread.speech.today, 1);
    assert.equal(reread.speech.day, w.store.ai!.speech!.day);
    await note(w, h.customer, "wamid.b", "MEDIA2"); // a different note (the same note asked again is answered from memory)
    assert.equal(speech.calls.filter((c) => c.kind === "transcribe").length, 1, "the second note did not reach the provider");
    assert.equal(w.record.entries().filter((e) => e.refs?.voice === "daily_cap").length, 1);
  });
}
