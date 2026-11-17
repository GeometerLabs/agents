// The talk call (modules/understanding/talk.ts, and askJson in model-llm.ts): both wires, no key from here, a timeout, tokens and cost from the dated rate table, and a reason
// (never the model's words) when there is no usable answer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTalkModel } from "../talk.ts";
import { askJson } from "../model-llm.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const CALL = { system: "S", user: "U", schema: { type: "object" } };

test("the openai wire: one JSON call, no key, tokens read, cost from the table", async () => {
  let seen: { url: string; headers: Record<string, string>; body: Record<string, unknown> } | undefined;
  const fetchFn = (async (url: string, init: RequestInit) => { seen = { url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) }; return json({ choices: [{ message: { content: '{"sentences":[]}' }, finish_reason: "stop" }], usage: { prompt_tokens: 3000, completion_tokens: 300 } }); }) as typeof fetch;
  const talk = createTalkModel({ config: { wire: "openai", baseUrl: "http://guard/model/v1", model: "deepseek-ai/DeepSeek-V3.2" }, provider: "deepinfra", now: () => Date.UTC(2026, 10, 17), fetchFn });
  const r = await talk.ask(CALL);
  assert.deepEqual(r.answer, { sentences: [] });
  assert.equal(seen!.url, "http://guard/model/v1/chat/completions");
  assert.equal(seen!.headers.authorization, undefined, "no key from here");
  assert.equal(seen!.body.model, "deepseek-ai/DeepSeek-V3.2");
  assert.deepEqual(r.usage, { inputTokens: 3000, outputTokens: 300 });
  assert.ok(r.costMicroInr === null || r.costMicroInr > 0, "priced from the table, or unknown (never 0)");
  assert.equal(r.provider, "deepinfra");
});

test("the anthropic wire", async () => {
  let url = "";
  const fetchFn = (async (u: string) => { url = u; return json({ content: [{ type: "text", text: '{"sentences":[{"text":"hi","sources":[]}]}' }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 } }); }) as typeof fetch;
  const r = await createTalkModel({ config: { wire: "anthropic", baseUrl: "https://guard", model: "m" }, provider: "anthropic", now: () => 0, fetchFn }).ask(CALL);
  assert.equal(url, "https://guard/v1/messages");
  assert.deepEqual(r.usage, { inputTokens: 10, outputTokens: 5 });
});

test("no answer: an HTTP error, a cut-off, text that is not JSON, a timeout; the reason never holds the model's words", async () => {
  const cases: [string, typeof fetch][] = [
    ["HTTP 500", (async () => json({}, 500)) as typeof fetch],
    ["cut off", (async () => json({ choices: [{ message: { content: "{" }, finish_reason: "length" }] })) as typeof fetch],
    ["not JSON", (async () => json({ choices: [{ message: { content: "I am sure the owner agreed" }, finish_reason: "stop" }] })) as typeof fetch],
    ["timeout", (async () => { throw Object.assign(new Error("t"), { name: "TimeoutError" }); }) as typeof fetch],
  ];
  for (const [name, fetchFn] of cases) {
    const r = await askJson({ wire: "openai", baseUrl: "http://g/v1", model: "m", timeoutMs: 50 }, CALL, fetchFn);
    assert.equal(r.answer, undefined, name);
    assert.ok(r.reason && !/owner agreed/u.test(r.reason), name);
  }
});

test("an answer in a code fence or after thinking is read", async () => {
  const fetchFn = (async () => json({ choices: [{ message: { content: '<think>hmm</think>```json\n{"a":1}\n```' }, finish_reason: "stop" }] })) as typeof fetch;
  assert.deepEqual((await askJson({ wire: "openai", baseUrl: "http://g/v1", model: "m" }, CALL, fetchFn)).answer, { a: 1 });
});
