// The real `geo-guard` program, run on this computer: the bundle's own generated limits spec compiled by the program, the bundle's own guard.toml writer
// (generate/guards.ts guardToml) with the paths and ports of a temp folder in place of the container's. The crash test of an agent someone else wrote
// (agent/crash-test/) puts these in front of the stand-in services, and the end-to-end tests do the same. Nothing is written outside a temp folder.
//
// Where the program comes from (findGuardBinary), first match wins:
//   1. --guard-bin <path>      2. GEO_GUARD_BIN      3. `geo-guard` on the PATH
//   4. on a Linux server: out of the Guard image the server already has (`docker create`, `docker cp`). The image holds the static Linux program
//      at /usr/local/bin/geo-guard, and the server's image has to match its CPU already, so it runs there.
// On any other computer (a laptop) it needs 1, 2 or 3, and the message says so.
import { execFileSync, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { accessSync, chmodSync, constants, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { guardToml } from "../generate/guards.ts";
import type { GuardDef } from "../generate/guards.ts";
import type { Runner } from "../lib/runner.ts";
import { mintGuardToken, mintSecret, sha256Hex } from "../lib/util.ts";

const freePort = () => new Promise<number>((resolve, reject) => { const s = createServer(); s.once("error", reject); s.listen(0, "127.0.0.1", () => { const { port } = s.address() as { port: number }; s.close(() => resolve(port)); }); });

/** A free port on this computer, for the agent being tested. */
export const freeLocalPort = freePort;

/** A credential in the form Guard issues, and the hash guard.toml holds. */
export const credential = (): { token: string; hash: string } => { const token = mintGuardToken(); return { token, hash: sha256Hex(token) }; };

export type FoundGuard = { ok: true; path: string; how: string } | { ok: false; reason: string };

const isProgram = (path: string): boolean => { try { accessSync(path, constants.X_OK); return true; } catch { return false; } };

export interface FindGuardOptions {
  /** --guard-bin */
  flag?: string;
  env?: Record<string, string | undefined>;
  /** What starts a program (the docker commands go through it, so a test can answer them). */
  runner: Runner;
  docker?: string;
  /** The Guard image the server runs, for example `geo-guard:0.1.0`. */
  image: string;
  /** A folder the program may be kept in between runs. */
  cacheDir: string;
  platform?: string;
}

/** Find a `geo-guard` program to run, or say in plain words why there is none. */
export async function findGuardBinary(o: FindGuardOptions): Promise<FoundGuard> {
  const env = o.env ?? process.env;
  if (o.flag) return isProgram(o.flag) ? { ok: true, path: o.flag, how: "--guard-bin" } : { ok: false, reason: `--guard-bin ${o.flag} is not a program this computer can run.` };
  if (env.GEO_GUARD_BIN) return isProgram(env.GEO_GUARD_BIN) ? { ok: true, path: env.GEO_GUARD_BIN, how: "GEO_GUARD_BIN" } : { ok: false, reason: `GEO_GUARD_BIN is ${env.GEO_GUARD_BIN}, which is not a program this computer can run.` };
  for (const folder of (env.PATH ?? "").split(delimiter).filter(Boolean)) {
    const path = join(folder, "geo-guard");
    if (isProgram(path)) return { ok: true, path, how: "the PATH" };
  }
  if ((o.platform ?? process.platform) === "linux") {
    const docker = o.docker ?? "docker";
    const id = await o.runner.run(docker, ["image", "inspect", "--format", "{{.Id}}", o.image], { timeoutMs: 30_000 });
    if (id.code !== 0) return { ok: false, reason: `There is no geo-guard program to run, and the Guard image ${o.image} is not on this server (load it with \`docker load\`), so it could not be taken from there.` };
    const kept = join(o.cacheDir, `geo-guard-${id.stdout.trim().replace(/[^A-Za-z0-9]/gu, "").slice(-24)}`);
    if (isProgram(kept)) return { ok: true, path: kept, how: `the image ${o.image}` };
    mkdirSync(o.cacheDir, { recursive: true });
    const made = await o.runner.run(docker, ["create", o.image], { timeoutMs: 60_000 });
    const container = made.stdout.trim().split("\n").at(-1) ?? "";
    if (made.code !== 0 || !/^[0-9a-f]{12,64}$/u.test(container)) return { ok: false, reason: `Docker would not make a container from ${o.image} to take geo-guard out of it (${(made.stderr || made.stdout).trim().slice(0, 200)}). Give the program with --guard-bin or GEO_GUARD_BIN.` };
    try {
      const copied = await o.runner.run(docker, ["cp", `${container}:/usr/local/bin/geo-guard`, kept], { timeoutMs: 60_000 });
      if (copied.code !== 0 || !existsSync(kept)) return { ok: false, reason: `geo-guard could not be copied out of ${o.image} (${(copied.stderr || copied.stdout).trim().slice(0, 200)}). Give the program with --guard-bin or GEO_GUARD_BIN.` };
      chmodSync(kept, 0o755);
    } finally { await o.runner.run(docker, ["rm", container], { timeoutMs: 30_000 }); }
    return { ok: true, path: kept, how: `the image ${o.image}` };
  }
  return { ok: false, reason: "There is no geo-guard program on this computer to run the crash test with. Give one with --guard-bin <path> (or set GEO_GUARD_BIN), or put it on the PATH. On a Linux server that has the Guard image loaded, the crash test takes the program out of the image by itself." };
}

export interface RealGuard {
  agentUrl: string;
  adminUrl: string;
  adminToken: string;
  /** The owner's signing secret, when this Guard has an approver. */
  ownerSecret?: string;
  digest: string;
  stop(): Promise<void>;
}

export interface RealGuardOptions {
  /** The geo-guard program (findGuardBinary). */
  binary: string;
  def: GuardDef;
  spec: Record<string, any>;
  tenant: string;
  deployment: string;
  /** The stand-in this Guard sends to: plain HTTP on this computer. */
  upstreamPort: number;
  agents: { id: string; token: string; operations?: string[] }[];
  approver?: { id: string };
}

/** compile, then run, on a temp folder. Resolves when the Guard says it is ready. */
export async function startRealGuard(o: RealGuardOptions): Promise<RealGuard> {
  const dir = mkdtempSync(join(tmpdir(), "geo-bundle-guard-"));
  writeFileSync(join(dir, "spec.json"), JSON.stringify(o.spec));
  const summary = JSON.parse(execFileSync(o.binary, ["compile", "--spec", join(dir, "spec.json"), "--out", join(dir, "bundle.json")], { encoding: "utf8" })) as { digest: string };
  const admin = credential();
  const ownerSecret = o.approver ? mintSecret() : undefined;
  // the provider's key is a file the Guard reads; its name in the container is replaced by this folder's
  const headers = Object.fromEntries(Object.entries(o.def.headers).map(([k]) => [k, `\${file:${join(dir, "provider_authorization")}}`]));
  writeFileSync(join(dir, "provider_authorization"), "Bearer stand-in-provider-key", { mode: 0o600 });
  if (ownerSecret) writeFileSync(join(dir, "owner_notify_secret"), ownerSecret, { mode: 0o600 });
  const [listen, adminListen, healthListen] = [await freePort(), await freePort(), await freePort()];
  const toml = guardToml({
    def: { ...o.def, headers }, tenant: o.tenant, deployment: o.deployment, bundleDigest: summary.digest, upstream: { host: `127.0.0.1:${o.upstreamPort}`, tls: false },
    adminSha: admin.hash, agents: o.agents.map((a) => ({ id: a.id, sha: sha256Hex(a.token), ...(a.operations ? { operations: a.operations } : {}) })),
    ...(o.approver ? { approver: { id: o.approver.id, secretFile: join(dir, "owner_notify_secret") } } : {}),
    paths: { listen: `127.0.0.1:${listen}`, adminListen: `127.0.0.1:${adminListen}`, healthListen: `127.0.0.1:${healthListen}`, state: join(dir, "state.db"), bundle: join(dir, "bundle.json") },
  });
  writeFileSync(join(dir, "guard.toml"), toml);
  const child: ChildProcess = spawn(o.binary, ["run", "--config", join(dir, "guard.toml")], { stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout!.on("data", (c: Buffer) => { output += c; });
  child.stderr!.on("data", (c: Buffer) => { output += c; });
  const stop = async () => {
    if (child.exitCode === null) { child.kill("SIGTERM"); await new Promise<void>((resolve) => { const t = setTimeout(() => child.kill("SIGKILL"), 3000); child.once("exit", () => { clearTimeout(t); resolve(); }); }); }
    rmSync(dir, { recursive: true, force: true });
  };
  for (let i = 0; i < 200 && !/geo-guard ready/u.test(output); i++) {
    if (child.exitCode !== null) { await stop(); throw new Error(`geo-guard did not start: ${output.slice(0, 600)}`); }
    await new Promise((r) => setTimeout(r, 50));
  }
  if (!/geo-guard ready/u.test(output)) { await stop(); throw new Error(`geo-guard was not ready in 10 s: ${output.slice(0, 600)}`); }
  return { agentUrl: `http://127.0.0.1:${listen}`, adminUrl: `http://127.0.0.1:${adminListen}`, adminToken: admin.token, digest: summary.digest, ...(ownerSecret ? { ownerSecret } : {}), stop };
}
