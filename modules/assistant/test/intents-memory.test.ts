// "remember …", "what do you remember?" and "forget 3" read by rule, in four languages, before every other kind (modules/assistant/intents-memory.ts, intents.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readMemoryWords } from "../intents-memory.ts";
import { readOwnerRules, ownerReading } from "../intents.ts";

const CONTEXT = { kinds: ["close_day", "day", "money", "waiting", "cancel", "refund", "message", "undo", "limit", "help", "remember", "notes", "forget"] as never };

test("remember, in four languages (Hindi also in Latin letters), with the words after the command or before it", () => {
  const cases: [string, string][] = [
    ["remember we close at 6 on Saturdays", "we close at 6 on Saturdays"], ["Remember that Tuesdays are quiet", "Tuesdays are quiet"],
    ["yaad rakhna ki shanivar ko 6 baje band", "shanivar ko 6 baje band"], ["याद रखना शनिवार को बंद", "शनिवार को बंद"],
    ["ശനിയാഴ്ച 6-ന് അടയ്ക്കും എന്ന് ഓർത്തുവെക്കൂ", "ശനിയാഴ്ച 6-ന് അടയ്ക്കും"], ["ಶನಿವಾರ ಮುಚ್ಚುತ್ತೇವೆ ಎಂದು ನೆನಪಿಡಿ", "ಶನಿವಾರ ಮುಚ್ಚುತ್ತೇವೆ"],
  ];
  for (const [text, words] of cases) assert.deepEqual(readMemoryWords(text), { kind: "remember", words }, text);
  assert.deepEqual(readMemoryWords("remember"), { kind: "remember" });
});

test("what do you remember, and forget N", () => {
  for (const text of ["what do you remember?", "क्या याद है", "ഓർമ്മയിൽ എന്ത് ഉണ്ട്", "ಏನು ನೆನಪಿದೆ?", "show my notes"]) assert.deepEqual(readMemoryWords(text), { kind: "notes" }, text);
  for (const [text, id] of [["forget 3", "n-3"], ["forget n-12", "n-12"], ["bhool jao 4", "n-4"], ["भूल जाओ 5", "n-5"], ["മറക്കൂ 6", "n-6"], ["ಮರೆತುಬಿಡಿ 7", "n-7"]] as const) assert.deepEqual(readMemoryWords(text), { kind: "forget", note: id }, text);
});

test("words that are about something else are not memory", () => {
  for (const text of ["close Sunday", "tomorrow", "refund b-14", "who owes fees"]) assert.equal(readMemoryWords(text), undefined, text);
});

test("\"remember we close on Sunday\" is a note, never a closed day; the owner's other kinds are unchanged", () => {
  assert.equal(readOwnerRules("remember we close on Sunday", CONTEXT).kind, "remember");
  assert.equal(readOwnerRules("close Sunday", CONTEXT).kind, "close_day");
  assert.equal(readOwnerRules("forget 3", CONTEXT).kind, "forget");
  assert.equal(readOwnerRules("forget 3", CONTEXT).note, "n-3");
  assert.equal(readOwnerRules("what do you remember", CONTEXT).kind, "notes");
});

test("a model is never offered the memory kinds: they are read by rule only", () => {
  const prompt = ownerReading.prompt(CONTEXT);
  assert.ok(!/- remember:|- forget:|- notes:/u.test(prompt));
  const schema = JSON.stringify(ownerReading.schema(CONTEXT));
  assert.ok(!/"remember"|"forget"|"notes"/u.test(schema));
});
