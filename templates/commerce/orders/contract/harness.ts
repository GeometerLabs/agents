// The harness of the Orders runtime CONTRACT (see README.md in this folder). It makes an Orders shop's folder in a temp directory exactly as the deployer does (client folder
// with settings.json, runtime.json, pathway.lock written LAST, owner-link.json, pages.json, owner-grants.json; secrets internal_token, channel_token, record_key and the agent's
// credential for its payments Guard), starts the shop as a SEPARATE PROCESS on a free port, and gives the tests an HTTP caller. The shop runtime (server/, src/agent.ts) is
// never imported: it is only ever reached over HTTP and the files on disk. What is imported is pure helpers that MAKE files and handles, and the settings parser.
//
// It is the Bookings contract's harness (templates/commerce/bookings/contract/harness.ts) with Orders' own parts: the four example shops, the instant the Orders unit tests use,
// an order from the page instead of a booking, two Guards instead of three. The generic pieces (the process tracker, the fake model, the test-clock file, the process starter, the
// HTTP caller) are modules/test/contract's, shared by every contract.
//
// The shop runs on the Go program orders (go/cmd/orders), built to go/bin/orders or named by ORDERS_GO_BIN, as a separate process with `--client <folder>`. The
// TypeScript runtime it was held to was deleted on 24 Nov 2026 (decision 61; go/TRIAL.md), so ORDERS_IMPL=ts is gone; ORDERS_IMPL may still say go. Without the binary EVERY
// test is skipped, with the reason below (`contract()` is the one wrapper, so no test is forgotten).
//
// Two kinds of shop:
//   mode "fakes"   runtime.json "fakes": payments and WhatsApp are the runtime's own in-memory stand-ins, on the TEST clock (GEOMETER_TEST=1, GEOMETER_TEST_CLOCK_FILE), put at
//                  the instant the unit tests use: Mon 9 Nov 2026, 10:00 in India (today's lunch has closed at 09:00, dinner closes at 15:00). Observed through the channel
//                  routes (the page's view carries the messages the order was given), /status, the owner's page and agent.db.
//   mode "guards"  runtime.json "live": the services are the FAKE GUARDS of guards.ts and the real clock, the record key required. Observed through what the Guards were sent.
//                  The real clock means a guards test orders for a day two or more days ahead (dayAhead), so no cut-off or "days ahead" rule depends on the time it runs.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { OWNER_LINK_FILE, newOwnerToken, ownerLinkFile } from "../../../../modules/channels/owner-link.ts";
import { OWNER_GRANTS_FILE, SETUP_MS, newSetupToken, setupHash } from "../../../../modules/channels/owner-grants.ts";
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
/** Which runtime the tests start: the Go program, the only one since 24 Nov 2026. */
export const IMPL = "go" as const;
if (process.env.ORDERS_IMPL !== undefined && process.env.ORDERS_IMPL !== "go") throw new Error(`ORDERS_IMPL is "${process.env.ORDERS_IMPL}": the TypeScript runtime was deleted on 24 Nov 2026, so only go is left.`);
const GO_BIN = process.env.ORDERS_GO_BIN ?? join(REPO, "go", "bin", "orders");

/** Why every test is skipped (undefined: they run). */
export const SKIP: string | undefined = !existsSync(GO_BIN) ? `the Go Orders program is not built (go build -o go/bin/ ./cmd/orders, or set ORDERS_GO_BIN)` : undefined;

/** The ONE wrapper every contract test goes through: a test is skipped only when what it needs is not there, and says so. */
export const contract = (name: string, fn: () => Promise<void> | void): void => { void test(name, SKIP ? { skip: SKIP } : {}, fn); };

export const PAGE = "https://pages.example/annapurna";
export const OWNER_BASE = "https://pages.example/owner";
export const SLUG = "annapurna";
export const TZ = "Asia/Kolkata";
/** The Orders unit tests' instant: Mon 9 Nov 2026, 10:00 in India (a "fakes" shop starts here). Today's lunch closed at 09:00; dinner closes at 15:00. */
export const START = zonedToMs({ year: 2026, month: 11, day: 9 }, { hour: 10, minute: 0 }, TZ);
/** The example shop's customers (src/harness.ts): Amit writes English, Sunita Hindi, Rajesh is a second English customer. */
export const CUSTOMER = "+919844444444";
export const SUNITA = "+919811111111";
export const RAJESH = "+919833333333";
export const OWNER_NUMBER = "+919800000001";
export const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

