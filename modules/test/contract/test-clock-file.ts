// The test side of the runtime contract's TEST clock (modules/runtime/test-clock.ts, go/internal/testclock): the file the shop reads on every use, holding one integer, the
// milliseconds added to the machine's clock. It is written whole (a rename), so the shop never reads half a number. Shared by the listings and Bookings harnesses.
import { renameSync, writeFileSync } from "node:fs";

export interface TestClockFile {
  /** The file's address, for GEOMETER_TEST_CLOCK_FILE. */
  file: string;
  /** The shop's time now: the machine's clock plus the offset. */
  now(): number;
  /** Move the shop's time on by `ms`. */
  advance(ms: number): void;
}

/** Make the file (offset 0) at `file`. */
export function makeTestClockFile(file: string): TestClockFile {
  let offset = 0;
  const write = (): void => { writeFileSync(`${file}.tmp`, String(offset)); renameSync(`${file}.tmp`, file); };
  write();
  return { file, now: () => Date.now() + offset, advance(ms) { offset += ms; write(); } };
}
