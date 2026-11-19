// A clock for the runtime CONTRACT tests only (templates/commerce/listings/contract/ and templates/commerce/bookings/contract/): the owner-control rules wait 48 hours, a day, 15 minutes, and a test that starts the
// shop as a separate process cannot pass it a fake clock object. So a test may ask, through the environment, for the machine's clock PLUS an offset read from a file it writes;
// moving the offset moves the shop's time while time itself keeps running (so made_at and first_seen keep their order, as they do in production).
//
//   GEOMETER_TEST=1  GEOMETER_TEST_CLOCK_FILE=<file holding one integer: milliseconds to add>      honoured ONLY when runtime.json says "mode": "fakes"
//
// Why this can never be on for a real shop, in three independent ways:
//   1. the deployer never sets either variable: every runtime container's environment is written out in full in bundle/generate/compose.ts (INTERNAL_TOKEN_FILE,
//      RECORD_KEY_FILE, CHANNEL_TOKEN_FILE for a shop; SHOPS_DIR, SECRETS_DIR, HOST, PORT, ... for the shared process), nothing is passed through from the server's own shell;
//   2. a shop the panel makes is "mode": "live" (bundle/panel/listings.ts runtimeForListings, and every other template's), and a test clock asked for in a live shop, or with
//      NODE_ENV=production, or without GEOMETER_TEST=1, STOPS THE START with a sentence: it is never quietly ignored, and never quietly honoured;
//   3. it is wired only into the single-shop command lines of the templates whose contract needs it (templates/commerce/listings/server/main.ts and
//      templates/commerce/bookings/server/main.ts), not into modules/runtime/start.ts nor the shared process (shared-main.ts), so a listings shop on the shared process has no
//      code path that reads the file at all, and every other template's start never asks.
// The Go runtime (go/internal/testclock) applies the same rule, word for word, so the contract drives both the same way.
import { readFileSync } from "node:fs";
import type { Clock } from "../core/clock.ts";
import { ClientError } from "./config.ts";

export const TEST_SWITCH = "GEOMETER_TEST";
export const TEST_CLOCK_FILE = "GEOMETER_TEST_CLOCK_FILE";

/**
 * The test clock the environment asks for, or undefined when it asks for none (the file variable unset or empty: the machine's clock, nothing read). `mode` is runtime.json's
 * mode, asked only when a clock is asked for. Throws a ClientError (the start stops) when a clock is asked for where it is not allowed.
 */
export function testClock(env: Record<string, string | undefined>, mode: () => string): Clock | undefined {
  const file = env[TEST_CLOCK_FILE];
  if (file === undefined || file === "") return undefined;
  if (env[TEST_SWITCH] !== "1") throw new ClientError(`${TEST_CLOCK_FILE} is set but ${TEST_SWITCH} is not 1: a test clock is for the contract tests only, so the shop does not start.`);
  if (env.NODE_ENV === "production") throw new ClientError(`${TEST_CLOCK_FILE} is set with NODE_ENV=production: a production shop never runs on a test clock, so it does not start.`);
  const m = mode();
  if (m !== "fakes") throw new ClientError(`${TEST_CLOCK_FILE} is set for a shop in "${m}" mode: only a "fakes" shop may run on a test clock, so it does not start.`);
  // the offset is read on every call (the test moves it while the shop runs); a read that fails (the file mid-write) keeps the last value, so time never jumps back
  let offset = 0;
  const read = (): number => {
    try {
      const text = readFileSync(file, "utf8").trim();
      if (/^-?\d{1,15}$/u.test(text)) offset = Number(text);
    } catch { /* keep the last value */ }
    return offset;
  };
  read();
  return { now: () => Date.now() + read() };
}
