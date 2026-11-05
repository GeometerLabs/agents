// The cost of understanding a message, the monthly allowance, and button mode (B46, B47): what the record says for each step, when the agent stops asking a model
// and answers with buttons, who is told and how often, how the settings are read, and that a key is only ever sent where it was named. No test calls a real
// model or reads a key from the machine: the decision model is the System One stand-in, the language model is the stub server, and the keys are made up here.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorld, CUSTOMER, OTHER_CUSTOMER } from "../src/harness.ts";
import { fakeClock } from "../../../modules/core/clock.ts";
import { createModelParser } from "../src/adapters/model-llm.ts";
import { createSystemOne } from "../../../modules/understanding/system-one.ts";
import { createRouter } from "../src/adapters/understanding.ts";
import { modeOf, monthOf, stateFor, summaryOf } from "../../../modules/understanding/ai-state.ts";
import { createStore } from "../src/booking.ts";
import { zonedToMs } from "../../../modules/core/time.ts";
import { aiOverrideReader, validateRuntimeConfig } from "../server/config.ts";
import type { ClientFolder } from "../server/config.ts";
import { parseStore, serializeStore } from "../server/snapshot.ts";
import { buildUnderstanding, parserArguments } from "../server/start.ts";
import { startStandins } from "../standins/server.ts";
import { createKit } from "./runtime-kit.ts";
import { systemOneFetch, systemOneStandin } from "../../../modules/standins/system-one.ts";
import type { Decider } from "../../../modules/standins/system-one.ts";
import { answer, openaiReply, startStubModel } from "./stub-model-server.ts";

const IST = "Asia/Kolkata";
const TEN_NOV = zonedToMs({ year: 2026, month: 11, day: 10 }, { hour: 10, minute: 0 }, IST);
const UNCLEAR = "asdf qwer zxcv";
const closers: (() => Promise<void>)[] = [];
after(async () => { for (const c of closers) await c(); });

