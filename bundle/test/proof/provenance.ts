// What a run of the Docker proof (run.ts) was a proof OF, and the rule that lets a release skip repeating it (15 Nov 2026, "make the release faster").
//
// The proof takes 40 minutes or more and exercises the bundle (this repository's bundle/ and modules/) against a Guard image. When neither changed
// since a full, passing proof, running it again proves nothing new. run.ts records `provenance` in results.json; `same-as-last.ts` compares the
// last results.json with the present tree and says whether a release may skip the proof (exit 0), run the short core set (exit 10) or run
// everything (exit 20). The rule is in monorepo docs/release-runbook.md, section 6. Pure functions here so the rule is unit tested.
import { spawnSync } from "node:child_process";

export interface Provenance {
  /** The git tree ids of the two directories the proof exercises, so any change to them (committed) changes the id. */
  bundleTree: string;
  modulesTree: string;
  /** The agents commit the proof ran at, and whether its working tree had uncommitted changes (a dirty run proves nothing about a commit). */
  agentsCommit: string;
  dirty: boolean;
  /** The Guard's code inputs: the monorepo's digest of the `R16-guard-unchanged` case (`geo-qual list --digests`), passed as GUARD_INPUT_DIGEST. Empty when unknown. */
  guardInputDigest: string;
  guardImage: string;
  /** Which phases and shop sizes ran: only a run of every phase counts as a full proof. */
  onlyPhases: string[] | null;
  shopSizes: number[];
}

function git(app: string, ...args: string[]): string {
  const r = spawnSync("git", ["-C", app, ...args], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : "";
}

export function collect(app: string, o: { guardInputDigest: string; guardImage: string; onlyPhases: string[] | null; shopSizes: number[] }): Provenance {
  return {
    bundleTree: git(app, "rev-parse", "HEAD:bundle"),
    modulesTree: git(app, "rev-parse", "HEAD:modules"),
    agentsCommit: git(app, "rev-parse", "HEAD"),
    dirty: git(app, "status", "--porcelain", "--", "bundle", "modules") !== "",
    ...o,
  };
}

export const SKIP = 0, CORE = 10, FULL = 20;
/** The phases of the short core set: money (a held refund survives, the licence block and wind-down), approvals (held refunds), isolation and the tripwires. */
export const CORE_PHASES = "licence-block,isolation,held,licence,tripwire,webhook";

/** `last` is a previous results.json (or null), `now` the present tree's provenance. Returns the decision and the reason, in words. */
export function decide(last: { provenance?: Provenance; summary?: { failed?: unknown[]; passed?: number }; error?: unknown } | null, now: Provenance): { code: number; reason: string } {
  if (now.dirty) return { code: FULL, reason: "the agents tree has uncommitted changes in bundle/ or modules/: run the full proof" };
  const p = last?.provenance;
  if (!last || !p) return { code: FULL, reason: "no earlier proof with a recorded provenance: run the full proof" };
  if (p.dirty || last.error || (last.summary?.failed?.length ?? 1) !== 0 || !(last.summary?.passed ?? 0)) return { code: FULL, reason: "the last proof did not pass cleanly, or ran on uncommitted changes: run the full proof" };
  if (p.onlyPhases !== null || ![1, 5, 10].every((n) => p.shopSizes.includes(n))) return { code: FULL, reason: "the last proof was not a full run at 1, 5 and 10 shops: run the full proof" };
  if (!now.guardInputDigest || !p.guardInputDigest) return { code: CORE, reason: "the Guard's input digest is unknown (GUARD_INPUT_DIGEST): cannot show the Guard is unchanged, run the core set" };
  if (p.bundleTree !== now.bundleTree || p.modulesTree !== now.modulesTree) return { code: FULL, reason: `bundle/ or modules/ changed since the last full proof (${p.agentsCommit.slice(0, 12)}): run the full proof` };
  if (p.guardInputDigest !== now.guardInputDigest) return { code: FULL, reason: "the Guard's code changed since the last full proof: run the full proof" };
  return { code: SKIP, reason: `bundle/, modules/ and the Guard's code are the ones of the last full, passing proof (${p.agentsCommit.slice(0, 12)}): skip the proof` };
}
