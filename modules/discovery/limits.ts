// Per-address limits, kept in memory only (specs/directory.md, "Privacy"): how many requests one address may make in a window. The address is held as a salted hash
// (so a heap dump or a crash report does not hold a visitor's address as it is) and only for the window; nothing is written to disk, and a restart forgets it all.
// Pure: no import except the order module's small hash.
import { turnHash } from "./order.ts";

export interface Limit { max: number; perMs: number }

/** A sliding-window limiter. `take(kind, who)` counts one request and says whether it is allowed. */
export function createLimiter(limits: Record<string, Limit>, now: () => number = Date.now, salt = Math.random().toString(36)) {
  const seen = new Map<string, number[]>();
  let swept = 0;
  return {
    take(kind: string, who: string): boolean {
      const limit = limits[kind];
      if (!limit) return true;
      const t = now();
      if (t - swept > 60_000) { // forget old windows, so the memory holds only the last few minutes
        swept = t;
        for (const [k, v] of seen) { const keep = v.filter((x) => t - x < (limits[k.split(" ")[0]]?.perMs ?? 0)); if (keep.length) seen.set(k, keep); else seen.delete(k); }
      }
      const id = `${kind} ${turnHash(`${salt}|${who}`)}`;
      const times = (seen.get(id) ?? []).filter((x) => t - x < limit.perMs);
      if (times.length >= limit.max) { seen.set(id, times); return false; }
      times.push(t); seen.set(id, times);
      return true;
    },
    /** How many windows are held (for a test that checks the memory is bounded). */
    held: (): number => seen.size,
  };
}
