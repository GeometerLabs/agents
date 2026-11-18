// The harness of the listings-only runtime CONTRACT (see README.md in this folder). It makes a shop's folder in a temp directory exactly as the deployer does (client folder with
// settings.json, runtime.json, pathway.lock, owner-link.json, pages.json, owner-grants.json; secrets internal_token, channel_token, record_key), starts the shop as a SEPARATE
// PROCESS on a free port, and gives the tests an HTTP caller. Nothing of the runtime is imported except the pure signing and owner-link helpers used to MAKE files and CHECK
// signatures: the runtime itself is only ever reached over HTTP.
//
// Which implementation runs is chosen by the environment:
//   LISTINGS_IMPL=ts   (default)  node templates/commerce/listings/server/main.ts --client <folder>
//   LISTINGS_IMPL=go              the built binary named by LISTINGS_GO_BIN (default <repo>/go/bin/listings) with the same arguments
// Both read the same folder, the same token files (INTERNAL_TOKEN_FILE, CHANNEL_TOKEN_FILE, RECORD_KEY_FILE) and the same runtime.json, so one folder serves both.
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { OWNER_LINK_FILE, newOwnerToken, ownerLinkFile } from "../../../../modules/channels/owner-link.ts";
import { OWNER_GRANTS_FILE, SETUP_MS, newSetupToken, setupHash } from "../../../../modules/channels/owner-grants.ts";

const here = dirname(fileURLToPath(import.meta.url));
/** The repository root, found from this file's own address. */
export const REPO = join(here, "..", "..", "..", "..");
export const IMPL = (process.env.LISTINGS_IMPL ?? "ts") as "ts" | "go";
export const PAGE = "https://pages.example/glow-pets";
export const OWNER_BASE = "https://pages.example/owner";
/** The pathway version the TS runtime pins a folder to (package.json), so a folder written here starts on both implementations. */
export const VERSION = (JSON.parse(readFileSync(join(REPO, "templates", "commerce", "listings", "package.json"), "utf8")) as { version: string }).version;

const hex = (n: number): string => randomBytes(n).toString("hex");

export interface ShopOptions {
  /** The shop's model budget (runtime.json `budget`). */
  budget?: { monthlyMicroInr: number; daily: Record<string, number> };
  /** The fake model server's port; with it, runtime.json names it as the parser. */
  modelPort?: number;
  /** Overrides of the model line of runtime.json (the provider and model name decide the price from the rate table). */
  parser?: { provider?: string; model?: string };
}

export interface Shop {
  root: string;
  client: string;
  dataDir: string;
  internal: string;
  channel: string;
  owner: string;
  setup: string;
  port: number;
  /** Call the shop over HTTP. `as` picks the credential: the internal token, the channel token (default for /internal/channel/*), and the owner's link or session. */
  call(path: string, o?: { method?: string; token?: string | null; owner?: string; session?: string; body?: unknown; raw?: Uint8Array; type?: string; headers?: Record<string, string> }): Promise<{ status: number; body: any; headers: Headers; bytes: Uint8Array }>;
  /** Stop the process (SIGTERM) and wait for it to be gone. */
  stop(): Promise<void>;
  /** Start it (or again) on the same folder and port. `impl` overrides LISTINGS_IMPL, for the cross-restart test that runs the two in turn on one folder. */
  start(impl?: "ts" | "go"): Promise<void>;
  /** Wait until nothing is pending in the shop's queue (steps are asynchronous). */
  settle(): Promise<any>;
  /** What the process printed (stdout and stderr), for a failure message. */
  log(): string;
  /** The shop process's id (for measuring its memory). */
  pid(): number | undefined;
  cleanup(): void;
}

async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const port = (s.address() as { port: number }).port;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

