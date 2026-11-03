// The eval script (scripts/model-eval.ts): baseline-only without keys, a candidate against a local stub server, and the
// scoring. No test calls a real model, and none reads a key: the keys come from the test, never from a .env.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import type { Intent } from "../src/adapters/model.ts";
import { LANGUAGES } from "../src/settings.ts";
import { compareIntent, costPer1000, percentile, summarise } from "../scripts/eval-score.ts";
import { loadMessages, pickMessages, runEval } from "../scripts/model-eval.ts";
import type { Candidate } from "../scripts/model-eval.ts";
import { anthropicReply, openaiReply, startStubModel } from "./stub-model-server.ts";
import type { StubModel, StubReply, StubRequest } from "./stub-model-server.ts";

const messages = loadMessages();
const byText = new Map(messages.map((m) => [m.text, m.expected]));
const noNetwork = (() => { throw new Error("the network must not be touched"); }) as unknown as typeof fetch;

const stubs: StubModel[] = [];
after(async () => { for (const s of stubs) await s.close(); });

const candidate = (more: Partial<Candidate> & Pick<Candidate, "name" | "wire" | "baseUrl">): Candidate => ({
  model: "stub-model", keyEnv: "STUB_KEY", priceInputPerMillion: null, priceOutputPerMillion: null, ...more,
});
/** The model's answer for an Intent: every field present, null for what is not there. */
function fullAnswer(e: Intent): string {
  return JSON.stringify({
    kind: e.kind, language: e.language ?? null, serviceId: e.serviceId ?? null, offerInr: e.offerInr ?? null, date: e.date ?? null,
    time: e.time ? { hour: e.time.hour, minute: e.time.minute, period: e.time.period ?? null } : null, overrideAttempt: e.overrideAttempt === true,
  });
}
/** A model that reads every eval message perfectly. */
const perfect = (wire: "openai" | "anthropic") => (request: StubRequest): StubReply => {
  const text = request.body.messages[request.body.messages.length - 1].content;
  const answer = fullAnswer(byText.get(text) as Intent);
  return { json: wire === "anthropic" ? anthropicReply(answer) : openaiReply(answer) };
};
const run = (options: Parameters<typeof runEval>[0]) => {
  const lines: string[] = [];
  return runEval({ resultsPath: null, log: (l) => lines.push(l), ...options }).then((result) => ({ ...result, output: lines.join("\n") }));
};

// ---- the eval set itself ------------------------------------------------------------------------------------------------------

