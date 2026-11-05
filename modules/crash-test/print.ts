// What the hand check prints, for every template: the result line first ("Held N of M"), then one line per situation with a tick or a cross, then what was not
// run and what was not tested. The words around it are each template's; the shape is the same, because the deploy bundle reads it
// (bundle/handcheck.ts: "Held N of M" and the tick and cross lines), and so does a person.
import type { Skipped, SituationResult } from "./situations.ts";

export interface HandCheckText {
  /** The lines before the result line, ending with the "CRASH TEST ..." line. */
  heading: string[];
  /** The lines that say what work was done, given the counts. */
  workDone(counts: { situations: number; checks: number; tookMs: number }): string[];
  /** What was not run on these settings is named by `skipped`; this is the shop's name for it. */
  shopName: string;
  /** The lines that say what each situation was judged from (the stand-ins' records, never what the agent said), in the template's words, with the number of checks. */
  judged(checks: number): string[];
  /** The list of what was not tested, in the hand check's own words. */
  notTested: string[];
}

export function handCheckText(args: { results: SituationResult[]; skipped: Skipped[]; showAll: boolean; tookMs: number; text: HandCheckText }): { text: string; failed: number } {
  const { results, skipped, showAll, tookMs, text } = args;
  const held = results.filter((r) => r.held);
  const failed = results.filter((r) => !r.held);
  const checkCount = results.reduce((n, r) => n + r.checks.length, 0);
  const lines: string[] = [...text.heading, ""];
  lines.push(`  Held ${held.length} of ${results.length}.  ${failed.length} failed.  ${text.notTested.length} not tested.${skipped.length > 0 ? `  ${skipped.length} not run on these settings.` : ""}`);
  lines.push("");
  lines.push(...text.workDone({ situations: results.length, checks: checkCount, tookMs }));
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
  lines.push(...text.judged(checkCount));
  lines.push("");
  lines.push(failed.length === 0
    ? `  Held ${held.length} of ${results.length} within what was tried. That is a count of these situations, not a verdict on the agent.`
    : `  ${failed.length} failed: ${failed.map((r) => r.situation.title).join("; ")}.`);
  if (skipped.length > 0) {
    lines.push("");
    lines.push(`  NOT RUN on ${text.shopName}'s settings (${skipped.length}), and not counted above:`);
    for (const s of skipped) lines.push(`    - ${s.title}: ${s.reason}.`);
  }
  const leftOut = results.filter((r) => r.situation.leftOut);
  if (leftOut.length > 0 && !showAll) {
    lines.push("");
    lines.push(`  Parts left out of ${leftOut.length} situation(s) because these settings cannot express them: add --details to see which.`);
  }
  lines.push("");
  lines.push(`  NOT TESTED   ${text.notTested.join(" · ")}`);
  return { text: lines.join("\n"), failed: failed.length };
}
