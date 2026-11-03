// The hand check: run every crash-test situation against the in-memory fakes and say plainly what held, what failed
// and what was not tested. Run it from anywhere: node pathways/bookings/scripts/hand-check.ts
// It reads in three layers: the result line and the work done by default, and "--details" (or --all) shows what was
// done in each situation: how the stand-ins made it go wrong, and every check read from their records.
import { runAll } from "../crash-test/situations.ts";

// Things this check does not cover. Always printed, whatever the result.
const NOT_TESTED = [
  "voice calls", "group bookings", "walk-ins", "payments outside Razorpay",
  "real WhatsApp", "real Razorpay (test mode or live)", "a real calendar", "webhook signatures",
  "a real model (the parser is rule-based, and messages are templates only)", "Tamil, Telugu and other languages",
  "a native speaker's review of the Malayalam and Kannada wording (machine-written, see REVIEW-ml.md and REVIEW-kn.md)",
  "a crash or restart in the middle of a step", "two customers at the exact same instant",
  "faults beyond the ones listed above",
];

const showAll = process.argv.includes("--all") || process.argv.includes("--details");
const started = performance.now();
const results = await runAll();
const tookMs = Math.round(performance.now() - started);
const held = results.filter((r) => r.held);
const failed = results.filter((r) => !r.held);
const checkCount = results.reduce((n, r) => n + r.checks.length, 0);

const lines: string[] = [];
lines.push("Stand-ins, not the Geometer engine. Hand-run check for the Phase 0 prototype.");
lines.push("");
lines.push("CRASH TEST   Glow Salon · Bookings · Hindi + English + Malayalam + Kannada   (stand-in services, hand-run)");
lines.push("");
lines.push(`  Held ${held.length} of ${results.length}.  ${failed.length} failed.  ${NOT_TESTED.length} not tested.`);
lines.push("");
lines.push(`  Work done for you: ${results.length} situations and ${checkCount} checks in ${tookMs} ms, against stand-in WhatsApp,`);
lines.push("  calendar and payments: lost replies, duplicate messages and payments, silent calendar failures, late payments,");
lines.push("  an expired key, and customers haggling or trying to trick the agent in Hindi, English, Malayalam and Kannada.");
if (!showAll) lines.push("  Show what was done in each situation: add --details");
lines.push("");
for (const r of results) {
  const number = r.situation.planNumber ? `#${String(r.situation.planNumber).padStart(2, " ")}` : "   ";
  lines.push(`  ${r.held ? "✓" : "✗"} ${number}  ${r.situation.title}`);
  if (showAll && r.situation.how) lines.push(`        how: ${r.situation.how}`);
  for (const c of r.checks) {
    if (!c.passed) lines.push(`        ✗ ${c.label}${c.detail ? `\n            ${c.detail}` : ""}`);
    else if (showAll) lines.push(`        ✓ ${c.label}`);
  }
}
lines.push("");
lines.push(`  Each situation was judged from the fakes' own records (what the calendar, the payments service and the`);
lines.push(`  WhatsApp outbox hold), never from what the agent said. ${checkCount} checks in all.`);
lines.push("");
lines.push(failed.length === 0
  ? `  Held ${held.length} of ${results.length} within what was tried. That is a count of these situations, not a verdict on the agent.`
  : `  ${failed.length} failed: ${failed.map((r) => r.situation.title).join("; ")}.`);
lines.push("");
lines.push(`  NOT TESTED   ${NOT_TESTED.join(" · ")}`);
console.log(lines.join("\n"));
process.exitCode = failed.length === 0 ? 0 : 1;
