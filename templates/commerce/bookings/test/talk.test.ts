// The shop's talk on a Bookings shop (block M): a customer's words the rules and the router cannot read are answered from what the shop may tell customers, with the template's
// own list of services; a reply that fails a check never goes and the customer gets the template's usual menu; with no talk model, or with customers' talk off, nothing changes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CUSTOMER, createWorld } from "../src/harness.ts";
import { parseSettings, serviceName } from "../src/settings.ts";
import { bookingsSkill } from "../src/assistant.ts";
import type { TalkModel } from "../../../../modules/understanding/talk.ts";

const glow = () => JSON.parse(readFileSync(new URL("../settings/glow-salon.example.json", import.meta.url), "utf8")) as Record<string, unknown>;
const script = (sentences: { text: string; sources: string[] }[]): { model: TalkModel; calls: string[] } => {
  const calls: string[] = [];
  return { calls, model: { async ask(call) { calls.push(call.system); return { answer: { sentences, ask_owner: false }, usage: { inputTokens: 900, outputTokens: 120 }, costMicroInr: 4000, rateDate: "2026-11-07", provider: "fake", model: "fake", latencyMs: 1 }; } } };
};
const QUESTION = "do you also do anything about the weather";

test("an unreadable customer message is answered from the shop's settings, with the template's service list", async () => {
  const settings = parseSettings({ ...glow(), assistant: {} });
  const svc = settings.services[0];
  const { model, calls } = script([{ text: `${serviceName(svc, "en")} is ₹${svc.priceInr}.`, sources: [`s:svc:${svc.id}`] }]);
  const w = createWorld({ settings, talker: model });
  await w.say(QUESTION);
  const last = w.messaging.sentTo(CUSTOMER).at(-1)!;
  assert.match(last.text, new RegExp(`${serviceName(svc, "en")} is ₹${svc.priceInr}\\.`, "u"));
  assert.ok(last.interactive?.list, "the template's own list of services goes with it");
  assert.equal(calls.length, 1);
  assert.equal(w.record.entries().filter((e) => e.action === "talk" && e.refs.role === "customer").length, 1);
  assert.ok(!JSON.stringify(w.record.entries().filter((e) => e.action === "talk")).includes("weather"), "never the customer's words");
  assert.ok((w.store.ai?.costMicroInr ?? 0) >= 4000, "counted in the month's AI spend");
});

test("a reply that says something is booked is not sent: the customer gets the template's usual menu", async () => {
  const w = createWorld({ settings: parseSettings({ ...glow(), assistant: {} }), talker: script([{ text: "Your haircut is booked.", sources: [] }]).model });
  await w.say(QUESTION);
  const last = w.messaging.sentTo(CUSTOMER).at(-1)!;
  assert.ok(!/booked/u.test(last.text));
  assert.match(last.text, /Sorry, I didn't catch that/u);
});

test("no talk model, or customers' talk off: the usual menu, no call", async () => {
  const { model, calls } = script([{ text: "How can I help?", sources: [] }]);
  const off = createWorld({ settings: parseSettings({ ...glow(), assistant: { talk: { customers: false } } }), talker: model });
  await off.say(QUESTION);
  assert.match(off.lastTextTo(CUSTOMER), /Sorry, I didn't catch that/u);
  const none = createWorld({ settings: parseSettings({ ...glow(), assistant: {} }) });
  await none.say(QUESTION);
  assert.match(none.lastTextTo(CUSTOMER), /Sorry, I didn't catch that/u);
  assert.equal(calls.length, 0);
});

test("the public context holds the shop's settings, free times and this customer's own booking, and the owner's facts hold counts only", async () => {
  const w = createWorld({ settings: parseSettings({ ...glow(), assistant: {} }) });
  await w.say("haircut tomorrow at 6pm");
  const skill = bookingsSkill({ settings: w.settings, store: w.store, nowMs: () => w.clock.now(), entries: () => w.record.entries(), optedOut: () => false });
  const ctx = skill.publicContext!(CUSTOMER, w.clock.now());
  const ids = ctx.sources.map((s) => s.id);
  for (const id of ["s:shop", "s:hours", "s:deposit", "r:free", "r:case"]) assert.ok(ids.includes(id), id);
  assert.ok(ids.some((id) => id.startsWith("s:svc:")));
  assert.ok(!skill.publicContext!("+919222222222", w.clock.now()).sources.some((s) => s.id === "r:case"), "another customer has no case of this one's");
  const facts = JSON.stringify(skill.facts!(w.clock.now()));
  assert.ok(!facts.includes(CUSTOMER.replace("+", "")), "no customer's number in the owner's numbers");
});
