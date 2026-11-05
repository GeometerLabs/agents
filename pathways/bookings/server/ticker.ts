// The clock: every so often a tick goes through the same queue as the events. The same for every template, so the code is shared (modules/runtime/ticker.ts).
export { startTicker } from "../../../modules/runtime/ticker.ts";
export type { Ticker } from "../../../modules/runtime/ticker.ts";
