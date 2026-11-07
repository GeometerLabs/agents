// The clock: every so often a tick goes through the same queue as the events, so holds expire and reminders go out even when
// nobody writes. Ticks are not saved as tasks; if the process is down, the next tick after it starts catches up (the agent
// sends only the latest due reminder and expires every hold whose time has passed).
import type { Runtime } from "./runtime.ts";

export interface Ticker { stop(): void }

export function startTicker(runtime: Pick<Runtime, "tick">, everyMs: number): Ticker {
  const timer = setInterval(() => { void runtime.tick(); }, everyMs); // tick() never rejects
  timer.unref(); // the clock alone does not keep the process alive
  return { stop: () => clearInterval(timer) };
}
