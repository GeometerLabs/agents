// The agent runs end to end with a scripted model in place of a real one: its tool call goes through the AI SDK
// to the real tool, which calls the (local) service.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MockLanguageModelV4 } from "ai/test";
import { operatorTools, reply, tools } from "../src/agent.ts";
import { cfg } from "../src/tools.ts";
import { startService } from "./fake.ts";

const usage = { inputTokens: { total: 1 }, outputTokens: { total: 1 } };

test("a chat request becomes one give_code call", async () => {
  const svc = await startService();
  cfg.url = svc.url;
  let turn = 0;
  const model = new MockLanguageModelV4({
    doGenerate: async () => ({
      content: turn++ === 0
        ? [{ type: "tool-call", toolCallId: "c1", toolName: "give_code", input: JSON.stringify({ campaign: "camp-spring", viewer: "viewer1" }) }]
        : [{ type: "text", text: "Enjoy your code!" }],
      finishReason: { unified: turn === 1 ? "tool-calls" : "stop", raw: undefined },
      usage,
      warnings: [],
    }),
  });
  assert.equal(await reply("code please", model as any), "Enjoy your code!");
  assert.equal(svc.posts.length, 1);
  svc.close();
});

test("the model is offered only the two giveaway tools", () => {
  assert.deepEqual(Object.keys(tools), ["lookup_campaign", "give_code"]);
});

test("the export tool exists only in the operator's set", () => {
  assert.ok("export_codes" in operatorTools && !("export_codes" in tools));
});
