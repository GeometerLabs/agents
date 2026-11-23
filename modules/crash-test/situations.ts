// The frame of a crash test, for every template. A situation starts a fresh world, makes something go wrong on purpose, and then JUDGES FROM THE STAND-INS' OWN
// RECORDS: what the payments service holds, what the messaging outbox holds. It never judges from what the agent said it did. The situations themselves are each
// template's (Bookings: a calendar that saves nothing; Fees: a payment event that arrives twice). The frame is the same, and so is the hand check that prints it.
// Since 24 Nov 2026 each situation runs on the shop's own Go program (modules/crash-test/go-shop.ts): every world a situation opens is closed when it ends.
import { goProgram, servedVersions } from "./programs.ts";
import type { ProgramRan } from "./programs.ts";

// Every world a situation opens is closed when the situation ends (runSituation below calls closeOpened; go-world.ts registers each world), so no shop and no stand-in outlives it,
// also when the situation throws half-way.
const opened = new Set<() => Promise<string[] | void>>();
/** Register a world's `close` to be called at the end of the situation that opened it. It may answer problems the world saw that no check of the situation looks at. */
export function closeLater(close: () => Promise<string[] | void>): void { opened.add(close); }
/** Close every world opened since the last call, and answer the problems they saw. Never throws: a world that would not close is logged, not a failure of the next situation. */
export async function closeOpened(): Promise<string[]> {
  const problems: string[] = [];
  for (const close of [...opened]) {
    opened.delete(close);
    try { problems.push(...((await close()) ?? [])); } catch (e) { console.error(`A hand-check world would not close: ${(e as Error).message}`); }
  }
  return problems;
}

export interface CheckResult { label: string; passed: boolean; detail: string }

export interface Situation {
  id: string;
  /** The row in the implementation plan, when it has one. */
  planNumber?: number;
  title: string;
  /** How the stand-ins make it happen. */
  how: string;
  /** Parts of this situation that this shop's settings cannot express, so they were not run (for example "a closed day: the shop is open every day"). */
  leftOut?: string[];
  run(): Promise<CheckResult[]>;
}

/** A situation that was not run on these settings, and why. */
export interface Skipped { id: string; title: string; reason: string }

export interface SituationResult {
  situation: Situation;
  held: boolean;
  checks: CheckResult[];
}

/**
 * What a run on one shop's settings did: the situations that ran, the ones that could not be run on these settings, and the program they ran on (left out when none could
 * run because the program is not there: then `skipped` says so, and the gate refuses a run with nothing in it).
 */
export interface HandCheckRun<Settings = unknown> { results: SituationResult[]; skipped: Skipped[]; settings: Settings; program?: ProgramRan }

/** Run one situation. An exception inside the agent counts as a failure, not a crash of the check. */
export async function runSituation(situation: Situation): Promise<SituationResult> {
  let checks: CheckResult[];
  try {
    checks = await situation.run();
  } catch (e) {
    checks = [{ label: "The agent kept going without an error", passed: false, detail: (e as Error).stack?.split("\n").slice(0, 3).join(" ") ?? String(e) }];
  }
  // what the worlds saw that no check of the situation reads: a message the program sent that the provider refused, with no fault planned (go-world.ts), is a failure too
  const problems = await closeOpened();
  if (problems.length > 0) checks = [...checks, { label: "Every message the program sent was taken by the provider", passed: false, detail: problems.join(" | ") }];
  return { situation, held: checks.length > 0 && checks.every((c) => c.passed), checks };
}

/**
 * Run the situations on the shop's own Go program `name` (go/cmd/<name>), which serves template version `version`. A program that is not on this machine runs nothing: every
 * situation is listed as not run with that reason, never passed and never run on anything else.
 */
export async function runOnProgram<Settings>(name: string, version: string, build: () => { situations: Situation[]; skipped: Skipped[] }, settings: Settings): Promise<HandCheckRun<Settings>> {
  const program = goProgram(name);
  if (!program.ok) return { results: [], skipped: [{ id: "all", title: "Every situation", reason: program.reason }], settings };
  const run = await runAllSituations(build(), settings);
  // the version the program said it serves (go-shop.ts), which a template folder kept beside a server may not share
  return { ...run, program: { name, version: servedVersions.get(name) ?? version, sha256: program.sha256 } };
}

/** Run every built situation in order. */
export async function runAllSituations<Settings>(built: { situations: Situation[]; skipped: Skipped[] }, settings: Settings): Promise<HandCheckRun<Settings>> {
  const results: SituationResult[] = [];
  for (const s of built.situations) results.push(await runSituation(s));
  return { results, skipped: built.skipped, settings };
}

/** Collect the checks of one situation: `expect(label, ok, detail)`. The detail is kept only for a check that failed. */
export function checker() {
  const results: CheckResult[] = [];
  return { results, expect(label: string, ok: boolean, detail = "") { results.push({ label, passed: ok, detail: ok ? "" : detail }); } };
}
