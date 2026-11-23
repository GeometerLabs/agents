// The go-live hand check's shop: ONE shop of a template, started as the Go program it will really run (decision 61; owner, 24 Nov 2026: "Run the hand check on Go"), on that shop's
// own settings, behind the template's stand-in services, on a clock the check can move. Shared by every template's crash test (templates/*/*/crash-test/go-world.ts), so the
// way a Go shop is started, fed and read is written once.
//
// What it does, in the order a contract harness does it (templates/*/*/contract/harness.ts, whose shared pieces in modules/test/contract/ it reuses: the process tracker,
// the process starter, the test-clock file, the free port):
//   1. writes the shop's folder in a fresh temp directory as the deployer does: settings.json, runtime.json, owner-link.json, pages.json, the secrets, pathway.lock LAST;
//   2. runtime.json says `"mode": "fakes"` and `"standins": "http"` (go/internal/runtime/config.go): a fakes shop may run on the TEST clock, and its services are the
//      stand-ins named in `services`, on 127.0.0.1, reached through the same clients a live shop uses. So a stand-in can fail on purpose (a lost reply, a calendar that saves
//      nothing) and keeps the records each situation is judged from, while the shop runs the code a real shop runs;
//   3. starts the program with an environment written out in full (never this process's: no NODE_ENV, nothing passed through), the test clock switched on for it alone;
//   4. feeds it events over HTTP as the inbox and the channel do, waits until its queue is empty, waits for a beat of its clock, and reads its record and its saved state from
//      agent.db read-only (the same file the TypeScript runtime wrote: a shop moves between the two and loses nothing, so the TypeScript readers read it).
// The clock: the program reads the machine's clock plus an offset from a file (go/internal/testclock); this side's stand-ins read the same offset, so both see one time. Time
// keeps running between steps (a moved clock is not a frozen one): a situation that needs an exact instant sets it right before the step that reads it.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { OWNER_LINK_FILE, newOwnerToken, ownerLinkFile } from "../channels/owner-link.ts";
import type { Clock } from "../core/clock.ts";
import { readSnapshot } from "../runtime/store.ts";
import { TEST_CLOCK_FILE, TEST_SWITCH } from "../runtime/test-clock.ts";
import { freePort, hex } from "../test/contract/net.ts";
import { callRuntime, startRuntimeProcess } from "../test/contract/runtime-process.ts";
import type { Answer, CallOptions, RuntimeProcess } from "../test/contract/runtime-process.ts";
import { makeTestClockFile } from "../test/contract/test-clock-file.ts";

export type { Answer };

/**
 * Where the Go programs are: GEOMETER_GO_PROGRAMS (a folder: the server's copy of the programs the deployer built, bundle/lib/go-build.ts), else this checkout's go/bin
 * (`cd go && go build -o bin/ ./cmd/...`). The hand check never falls back to anything else: a program that is not there is a hand check that could not run, and says so.
 */
export function goProgramsDir(env: Record<string, string | undefined> = process.env): string {
  return env.GEOMETER_GO_PROGRAMS || join(dirname(fileURLToPath(import.meta.url)), "..", "..", "go", "bin");
}

/** What the hand check ran on: the program's name, the template version it serves (its /status `version`) and the SHA-256 of its file, so a certificate names the exact program. */
export interface ProgramRan { name: string; version: string; sha256: string }

