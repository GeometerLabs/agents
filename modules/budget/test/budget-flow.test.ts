// The model budget through the assistant itself, on fakes (decision 60, "caps everywhere"): the owner's talk, a customer's open question and a listing draft each stop at their
// daily cap and at the month's budget, and each then falls back to what needs no model (the fixed answer, the template's menu, the plain form) and says so ONCE, in the owner's
// words; the 80% and the used-up notices go once each, to WhatsApp and to the owner's app; a new month starts the budget again; the same message is never paid for twice; and
// every new line is in all four languages. No real model or provider is called: the talk model is a script that costs a fixed price per call.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAssistant, kindsOf } from "../../assistant/conversation.ts";
import { readOwnerRules } from "../../assistant/intents.ts";
import { defaultCharacter } from "../../assistant/character.ts";
import { createListings } from "../../assistant/listing-card.ts";
import { BUDGET_WORDS, DAY_FEATURES } from "../../assistant/words-budget.ts";
import { write } from "../../assistant/words.ts";
import type { OwnerSkill } from "../../assistant/skill.ts";
import type { AssistantState } from "../../assistant/state.ts";
import { stateFor } from "../../understanding/ai-state.ts";
import type { AiStore } from "../../understanding/ai-state.ts";
import type { TalkCallResult, TalkModel } from "../../understanding/talk.ts";
import { fakeClock } from "../../core/clock.ts";
import { checkText } from "../../language/check.ts";
import { LANGUAGES } from "../../language/languages.ts";
import { DAY, HOUR, zonedToMs } from "../../core/time.ts";
import { createFakeMessaging } from "../../messaging/messaging.ts";
import { createRecord } from "../../record/record.ts";
import { listingsOf } from "../../listings/listings.ts";
import type { BudgetConfig } from "../budget.ts";

const TZ = "Asia/Kolkata";
const OWNER = "+919000000000";
const CUSTOMER = "+919111111111";
const NOW = zonedToMs({ year: 2026, month: 11, day: 18 }, { hour: 11, minute: 0 }, TZ);
const CALL = 5000; // micro-rupees one scripted call costs

const skill: OwnerSkill = {
  name: "bookings", routing: { refs: /^b-\d+$/u, buttonPrefixes: [], words: {}, liveCaseOf: () => undefined },
  day: () => [], waiting: () => [], problems: () => 0, prepare: () => ({ ok: false, why: "busy" }), execute: async () => ({ ok: false, note: "failed" }),
  facts: () => [{ id: "r:today", kind: "record", text: "Bookings today: 5." }],
  publicContext: () => ({ sources: [{ id: "s:svc", kind: "setting", text: "Haircut: ₹300, 30 minutes.", amountsInr: [300], literals: ["Haircut"] }], links: [] }),
};
const goodDraft = {
  category: "pets", claims: [],
  titles: { en: "Persian kitten", hi: "फ़ारसी बिल्ली का बच्चा", ml: "പേർഷ്യൻ പൂച്ചക്കുട്ടി", kn: "ಪರ್ಷಿಯನ್ ಬೆಕ್ಕಿನ ಮರಿ" },
  texts: { en: "Two kittens for a good home.", hi: "दो बच्चे, अच्छे घर के लिए।", ml: "രണ്ട് കുഞ്ഞുങ്ങൾ.", kn: "ಎರಡು ಮರಿಗಳು." },
};

