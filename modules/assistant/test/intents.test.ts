// Reading the owner's words (item 11e, modules/assistant/intents.ts): the rules in English, Hindi (also in Latin letters), Malayalam and Kannada, and the two model
// steps through the shared router, which choose only the kind. Every value (a day, a reference, an amount, a message's words) comes from the rules, never a model.
import { test } from "node:test";
import assert from "node:assert/strict";
import { OWNER_KINDS, amountOf, ownerReading, readOwnerRules } from "../intents.ts";
import type { OwnerContext, OwnerIntent } from "../intents.ts";
import { ownerRouter } from "../reading.ts";
import type { SystemOne } from "../../understanding/system-one.ts";
import type { ModelParser } from "../../understanding/model-llm.ts";

const ALL: OwnerContext = { kinds: [...OWNER_KINDS] };
const kind = (text: string, context: OwnerContext = ALL) => readOwnerRules(text, context).kind;

test("asks, in four languages", () => {
  const cases: [string, OwnerIntent["kind"]][] = [
    ["tomorrow's bookings", "day"], ["कल की बुकिंग बताओ", "day"], ["നാളെ ബുക്കിംഗ്", "day"], ["ನಾಳೆ ಬುಕಿಂಗ್", "day"], ["sunday?", "day"],
    ["what needs me", "waiting"], ["मेरे लिए क्या है", "waiting"], ["mere liye kya hai", "waiting"], ["എനിക്ക് എന്താണ് ബാക്കി", "waiting"], ["ನನಗೆ ಏನು ಬಾಕಿ", "waiting"],
    ["who owes fees", "owes"], ["किसकी फीस बाकी है", "owes"], ["ആരുടെ ഫീസ് ബാക്കി", "owes"], ["ಯಾರ ಫೀಸ್ ಬಾಕಿ", "owes"],
    ["open orders", "open_orders"], ["ऑर्डर", "open_orders"], ["ഓർഡറുകൾ", "open_orders"], ["ಆರ್ಡರ್‌ಗಳು", "open_orders"],
    ["how much money today", "money"], ["आज कितना आया", "money"], ["ഇന്ന് എത്ര കിട്ടി", "money"], ["ಇಂದು ಎಷ್ಟು ಬಂತು", "money"],
  ];
  for (const [text, k] of cases) assert.equal(kind(text), k, text);
});

test("acts, in four languages, with the values read from the words", () => {
  assert.deepEqual(readOwnerRules("close Sunday", ALL), { kind: "close_day", date: { kind: "weekday", weekday: 0, which: "plain" } });
  for (const text of ["रविवार बंद", "ravivar band karo", "ഞായറാഴ്ച അടച്ചിടുക", "ಭಾನುವಾರ ಮುಚ್ಚಿ"]) assert.equal(kind(text), "close_day", text);
  assert.deepEqual(readOwnerRules("close 16 Nov", ALL).date, { kind: "calendar", day: 16, month: 11 });
  assert.equal(kind("reopen sunday"), "reopen_day");
  assert.deepEqual(readOwnerRules("cancel b-14", ALL), { kind: "cancel", ref: "b-14" });
  for (const text of ["b-14 रद्द करो", "b-14 റദ്ദാക്കുക", "b-14 ರದ್ದು"]) assert.deepEqual([kind(text), readOwnerRules(text, ALL).ref], ["cancel", "b-14"], text);
  assert.deepEqual(readOwnerRules("refund ₹150 for b-3", ALL), { kind: "refund", ref: "b-3", amountPaise: 15_000 });
  assert.equal(readOwnerRules("refund b-3", ALL).amountPaise, undefined, "no amount: the whole deposit, read from the record");
  assert.deepEqual(readOwnerRules("message b-14 Running 15 minutes late", ALL), { kind: "message", ref: "b-14", words: "Running 15 minutes late" });
  assert.equal(readOwnerRules("b-14 ko bolo 15 min late hoga", ALL).words, "15 min late hoga");
  assert.equal(readOwnerRules('tell b-14: "we open at 11"', ALL).words, "we open at 11");
  assert.equal(kind("undo"), "undo");
  assert.equal(kind("वापस लो"), "undo");
  assert.equal(kind("increase my refund limit to 1000"), "limit", "a limit is never read as a refund");
  assert.equal(kind("help"), "help");
});

