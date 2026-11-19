// The harness of the listings-only runtime CONTRACT (see README.md in this folder). It makes a shop's folder in a temp directory exactly as the deployer does (client folder with
// settings.json, runtime.json, pathway.lock, owner-link.json, pages.json, owner-grants.json; secrets internal_token, channel_token, record_key), starts the shop as a SEPARATE
// PROCESS on a free port, and gives the tests an HTTP caller. Nothing of the runtime is imported except the pure signing and owner-link helpers used to MAKE files and CHECK
// signatures: the runtime itself is only ever reached over HTTP.
//
// The shop is the Go runtime: the built binary named by LISTINGS_GO_BIN (default <repo>/go/bin/listings), `--client <folder>`, with the token files (INTERNAL_TOKEN_FILE,
// CHANNEL_TOKEN_FILE, RECORD_KEY_FILE) in its environment. Until 19 Nov 2026 LISTINGS_IMPL=ts ran the TypeScript runtime (templates/commerce/listings/server/main.ts) on the same folder;
// it was deleted (decision 61, wave 1b) after its answers were recorded (golden.ts, golden/). Without the binary every test skips and says why (`SKIP`).
// Every process is started and stopped through children.ts, which stops it at the end of each test and fails the run if one is still alive when the run ends.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { OWNER_LINK_FILE, newOwnerToken, ownerLinkFile } from "../../../../modules/channels/owner-link.ts";
import { OWNER_GRANTS_FILE, OWNER_RESET_FILE, SETUP_MS, newSetupToken, setupHash } from "../../../../modules/channels/owner-grants.ts";
import { OWNER_SESSIONS_FILE } from "../../../../modules/channels/owner-access.ts";
import { TEST_CLOCK_FILE, TEST_SWITCH } from "../../../../modules/runtime/test-clock.ts";
import { startRuntimeProcess, callRuntime } from "../../../../modules/test/contract/runtime-process.ts";
import type { RuntimeProcess } from "../../../../modules/test/contract/runtime-process.ts";
import { callName, rawReply, slowReply, startFakeDecision, startFakeModel as startSharedFakeModel, statusReply } from "../../../../modules/test/contract/fake-model.ts";
import type { FakeModel } from "../../../../modules/test/contract/fake-model.ts";
import { freePort, hex, sleep } from "../../../../modules/test/contract/net.ts";
import { makeTestClockFile } from "../../../../modules/test/contract/test-clock-file.ts";

const here = dirname(fileURLToPath(import.meta.url));
/** The repository root, found from this file's own address. */
export const REPO = join(here, "..", "..", "..", "..");
/** The runtime under test (golden.ts writes it into a recording). */
export const IMPL = "go";
/** The Go binary the shops are started from. */
export const GO_BIN = process.env.LISTINGS_GO_BIN ?? join(REPO, "go", "bin", "listings");
/** Every test's skip: the reason when there is no binary to start (build it: cd go && go build -o bin/listings ./cmd/listings), else false. */
export const SKIP: string | false = existsSync(GO_BIN) ? false : `there is no Go binary at ${GO_BIN} (cd go && go build -o bin/listings ./cmd/listings)`;
export const PAGE = "https://pages.example/glow-pets";
export const OWNER_BASE = "https://pages.example/owner";
/** The pathway version a folder is pinned to (templates/commerce/listings/package.json, which the deployer reads too). */
export const VERSION = (JSON.parse(readFileSync(join(REPO, "templates", "commerce", "listings", "package.json"), "utf8")) as { version: string }).version;

// The golden replay's clock (golden.ts): while a golden test runs, every shop made is put on the TEST clock with this offset, so it lives at the instant the answer was recorded, and
// the files the harness dates (the owner's link, the setup grant) are dated in the shop's time. undefined: the machine's clock (unless a test asks for `clock`).
let goldenOffset: number | undefined;
/** Set (or clear, with undefined) the offset of the shops made from now on; golden.ts's only. */
export const setGoldenClock = (ms: number | undefined): void => { goldenOffset = ms; };
/** The time of a shop made now: the machine's clock plus the golden offset (for a test that computes an hour or a day in the shop's time before the shop exists). */
export const now = (): number => Date.now() + (goldenOffset ?? 0);