function world(budget: BudgetConfig | undefined) {
  const clock = fakeClock(NOW);
  const messaging = createFakeMessaging(clock);
  const record = createRecord(clock);
  const store: { assistant?: AssistantState } & AiStore = {};
  const calls: { name?: string }[] = [];
  const script: { reply: unknown } = { reply: { ask_owner: false, note: null, limit: null, sentences: [{ text: "Bookings today: 5.", sources: ["r:today"] }] } };
  const model: TalkModel = {
    async ask(call): Promise<TalkCallResult> {
      calls.push({ name: call.name });
      const answer = call.name === "listing" ? goodDraft : script.reply;
      return { usage: { inputTokens: 1000, outputTokens: 200 }, costMicroInr: CALL, rateDate: "2026-11-07", provider: "fake", model: "fake", latencyMs: 1, answer } as TalkCallResult;
    },
  };
  const log = (caseId: string | null, conversation: string, action: string, outcome: never, inputs: unknown, more: { notes?: string; refs?: Record<string, string>; language?: "en" }) => { record.append({ conversation, booking: caseId, action, inputs, outcome, language: more.language ?? "en", ...(more.notes ? { notes: more.notes } : {}), ...(more.refs ? { refs: more.refs } : {}) } as never); };
  const listings = createListings({ store, nowMs: () => clock.now(), ownerLanguage: "en", log: (action, outcome, inputs, refs, notes) => log(null, OWNER, action, outcome as never, inputs, { refs, ...(notes ? { notes } : {}) }) });
  const skills = [skill, listings.skill];
  const assistant = createAssistant({
    shop: { name: "Glow Salon", timezone: TZ, owner: { whatsapp: OWNER, language: "en" }, settings: { morningAt: null, character: defaultCharacter() } },
    store, skills, clock, messaging, listings,
    read: async (text) => ({ intent: readOwnerRules(text, { kinds: kindsOf(skills) }), refs: {} }),
    log: log as never, entries: () => record.entries(), languageOf: () => "en", optedOut: () => false,
    talk: { model, policy: { ...(budget ? { budget } : {}) } },
  });
  const sayOwner = async (text: string) => { await assistant.onOwnerMessage(messaging.receive(OWNER, text)); return messaging.sentTo(OWNER).at(-1); };
  const ownerTexts = () => messaging.sentTo(OWNER).map((m) => JSON.stringify(m));
  const customerSays = async (text: string) => {
    messaging.receive(CUSTOMER, text);
    const before = messaging.sentTo(CUSTOMER).length;
    const sent = await assistant.talkToCustomer({ phone: CUSTOMER, text, language: "en", menu: () => ({ buttons: [{ id: "owner", title: "Talk to owner" }] }) });
    return { sent, messages: messaging.sentTo(CUSTOMER).slice(before) };
  };
  const pend = () => { const s = listingsOf(store.assistant ??= { seq: 0, cards: [], refused: [], closedDays: [], undo: [], talk: [], limitChanges: [] }); s.pending.push({ id: `ph-0000000000${s.pending.length}`, type: "image/jpeg", atMs: clock.now() } as never); };
  return { clock, messaging, record, store, assistant, calls, script, sayOwner, ownerTexts, customerSays, pend };
}
const big = 1000 * 1_000_000;
const count = (w: ReturnType<typeof world>, re: RegExp) => w.ownerTexts().filter((t) => re.test(t)).length;
const DAY_OWNER = /talked as much as I can for today/u;

test("the owner's talk stops at its daily cap: the fixed answer, one plain line that day, no model call, and a new day starts again", async () => {
  const w = world({ monthlyMicroInr: big, daily: { owner_talk: 2 } });
  await w.sayOwner("how is the shop doing");
  await w.sayOwner("and what else is new?");
  assert.equal(w.calls.length, 2);
  const third = await w.sayOwner("how is the shop doing, take three");
  assert.match(third!.text ?? JSON.stringify(third), /didn.t get that/u, "the fixed answer, with the buttons the owner has");
  assert.equal(w.calls.length, 2, "no model call over the cap");
  assert.equal(count(w, DAY_OWNER), 1, "told, in plain words");
  await w.sayOwner("how is the shop doing, take four");
  assert.equal(count(w, DAY_OWNER), 1, "once that day");
  assert.equal(w.calls.length, 2);
  w.clock.set(NOW + DAY);
  await w.sayOwner("how is the shop doing, take five");
  assert.equal(w.calls.length, 3, "tomorrow the talk is back");
});

test("a customer's open question stops at the shop's daily cap: the template's menu, the owner is told once, the customer is told nothing", async () => {
  const w = world({ monthlyMicroInr: big, daily: { customer_talk: 1 } });
  w.script.reply = { ask_owner: false, note: null, limit: null, sentences: [{ text: "A Haircut is ₹300.", sources: ["s:svc"] }] };
  const first = await w.customerSays("how much is a haircut");
  assert.equal(first.sent, true);
  const second = await w.customerSays("and a shave?");
  assert.equal(second.sent, false, "the caller sends its own menu");
  assert.deepEqual(second.messages, [], "nothing about a cap reaches the customer");
  assert.equal(w.calls.length, 1);
  assert.equal(count(w, /answering customers.{0,20}open questions/u), 1);
  await w.customerSays("what else?");
  assert.equal(count(w, /answering customers.{0,20}open questions/u), 1, "once that day");
});

test("a listing draft stops at its daily cap and sends the owner to the plain form; a refused draft still used up a count", async () => {
  const w = world({ monthlyMicroInr: big, daily: { listing_draft: 1 } });
  w.pend();
  await w.sayOwner("two Persian kittens, ₹8,000 each");
  assert.equal(w.calls.length, 1);
  assert.equal(listingsOf(w.store.assistant!).items.length, 1, "the first draft is made");
  w.pend();
  const said = await w.sayOwner("two Persian kittens, ₹9,000 each");
  assert.match(JSON.stringify(said), /Add to my page form/u);
  assert.match(JSON.stringify(said), /limit for writing listings/u);
  assert.equal(w.calls.length, 1, "no second model call today");
  assert.equal(listingsOf(w.store.assistant!).items.length, 1);
});

