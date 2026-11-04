// The real `geo-guard` binary, run on this computer for a test: the bundle's own generated limits spec, compiled by the binary, and the bundle's own guard.toml writer
// (generate/guards.ts guardToml) with the paths and ports of a temp folder in place of the container's. Nothing is written outside a temp folder.
//
// It needs the built binary (monorepo target/debug/geo-guard, macOS). Without it `haveBinary` is false and a test that uses this says it was skipped and why. Set GEO_GUARD_BIN to use another.
import { execFileSync, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { guardToml } from "../generate/guards.ts";
import type { GuardDef } from "../generate/guards.ts";
import { mintGuardToken, mintSecret, sha256Hex } from "../lib/util.ts";

export const BINARY = process.env.GEO_GUARD_BIN ?? "/Users/navaltharun/Work/geometer/monorepo/target/debug/geo-guard";
export const haveBinary = existsSync(BINARY);
export const skipWithoutBinary: string | false = haveBinary ? false : `needs the built geo-guard binary, which is not at ${BINARY} (build it in the monorepo, or set GEO_GUARD_BIN); these tests run the real Guard`;

const freePort = () => new Promise<number>((resolve, reject) => { const s = createServer(); s.once("error", reject); s.listen(0, "127.0.0.1", () => { const { port } = s.address() as { port: number }; s.close(() => resolve(port)); }); });

/** A credential in the form Guard issues, and the hash guard.toml holds. */
export const credential = (): { token: string; hash: string } => { const token = mintGuardToken(); return { token, hash: sha256Hex(token) }; };

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
  const summary = JSON.parse(execFileSync(BINARY, ["compile", "--spec", join(dir, "spec.json"), "--out", join(dir, "bundle.json")], { encoding: "utf8" })) as { digest: string };
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
  const child: ChildProcess = spawn(BINARY, ["run", "--config", join(dir, "guard.toml")], { stdio: ["ignore", "pipe", "pipe"] });
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