/** Write a shop's folder as the deployer would, and return a handle that starts it. */
export async function makeShop(o: ShopOptions = {}): Promise<Shop> {
  const root = mkdtempSync(join(tmpdir(), "listings-contract-"));
  const client = join(root, "client");
  const secrets = join(root, "secrets");
  const dataDir = join(root, "data");
  mkdirSync(client, { recursive: true });
  mkdirSync(secrets, { recursive: true });
  const port = await freePort();
  const internal = hex(24);
  const channel = hex(24);
  const owner = newOwnerToken();
  const setup = newSetupToken();
  writeFileSync(join(secrets, "internal_token"), internal);
  writeFileSync(join(secrets, "channel_token"), channel);
  writeFileSync(join(secrets, "record_key"), hex(32));
  writeFileSync(join(client, "settings.json"), JSON.stringify({ name: "Glow Pets", place: { town: "Thrissur", pincode: "680001" }, trade: "pets", timezone: "Asia/Kolkata", languages: ["en", "ml"], owner: { language: "en" }, assistant: {} }));
  const runtime: Record<string, unknown> = { mode: "fakes", host: "127.0.0.1", port, dataDir, tickSeconds: 3600, services: {} };
  if (o.modelPort !== undefined) runtime.parser = { wire: "openai", baseUrl: `http://127.0.0.1:${o.modelPort}/v1`, model: "fake-model", timeoutMs: 5000, ...(o.parser ?? {}) };
  if (o.budget) runtime.budget = o.budget;
  writeFileSync(join(client, "runtime.json"), JSON.stringify(runtime));
  writeFileSync(join(client, OWNER_LINK_FILE), JSON.stringify(ownerLinkFile(owner, new Date())));
  writeFileSync(join(client, "pages.json"), JSON.stringify({ schema: 1, base: PAGE, ownerBase: OWNER_BASE, slug: "glow-pets", url: PAGE }));
  const now = Date.now();
  writeFileSync(join(client, OWNER_GRANTS_FILE), JSON.stringify({ schema: 1, setup: { sha256: setupHash(setup), createdAt: new Date(now).toISOString(), expiresAt: new Date(now + SETUP_MS).toISOString() } }));
  writeFileSync(join(client, "pathway.lock"), `listings@${VERSION}\n`); // written last, as the deployer does

  let child: ChildProcess | undefined;
  let output = "";
  const url = `http://127.0.0.1:${port}`;
  const command = (impl: "ts" | "go"): { cmd: string; args: string[] } => {
    if (impl === "go") return { cmd: process.env.LISTINGS_GO_BIN ?? join(REPO, "go", "bin", "listings"), args: ["--client", client] };
    return { cmd: process.execPath, args: [join(REPO, "templates", "commerce", "listings", "server", "main.ts"), "--client", client] };
  };

  const shop: Shop = {
    root, client, dataDir, internal, channel, owner, setup, port,
    async call(path, c = {}) {
      const channelRoute = path.startsWith("/internal/channel/");
      const token = c.token === undefined ? (channelRoute ? channel : internal) : c.token;
      const headers: Record<string, string> = { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(c.owner ? { "x-owner-link": c.owner } : {}), ...(c.session ? { "x-owner-session": c.session } : {}), ...(c.headers ?? {}) };
      if (c.body !== undefined) headers["content-type"] = "application/json";
      if (c.raw !== undefined) headers["content-type"] = c.type ?? "application/octet-stream";
      const r = await fetch(`${url}${path}`, { method: c.method ?? (c.body !== undefined || c.raw !== undefined ? "POST" : "GET"), headers, ...(c.body !== undefined ? { body: JSON.stringify(c.body) } : c.raw !== undefined ? { body: c.raw as BodyInit } : {}) });
      const bytes = new Uint8Array(await r.arrayBuffer());
      let body: any = null;
      try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { /* not JSON: bytes are there */ }
      return { status: r.status, body, headers: r.headers, bytes };
    },
    async start(impl = IMPL) {
      const { cmd, args } = command(impl);
      output = "";
      child = spawn(cmd, args, { env: { ...process.env, INTERNAL_TOKEN_FILE: join(secrets, "internal_token"), CHANNEL_TOKEN_FILE: join(secrets, "channel_token"), RECORD_KEY_FILE: join(secrets, "record_key") }, stdio: ["ignore", "pipe", "pipe"] });
      child.stdout!.on("data", (d: Buffer) => { output += d.toString(); });
      child.stderr!.on("data", (d: Buffer) => { output += d.toString(); });
      const early = new Promise<never>((_, reject) => child!.once("exit", (code) => reject(new Error(`the shop exited early (${code}):\n${output}`))));
      const ready = (async () => {
        for (let i = 0; i < 200; i++) {
          try { if ((await fetch(`${url}/healthz`)).status === 200) return; } catch { /* not listening yet */ }
          await new Promise((r) => setTimeout(r, 50));
        }
        throw new Error(`the shop did not answer /healthz in 10 s:\n${output}`);
      })();
      await Promise.race([ready, early]);
      child.removeAllListeners("exit");
    },
    async stop() {
      const c = child;
      if (!c || c.exitCode !== null) return;
      await new Promise<void>((resolve) => { c.once("exit", () => resolve()); c.kill("SIGTERM"); setTimeout(() => c.kill("SIGKILL"), 4000).unref(); });
      child = undefined;
    },
    async settle() {
      for (let i = 0; i < 200; i++) {
        const s = await shop.call("/status");
        if (s.status === 200 && s.body.tasks.pending === 0) return s.body;
        await new Promise((r) => setTimeout(r, 25));
      }
      throw new Error(`the queue did not drain in 5 s:\n${output}`);
    },
    log: () => output,
    pid: () => child?.pid,
    cleanup() { void shop.stop(); rmSync(root, { recursive: true, force: true }); },
  };
  return shop;
}

