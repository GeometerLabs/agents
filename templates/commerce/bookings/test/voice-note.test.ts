// A voice note gets one plain reply (until the voice module, plan B29, exists): "Sorry, I can't listen to voice notes yet. Could you type your message?"
// These tests follow it the whole way: Meta's webhook body -> the inbox's reader -> the runtime's event check -> the saved task -> the agent ->
// the customer's chat and the record -> the monthly report. The audio itself is never fetched, kept or recorded.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWhatsAppWebhook } from "../../../../modules/messaging/webhooks.ts";
import type { InboundMessage } from "../../../../modules/messaging/messaging.ts";
import { CUSTOMER, OTHER_CUSTOMER, createWorld } from "../src/harness.ts";
import { TEMPLATES } from "../src/language/templates.ts";
import { WORDS } from "../../../../modules/language/words.ts";
import { parseSettings } from "../src/settings.ts";
import { LANGUAGES } from "../../../../modules/language/languages.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import { buildMonthlyReport } from "../report/data.ts";
import { monthRange } from "../../../../modules/report/months.ts";
import { ownerText } from "../report/text.ts";
import { checkEvents, eventKey } from "../server/events.ts";
import { startServer } from "../server/server.ts";
import { fixture } from "./helpers/scripted-server.ts";
import { createKit } from "./runtime-kit.ts";

const LINE: Record<Language, string> = {
  en: "Sorry, I can't listen to voice notes yet. Could you type your message?",
  hi: "माफ़ कीजिए, मैं अभी वॉइस नोट नहीं सुन सकता। क्या आप लिखकर भेज देंगे?",
  ml: "ക്ഷമിക്കണം, വോയ്സ് നോട്ട് ഇപ്പോൾ കേൾക്കാൻ പറ്റില്ല. ടൈപ്പ് ചെയ്ത് അയക്കാമോ?",
  kn: "ಕ್ಷಮಿಸಿ, ನನಗೆ ಇನ್ನೂ ವಾಯ್ಸ್ ನೋಟ್ ಕೇಳಲು ಆಗುವುದಿಲ್ಲ. ದಯವಿಟ್ಟು ಟೈಪ್ ಮಾಡಿ ಕಳುಹಿಸುತ್ತೀರಾ?",
}
/** What Meta puts in an audio message besides who and when. None of it may travel on. */
const MEDIA = { id: "MEDIA-ID-1623525315162", mime_type: "audio/ogg; codecs=opus", sha256: "MEDIA-SHA-9f86d081884c7d659a2feaa0c55ad015", voice: true };

/** A signed-looking WhatsApp webhook body with the given messages, built from the text-message sample so the envelope is a real one. */
function webhookWith(...messages: Record<string, unknown>[]) {
  const hook = fixture("whatsapp-webhook-text.json");
  hook.entry[0].changes[0].value.messages = messages;
  return hook;
}
const audio = (id: string, from: string, audioObject: Record<string, unknown> = MEDIA) => ({ from, id, timestamp: "1749416383", type: "audio", audio: audioObject });

/** The message a voice note becomes inside the agent: the harness's own `receive` opens the 24-hour window, like the real thing. */
const voiceNote = (w: ReturnType<typeof createWorld>, from = CUSTOMER, id?: string): InboundMessage => ({ ...w.messaging.receive(from, "", id ? { id } : {}), voiceNote: true });
const hear = (w: ReturnType<typeof createWorld>, message: InboundMessage) => w.agent.handle({ kind: "message", message });

// ---- reading the webhook ---------------------------------------------------------------------------------------------------

