// A parent who allowed alerts on their private page also hears the centre's reminders as web push (release-flow batch 3, 14 Nov 2026), through the real Fees runtime and
// the agent's own sends: the push goes to the parent's conversation (their stable ref, not their link), says the reminder's words with every address taken out (a
// reminder carries the parent's private link and a payment link, and no address travels in a push), and the WhatsApp message itself still carries its link.
import { test } from "node:test";
import assert from "node:assert/strict";
import { zonedToMs } from "../../../../modules/core/time.ts";
import type { Push } from "../../../../modules/push/push.ts";
import { parentRef } from "../src/channel.ts";
import { PARENT, createKit } from "./runtime-kit.ts";

const at = (day: number, hour: number) => zonedToMs({ year: 2026, month: 11, day }, { hour, minute: 0 }, "Asia/Kolkata");

test("a reminder is pushed to the parent's page conversation without its links; the WhatsApp message keeps them", async () => {
  const kit = createKit();
  try {
    const pushed: { conversation: string; text: string }[] = [];
    const push = { on: true, customer: (conversation: string, text: string) => { pushed.push({ conversation, text }); return ["queued"]; } } as unknown as Push;
    const pages = () => ({ schema: 1 as const, base: "https://partners.example/s/bright", ownerBase: "https://partners.example/s/bright/owner" });
    const first = kit.open({ push, pages });
    await first.runtime.tick();
    kit.clock.set(at(2, 13));
    await first.runtime.tick();
    const mine = pushed.filter((p) => p.conversation === `parent:${parentRef(PARENT)}`);
    assert.equal(mine.length, 2, "the Sharmas have two children: one reminder, one push, for each");
    for (const p of mine) { assert.ok(p.text.length > 0); assert.doesNotMatch(p.text, /https?:\/\//u, "no address travels in a push"); }
    const sentToParent = kit.messaging.outbox().filter((m) => m.to === PARENT);
    assert.ok(sentToParent.some((m) => /https:\/\/partners\.example\/s\/bright\/f\//u.test(m.text)), "the message on WhatsApp still carries the parent's private link");
  } finally { kit.cleanup(); }
});
