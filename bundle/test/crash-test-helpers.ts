// What the two crash-test files share (crash-test.test.ts: the good example and the settings; crash-test-wrong.test.ts: the three wrong examples): an agent
// added to a temporary server with the Bookings flags, the crash test run on it against the real Guard, and the output caught. In two files so the test runner
// can run them side by side: each run waits out Guard's shortest request (60 s) in the situation where nobody answers.
import { addAgent } from "../agent/deploy.ts";
import { planCrashTest, runCrashTest } from "../agent/crash-test/run.ts";
import type { CrashResult } from "../agent/crash-test/run.ts";
import { makeContext } from "../geometer.ts";
import { CALENDAR_ID, PHONE_NUMBER_ID, tempServer } from "./helpers.ts";
import { BINARY } from "./real-guard.ts";

export const EXAMPLES = new URL("../examples/own-agent/", import.meta.url).pathname;
export const NOW = new Date("2026-11-05T09:00:00Z");
export const flags = { upstreams: "razorpay,whatsapp,calendar", "owner-whatsapp": "+919800000001", deposit: "200", "refund-limit": "100", "whatsapp-number-id": PHONE_NUMBER_ID, "calendar-id": CALENDAR_ID };
export const ALL = ["booking-works", "payment-link-lost-reply", "refund-lost-reply", "duplicate-payment-event", "calendar-silent-failure", "razorpay-key-expired", "refund-above-limit", "owner-denies", "approval-expires", "refund-more-than-paid", "duplicate-inbound", "price-below-floor"];

export function agentOn(run: string, extra: Record<string, string> = {}) {
  const t = tempServer({});
  addAgent(t.root, "my-agent", { ...flags, run, version: "v1", ...extra }, () => "", NOW);
  return { ...t, ctx: makeContext(t.root, { now: () => NOW }) };
}

export async function crashTest(run: string, extra: Record<string, string> = {}, situations?: string[]): Promise<CrashResult> {
  const a = agentOn(run, extra);
  try {
    const { plan } = await planCrashTest(a.ctx, "my-agent", { guardBin: BINARY });
    return await runCrashTest(plan, situations ? { situations } : {});
  } finally { a.done(); }
}

export async function quiet<T>(work: () => Promise<T>): Promise<{ result: T; out: string; err: string }> {
  const out: string[] = []; const err: string[] = [];
  const [log, error] = [console.log, console.error];
  console.log = (...a: unknown[]) => out.push(a.join(" ")); console.error = (...a: unknown[]) => err.push(a.join(" "));
  try { return { result: await work(), out: out.join("\n"), err: err.join("\n") }; } finally { console.log = log; console.error = error; }
}

export const failing = (r: CrashResult) => r.situations.filter((s) => !s.held).map((s) => s.id);
