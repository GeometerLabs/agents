// The pause on a step that keeps failing (modules/understanding/ai-state.ts): after a few failures in a short time the step is left out for a while, one try after
// that decides whether it is back, and the record is told once each way. Pure functions over a store, with no clock but the one the test hands in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MINUTE } from "../core/time.ts";
import { DEFAULT_BREAKER, noteStep, pausedSteps, stateFor, summaryOf, takeAnnouncements } from "../understanding/ai-state.ts";
import type { AiStore } from "../understanding/ai-state.ts";

const IST = "Asia/Kolkata";
const T0 = Date.parse("2026-11-10T10:00:00+05:30");
const at = (minutes: number) => T0 + minutes * MINUTE;
const fresh = (): AiStore => ({});
const fail = (s: AiStore, minutes: number) => noteStep(s, "decision", false, at(minutes), IST);
const ok = (s: AiStore, minutes: number) => noteStep(s, "decision", true, at(minutes), IST);
const paused = (s: AiStore, minutes: number) => pausedSteps(s, at(minutes), IST).includes("decision");

test("the numbers: three failures in fifteen minutes pause the step for ten", () => {
  assert.deepEqual(DEFAULT_BREAKER, { failures: 3, windowMinutes: 15, pauseMinutes: 10 });
});

test("failures below the count do not pause; the last one does, for the whole pause, and says so once", () => {
  const s = fresh();
  fail(s, 0); fail(s, 1);
  assert.equal(paused(s, 1), false);
  assert.deepEqual(takeAnnouncements(s, at(1), IST), []);
  fail(s, 2);
  assert.equal(paused(s, 2), true);
  assert.equal(paused(s, 11.9), true);
  assert.equal(paused(s, 12), false, "ten minutes after the third failure the step is tried again");
  assert.deepEqual(takeAnnouncements(s, at(2), IST), [{ step: "decision", event: "paused", untilMs: at(12) }]);
  assert.deepEqual(takeAnnouncements(s, at(2), IST), [], "told once");
});

test("failures too far apart do not add up, and a success starts the count again", () => {
  const s = fresh();
  fail(s, 0); fail(s, 8);
  fail(s, 16); // the first has left the 15-minute window
  assert.equal(paused(s, 16), false);
  ok(s, 17);
  fail(s, 18); fail(s, 19);
  assert.equal(paused(s, 19), false, "the success in between cleared the earlier failures");
  fail(s, 20);
  assert.equal(paused(s, 20), true);
});

test("after the pause one try decides: a failure pauses again at once and is not announced again; a success resumes and is announced", () => {
  const s = fresh();
  fail(s, 0); fail(s, 1); fail(s, 2);
  takeAnnouncements(s, at(2), IST);
  assert.equal(paused(s, 12), false);
  fail(s, 12); // the try failed
  assert.equal(paused(s, 12), true, "no need for three more failures");
  assert.equal(paused(s, 21.9), true);
  assert.deepEqual(takeAnnouncements(s, at(12), IST), [], "the outage was already announced");
  assert.equal(paused(s, 22), false);
  ok(s, 22); // the second try worked
  assert.equal(paused(s, 22), false);
  assert.deepEqual(takeAnnouncements(s, at(22), IST), [{ step: "decision", event: "resumed" }]);
  fail(s, 23); fail(s, 24);
  assert.equal(paused(s, 24), false, "a new outage needs the full count again");
});

test("a success while nothing is paused changes nothing and announces nothing", () => {
  const s = fresh();
  ok(s, 0); ok(s, 1);
  assert.equal(s.ai?.steps?.decision?.pausedUntilMs, undefined);
  assert.deepEqual(takeAnnouncements(s, at(1), IST), []);
});

test("the pause survives a new month, a snapshot from before this existed has no steps and works, and a policy can change the numbers", () => {
  const s = fresh();
  noteStep(s, "decision", false, Date.parse("2026-11-30T23:55:00+05:30"), IST);
  noteStep(s, "decision", false, Date.parse("2026-11-30T23:56:00+05:30"), IST);
  noteStep(s, "decision", false, Date.parse("2026-11-30T23:57:00+05:30"), IST);
  assert.deepEqual(pausedSteps(s, Date.parse("2026-12-01T00:02:00+05:30"), IST), ["decision"], "the pause is not forgotten at midnight on the 1st");
  assert.equal(stateFor(s, Date.parse("2026-12-01T00:02:00+05:30"), IST).month, "2026-12");

  const old: AiStore = { ai: { month: "2026-11", rules: 1, decision: 2, model: 0, costMicroInr: 0, unpriced: 0, told: {} } }; // as the store saved it before the pause existed
  assert.deepEqual(pausedSteps(old, at(0), IST), []);
  noteStep(old, "decision", true, at(0), IST);

  const quick = fresh();
  noteStep(quick, "decision", false, at(0), IST, { failures: 2, pauseMinutes: 1 });
  noteStep(quick, "decision", false, at(0.5), IST, { failures: 2, pauseMinutes: 1 });
  assert.equal(pausedSteps(quick, at(1), IST).length, 1);
  assert.equal(pausedSteps(quick, at(1.6), IST).length, 0);
});

test("the status says when the pause ends, as a time, and nothing else about it", () => {
  const s = fresh();
  fail(s, 0); fail(s, 1); fail(s, 2);
  const during = summaryOf(s, {}, at(5), IST);
  assert.deepEqual(during.paused, { decision: new Date(at(12)).toISOString() });
  assert.equal(during.mode, "ai", "the language model still answers, so the shop is not in button mode");
  assert.deepEqual(summaryOf(s, {}, at(12), IST).paused, { decision: null });
  assert.deepEqual(summaryOf(fresh(), {}, at(0), IST).paused, { decision: null });
});
