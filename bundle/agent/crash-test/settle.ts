// How a crash-test situation knows the agent and the stand-ins have gone quiet: the one place the "settle" rule lives (world.ts calls it).
//
// A fixed quiet window (it was 800 ms) is not correct under load: the agent's own retry timers, and every call the situation makes to read what happened, all stretch when the
// machine is busy, so a late repeat can arrive after the window and be missed (the flake at crash-test.test.ts:61, the broken example's re-asked refunds). Nothing the situation can
// ask the agent says "I will not repeat", so the window is made to follow what was seen instead of the clock alone:
//   - the load: how long reading the activity took (it calls three Guards' admin ports, so it slows with the machine). Quiet needs at least 6 of the slowest such reads;
//   - the cadence: once two changes have been seen, the longest gap between changes so far (a retry loop's period). Quiet needs at least twice that gap.
// On an idle machine both are small and the window stays at its base, so a run is no slower than before. The wait still ends by `maxMs` however the agent behaves.
const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface SettleOptions {
  /** A number that changes whenever the agent, a Guard or a stand-in does anything (world.activity). */
  activity(): Promise<string>;
  /** The activity value the caller took before it did something; settling then waits until something has moved. Without it, quiet from the start counts. */
  from?: string;
  /** The longest the whole wait may take. */
  maxMs: number;
  /** The least time nothing may change to count as quiet. */
  quietMs?: number;
  /** If `from` was given and nothing ever moves, the least time to wait before concluding there was nothing to wait for. */
  idleMs?: number;
  /** How often to look. */
  pollMs?: number;
  /** The clock and the pause, replaceable so a test can run time by hand. */
  now?(): number;
  sleep?(ms: number): Promise<void>;
}

/** How many of the slowest activity reads must fit in a quiet window. */
const LOAD_FACTOR = 6;
/** How many of the longest gaps between changes must fit in a quiet window. */
const CADENCE_FACTOR = 2;

export async function settle(o: SettleOptions): Promise<void> {
  const { quietMs = 800, idleMs = 4000, pollMs = 100, now = Date.now, sleep = realSleep } = o;
  const started = now();
  const deadline = started + o.maxMs;
  let slowest = 0; // the slowest read of the activity so far, in ms
  const read = async (): Promise<string> => { const t = now(); const v = await o.activity(); slowest = Math.max(slowest, now() - t); return v; };
  let last = await read();
  let changedAt = now();
  let longestGap = 0;
  let moved = o.from === undefined || last !== o.from;
  // changes seen so far: activity already under way at the start counts as one, so the first change after it has a gap to measure (waiting for the first change to
  // begin is not a gap: it is only the wait for something to start)
  let changes = moved ? 1 : 0;
  while (now() < deadline) {
    await sleep(pollMs);
    const cur = await read();
    if (cur !== last) {
      if (changes > 0) longestGap = Math.max(longestGap, now() - changedAt);
      changes++; last = cur; changedAt = now(); moved = true;
      continue;
    }
    const window = Math.max(quietMs, LOAD_FACTOR * slowest, CADENCE_FACTOR * longestGap);
    // quiet for the window after something happened; if nothing happens at all for a few seconds, there is nothing to wait for
    if (moved ? now() - changedAt >= window : now() - started >= Math.max(idleMs, window)) return;
  }
}