export interface ShopOptions {
  /** The shop's model budget (runtime.json `budget`). */
  budget?: { monthlyMicroInr: number; daily: Record<string, number> };
  /** The fake model server's port; with it, runtime.json names it as the parser. */
  modelPort?: number;
  /** Overrides of the model line of runtime.json (the provider and model name decide the price from the rate table; a short timeoutMs lets a test time a model out). */
  parser?: { provider?: string; model?: string; timeoutMs?: number };
  /** A fake System One decision model's port (startFakeDecision): runtime.json `decision` names it (provider laya, no key), with these overrides. */
  decision?: { port: number; threshold?: number; languages?: string[]; timeoutMs?: number };
  /** The owner's number in settings.json (left out: the owner gave none, and the runtime uses its "no number" marker). */
  owner?: string;
  /** The owner's language in settings.json (default "en"): the language the assistant talks to the owner in, and the owner's alerts are written in. */
  ownerLanguage?: "en" | "hi" | "ml" | "kn";
  /** The beat of the clock in seconds (runtime.json `tickSeconds`, at least 1; default 3600, so no tick happens in a test unless it asks: the owner-control notices are written by
   * the tick). */
  tickSeconds?: number;
  /** The `assistant` block of settings.json (default `{}`: the assistant on with its defaults): the character, the morning hour. */
  assistant?: Record<string, unknown>;
  /** Run the shop on the TEST clock (modules/runtime/test-clock.ts): the machine's clock plus an offset the test moves with `advance`. */
  clock?: boolean;
  /** runtime.json's services (default none); the push tests name a push Guard. */
  services?: Record<string, unknown>;
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
  /** Stop the process (SIGTERM, then SIGKILL after 4 s) and wait for it to be gone. */
  stop(): Promise<void>;
  /** Start it (or again) on the same folder and port. */
  start(): Promise<void>;
  /** Wait until nothing is pending in the shop's queue (steps are asynchronous). */
  settle(): Promise<any>;
  /** What the process printed (stdout and stderr), for a failure message. */
  log(): string;
  /** The shop process's id (for measuring its memory). */
  pid(): number | undefined;
  cleanup(): void;
  // ---- owner control (owner-control.contract.test.ts): the files the deployer writes, and the test clock ----
  /** The shop's time now: the machine's clock plus the test clock's offset (0 without `clock`). Every time written into a file is taken from here. */
  now(): number;
  /** Move the shop's test clock on by `ms` (it reads the offset on every use). */
  advance(ms: number): void;
  /** owner-grants.json as the deployer copies the panel's file (undefined: the file is removed). */
  writeGrants(grants: unknown): void;
  /** owner-reset.json as the deployer copies Geometer's reset from admin/owner-reset/<shop>.json (undefined: removed). */
  writeReset(reset: unknown): void;
  /** owner-sessions.json: the panel's "sign out every device" at `endBefore` (an ISO time). */
  writeSessionsEnd(endBefore: string): void;
  /** settings.json with another owner number (the Operator's settings form). The runtime reads settings at start: restart it to take effect, as the deployer does. */
  setOwnerNumber(owner: string | undefined): void;
  /** runtime.json's tickSeconds (read at start). */
  setTickSeconds(seconds: number): void;
  /** runtime.json's mode (read at start): "live" is what the panel writes for a real shop, which must refuse the test clock. */
  setMode(mode: "fakes" | "live"): void;
  /** The record's lines as the store keeps them (action, outcome, refs), read from agent.db read-only. */
  record(): { action: string; outcome: string; refs: Record<string, string> }[];
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
  const settings = (number: string | undefined) => JSON.stringify({ name: "Glow Pets", place: { town: "Thrissur", pincode: "680001" }, trade: "pets", timezone: "Asia/Kolkata", languages: ["en", "ml"], owner: { language: o.ownerLanguage ?? "en", ...(number ? { whatsapp: number } : {}) }, assistant: o.assistant ?? {} });
  writeFileSync(join(client, "settings.json"), settings(o.owner));
  const runtime: Record<string, unknown> = { mode: "fakes", host: "127.0.0.1", port, dataDir, tickSeconds: o.tickSeconds ?? 3600, services: o.services ?? {} };
  if (o.modelPort !== undefined) runtime.parser = { wire: "openai", baseUrl: `http://127.0.0.1:${o.modelPort}/v1`, model: "fake-model", timeoutMs: 5000, ...(o.parser ?? {}) };
  if (o.decision) { const { port: dp, ...rest } = o.decision; runtime.decision = { provider: "laya", baseUrl: `http://127.0.0.1:${dp}`, model: "laya", ...rest }; }
  if (o.budget) runtime.budget = o.budget;
  writeFileSync(join(client, "runtime.json"), JSON.stringify(runtime));
  const offset = goldenOffset;
  const made = Date.now() + (offset ?? 0); // the shop's time: a golden replay's shop lives at the recorded instant, and its files are dated then
  writeFileSync(join(client, OWNER_LINK_FILE), JSON.stringify(ownerLinkFile(owner, new Date(made))));
  writeFileSync(join(client, "pages.json"), JSON.stringify({ schema: 1, base: PAGE, ownerBase: OWNER_BASE, slug: "glow-pets", url: PAGE }));
  writeFileSync(join(client, OWNER_GRANTS_FILE), JSON.stringify({ schema: 1, setup: { sha256: setupHash(setup), createdAt: new Date(made).toISOString(), expiresAt: new Date(made + SETUP_MS).toISOString() } }));
  writeFileSync(join(client, "pathway.lock"), `listings@${VERSION}\n`); // written last, as the deployer does

