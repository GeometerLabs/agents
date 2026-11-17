// The shop's assistant on an Orders shop (item 11e): off without an "assistant" block; on, "open orders" answers from the saved orders, a big order waiting for the
// owner comes as a card whose Refuse is the owner's own "deny o-1", (cancelling and refunding from the chat are tried in test/assistant-acts.test.ts). Uses the dev harness with the fakes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AMIT, createWorld } from "../src/harness.ts";
import type { World } from "../src/harness.ts";
import { parseSettings } from "../src/settings.ts";
import { newDraft, register } from "../src/order.ts";

const annapurna = () => JSON.parse(readFileSync(new URL("../settings/annapurna-tiffins-razorpay.example.json", import.meta.url), "utf8")) as Record<string, unknown>;
const withAssistant = () => createWorld({ settings: parseSettings({ ...annapurna(), assistant: {} }) });
const cardOf = (w: World) => w.messaging.sentTo(w.owner).filter((m) => m.interactive?.buttons?.some((b) => b.id.startsWith("card-"))).at(-1)!;

/** An order the agent held back as big: waiting for the owner, as the agent leaves it (src/agent.ts, the big-order ask). */
function bigOrderWaiting(w: World) {
  const o = register(w.store, newDraft(AMIT, "en"));
  const item = w.settings.menu[0];
  o.lines = [{ itemId: item.id, qty: 4 }];
  o.totalInr = item.priceInr * 4;
  o.state = "awaiting_owner";
  o.pending.push({ kind: "big_order", totalInr: o.totalInr, askedAtMs: w.clock.now() });
  return o;
}

test("without an \"assistant\" block nothing changes for the owner", async () => {
  const w = createWorld({ settings: parseSettings(annapurna()) });
  await w.ownerSays("open orders");
  assert.match(w.lastTextTo(w.owner), /understand/u);
  assert.equal(w.record.entries().filter((e) => e.action === "owner_assistant").length, 0);
});

test("open orders, and a big order waiting comes as a card whose Refuse is the owner's own 'deny o-1'", async () => {
  const w = withAssistant();
  const o = bigOrderWaiting(w);
  await w.ownerSays("open orders");
  assert.match(w.lastTextTo(w.owner), /^Open orders: 1\n/u);
  await w.ownerSays("what needs me");
  const card = cardOf(w);
  assert.match(card.text, /^Accept order o-1 from \+919844444444 \(4 × /u);
  await w.tap(card.interactive!.buttons![1].id, { from: w.owner });
  assert.equal(o.state, "cancelled");
  assert.ok(w.record.entries().some((e) => e.action === "owner_decision" && e.outcome === "confirmed" && e.refs.command === "deny"));
});
