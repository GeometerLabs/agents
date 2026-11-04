// Running a template's own hand check (pathways/<name>/scripts/hand-check.ts) at one version on one client's own settings, reading its answer, and
// comparing two answers. The hand check is run as the program it is, started through the Runner, so each version brings its own situations and the
// tests can answer for it. The answer is read from the same lines a person reads ("Held N of M", then one line per situation, and under a failed
// one the checks that failed), so any version that prints them can be asked, and a version that prints something else is held back, not guessed at.
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Context } from "./deploy.ts";

export interface Situation { title: string; held: boolean; /** for one that did not hold: the first check that failed, in the hand check's words */ why: string }
export interface HandCheckRead { held: number; total: number; situations: Situation[] }

/** Read the hand check's printed answer. Undefined when it does not look like one, or when its count and its lines do not agree. */
export function readHandCheck(stdout: string): HandCheckRead | undefined {
  const header = /^ {2}Held (\d+) of (\d+)\./mu.exec(stdout);
  if (!header) return undefined;
  const lines = stdout.split("\n");
  const situations: Situation[] = [];
  for (let i = 0; i < lines.length; i++) {
    // "  ✓ # 4  Title", "  ✗ #12  Title" or "  ✓      Title" (a situation with no number in the plan)
    const m = /^ {2}([✓✗]) (?:#[ \d]\d| {3}) {2}(\S.*)$/u.exec(lines[i]);
    if (!m) continue;
    let why = "";
    if (m[1] === "✗") {
      for (let j = i + 1; j < lines.length && /^ {8}\S/u.test(lines[j]); j++) {
        const check = /^ {8}✗ (.+)$/u.exec(lines[j]);
        if (!check) continue;
        const detail = /^ {12}(\S.*)$/u.exec(lines[j + 1] ?? "");
        why = detail ? `${check[1]}: ${detail[1]}` : check[1];
        break;
      }
    }
    situations.push({ title: m[2].trim(), held: m[1] === "✓", why });
  }
  const held = situations.filter((s) => s.held).length;
  if (situations.length !== Number(header[2]) || held !== Number(header[1])) return undefined;
  return { held, total: situations.length, situations };
}

const firstWords = (text: string): string => (text.split("\n").map((l) => l.trim()).find((l) => l !== "") ?? "").slice(0, 200);

/** Run the hand check that sits in one version's folder on one settings file. A hand check that finds a situation failing exits 1; that is an answer, not a failure to ask. */
export async function runHandCheck(ctx: Context, pathwayDir: string, settingsFile: string): Promise<{ ok: true; read: HandCheckRead } | { ok: false; reason: string }> {
  const r = await ctx.runner.run(process.execPath, [join(pathwayDir, "scripts", "hand-check.ts"), "--settings", settingsFile], { timeoutMs: 180_000 });
  const read = readHandCheck(r.stdout);
  if (read) return { ok: true, read };
  return { ok: false, reason: firstWords(r.stderr) || firstWords(r.stdout) || `it ended with exit code ${r.code} and printed nothing` };
}

export interface Difference {
  /** Fails at the new version and did not fail at the old one: held there, or was not run there. */
  failing: { title: string; why: string }[];
  /** Held at the old version and is not run at the new one. */
  notChecked: string[];
}

/** What the new version does worse than the old one on the same settings. A situation that failed in both is not counted: the client is no worse off. */
export function compare(before: HandCheckRead, after: HandCheckRead): Difference {
  const was = new Map(before.situations.map((s) => [s.title, s]));
  const now = new Set(after.situations.map((s) => s.title));
  return {
    failing: after.situations.filter((s) => !s.held && was.get(s.title)?.held !== false).map((s) => ({ title: s.title, why: s.why })),
    notChecked: before.situations.filter((s) => s.held && !now.has(s.title)).map((s) => s.title),
  };
}

/**
 * How the runtime of one version lays out its saved data (SCHEMA_VERSION in server/store.ts), or undefined when it cannot be asked. A runtime refuses to start on data
 * written in a higher layout than it knows, so going back to a version with a lower number than the one that ran is refused (update.ts says so in plain words).
 */
export async function savedDataLayout(ctx: Context, pathwayDir: string): Promise<number | undefined> {
  const store = pathToFileURL(join(pathwayDir, "server", "store.ts")).href;
  const r = await ctx.runner.run(process.execPath, ["--no-warnings", "--input-type=module", "-e", "import(process.argv[1]).then((m) => console.log(m.SCHEMA_VERSION), () => console.log('?'))", store], { timeoutMs: 60_000 });
  const n = Number(r.stdout.trim().split("\n").at(-1));
  return r.code === 0 && Number.isInteger(n) && n > 0 ? n : undefined;
}
