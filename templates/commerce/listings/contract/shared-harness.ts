// The harness of the SHARED-process contract (shared.contract.test.ts) and of the shared-process memory measurement (measure-shared.ts): it writes shop folders as the deployer does
// (`<clients>/<shop>/client/...`, `<secrets>/<shop>/{internal_token,channel_token,record_key}`), starts the shared process as a SEPARATE process, and talks to it over HTTP only.
//
//   ts  node templates/commerce/listings/server/shared-main.ts   (SHARED_WORKERS threads, as the container runs it)
//   go  the binary named by LISTINGS_SHARED_GO_BIN (default <repo>/go/bin/listings-shared)
// Both read the same folders and the same environment (SHOPS_DIR, SECRETS_DIR, HOST, PORT, SCAN_SECONDS). The process is started and stopped through children.ts (its own process
// group, so the Go host's child for a quarantined shop goes with it; stopped at the end of each test; a leak fails the run).
import type { ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OWNER_LINK_FILE, newOwnerToken, ownerLinkFile } from "../../../../modules/channels/owner-link.ts";
import { PAGE, REPO, VERSION } from "./harness.ts";
import { spawnChild, stopChild } from "./children.ts";

export type Impl = "ts" | "go";
export const GO_SHARED_BIN = process.env.LISTINGS_SHARED_GO_BIN ?? join(REPO, "go", "bin", "listings-shared");
const hex = (n: number): string => randomBytes(n).toString("hex");

export interface ShopFolder { name: string; owner: string; channel: string; internal: string }
export interface Root { dir: string; clients: string; secrets: string }

export function makeRoot(): Root {
  const dir = mkdtempSync(join(tmpdir(), "listings-shared-contract-"));
  return { dir, clients: join(dir, "clients"), secrets: join(dir, "secrets") };
}

/** A shop's folder as the deployer writes it: client files (the lock last), secrets, and the owner's link (a hash file in the client folder). */
export function writeShop(root: Root, name: string): ShopFolder {
  const client = join(root.clients, name, "client");
  mkdirSync(client, { recursive: true });
  mkdirSync(join(root.secrets, name), { recursive: true });
  const s: ShopFolder = { name, owner: newOwnerToken(), channel: hex(24), internal: hex(24) };
  writeFileSync(join(root.secrets, name, "internal_token"), s.internal);
  writeFileSync(join(root.secrets, name, "channel_token"), s.channel);
  writeFileSync(join(root.secrets, name, "record_key"), hex(32));
  writeFileSync(join(client, "settings.json"), JSON.stringify({ name: name.toUpperCase(), place: { town: "Thrissur" }, trade: "pets", timezone: "Asia/Kolkata", languages: ["en"], owner: { language: "en" }, assistant: {} }));
  writeFileSync(join(client, "runtime.json"), JSON.stringify({ mode: "fakes", tickSeconds: 3600, dataDir: join(root.dir, "data", name, "data"), services: {} }));
  writeFileSync(join(client, OWNER_LINK_FILE), JSON.stringify(ownerLinkFile(s.owner, new Date())));
  writeFileSync(join(client, "pages.json"), JSON.stringify({ schema: 1, base: PAGE, ownerBase: "https://pages.example/owner", slug: name, url: PAGE }));
  writeFileSync(join(client, "pathway.lock"), `listings@${VERSION}\n`);
  return s;
}

export const dataFile = (root: Root, name: string): string => join(root.dir, "data", name, "data", "agent.db");

async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const port = (s.address() as { port: number }).port;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

export interface Host {
  url: string;
  /** Milliseconds from spawning the process until /readyz first answered 200, and until every wanted shop was held. */
  readyMs: number;
  heldMs: number;
  pid: number;
  log(): string;
  /** GET/POST a path of the shared process itself (not a shop's). */
  get(path: string): Promise<{ status: number; body: any }>;
  /** Call a shop through the router. The credential is the caller's: a token (the channel token is the default on /internal/channel/*), the owner's link. */
  call(shop: string, path: string, o?: { token?: string | null; internal?: boolean; owner?: string; body?: unknown; headers?: Record<string, string> }): Promise<{ status: number; body: any; headers: Headers }>;
  stop(): Promise<void>;
}

