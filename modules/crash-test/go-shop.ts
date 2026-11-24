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
//   3. starts the program with an environment written out in full (never this process's: no NODE_ENV, nothing passed through), the test clock switched on for it alone,
//      and waits for its first beat to end, so what that beat decides for the day is decided before the situation's first step;
//   4. feeds it events over HTTP as the inbox and the channel do, waits until its queue is empty, waits for a beat of its clock, and reads its record and its saved state from
//      agent.db read-only (the same file the TypeScript runtime wrote: a shop moves between the two and loses nothing, so the TypeScript readers read it).
// The clock: the program reads the machine's clock plus an offset from a file (go/internal/testclock); this side's stand-ins read the same offset, so both see one time. Time
// keeps running between steps (a moved clock is not a frozen one): a situation that needs an exact instant sets it right before the step that reads it.
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
export { goProgram, goProgramsDir, goSkip } from "./programs.ts";
export type { ProgramRan } from "./programs.ts";
import { goProgramsDir, servedVersions } from "./programs.ts";

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
  /** pages.json `character.version` (16 hex digits): the shop's character pictures are drawn, as the deployer's loop does within a minute for a shop with the assistant. */
  character?: string;
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
  /**
   * Decision 65: stop the program and start ANOTHER on the same folder and data (a shop that took a second part moves from its template's program to go/cmd/parts): the
   * settings and pathway.lock are written as the deployer writes them (the lock last), then the new program starts.
   */
  restartAs(next: { program: string; pathway: string; version: string; settings: Record<string, unknown> }): Promise<void>;
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

/** The shop's beat: a fifth of a second (a hand-check shop may beat faster than a real one's one second, go/internal/runtime/config.go), so a wait for a beat is short. */
const BEAT_SECONDS = 0.2;

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
  writeFileSync(join(client, "runtime.json"), JSON.stringify({ mode: "fakes", standins: "http", host: "127.0.0.1", port, dataDir, tickSeconds: BEAT_SECONDS, services, ...report, ...(o.runtime ?? {}) }));
  // made at the shop's start instant, not the machine's: the hand check writes nothing from real time into a shop that runs on the test clock (the program only checks that
  // `createdAt` is there, go/internal/access OwnerLinkMatches, so this was not what made the morning line race; see `firstBeat` below)
  writeFileSync(join(client, OWNER_LINK_FILE), JSON.stringify(ownerLinkFile(owner, new Date(o.at))));
  const page = `https://pages.example/${o.slug}`;
  writeFileSync(join(client, "pages.json"), JSON.stringify({ schema: 1, base: page, ownerBase: "https://pages.example/owner", slug: o.slug, url: page, ...(o.character ? { character: { version: o.character } } : {}) }));
  for (const [name, value] of Object.entries(o.files ?? {})) writeFileSync(join(client, name), JSON.stringify(value));
  let version = o.version;
  writeFileSync(join(client, "pathway.lock"), `${o.pathway}@${version}\n`); // written last, as the deployer does

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
  let program = o.program;
  let pathway = o.pathway;
  // A start returns only once the program's FIRST beat has ended (/status `ticks`, the beats that have ended, counted again from 0 by every process). Why (25 Nov 2026): the beat
  // runs on its own timer (go/internal/runtime Start, every BEAT_SECONDS of real time from the process's start), and what the first beat decides once for the day (the owner's
  // morning line: silent on a day with nothing to say, and then not looked at again by that process) depended on whether it came before or after the situation's first steps.
  // A situation that books and pays in under 0.2 s raced it: in the evening runs of 24 Nov the booking was confirmed 4 ms before the first beat, so the morning line counted it
  // and went to the owner mid-situation (Bookings with the assistant, "The model is down mid-conversation", 39 of 40). A real shop has been beating before its customer writes;
  // so has this one now, whatever the speed of the machine.
  const firstBeat = async (): Promise<void> => {
    const until = Date.now() + SETTLE_MS;
    while (Date.now() < until) {
      const s = await callRuntime(url, "/status", { token: internal });
      if (s.status === 200 && Number(s.body?.ticks ?? 0) >= 1) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`the shop's first beat did not end in ${SETTLE_MS / 1000} s`);
  };
  const start = async (): Promise<void> => { running = await startRuntimeProcess(program, ["--client", client], env, url, `the hand check's ${pathway} shop in ${root}`, printed);
    try { await firstBeat(); } catch (e) { await running.stop(); running = undefined; throw e; }
  };
  try {
    try { await start(); } catch (e) {
      // the program serves one version of its template and refuses a folder pinned to another (runtime.LoadClientKit). The hand check runs the program that is here, so the
      // folder is pinned to the version it serves (its own sentence names it: a version folder kept beside a server may be older or newer than the program), and it starts again
      const served = /this runtime is ([a-z][a-z0-9-]*)@(\S+?)\. It will not start/u.exec(printed.text);
      if (!served || served[1] !== o.pathway || served[2] === version) throw e;
      version = served[2];
      writeFileSync(join(client, "pathway.lock"), `${o.pathway}@${version}\n`);
      await start();
    }
    servedVersions.set(o.pathway, version);
  } catch (e) {
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
    async restartAs(next) {
      await running?.stop(); running = undefined;
      writeFileSync(join(client, "settings.json"), JSON.stringify(next.settings));
      writeFileSync(join(client, "pathway.lock"), `${next.pathway}@${next.version}\n`);
      program = next.program; pathway = next.pathway;
      await start();
    },
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
