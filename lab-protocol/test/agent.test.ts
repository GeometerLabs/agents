// The tools run through Mastra's own tool objects against the local service, and the Mastra instance holds the agent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mastra } from "../src/mastra/index.ts";
import { discardSample, runStep } from "../src/mastra/tools/lab.ts";
import { cfg } from "../src/lab.ts";
import { startService } from "./fake.ts";

test("a step run through the Mastra tool happens once", async () => {
  const svc = await startService();
  cfg.url = svc.url;
  await runStep.execute!({ sample_id: "s-1", step: "incubate" }, {} as any);
  const again = await runStep.execute!({ sample_id: "s-1", step: "incubate" }, {} as any);
  assert.match(String(again), /already run/);
  assert.equal(svc.posts.length, 1);
  svc.close();
});

test("a discard through the Mastra tool is held without an approval id", async () => {
  const svc = await startService();
  cfg.url = svc.url;
  assert.match(String(await discardSample.execute!({ sample_id: "s-2", approval: "" }, {} as any)), /held/);
  assert.equal(svc.posts.length, 0);
  svc.close();
});

test("the Mastra instance holds the lab agent with its four tools", async () => {
  const tools = await mastra.getAgent("lab").listTools();
  assert.deepEqual(Object.keys(tools).sort(), ["discard_sample", "get_sample", "list_steps", "run_step"]);
});