test("a voice note, and an audio file, are read as a message with no words and voiceNote true; none of the audio's own details come with it", () => {
  const read = parseWhatsAppWebhook(webhookWith(audio("wamid.note", "919811111111"), audio("wamid.file", "919822222222", { ...MEDIA, voice: false }), audio("wamid.plain", "919833333333", { id: "1", mime_type: "audio/mpeg" })));
  assert.deepEqual(read, [
    { id: "wamid.note", from: "+919811111111", text: "", timestamp: 1749416383000, voiceNote: true },
    { id: "wamid.file", from: "+919822222222", text: "", timestamp: 1749416383000, voiceNote: true },
    { id: "wamid.plain", from: "+919833333333", text: "", timestamp: 1749416383000, voiceNote: true },
  ]);
  const wire = JSON.stringify(read);
  for (const leaked of ["MEDIA", "ogg", "mpeg", "sha256", "mime", "audio"]) assert.ok(!wire.includes(leaked), `${leaked} must not travel on`);
});

test("the text path is unchanged (no voiceNote key at all), locations, stickers and a broken audio message are still left out; a picture is only the fact of it (B33)", () => {
  const text = parseWhatsAppWebhook(fixture("whatsapp-webhook-text.json"));
  assert.equal(text.length, 1);
  assert.ok(!("voiceNote" in text[0]), "a text message does not carry the flag");
  assert.deepEqual(parseWhatsAppWebhook(webhookWith({ from: "919811111111", id: "wamid.i", timestamp: "1", type: "image", image: { id: "1" } })).map((m) => [m.text, m.image, m.voiceNote]), [["", true, undefined]]);
  const left = parseWhatsAppWebhook(webhookWith(
    { from: "919811111111", id: "wamid.l", timestamp: "1", type: "location", location: { latitude: 1, longitude: 2 } },
    { from: "919811111111", id: "wamid.s", timestamp: "1", type: "sticker", sticker: { id: "1" } },
    { from: "919811111111", id: "wamid.v", timestamp: "1", type: "video", video: { id: "1" } },
    { ...audio("wamid.noid", "919811111111"), id: undefined },
    audio("wamid.nosender", "not-a-number"),
  ));
  assert.deepEqual(left, []);
  // in one webhook a text and a voice note keep their order
  const both = parseWhatsAppWebhook(webhookWith({ from: "919811111111", id: "wamid.t", timestamp: "2", type: "text", text: { body: "hello" } }, audio("wamid.a", "919811111111")));
  assert.deepEqual(both.map((m) => [m.id, m.text, m.voiceNote]), [["wamid.t", "hello", undefined], ["wamid.a", "", true]]);
});

// ---- the runtime's event check --------------------------------------------------------------------------------------------

test("the event check accepts a voice note and keeps the flag; the key is the message id, so a redelivery is the same event; bad input is still refused", () => {
  const event = { kind: "message", message: { id: "wamid.note", from: "+919811111111", text: "", timestamp: 1749416383000, voiceNote: true } };
  const checked = checkEvents({ events: [event] });
  assert.ok(checked.ok);
  assert.deepEqual(checked.ok && checked.events, [event]);
  assert.equal(eventKey(event as never), "message:wamid.note");
  // a text message is rebuilt exactly as before, with no flag
  const text = checkEvents({ events: [{ kind: "message", message: { id: "m", from: "+91", text: "hello", timestamp: 1, voiceNote: undefined } }] });
  assert.ok(text.ok && !("voiceNote" in (text.events[0] as { message: object }).message));
  // anything but the boolean true is a mistake, and so is a voice note that carries words
  for (const voiceNote of ["true", 1, false, null, {}]) {
    const refused = checkEvents({ events: [{ ...event, message: { ...event.message, voiceNote } }] });
    assert.ok(!refused.ok && /voiceNote/.test(refused.error), JSON.stringify(voiceNote));
  }
  const words = checkEvents({ events: [{ ...event, message: { ...event.message, text: "hello" } }] });
  assert.ok(!words.ok && /no words/.test(words.error));
  assert.ok(!checkEvents({ events: [{ kind: "message", message: { id: "m", from: "+91", timestamp: 1, voiceNote: true } }] }).ok, "a voice note still needs its text field, empty");
});