  // the test clock's file (modules/test/contract/test-clock-file.ts): one integer, the milliseconds added to the machine's clock
  // (a golden test's shop is always on it, starting at the golden offset)
  const clock = o.clock || offset !== undefined ? makeTestClockFile(join(root, "clock")) : undefined;
  if (clock && offset) clock.advance(offset);
  /** A file in the client folder, written whole as the deployer does (a rename), or removed. */
  const put = (name: string, value: unknown): void => {
    const file = join(client, name);
    if (value === undefined) { rmSync(file, { force: true }); return; }
    writeFileSync(`${file}.tmp`, JSON.stringify(value)); renameSync(`${file}.tmp`, file);
  };

  let running: RuntimeProcess | undefined;
  const printed = { text: "" }; // what the process printed, kept after it stops
  const url = `http://127.0.0.1:${port}`;

  const shop: Shop = {
    root, client, dataDir, internal, channel, owner, setup, port,
    async call(path, c = {}) {
      const channelRoute = path.startsWith("/internal/channel/");
      return callRuntime(url, path, { ...c, token: c.token === undefined ? (channelRoute ? channel : internal) : c.token });
    },
    async start() {
      // a start while the last process still runs would lose the only handle to it: it is stopped first
      await running?.stop(); running = undefined;
      // the test clock only when the test asks for it; otherwise the two variables are taken out, so a shell that has them set cannot change an ordinary test
      const env: Record<string, string | undefined> = { ...process.env, INTERNAL_TOKEN_FILE: join(secrets, "internal_token"), CHANNEL_TOKEN_FILE: join(secrets, "channel_token"), RECORD_KEY_FILE: join(secrets, "record_key") };
      delete env[TEST_SWITCH]; delete env[TEST_CLOCK_FILE];
      if (clock) { env[TEST_SWITCH] = "1"; env[TEST_CLOCK_FILE] = clock.file; }
      running = await startRuntimeProcess(GO_BIN, ["--client", client], env, url, `the listings shop in ${root}`, printed);
    },
    async stop() {
      await running?.stop();
      running = undefined;
    },
    async settle() {
      for (let i = 0; i < 200; i++) {
        const s = await shop.call("/status");
        if (s.status === 200 && s.body.tasks.pending === 0) return s.body;
        await new Promise((r) => setTimeout(r, 25));
      }
      throw new Error(`the queue did not drain in 5 s:\n${printed.text}`);
    },
    log: () => printed.text,
    pid: () => running?.child.pid,
    // after stop(): the folder goes (a process still running here is children.ts's to stop and report)
    cleanup() { rmSync(root, { recursive: true, force: true }); },
    now: () => clock?.now() ?? Date.now(),
    advance(ms) {
      if (!clock) throw new Error("this shop was made without the test clock (makeShop({clock: true}))");
      clock.advance(ms);
    },
    writeGrants: (grants) => put(OWNER_GRANTS_FILE, grants),
    writeReset: (reset) => put(OWNER_RESET_FILE, reset),
    writeSessionsEnd: (endBefore) => put(OWNER_SESSIONS_FILE, { schema: 1, endBefore }),
    setOwnerNumber: (number) => { writeFileSync(join(client, "settings.json"), settings(number)); },
    setTickSeconds: (seconds) => { runtime.tickSeconds = seconds; writeFileSync(join(client, "runtime.json"), JSON.stringify(runtime)); },
    setMode: (mode) => { runtime.mode = mode; writeFileSync(join(client, "runtime.json"), JSON.stringify(runtime)); },
    record() {
      const db = new DatabaseSync(join(dataDir, "agent.db"), { readOnly: true });
      try {
        return (db.prepare("SELECT action, outcome, entry FROM record ORDER BY seq").all() as { action: string; outcome: string; entry: string }[])
          .map((r) => ({ action: r.action, outcome: r.outcome, refs: (JSON.parse(r.entry) as { refs?: Record<string, string> }).refs ?? {} }));
      } finally { db.close(); }
    },
  };
  return shop;
}

