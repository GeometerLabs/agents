// A login rate limit that counts failures, not attempts, in a sliding window. Once a key has failed `max` times inside the window it is blocked
// even for the right passphrase, until its oldest failure ages out; a success clears only that key. In memory: a restart forgets it (Deferred.md).
export interface Limiter {
  /** Seconds until the key may try again; 0 when it may try now. */
  blocked(key: string): number;
  fail(key: string): void;
  clear(key: string): void;
}

export function createLimiter(max: number, windowMs: number, now: () => number = Date.now, keep = 5000): Limiter {
  const failures = new Map<string, number[]>();
  const recent = (key: string): number[] => {
    const cutoff = now() - windowMs;
    const list = (failures.get(key) ?? []).filter((t) => t > cutoff);
    if (list.length === 0) failures.delete(key); else failures.set(key, list);
    return list;
  };
  return {
    blocked(key) {
      const list = recent(key);
      return list.length >= max ? Math.max(1, Math.ceil((list[list.length - max] + windowMs - now()) / 1000)) : 0;
    },
    fail(key) {
      const list = recent(key);
      list.push(now());
      failures.set(key, list);
      if (failures.size > keep) failures.delete(failures.keys().next().value as string); // a flood of made-up keys cannot grow it without end
    },
    clear(key) { failures.delete(key); },
  };
}
