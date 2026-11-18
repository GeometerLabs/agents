// Every runtime process the contract starts (harness.ts one shop, shared-harness.ts the shared process), kept in ONE list so none outlives the run: a TypeScript shop started
// by a contract run was found still running 1 h 44 min later. Before this, a second start() overwrote the only handle to the first process, a start that timed out left its
// process running with no handle at all, and a stop() raced the test process's own exit (its SIGKILL timer was unref'd, so the process could exit first).
//
// What this file guarantees:
//   * each child is started in a process group of its own (detached), so stopping it stops what it started too (the Go shared host's child for a quarantined shop);
//   * at the end of every test (a root afterEach, when this runs under the test runner) every child still running is stopped: SIGTERM to its group, SIGKILL after a grace,
//     waited for; a test that keeps a shop between tests does not exist in this folder, and one that tried would find it stopped;
//   * a child does not keep the test process alive: the process and its output pipes are unref'd, so a file whose own hooks forgot a shop still comes to its end (before this,
//     the shop's open pipes held the test process until the runner was killed, and the shop outlived it);
//   * on the test process's exit, and on SIGINT, SIGTERM and SIGHUP, every group still alive is killed, and on exit the run FAILS (exit code 1) naming each one: a child that is
//     still alive at the end is a leak, even when this file cleans it up.
// Not covered: a SIGKILL of the test process itself (nothing in a process outlives its own SIGKILL to clean up); the children then die only when their own work ends.
import { spawn } from "node:child_process";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { afterEach } from "node:test";

interface Child { proc: ChildProcess; what: string }
const live = new Set<Child>();

/** Is any process of this child's group still running? (signal 0 checks without sending anything; ESRCH: the group is gone) */
function groupAlive(pid: number | undefined): boolean {
  if (pid === undefined) return false;
  try { process.kill(-pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === "EPERM"; }
}

function signalGroup(c: Child, sig: NodeJS.Signals): void {
  const pid = c.proc.pid;
  if (pid === undefined) return;
  try { process.kill(-pid, sig); } catch { /* the group is gone */ }
}

const exited = (p: ChildProcess): boolean => p.exitCode !== null || p.signalCode !== null;

/** Start a runtime process: in its own process group, registered until it and everything it started are gone. `what` names it in a leak report. */
export function spawnChild(cmd: string, args: string[], options: SpawnOptions, what: string): ChildProcess {
  const proc = spawn(cmd, args, { ...options, detached: true });
  const c: Child = { proc, what: `${what} (pid ${proc.pid})` };
  live.add(c);
  // the wait for a test's own work (its fetches and timers) keeps the process alive; the child alone must not, or a forgotten one would hold the run open forever
  proc.unref();
  for (const pipe of [proc.stdin, proc.stdout, proc.stderr]) (pipe as unknown as { unref?: () => void } | null)?.unref?.();
  return proc;
}

/** Stop one child: SIGTERM to its group, then SIGKILL after `graceMs`, and wait until the process has exited and its group is empty. Safe to call twice. */
export async function stopChild(proc: ChildProcess | undefined, graceMs = 4000): Promise<void> {
  if (!proc) return;
  const c = [...live].find((x) => x.proc === proc);
  const entry = c ?? { proc, what: `pid ${proc.pid}` };
  if (!exited(proc)) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => signalGroup(entry, "SIGKILL"), graceMs); // NOT unref'd: the test process waits for it, so it cannot exit before the kill
      proc.once("exit", () => { clearTimeout(timer); resolve(); });
      if (exited(proc)) { clearTimeout(timer); resolve(); return; }
      signalGroup(entry, "SIGTERM");
    });
  }
  // what the child started (its group) goes too: a moment for it to follow its parent, then SIGKILL
  for (let i = 0; i < 40 && groupAlive(proc.pid); i++) await new Promise((r) => setTimeout(r, 50));
  if (groupAlive(proc.pid)) signalGroup(entry, "SIGKILL");
  for (let i = 0; i < 40 && groupAlive(proc.pid); i++) await new Promise((r) => setTimeout(r, 50));
  if (c && !groupAlive(proc.pid)) live.delete(c);
}

/** Stop every child still registered (the end of a test). Throws, failing the test, when one cannot be stopped. */
export async function stopAll(): Promise<void> {
  for (const c of [...live]) await stopChild(c.proc);
  const left = [...live].filter((c) => groupAlive(c.proc.pid));
  for (const c of left) live.delete(c);
  if (left.length > 0) throw new Error(`runtime processes would not stop: ${left.map((c) => c.what).join(", ")}`);
}

/** Kill every group still alive, at once (the process is leaving): the ones that were alive are returned for the report. */
function killAll(): Child[] {
  const alive = [...live].filter((c) => groupAlive(c.proc.pid));
  for (const c of alive) signalGroup(c, "SIGKILL");
  live.clear();
  return alive;
}

process.on("exit", (code) => {
  const left = killAll();
  if (left.length === 0) return;
  process.stderr.write(`\nA runtime process the contract started was still running when the run ended (now killed): ${left.map((c) => c.what).join(", ")}\n`);
  if (code === 0) process.exitCode = 1;
});
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  // the default for these signals is to end the process at once, without its "exit" event: kill the children, then end the way the signal would have
  process.once(sig, () => { killAll(); process.kill(process.pid, sig); });
}

// Under the test runner (each file runs in a process of its own with NODE_TEST_CONTEXT set, or a *.test.ts file run directly), every test ends with its children stopped. Not in
// a script such as measure.ts, where a test hook would start the runner and print its summary into the script's output.
if (process.env.NODE_TEST_CONTEXT !== undefined || /\.test\.[cm]?[jt]s$/u.test(process.argv[1] ?? "")) afterEach(stopAll);
