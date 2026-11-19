// The harness of the Bookings runtime CONTRACT (see README.md in this folder). It makes a Bookings shop's folder in a temp directory exactly as the deployer does (client folder
// with settings.json, runtime.json, pathway.lock written LAST, owner-link.json, pages.json, owner-grants.json; secrets internal_token, channel_token, record_key and the agent's
// credential for its payments Guard), starts the shop as a SEPARATE PROCESS on a free port, and gives the tests an HTTP caller. Nothing of the runtime is imported except pure
// helpers used to MAKE files and to say what a webhook or a handle looks like: the runtime itself is only ever reached over HTTP.
//
// Which implementation runs is chosen by the environment:
//   BOOKINGS_IMPL=ts   (default)  node templates/commerce/bookings/server/main.ts --client <folder>
//   BOOKINGS_IMPL=go              the built binary named by BOOKINGS_GO_BIN (default <repo>/go/bin/bookings) with the same arguments
// An unknown value stops the run. On `go` without the binary EVERY test is skipped, with the reason below (`contract()` below is the one wrapper, so no test is forgotten).
//
// Two kinds of shop, because a shop's services are either in-memory (the test clock may move) or Guards over HTTP (the real clock only):
//   mode "fakes"   runtime.json "fakes": the calendar, payments and WhatsApp are the runtime's own in-memory stand-ins, on the TEST clock (GEOMETER_TEST=1, GEOMETER_TEST_CLOCK_FILE;
//                  modules/runtime/test-clock.ts honours it for a "fakes" shop only), put at the instant the unit tests use: Tue 3 Nov 2026, 10:00 in India. Observed through
//                  the channel routes, /status, the owner's page and agent.db. The Go runtime must reproduce the in-memory stand-ins for these.
//   mode "guards"  runtime.json "live": the services are the FAKE GUARDS of guards.ts (HTTP servers that record every request and answer from the stand-ins and the captured
//                  Guard answers), the real clock, the record key required. Observed through what the Guards were sent and what they hold.
// Every process is started and stopped through modules/test/contract/children.ts, which stops it at the end of each test and fails the run if one is still alive.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { OWNER_LINK_FILE, newOwnerToken, ownerLinkFile } from "../../../../modules/channels/owner-link.ts";
import { OWNER_GRANTS_FILE, OWNER_RESET_FILE, SETUP_MS, newSetupToken, setupHash } from "../../../../modules/channels/owner-grants.ts";
import { OWNER_SESSIONS_FILE } from "../../../../modules/channels/owner-access.ts";
import { guestHash, handleHash, newGuestHandle, newHandle } from "../../../../modules/channels/handle.ts";
import { TEST_CLOCK_FILE, TEST_SWITCH } from "../../../../modules/runtime/test-clock.ts";
import { zonedToMs } from "../../../../modules/core/time.ts";
import { startRuntimeProcess, callRuntime } from "../../../../modules/test/contract/runtime-process.ts";
import type { RuntimeProcess, Answer, CallOptions } from "../../../../modules/test/contract/runtime-process.ts";
import { startFakeModel as startSharedFakeModel } from "../../../../modules/test/contract/fake-model.ts";
import type { FakeModel } from "../../../../modules/test/contract/fake-model.ts";
import { freePort, hex, sleep } from "../../../../modules/test/contract/net.ts";
import { makeTestClockFile } from "../../../../modules/test/contract/test-clock-file.ts";
import { parseSettings } from "../src/settings.ts";
import { startGuards } from "./guards.ts";
import type { FakeGuards } from "./guards.ts";

export { sleep, hex };
export type { FakeModel, Answer };

const here = dirname(fileURLToPath(import.meta.url));
/** The repository root, found from this file's own address. */
export const REPO = join(here, "..", "..", "..", "..");
const KNOWN = ["ts", "go"] as const;
export const IMPL = (process.env.BOOKINGS_IMPL ?? "ts") as (typeof KNOWN)[number];
if (!KNOWN.includes(IMPL)) throw new Error(`BOOKINGS_IMPL is "${process.env.BOOKINGS_IMPL}": say ts or go.`);
const GO_BIN = process.env.BOOKINGS_GO_BIN ?? join(REPO, "go", "bin", "bookings");

