// `geometer agent crash-test <name>`: run the situations against the builder's own agent, through the real Guards, on the agent's own settings, and say it the way the hand check does:
// "Held N of M", one line per situation with a tick or a cross, what could not be run on these settings or through this agent, and what was not tested. `--json` gives the same as data
// (the update reads that, and the go-live certificate is made from it).
import { join } from "node:path";
import { handCheckText } from "../../../modules/crash-test/print.ts";
import type { CheckResult, Skipped } from "../../../modules/crash-test/situations.ts";
import type { HandCheckRead } from "../../handcheck.ts";
import type { Context } from "../../deploy.ts";
import { loadServer, serverPaths } from "../../lib/server.ts";
import { paymentUpstreamOf, readAgent } from "../folder.ts";
import { OWN_API } from "../../../modules/payments/providers/index.ts";
import { findGuardBinary } from "../guard-process.ts";
import { planAgent } from "../plan.ts";
import { readAgentCredentials, sharesOneCredential } from "../credentials.ts";
import { AgentDidNotStart, NotDrivable, commandFor, resolveDriver, workingFolder } from "./driver.ts";
import { buildSituations } from "./situations.ts";
import type { Built } from "./situations.ts";
import type { CrashPlan } from "./world.ts";

export interface CrashOptions {
  /** Only these situations (their ids). */
  situations?: string[];
  /** Start the agent with this command instead of the one in agent.json. */
  run?: string;
  /** The version of the agent to start: replaces `{version}` in the command and is in its environment. Default: the version in agent.json. */
  version?: string;
  guardBin?: string;
  /** Called with a line when a situation starts (for the screen; not part of the result). */
  progress?: (line: string) => void;
}

export interface CrashSituation { id: string; title: string; held: boolean; how: string; checks: CheckResult[] }

/** What a crash test found. The `--json` output. */
export interface CrashResult {
  format: "geometer-agent-crash-test/1";
  agent: string;
  /** The version of the agent that was started, when there is one. */
  version: string | null;
  held: number;
  total: number;
  failed: number;
  situations: CrashSituation[];
  /** Situations that could not be run on these settings, or through this agent, each with the reason. They are in neither count. */
  notRun: Skipped[];
  notTested: string[];
  tookMs: number;
}

/** What the crash test does not cover, whatever the result. The go-live certificate carries the same list. */
export const NOT_TESTED: readonly string[] = [
  "real WhatsApp, real Razorpay (test mode or live) and a real Google calendar (stand-in services were used, with your agent's real Guards in front)",
  "the owner's answer on WhatsApp through Geometer's inbox and relay (where a refund is held, the owner's yes or no is given to Guard directly)",
  "a held refund running out after the shop's own hours (the request is made to run out after 60 seconds, the shortest Guard takes)",
  "your agent being restarted in the middle of a step",
  "two customers at the exact same instant",
  "languages other than the lines in agent.json, and voice",
  "services other than Razorpay, WhatsApp and Google Calendar",
  "faults beyond the ones listed above",
];

export interface Planned { plan: CrashPlan; guardFoundIn: string }

/** Everything a crash test needs, or the plain reason it cannot start. */
export async function planCrashTest(ctx: Context, name: string, o: CrashOptions = {}): Promise<Planned> {
  const folder = readAgent(ctx.dir, name);
  if (!folder.agent || !folder.settings) throw new Error(`${name}'s folder cannot be read: ${folder.problems.join(" ")}`);
  const version = o.version ?? folder.agent.version;
  const command = commandFor(folder.agent, version, o.run);
  if (!command) throw new Error(`${name} has no command to start it with. Give one with \`geometer agent set ${name} --run "node my-agent/server.js"\` (the crash test starts your agent with it, once for each situation), or here with --run "<command>".`);
  // B71 step 6: there is no stand-in for an API Geometer has no module for, so no situation could be judged on what it holds
  if (paymentUpstreamOf(folder.agent.upstreams)?.id === OWN_API) throw new Error(`${name} takes money through its own gateway's API, and the crash test has no stand-in for it, so it cannot run. Its Guard still enforces the rules you kept (\`geometer agent check ${name}\` proves them on the running Guard); the crash test runs for an agent on UPI or on a gateway this checkout has a module for.`);
  const server = loadServer(ctx.dir);
  const planned = planAgent(server, folder);
  if (planned.problems.length > 0) throw new Error(`${name}'s Guards cannot be planned: ${planned.problems.map((p) => p.message).join(" ")}`);
  const found = await findGuardBinary({ ...(o.guardBin ? { flag: o.guardBin } : {}), runner: ctx.runner, docker: ctx.docker, image: server.guardImage, cacheDir: join(serverPaths(ctx.dir).state, "work") });
  if (!found.ok) throw new Error(found.reason);
  const driver = resolveDriver(folder.agent.driver);
  return {
    guardFoundIn: found.how,
    plan: { name, folder, settings: folder.settings, server, guards: planned.guards, guardBinary: found.path, command, cwd: workingFolder(serverPaths(ctx.dir).agent(name), driver), ...(version ? { version } : {}), driver,
      // the credentials' shape the agent has on the server: one per Guard, or (made before 12 Nov 2026 and not rotated yet) one shared
      ...(sharesOneCredential(readAgentCredentials(ctx.dir, name, folder.agent.upstreams)) ? { sharedCredential: true } : {}) },
  };
}

