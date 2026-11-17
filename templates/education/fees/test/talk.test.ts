// The shop's talk on a Fees centre (block M): a parent's words the rules cannot read are answered from the batches, fees and rules the centre has published and the parent's
// own open fee, with the template's own buttons; a student's name never goes in the model's prompt.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createWorld } from "../src/harness.ts";
import { parseSettings } from "../src/settings.ts";
import { feesSkill } from "../src/assistant.ts";
import type { TalkModel } from "../../../../modules/understanding/talk.ts";

const bright = () => JSON.parse(readFileSync(new URL("../settings/bright-tuition.example.json", import.meta.url), "utf8")) as Record<string, unknown>;
const script = (sentences: { text: string; sources: string[] }[], seen: string[] = []): TalkModel => ({ async ask(call) { seen.push(call.system); return { answer: { sentences, ask_owner: false }, usage: { inputTokens: 900, outputTokens: 120 }, costMicroInr: 4000, rateDate: null, provider: "fake", model: "fake", latencyMs: 1 }; } });

test("the context for a parent holds the batches and rules, and the parent's open fee without the student's name", () => {
  const w = createWorld({ settings: parseSettings({ ...bright(), assistant: {} }) });
  const due = [...w.store.dues.values()][0];
  const skill = feesSkill({ settings: w.settings, store: w.store, nowMs: () => w.clock.now(), optedOut: () => false });
  const ctx = skill.publicContext!(due ? due.customer : "+919000000001", w.clock.now());
  const ids = ctx.sources.map((s) => s.id);
  assert.ok(ids.includes("s:shop") && ids.includes("s:due"));
  assert.ok(ids.some((id) => id.startsWith("s:batch:")));
  const text = JSON.stringify(ctx.sources);
  for (const s of w.settings.students) assert.ok(!text.includes(s.name), "no student's name in what a model reads");
  assert.ok(!JSON.stringify(skill.facts!(w.clock.now())).includes(due?.studentName ?? "\u0000"));
});

test("a parent's unreadable words get a grounded reply with the centre's own buttons; a promise is not sent", async () => {
  const seen: string[] = [];
  const w = createWorld({ settings: parseSettings({ ...bright(), assistant: {} }), talker: script([{ text: "Fees are due every month.", sources: ["s:due"] }], seen) });
  const parent = w.settings.students[0].parent;
  assert.ok(parent);
  await w.say("tell me a story about the moon", { from: parent });
  assert.ok(w.messaging.sentTo(parent).some((m) => /Fees are due every month\./u.test(m.text)));
  const bad = createWorld({ settings: parseSettings({ ...bright(), assistant: {} }), talker: script([{ text: "The owner promises a discount.", sources: [] }]) });
  await bad.say("tell me a story about the moon", { from: parent });
  assert.ok(!bad.messaging.sentTo(parent).some((m) => /promises/u.test(m.text)));
});