/** Why every test is skipped (undefined: they run). */
export const SKIP: string | undefined = IMPL === "go" && !existsSync(GO_BIN) ? "no Go Bookings runtime yet (wave 2)" : undefined;

/** The ONE wrapper every contract test goes through: a test is skipped only when what it needs is not there, and says so. */
export const contract = (name: string, fn: () => Promise<void> | void): void => { void test(name, SKIP ? { skip: SKIP } : {}, fn); };

export const PAGE = "https://pages.example/glow-salon";
export const OWNER_BASE = "https://pages.example/owner";
export const SLUG = "glow-salon";
export const TZ = "Asia/Kolkata";
/** The unit tests' instant: Tue 3 Nov 2026, 10:00 in India (a "fakes" shop starts here). */
export const START = zonedToMs({ year: 2026, month: 11, day: 3 }, { hour: 10, minute: 0 }, TZ);
export const CUSTOMER = "+919811111111";
export const OTHER_CUSTOMER = "+919822222222";
export const OWNER_NUMBER = "+919000000000";
const SETTINGS = JSON.parse(readFileSync(join(here, "..", "settings", "glow-salon.example.json"), "utf8")) as Record<string, any>;
/** The pathway version the TS runtime pins a folder to (package.json), so a folder written here starts on both implementations. */
export const VERSION = (JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")) as { version: string }).version;

export const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

/** The start (epoch ms) of 11:00 in India on the first open day (Monday to Saturday) at least `minDays` days after `from`: a time the shop can book on any day this runs. */
export function openStart(from: number, minDays = 2, hour = 11): number {
  for (let d = minDays; d < minDays + 8; d++) {
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(from + d * DAY);
    const g = (t: string): string => p.find((x) => x.type === t)!.value;
    if (g("weekday") === "Sun") continue;
    return zonedToMs({ year: Number(g("year")), month: Number(g("month")), day: Number(g("day")) }, { hour, minute: 0 }, TZ);
  }
  throw new Error("no open day found");
}

/** Settings that make the shop open round the clock every day (a booking a few hours from now is then possible whenever a test runs: the late-cancellation rules need one). */
export const ALWAYS_OPEN = { openingHours: Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, { open: "00:00", close: "23:59" }])) };

/** A start (epoch ms) two to three hours after `from`, on the 30-minute grid and clear of midnight (a booking must end the day it starts): for a shop with ALWAYS_OPEN. */
export function soonStart(from: number): number {
  let t = Math.ceil((from + 2 * HOUR) / (30 * MIN)) * 30 * MIN;
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(t);
  const minutes = Number(p.find((x) => x.type === "hour")!.value) * 60 + Number(p.find((x) => x.type === "minute")!.value);
  if (minutes > 22 * 60) t += (24 * 60 - minutes) * MIN; // past 22:00: the start moves to midnight, which is still inside 24 hours
  return t;
}

export interface ShopOptions {
  /** "fakes" (default): in-memory services and the test clock. "guards": the fake Guards of guards.ts and the real clock. */
  mode?: "fakes" | "guards";
  /** Changes to the Glow Salon example's settings.json (a deep merge; `null` removes a key). */
  settings?: Record<string, unknown>;
  /** The owner's number in settings.json. Default the example's. */
  owner?: string;
  ownerLanguage?: "en" | "hi" | "ml" | "kn";
  /** The beat of the clock in seconds (default 3600, so no tick happens in a test unless it asks). */
  tickSeconds?: number;
  /** The fake model's port; with it runtime.json names it as the `parser`. */
  modelPort?: number;
  parser?: Record<string, unknown>;
  /** A shop with NO WhatsApp (runtime.json `services: {}` in fakes mode; no `messaging` in guards mode). */
  noWhatsApp?: boolean;
  /** More members of runtime.json (budget, report, talk, ai, model, allowance, pauseMinutes, speech ...). */
  runtime?: Record<string, unknown>;
  /** `licence.json` as the deployer writes it before the first start. */
  licence?: unknown;
  /** Guards mode only: the guards to use (default: new ones made from the settings; the harness closes only the ones it made). */
  guards?: FakeGuards;
  /** Fakes mode: false = the machine's clock, no test clock. */
  clock?: boolean;
  /** Fakes mode: put the clock at this instant instead of START. */
  at?: number;
}