/** The situations by id: all of them, or the ones asked for (an id that is not one is an error that names them all). */
export function chooseSituations(built: Built, ids: string[] | undefined): Built {
  if (!ids) return built;
  const known = [...built.situations.map((s) => s.id), ...built.skipped.map((s) => s.id)];
  const unknown = ids.filter((id) => !known.includes(id));
  if (unknown.length > 0) throw new Error(`I don't know the situation${unknown.length > 1 ? "s" : ""} ${unknown.join(", ")}. They are: ${known.join(", ")}.`);
  return { situations: built.situations.filter((s) => ids.includes(s.id)), skipped: built.skipped.filter((s) => ids.includes(s.id)) };
}

// Runs the chosen situations one after another, each in its own world, and totals what held. A situation that cannot run is listed as not run, never counted as passed.
export async function runCrashTest(plan: CrashPlan, o: CrashOptions = {}): Promise<CrashResult> {
  const built = chooseSituations(buildSituations(plan), o.situations);
  const started = performance.now();
  const situations: CrashSituation[] = [];
  const notRun: Skipped[] = [...built.skipped];
  for (const [i, situation] of built.situations.entries()) {
    o.progress?.(`  ${i + 1}/${built.situations.length}  ${situation.title}`);
    try {
      const checks = await situation.run();
      situations.push({ id: situation.id, title: situation.title, how: situation.how, held: checks.length > 0 && checks.every((c) => c.passed), checks });
    } catch (e) {
      if (e instanceof NotDrivable) notRun.push({ id: situation.id, title: situation.title, reason: e.message });
      // the very first world that cannot start means this agent cannot be run at all: that is said as an error, not counted as a result
      else if (e instanceof AgentDidNotStart && situations.length === 0 && notRun.length === built.skipped.length) throw new Error(`The agent did not start: ${e.message}. The command was: ${plan.command}`);
      else situations.push({ id: situation.id, title: situation.title, how: situation.how, held: false, checks: [{ label: e instanceof AgentDidNotStart ? "The agent started and answered" : "The agent kept going without an error", passed: false, detail: e instanceof AgentDidNotStart ? e.message : ((e as Error).stack?.split("\n").slice(0, 3).join(" ") ?? String(e)) }] });
    }
  }
  const held = situations.filter((s) => s.held).length;
  return {
    format: "geometer-agent-crash-test/1", agent: plan.name, version: plan.version ?? null, held, total: situations.length, failed: situations.length - held,
    situations, notRun, notTested: notTestedFor(notRun), tookMs: Math.round(performance.now() - started),
  };
}

/** What was not tested: the list that is always true, then each situation that could not be run here, by name. */
export const notTestedFor = (notRun: readonly Skipped[]): string[] => [...NOT_TESTED, ...notRun.map((s) => `${s.title} (not run: ${s.reason.length > 90 ? `${s.reason.slice(0, 87)}...` : s.reason})`)];

/** The result as the hand check prints it, so that anything that reads the hand check's lines reads this too. */
export function crashTestText(result: CrashResult, settingsName: string, options: { showAll: boolean }): { text: string; failed: number } {
  return handCheckText({
    results: result.situations.map((s) => ({ situation: { id: s.id, title: s.title, how: s.how, run: async () => s.checks }, held: s.held, checks: s.checks })),
    skipped: result.notRun, showAll: options.showAll, tookMs: result.tookMs,
    text: {
      heading: [
        "Stand-in services behind your agent's real Guards. Your agent was started by its own command; nothing in it was changed.",
        "",
        `CRASH TEST   ${settingsName} · ${result.agent}${result.version ? ` · version ${result.version}` : ""} · an agent you wrote   (stand-in services, real Guard)`,
      ],
      workDone: ({ situations, checks, tookMs }) => [
        `  Work done for you: ${situations} situations and ${checks} checks in ${(tookMs / 1000).toFixed(1)} s, against stand-in Razorpay, Google Calendar and`,
        "  WhatsApp behind your agent's real Guards: lost replies after a payment link and after a refund, a payment event delivered twice and",
        "  late, a calendar that saves nothing, an expired key, refunds above the limit and above what was paid, an owner who says no to a held",
        "  refund and one who never answers, the same WhatsApp message twice, and a customer asking for a price below the floor.",
      ],
      shopName: settingsName,
      judged: (checks) => [
        "  Each situation was judged from the stand-ins' own records (what Razorpay, the calendar and the WhatsApp outbox hold) and from what",
        `  each Guard decided about each call your agent made, never from what the agent said. ${checks} checks in all.`,
      ],
      notTested: result.notTested,
    },
  });
}

/** The same result as the update reads a hand check's: how many held, and each situation's first failed check. */
export function readOfCrash(result: CrashResult): HandCheckRead {
  return {
    held: result.held, total: result.total,
    situations: result.situations.map((s) => {
      const first = s.checks.find((c) => !c.passed);
      return { title: s.title, held: s.held, why: first ? (first.detail ? `${first.label}: ${first.detail}` : first.label) : "" };
    }),
  };
}

/** Read the `--json` output of a crash test child (the update asks for it). Undefined when it is not one. */
export function parseCrashResult(stdout: string): CrashResult | undefined {
  try {
    const r = JSON.parse(stdout.trim().split("\n").at(-1) ?? "") as CrashResult;
    return r.format === "geometer-agent-crash-test/1" && Array.isArray(r.situations) && typeof r.held === "number" && typeof r.total === "number" ? r : undefined;
  } catch { return undefined; }
}
