// The words of the shop's memory and talk, in four languages: every message passes the outgoing check over its own facts, none uses a word documents may not, the cards for Fees
// and Orders say fee / balance / advance and never "deposit", and the assistant's settings block takes `talk`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { write, cardQuestion } from "../words.ts";
import type { MessageData } from "../words.ts";
import { checkText } from "../../language/check.ts";
import { bannedIn } from "../../report/claims.ts";
import { LANGUAGES } from "../../language/languages.ts";
import { readAssistantSettings, assistantSettingsJson } from "../settings.ts";
import { runTalkEval, fakeTalkModel, talkTurns } from "../eval/talk-eval.ts";

const TZ = "Asia/Kolkata";
const note = { id: "n-3", text: "closed on Sunday", kind: "fact", audience: "owner" as const };
const SAMPLES: { [K in keyof MessageData]?: MessageData[K] } = {
  note_saved: { id: "n-3", text: "closed on Sunday", audience: "everyone", undoable: true }, note_proposal: { text: "closed on Sunday", audience: "owner" }, note_declined: {},
  notes_list: { notes: [note, { ...note, id: "n-4", audience: "everyone" }] }, note_forgotten: { id: "n-3" }, note_undone: { id: "n-3" }, note_unknown: { id: "n-9" },
  note_full: { max: 80 }, note_too_long: { max: 280 }, note_need_words: {}, note_not_a_limit: { id: "n-3" }, talk_fallback: { waiting: 2, today: 5 }, talk_off: {},
};

test("every memory and talk message passes the outgoing check and holds no banned word, in every language", () => {
  for (const language of LANGUAGES) for (const [id, data] of Object.entries(SAMPLES)) {
    const w = write(id as never, data as never, language, TZ);
    assert.ok(w.text.length > 0, `${id} ${language}`);
    const r = checkText(w.text, w.facts);
    assert.equal(r.ok, true, `${id} ${language}: ${r.problems.join(" ")}`);
    assert.deepEqual(bannedIn(w.text, language), [], `${id} ${language}`);
  }
});

test("a checked talk reply carries its facts to the outgoing check", () => {
  const facts = { language: "en" as const, timeZone: TZ, amountsInr: [300], counts: [300], momentsMs: [], links: [], literals: [] };
  const w = write("talk_reply", { text: "A Haircut is ₹300.", facts }, "en", TZ);
  assert.equal(checkText(w.text, w.facts).ok, true);
  assert.equal(checkText("A Haircut is ₹350.", write("talk_reply", { text: "A Haircut is ₹350.", facts }, "en", TZ).facts).ok, false);
});

test("a Fees or Orders card says fee, balance and advance, never deposit; Bookings' cards are as they were", () => {
  for (const language of LANGUAGES) {
    for (const skill of ["fees", "orders"]) for (const [kind, paise] of [["cancel", 150_000], ["cancel", 0], ["refund", 50_000]] as const) {
      const text = cardQuestion({ kind, skill, who: "Priya", ref: "f-3", what: "November 2026", amountPaise: paise, code: "K7M2QX", hasNo: true }, language, TZ);
      assert.ok(!/deposit|जमा राशि|ഡെപ്പോസിറ്റ്|ಠೇವಣಿ/u.test(text), `${skill} ${kind} ${language}: ${text}`);
    }
  }
  assert.match(cardQuestion({ kind: "cancel", skill: "bookings", who: "Priya", ref: "b-1", what: "Haircut", amountPaise: 10_000, code: "K7M2QX", hasNo: true }, "en", TZ), /deposit/u);
  assert.match(cardQuestion({ kind: "cancel", skill: "fees", who: "Priya", ref: "f-3", what: "Nov 2026", amountPaise: 0, code: "K7M2QX", hasNo: true }, "en", TZ), /Nothing is owed/u);
  assert.match(cardQuestion({ kind: "cancel", skill: "fees", who: "Priya", ref: "f-3", what: "Nov 2026", amountPaise: 150_000, code: "K7M2QX", hasNo: true }, "en", TZ), /waive the ₹1,500 balance\? No money moves/u);
});

test("assistant.talk.customers false is read, written back, and anything else is refused", () => {
  const errors: string[] = [];
  const off = readAssistantSettings({ talk: { customers: false } }, errors);
  assert.deepEqual(errors, []);
  assert.deepEqual(off?.talk, { customers: false });
  assert.deepEqual(assistantSettingsJson(off!).talk, { customers: false });
  assert.equal(readAssistantSettings({}, [])?.talk, undefined, "on by default, and not written back");
  const bad: string[] = [];
  readAssistantSettings({ talk: { customers: "no" } }, bad);
  readAssistantSettings({ talk: { owner: false } }, bad);
  assert.equal(bad.length, 2);
});

test("the evaluation: 80 turns on the fake, every one valid JSON and as expected", async () => {
  const turns = talkTurns();
  assert.equal(turns.length, 80);
  assert.equal(turns.filter((t) => t.role === "owner").length, 40);
  for (const language of LANGUAGES) assert.equal(turns.filter((t) => t.language === language).length, 20);
  const score = await runTalkEval(fakeTalkModel(turns), turns);
  assert.deepEqual(score.failures, []);
  assert.equal(score.validJson, 80);
  assert.equal(score.met, 80);
  assert.ok(score.checkPasses < 80, "the traps are stopped by the checks");
});
