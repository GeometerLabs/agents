// `geo-guard compile`, then `geo-guard verify-bundle --config`, run inside the Guard image with no network. A deploy goes ahead only if the
// spec compiles and EVERY tripwire passes: a Guard whose rules would let a forbidden call through is refused here, by the rule's name, before
// it is ever started. The runner is a seam; nothing here knows about Docker beyond building the arguments.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Problem } from "../lib/util.ts";
import type { Runner } from "../lib/runner.ts";

export interface CompileResult { digest: string; tool: string; tenant: string; version: number; text: string }

export interface TripwireResult {
  /** verify-bundle exited 0: the bundle checks out, matches its guard.toml, and every tripwire passed. */
  ok: boolean;
  passed: number;
  of: number;
  /** What a tripwire cannot test without writing: each is named, and none is ever counted as proven. */
  notSelfTestable: string[];
  /** Rules whose tripwire would have been allowed. */
  failedRules: string[];
  text: string;
}

export interface GuardTool {
  compile(specText: string): Promise<{ ok: true; result: CompileResult } | { ok: false; problems: Problem[] }>;
  verify(bundleText: string, tomlText: string): Promise<TripwireResult>;
}

/** Guard's `refused: ...` lines, each with the rule it names if it names one. */
export function refusalProblems(stage: string, text: string): Problem[] {
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  const refused = lines.filter((l) => /^(geo-guard: )?(refused:|tripwire failed)/u.test(l));
  return (refused.length > 0 ? refused : lines.slice(0, 5)).map((line) => {
    // the compiler names a rule in one of three ways; the most specific is tried first ("a rule of this spec" would otherwise be read as a rule called "of")
    const id = /no bundle was written: ([A-Za-z0-9][A-Za-z0-9._:/@+-]*) expected/u.exec(line)?.[1] ?? /rules\[\d+\] \(([^)]+)\)/u.exec(line)?.[1] ?? /tripwire failed: rule ([A-Za-z0-9][A-Za-z0-9._:/@+-]*)/u.exec(line)?.[1];
    return { rule: `${stage}${id ? `:${id}` : ""}`, message: line.replace(/^geo-guard: /u, "") };
  });
}

export function parseVerify(code: number, stdout: string, stderr: string): TripwireResult {
  const counts = /tripwires: passed (\d+) of (\d+)(?:, not self-testable (\d+))?/u.exec(stdout);
  const failedRules = [...stderr.matchAll(/tripwire failed: rule (\S+)/gu)].map((m) => m[1]);
  const refusedCounts = /(\d+) of (\d+) tripwires would have been allowed/u.exec(stderr);
  const of = counts ? Number(counts[2]) : refusedCounts ? Number(refusedCounts[2]) : 0;
  const passed = counts ? Number(counts[1]) : refusedCounts ? of - Number(refusedCounts[1]) : 0;
  return {
    ok: code === 0 && counts !== null && Number(counts[1]) === Number(counts[2]),
    passed, of,
    notSelfTestable: [...stdout.matchAll(/^\s*not self-testable: (.+)$/gmu)].map((m) => m[1]),
    failedRules: [...new Set(failedRules)],
    text: `${stdout}${stderr}`.trim(),
  };
}

/** The real tool: `docker run` of the Guard image. `workDir` is a folder on this machine the container may use (it is mounted, then emptied). */
export function dockerGuardTool(image: string, runner: Runner, workDir: string, docker = process.env.GEOMETER_DOCKER ?? "docker"): GuardTool {
  mkdirSync(workDir, { recursive: true });
  const run = async (dir: string, args: string[]) =>
    runner.run(docker, ["run", "--rm", "--network", "none", "--read-only", "--cap-drop", "ALL", "--user", `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`, "-v", `${dir}:/work`, image, ...args], { timeoutMs: 120_000 });
  return {
    async compile(specText) {
      const dir = mkdtempSync(join(workDir, "compile-"));
      try {
        writeFileSync(join(dir, "spec.json"), specText);
        const r = await run(dir, ["compile", "--spec", "/work/spec.json", "--out", "/work/bundle.json"]);
        if (r.code !== 0) return { ok: false, problems: refusalProblems("compile", r.stderr || r.stdout) };
        const summary = JSON.parse(r.stdout) as { digest?: string; tool?: string; tenant?: string; version?: number };
        if (typeof summary.digest !== "string" || typeof summary.tool !== "string" || typeof summary.tenant !== "string") return { ok: false, problems: [{ rule: "compile", message: "geo-guard compile did not say what it built (no digest, tool or tenant in its summary)." }] };
        return { ok: true, result: { digest: summary.digest, tool: summary.tool, tenant: summary.tenant, version: Number(summary.version ?? 0), text: readFileSync(join(dir, "bundle.json"), "utf8") } };
      } finally { rmSync(dir, { recursive: true, force: true }); }
    },
    async verify(bundleText, tomlText) {
      const dir = mkdtempSync(join(workDir, "verify-"));
      try {
        writeFileSync(join(dir, "bundle.json"), bundleText);
        writeFileSync(join(dir, "guard.toml"), tomlText);
        const r = await run(dir, ["verify-bundle", "/work/bundle.json", "--config", "/work/guard.toml"]);
        return parseVerify(r.code, r.stdout, r.stderr);
      } finally { rmSync(dir, { recursive: true, force: true }); }
    },
  };
}
