// The one place the bundle starts another program. Everything that needs Docker goes through a Runner, so the tests of the generator, the
// deployer and the backups run against a fake and never touch a machine, and the real one is a few lines.
import { spawn } from "node:child_process";

export interface RunResult { code: number; stdout: string; stderr: string }
export interface RunOptions { input?: string; timeoutMs?: number; cwd?: string; env?: Record<string, string> }
export interface Runner { run(command: string, args: string[], options?: RunOptions): Promise<RunResult> }

export const realRunner: Runner = {
  run(command, args, options = {}) {
    return new Promise((resolve) => {
      const child = spawn(command, args, { cwd: options.cwd, env: { ...process.env, ...options.env }, stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      const timer = options.timeoutMs ? setTimeout(() => child.kill("SIGKILL"), options.timeoutMs) : undefined;
      child.stdout.on("data", (c: Buffer) => { stdout += c.toString("utf8"); });
      child.stderr.on("data", (c: Buffer) => { stderr += c.toString("utf8"); });
      child.on("error", (e) => { if (timer) clearTimeout(timer); resolve({ code: 127, stdout, stderr: `${stderr}${e.message}` }); });
      child.on("close", (code) => { if (timer) clearTimeout(timer); resolve({ code: code ?? 1, stdout, stderr }); });
      child.stdin.on("error", () => undefined);
      child.stdin.end(options.input ?? "");
    });
  },
};

export type FakeHandler = (command: string, args: string[], options: RunOptions) => RunResult | Promise<RunResult>;

/** A Runner that answers from a function and remembers every call, for tests. */
export function fakeRunner(handler: FakeHandler): Runner & { calls: { command: string; args: string[]; options: RunOptions }[] } {
  const calls: { command: string; args: string[]; options: RunOptions }[] = [];
  return { calls, async run(command, args, options = {}) { calls.push({ command, args, options }); return handler(command, args, options); } };
}

// Builds a successful fake result, so test handlers read as one short line.
export const ok = (stdout = ""): RunResult => ({ code: 0, stdout, stderr: "" });
// Builds a failed fake result with a message on stderr.
export const failed = (stderr: string, code = 1): RunResult => ({ code, stdout: "", stderr });
