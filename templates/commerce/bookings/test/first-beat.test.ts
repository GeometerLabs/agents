// The hand check's shop has had its first beat before a situation's first step (modules/crash-test/go-shop.ts `firstBeat`), so what that beat decides once for the day does not
// depend on how fast the machine runs the situation.
//
// Why it exists (25 Nov 2026): Bookings with the assistant held 40 of 40 in the morning runs of 24 Nov and 39 of 40 in the evening ones. The cause was not the time of day: the
// program's beat runs on a real-time timer from its start, the world opened at 10:00 on the shop's clock (inside the owner's morning window, 08:00 for four hours), and the
// situation "The model is down mid-conversation" booked and paid in some 0.15 s. When the booking was confirmed before the first beat (4 ms before it, in the run that failed),
// that beat's morning line counted it and went to the owner mid-situation; when the beat came first, the day was quiet and the line was not looked at again.
//
// The beat's interval is the real-time source here, so the test injects a slow one (2 s, runtime.json `tickSeconds`) instead of moving the machine's clock: before the fix the
// world opened with no beat yet, the booking was made inside those 2 s, and the morning line always went; with it, never.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { goSkip } from "../../../../modules/crash-test/go-shop.ts";
import { closeOpened } from "../../../../modules/crash-test/situations.ts";
import { createGoWorld } from "../crash-test/go-world.ts";
import { CUSTOMER } from "../src/harness.ts";
import { parseSettings } from "../src/settings.ts";

after(closeOpened);

// Glow Salon with the owner's assistant (the morning line is the assistant's): the example's settings plus the `assistant` block the hand check's assistant run uses
const raw = JSON.parse(readFileSync(new URL("../settings/glow-salon.example.json", import.meta.url), "utf8")) as Record<string, unknown>;
const settings = parseSettings({ ...raw, assistant: { character: { style: "clay", seed: "x-1", personality: "warm" } } });

test("a hand-check shop has had its first beat when its world opens, so a booking made at once does not reach the owner's morning line mid-situation", { skip: goSkip("bookings") }, async () => {
  const w = await createGoWorld({ settings, runtime: { tickSeconds: 2 } });
  const ticks = Number((await w.shop.status()).ticks ?? 0);

  // book today's first free time on taps and pay, straight away (no model is connected: the rules read every message)
  await w.say("hello");
  const service = settings.services[0].id;
  await w.tap(`svc:${service}`);
  const row = w.messaging.sentTo(CUSTOMER).filter((m) => m.interactive).at(-1)?.interactive?.list?.rows.find((r) => r.id.startsWith("slot:"));
  assert.ok(row, "the service tap was answered with a list of free times");
  await w.tap(row.id);
  const link = w.payments.links().at(-1);
  assert.ok(link, "the time tap made the deposit link");
  w.payments.customerPays(link.id);
  await w.deliverPaymentEvents();
  const confirmed = [...w.store.bookings.values()].filter((b) => b.state === "confirmed");
  assert.equal(confirmed.length, 1, "the booking is confirmed");
  assert.equal(new Date(confirmed[0].startMs!).toISOString().slice(0, 10), "2026-11-03", "on the world's own day, so a morning line made after it would count it");
  await w.advance(1); // two more beats, inside the morning window

  const morning = w.textsTo(w.owner).filter((t) => t.startsWith("Good morning"));
  assert.deepEqual(morning, [], "the first beat found a quiet day before the booking, so no morning line went to the owner");
  assert.ok(ticks >= 1, `the world opened before the shop's first beat ended (ticks ${ticks})`);
});
