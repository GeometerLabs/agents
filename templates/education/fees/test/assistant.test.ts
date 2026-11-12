// The shop's assistant on a Fees centre (item 11e): off without an "assistant" block (the owner's free words get the usual answer); on, "who owes fees" answers from
// the saved fees, and a waiver waiting for the owner comes as a card whose Approve is the owner's own "approve q-1" and whose Refuse is their "deny q-1". Uses the dev
// harness (src/harness.ts) with the in-memory fakes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createWorld } from "../src/harness.ts";
import type { World } from "../src/harness.ts";
import { parseSettings } from "../src/settings.ts";
import { balanceInr } from "../src/due.ts";

const bright = () => JSON.parse(readFileSync(new URL("../settings/bright-tuition.example.json", import.meta.url), "utf8")) as Record<string, unknown>;
const withAssistant = () => createWorld({ settings: parseSettings({ ...bright(), assistant: {} }) });
const cardOf = (w: World) => w.messaging.sentTo(w.owner).filter((m) => m.interactive?.buttons?.some((b) => b.id.startsWith("card-"))).at(-1)!;
const decisions = (w: World, command: string) => w.record.entries().filter((e) => e.action === "owner_decision" && e.outcome === "confirmed" && e.refs.command === command);

/** The month's fees opened and reminded, then Rohan's parent asked for ₹900 off, above the waiver limit: a request waits for the owner. */
async function waiverWaiting(w: World) {
  await w.advance(61);
  const due = w.dueOf("Rohan Mehta")!;
  due.pending.push({ kind: "waiver", id: "q-1", amountInr: 900, balanceAtAskInr: balanceInr(due), askedAtMs: w.clock.now() });
  return due;
}

test("without an \"assistant\" block nothing changes for the owner", async () => {
  const w = createWorld();
  await w.ownerSays("who owes fees");
  assert.match(w.lastTextTo(w.owner), /understand/u);
  assert.equal(w.record.entries().filter((e) => e.action === "owner_assistant").length, 0);
});

test("who owes: the fees past their due date, from the saved fees", async () => {
  const w = withAssistant();
  await w.advance(61);
  await w.goto({ year: 2026, month: 11, day: 6 });
  await w.ownerSays("who owes fees");
  assert.match(w.lastTextTo(w.owner), /^Fees not paid yet: \d+\n/u);
  assert.match(w.lastTextTo(w.owner), /Rohan Mehta, /u);
});

test("a waiver waiting: the card's Approve is the owner's own 'approve q-1'", async () => {
  const w = withAssistant();
  const due = await waiverWaiting(w);
  await w.ownerSays("what needs me");
  const card = cardOf(w);
  assert.match(card.text, /^Waive ₹900 of Rohan Mehta's fee \(/u);
  await w.tap(card.interactive!.buttons![0].id, { from: w.owner });
  assert.equal(decisions(w, "approve").length, 1);
  assert.equal(due.pending.length, 0);
  assert.equal(due.waivedInr, 900);
});

test("a waiver waiting: the card's Refuse is the owner's own 'deny q-1'", async () => {
  const w = withAssistant();
  const due = await waiverWaiting(w);
  await w.ownerSays("what needs me");
  await w.tap(cardOf(w).interactive!.buttons![1].id, { from: w.owner });
  assert.equal(decisions(w, "deny").length, 1);
  assert.equal(due.waiverDenied, true);
  assert.equal(due.waivedInr, 0);
});
