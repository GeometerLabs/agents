// The monthly report's jobs: when a refund held for the owner stops being "waiting for owner" (report/data.ts workOf). Found in the Go port (22 Nov 2026): only an
// owner_decision cleared a hold, so a hold settled by a person's word (Guard's already_done) or by the payments service's own list, or ended by a refusal, stayed
// "unresolved: refund-waiting-for-owner" in that month and every month after. The Go twin is held by the report vectors (go/scripts/gen_bookings_report_vectors.ts, b-6 and b-7).
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeClock } from "../../../../modules/core/clock.ts";
import { zonedToMs } from "../../../../modules/core/time.ts";
import { createRecord } from "../../../../modules/record/record.ts";
import type { Action, Outcome } from "../../../../modules/record/record.ts";
import { buildMonthlyReport } from "../report/data.ts";
import { glowSalon } from "../src/harness.ts";

const TZ = "Asia/Kolkata";
const at = (month: number, day: number, hour = 10) => zonedToMs({ year: 2026, month, day }, { hour, minute: 0 }, TZ);

test("a refund held for the owner is waiting only until the owner answers, or a later line of the same payment settles or ends it", () => {
  const clock = fakeClock(at(11, 2));
  const record = createRecord(clock);
  const line = (booking: string, action: string, outcome: Outcome, refs: Record<string, string> = {}) =>
    record.append({ conversation: "+919811111111", booking, action: action as Action, inputs: {}, outcome, language: "en", refs });
  // b-1: settled by a person's word; b-2: nobody answered; b-3: a refund of ANOTHER payment of the same booking was made; b-4: Guard refused the approved refund for good (blocked; a failed line is counted as an unconfirmed step anyway); b-5: the owner said yes
  for (const b of ["b-1", "b-2", "b-3", "b-4", "b-5"]) line(b, "refund", "held_for_owner", { paymentId: `pay_${b}` });
  clock.set(at(11, 3));
  line("b-1", "refund", "confirmed", { paymentId: "pay_b-1", confirmedBy: "operator:asha" });
  line("b-3", "refund", "confirmed", { paymentId: "pay_other", refundId: "rf_9" });
  line("b-4", "refund", "blocked", { paymentId: "pay_b-4" });
  line("b-5", "owner_decision", "confirmed", { command: "approve" });
  const report = (from: number, to: number) => buildMonthlyReport({ settings: glowSalon(), entries: record.entries(), bookings: [], from, to, source: "stand-in", madeAt: to });
  const why = (r: ReturnType<typeof report>) => Object.fromEntries(r.work.list.map((j) => [j.booking, j.why]));
  assert.deepEqual(why(report(at(11, 1, 0), at(12, 1, 0))), { "b-1": null, "b-2": "refund-waiting-for-owner", "b-3": "refund-waiting-for-owner", "b-4": null, "b-5": null });
  // and in a later month the settled hold stays settled
  clock.set(at(12, 5));
  for (const b of ["b-1", "b-2"]) line(b, "send_message", "confirmed", { to: "customer" });
  assert.deepEqual(why(report(at(12, 1, 0), at(12, 31, 0))), { "b-1": null, "b-2": "refund-waiting-for-owner" });
});
