// "Leave with your shop": how the two asks look in the record, who may ask again and when, the stranded rule (decision 17), and the owner's words in four languages.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FILE_ASKED, FILE_TAKEN, OPERATOR_ASKED, STRANDED_DAYS, ASK_AGAIN_MS, fileTaken, latestAsk, mayAskAgain, newAskId, operatorAskOpen, stranded } from "../leave.ts";
import { readLeaveWords } from "../../assistant/intents-leave.ts";

const ask = (action: string, time: string, id: string, via = "whatsapp", outcome = "confirmed") => ({ time, action, outcome, refs: { ask: id, via } });
const DAY = 86_400_000;

test("the latest well-formed ask of a kind is the one that counts; other kinds and unconfirmed lines do not", () => {
  const a = newAskId(), b = newAskId();
  const entries = [ask(FILE_ASKED, "2026-11-01T10:00:00Z", a), ask(FILE_ASKED, "2026-11-05T10:00:00Z", b, "page"), ask(OPERATOR_ASKED, "2026-11-09T10:00:00Z", newAskId()), ask(FILE_ASKED, "2026-11-09T10:00:00Z", newAskId(), "page", "blocked"), ask(FILE_ASKED, "2026-11-10T10:00:00Z", "not-an-id")];
  assert.deepEqual(latestAsk(entries, "file"), { id: b, at: "2026-11-05T10:00:00Z", via: "page" });
  assert.equal(latestAsk([], "operator"), undefined);
});

test("an ask is taken once an hour: a repeat inside the hour is told it is on its way", () => {
  const at = Date.parse("2026-11-18T10:00:00Z");
  const entries = [ask(FILE_ASKED, new Date(at).toISOString(), newAskId())];
  assert.equal(mayAskAgain(entries, "file", at + ASK_AGAIN_MS - 1), false);
  assert.equal(mayAskAgain(entries, "file", at + ASK_AGAIN_MS), true);
  assert.equal(mayAskAgain(entries, "operator", at), true, "the other kind is its own");
});

test("the owner's session taking the file is the line that lets the server delete its copy", () => {
  const id = newAskId();
  assert.equal(fileTaken([{ time: "2026-11-18T10:00:00Z", action: FILE_TAKEN, outcome: "confirmed", refs: { ask: id } }], id), true);
  assert.equal(fileTaken([{ time: "2026-11-18T10:00:00Z", action: FILE_TAKEN, outcome: "confirmed", refs: { ask: newAskId() } }], id), false);
});

test("the stranded rule: an open ask older than 14 days, with no handover started or finished since, is Geometer's to see", () => {
  const at = "2026-11-01T00:00:00Z";
  const a = { id: newAskId(), at, via: "whatsapp" as const };
  const t = (days: number) => Date.parse(at) + days * DAY;
  assert.equal(STRANDED_DAYS, 14);
  assert.equal(stranded(a, undefined, undefined, t(13.9)), false, "not yet");
  assert.equal(stranded(a, undefined, undefined, t(14)), true);
  assert.equal(stranded(a, "2026-11-10T00:00:00Z", undefined, t(30)), false, "a move finished after the ask closes it");
  assert.equal(operatorAskOpen(a, "2026-10-01T00:00:00Z"), true, "a move before the ask does not");
  assert.equal(stranded(a, undefined, "2026-11-03T00:00:00Z", t(30)), false, "an Operator who started the handover is not stranding the shop");
  assert.equal(stranded(a, undefined, "2026-10-30T00:00:00Z", t(30)), true, "a handover asked before the ask does not help it");
  assert.equal(stranded(undefined, undefined, undefined, t(30)), false);
});

test("the owner's words in four languages are read by rule, and 'Operator badal do' is not a booking move", () => {
  for (const t of ["get my shop's file", "Export", "please export", "download my data", "meri dukan ki file", "मेरी दुकान की फाइल", "എന്റെ കടയുടെ ഫയൽ", "ನನ್ನ ಅಂಗಡಿಯ ಫೈಲ್"]) assert.equal(readLeaveWords(t), "file", t);
  for (const t of ["change my operator", "I want another operator", "operator badal do", "ऑपरेटर बदलो", "ഓപ്പറേറ്റർ മാറ്റണം", "ಆಪರೇಟರ್ ಬದಲಿಸಿ"]) assert.equal(readLeaveWords(t), "operator", t);
  for (const t of ["money today", "move b-14 to 5pm", "my operator called me yesterday and said the shop is closed on Sunday, is that right", ""]) assert.equal(readLeaveWords(t), undefined, t);
});