export interface Shop {
  root: string;
  client: string;
  dataDir: string;
  internal: string;
  channel: string;
  /** The owner's panel-made link (x-owner-link). */
  owner: string;
  setup: string;
  port: number;
  mode: "fakes" | "guards";
  guards: FakeGuards | undefined;
  settings: Record<string, any>;
  call(path: string, o?: Omit<CallOptions, "token"> & { token?: string | null }): Promise<Answer>;
  stop(): Promise<void>;
  start(impl?: "ts" | "go"): Promise<void>;
  /** Wait until nothing is pending in the shop's queue (steps are asynchronous). */
  settle(): Promise<any>;
  log(): string;
  pid(): number | undefined;
  cleanup(): Promise<void>;
  now(): number;
  advance(ms: number): void;
  /** GET /status. */
  status(): Promise<any>;
  /** POST /internal/events (the inbox's token); returns the answer. */
  events(list: unknown[]): Promise<Answer>;
  /** A customer's WhatsApp message arrives (as the inbox hands it on); waits until it is handled. `reply` is a tapped button or list row. */
  inbound(from: string, text: string, o?: { id?: string; reply?: { id: string; kind: "button" | "list" }; timestamp?: number; extra?: Record<string, unknown> }): Promise<Answer>;
  /** A customer taps the button or list row `id` of the newest interactive message the shop sent them (guards mode: read from the WhatsApp stand-in's outbox, so a tap of something never shown throws). */
  tap(id: string, o?: { from?: string }): Promise<Answer>;
  /** What the shop sent a number on WhatsApp (guards mode, from the WhatsApp stand-in): kind (text, template, interactive...), template name and words, oldest first. */
  sent(to: string): { kind: string; templateName?: string; text: string; interactive?: any }[];
  /** POST /internal/channel/events with the channel token (and the owner's link for an owner kind). */
  channelEvents(list: unknown[], o?: { owner?: boolean | string; session?: string }): Promise<Answer>;
  /** A customer's booking from the shop's page: returns the raw handle and its hash. Waits until handled. */
  book(o?: { serviceId?: string; startMs?: number; name?: string; phone?: string; language?: string; id?: string }): Promise<{ handle: string; hash: string; answer: Answer }>;
  /** GET /internal/channel/request?handle=<hash>. */
  request(hash: string): Promise<Answer>;
  /** GET /internal/channel/owner (the owner's link). */
  ownerView(): Promise<Answer>;
  /** The channel's own handle for a guest in the chat on the page: the raw handle and the hash the runtime is given. */
  guest(): { handle: string; hash: string };
  /** One chat send from a guest; returns the answer. */
  chat(hash: string, text: string, o?: { language?: string; id?: string }): Promise<Answer>;
  // ---- the files the deployer writes ----
  writeGrants(grants: unknown): void;
  writeReset(reset: unknown): void;
  writeSessionsEnd(endBefore: string): void;
  writeLicence(licence: unknown): void;
  setOwnerNumber(owner: string | undefined): void;
  setTickSeconds(seconds: number): void;
  setMode(mode: "fakes" | "live"): void;
  /** The record's lines as the store keeps them (action, outcome, booking, refs), read from agent.db read-only. */
  record(): { action: string; outcome: string; booking: string | null; refs: Record<string, string> }[];
  /** The task rows as the store keeps them: key, state, attempts. */
  tasks(): { key: string; state: string; attempts: number }[];
}

