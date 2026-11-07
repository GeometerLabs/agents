import { test } from "node:test";
import assert from "node:assert/strict";
import { startTicker } from "../server/ticker.ts";
import { createKit } from "./runtime-kit.ts";

const BOOK = "I want a haircut tomorrow at 6pm";

const until = async (done: () => boolean, ms = 3_000) => {
  for (let waited = 0; !done() && waited < ms; waited += 5) await new Promise((r) => setTimeout(r, 5));
  assert.ok(done(), "gave up waiting");
};

test("the ticker, on its own timer, expires a hold that ran out", async () => {
  const kit = createKit();
  const { runtime } = kit.open();
  const ticker = startTicker(runtime, 10);
  try {
    await kit.say(runtime, BOOK);
    kit.clock.advanceMinutes(kit.settings.deposit.holdMinutes + 1); // nobody writes; only time passes
    await until(() => runtime.status().bookings.expired === 1);
    assert.equal(kit.calendar.events().length, 0);
    assert.ok(kit.messaging.sentTo("+919811111111").some((m) => /hold on .* has ended/.test(m.text)), "the customer was told the hold ran out");
  } finally {
    ticker.stop();
    await runtime.idle();
    kit.cleanup();
  }
});

test("ticks do not pile up behind a slow step", async () => {
  const kit = createKit();
  let release!: () => void;
  const slow = new Promise<void>((resolve) => { release = resolve; });
  let ticks = 0;
  const { runtime } = kit.open({ aroundStep: async (event, run) => { if (event.kind === "tick") { ticks++; await slow; } await run(); } });
  const ticker = startTicker(runtime, 5);
  try {
    await until(() => ticks === 1);
    await new Promise((r) => setTimeout(r, 60)); // twelve intervals pass while the first tick is stuck
    ticker.stop();
    release();
    await runtime.idle();
    assert.ok(ticks <= 2, `ticks that piled up: ${ticks}`); // the stuck one, and at most one waiting behind it
  } finally {
    ticker.stop();
    release();
    await runtime.idle();
    kit.cleanup();
  }
});