/** The three steps in one process. `decider` is what the decision model answers; `modelUsage` what the language model reports; `down` makes both fail. */
function steps(options: { decider?: Decider; modelUsage?: { prompt_tokens: number; completion_tokens: number }; modelId?: string; modelProvider?: string } = {}) {
  const decision = systemOneStandin({ decider: options.decider ?? ((name) => ({ choice: name === "intent" ? "greeting" : name === "service" ? "no_service" : "no_slot", p: 0.95 })) });
  const state = { down: false, decision: 0, model: 0, now: () => TEN_NOV };
  const viaStandin = systemOneFetch(decision, { down: () => state.down });
  const modelFetch = (async () => {
    state.model += 1;
    if (state.down) throw new TypeError("the connection failed");
    return new Response(JSON.stringify(openaiReply(answer({ kind: "greeting", language: "en" }), options.modelUsage ?? { prompt_tokens: 2000, completion_tokens: 150 })), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  const router = createRouter({
    decision: { client: createSystemOne({ baseUrl: "http://decision.test", model: "laya", kind: "laya", timeoutMs: 1000 }, (async (...a: Parameters<typeof fetch>) => { state.decision += 1; return viaStandin(...a); }) as typeof fetch) },
    model: { parser: createModelParser({ wire: "openai", baseUrl: "http://model.test/v1", model: options.modelId ?? "deepseek-ai/DeepSeek-V4.1-Flash", timeoutMs: 1000 }, modelFetch), provider: options.modelProvider ?? "deepinfra", model: options.modelId ?? "deepseek-ai/DeepSeek-V4.1-Flash" },
    now: () => state.now(),
  });
  return { decision, router, state };
}
const world = (s: ReturnType<typeof steps>, more: Parameters<typeof createWorld>[0] = {}) => {
  const w = createWorld({ nowMs: TEN_NOV, parser: s.router, ...more });
  s.state.now = () => w.clock.now();
  return w;
};
const received = (w: ReturnType<typeof createWorld>) => w.record.entries().filter((e) => e.action === "receive_message");
const modeEntries = (w: ReturnType<typeof createWorld>) => w.record.entries().filter((e) => e.action === "ai_mode");

// ---- what the record keeps ------------------------------------------------------------------------------------------------------------

test("each understood message records its step, provider, model, tokens, estimated cost in micro-rupees and the rate's date, in the existing record format", async () => {
  const s = steps({ decider: (name) => ({ choice: name === "intent" ? "greeting" : name === "service" ? "no_service" : "no_slot", p: 0.5 }), modelUsage: { prompt_tokens: 2000, completion_tokens: 150 } });
  const w = world(s);
  await w.say("hello"); // the rules
  await w.say(UNCLEAR, { from: OTHER_CUSTOMER }); // the decision model is unsure (0.5), so the language model reads it
  const [rules, model] = received(w);
  assert.deepEqual(rules.refs, { messageId: rules.refs.messageId, step: "rules", provider: "rules", model: "rule-parser", inputTokens: "0", outputTokens: "0", costMicroInr: "0", tried: "rules" });
  assert.deepEqual(Object.keys(model.refs).sort(), ["costMicroInr", "inputTokens", "messageId", "model", "outputTokens", "provider", "rateDate", "step", "tried"]);
  assert.equal(model.refs.step, "model");
  assert.equal(model.refs.provider, "deepinfra");
  assert.equal(model.refs.model, "deepseek-ai/DeepSeek-V4.1-Flash");
  assert.equal(model.refs.tried, "rules+decision+model");
  assert.equal(model.refs.rateDate, "2026-11-05");
  assert.equal(model.refs.outputTokens, "150");
  assert.ok(Number(model.refs.inputTokens) > 2000, "the decision call's tokens are in the total");
  assert.equal(model.refs.costMicroInr, "34104", "2,000 tokens in and 150 out at the DeepSeek V4.1 Flash price: about 3.4 paise");
  assert.ok(Object.values(model.refs).every((v) => typeof v === "string"), "refs hold strings");
});

test("a decision model answers at no cost to the shop but still records its tokens; a model with no price in the table is recorded with no cost, never 0", async () => {
  const s = steps();
  const w = world(s);
  await w.say(UNCLEAR);
  const d = received(w)[0].refs;
  assert.deepEqual([d.step, d.provider, d.model, d.costMicroInr, d.rateDate, d.tried], ["decision", "laya", "laya", "0", "2026-11-05", "rules+decision"]);
  assert.ok(Number(d.inputTokens) > 0);

  const unpriced = steps({ decider: (name) => ({ choice: name === "intent" ? "greeting" : "no_service", p: 0.5 }), modelId: "some-new-model", modelProvider: "somewhere" });
  const u = world(unpriced);
  await u.say(UNCLEAR);
  const refs = received(u)[0].refs;
  assert.equal(refs.step, "model");
  assert.ok(!("costMicroInr" in refs) && !("rateDate" in refs), "an unknown price is left out, so the cost meter shows it as unknown");
  assert.equal(stateFor(u.store, u.clock.now(), IST).unpriced, 1);
  assert.equal(stateFor(u.store, u.clock.now(), IST).costMicroInr, 0);
});

test("a price is dated: a record from before the rate table's first day is unpriced, not guessed", async () => {
  const s = steps();
  s.state.now = () => zonedToMs({ year: 2026, month: 11, day: 3 }, { hour: 10, minute: 0 }, IST);
  const w = createWorld({ parser: s.router }); // the world starts on 3 Nov, two days before the table's first rate
  await w.say(UNCLEAR);
  assert.ok(!("costMicroInr" in received(w)[0].refs));
});

test("when every model fails the record says which steps failed, and the cost still counts what was asked", async () => {
  const s = steps();
  const w = world(s);
  s.state.down = true;
  await w.say(UNCLEAR);
  const refs = received(w)[0].refs;
  assert.deepEqual([refs.step, refs.tried, refs.failed], ["rules", "rules+decision+model", "decision+model"]);
  assert.match(received(w)[0].notes, /the model could not be used/);
});

// ---- the allowance ---------------------------------------------------------------------------------------------------------------------------

test("the monthly allowance counts messages read by the decision and language models; when it is used up the models are not asked, the owner is told once, and a new month starts again", async () => {
  const s = steps();
  const w = world(s, { ai: { allowance: { messages: 2 } } });
  await w.say(UNCLEAR);
  assert.equal(modeOf(w.store, { allowance: { messages: 2 } }, w.clock.now(), IST).buttons, false);
  await w.say(UNCLEAR, { from: OTHER_CUSTOMER });
  assert.deepEqual(modeOf(w.store, { allowance: { messages: 2 } }, w.clock.now(), IST), { buttons: true, reason: "allowance" });
  assert.equal(w.textsTo(w.owner).length, 1);
  await w.say("hello"); // the rules; not counted
  await w.say(UNCLEAR);
  await w.say(UNCLEAR, { from: OTHER_CUSTOMER });
  assert.equal(s.state.decision, 2, "no model was asked after the allowance");
  assert.equal(w.textsTo(w.owner).length, 1, "the owner was told once, not at every message");
  assert.equal(modeEntries(w).length, 1);
  const summary = summaryOf(w.store, { allowance: { messages: 2 } }, w.clock.now(), IST);
  assert.deepEqual([summary.month, summary.messages, summary.mode, summary.reason, summary.allowance], ["2026-11", { rules: 3, decision: 2, model: 0 }, "buttons", "allowance", { messages: 2, costMicroInr: null }]);

  w.clock.set(zonedToMs({ year: 2026, month: 12, day: 1 }, { hour: 10, minute: 0 }, IST)); // a new month: the counts start again
  assert.equal(summaryOf(w.store, { allowance: { messages: 2 } }, w.clock.now(), IST).mode, "ai");
  await w.say(UNCLEAR);
  assert.equal(s.state.decision, 3, "the decision model is asked again");
});

test("the allowance can be a cost: priced calls add up in micro-rupees, and the one that crosses the line is the last", async () => {
  const s = steps({ decider: (name) => ({ choice: name === "intent" ? "greeting" : "no_service", p: 0.5 }) }); // unsure, so every message reaches the language model
  const policy = { allowance: { costMicroInr: 50_000 } };
  const w = world(s, { ai: policy });
  await w.say(UNCLEAR);
  assert.equal(modeOf(w.store, policy, w.clock.now(), IST).buttons, false, "34,104 is under 50,000");
  await w.say(UNCLEAR, { from: OTHER_CUSTOMER });
  assert.deepEqual(modeOf(w.store, policy, w.clock.now(), IST), { buttons: true, reason: "allowance" });
  assert.equal(stateFor(w.store, w.clock.now(), IST).costMicroInr, 68_208);
  await w.say(UNCLEAR);
  assert.equal(s.state.model, 2);
});

// ---- the outside switch ----------------------------------------------------------------------------------------------------------------------

test("the outside switch ai:buttons turns the models off at once, tells the owner once per switch, and answers every message", async () => {
  const s = steps();
  let flag: "auto" | "buttons" = "auto";
  const w = world(s, { ai: { override: () => flag } });
  await w.say(UNCLEAR);
  assert.equal(s.state.decision, 1);
  flag = "buttons";
  await w.say(UNCLEAR, { from: OTHER_CUSTOMER });
  await w.say(UNCLEAR);
  assert.equal(s.state.decision, 1, "not asked");
  assert.equal(w.textsTo(w.owner).length, 1);
  assert.deepEqual(modeEntries(w).map((e) => e.refs.reason), ["override"]);
  assert.ok(w.messaging.sentTo(CUSTOMER).length >= 2 && w.messaging.sentTo(OTHER_CUSTOMER).length >= 1);
  await w.tick(); // a beat between messages does not tell the owner again
  assert.equal(w.textsTo(w.owner).length, 1);
  flag = "auto";
  await w.say(UNCLEAR);
  assert.equal(s.state.decision, 2, "back on");
  flag = "buttons";
  await w.tick(); // switched off again: a new switch is announced again, even with no customer message
  assert.equal(w.textsTo(w.owner).length, 2);
});

// ---- a model that fails -------------------------------------------------------------------------------------------------------------------------

test("a failing model puts the agent on buttons for the pause and then tries again; the owner hears once a day", async () => {
  const s = steps();
  const w = world(s, { ai: { pauseMinutes: 2 } });
  s.state.down = true;
  await w.say(UNCLEAR);
  const asked = { decision: s.state.decision, model: s.state.model };
  assert.deepEqual(asked, { decision: 1, model: 1 });
  await w.advance(1);
  await w.say(UNCLEAR, { from: OTHER_CUSTOMER });
  assert.deepEqual({ decision: s.state.decision, model: s.state.model }, asked, "inside the pause nothing is asked");
  await w.advance(2);
  await w.say(UNCLEAR);
  assert.deepEqual({ decision: s.state.decision, model: s.state.model }, { decision: 2, model: 2 }, "after the pause it tries again, and fails again");
  assert.equal(w.textsTo(w.owner).length, 1, "the second failure on the same day is not told again");
  w.clock.set(w.clock.now() + 24 * 3_600_000);
  await w.advance(0);
  await w.say(UNCLEAR);
  assert.equal(w.textsTo(w.owner).length, 2, "the next day it is told again");
  s.state.down = false;
  await w.advance(3);
  await w.say(UNCLEAR);
  assert.equal(received(w).at(-1)!.refs.step, "decision", "and when the model is back it answers");
});

// ---- saved with the store -----------------------------------------------------------------------------------------------------------------------

test("the month's counts and the notices already sent are saved with the store, and a snapshot from before they existed still loads", () => {
  const store = createStore();
  const ai = stateFor(store, TEN_NOV, IST);
  ai.decision = 3; ai.costMicroInr = 123; ai.pausedUntilMs = 99; ai.told = { allowance: "2026-11", override: true, fault: "2026-11-10" };
  const back = parseStore(serializeStore(store));
  assert.deepEqual(back.ai, store.ai);
  const old = JSON.parse(serializeStore(createStore()));
  delete old.ai;
  assert.equal(parseStore(JSON.stringify(old)).ai, undefined);
  assert.equal(monthOf(TEN_NOV, IST), "2026-11");
});

// ---- the settings --------------------------------------------------------------------------------------------------------------------------------

test("runtime.json takes ai, decision, allowance and a key's NAME, and refuses a key itself, a key sent over plain http, and a paid service without its key's name", () => {
  const ok = validateRuntimeConfig({
    mode: "fakes", ai: "buttons", pauseMinutes: 3, allowance: { messages: 3000, costInr: 30 },
    decision: { provider: "laya", baseUrl: "http://127.0.0.1:8080", model: "laya", threshold: 0.8, languages: ["hi", "en", "ml"] },
    parser: { wire: "openai", baseUrl: "https://api.deepinfra.com/v1/openai", model: "deepseek-ai/DeepSeek-V4.1-Flash", provider: "deepinfra", keyEnv: "DEEPINFRA_API_KEY" },
  }, "/x");
  assert.ok(ok.ok, ok.ok ? "" : ok.errors.join("; "));
  if (ok.ok) assert.deepEqual([ok.config.ai, ok.config.allowance, ok.config.pauseMinutes, ok.config.parser?.keyEnv], ["buttons", { messages: 3000, costInr: 30 }, 3, "DEEPINFRA_API_KEY"]);
  const bad = (change: object) => { const r = validateRuntimeConfig({ mode: "fakes", ...change }, "/x"); return r.ok ? [] : r.errors; };
  assert.match(bad({ ai: "off" })[0], /"on".*"buttons"/);
  assert.ok(validateRuntimeConfig({ mode: "fakes", ai: "on" }, "/x").ok, 'the bundle may write "on"');
  assert.ok(!validateRuntimeConfig({ mode: "fakes", ai: "auto" }, "/x").ok, '"auto" is not a value');
  assert.match(bad({ decision: { provider: "jev", baseUrl: "https://j.example", model: "m" } })[0], /needs decision\.keyEnv/);
  assert.match(bad({ decision: { provider: "laya", baseUrl: "http://127.0.0.1:1", model: "m", apiKey: "sk-secret" } })[0], /decision\.apiKey is not allowed/);
  assert.ok(!bad({ decision: { provider: "laya", baseUrl: "http://127.0.0.1:1", model: "m", apiKey: "sk-secret" } }).join().includes("sk-secret"), "a refusal never repeats what was written");
  assert.match(bad({ decision: { provider: "jev", baseUrl: "http://far.example", model: "m", keyEnv: "JEV_API_KEY" } }).join(), /unencrypted/);
  assert.match(bad({ decision: { provider: "laya", baseUrl: "http://127.0.0.1:1", model: "m", keyEnv: "not a name" } }).join(), /NAME of an environment variable/);
  assert.match(bad({ parser: { wire: "openai", baseUrl: "https://x.example", model: "m", keyEnv: "K", agentTokenFile: "f" } }).join(), /not both/);
  assert.match(bad({ allowance: {} }).join(), /needs "messages", "costInr" or both/);
  assert.match(bad({ allowance: { messages: -1 } }).join(), /whole number/);
  assert.match(bad({ pauseMinutes: 0 }).join(), /pauseMinutes/);
  assert.match(bad({ decision: { provider: "laya", baseUrl: "http://127.0.0.1:1", model: "m", threshold: 0.4 } }).join(), /above 0\.5/);
});

test("the outside switch is read from runtime.json again whenever the file changes; a half-written file leaves the last answer", () => {
  const folder = mkdtempSync(join(tmpdir(), "geo-ai-"));
  after(() => rmSync(folder, { recursive: true, force: true }));
  const file = join(folder, "runtime.json");
  const write = (text: string, second: number) => { writeFileSync(file, text); utimesSync(file, second, second); };
  write('{"mode":"fakes"}', 1000);
  const read = aiOverrideReader(folder);
  assert.equal(read(), "auto");
  write('{"mode":"fakes","ai":"buttons"}', 2000);
  assert.equal(read(), "buttons");
  write('{"mode":"fakes","ai":', 3000);
  assert.equal(read(), "buttons", "a file caught in the middle of a write changes nothing");
  write('{"mode":"fakes","ai":"on"}', 4000);
  assert.equal(read(), "auto");
  write('{"mode":"fakes"}', 5000);
  assert.equal(read(), "auto");
});

// ---- keys ------------------------------------------------------------------------------------------------------------------------------------------

const client = (runtime: object, folder = "/nowhere"): ClientFolder => ({ name: "t", folder, settings: createWorld().settings, runtime: { mode: "fakes", host: "127.0.0.1", port: 0, dataDir: "/nowhere", tickSeconds: 30, ...runtime } as ClientFolder["runtime"], lock: { pathway: "bookings", version: "0.1.0" } });

test("a step whose key is named but not in the environment stays off, says so by the variable's name, and sends nothing; with the key it is sent only as a bearer token to that address", async () => {
  const lines: string[] = [];
  const clock = fakeClock(TEN_NOV);
  const stub = await startStubModel(() => ({ json: openaiReply(answer({ kind: "book", language: "en", serviceId: "haircut" })) }));
  closers.push(stub.close);
  const s = await startStandins({ razorpayWebhookSecret: "x", whatsappAppSecret: "y", systemOne: { requireKey: "made-up-jev-key", decider: (name) => ({ choice: name === "intent" ? "book" : name === "service" ? "haircut" : "no_slot", p: 0.9 }) } }, { port: 0 });
  closers.push(s.close);
  const runtime = {
    decision: { provider: "jev", baseUrl: s.url, model: "jev-1", keyEnv: "JEV_API_KEY" },
    parser: { wire: "openai", baseUrl: `${stub.url}/v1`, model: "deepseek-ai/DeepSeek-V4.1-Flash", provider: "deepinfra", keyEnv: "DEEPINFRA_API_KEY" },
  };
  const context = { services: createWorld().settings.services, languages: ["en" as const] };
  const off = buildUnderstanding(client(runtime), { clock, env: {}, log: (l) => lines.push(l) });
  assert.equal((await off.parser.parse(UNCLEAR, context)).kind, "unknown", "no key, no model: the rules read it");
  assert.equal(stub.requests.length + s.systemOne!.requests.length, 0, "nothing was sent to either service");
  assert.ok(lines.some((l) => l.includes("JEV_API_KEY")) && lines.some((l) => l.includes("DEEPINFRA_API_KEY")));

  lines.length = 0;
  const on = buildUnderstanding(client(runtime), { clock, env: { JEV_API_KEY: "made-up-jev-key", DEEPINFRA_API_KEY: "made-up-deepinfra-key" }, log: (l) => lines.push(l) });
  const read = await on.parser.parseDetailed!("kuch facial wagairah", context);
  assert.equal(read.understood?.step, "decision");
  assert.equal(s.systemOne!.requests[0].authorization, "Bearer made-up-jev-key");
  assert.ok(![...lines].join("\n").includes("made-up"), "a key is never logged");
  // the model parser's own fetch carries the key only as the Authorization header, to the configured address
  const [config, keyed] = parserArguments({ wire: "openai", baseUrl: `${stub.url}/v1`, model: "m", keyEnv: "DEEPINFRA_API_KEY" }, { DEEPINFRA_API_KEY: "made-up-deepinfra-key" });
  assert.ok(!JSON.stringify(config).includes("made-up"), "the key is not in the model's config");
  await createModelParser(config, keyed).parseDetailed("hello", context);
  assert.equal(stub.requests.at(-1)!.headers.authorization, "Bearer made-up-deepinfra-key");
});

test("a Guard-fronted model sends no key from here, as before; and with neither step configured the rule parser reads everything", () => {
  const [, keyless] = parserArguments({ wire: "openai", baseUrl: "http://guard.test/model/v1", model: "m" }, { DEEPINFRA_API_KEY: "made-up" });
  assert.equal(keyless, undefined);
  const plain = buildUnderstanding(client({}), { clock: fakeClock(TEN_NOV), env: {}, log: () => undefined });
  assert.equal(plain.parser.parseDetailed, undefined, "the plain rule parser");
  assert.equal(plain.ai.override?.(), "auto");
});

test("the runtime tells the builder once, in its log, when the agent moves to buttons, and /status counts the month", async () => {
  const kit = createKit();
  after(() => kit.cleanup());
  const lines: string[] = [];
  let flag: "auto" | "buttons" = "auto";
  const { runtime } = kit.open({ ai: { override: () => flag, allowance: { messages: 5 } }, log: (l) => lines.push(l) });
  await kit.say(runtime, "hello");
  assert.deepEqual(runtime.status().ai.messages, { rules: 1, decision: 0, model: 0 });
  assert.equal(runtime.status().ai.mode, "ai");
  assert.equal(lines.filter((l) => l.includes("answers with buttons")).length, 0);
  flag = "buttons";
  await kit.say(runtime, "hello again");
  await kit.say(runtime, "and again");
  assert.equal(lines.filter((l) => l.includes("answers with buttons")).length, 1, "once, not at every message");
  assert.ok(lines.some((l) => l.includes("(override)")));
  const ai = runtime.status().ai;
  assert.deepEqual([ai.mode, ai.reason, ai.allowance.messages], ["buttons", "override", 5]);
  assert.ok(!JSON.stringify(runtime.status()).includes("hello"), "counts only: no word of a message is in the status");
});