export const haveGo = (): boolean => existsSync(GO_SHARED_BIN);

/** Start the shared process on the folders in `root` and wait until /readyz answers. */
export async function startHost(impl: Impl, root: Root, o: { scanSeconds?: number; workers?: number; shops?: Record<string, ShopFolder>; expect?: number } = {}): Promise<Host> {
  const port = await freePort();
  const env = { ...process.env, SHOPS_DIR: root.clients, SECRETS_DIR: root.secrets, HOST: "127.0.0.1", PORT: String(port), SCAN_SECONDS: String(o.scanSeconds ?? 1), SHARED_WORKERS: String(o.workers ?? 2), STATE_DIR: join(root.dir, "state") };
  const [cmd, args] = impl === "go" ? [GO_SHARED_BIN, []] : [process.execPath, [join(REPO, "templates", "commerce", "listings", "server", "shared-main.ts")]];
  const t0 = performance.now();
  let readyMs = 0;
  const child: ChildProcess = spawnChild(cmd, args, { env, stdio: ["ignore", "pipe", "pipe"] }, `the ${impl} shared process in ${root.dir}`);
  let output = "";
  child.stdout!.on("data", (d: Buffer) => { output += d.toString(); });
  child.stderr!.on("data", (d: Buffer) => { output += d.toString(); });
  const exited = new Promise<never>((_, reject) => child.once("exit", (code) => reject(new Error(`the shared process exited early (${code}):\n${output}`))));
  const url = `http://127.0.0.1:${port}`;
  const ready = (async () => {
    for (let i = 0; i < 400; i++) {
      try { if ((await fetch(`${url}/readyz`)).status === 200) { readyMs = performance.now() - t0; return; } } catch { /* not listening yet */ }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`the shared process did not answer /readyz in 20 s:\n${output}`);
  })();
  // /readyz answers as soon as the front listens (the PROCESS is up); the first look at the folders may still be going, so wait until the shops that are wanted are held
  const held = (async () => {
    await ready;
    for (let i = 0; i < 600; i++) {
      try { const r = await fetch(`${url}/healthz`); if (((await r.json()) as { shops: number }).shops >= (o.expect ?? 0)) return; } catch { /* retry */ }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`the shared process did not hold ${o.expect} shop(s) in 30 s:\n${output}`);
  })();
  // a host that never got ready is not left running (it had no handle the caller could stop)
  try { await Promise.race([held, exited]); } catch (e) { await stopChild(child, 5000); throw e; }
  const heldMs = performance.now() - t0;
  child.removeAllListeners("exit");
  const host: Host = {
    url, pid: child.pid!, readyMs, heldMs, log: () => output,
    async get(path) { const r = await fetch(`${url}${path}`); return { status: r.status, body: await r.json().catch(() => null) }; },
    async call(shop, path, c = {}) {
      const folder = o.shops?.[shop];
      const token = c.token === undefined ? (folder ? (c.internal || !path.startsWith("/internal/channel/") ? folder.internal : folder.channel) : null) : c.token;
      const headers: Record<string, string> = { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(c.owner ? { "x-owner-link": c.owner } : {}), ...(c.headers ?? {}) };
      if (c.body !== undefined) headers["content-type"] = "application/json";
      const r = await fetch(`${url}/shop/${shop}${path}`, { method: c.body !== undefined ? "POST" : "GET", headers, ...(c.body !== undefined ? { body: JSON.stringify(c.body) } : {}) });
      return { status: r.status, body: await r.json().catch(() => null), headers: r.headers };
    },
    async stop() { await stopChild(child, 5000); },
  };
  return host;
}