// ---- the agent --------------------------------------------------------------------------------------------------------------

test("the agent answers a voice note once, with the right line, in each of the four languages (the language the customer was already using)", async () => {
  const greeting: Record<Language, string> = { en: "hello", hi: "नमस्ते", ml: WORDS.ml.greeting[0], kn: WORDS.kn.greeting[0] };
  for (const language of LANGUAGES) {
    const w = createWorld();
    await w.say(greeting[language]);
    const before = w.messaging.sentTo(CUSTOMER).length;
    await hear(w, voiceNote(w));
    const reply = w.messaging.sentTo(CUSTOMER).slice(before);
    assert.deepEqual(reply.map((m) => [m.kind, m.text]), [["text", LINE[language]]], language);
    assert.equal(reply[0].text, TEMPLATES[language].voice_note({} as never), "the line is the template's, in this language");
  }
  assert.equal(LINE.en, "Sorry, I can't listen to voice notes yet. Could you type your message?");
});

test("a customer who wrote in Malayalam gets Malayalam even though the shop's first language is Hindi; a stranger gets the shop's first language", async () => {
  const w = createWorld();
  assert.equal(w.settings.languages[0], "hi");
  await w.say(WORDS.ml.greeting[0]);
  await hear(w, voiceNote(w));
  assert.equal(w.messaging.sentTo(CUSTOMER).at(-1)!.text, LINE.ml);
  // somebody who has never written words: the shop's default
  await hear(w, voiceNote(w, OTHER_CUSTOMER));
  assert.equal(w.messaging.sentTo(OTHER_CUSTOMER).map((m) => m.text).join("|"), LINE.hi);
  // and for a shop whose first language is Kannada
  const base = JSON.parse(JSON.stringify(w.settings));
  const kn = createWorld({ settings: parseSettings({ ...base, languages: ["kn", "en"] }) });
  await hear(kn, voiceNote(kn));
  assert.equal(kn.messaging.sentTo(CUSTOMER).map((m) => m.text).join("|"), LINE.kn);
  // a voice note does not change the language the conversation already has
  await hear(w, voiceNote(w));
  assert.equal(w.store.customers.get(CUSTOMER)!.language, "ml");
});

test("a customer who sent STOP gets nothing, not even for a voice note; the owner is not told again either", async () => {
  const w = createWorld();
  await w.say("STOP");
  const sentBefore = w.messaging.outbox().length;
  const recordBefore = w.record.entries().length;
  await hear(w, voiceNote(w));
  assert.equal(w.messaging.outbox().length, sentBefore, "nothing was sent after STOP");
  assert.ok(w.messaging.outbox().every((m) => !m.afterOptOut));
  const added = w.record.entries().slice(recordBefore);
  assert.deepEqual(added.map((e) => [e.action, e.outcome]), [["receive_message", "confirmed"]]);
  assert.ok(!w.record.entries().some((e) => e.action === "voice_note_reply"));
});

test("the record has its own entry for the reply; it holds the template id and the message id of OUR reply, never a media id or a word of the audio", async () => {
  const w = createWorld();
  // the whole way in: Meta's body, the inbox's reader, the runtime's check, then the agent
  const [parsed] = parseWhatsAppWebhook(webhookWith(audio("wamid.note-1", CUSTOMER.slice(1))));
  const checked = checkEvents({ events: [{ kind: "message", message: parsed }] });
  assert.ok(checked.ok);
  w.messaging.receive(CUSTOMER, ""); // the window opens when the person writes
  await w.agent.handle(checked.events[0]);
  const entries = w.record.entries();
  const reply = entries.filter((e) => e.action === "voice_note_reply");
  assert.equal(reply.length, 1);
  assert.equal(reply[0].outcome, "confirmed");
  assert.equal(reply[0].booking, null);
  assert.equal(reply[0].language, "hi");
  assert.deepEqual(reply[0].refs, { messageId: w.messaging.sentTo(CUSTOMER)[0].id, templates: "voice_note", to: "customer" });
  assert.deepEqual(entries.map((e) => e.action), ["receive_message", "voice_note_reply"]);
  assert.ok(!entries.some((e) => e.action === "send_message"), "one entry for the one message, not two");
  const everything = JSON.stringify([entries, w.messaging.outbox(), [...w.store.customers.values()]]);
  for (const leaked of ["MEDIA", "ogg", "sha256", "mime", "audio"]) assert.ok(!everything.includes(leaked), `${leaked} is nowhere in the record, the store or the outbox`);
});

