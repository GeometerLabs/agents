// Where the shop's Go programs are, and which one a hand check runs, with nothing but Node's own modules imported: the panel and the deployer read this (golive.ts,
// bundle/lib/go-build.ts) without loading the hand check's runner, its stand-ins or its process tracker (modules/crash-test/go-shop.ts), which only the hand check's own
// child process loads (bundle/lib/hand-check-go.ts).
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Where the Go programs are: GEOMETER_GO_PROGRAMS (a folder: the server's copy of the programs the deployer built, bundle/lib/go-build.ts), else this checkout's go/bin
 * (`cd go && go build -o bin/ ./cmd/...`). The hand check never falls back to anything else: a program that is not there is a hand check that could not run, and says so.
 */
export function goProgramsDir(env: Record<string, string | undefined> = process.env): string {
  return env.GEOMETER_GO_PROGRAMS || join(dirname(fileURLToPath(import.meta.url)), "..", "..", "go", "bin");
}

/** What the hand check ran on: the program's name, the template version it serves (its /status `version`) and the SHA-256 of its file, so a certificate names the exact program. */
export interface ProgramRan { name: string; version: string; sha256: string }

/** The program `name` (bookings, orders, fees, stock-orders): its path and file digest, or why it cannot be run. */
export function goProgram(name: string): { ok: true; path: string; sha256: string } | { ok: false; reason: string } {
  const path = join(goProgramsDir(), name);
  const sha256 = programDigest(path);
  if (sha256 === undefined) return { ok: false, reason: `the shop's Go program (${name}) is not on this machine, so no situation could be run on it (build it with "cd go && go build -o bin/ ./cmd/${name}", or set GEOMETER_GO_PROGRAMS to the folder of the server's programs)` };
  return { ok: true, path, sha256 };
}

// a program file is some 28 MB: its digest is kept for as long as its size and modified time stay the same (the panel asks at every page that shows the gate)
const digests = new Map<string, { key: string; sha256: string }>();
/** The SHA-256 of a program file as it is now, or undefined when it is not there. */
export function programDigest(path: string): string | undefined {
  try {
    if (!existsSync(path)) return undefined;
    const st = statSync(path);
    const key = `${st.size}:${st.mtimeMs}`;
    const kept = digests.get(path);
    if (kept?.key === key) return kept.sha256;
    const sha256 = createHash("sha256").update(readFileSync(path)).digest("hex");
    digests.set(path, { key, sha256 });
    return sha256;
  } catch { return undefined; }
}

/** Why a test that runs situations on the program `name` is skipped (it is not built here), or undefined: it runs. A test is skipped only when what it needs is not there. */
export function goSkip(name: string): string | undefined {
  return existsSync(join(goProgramsDir(), name)) ? undefined : `the Go program ${name} is not built (cd go && go build -o bin/ ./cmd/${name}), and every situation runs on it`;
}


/** The version each program said it serves, once a hand-check shop of it started (go-shop.ts; runOnProgram names it in the run's `program`). */
export const servedVersions = new Map<string, string>();