test("the month's budget: 80% is told once, it keeps working, used up is told once, every feature falls back, and a new month starts again", async () => {
  const w = world({ monthlyMicroInr: 12_000, daily: { owner_talk: 50, listing_draft: 50, customer_talk: 50 } }); // 2.4 calls
  await w.sayOwner("how is the shop doing");
  await w.sayOwner("and what else is new?"); // 10,000: 83%
  await w.assistant.onTick();
  assert.equal(count(w, /most of my thinking budget/u), 1, "the 80% notice, to WhatsApp");
  assert.ok(w.store.assistant!.talk.some((l) => l.from === "assistant" && /most of my thinking budget/u.test(l.text)), "and to the owner's app");
  await w.sayOwner("how is the shop doing, take six"); // still under: a call is made, and it passes the line (15,000)
  assert.equal(w.calls.length, 3);
  await w.assistant.onTick();
  assert.equal(count(w, /thinking budget for this month is used up. Buttons still work; it is back on [A-Za-z ,0-9]*1 Dec/u), 1, "the used-up notice names the day it is back");
  await w.assistant.onTick(); await w.assistant.onTick();
  assert.equal(count(w, /thinking budget for this month is used up/u), 1, "once");
  assert.equal(count(w, /most of my thinking budget/u), 1, "once");
  // every feature now falls back, with no model call
  const fixed = await w.sayOwner("how is the shop doing, take five");
  assert.match(fixed!.text ?? JSON.stringify(fixed), /didn.t get that/u);
  const customer = await w.customerSays("how much is a haircut");
  assert.equal(customer.sent, false);
  w.pend();
  const listing = await w.sayOwner("two Persian kittens, ₹8,000 each");
  assert.match(JSON.stringify(listing), /Add to my page form/u);
  assert.match(JSON.stringify(listing), /used up/u);
  assert.equal(w.calls.length, 3, "not one model call after the budget");
  assert.equal(w.record.entries().some((e) => e.action === "ai_mode" && e.refs.mode === "budget_full"), true, "the record has it");
  // the 1st: a new month
  w.clock.set(zonedToMs({ year: 2026, month: 12, day: 1 }, { hour: 11, minute: 0 }, TZ));
  await w.sayOwner("how is the shop doing, take seven");
  assert.equal(w.calls.length, 4, "the model is asked again");
  assert.equal(stateFor(w.store, w.clock.now(), TZ).costMicroInr, CALL, "and the meter started again");
});

test("a message delivered twice is paid for once", async () => {
  const w = world({ monthlyMicroInr: big, daily: { owner_talk: 50 } });
  const msg = w.messaging.receive(OWNER, "how is the shop doing");
  await w.assistant.onOwnerMessage(msg);
  await w.assistant.onOwnerMessage(msg); // the same message again, as a retry would
  assert.equal(w.calls.length, 1);
  assert.equal(stateFor(w.store, NOW, TZ).costMicroInr, CALL, "the meter counted one call");
  assert.equal(stateFor(w.store, NOW, TZ).budget!.today.owner_talk, 1);
});

test("a shop with no budget talks as before: no notices, no caps, nothing kept", async () => {
  const w = world(undefined);
  for (let i = 0; i < 4; i++) await w.sayOwner(`how is the shop doing ${i}`);
  await w.assistant.onTick();
  assert.equal(w.calls.length, 4);
  assert.equal(count(w, /thinking budget/u), 0);
  assert.equal(stateFor(w.store, NOW, TZ).budget, undefined);
});

test("every new line is in all four languages, passes the outgoing check, and uses none of the words no line may carry", () => {
  const BANNED = /\b(safe|guaranteed|proves|certified|100%|earn|income|bot|founder)\b/iu;
  const back = { year: 2026, month: 12, day: 1 };
  const lines = [{ line: "warn", backOn: back }, { line: "full", backOn: back }, { line: "listing_month", backOn: back }, ...DAY_FEATURES.map((feature) => ({ line: "day", feature }))] as const;
  const english = new Map<string, string>();
  for (const l of lines) {
    for (const language of LANGUAGES) {
      const w = write("budget_line", l as never, language, TZ);
      assert.ok(w.text.length > 20, `${language} ${JSON.stringify(l)}`);
      assert.doesNotMatch(w.text, BANNED);
      assert.equal(checkText(w.text, w.facts).ok, true, `${language} ${JSON.stringify(l)} passes the outgoing check`);
      if (language === "en") english.set(JSON.stringify(l), w.text); else assert.notEqual(w.text, english.get(JSON.stringify(l)), `${language} is not the English line`);
      if (l.line !== "day" && language === "en") assert.match(w.text, /1 Dec/u, "the day it is back is in the line");
      if (l.line === "full" || l.line === "listing_month") assert.ok(/Buttons|Add to my page/u.test(english.get(JSON.stringify(l))!), "what still works is said");
    }
  }
  assert.deepEqual(Object.keys(BUDGET_WORDS).sort(), [...LANGUAGES].sort());
});