// ---- the fake model servers: modules/test/contract/fake-model.ts (one for listings and Bookings) --------------------------------------------------------------------------

export type { FakeModel };
export { callName, rawReply, slowReply, startFakeDecision, statusReply };

/** A listing's draft as the model writes it: what `listingPrompt`'s schema asks for. `words` is the one title and text used for all four languages. */
export const draftAnswer = (title = "Persian kittens", text = "Playful kittens, looking for a home.", category = "pets", claims: string[] = []): unknown => ({
  category, titles: { en: title, hi: title, ml: title, kn: title }, texts: { en: text, hi: text, ml: text, kn: text }, claims,
});

/** Start the shared fake model; without an `answer` it writes a listing's draft. */
export const startFakeModel = (answer: (owner: string, body: any) => unknown = () => draftAnswer()): Promise<FakeModel> => startSharedFakeModel(answer);

// ---- a tiny JPEG ---------------------------------------------------------------------------------------------------------------------------------------------

/** A minimal JPEG the runtime's photo check accepts: an EXIF segment (which must be cleaned away), a frame header of `w` x `h`, and a scan, ended properly. */
export function tinyJpeg(w = 64, h = 48, withExif = true): Uint8Array {
  const seg = (marker: number, body: number[]): number[] => [0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body];
  const exif = withExif ? seg(0xe1, [...Buffer.from("Exif\0\0"), ...Buffer.from("GPS-IS-HERE")]) : [];
  const sof = seg(0xc0, [8, h >> 8, h & 0xff, w >> 8, w & 0xff, 1, 1, 0x11, 0]);
  const sos = seg(0xda, [1, 1, 0, 0, 63, 0]);
  return Uint8Array.from([0xff, 0xd8, ...exif, ...sof, ...sos, 1, 2, 3, 4, 5, 6, 7, 8, 0xff, 0xd9]);
}

export { sleep };
