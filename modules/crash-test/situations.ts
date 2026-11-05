// The frame of a crash test, for every template. A situation starts a fresh world, makes something go wrong on purpose, and then JUDGES FROM THE STAND-INS' OWN
// RECORDS: what the payments service holds, what the messaging outbox holds. It never judges from what the agent said it did. The situations themselves are each
// template's (Bookings: a calendar that saves nothing; Fees: a payment event that arrives twice). The frame is the same, and so is the hand check that prints it.

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

/** What a run on one shop's settings did: the situations that ran, and the ones that could not be run on these settings. */
export interface HandCheckRun<Settings = unknown> { results: SituationResult[]; skipped: Skipped[]; settings: Settings }

/** Run one situation. An exception inside the agent counts as a failure, not a crash of the check. */
export async function runSituation(situation: Situation): Promise<SituationResult> {
  let checks: CheckResult[];
  try {
    checks = await situation.run();
  } catch (e) {
    checks = [{ label: "The agent kept going without an error", passed: false, detail: (e as Error).stack?.split("\n").slice(0, 3).join(" ") ?? String(e) }];
  }
  return { situation, held: checks.length > 0 && checks.every((c) => c.passed), checks };
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