/** The four example shops: Annapurna on UPI (the owner marks money), on Razorpay, with monthly plans (UPI), and Sweet Crumbs (a bakery: pickup only, all paid up front, Razorpay). */
const EXAMPLES = {
  upi: "annapurna-tiffins.example.json",
  razorpay: "annapurna-tiffins-razorpay.example.json",
  plans: "annapurna-tiffins-plans.example.json",
  bakery: "sweet-crumbs.example.json",
} as const;
export type Example = keyof typeof EXAMPLES;
const exampleOf = (e: Example): Record<string, any> => JSON.parse(readFileSync(join(here, "..", "settings", EXAMPLES[e]), "utf8")) as Record<string, any>;
/** The pathway version the TS runtime pins a folder to (package.json), so a folder written here starts on both implementations. */
export const VERSION = (JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")) as { version: string }).version;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
/** A day `n` days after `from` in the shop's zone: as the page names it ("2026-11-11"), as a customer types it ("11 nov"), and its parts. */
export function dayAhead(from: number, n: number): { iso: string; words: string; year: number; month: number; day: number } {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(from + n * DAY);
  const g = (t: string): number => Number(p.find((x) => x.type === t)!.value);
  const [year, month, day] = [g("year"), g("month"), g("day")];
  return { iso: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`, words: `${day} ${MONTHS[month - 1]}`, year, month, day };
}
/** The epoch ms of a clock time on a day in the shop's zone. */
export const at = (d: { year: number; month: number; day: number }, hour: number, minute = 0): number => zonedToMs(d, { hour, minute }, TZ);

export interface ShopOptions {
  /** "fakes" (default): in-memory services and the test clock. "guards": the fake Guards of guards.ts and the real clock. */
  mode?: "fakes" | "guards";
  /** Which example shop (default: "upi" in fakes mode, "razorpay" in guards mode). */
  example?: Example;
  /** Changes to the example's settings.json (a deep merge; `null` removes a key; an array is replaced whole). */
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
  /** Fakes mode: false = the machine's clock, no test clock. */
  clock?: boolean;
  /** Fakes mode: put the clock at this instant instead of START. */
  at?: number;
  /** Guards (live) mode: ask for the test clock ANYWAY, to see that a live shop refuses to start on it. */
  forceClock?: boolean;
  /** Guards mode: how long the Guard's approval of a held refund lasts, in seconds (60 at least). */
  approvalSeconds?: number;
  /** `terms.json` as the Operator writes it. */
  terms?: unknown;
}

/** One order from the shop's page, its API or MCP (a channel_request with op "order"). */
export interface PageOrder {
  lines?: { itemId: string; qty: number }[];
  /** "YYYY-MM-DD"; default tomorrow in fakes mode (Tue 10 Nov), two days ahead in guards mode. */
  date?: string;
  mode?: "pickup" | "delivery";
  slotId?: string;
  address?: string;
  name?: string;
  phone?: string;
  language?: string;
  channel?: "web" | "mcp";
  id?: string;
  wait?: boolean;
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
  start(impl?: "go"): Promise<void>;
  /** Wait until nothing is pending in the shop's queue (steps are asynchronous). */
  settle(): Promise<any>;
  log(): string;
  pid(): number | undefined;
  cleanup(): Promise<void>;
  now(): number;
  advance(ms: number): void;
  /** The day an order is for by default: tomorrow on the test clock, two days ahead on the real one. */
  orderDay(): ReturnType<typeof dayAhead>;
  status(): Promise<any>;
  events(list: unknown[]): Promise<Answer>;
  /** A customer's (or the owner's) WhatsApp message arrives as the inbox hands it on; waits until it is handled. `reply` is a tapped button or list row. */
  inbound(from: string, text: string, o?: { id?: string; reply?: { id: string; kind: "button" | "list" }; timestamp?: number; extra?: Record<string, unknown> }): Promise<Answer>;
  /** A customer taps the button or list row `id` of the newest interactive message the shop sent them (guards mode: read from the WhatsApp stand-in's outbox). */
  tap(id: string, o?: { from?: string }): Promise<Answer>;
  /** What the shop sent a number on WhatsApp (guards mode, from the WhatsApp stand-in), oldest first. */
  sent(to: string): { kind: string; templateName?: string; text: string; interactive?: any }[];
  channelEvents(list: unknown[], o?: { owner?: boolean | string; session?: string }): Promise<Answer>;
  /** An order from the shop's page: returns the raw handle and its hash. Waits until handled (unless `wait: false`). */
  order(o?: PageOrder): Promise<{ handle: string; hash: string; answer: Answer }>;
  /** GET /internal/channel/request?handle=<hash>. */
  request(hash: string): Promise<Answer>;
  /** GET /internal/channel/owner (the owner's link). */
  ownerView(): Promise<Answer>;
  /** The owner presses `action` on the first item of the owner's page of `kind` (and `case`, when given); waits until handled. */
  ownerPress(kind: string, action: string, o?: { case?: string; id?: string }): Promise<Answer>;
  guest(): { handle: string; hash: string };
  chat(hash: string, text: string, o?: { language?: string; id?: string }): Promise<Answer>;
  writeLicence(licence: unknown): void;
  setTickSeconds(seconds: number): void;
  /** The record's lines as the store keeps them, read from agent.db read-only. */
  record(): { action: string; outcome: string; booking: string | null; conversation: string; notes: string; refs: Record<string, string> }[];
  /** The template ids the record says went out about a conversation (the lines with `templates` in their refs that were sent, oldest first; "+"-joined ids split): to the customer, or to the owner about them. */
  templatesTo(conversation: string, to?: "customer" | "owner"): string[];
  tasks(): { id: string; kind: string; state: string; attempts: number }[];
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
  const root = mkdtempSync(join(tmpdir(), "orders-contract-"));
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
  const given = merge(exampleOf(o.example ?? (mode === "guards" ? "razorpay" : "upi")), { ...(o.settings ?? {}) });
  const settingsJson = { ...given, owner: { ...given.owner, language: o.ownerLanguage ?? given.owner.language, ...(o.owner ? { whatsapp: o.owner } : {}) } };
  writeFileSync(join(client, "settings.json"), JSON.stringify(settingsJson));

  const parsed = parseSettings(settingsJson);
  const guards = mode === "guards" ? await startGuards(parsed, o.approvalSeconds !== undefined ? { approvalTtlSeconds: o.approvalSeconds } : {}) : undefined;
  const runtime: Record<string, any> = { mode: mode === "guards" ? "live" : "fakes", host: "127.0.0.1", port, dataDir, tickSeconds: o.tickSeconds ?? 3600 };
  if (guards) {
    const upi = given.payment?.module === "upi";
    const tokenFile = join(secrets, "agent_razorpay");
    writeFileSync(tokenFile, guards.agentToken);
    runtime.services = {
      ...(upi ? {} : { payments: { baseUrl: guards.payments.url, agentTokenFile: tokenFile } }),
      ...(o.noWhatsApp ? {} : { messaging: { baseUrl: guards.messaging.url, phoneNumberId: guards.phoneNumberId } }),
      timeoutMs: 3000,
    };
  } else if (o.noWhatsApp) runtime.services = {}; // `services` naming no messaging means "no WhatsApp"; leaving it out keeps the stand-in WhatsApp
  if (o.modelPort !== undefined) runtime.parser = { wire: "openai", baseUrl: `http://127.0.0.1:${o.modelPort}/v1`, model: "fake-model", timeoutMs: 5000, ...(o.parser ?? {}) };
  Object.assign(runtime, o.runtime ?? {});
  const writeRuntime = (): void => { writeFileSync(join(client, "runtime.json"), JSON.stringify(runtime)); };
  writeRuntime();
  writeFileSync(join(client, OWNER_LINK_FILE), JSON.stringify(ownerLinkFile(owner, new Date())));
  writeFileSync(join(client, "pages.json"), JSON.stringify({ schema: 1, base: PAGE, ownerBase: OWNER_BASE, slug: SLUG, url: PAGE }));
  const now0 = Date.now();
  writeFileSync(join(client, OWNER_GRANTS_FILE), JSON.stringify({ schema: 1, setup: { sha256: setupHash(setup), createdAt: new Date(now0).toISOString(), expiresAt: new Date(now0 + SETUP_MS).toISOString() } }));
  if (o.licence !== undefined) writeFileSync(join(client, "licence.json"), JSON.stringify(o.licence));
  if (o.terms !== undefined) writeFileSync(join(client, "terms.json"), JSON.stringify(o.terms));
  writeFileSync(join(client, "pathway.lock"), `orders@${VERSION}\n`); // written last, as the deployer does

  const clock = (mode === "fakes" && o.clock !== false) || o.forceClock ? makeTestClockFile(join(root, "clock")) : undefined;
  if (clock && mode === "fakes") clock.advance((o.at ?? START) - Date.now());
  const put = (name: string, value: unknown): void => {
    const file = join(client, name);
    if (value === undefined) { rmSync(file, { force: true }); return; }
    writeFileSync(`${file}.tmp`, JSON.stringify(value)); renameSync(`${file}.tmp`, file);
  };

  let running: RuntimeProcess | undefined;
  const printed = { text: "" };
  const url = `http://127.0.0.1:${port}`;
  // the Go program only (the TypeScript runtime it once could start went on 24 Nov 2026); `impl` stays in the signature for the tests that name it
  const command = (_impl: "go"): { cmd: string; args: string[] } => ({ cmd: GO_BIN, args: ["--client", client] });
  let ids = 0;
  const uid = (p: string): string => `${p}-${Date.now().toString(36)}-${++ids}`;
  const readDb = <T>(f: (db: DatabaseSync) => T): T => { const db = new DatabaseSync(join(dataDir, "agent.db"), { readOnly: true }); try { return f(db); } finally { db.close(); } };

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
      running = await startRuntimeProcess(cmd, args, env, url, `the ${impl} orders shop in ${root}`, printed);
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
    async cleanup() { rmSync(root, { recursive: true, force: true }); await guards?.close(); },
    now: () => clock?.now() ?? Date.now(),
    advance(ms) {
      if (!clock) throw new Error("this shop has no test clock (a fakes shop made with clock: true, the default)");
      clock.advance(ms);
    },
    orderDay: () => dayAhead(shop.now(), mode === "fakes" && clock ? 1 : 2),
    async status() { return (await shop.call("/status")).body; },
    events: (list) => shop.call("/internal/events", { body: { events: list } }),
    async inbound(from, text, m = {}) {
      // in guards mode the message is made by the WhatsApp stand-in, which also opens the customer's 24-hour window there
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
    async order(b = {}) {
      const handle = newHandle();
      const hash = handleHash(handle);
      const mode = b.mode ?? "pickup";
      const answer = await shop.channelEvents([{
        kind: "channel_request", id: b.id ?? uid("req"), channel: b.channel ?? "web", op: "order", handle: hash, lines: b.lines ?? [{ itemId: "veg-thali", qty: 2 }],
        date: b.date ?? shop.orderDay().iso, mode, slotId: b.slotId ?? (mode === "pickup" ? "lunch" : "lunch-home"), ...(b.address !== undefined ? { address: b.address } : mode === "delivery" ? { address: "Flat 2, Infopark road" } : {}),
        name: b.name ?? "Asha", phone: b.phone ?? SUNITA, language: b.language ?? "en",
      }]);
      if (answer.status === 200 && b.wait !== false) await shop.settle();
      return { handle, hash, answer };
    },
    request: (hash) => shop.call(`/internal/channel/request?handle=${hash}`),
    ownerView: () => shop.call("/internal/channel/owner", { owner }),
    async ownerPress(kind, action, p = {}) {
      const items = (await shop.ownerView()).body.items as { kind: string; case: string; digest: string }[];
      const item = items.find((i) => i.kind === kind && (p.case === undefined || i.case === p.case));
      if (!item) throw new Error(`The owner's page has no "${kind}" item${p.case ? ` for ${p.case}` : ""}: ${JSON.stringify(items)}`);
      const a = await shop.channelEvents([{ kind: "owner_action", id: p.id ?? uid("press"), action, case: item.case, digest: item.digest }], { owner: true });
      if (a.status === 200) await shop.settle();
      return a;
    },
    guest() { const handle = newGuestHandle(); return { handle, hash: guestHash(SLUG, handle) }; },
    async chat(hash, text, c = {}) {
      const a = await shop.channelEvents([{ kind: "chat_message", id: c.id ?? uid("chat"), handle: hash, language: c.language ?? "en", text }]);
      if (a.status === 200) await shop.settle();
      return a;
    },
    writeLicence: (licence) => put("licence.json", licence),
    setTickSeconds: (seconds) => { runtime.tickSeconds = seconds; writeRuntime(); },
    record() {
      return readDb((db) => (db.prepare("SELECT action, outcome, booking, conversation, entry FROM record ORDER BY seq").all() as { action: string; outcome: string; booking: string | null; conversation: string; entry: string }[])
        .map((r) => ({ action: r.action, outcome: r.outcome, booking: r.booking, conversation: r.conversation, notes: String((JSON.parse(r.entry) as { notes?: string }).notes ?? ""), refs: (JSON.parse(r.entry) as { refs?: Record<string, string> }).refs ?? {} })));
    },
    templatesTo: (conversation, to = "customer") => shop.record().filter((r) => r.conversation === conversation && r.outcome === "confirmed" && r.refs.templates !== undefined && r.refs.to === to).flatMap((r) => r.refs.templates.split("+")),
    tasks: () => readDb((db) => db.prepare("SELECT id, kind, state, attempts FROM tasks ORDER BY seq").all() as { id: string; kind: string; state: string; attempts: number }[]),
  };
  return shop;
}

/** Start the shared fake OpenAI-compatible model (modules/test/contract/fake-model.ts). */
export const startFakeModel = (answer: (user: string) => unknown, o: { rawStrings?: boolean } = {}): Promise<FakeModel> => startSharedFakeModel(answer, o);

/** The beat of a shop made with `tickSeconds: 1`: long enough for one tick to run and its step to be saved. */
export const beat = async (): Promise<void> => { await sleep(2200); };
