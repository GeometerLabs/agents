// The real `geo-guard` run on this computer for a test: the example's spec compiled by the binary, the guard.toml companies/guard-config.ts writes (with the
// ports and folders of a temp folder in place of the container's), and a made-up API behind it. Nothing is written outside a temp folder.
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { newCredential, compileSpec } from "../guard-binary.ts";
import { guardToml } from "../guard-config.ts";
import { startFakeApi } from "../examples/refunds-api/fake-api.ts";
import type { FakeApi } from "../examples/refunds-api/fake-api.ts";
import { GUARD, exampleFile, tempDir } from "./helpers.ts";

const freePort = () => new Promise<number>((resolve, reject) => { const s = createServer(); s.once("error", reject); s.listen(0, "127.0.0.1", () => { const { port } = s.address() as { port: number }; s.close(() => resolve(port)); }); });

export const API_KEY = "sk_test_brightside_0123456789";

export interface Stack {
  api: FakeApi;
  dir: string;
  agentUrl: string;
  adminUrl: string;
  agentToken: string;
  adminToken: string;
  digest: string;
  /** One call from the agent, through Guard. */
  call(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; headers: Headers; json: any }>;
  /** One call to Guard's admin port. */
  admin(method: string, path: string, body?: unknown, token?: string): Promise<{ status: number; json: any }>;
  stop(): Promise<void>;
}

/** The made-up API, and a Guard for it built from the example's spec. Resolves when Guard says it is ready. */
export async function startStack(o: { spec?: string } = {}): Promise<Stack> {
  if (!GUARD) throw new Error("no geo-guard to run");
  const dir = tempDir();
  const api = await startFakeApi({ apiKey: API_KEY });
  const compiled = compileSpec(GUARD, o.spec ?? exampleFile("spec.json"), join(dir, "bundle.json"));
  if (!compiled.ok) throw new Error(`compile refused: ${compiled.problems.join("; ")}`);
  const spec = JSON.parse(readFileSync(o.spec ?? exampleFile("spec.json"), "utf8"));
  const agent = newCredential(GUARD), admin = newCredential(GUARD);
  mkdirSync(join(dir, "secrets"));
  writeFileSync(join(dir, "secrets", "api_authorization"), `Bearer ${API_KEY}`, { mode: 0o600 });
  const [listen, adminListen, healthListen] = [await freePort(), await freePort(), await freePort()];
  const approvalOperations = spec.rules.filter((r: any) => r.kind === "call_bound_approval").map((r: any) => r.operation);
  writeFileSync(join(dir, "guard.toml"), guardToml({
    tenant: spec.tenant, tool: spec.tool, deployment: spec.name, upstream: `127.0.0.1:${api.port}`, tls: false, bundleDigest: compiled.summary.digest,
    authHeader: { name: "Authorization", file: join(dir, "secrets", "api_authorization") },
    agents: [{ id: "support-bot", sha256: agent.sha256 }], adminSha256: admin.sha256, approvalOperations,
    paths: { listen: `127.0.0.1:${listen}`, adminListen: `127.0.0.1:${adminListen}`, healthListen: `127.0.0.1:${healthListen}`, state: join(dir, "state.db"), bundle: join(dir, "bundle.json") },
  }));
  const child: ChildProcess = spawn(GUARD, ["run", "--config", join(dir, "guard.toml")], { stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout!.on("data", (c: Buffer) => { output += c; });
  child.stderr!.on("data", (c: Buffer) => { output += c; });
  const stop = async () => {
    if (child.exitCode === null) { child.kill("SIGTERM"); await new Promise<void>((resolve) => { const t = setTimeout(() => child.kill("SIGKILL"), 3000); child.once("exit", () => { clearTimeout(t); resolve(); }); }); }
    await api.close();
    rmSync(dir, { recursive: true, force: true });
  };
  for (let i = 0; i < 200 && !/geo-guard ready/u.test(output); i++) {
    if (child.exitCode !== null) { await stop(); throw new Error(`geo-guard did not start: ${output.slice(0, 600)}`); }
    await new Promise((r) => setTimeout(r, 50));
  }
  if (!/geo-guard ready/u.test(output)) { await stop(); throw new Error(`geo-guard was not ready in 10 s: ${output.slice(0, 600)}`); }

  const agentUrl = `http://127.0.0.1:${listen}`, adminUrl = `http://127.0.0.1:${adminListen}`;
  const send = async (base: string, token: string, method: string, path: string, body: unknown, headers: Record<string, string> = {}) => {
    const r = await fetch(`${base}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const text = await r.text();
    let json: any; try { json = text ? JSON.parse(text) : undefined; } catch { json = text; }
    return { status: r.status, headers: r.headers, json };
  };
  return {
    api, dir, agentUrl, adminUrl, agentToken: agent.token, adminToken: admin.token, digest: compiled.summary.digest,
    call: (method, path, body, headers) => send(agentUrl, agent.token, method, path, body, headers),
    admin: async (method, path, body, token) => { const r = await send(adminUrl, token ?? admin.token, method, path, body); return { status: r.status, json: r.json }; },
    stop,
  };
}