/** The program `name` (bookings, orders, fees, stock-orders): its path and file digest, or why it cannot be run. */
export function goProgram(name: string): { ok: true; path: string; sha256: string } | { ok: false; reason: string } {
  const path = join(goProgramsDir(), name);
  if (!existsSync(path)) return { ok: false, reason: `the shop's Go program (${name}) is not on this machine, so no situation could be run on it (build it with "cd go && go build -o bin/ ./cmd/${name}", or set GEOMETER_GO_PROGRAMS to the folder of the server's programs)` };
  return { ok: true, path, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") };
}

// Every world a situation opens is closed when the situation ends (modules/crash-test/situations.ts runSituation calls closeOpened), so no shop and no stand-in outlives it,
// also when the situation throws half-way.
const opened = new Set<() => Promise<void>>();
/** Register a world's `close` to be called at the end of the situation that opened it. */
export function closeLater(close: () => Promise<void>): void { opened.add(close); }
/** Close every world opened since the last call. Never throws: a world that would not close is logged, not a failure of the next situation. */
export async function closeOpened(): Promise<void> {
  for (const close of [...opened]) {
    opened.delete(close);
    try { await close(); } catch (e) { console.error(`A hand-check world would not close: ${(e as Error).message}`); }
  }
}

/** A service the shop reaches over HTTP: a stand-in on this machine (and the credential it presents, for a payments Guard). */
export interface ServiceAt { baseUrl: string; agentToken?: string; [member: string]: unknown }

export interface GoShopOptions {
  /** The program to run (an absolute path: go/bin/<program>, or the server's copy). */
  program: string;
  /** pathway.lock's line: the template's name and version (`bookings@0.1.0`). */
  pathway: string;
  version: string;
  /** settings.json, as the Operator's form writes it. */
  settings: Record<string, unknown>;
  /** The shop's time when it starts (epoch ms). */
  at: number;
  /** The stand-ins this shop reaches. A service left out is one the shop does not have (a UPI shop has no payments service). `messaging: null`: a shop with no WhatsApp. */
  services: { payments?: ServiceAt; calendar?: ServiceAt; messaging?: ServiceAt | null };
  /** More members of runtime.json (parser, decision, allowance, ...). */
  runtime?: Record<string, unknown>;
  /** Files in the client folder the deployer writes before the first start (licence.json, terms.json), by name. */
  files?: Record<string, unknown>;
  /** The page's slug (pages.json). */
  slug: string;
  /** Give the shop the monthly report's block (runtime.json `report`), its pages in a folder of the shop's own: the report and a UPI shop's QR pictures are written there. */
  report?: boolean;
  /** How long a call to a stand-in may take before the shop calls it lost (runtime.json services.timeoutMs). Default 1500: a lost reply is a cut connection, so this only bounds a hang. */
  timeoutMs?: number;
}

/** The test clock both sides read: the shop through its file, this process's stand-ins through `now()`. */
export interface MovableClock extends Clock {
  /** Put the shop's time at `ms`. */
  set(ms: number): void;
  advanceMinutes(minutes: number): void;
}

export interface GoShop {
  clock: MovableClock;
  /** The owner's panel-made link (x-owner-link), for the owner's routes. */
  owner: string;
  client: string;
  /** The report's pages folder (with `report`), where a UPI shop's QR pictures are written too. */
  pagesDir: string;
  /** Stop the program and start it again on the same folder (a restart: it remembers only what it saved). */
  restart(): Promise<void>;
  /** Call the shop: the internal token, or the channel token for a /internal/channel/ route. */
  call(path: string, o?: Omit<CallOptions, "token">): Promise<Answer>;
  /** POST /internal/events (as the inbox does), then wait until the queue is empty. Throws when the shop refuses them: a situation that sends a bad event is a broken situation. */
  events(list: unknown[]): Promise<void>;
  /** POST /internal/channel/events (as the channel does; `owner` adds the owner's link), then wait until the queue is empty. Returns the answer. */
  channelEvents(list: unknown[], o?: { owner?: boolean }): Promise<Answer>;
  /** Wait until nothing is pending in the shop's queue. */
  settle(): Promise<void>;
  /** Wait for the next beat of the shop's clock to END (after this call), then for the queue to be empty. */
  tick(): Promise<void>;
  status(): Promise<any>;
  /** The record's lines as the store keeps them (each line's JSON), oldest first. */
  record(): any[];
  /** The shop's last saved state (the template's snapshot JSON), or null before its first step. */
  snapshot(): string | null;
  /** Write a file of the client folder as the deployer does (a rename), or remove it (`undefined`). */
  writeFile(name: string, value: unknown): void;
  /** Everything the program printed. */
  log(): string;
  /** Stop the program and remove its folder. Safe to call twice. */
  close(): Promise<void>;
}

/** How long a step may take before the check calls the shop stuck (the queue not empty, a beat not come). A failing situation, never a hang of the panel. */
const SETTLE_MS = 15_000;

/** Start a shop. The caller closes it (`close`), also when its situation throws. */
export async function startGoShop(o: GoShopOptions): Promise<GoShop> {
  const root = mkdtempSync(join(tmpdir(), "geometer-handcheck-"));
  const client = join(root, "client");
  const secrets = join(root, "secrets");
  const dataDir = join(root, "data");
  mkdirSync(client, { recursive: true });
  mkdirSync(secrets, { recursive: true });
  const port = await freePort();
  const internal = hex(24);
  const channel = hex(24);
  const owner = newOwnerToken();
  writeFileSync(join(secrets, "internal_token"), internal);
  writeFileSync(join(secrets, "channel_token"), channel);
  writeFileSync(join(secrets, "record_key"), hex(32));
  writeFileSync(join(client, "settings.json"), JSON.stringify(o.settings));

  // runtime.json: a fakes shop on the hand check's stand-ins (go/internal/runtime/config.go `standins`)
  const services: Record<string, unknown> = { timeoutMs: o.timeoutMs ?? 1500 };
  for (const [name, at] of Object.entries(o.services)) {
    if (!at) continue;
    const { agentToken, ...rest } = at;
    if (agentToken) { const file = join(secrets, `agent_${name}`); writeFileSync(file, agentToken); services[name] = { ...rest, agentTokenFile: file }; } else services[name] = rest;
  }
  const pagesDir = join(root, "pages");
  const report = o.report ? { report: { preparedBy: "the hand check", pageBaseUrl: "https://reports.example.com/r", pagesDir } } : {};
  writeFileSync(join(client, "runtime.json"), JSON.stringify({ mode: "fakes", standins: "http", host: "127.0.0.1", port, dataDir, tickSeconds: 1, services, ...report, ...(o.runtime ?? {}) }));
  writeFileSync(join(client, OWNER_LINK_FILE), JSON.stringify(ownerLinkFile(owner, new Date())));
  const page = `https://pages.example/${o.slug}`;
  writeFileSync(join(client, "pages.json"), JSON.stringify({ schema: 1, base: page, ownerBase: "https://pages.example/owner", slug: o.slug, url: page }));
  for (const [name, value] of Object.entries(o.files ?? {})) writeFileSync(join(client, name), JSON.stringify(value));
  writeFileSync(join(client, "pathway.lock"), `${o.pathway}@${o.version}\n`); // written last, as the deployer does

  const file = makeTestClockFile(join(root, "clock"));
  file.advance(o.at - Date.now());
  const clock: MovableClock = { now: () => file.now(), set: (ms) => file.advance(ms - file.now()), advanceMinutes: (m) => file.advance(m * 60_000) };

  const url = `http://127.0.0.1:${port}`;
  const printed = { text: "" };
  // the environment in full: the program's secrets and the test clock, and nothing of this process's (the panel's NODE_ENV=production would stop the test clock, rightly)
  const env: Record<string, string> = {
    INTERNAL_TOKEN_FILE: join(secrets, "internal_token"), CHANNEL_TOKEN_FILE: join(secrets, "channel_token"), RECORD_KEY_FILE: join(secrets, "record_key"),
    [TEST_SWITCH]: "1", [TEST_CLOCK_FILE]: file.file, HOME: root, TMPDIR: tmpdir(),
  };
  let running: RuntimeProcess | undefined;
  const start = async (): Promise<void> => { running = await startRuntimeProcess(o.program, ["--client", client], env, url, `the hand check's ${o.pathway} shop in ${root}`, printed); };
  try { await start(); } catch (e) {
    rmSync(root, { recursive: true, force: true });
    throw e;
  }

  const db = <T>(read: (db: DatabaseSync) => T): T => {
    const d = new DatabaseSync(join(dataDir, "agent.db"), { readOnly: true });
    try { return read(d); } finally { d.close(); }
  };
  const call: GoShop["call"] = (path, c = {}) => callRuntime(url, path, { ...c, token: path.startsWith("/internal/channel/") ? channel : internal });

  const shop: GoShop = {
    clock, owner, client, pagesDir, call,
    async restart() { await running?.stop(); running = undefined; await start(); },
    async status() {
      const s = await call("/status");
      if (s.status !== 200) throw new Error(`the shop's /status answered ${s.status}`);
      return s.body;
    },
    async settle() {
      const until = Date.now() + SETTLE_MS;
      while (Date.now() < until) {
        const s = await shop.status();
        if (s.tasks?.pending === 0) return;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error(`the shop's queue was not empty after ${SETTLE_MS / 1000} s`);
    },
    async events(list) {
      const a = await call("/internal/events", { body: { events: list } });
      if (a.status !== 200) throw new Error(`the shop refused the events (${a.status}): ${JSON.stringify(a.body)}`);
      await shop.settle();
    },
    async channelEvents(list, c = {}) {
      const a = await call("/internal/channel/events", { body: { events: list }, ...(c.owner ? { owner } : {}) });
      if (a.status === 200) await shop.settle();
      return a;
    },
    async tick() {
      // `ticks` counts the beats that have ENDED (go/internal/runtime kit status): one more than now, and then one more again, so a beat that had begun before the clock moved
      // is not taken for one that saw the new time
      const from = Number((await shop.status()).ticks ?? 0);
      const until = Date.now() + SETTLE_MS;
      while (Date.now() < until) {
        if (Number((await shop.status()).ticks ?? 0) >= from + 2) { await shop.settle(); return; }
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error(`no beat of the shop's clock ended in ${SETTLE_MS / 1000} s`);
    },
    record: () => db((d) => (d.prepare("SELECT action, outcome, booking, conversation, entry FROM record ORDER BY seq").all() as { action: string; outcome: string; booking: string | null; conversation: string; entry: string }[])
      .map((r) => ({ action: r.action, outcome: r.outcome, booking: r.booking, conversation: r.conversation, ...(JSON.parse(r.entry) as Record<string, unknown>) }))),
    snapshot: () => db((d) => readSnapshot(d)),
    writeFile(name, value) {
      const f = join(client, name);
      if (value === undefined) { rmSync(f, { force: true }); return; }
      writeFileSync(`${f}.tmp`, JSON.stringify(value)); renameSync(`${f}.tmp`, f);
    },
    log: () => printed.text,
    async close() {
      await running?.stop(); running = undefined;
      rmSync(root, { recursive: true, force: true });
    },
  };
  return shop;
}
