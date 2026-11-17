// The bundle writes runtime.json's `talk` block (bundle/generate/shop.ts withTalk): the server's model Guard, this agent's credential, the provider the rate table prices; only if
// the pinned template's own validator accepts it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { withTalk } from "../generate/shop.ts";

const model = { wire: "openai", model: "deepseek-ai/DeepSeek-V3.2", upstream: "api.deepinfra.com:443" } as never;
const runtime = { mode: "live", parser: { wire: "openai", model: "deepseek-ai/DeepSeek-V3.2" } };

test("the block is written through the model Guard when the validator accepts it", () => {
  const notes: string[] = [];
  const out = withTalk(runtime, { wire: "openai", model: "deepseek-ai/DeepSeek-V3.2", timeoutMs: 15000 }, model, () => ({ ok: true }), notes);
  const talk = out.talk as Record<string, unknown>;
  assert.equal(talk.model, "deepseek-ai/DeepSeek-V3.2");
  assert.equal(talk.timeoutMs, 15000);
  assert.match(String(talk.agentTokenFile), /agent_model$/u);
  assert.equal(talk.provider, "deepinfra");
  assert.deepEqual(notes, []);
});

test("a template version that refuses the key is left as it was, with a note", () => {
  const notes: string[] = [];
  const out = withTalk(runtime, { wire: "openai", model: "deepseek-ai/DeepSeek-V3.2" }, model, (c) => ({ ok: !("talk" in (c as object)) }), notes);
  assert.equal("talk" in out, false);
  assert.equal(notes.length, 1);
});

test("nothing asked for, nothing written", () => {
  assert.equal(withTalk(runtime, undefined, model, () => ({ ok: true }), []), runtime);
});
