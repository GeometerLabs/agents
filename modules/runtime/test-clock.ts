// The names of the two environment variables that ask a shop for the TEST clock, for the runtime CONTRACT tests only (every template's contract/harness.ts): the owner-control
// rules wait 48 hours, a day, 15 minutes, and a test that starts the shop as a separate process cannot pass it a fake clock object. So a test may ask, through the environment,
// for the machine's clock PLUS an offset read from a file it writes; moving the offset moves the shop's time while time itself keeps running.
//
//   GEOMETER_TEST=1  GEOMETER_TEST_CLOCK_FILE=<file holding one integer: milliseconds to add>      honoured ONLY when runtime.json says "mode": "fakes"
//
// The shops are the Go programs, and go/internal/testclock is what reads these (and refuses them in a live shop, with NODE_ENV=production or without GEOMETER_TEST=1: the
// start stops with a sentence). The deployer never sets either variable (bundle/generate/compose.ts writes every container's environment in full). The TypeScript reader that
// stood here went with the TypeScript runtimes on 24 Nov 2026; the names stay, one place for the harnesses that write them.
export const TEST_SWITCH = "GEOMETER_TEST";
export const TEST_CLOCK_FILE = "GEOMETER_TEST_CLOCK_FILE";
