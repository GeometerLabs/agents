// The crash test's settle rule (agent/crash-test/settle.ts), run on a clock the test moves by hand so it is exact and the same on any machine: the quiet window grows with
// how slowly the activity is read (load) and with the gaps between changes (a retry loop's period), so a late repeat is waited for, and an idle run is no slower than the base.
import { test } from "node:test";
import assert from "node:assert/strict";
import { settle } from "../agent/crash-test/settle.ts";

/** A world on a hand-moved clock: `events` are the times (ms from the start) something changes; each read of the activity takes `readMs`. */
function world(events: number[], readMs: number) {
  let t = 0;
  const seen: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => { t += ms; },
    activity: async () => { t += readMs; const n = events.filter((e) => e <= t).length; seen.push(n); return String(n); },
    end: () => t,
    counted: () => events.filter((e) => e <= t).length,
  };
}
const run = (w: ReturnType<typeof world>, extra: Partial<Parameters<typeof settle>[0]> = {}) => settle({ activity: w.activity, now: w.now, sleep: w.sleep, maxMs: 60_000, ...extra });

test("an idle machine: the window stays at its base, so a settle is no slower than the fixed 800 ms it replaces", async () => {
  const w = world([100], 5);
  await run(w);
  assert.ok(w.end() >= 900 && w.end() <= 1100, `settled at ${w.end()} ms`);
  assert.equal(w.counted(), 1);
});

test("a loaded machine: reads take 300 ms, so the window is six of them, and a repeat 1,500 ms after the last change is still waited for", async () => {
  // the same repeat on an idle machine (5 ms reads) is outside the base window; under load it is inside the grown one
  const idle = world([100, 1600], 5);
  await run(idle);
  assert.equal(idle.counted(), 1, "idle: the window had closed before 1,600 ms (documented: the base is the least that is waited)");
  const loaded = world([100, 1600], 300);
  await run(loaded);
  assert.equal(loaded.counted(), 2, "loaded: the repeat was seen before settle returned");
});

test("a retry loop: once two changes show its period, the window follows it, so the third and fourth tries are waited for", async () => {
  const w = world([100, 1000, 2400, 4600], 150); // gaps of 900, 1,400 and 2,200: each longer than the base window (900) and less than twice the longest before it
  await run(w);
  assert.equal(w.counted(), 4, "every try was seen");
});

test("nothing ever moves and something was expected: settle gives up after idleMs; and a bound ends a wait that never gets quiet", async () => {
  const w = world([], 5);
  await run(w, { from: "0", idleMs: 3000 });
  assert.ok(w.end() >= 3000 && w.end() < 3400, `gave up at ${w.end()} ms`);
  const busy = world(Array.from({ length: 1000 }, (_, i) => 100 + i * 200), 5);
  await run(busy, { maxMs: 5000 });
  assert.ok(busy.end() >= 5000 && busy.end() < 5400, `stopped at ${busy.end()} ms`);
});
