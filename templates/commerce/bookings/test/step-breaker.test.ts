// A decision model that is down while the language model is up (Deferred.md, B46/B47): after a few failures the agent stops waiting for it, asks the language model
// directly, says so in the record and the status, and tries the decision model again after a while. No customer and no owner is told. The decision model is the
// System One stand-in with a switch, the language model is a counting fetch; nothing is paid for and no key is read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, OTHER_CUSTOMER } from "../src/harness.ts";
import { createModelParser } from "../src/adapters/model-llm.ts";
import { createSystemOne } from "../../../../modules/understanding/system-one.ts";
import { createRouter } from "../src/adapters/understanding.ts";
import { stateFor, summaryOf } from "../../../../modules/understanding/ai-state.ts";
import { zonedToMs } from "../../../../modules/core/time.ts";
import { systemOneFetch, systemOneStandin } from "../../../../modules/standins/system-one.ts";
import { answer, openaiReply } from "./stub-model-server.ts";

const IST = "Asia/Kolkata";
const TEN_NOV = zonedToMs({ year: 2026, month: 11, day: 10 }, { hour: 10, minute: 0 }, IST);
const UNCLEAR = "asdf qwer zxcv";

/** The decision model (which can be switched off, or unsure), and a language model that always answers; `modelDown` switches that one off too. */
function steps(options: { withModel?: boolean; unsure?: boolean } = {}) {
  const state = { decisionDown: false, modelDown: false, decisionCalls: 0, modelCalls: 0, now: () => TEN_NOV };
  const standin = systemOneStandin({ decider: (name) => ({ choice: name === "intent" ? "greeting" : name === "service" ? "no_service" : "no_slot", p: options.unsure ? 0.4 : 0.95 }) });
  const viaStandin = systemOneFetch(standin, { down: () => state.decisionDown });
  const modelFetch = (async () => {
    state.modelCalls += 1;
    if (state.modelDown) throw new TypeError("the connection failed");
    return new Response(JSON.stringify(openaiReply(answer({ kind: "greeting", language: "en" }), { prompt_tokens: 2000, completion_tokens: 150 })), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  const router = createRouter({
    decision: { client: createSystemOne({ baseUrl: "http://decision.test", model: "laya", kind: "laya", timeoutMs: 1000 }, (async (...a: Parameters<typeof fetch>) => { state.decisionCalls += 1; return viaStandin(...a); }) as typeof fetch) },
    ...(options.withModel === false ? {} : { model: { parser: createModelParser({ wire: "openai", baseUrl: "http://model.test/v1", model: "deepseek-ai/DeepSeek-V4.1-Flash", timeoutMs: 1000 }, modelFetch), provider: "deepinfra", model: "deepseek-ai/DeepSeek-V4.1-Flash" } }),
    now: () => state.now(),
  });
  const w = createWorld({ nowMs: TEN_NOV, parser: router });
  state.now = () => w.clock.now();
  return { w, state };
}
const received = (w: ReturnType<typeof createWorld>) => w.record.entries().filter((e) => e.action === "receive_message");
const lines = (w: ReturnType<typeof createWorld>) => w.record.entries().filter((e) => e.action === "ai_mode");
const unclear = async (w: ReturnType<typeof createWorld>, n: number) => { for (let i = 0; i < n; i++) await w.say(UNCLEAR); };

test("three failures of the decision model while the language model answers: the fourth message does not wait for the decision model, and the record and status say so", async () => {
  const { w, state } = steps();
  state.decisionDown = true;
  await unclear(w, 3);
  assert.equal(state.decisionCalls, 3, "each of the first three asked the decision model and waited for its failure");
  assert.deepEqual(received(w).map((e) => [e.refs.step, e.refs.tried, e.refs.failed]), [["model", "rules+decision+model", "decision"], ["model", "rules+decision+model", "decision"], ["model", "rules+decision+model", "decision"]]);
  assert.equal(stateFor(w.store, w.clock.now(), IST).model, 3, "the language model read them, so the shop is not in button mode");

  const [line] = lines(w);
  assert.equal(lines(w).length, 1, "one line in the record, when the pause began");
  assert.deepEqual([line.refs.mode, line.refs.step, line.refs.reason, line.refs.until], ["step_paused", "decision", "failures", new Date(w.clock.now() + 10 * 60_000).toISOString()]);
  assert.match(line.notes, /3 times in 15 minutes/);
  assert.match(line.notes, /No customer or owner is told/);
  assert.deepEqual(summaryOf(w.store, {}, w.clock.now(), IST).paused, { decision: line.refs.until });
  assert.equal(summaryOf(w.store, {}, w.clock.now(), IST).mode, "ai");

  await w.say(UNCLEAR);
  const fourth = received(w)[3].refs;
  assert.deepEqual([fourth.step, fourth.tried, fourth.skipped, fourth.failed], ["model", "rules+model", "decision", undefined]);
  assert.equal(state.decisionCalls, 3, "the decision model was not asked, so nothing was waited for");
  assert.ok(Number(fourth.costMicroInr) > 0, "the message pays the language model's price, as before");
  assert.equal(w.textsTo(w.owner).length, 0, "the owner is not told: it is the builder's matter, and the record has it");
  assert.equal(lines(w).length, 1, "and the record is not filled with a line a message");
});

test("after the pause one message tries the decision model again: still down, it pauses again at once and says nothing new; back, it resumes and says so once", async () => {
  const { w, state } = steps();
  state.decisionDown = true;
  await unclear(w, 3);
  await w.advance(10);
  await w.say(UNCLEAR); // the try
  assert.equal(state.decisionCalls, 4);
  assert.equal(received(w)[3].refs.failed, "decision");
  await w.say(UNCLEAR); // paused again at once, not after three more failures
  assert.equal(state.decisionCalls, 4);
  assert.equal(received(w)[4].refs.skipped, "decision");
  assert.equal(lines(w).length, 1, "the outage was announced when it began");

  await w.advance(10);
  state.decisionDown = false;
  await w.say(UNCLEAR); // the second try works
  assert.equal(state.decisionCalls, 5);
  const resumed = lines(w);
  assert.equal(resumed.length, 2);
  assert.deepEqual([resumed[1].refs.mode, resumed[1].refs.step], ["step_resumed", "decision"]);
  assert.deepEqual(summaryOf(w.store, {}, w.clock.now(), IST).paused, { decision: null });
  await w.say(UNCLEAR, { from: OTHER_CUSTOMER });
  assert.equal(state.decisionCalls, 6, "the decision model is asked first again");
  assert.equal(received(w)[6].refs.step, "decision");
  assert.equal(lines(w).length, 2);
});

test("an unsure decision model is not a failing one: no pause, however many messages it hands on", async () => {
  const { w, state } = steps({ unsure: true });
  await unclear(w, 6);
  assert.equal(state.decisionCalls, 6);
  assert.equal(lines(w).length, 0);
  assert.deepEqual(summaryOf(w.store, {}, w.clock.now(), IST).paused, { decision: null });
});

test("with no language model after it, a failing decision model is never skipped: the existing fault path (button mode) is what answers", async () => {
  const { w, state } = steps({ withModel: false });
  state.decisionDown = true;
  await w.say(UNCLEAR);
  const first = lines(w);
  assert.equal(first.length, 1);
  assert.equal(first[0].refs.reason, "fault", "button mode, as it always was");
  assert.deepEqual(summaryOf(w.store, {}, w.clock.now(), IST).paused, { decision: null }, "no step pause: there is nothing after it to ask instead");
  await w.advance(6);
  for (let i = 0; i < 4; i++) await w.say(UNCLEAR);
  assert.ok(state.decisionCalls >= 2, "it is asked again once the five-minute fault pause is over, and every failure is a fault, never a skip");
  assert.ok(received(w).every((e) => e.refs.skipped === undefined));
});

test("both models down is still the fault: button mode, as before; the pause on the decision model does not hide it", async () => {
  const { w, state } = steps();
  state.decisionDown = true;
  state.modelDown = true;
  await w.say(UNCLEAR);
  assert.equal(lines(w).filter((e) => e.refs.mode === "buttons").length, 1);
  assert.equal(summaryOf(w.store, {}, w.clock.now(), IST).mode, "buttons");
  assert.equal(summaryOf(w.store, {}, w.clock.now(), IST).reason, "fault");
});

test("a full outage over several fault cycles never writes a step pause: it would say the language model reads each message while it is down too", async () => {
  const { w, state } = steps();
  state.decisionDown = true;
  state.modelDown = true;
  for (let cycle = 0; cycle < 4; cycle++) {
    await w.say(UNCLEAR); // asks both, both fail: the fault pause (5 minutes of buttons) starts
    await w.advance(6); // the fault pause is over, so the next message tries both again: failures at 0, 6, 12 and 18 minutes
  }
  assert.equal(state.decisionCalls, 4, "each cycle asked the decision model, and none of them was skipped");
  assert.equal(lines(w).filter((e) => e.refs.mode === "step_paused" || e.refs.mode === "step_resumed").length, 0);
  assert.ok(received(w).every((e) => e.refs.skipped === undefined));
  assert.deepEqual(summaryOf(w.store, {}, w.clock.now(), IST).paused, { decision: null });
  assert.equal(lines(w).filter((e) => e.refs.reason === "fault").length, 1, "only the fault line, once a day");
});