test("a redelivered voice note is answered once, and the second delivery is recorded as ignored", async () => {
  const w = createWorld();
  const note = voiceNote(w, CUSTOMER, "wamid.same-note");
  await hear(w, note);
  await hear(w, note);
  assert.equal(w.messaging.sentTo(CUSTOMER).length, 1);
  assert.deepEqual(w.record.entries().map((e) => [e.action, e.outcome]), [["receive_message", "confirmed"], ["voice_note_reply", "confirmed"], ["receive_message", "blocked"]]);
});

test("a reply that cannot go out is recorded as failed or unconfirmed like any other message, and nothing crashes", async () => {
  const w = createWorld();
  w.messaging.inject("sendText", "error");
  await hear(w, voiceNote(w, CUSTOMER, "wamid.a"));
  w.messaging.inject("sendText", "lostReply");
  await hear(w, voiceNote(w, OTHER_CUSTOMER, "wamid.b"));
  const replies = w.record.entries().filter((e) => e.action === "voice_note_reply");
  assert.deepEqual(replies.map((e) => e.outcome), ["failed", "unconfirmed"]);
  assert.ok(replies.every((e) => e.notes.length > 0 && !e.notes.includes("MEDIA")));
});

test("a voice note from the owner is answered in the owner's language, and never taken for a command", async () => {
  const w = createWorld();
  await hear(w, voiceNote(w, w.owner));
  assert.deepEqual(w.messaging.sentTo(w.owner).map((m) => m.text), [LINE[w.settings.owner.language]]);
  const entries = w.record.entries();
  assert.deepEqual(entries.map((e) => [e.action, e.outcome, e.refs.to]), [["voice_note_reply", "confirmed", "owner"]]);
});

// ---- through the runtime: saved, and a redelivery is a no-op ----------------------------------------------------------------