test("the eval set: about 30 messages in each language, every label valid, every kind covered in each language", () => {
  const file = readFileSync(new URL("../eval/messages.jsonl", import.meta.url), "utf8");
  assert.match(file.split("\n")[0], /^# Machine-written.*NEEDS NATIVE REVIEW/);
  for (const language of LANGUAGES) {
    const mine = messages.filter((m) => m.language === language);
    assert.ok(mine.length >= 30 && mine.length <= 40, `${language}: ${mine.length}`);
    for (const kind of ["book", "cancel", "reschedule", "yes", "no", "stop", "greeting"]) assert.ok(mine.some((m) => m.expected.kind === kind), `${language} has no ${kind}`);
    assert.ok(mine.some((m) => m.expected.overrideAttempt), `${language} has no trick message`);
    assert.ok(mine.some((m) => m.expected.offerInr === 0), `${language} has no "free"`);
    assert.ok(mine.some((m) => m.expected.offerInr !== undefined && m.expected.offerInr > 0), `${language} has no haggle`);
    for (const which of ["next", "this", "plain"]) assert.ok(mine.some((m) => m.expected.date?.kind === "weekday" && m.expected.date.which === which), `${language} has no ${which} weekday`);
    assert.ok(mine.some((m) => m.expected.date?.kind === "relative" && m.expected.date.offsetDays === 2), `${language} has no day after tomorrow`);
    assert.ok(mine.some((m) => m.expected.date?.kind === "calendar"), `${language} has no written date`);
    assert.ok(mine.some((m) => /^[\x00-\x7f]+$/.test(m.text)) || language === "en", `${language} has no Latin-letter message`);
  }
  assert.ok(messages.every((m) => m.id.startsWith(`${m.language}-`)));
});

test("max-messages takes messages in turn from each language", () => {
  const picked = pickMessages(messages, 10);
  assert.equal(picked.length, 10);
  assert.deepEqual(LANGUAGES.map((l) => picked.filter((m) => m.language === l).length).sort(), [2, 2, 3, 3]);
  assert.equal(pickMessages(messages, 1000).length, messages.length);
});

test("models.json: every candidate is complete, no price is invented and no key is in the file", () => {
  const text = readFileSync(new URL("../eval/models.json", import.meta.url), "utf8");
  const { candidates } = JSON.parse(text) as { candidates: Candidate[] };
  assert.ok(candidates.length >= 2);
  for (const c of candidates) {
    for (const field of ["name", "wire", "baseUrl", "model", "keyEnv"] as const) assert.equal(typeof c[field], "string", `${c.name} ${field}`);
    assert.ok(["openai", "anthropic"].includes(c.wire));
    assert.match(c.keyEnv, /^[A-Z][A-Z0-9_]+$/);
    assert.equal(c.priceInputPerMillion, null, `${c.name}: fill prices from the provider's current price page, not from memory`);
    assert.equal(c.priceOutputPerMillion, null);
    assert.match(c.note ?? "", /price/i);
  }
  assert.ok(!/sk-[A-Za-z0-9]{10}|AIza[0-9A-Za-z_-]{20}|Bearer [A-Za-z0-9]{20}/.test(text), "a key must never be in models.json");
  assert.match(readFileSync(new URL("../eval/.gitignore", import.meta.url), "utf8"), /^results\.json$/m);
});

// ---- scoring ------------------------------------------------------------------------------------------------------------------

test("scoring: 6 pm and 18:00 are the same time, an unconfirmed 6 is not, and a missing trick flag means no trick", () => {
  const six = { kind: "book" as const, time: { hour: 6, minute: 0, period: "pm" as const } };
  assert.equal(compareIntent(six, { kind: "book", time: { hour: 18, minute: 0 } }).time, true);
  assert.equal(compareIntent(six, { kind: "book", time: { hour: 6, minute: 0 } }).time, false);
  assert.equal(compareIntent(six, { kind: "book", time: { hour: 6, minute: 30, period: "pm" } }).time, false);
  assert.equal(compareIntent({ kind: "book", time: { hour: 12, minute: 0 } }, { kind: "book", time: { hour: 12, minute: 0, period: "pm" } }).time, true);
  assert.equal(compareIntent({ kind: "book" }, { kind: "book", overrideAttempt: false }).overrideAttempt, true);
  assert.equal(compareIntent({ kind: "book", overrideAttempt: true }, { kind: "book" }).overrideAttempt, false);
  assert.equal(compareIntent({ kind: "book", date: { kind: "weekday", weekday: 2, which: "next" } }, { kind: "book", date: { kind: "weekday", weekday: 2, which: "plain" } }).date, false);
  assert.equal(compareIntent({ kind: "book", serviceId: "facial" }, { kind: "book" }).serviceId, false);
  assert.equal(compareIntent({ kind: "book", offerInr: 0 }, { kind: "book" }).offerInr, false);
});

test("scoring: percentiles, and cost from the tokens the API reported", () => {
  assert.equal(percentile([], 50), 0);
  assert.equal(percentile([10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 50), 50);
  assert.equal(percentile([10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 95), 100);
  const row = (n: number, usage: { inputTokens: number; outputTokens: number }) => ({ id: `en-${n}`, language: "en" as const, fields: { kind: true, serviceId: true, date: true, time: true, offerInr: true, overrideAttempt: true }, allRight: true, fellBack: false, latencyMs: 100, usage });
  const s = summarise("m", [row(1, { inputTokens: 1000, outputTokens: 100 }), row(2, { inputTokens: 1000, outputTokens: 100 })]);
  assert.equal(s.tokensIn, 2000);
  assert.equal(costPer1000(s, 1, 4), (1000 * 1 + 100 * 4) / 1_000_000 * 1000); // $1.40 per 1,000 messages
  assert.equal(costPer1000(s, null, 4), null);
});

// ---- the script ---------------------------------------------------------------------------------------------------------------

test("with no keys the eval runs the rule parser baseline only, skips every candidate and touches no network", async () => {
  const models = [candidate({ name: "stub-openai", wire: "openai", baseUrl: "http://127.0.0.1:1" }), candidate({ name: "stub-anthropic", wire: "anthropic", baseUrl: "http://127.0.0.1:1", keyEnv: "OTHER_KEY" })];
  const { summaries, skipped, output } = await run({ env: {}, models, fetchFn: noNetwork });
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].name, "rule parser");
  assert.equal(summaries[0].messages, messages.length);
  assert.deepEqual(skipped, ["Skipped stub-openai: no STUB_KEY in .env.", "Skipped stub-anthropic: no OTHER_KEY in .env."]);
  assert.match(output, /only the rule parser baseline ran/);
  assert.match(output, /Skipped stub-openai: no STUB_KEY in \.env\./);
  assert.match(output, /all six fields right/);
  assert.match(output, /hi messages/);
  assert.match(output, /field overrideAttempt/);
  // The rule parser reads most of these, and is not perfect: the eval has something to tell a better model apart from.
  const ratio = summaries[0].right / summaries[0].messages;
  assert.ok(ratio > 0.7 && ratio < 1, `${ratio}`);
});

test("run from the command line with --baseline-only, it prints the baseline and writes nothing", () => {
  const out = execFileSync(process.execPath, [new URL("../scripts/model-eval.ts", import.meta.url).pathname, "--baseline-only", "--no-results"], { encoding: "utf8" });
  assert.match(out, /Bookings model eval/);
  assert.match(out, /rule parser/);
  assert.match(out, /Missed by rule parser:/);
});

for (const wire of ["openai", "anthropic"] as const) {
  test(`${wire} candidate against a stub: key sent by the eval only, max-messages honoured, cost from the reported tokens`, async () => {
    const s = await startStubModel(perfect(wire));
    stubs.push(s);
    const models = [candidate({ name: "stub-model", wire, baseUrl: s.url, priceInputPerMillion: 1, priceOutputPerMillion: 2 })];
    const { summaries, output } = await run({ env: { STUB_KEY: "test-key" }, models, maxMessages: 8 });
    assert.equal(s.requests.length, 8);
    assert.deepEqual(LANGUAGES.map((l) => s.requests.filter((r) => messages.find((m) => m.text === r.body.messages.at(-1).content)?.language === l).length), [2, 2, 2, 2]);
    for (const r of s.requests) {
      if (wire === "openai") assert.equal(r.headers.authorization, "Bearer test-key");
      else { assert.equal(r.headers["x-api-key"], "test-key"); assert.equal(r.headers.authorization, undefined); }
    }
    assert.equal(summaries[1].right, 8);
    assert.equal(summaries[1].fallbacks, 0);
    assert.equal(summaries[1].tokensIn, 7200);
    assert.equal(summaries[1].tokensOut, 480);
    assert.match(output, /1\.0200/); // (900 x 1 + 60 x 2) per million, times 1,000 messages
    assert.match(output, /Tokens used by this run: 7200 in, 480 out, over 8 calls/);
    assert.match(output, /Missed by stub-model: none/);
  });
}

test("a model that fails every time counts as fallbacks, with the reasons listed, and shows no price when none is set", async () => {
  const s = await startStubModel(() => ({ status: 500, raw: "boom" }));
  stubs.push(s);
  const models = [candidate({ name: "broken", wire: "openai", baseUrl: s.url })];
  const { summaries, output } = await run({ env: { STUB_KEY: "k" }, models, maxMessages: 8 });
  assert.equal(summaries[1].fallbacks, 8);
  assert.equal(summaries[1].answered, 0);
  assert.match(output, /fell back 8 times: the model answered HTTP 500 \(8\)/);
  assert.match(output, /no price set/);
  assert.match(output, /No price filled in for broken/);
});

test("--only runs just the named candidates", async () => {
  const s = await startStubModel(perfect("openai"));
  stubs.push(s);
  const models = [candidate({ name: "a", wire: "openai", baseUrl: s.url }), candidate({ name: "b", wire: "openai", baseUrl: s.url })];
  const { summaries } = await run({ env: { STUB_KEY: "k" }, models, maxMessages: 4, only: ["b"] });
  assert.deepEqual(summaries.map((x) => x.name), ["rule parser", "b"]);
  assert.equal(s.requests.length, 4);
});
