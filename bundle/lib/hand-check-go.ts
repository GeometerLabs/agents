// The go-live hand check as the panel runs it (owner, 24 Nov 2026: "Run the hand check on Go"): the template's crash-test situations, each on the shop's own Go program started on
// the shop's own settings.json (modules/crash-test/go-shop.ts), in a CHILD process with a time limit. Why a child and not the panel's own process:
//   * a run starts the shop's program once per situation, with the stand-ins beside it, and the process tracker (modules/test/contract/children.ts) watches the process it is in:
//     its exit and signal hooks belong in a process of their own, not in the panel's;
//   * the panel's memory is small (NODE_OLD_SPACE_MB.panel); a run's stand-ins and records live and die in the child;
//   * a time limit ends the whole run, programs and all (SIGTERM, which the tracker turns into a stop of every program it started, then SIGKILL).
// The run finishes within the panel's request (about a minute for a shop; the limit is 10): the on-demand panel finishes a request in flight before it sleeps, so a run is never
// cut by the panel going to sleep, and the go-live page shows the result on the redirect as before.
//
// The child prints ONE line of JSON: `{"ok": true, "summary": {...}}` (the template's own summary: counts, the digest of the settings it ran on, what could not run, the program
// it ran on) or `{"ok": false, "reason": "..."}`. Anything else, or no answer in time, is a hand check that did not run, said so in plain words; it is never a pass.
//
//   node bundle/lib/hand-check-go.ts --kind bookings --settings <a shop's settings.json>
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { HandCheckSummaryLike } from "./kinds.ts";

export type HandCheckOutcome = { ok: true; summary: HandCheckSummaryLike } | { ok: false; reason: string };

/** How long a whole run may take before it is stopped. */
export const HAND_CHECK_LIMIT_MS = 10 * 60_000;

const HERE = fileURLToPath(import.meta.url);

/**
 * Run the hand check of template `kind` on the settings file `settingsFile`, in a child process. `env` adds to the child's environment (GEOMETER_GO_PROGRAMS: where the server's
 * programs are). Never throws.
 */
export function runGoHandCheck(kind: string, settingsFile: string, o: { env?: Record<string, string>; limitMs?: number } = {}): Promise<HandCheckOutcome> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--no-warnings", HERE, "--kind", kind, "--settings", settingsFile], { env: { ...process.env, ...(o.env ?? {}) }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => { out += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { err += d.toString(); });
    let timedOut = false;
    const limit = o.limitMs ?? HAND_CHECK_LIMIT_MS;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM"); // the child's tracker stops every program it started, then the child ends
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
    }, limit);
    child.on("error", (e) => { clearTimeout(timer); resolve({ ok: false, reason: `The hand check could not be started (${e.message}).` }); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) { resolve({ ok: false, reason: `The hand check did not finish in ${Math.round(limit / 60_000)} minutes, so it was stopped.` }); return; }
      const last = out.trim().split("\n").at(-1) ?? "";
      try {
        const got = JSON.parse(last) as HandCheckOutcome;
        if (got.ok === true && isSummary(got.summary)) { resolve({ ok: true, summary: got.summary }); return; }
        if (got.ok === false && typeof got.reason === "string") { resolve({ ok: false, reason: got.reason }); return; }
      } catch { /* not an answer: said below */ }
      const said = (err.trim().split("\n").find((l) => l.trim() !== "") ?? "").slice(0, 300);
      resolve({ ok: false, reason: `The hand check ended without an answer (exit code ${code})${said ? `: ${said}` : ""}.` });
    });
  });
}

const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
/** The child's summary, checked by hand (it is another process's output). */
function isSummary(v: unknown): v is HandCheckSummaryLike {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Record<string, unknown>;
  return isCount(s.held) && isCount(s.total) && isCount(s.checks) && s.held <= s.total && Array.isArray(s.failedTitles) && s.failedTitles.every((t) => typeof t === "string")
    && (s.notRun === undefined || (Array.isArray(s.notRun) && s.notRun.every((t) => typeof t === "string")))
    && (s.ranOn === undefined || typeof s.ranOn === "string");
}

// ---- the child --------------------------------------------------------------------------------------------------------------------------------------------------

async function child(): Promise<HandCheckOutcome> {
  const args = parseArgs({ args: process.argv.slice(2), options: { kind: { type: "string" }, settings: { type: "string" } } }).values;
  const { KINDS } = await import("./kinds.ts");
  const kind = args.kind ? KINDS[args.kind] : undefined;
  if (!kind?.papers || !args.settings) return { ok: false, reason: "The hand check was asked for a template that has none, or without settings." };
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(args.settings, "utf8")); } catch (e) { return { ok: false, reason: `The shop's settings could not be read (${(e as Error).message}).` }; }
  const checked = kind.validateSettings(raw);
  if (!checked.ok) return { ok: false, reason: `The shop's settings need fixing first: ${checked.errors.join(" ")}` };
  const run = await kind.papers.runOn(checked.settings);
  return { ok: true, summary: kind.papers.summariseRun(run) };
}

if (process.argv[1] === HERE) {
  const answer = await child().catch((e: Error): HandCheckOutcome => ({ ok: false, reason: `The hand check stopped with an error: ${e.message.split("\n")[0]}` }));
  // the line is written whole before the process ends (a pipe's write is not done when write returns); every program the run started was stopped by its situation
  process.stdout.write(`${JSON.stringify(answer)}\n`, () => process.exit(0));
}
