// The two things every runtime contract harness does with a shop's process, written once: start it as a SEPARATE PROCESS and wait until /healthz answers (keeping what it
// printed for a failure message), and call it over HTTP with the right credential. The listings harness and the Bookings harness both use these; the process goes through
// children.ts so none outlives a run.
import type { ChildProcess } from "node:child_process";
import { spawnChild, stopChild } from "./children.ts";

export interface RuntimeProcess {
  child: ChildProcess;
  /** Everything the process printed (stdout and stderr). */
  output(): string;
  stop(): Promise<void>;
}

/** Start `cmd args` and wait up to 10 s for `<url>/healthz` to answer 200. A process that exits early, or never answers, is stopped and the error carries what it printed. */
export async function startRuntimeProcess(cmd: string, args: string[], env: Record<string, string | undefined>, url: string, what: string): Promise<RuntimeProcess> {
  let output = "";
  const c = spawnChild(cmd, args, { env, stdio: ["ignore", "pipe", "pipe"] }, what);
  c.stdout!.on("data", (d: Buffer) => { output += d.toString(); });
  c.stderr!.on("data", (d: Buffer) => { output += d.toString(); });
  let exitedEarly: ((e: Error) => void) | undefined;
  const onExit = (code: number | null): void => { exitedEarly?.(new Error(`the shop exited early (${code}):\n${output}`)); };
  const early = new Promise<never>((_, reject) => { exitedEarly = reject; c.once("exit", onExit); });
  const ready = (async () => {
    for (let i = 0; i < 200; i++) {
      if (c.exitCode !== null || c.signalCode !== null) throw new Error(`the shop exited early (${c.exitCode ?? c.signalCode}):\n${output}`);
      try { if ((await fetch(`${url}/healthz`)).status === 200) return; } catch { /* not listening yet */ }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`the shop did not answer /healthz in 10 s:\n${output}`);
  })();
  try { await Promise.race([ready, early]); } catch (e) {
    await stopChild(c); // a shop that never answered is not left running
    throw e;
  } finally { c.removeListener("exit", onExit); }
  return { child: c, output: () => output, stop: () => stopChild(c) };
}

export interface CallOptions {
  method?: string;
  /** The bearer token; null sends none. */
  token: string | null;
  owner?: string;
  session?: string;
  body?: unknown;
  raw?: Uint8Array;
  type?: string;
  headers?: Record<string, string>;
}
export interface Answer { status: number; body: any; headers: Headers; bytes: Uint8Array }

/** One HTTP call to a shop: JSON body (or raw bytes), the owner's link and session in their headers, the answer's body parsed as JSON when it is JSON. */
export async function callRuntime(url: string, path: string, c: CallOptions): Promise<Answer> {
  const headers: Record<string, string> = { ...(c.token ? { authorization: `Bearer ${c.token}` } : {}), ...(c.owner ? { "x-owner-link": c.owner } : {}), ...(c.session ? { "x-owner-session": c.session } : {}), ...(c.headers ?? {}) };
  if (c.body !== undefined) headers["content-type"] = "application/json";
  if (c.raw !== undefined) headers["content-type"] = c.type ?? "application/octet-stream";
  const r = await fetch(`${url}${path}`, { method: c.method ?? (c.body !== undefined || c.raw !== undefined ? "POST" : "GET"), headers, ...(c.body !== undefined ? { body: JSON.stringify(c.body) } : c.raw !== undefined ? { body: c.raw as BodyInit } : {}) });
  const bytes = new Uint8Array(await r.arrayBuffer());
  let body: any = null;
  try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { /* not JSON: bytes are there */ }
  return { status: r.status, body, headers: r.headers, bytes };
}