test("through the runtime's HTTP face: a voice note is saved, answered once, and a redelivery of the same message is a no-op; a malformed one is a 400", async () => {
  const kit = createKit();
  const { runtime, db } = kit.open();
  const token = "test-token-0123456789abcdef";
  const server = await startServer(runtime, { token, port: 0 });
  const post = (body: unknown) => fetch(`${server.url}/internal/events`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  try {
    kit.messaging.receive(CUSTOMER, ""); // the person writing opens their 24-hour window at the provider
    const [parsed] = parseWhatsAppWebhook(webhookWith(audio("wamid.http-note", CUSTOMER.slice(1))));
    const event = { kind: "message", message: { ...parsed, timestamp: kit.clock.now() } };
    assert.deepEqual(await (await post({ events: [event] })).json(), { saved: 1, duplicates: 0 });
    await runtime.idle();
    assert.deepEqual(await (await post({ events: [event, event] })).json(), { saved: 0, duplicates: 2 }, "a redelivery, alone or twice in one request");
    await runtime.idle();
    assert.deepEqual(kit.messaging.sentTo(CUSTOMER).map((m) => m.text), [LINE.hi], "one reply, not three");
    assert.equal(db.lastInboundAt(CUSTOMER), event.message.timestamp, "writing a voice note opens the 24-hour window like any message");
    const record = db.loadState().record;
    assert.equal(record.filter((e) => e.action === "voice_note_reply").length, 1);
    assert.ok(!JSON.stringify(record).includes("MEDIA"));
    // the saved task holds the flag and no words (and, once done, nothing at all)
    const bad = await post({ events: [{ kind: "message", message: { ...event.message, id: "wamid.bad", voiceNote: "yes" } }] });
    assert.equal(bad.status, 400);
    assert.deepEqual(await (await post({ events: [{ ...event, message: { ...event.message, id: "wamid.other" } }] })).json(), { saved: 1, duplicates: 0 });
    await runtime.idle();
    assert.equal(kit.messaging.sentTo(CUSTOMER).length, 2, "a different voice note is a different message and is answered");
  } finally { await server.close(); await runtime.close(); kit.cleanup(); }
});

// ---- the monthly report -----------------------------------------------------------------------------------------------------

const report = (w: ReturnType<typeof createWorld>) => buildMonthlyReport({ settings: w.settings, entries: w.record.entries(), bookings: [...w.store.bookings.values()], ...monthRange("2026-11", w.settings.timezone), source: "stand-in", madeAt: Date.UTC(2026, 11, 2) });

test("the report counts a reply to a voice note as one message to a customer in its language, and a lost reply moves 'open' by one and the owner's 'could not confirm' line by none", async () => {
  const w = createWorld();
  await w.say(WORDS.ml.greeting[0]); // a menu, in Malayalam
  const before = report(w);
  await hear(w, voiceNote(w));
  const sent = report(w);
  assert.equal(sent.messages.toCustomers.total, before.messages.toCustomers.total + 1);
  assert.equal(sent.messages.toCustomers.byLanguage.ml, before.messages.toCustomers.byLanguage.ml + 1);
  assert.deepEqual(sent.record.byAction.voice_note_reply, { confirmed: 1 });
  assert.equal(sent.unconfirmed.open, 0);
  assert.equal(sent.stopped.total, 0);

  w.messaging.inject("sendText", "lostReply");
  await hear(w, voiceNote(w, CUSTOMER, "wamid.lost"));
  const lost = report(w);
  assert.equal(lost.unconfirmed.open, sent.unconfirmed.open + 1, "the lost reply is listed with the messages that were not confirmed");
  assert.equal(lost.unconfirmed.openOnBookings, 0, "and it is not a booking, so the owner's line does not count it");
  assert.equal(lost.messages.toCustomers.total, sent.messages.toCustomers.total, "a reply that was not confirmed is not counted as sent");
  const lines = ownerText(lost, "en").split("\n");
  assert.equal(lines.length, 5);
  assert.ok(!lines.some((l) => l.includes("Could not confirm")), lines.join("\n"));
});

test("an action name the report has never heard of does not break the counts, the owner text or the page; it shows in the table by action only", async () => {
  const w = createWorld();
  await w.say("hello");
  const known = report(w);
  const entries = [...w.record.entries()];
  const stranger = { ...entries.at(-1)!, seq: entries.length + 1, action: "something_from_a_later_version" as never, outcome: "unconfirmed" as const, booking: null, decisions: [{ ruleId: "opt-out" as const, verdict: "block" as const, reason: "x" }] };
  const r = buildMonthlyReport({ settings: w.settings, entries: [...entries, stranger], bookings: [], ...monthRange("2026-11", w.settings.timezone), source: "stand-in", madeAt: Date.UTC(2026, 11, 2) });
  assert.equal(r.record.entries, known.record.entries + 1);
  assert.deepEqual(r.record.byAction.something_from_a_later_version, { unconfirmed: 1 });
  assert.equal(r.messages.toCustomers.total, known.messages.toCustomers.total, "it is not a message");
  assert.equal(r.stopped.total, known.stopped.total, "and a limit's no is counted only where the report knows to look");
  assert.equal(ownerText(r, "en").split("\n").length, 5);
});
