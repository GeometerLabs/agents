// Finding and running the real `geo-guard` program: `compile` (a spec becomes the bundle Guard loads) and `verify-bundle` (the bundle is checked against
// the guard.toml it will run with). Guard is closed software that you license separately; this file only runs a copy you already have.
//
// Where it looks, in order: the GEO_GUARD_BIN environment variable, a `geo-guard` on your PATH, then a Geometer monorepo build in a folder above this
// one (monorepo/target/debug or release). Nothing is downloaded.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";

/** The path of a geo-guard program, or undefined when there is none. */
export function findGuard(from: string = import.meta.dirname ?? process.cwd()): string | undefined {
  const named = process.env.GEO_GUARD_BIN;
  if (named) return existsSync(named) ? named : undefined;
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (dir && existsSync(join(dir, "geo-guard"))) return join(dir, "geo-guard");
  }
  // walk up from here, looking for a monorepo build beside or above this repository
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    for (const where of [join(dir, "monorepo", "target", "debug", "geo-guard"), join(dir, "monorepo", "target", "release", "geo-guard")]) {
      if (existsSync(where)) return where;
    }
    if (dirname(dir) === dir) return undefined;
  }
}

/** Why a test or a command did not run Guard, in words. */
export const NO_GUARD_REASON = "the geo-guard program was not found (set GEO_GUARD_BIN to its path, put it on your PATH, or build the monorepo); Guard is licensed separately";

export interface CompileSummary {
  digest: string;
  ceiling: string;
  tenant: string;
  tool: string;
  name: string;
  version: number;
  rules: number;
  limits: number;
  routes: number;
  stops_before_dispatch: string[];
  needs_provider_coordination: string[];
  unsupported: string[];
  tripwires: { passed: number; of: number; failed: string[]; not_self_testable: number; not_self_testable_items: { item: string; why: string }[] };
}

export type CompileResult = { ok: true; summary: CompileSummary } | { ok: false; problems: string[] };

/** `geo-guard compile --spec <spec> --out <bundle>`. A refusal comes back as its lines (`refused: rules[2] (...)`), never as an exception. */
export function compileSpec(bin: string, specFile: string, bundleFile: string): CompileResult {
  const r = spawnSync(bin, ["compile", "--spec", specFile, "--out", bundleFile], { encoding: "utf8" });
  if (r.status === 0) return { ok: true, summary: JSON.parse(r.stdout) as CompileSummary };
  const lines = (r.stderr || r.stdout || `exit ${r.status}`).split("\n").map((l) => l.trim()).filter(Boolean);
  return { ok: false, problems: lines };
}

export type VerifyResult = { ok: true; lines: string[] } | { ok: false; problems: string[] };

/** `geo-guard verify-bundle <bundle> [--config <guard.toml>]`: the bundle verifies, its tripwires hold, and (with a config) it is for that Guard's tenant and tool. */
export function verifyBundle(bin: string, bundleFile: string, config?: string): VerifyResult {
  const args = ["verify-bundle", bundleFile, ...(config ? ["--config", config] : [])];
  const r = spawnSync(bin, args, { encoding: "utf8" });
  if (r.status === 0) return { ok: true, lines: r.stdout.split("\n").filter(Boolean) };
  return { ok: false, problems: (r.stderr || r.stdout || `exit ${r.status}`).split("\n").map((l) => l.trim()).filter(Boolean) };
}

/** `geo-guard credential`: a new agent or admin token and the hash that goes in guard.toml. The token is shown once; keep it where the caller reads it. */
export function newCredential(bin: string): { token: string; sha256: string } {
  const out = execFileSync(bin, ["credential"], { encoding: "utf8" });
  const token = /token:\s*(\S+)/u.exec(out)?.[1];
  const sha256 = /token_sha256\s*=\s*"([0-9a-f]{64})"/u.exec(out)?.[1];
  if (!token || !sha256) throw new Error("geo-guard credential printed something this kit does not recognise");
  return { token, sha256 };
}