const merge = (a: any, b: any): any => {
  if (b === null) return undefined;
  if (typeof a !== "object" || a === null || Array.isArray(a) || typeof b !== "object" || Array.isArray(b)) return b;
  const out: Record<string, any> = { ...a };
  for (const [k, v] of Object.entries(b)) { const m = merge(a[k], v); if (m === undefined) delete out[k]; else out[k] = m; }
  return out;
};

/** Write a shop's folder as the deployer would, and return a handle that starts it. */
export async function makeShop(o: ShopOptions = {}): Promise<Shop> {
  const mode = o.mode ?? "fakes";
  const root = mkdtempSync(join(tmpdir(), "bookings-contract-"));
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
  const given = merge(SETTINGS, { ...(o.settings ?? {}) });
  const settingsOf = (number: string | undefined): Record<string, any> => ({ ...given, owner: { ...given.owner, language: o.ownerLanguage ?? given.owner.language, ...(number ? { whatsapp: number } : { whatsapp: undefined }) } });
  let ownerNumber: string | undefined = o.owner ?? given.owner.whatsapp;
  const writeSettings = (): void => { writeFileSync(join(client, "settings.json"), JSON.stringify(settingsOf(ownerNumber))); };
  writeSettings();

  const parsed = parseSettings(settingsOf(ownerNumber));
  let guards: FakeGuards | undefined;
  const madeGuards = mode === "guards" && o.guards === undefined;
  if (mode === "guards") guards = o.guards ?? await startGuards(parsed);
  const runtime: Record<string, any> = { mode: mode === "guards" ? "live" : "fakes", host: "127.0.0.1", port, dataDir, tickSeconds: o.tickSeconds ?? 3600 };
  if (mode === "guards" && guards) {
    const upi = given.payment?.module === "upi";
    const own = given.calendar?.module === "own";
    const tokenFile = join(secrets, "agent_razorpay");
    writeFileSync(tokenFile, guards.agentToken);
    runtime.services = {
      ...(upi ? {} : { payments: { baseUrl: guards.payments.url, agentTokenFile: tokenFile } }),
      ...(own ? {} : { calendar: { baseUrl: guards.calendar.url, calendarId: "shop@example.com" } }),
      ...(o.noWhatsApp ? {} : { messaging: { baseUrl: guards.messaging.url, phoneNumberId: guards.phoneNumberId } }),
      timeoutMs: 3000,
    };
  } else if (o.noWhatsApp) runtime.services = {}; // `services` naming no messaging means "no WhatsApp" (runtimeHasWhatsApp); leaving it out keeps the stand-in WhatsApp
  if (o.modelPort !== undefined) runtime.parser = { wire: "openai", baseUrl: `http://127.0.0.1:${o.modelPort}/v1`, model: "fake-model", timeoutMs: 5000, ...(o.parser ?? {}) };
  Object.assign(runtime, o.runtime ?? {});
  const writeRuntime = (): void => { writeFileSync(join(client, "runtime.json"), JSON.stringify(runtime)); };
  writeRuntime();
  writeFileSync(join(client, OWNER_LINK_FILE), JSON.stringify(ownerLinkFile(owner, new Date())));
  writeFileSync(join(client, "pages.json"), JSON.stringify({ schema: 1, base: PAGE, ownerBase: OWNER_BASE, slug: SLUG, url: PAGE }));
  const now0 = Date.now();
  writeFileSync(join(client, OWNER_GRANTS_FILE), JSON.stringify({ schema: 1, setup: { sha256: setupHash(setup), createdAt: new Date(now0).toISOString(), expiresAt: new Date(now0 + SETUP_MS).toISOString() } }));
  if (o.licence !== undefined) writeFileSync(join(client, "licence.json"), JSON.stringify(o.licence));
  writeFileSync(join(client, "pathway.lock"), `bookings@${VERSION}\n`); // written last, as the deployer does

  // the test clock (fakes mode only): the machine's clock plus an offset, put at the unit tests' instant (a negative offset is accepted); the test moves it with `advance`
  const clock = mode === "fakes" && o.clock !== false ? makeTestClockFile(join(root, "clock")) : undefined;
  if (clock) clock.advance((o.at ?? START) - Date.now());
  /** A file in the client folder, written whole as the deployer does (a rename), or removed. */
  const put = (name: string, value: unknown): void => {
    const file = join(client, name);
    if (value === undefined) { rmSync(file, { force: true }); return; }
    writeFileSync(`${file}.tmp`, JSON.stringify(value)); renameSync(`${file}.tmp`, file);
  };

  let running: RuntimeProcess | undefined;
  const printed = { text: "" };
  const url = `http://127.0.0.1:${port}`;
  const command = (impl: "ts" | "go"): { cmd: string; args: string[] } => {
    if (impl === "go") return { cmd: GO_BIN, args: ["--client", client] };
    return { cmd: process.execPath, args: [join(REPO, "templates", "commerce", "bookings", "server", "main.ts"), "--client", client] };
  };
  let ids = 0;
  const uid = (p: string): string => `${p}-${Date.now().toString(36)}-${++ids}`;

  const shop: Shop = {
    root, client, dataDir, internal, channel, owner, setup, port, mode, guards, settings: given,
    async call(path, c = {}) {
      const channelRoute = path.startsWith("/internal/channel/");
      return callRuntime(url, path, { ...c, token: c.token === undefined ? (channelRoute ? channel : internal) : c.token });
    },
    async start(impl = IMPL) {
      await running?.stop(); running = undefined;
      const { cmd, args } = command(impl);
      const env: Record<string, string | undefined> = { ...process.env, INTERNAL_TOKEN_FILE: join(secrets, "internal_token"), CHANNEL_TOKEN_FILE: join(secrets, "channel_token"), RECORD_KEY_FILE: join(secrets, "record_key") };
      delete env[TEST_SWITCH]; delete env[TEST_CLOCK_FILE];
      if (clock) { env[TEST_SWITCH] = "1"; env[TEST_CLOCK_FILE] = clock.file; }
      running = await startRuntimeProcess(cmd, args, env, url, `the ${impl} bookings shop in ${root}`, printed);
    },
    async stop() { await running?.stop(); running = undefined; },
    async settle() {
      for (let i = 0; i < 400; i++) {
        const s = await shop.call("/status");
        if (s.status === 200 && s.body.tasks.pending === 0) return s.body;
        await new Promise((r) => setTimeout(r, 25));
      }
      throw new Error(`the queue did not drain in 10 s:\n${printed.text}`);
    },
    log: () => printed.text,
    pid: () => running?.child.pid,
    async cleanup() { rmSync(root, { recursive: true, force: true }); if (madeGuards) await guards?.close(); },
    now: () => clock?.now() ?? Date.now(),
    advance(ms) {
      if (!clock) throw new Error("this shop has no test clock (a fakes shop made with clock: true, the default)");
      clock.advance(ms);
    },
    async status() { return (await shop.call("/status")).body; },
    events: (list) => shop.call("/internal/events", { body: { events: list } }),
    async inbound(from, text, m = {}) {
      // in guards mode the message is made by the WhatsApp stand-in, which also opens the customer's 24-hour window there (it refuses a plain message to a number that has not written)
      const made = guards ? guards.standins.fakes.messaging.receive(from, text, { ...(m.id ? { id: m.id } : {}), ...(m.reply ? { reply: m.reply } : {}) } as never) : undefined;
      const message = made ?? { id: m.id ?? uid("wamid"), from, text, timestamp: m.timestamp ?? shop.now(), ...(m.reply ? { reply: m.reply } : {}) };
      Object.assign(message, m.extra ?? {});
      const a = await shop.events([{ kind: "message", message }]);
      if (a.status === 200) await shop.settle();
      return a;
    },
    async tap(id, t = {}) {
      const from = t.from ?? CUSTOMER;
      const shown = shop.sent(from).filter((x) => x.interactive).reverse().map((x) => x.interactive).find((i) => [...(i.buttons ?? []), ...(i.list?.rows ?? [])].some((c: { id: string }) => c.id === id));
      const option = [...(shown?.buttons ?? []), ...(shown?.list?.rows ?? [])].find((c: { id: string }) => c.id === id);
      if (!shown || !option) throw new Error(`No buttons or list ${from} was sent have an option with the id "${id}".`);
      return shop.inbound(from, option.title, { reply: { id, kind: shown.buttons ? "button" : "list" } });
    },
    sent: (to) => (guards ? guards.standins.fakes.messaging.sentTo(to) : []) as never,
    channelEvents: (list, c = {}) => shop.call("/internal/channel/events", { body: { events: list }, ...(c.owner ? { owner: typeof c.owner === "string" ? c.owner : owner } : {}), ...(c.session ? { session: c.session } : {}) }),
    async book(b = {}) {
      const handle = newHandle();
      const hash = handleHash(handle);
      const startMs = b.startMs ?? openStart(shop.now());
      const answer = await shop.channelEvents([{ kind: "channel_request", id: b.id ?? uid("req"), channel: "web", op: "book", handle: hash, serviceId: b.serviceId ?? "haircut", startMs, name: b.name ?? "Asha", phone: b.phone ?? CUSTOMER, language: b.language ?? "en" }]);
      if (answer.status === 200) await shop.settle();
      return { handle, hash, answer };
    },
    request: (hash) => shop.call(`/internal/channel/request?handle=${hash}`),
    ownerView: () => shop.call("/internal/channel/owner", { owner }),
    guest() { const handle = newGuestHandle(); return { handle, hash: guestHash(SLUG, handle) }; },
    async chat(hash, text, c = {}) {
      const a = await shop.channelEvents([{ kind: "chat_message", id: c.id ?? uid("chat"), handle: hash, language: c.language ?? "en", text }]);
      if (a.status === 200) await shop.settle();
      return a;
    },
    writeGrants: (grants) => put(OWNER_GRANTS_FILE, grants),
    writeReset: (reset) => put(OWNER_RESET_FILE, reset),
    writeSessionsEnd: (endBefore) => put(OWNER_SESSIONS_FILE, { schema: 1, endBefore }),
    writeLicence: (licence) => put("licence.json", licence),
    setOwnerNumber: (number) => { ownerNumber = number; writeSettings(); },
    setTickSeconds: (seconds) => { runtime.tickSeconds = seconds; writeRuntime(); },
    setMode: (m) => { runtime.mode = m; writeRuntime(); },
    record() {
      const db = new DatabaseSync(join(dataDir, "agent.db"), { readOnly: true });
      try {
        return (db.prepare("SELECT action, outcome, booking, entry FROM record ORDER BY seq").all() as { action: string; outcome: string; booking: string | null; entry: string }[])
          .map((r) => ({ action: r.action, outcome: r.outcome, booking: r.booking, refs: (JSON.parse(r.entry) as { refs?: Record<string, string> }).refs ?? {} }));
      } finally { db.close(); }
    },
    tasks() {
      const db = new DatabaseSync(join(dataDir, "agent.db"), { readOnly: true });
      try { return db.prepare("SELECT key, state, attempts FROM tasks ORDER BY seq").all() as { key: string; state: string; attempts: number }[]; } finally { db.close(); }
    },
  };
  return shop;
}

// ---- the fake model -------------------------------------------------------------------------------------------------------------------------------------------

/** Start the shared fake OpenAI-compatible model (modules/test/contract/fake-model.ts). `answer` gets the last user message and returns what the model writes; `rawStrings` sends a string as it is. */
export const startFakeModel = (answer: (user: string) => unknown, o: { rawStrings?: boolean } = {}): Promise<FakeModel> => startSharedFakeModel(answer, o);
