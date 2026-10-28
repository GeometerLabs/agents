import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { cfg, discardSample, runStep } from "../src/lab.ts";
import { startService } from "./fake.ts";

let svc: Awaited<ReturnType<typeof startService>>;
beforeEach(async () => { svc = await startService(); cfg.url = svc.url; });
afterEach(() => svc.close());

test("a step runs once per sample", async () => {
  await runStep("s-1", "incubate");
  assert.match(String(await runStep("s-1", "incubate")), /already run/);
  assert.equal(svc.posts.length, 1);
});

test("a different step on the same sample is a different step", async () => {
  await runStep("s-1", "incubate");
  await runStep("s-1", "centrifuge");
  assert.equal(svc.posts.length, 2);
});

test("a discard waits for a scientist", async () => {
  assert.match(String(await discardSample("s-2")), /held/);
  assert.equal(svc.posts.length, 0);
  await discardSample("s-2", "sci-4");
  assert.equal(svc.posts[0].approval, "sci-4");
});

test("a lost reply does not run the step twice", async () => {
  svc.drop.reply = true;
  await runStep("s-3", "incubate");
  await runStep("s-3", "incubate");
  assert.equal(svc.posts.length, 1);
});
