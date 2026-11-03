// The hand check: run every crash-test situation against the in-memory fakes and say plainly what held, what failed
// and what was not tested. Run it from anywhere: node pathways/bookings/scripts/hand-check.ts
// It runs on Glow Salon's example settings, or on any shop's own: add --settings <file>. A situation that a shop's settings
// cannot express (a shop with no cancellation window has nothing to be "late" for) is not run and is named, so the count
// never includes it.
// It reads in three layers: the result line and the work done by default, and "--details" (or --all) shows what was
// done in each situation: how the stand-ins made it go wrong, and every check read from their records.
import { parseArgs } from "node:util";
import { HAND_RUN, NOT_TESTED, STAND_IN_SERVICES } from "../crash-test/not-tested.ts";
import { languageList } from "../crash-test/says.ts";
import { runOn } from "../crash-test/situations.ts";
import { UsageError, main, readSettings } from "../report/cli.ts";
import { glowSalon } from "../src/harness.ts";
import { LANGUAGES } from "../src/settings.ts";

await main(async () => {
  let args;
  try {
    args = parseArgs({ args: process.argv.slice(2), options: { settings: { type: "string" }, details: { type: "boolean" }, all: { type: "boolean" } } });
  } catch (e) { throw new UsageError(`${(e as Error).message}\nSee the first lines of pathways/bookings/scripts/hand-check.ts for the options.`); }
  const showAll = args.values.details === true || args.values.all === true;
  const settings = args.values.settings ? readSettings(args.values.settings) : glowSalon();
  const started = performance.now();
  const { results, skipped } = await runOn(settings);
  const tookMs = Math.round(performance.now() - started);
  const held = results.filter((r) => r.held);
  const failed = results.filter((r) => !r.held);
  const checkCount = results.reduce((n, r) => n + r.checks.length, 0);
  const speaks = LANGUAGES.filter((l) => settings.languages.includes(l));
  const names = languageList(speaks);

  const lines: string[] = [];
  lines.push("Stand-ins, not the Geometer engine. Hand-run check for the Phase 0 prototype.");
  lines.push("");
  lines.push(`CRASH TEST   ${settings.name} · Bookings · ${names.replace(/, | and /g, " + ")}   (${STAND_IN_SERVICES}, ${HAND_RUN})`);
  lines.push("");
  lines.push(`  Held ${held.length} of ${results.length}.  ${failed.length} failed.  ${NOT_TESTED.length} not tested.${skipped.length > 0 ? `  ${skipped.length} not run on these settings.` : ""}`);
  lines.push("");
  lines.push(`  Work done for you: ${results.length} situations and ${checkCount} checks in ${tookMs} ms, against stand-in WhatsApp,`);
  lines.push("  calendar and payments: lost replies, duplicate messages and payments, silent calendar failures, late payments,");
  lines.push(`  an expired key, and customers haggling or trying to trick the agent in ${names}.`);
  if (!showAll) lines.push("  Show what was done in each situation: add --details");
  lines.push("");
  for (const r of results) {
    const number = r.situation.planNumber ? `#${String(r.situation.planNumber).padStart(2, " ")}` : "   ";
    lines.push(`  ${r.held ? "✓" : "✗"} ${number}  ${r.situation.title}`);
    if (showAll && r.situation.how) lines.push(`        how: ${r.situation.how}`);
    if (r.situation.leftOut) for (const part of r.situation.leftOut) lines.push(`        left out: ${part}`);
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
  if (skipped.length > 0) {
    lines.push("");
    lines.push(`  NOT RUN on ${settings.name}'s settings (${skipped.length}), and not counted above:`);
    for (const s of skipped) lines.push(`    - ${s.title}: ${s.reason}.`);
  }
  const leftOut = results.filter((r) => r.situation.leftOut);
  if (leftOut.length > 0 && !showAll) {
    lines.push("");
    lines.push(`  Parts left out of ${leftOut.length} situation(s) because these settings cannot express them: add --details to see which.`);
  }
  lines.push("");
  lines.push(`  NOT TESTED   ${NOT_TESTED.map((n) => n.text).join(" · ")}`);
  console.log(lines.join("\n"));
  return failed.length === 0 ? 0 : 1;
});
