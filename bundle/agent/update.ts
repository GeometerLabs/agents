// `geometer update` for an agent someone else wrote (B53 with B52). A template client has a pin and a hand check; an agent has a version that its builder names (a git commit, an image tag:
// `version` in agent.json) and the crash test. Geometer does not run the agent, so "moving" it means what it can mean: the crash test is run on the agent's own settings at the version
// last recorded as in service and again at the version in agent.json, the same two answers are compared the way a template's are, and an agent that does no worse is recorded as being at the
// new version (with a go-live certificate for it). One that does worse is HELD BACK: the new version gets no certificate, the old stays the version in service, and the builder is told which
// situation, so they keep running the old one. Nothing is deployed, since a new version of the agent is not a change to its Guards.
import { join } from "node:path";
import type { Context } from "../deploy.ts";
import { compare } from "../handcheck.ts";
import type { HandCheckRead } from "../handcheck.ts";
import { loadState } from "../lib/state.ts";
import type { Step } from "../lib/state.ts";
import { readAgent } from "./folder.ts";
import { issueGoLive, recordService } from "./crash-test/golive.ts";
import { parseCrashResult, readOfCrash } from "./crash-test/run.ts";
import type { CrashResult } from "./crash-test/run.ts";

const firstWords = (text: string): string => (text.split("\n").map((l) => l.trim()).find((l) => l !== "") ?? "").slice(0, 300);

/** Run `geometer agent crash-test <name> --json` at one version, as its own program (it starts Guards and the agent, and ends them). The runner is the seam the tests answer. */
export async function runAgentCrashTest(ctx: Context, name: string, version: string): Promise<{ ok: true; result: CrashResult } | { ok: false; reason: string }> {
  const r = await ctx.runner.run(process.execPath, [join(ctx.appDir, "bundle", "geometer.ts"), "agent", "crash-test", name, "--json", "--version", version, "--server", ctx.dir], { timeoutMs: 30 * 60_000 });
  const result = parseCrashResult(r.stdout);
  if (result) return { ok: true, result };
  return { ok: false, reason: firstWords(r.stderr) || firstWords(r.stdout) || `it ended with exit code ${r.code} and printed nothing` };
}

const counts = (r: { held: number; total: number }) => ({ held: r.held, of: r.total });

/** One agent's step in an update. Writes nothing for a dry run. */
export async function updateAgent(ctx: Context, name: string, dryRun: boolean): Promise<Step> {
  const at = ctx.now().toISOString();
  const heldBack = (reason: string, more: Partial<Step> = {}): Step => ({ status: "held-back", at, reason, ...more });
  const folder = readAgent(ctx.dir, name);
  if (!folder.agent || !folder.settings) return heldBack(`Its folder cannot be read, so it cannot be checked: ${folder.problems.join(" ")}`);
  const run = folder.agent.run;
  if (!run) return { status: "skipped", at, reason: `It has no command to start it with, so it cannot be crash-tested. Give one: geometer agent set ${name} --run "<command>" --version <version>. Until then you update it yourself.` };
  const target = folder.agent.version;
  if (!target) return { status: "skipped", at, reason: `agent.json has no version, so there is no new version to check. Say which version your agent is at: geometer agent set ${name} --version <version>.` };
  const running = loadState(ctx.dir).agents?.[name]?.service?.version ?? undefined;
  if (running === target) return { status: "unchanged", at, from: running, to: target, reason: `Already on ${target}.` };

  ctx.log(`${name}: running the crash test on its own settings${running ? ` at ${running} and` : ""} at ${target}...`);
  let before: HandCheckRead | undefined;
  if (running) {
    const b = await runAgentCrashTest(ctx, name, running);
    if (!b.ok) return heldBack(`The crash test could not be run at ${running}, the version it was last checked at, so there is nothing to compare ${target} with (${b.reason}). Keep running ${running}.`, { from: running, to: target });
    before = readOfCrash(b.result);
  }
  const a = await runAgentCrashTest(ctx, name, target);
  if (!a.ok) return heldBack(`The crash test could not be run at ${target} (${a.reason}).${running ? ` Keep running ${running}.` : ""}`, { ...(running ? { from: running } : {}), to: target, ...(before ? { before: counts(before) } : {}) });
  const after = readOfCrash(a.result);
  const base = { ...(running ? { from: running } : {}), to: target, ...(before ? { before: counts(before) } : {}), after: counts(after) };
  if (after.total === 0) return heldBack(`No situation could be run at ${target}: ${a.result.notRun.map((s) => `${s.title} (${s.reason})`).join("; ") || "none ran"}.${running ? ` Keep running ${running}.` : ""}`, base);

  // a situation that held before and fails now, or is not run now, holds the agent back; one that failed both times does not (it is no worse off), and a new one that fails does
  const diff = compare(before ?? { held: 0, total: 0, situations: [] }, after);
  if (diff.failing.length > 0 || diff.notChecked.length > 0) {
    const said = [
      `Held ${after.held} of ${after.total} at ${target}${before ? `; ${before.held} of ${before.total} held at ${running}` : ""}.`,
      diff.failing.length > 0 ? `Now failing: ${diff.failing.map((f) => f.title).join("; ")}.` : "",
      diff.notChecked.length > 0 ? `No longer checked at ${target}: ${diff.notChecked.join("; ")}.` : "",
      running ? `Keep running ${running}: ${target} gets no go-live certificate.` : `${target} gets no go-live certificate.`,
    ].filter(Boolean).join(" ");
    return heldBack(said, { ...base, failing: diff.failing, notChecked: diff.notChecked });
  }
  // the two runs started the same code when the command never says which version it wants: the comparison then shows nothing
  const sameCode = running !== undefined && !run.includes("{version}") && !/GEOMETER_AGENT_VERSION/u.test(run);
  const note = sameCode ? `Note: the run command does not use {version} or $GEOMETER_AGENT_VERSION, so both crash tests started the same code.` : undefined;
  if (!dryRun) recordService(ctx, name, a.result, issueGoLive(ctx, name, a.result).code);
  return { status: "moved", at, ...base, ...(note ? { reason: note } : {}) };
}