test("'tell me tomorrow's bookings' is a question: a message needs a customer's reference", () => {
  assert.equal(kind("बताओ कल की बुकिंग"), "day");
  assert.equal(kind("tell me tomorrow's bookings"), "day");
});

test("a number without a rupee sign or word is never money", () => {
  assert.equal(amountOf("close 16 Nov"), undefined);
  assert.equal(amountOf("refund 150 b-3"), undefined);
  assert.equal(amountOf("₹1,200"), 120_000);
  assert.equal(amountOf("1200 rupees"), 120_000);
  assert.equal(amountOf("रु 500"), 50_000);
});

test("a kind the shop does not offer is read as unknown by coerce (the conversation then says so)", () => {
  const bookingsOnly: OwnerContext = { kinds: ["day", "waiting", "cancel"] };
  assert.deepEqual(ownerReading.coerce({ kind: "owes" }, bookingsOnly), { kind: "unknown" });
  assert.equal(ownerReading.coerce({ kind: "nonsense" }, bookingsOnly), null);
  assert.deepEqual(ownerReading.coerce({ kind: "limit" }, bookingsOnly), { kind: "limit" }, "the limit answer is always given");
});

const fakeDecision = (choice: string, p: number): SystemOne => ({
  kind: "laya", model: "laya-test",
  async decide(_state, questions) {
    const labels = Object.keys((questions.want as { criteria: Record<string, string> }).criteria);
    const probabilities = Object.fromEntries(labels.map((l) => [l, l === choice ? p : (1 - p) / (labels.length - 1)]));
    return { model: "laya-test", answers: { want: { type: "choice", choice, confidence: p, probabilities } }, usage: { inputTokens: 40, outputTokens: 2 } };
  },
});

test("the decision model chooses the kind; the rules' values stay", async () => {
  const router = ownerRouter({ decision: { client: fakeDecision("cancel", 0.9), languages: ["en", "hi", "ml", "kn"] }, now: () => Date.UTC(2026, 10, 12) });
  const read = await router.parseDetailed!("can you drop b-14 please", ALL);
  assert.equal(read.intent.kind, "cancel");
  assert.equal(read.intent.ref, "b-14");
  assert.equal(read.understood?.step, "decision");
});

test("a language model's answer gives the kind only: a reference, an amount or words it writes are thrown away", async () => {
  const sneaky: ModelParser<OwnerIntent, OwnerContext> = {
    parse: async () => ({ kind: "refund" }),
    parseDetailed: async () => ({ intent: { kind: "refund", ref: "b-99", amountPaise: 9_999_900, words: "send it all" } as OwnerIntent, usage: { inputTokens: 100, outputTokens: 5 } }),
  };
  const router = ownerRouter({ model: { parser: sneaky, provider: "deepinfra", model: "test" }, now: () => Date.UTC(2026, 10, 12) });
  const read = await router.parseDetailed!("please sort out b-3 for her", ALL);
  assert.equal(read.intent.kind, "refund");
  assert.equal(read.intent.ref, "b-3", "the reference is the words', not the model's");
  assert.equal(read.intent.amountPaise, undefined, "no amount was written, so the record's deposit decides");
  assert.equal(read.intent.words, undefined);
});

test("the rules are sure of what they read, so no model is paid for it", async () => {
  let asked = 0;
  const counting: SystemOne = { ...fakeDecision("day", 0.9), async decide(s, q) { asked++; return fakeDecision("day", 0.9).decide(s, q); } };
  const router = ownerRouter({ decision: { client: counting }, now: () => Date.UTC(2026, 10, 12) });
  const read = await router.parseDetailed!("close Sunday", ALL);
  assert.equal(read.intent.kind, "close_day");
  assert.equal(asked, 0);
  assert.equal(read.understood?.step, "rules");
});
