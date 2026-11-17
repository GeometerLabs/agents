// The shop's talk on an Orders shop (block M): see Bookings' test/talk.test.ts. The customer's words the rules cannot read are answered from the menu and rules the shop
// has published, with the template's own list of items; the owner's numbers hold counts and money only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AMIT, createWorld } from "../src/harness.ts";
import { parseSettings, itemName } from "../src/settings.ts";
import { ordersSkill } from "../src/assistant.ts";
import type { TalkModel } from "../../../../modules/understanding/talk.ts";

const annapurna = () => JSON.parse(readFileSync(new URL("../settings/annapurna-tiffins-razorpay.example.json", import.meta.url), "utf8")) as Record<string, unknown>;
const script = (sentences: { text: string; sources: string[] }[]): TalkModel => ({ async ask() { return { answer: { sentences, ask_owner: false }, usage: { inputTokens: 900, outputTokens: 120 }, costMicroInr: 4000, rateDate: null, provider: "fake", model: "fake", latencyMs: 1 }; } });
const QUESTION = "is the sky blue today";

test("an unreadable message is answered from the shop's menu, with the template's item list", async () => {
  const settings = parseSettings({ ...annapurna(), assistant: {} });
  const item = settings.menu[0];
  const w = createWorld({ settings, talker: script([{ text: `${itemName(item, "en")} is ₹${item.priceInr} each.`, sources: [`s:item:${item.id}`] }]) });
  await w.say(QUESTION, { from: AMIT });
  const last = w.messaging.sentTo(AMIT).at(-1)!;
  assert.match(last.text, new RegExp(`is ₹${item.priceInr} each\\.`, "u"));
  assert.ok(last.interactive?.list);
});

test("a reply that promises or says something is done is not sent", async () => {
  for (const text of ["Your order is confirmed.", "The owner guarantees delivery."]) {
    const w = createWorld({ settings: parseSettings({ ...annapurna(), assistant: {} }), talker: script([{ text, sources: [] }]) });
    await w.say(QUESTION, { from: AMIT });
    assert.ok(!w.lastTextTo(AMIT).includes(text), text);
  }
});

test("the owner's numbers are counts and money, with no customer in them", () => {
  const w = createWorld({ settings: parseSettings({ ...annapurna(), assistant: {} }) });
  const skill = ordersSkill({ settings: w.settings, store: w.store, nowMs: () => w.clock.now(), optedOut: () => false });
  const ids = skill.facts!(w.clock.now()).map((s) => s.id);
  assert.deepEqual(ids, ["r:today", "r:week", "r:weekdays", "r:top", "r:open"]);
});
