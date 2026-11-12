// The cost meter and the shop's assistant (item 11e): what a model cost to read the owner's words is in the shop's AI spend (or counted as unpriced), but the owner's
// message is not a customer message, so the message count fleet bills by is unchanged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FIELDS, isOwnerAssistantRead, summarizeUsage, usageRatesFrom } from "../lib/usage.ts";
import { latestPriceList } from "../panel/cost.ts";

const RATES = usageRatesFrom([latestPriceList()]);
const read = (outcome: string, refs: Record<string, unknown>) => ({ seq: 1, time: "2026-11-12T03:00:00Z", conversation: "+919000000000", booking: null, action: "owner_assistant", inputsDigest: "d", outcome, decisions: [], language: "en", notes: "", refs });

test("the owner's words read by a model add to the spend, never to the customer messages", () => {
  const priced = read("confirmed", { [FIELDS.step]: "model", [FIELDS.provider]: "deepinfra", [FIELDS.model]: "m", [FIELDS.inputTokens]: "900", [FIELDS.outputTokens]: "10", [FIELDS.costMicroInr]: "1234", intent: "close_day" });
  const unpriced = read("confirmed", { [FIELDS.step]: "model", [FIELDS.provider]: "self", [FIELDS.model]: "x", [FIELDS.inputTokens]: "900", [FIELDS.outputTokens]: "10", intent: "day" });
  const rules = read("confirmed", { [FIELDS.step]: "rules", [FIELDS.costMicroInr]: "0", intent: "waiting" });
  assert.equal(isOwnerAssistantRead(priced), true);
  assert.equal(isOwnerAssistantRead(read("blocked", {})), false);
  const t = summarizeUsage([priced, unpriced, rules], RATES);
  assert.equal(t.messages, 0);
  assert.equal(t.modelMicroInr, 1234);
  assert.equal(t.unpriced, 1);
});
