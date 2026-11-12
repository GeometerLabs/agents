// The public front's per-address limits, kept in memory: how many requests one address may make in a window, by kind. Used by modules/channels/front.ts before
// anything is sent to the runtime, so a flood from one address costs the runtime nothing. No CAPTCHA: the owner's decision is that a customer books without a puzzle.
//
// In memory on purpose: a restart forgets the counts, which only means a sender gets a fresh window. What must survive a restart (the per-number and per-shop limits,
// and the hold that ends by itself) is in the runtime's saved state (state.ts CHANNEL_LIMITS). An address is what Caddy saw (the last X-Forwarded-For entry), so a
// whole office or mobile network behind one address shares a window; the numbers below leave room for that.
export interface Window { max: number; perMs: number }

export const FRONT_LIMITS = {
  /** Bookings started (page or API or MCP), per address. */
  book: { max: 6, perMs: 10 * 60_000 },
  /** Cancels and "I have paid", per address. */
  act: { max: 20, perMs: 10 * 60_000 },
  /** Page views and reads, per address. */
  read: { max: 120, perMs: 60_000 },
  /**
   * Bookings started on one shop from every address together (counted under "shop:<name>"): what bounds a flood from many addresses, before the runtime's own per-shop
   * cap on unpaid holds. A busy salon starts a few an hour; this leaves a wide margin.
   */
  shopStarts: { max: 60, perMs: 10 * 60_000 },
  /** Wrong owner links or booking handles, per address: someone guessing. */
  wrong: { max: 10, perMs: 60 * 60_000 },
} as const satisfies Record<string, Window>;

export type LimitKind = keyof typeof FRONT_LIMITS;

/** A sliding count per (kind, address). `take` says whether one more is allowed now and counts it if so. */
export function createLimiter(now: () => number = Date.now, limits: Record<LimitKind, Window> = FRONT_LIMITS) {
  const seen = new Map<string, number[]>();
  let sweptAt = 0;
  function sweep(t: number): void {
    if (t - sweptAt < 60_000) return;
    sweptAt = t;
    for (const [key, times] of seen) {
      const per = limits[key.split(" ")[0] as LimitKind].perMs;
      const kept = times.filter((x) => t - x < per);
      if (kept.length === 0) seen.delete(key); else seen.set(key, kept);
    }
  }
  return {
    take(kind: LimitKind, address: string): boolean {
      const t = now();
      sweep(t);
      const key = `${kind} ${address}`;
      const w = limits[kind];
      const times = (seen.get(key) ?? []).filter((x) => t - x < w.perMs);
      if (times.length >= w.max) { seen.set(key, times); return false; }
      times.push(t);
      seen.set(key, times);
      return true;
    },
    /** Only look: is this address over the limit for this kind? (Wrong guesses are counted after the fact, and looked at before.) */
    over(kind: LimitKind, address: string): boolean {
      const t = now();
      return (seen.get(`${kind} ${address}`) ?? []).filter((x) => t - x < limits[kind].perMs).length >= limits[kind].max;
    },
  };
}
export type Limiter = ReturnType<typeof createLimiter>;