// ---- a fake OpenAI-compatible model server --------------------------------------------------------------------------------------------------------------------

export interface FakeModel { port: number; calls: number; requests: any[]; answer: (owner: string) => unknown; close(): Promise<void> }

/** A listing's draft as the model writes it: what `listingPrompt`'s schema asks for. `words` is the one title and text used for all four languages. */
export const draftAnswer = (title = "Persian kittens", text = "Playful kittens, looking for a home.", category = "pets", claims: string[] = []): unknown => ({
  category, titles: { en: title, hi: title, ml: title, kn: title }, texts: { en: text, hi: text, ml: text, kn: text }, claims,
});

/** Start the fake. `answer` gets the owner's words (the last user message) and returns the JSON the model would write. Every call is counted. */
export async function startFakeModel(answer: (owner: string) => unknown = () => draftAnswer()): Promise<FakeModel> {
  const fake: FakeModel = { port: 0, calls: 0, requests: [], answer, close: async () => undefined };
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      fake.calls += 1;
      let body: any = {};
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* leave empty */ }
      fake.requests.push({ url: req.url, authorization: req.headers.authorization, body });
      const user = (body.messages ?? []).filter((m: { role: string }) => m.role === "user").at(-1)?.content ?? "";
      const reply = JSON.stringify({ id: "fake", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(fake.answer(user)) } }], usage: { prompt_tokens: 100, completion_tokens: 50 } });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(reply);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  fake.port = (server.address() as { port: number }).port;
  fake.close = () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); });
  return fake;
}

// ---- a tiny JPEG ---------------------------------------------------------------------------------------------------------------------------------------------

/** A minimal JPEG the runtime's photo check accepts: an EXIF segment (which must be cleaned away), a frame header of `w` x `h`, and a scan, ended properly. */
export function tinyJpeg(w = 64, h = 48, withExif = true): Uint8Array {
  const seg = (marker: number, body: number[]): number[] => [0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body];
  const exif = withExif ? seg(0xe1, [...Buffer.from("Exif\0\0"), ...Buffer.from("GPS-IS-HERE")]) : [];
  const sof = seg(0xc0, [8, h >> 8, h & 0xff, w >> 8, w & 0xff, 1, 1, 0x11, 0]);
  const sos = seg(0xda, [1, 1, 0, 0, 63, 0]);
  return Uint8Array.from([0xff, 0xd8, ...exif, ...sof, ...sos, 1, 2, 3, 4, 5, 6, 7, 8, 0xff, 0xd9]);
}

/** Wait a moment: used where a clock must move on (a draft's day). */
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
