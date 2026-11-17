// The "time ran out" card for an Orders owner (17 Nov 2026), built for Bookings on 14 Nov: a hold that ended where the customer may have paid anyway is listed on the owner's
// page (and in the assistant's "what needs me") for 48 hours, or 14 days after the customer said they paid, with the same mark as WhatsApp's "received <code>". A mark after the
// close is the late mark (agent.ts lateMark): never confirmed again by itself, the owner owes it back or takes the order by hand. Only a UPI shop has one. Fakes only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AMIT, createWorld } from "../src/harness.ts";
import type { World } from "../src/harness.ts";
import { parseSettings } from "../src/settings.ts";
import { LATE_WINDOW_MS, ownerItems } from "../src/channel.ts";

const raw = (file: string) => JSON.parse(readFileSync(new URL(`../settings/${file}.example.json`, import.meta.url), "utf8")) as Record<string, unknown>;
const LUNCH = "2 veg thali 10 nov 12:00 pm pickup";
const itemsOf = (w: World) => ownerItems(w.settings, w.store, w.clock.now()).items;

async function expired(w: World): Promise<void> {
  await w.say(LUNCH);
  await w.advance(31); // the hold is 30 minutes
  assert.equal(w.orderOf(AMIT)!.state, "expired");
}

test("an expired UPI hold is listed as a late advance, with the amount and the one-use code kept for the agent", async () => {
  const w = createWorld();
  await expired(w);
  const late = itemsOf(w).filter((i) => i.kind === "late_deposit");
  assert.equal(late.length, 1);
  assert.equal(late[0].case, "o-1");
  assert.equal(late[0].amountPaise, 12_000);
  assert.deepEqual(late[0].actions, ["received"]);
  assert.ok(late[0].code, "the code is there for the agent's check of a press");
});

test("it stops being listed after 48 hours, and after the owner marks it; a customer's 'I paid' keeps it for 14 days", async () => {
  const w = createWorld();
  await expired(w);
  await w.advance(Math.floor(LATE_WINDOW_MS / 60_000) + 60);
  assert.equal(itemsOf(w).filter((i) => i.kind === "late_deposit").length, 0, "an old, forgotten hold is not listed for ever");

  const marked = createWorld();
  await expired(marked);
  await marked.ownerMarksReceived(AMIT);
  assert.equal(itemsOf(marked).filter((i) => i.kind === "late_deposit").length, 0);
  assert.equal(itemsOf(marked).filter((i) => i.kind === "refund_owed").length, 1, "the late mark is owed back, or kept for an order taken by hand");
  assert.equal(marked.orderOf(AMIT)!.state, "expired", "never confirmed again by itself");

  const claimed = createWorld();
  await expired(claimed);
  claimed.orderOf(AMIT)!.claimAtMs = claimed.clock.now(); // the customer said they paid
  await claimed.advance(Math.floor(LATE_WINDOW_MS / 60_000) + 60);
  assert.equal(itemsOf(claimed).filter((i) => i.kind === "late_deposit").length, 1);
});

test("a shop that confirms payments itself (Razorpay) never has one", async () => {
  const w = createWorld({ settings: parseSettings(raw("annapurna-tiffins-razorpay")) });
  await expired(w);
  assert.equal(itemsOf(w).filter((i) => i.kind === "late_deposit").length, 0);
});

test("the assistant asks about it as it asks about an advance, and its yes is the same late mark", async () => {
  const w = createWorld({ settings: parseSettings({ ...raw("annapurna-tiffins"), assistant: {} }) });
  await expired(w);
  await w.ownerSays("what needs me");
  const card = w.messaging.sentTo(w.owner).filter((m) => m.interactive?.buttons?.some((b) => b.id.startsWith("card-"))).at(-1);
  assert.ok(card, "a card was sent");
  assert.match(card.text, /^Did ₹120 from \+919844444444 for o-1 reach your UPI\?/u);
  await w.tap(card.interactive!.buttons![0].id, { from: w.owner });
  assert.equal(itemsOf(w).filter((i) => i.kind === "late_deposit").length, 0);
  assert.equal(w.orderOf(AMIT)!.state, "expired");
  assert.equal(w.upiRefunds(AMIT).length, 1);
});
