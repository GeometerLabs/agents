// The clock is passed in, never read from the machine, so a test can make a hold expire or a reminder fall due.
import { MINUTE } from "./time.ts";

export interface Clock { now(): number } // epoch milliseconds

export const systemClock: Clock = { now: () => Date.now() };

export interface FakeClock extends Clock {
  set(ms: number): void;
  advance(ms: number): void;
  advanceMinutes(minutes: number): void;
}

export function fakeClock(startMs: number): FakeClock {
  let t = startMs;
  return {
    now: () => t,
    set: (ms) => { t = ms; },
    advance: (ms) => { t += ms; },
    advanceMinutes: (minutes) => { t += minutes * MINUTE; },
  };
}
