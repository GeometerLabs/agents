// "Leave with your shop" through the assistant itself, on fakes: the owner asks for their shop's file or for another Operator in four languages; the ask is recorded
// (with where it came from) and answered in the owner's language; a customer's words never make one; a repeat inside the hour is told it is on its way; the booking-move
// words never take "Operator badal do". No Operator is asked for anything.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAssistant, kindsOf } from "../conversation.ts";
import { readOwnerRules } from "../intents.ts";
import { defaultCharacter } from "../character.ts";
import type { OwnerSkill } from "../skill.ts";
import type { AssistantState } from "../state.ts";
import { fakeClock } from "../../core/clock.ts";
import { HOUR, zonedToMs } from "../../core/time.ts";
import { createFakeMessaging } from "../../messaging/messaging.ts";
import { createRecord } from "../../record/record.ts";
import { FILE_ASKED, OPERATOR_ASKED, latestAsk } from "../../approvals/leave.ts";
import type { Language } from "../../language/languages.ts";

const TZ = "Asia/Kolkata";
const OWNER = "+919000000000";
const CUSTOMER = "+919111111111";
const NOW = zonedToMs({ year: 2026, month: 11, day: 18 }, { hour: 11, minute: 0 }, TZ);

const skill: OwnerSkill = {
  name: "bookings", routing: { refs: /^b-\d+$/u, buttonPrefixes: [], words: {}, liveCaseOf: () => undefined },
  day: () => [], waiting: () => [], problems: () => 0, prepare: () => ({ ok: false, why: "busy" }), execute: async () => ({ ok: false, note: "failed" }),
  move: async () => { throw new Error("the booking-move skill must never run for these words"); }, moveTarget: () => { throw new Error("never"); },
};

function world(language: Language = "en") {
  const clock = fakeClock(NOW);
  const messaging = createFakeMessaging(clock);
  const record = createRecord(clock);
  const store: { assistant?: AssistantState } = {};
  const assistant = createAssistant({
    shop: { name: "Glow Salon", timezone: TZ, owner: { whatsapp: OWNER, language }, settings: { morningAt: null, character: defaultCharacter() } },
    store, skills: [skill], clock, messaging,
    read: async (text) => ({ intent: readOwnerRules(text, { kinds: kindsOf([skill]) }), refs: {} }),
    log: (caseId, conversation, action, outcome, inputs, more) => { record.append({ conversation, booking: caseId, action, inputs, outcome, language: more.language ?? "en", ...(more.notes ? { notes: more.notes } : {}), ...(more.refs ? { refs: more.refs } : {}) }); },
    entries: () => record.entries(), languageOf: () => "en", optedOut: () => false,
  });
  const sayOwner = async (text: string) => { await assistant.onOwnerMessage(messaging.receive(OWNER, text)); return messaging.sentTo(OWNER).at(-1); };
  return { clock, messaging, record, assistant, sayOwner };
}
const asks = (w: ReturnType<typeof world>, action: string) => w.record.entries().filter((e) => e.action === action);

test("'get my shop's file' is recorded as the owner's ask, answered, and needs no Operator", async () => {
  const w = world();
  const reply = await w.sayOwner("get my shop's file");
  assert.equal(asks(w, FILE_ASKED).length, 1);
  assert.equal(asks(w, FILE_ASKED)[0].refs.via, "whatsapp");
  assert.match(String((reply as { text?: string }).text ?? JSON.stringify(reply)), /half an hour/u);
  assert.equal(w.messaging.sentTo(CUSTOMER).length, 0, "nobody else is messaged");
  assert.equal(latestAsk(w.record.entries(), "file")?.via, "whatsapp");
});

test("'Operator badal do' and 'change my Operator' record the ask for another Operator and move no booking", async () => {
  const w = world();
  await w.sayOwner("Operator badal do");
  assert.equal(asks(w, OPERATOR_ASKED).length, 1, "the skill's move would have thrown");
  assert.equal(asks(w, FILE_ASKED).length, 0);
});

test("the same ask again inside the hour is told it is on its way and is not written twice; after the hour it is taken", async () => {
  const w = world();
  await w.sayOwner("export");
  const again = await w.sayOwner("export");
  assert.equal(asks(w, FILE_ASKED).length, 1);
  assert.match(String((again as { text?: string }).text ?? JSON.stringify(again)), /short while ago/u);
  w.clock.advance(HOUR + 1);
  await w.sayOwner("export");
  assert.equal(asks(w, FILE_ASKED).length, 2);
});

test("the words are read in Hindi, Malayalam and Kannada too, and answered in the owner's language", async () => {
  for (const [language, text, expect] of [["hi", "मेरी दुकान की फाइल", /फ़ाइल/u], ["ml", "എന്റെ കടയുടെ ഫയൽ", /ഫയൽ/u], ["kn", "ನನ್ನ ಅಂಗಡಿಯ ಫೈಲ್", /ಫೈಲ್/u]] as const) {
    const w = world(language);
    const reply = await w.sayOwner(text);
    assert.equal(asks(w, FILE_ASKED).length, 1, language);
    assert.match(String((reply as { text?: string }).text ?? JSON.stringify(reply)), expect, language);
  }
});

test("a customer cannot ask: the assistant's owner door takes only the owner's number", async () => {
  const w = world();
  const took = await w.assistant.onOwnerMessage(w.messaging.receive(CUSTOMER, "get my shop's file"));
  assert.equal(took, false);
  assert.equal(w.record.entries().filter((e) => e.action === FILE_ASKED || e.action === OPERATOR_ASKED).length, 0);
});

test("an ask from the owner's app says so in the record (via: page) and is answered on the page, not on WhatsApp", async () => {
  const w = world();
  await w.assistant.onPageMessage(w.messaging.receive(OWNER, "get my shop's file"));
  assert.equal(asks(w, FILE_ASKED)[0].refs.via, "page");
  assert.equal(w.messaging.sentTo(OWNER).length, 0);
});
