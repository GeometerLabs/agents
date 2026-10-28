import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { cfg, giveCode } from "../src/tools.ts";
import { startService } from "./fake.ts";

let svc: Awaited<ReturnType<typeof startService>>;
beforeEach(async () => { svc = await startService(); cfg.url = svc.url; });
afterEach(() => svc.close());

test("a viewer gets one code per campaign", async () => {
  await giveCode("camp-spring", "viewer1");
  assert.match(String(await giveCode("camp-spring", "viewer1")), /already given/);
  assert.equal(svc.posts.length, 1);
});

test("a draft campaign gives no code", async () => {
  assert.match(String(await giveCode("camp-mystery", "viewer1")), /not approved/);
  assert.equal(svc.posts.length, 0);
});

test("a big giveaway waits for a person", async () => {
  assert.match(String(await giveCode("camp-launch", "viewer1", 10)), /held/);
  assert.equal(svc.posts.length, 0);
  await giveCode("camp-launch", "viewer1", 10, "person-1");
  assert.equal(svc.posts[0].approval, "person-1");
});

test("a lost reply is not given twice", async () => {
  svc.drop.reply = true;
  await giveCode("camp-spring", "viewer2");
  await giveCode("camp-spring", "viewer2");
  assert.equal(svc.posts.length, 1);
});
