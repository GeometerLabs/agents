// The harness of the Fees runtime CONTRACT (see README.md in this folder). It makes a Fees centre's folder in a temp directory exactly as the deployer does (client folder with
// settings.json, runtime.json, pathway.lock written LAST, owner-link.json, pages.json, owner-grants.json; secrets internal_token, channel_token, record_key and the agent's
// credential for its payments Guard), starts the centre as a SEPARATE PROCESS on a free port, and gives the tests an HTTP caller. The centre's runtime (server/, src/agent.ts) is
// never imported: it is only ever reached over HTTP and the files. What is imported is pure helpers that MAKE files and handles (modules/channels), the settings parser (the
// deployer's own), and the shared contract pieces of modules/test/contract (the process tracker, the test-clock file, the process starter, the HTTP caller, the fake model).
//
// It is the model of the Bookings contract's harness (templates/commerce/bookings/contract/harness.ts), cut to what a Fees centre has: no calendar, no booking, and a parent's
// private link instead of a booking page. Which implementation runs is chosen by the environment:
//   FEES_IMPL=ts   (default)  node templates/education/fees/server/main.ts --client <folder>
//   FEES_IMPL=go              the built binary named by FEES_GO_BIN (default <repo>/go/bin/fees) with the same arguments
// An unknown value stops the run. On `go` without the binary EVERY test is skipped with the reason below (`contract()` is the one wrapper, so no test is forgotten).
//
// Two kinds of centre:
//   mode "fakes"   runtime.json "fakes": payments and WhatsApp are the runtime's own in-memory stand-ins, on the TEST clock (GEOMETER_TEST=1, GEOMETER_TEST_CLOCK_FILE; honoured
//                  for a "fakes" shop only), put at the unit tests' instant: Mon 2 Nov 2026, 09:00 in India (November's fees are due on the 5th, reminders from the 2nd at 10:00).
//                  The beat runs every second, so a test moves the clock and WAITS for what the beat does (`waitFor`). Observed through the record (agent.db), /status, the
//                  channel routes and the owner's page.
//   mode "guards"  runtime.json "live": the services are the fake Guards of guards.ts, the real clock, the record key required. Observed through what the Guards were sent.
//                  The real clock cannot be moved, so a guards centre's fees are its students' EARLIER UNPAID MONTHS (`backDues`), which the first beat opens whatever the
//                  day; the month's own fees are made never to open in a test (due on the 1st, one reminder on the due day at 06:00: always before the first beat).
// Every process is started and stopped through modules/test/contract/children.ts, which stops it at the end of each test and fails the run if one is still alive.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { OWNER_LINK_FILE, newOwnerToken, ownerLinkFile } from "../../../../modules/channels/owner-link.ts";
import { OWNER_GRANTS_FILE, SETUP_MS, newSetupToken, setupHash } from "../../../../modules/channels/owner-grants.ts";
import { guestHash, newGuestHandle, newHandle, handleHash, parentLinkHash } from "../../../../modules/channels/handle.ts";
import { TEST_CLOCK_FILE, TEST_SWITCH } from "../../../../modules/runtime/test-clock.ts";
import { zonedToMs } from "../../../../modules/core/time.ts";
import { startRuntimeProcess, callRuntime } from "../../../../modules/test/contract/runtime-process.ts";
import type { RuntimeProcess, Answer, CallOptions } from "../../../../modules/test/contract/runtime-process.ts";
import { freePort, hex, sleep } from "../../../../modules/test/contract/net.ts";
import { makeTestClockFile } from "../../../../modules/test/contract/test-clock-file.ts";
import { parseSettings } from "../src/settings.ts";
import { startFeesGuards } from "./guards.ts";
import type { FeesGuards } from "./guards.ts";

export { sleep, hex, handleHash, newHandle, parentLinkHash };
export type { Answer, FeesGuards };

const here = dirname(fileURLToPath(import.meta.url));
/** The repository root, found from this file's own address. */
export const REPO = join(here, "..", "..", "..", "..");
const KNOWN = ["ts", "go"] as const;
export const IMPL = (process.env.FEES_IMPL ?? "ts") as (typeof KNOWN)[number];
if (!KNOWN.includes(IMPL)) throw new Error(`FEES_IMPL is "${process.env.FEES_IMPL}": say ts or go.`);
const GO_BIN = process.env.FEES_GO_BIN ?? join(REPO, "go", "bin", "fees");

/** Why every test is skipped (undefined: they run). */
export const SKIP: string | undefined = IMPL === "go" && !existsSync(GO_BIN) ? "no Go Fees runtime yet (wave 3)" : undefined;

/** The ONE wrapper every contract test goes through: a test is skipped only when what it needs is not there, and says so. */
export const contract = (name: string, fn: () => Promise<void> | void): void => { void test(name, SKIP ? { skip: SKIP } : {}, fn); };

export const PAGE = "https://pages.example/bright";
export const OWNER_BASE = "https://pages.example/owner";
export const SLUG = "bright";
export const TZ = "Asia/Kolkata";
/** The unit tests' instant: Mon 2 Nov 2026, 09:00 in India (a "fakes" centre starts here). */
export const START = zonedToMs({ year: 2026, month: 11, day: 2 }, { hour: 9, minute: 0 }, TZ);
/** An instant of November 2026 in India. */
export const at = (day: number, hour: number, minute = 0, month = 11, year = 2026): number => zonedToMs({ year, month, day }, { hour, minute }, TZ);
// The example centre's parents (settings/bright-tuition-upi.example.json): the Sharmas have two children (Aarav, class 10, and Anaya, class 8); Rohan's parent is English-speaking.
export const SHARMA = "+919811111111";
export const MEERA = "+919822222222";
export const KIRAN = "+919833333333";
export const ROHAN = "+919844444444";
export const OWNER_NUMBER = "+919000000000";
export const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

const example = (name: string): Record<string, any> => JSON.parse(readFileSync(join(here, "..", "settings", name), "utf8")) as Record<string, any>;
/** The three example centres: UPI (the template's own example), Razorpay, and Classes (Razorpay, with a timetable). */
export const EXAMPLES = { upi: "bright-tuition-upi.example.json", razorpay: "bright-tuition.example.json", classes: "bright-tuition-classes.example.json" } as const;
/** The pathway version the TS runtime pins a folder to (package.json), so a folder written here starts on both implementations. */
export const VERSION = (JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")) as { version: string }).version;

/**
 * A guards centre's month: due on the 1st, one reminder on the due day at 06:00, so the month's own fees are never chased in a test (their first reminder moment is before
 * the first beat; the next month's has not come). Rohan (class 10) and Meera (class 9) each owe an earlier month, which the first beat opens and reminds at 06:00 (now, if
 * the test runs later in the day). The others owe nothing.
 */
export const GUARDS_MONTH = { due: { day: 1, graceDays: 5 }, reminders: { daysFromDue: [0], hour: 6, maxPerMonth: 4 } };
export const BACK_MONTH = "2026-09";
export const withBackDues = (settings: Record<string, any>, dues: Record<string, number> = { "Rohan Mehta": 1800, "Meera Nair": 1500 }): Record<string, any> =>
  ({ students: settings.students.map((s: any) => (dues[s.name] !== undefined ? { ...s, backDues: [{ month: BACK_MONTH, amountInr: dues[s.name] }] } : s)) });

export interface CentreOptions {
  /** "fakes" (default): in-memory services and the test clock. "guards": the fake Guards of guards.ts and the real clock. */
  mode?: "fakes" | "guards";
  /** Which example centre (default upi). */
  example?: keyof typeof EXAMPLES;
  /** Changes to the example's settings.json (a deep merge; `null` removes a key; an array replaces). */
  settings?: Record<string, unknown>;
  /** The beat in seconds (default 1: a Fees centre's work is done on the beat, so the tests wait for it). */
  tickSeconds?: number;
  /** A centre with NO WhatsApp. */
  noWhatsApp?: boolean;
  /** More members of runtime.json. */
  runtime?: Record<string, unknown>;
  licence?: unknown;
  terms?: unknown;
  /** Fakes mode: put the clock at this instant instead of START. */
  at?: number;
  /** Guards mode: ask for the test clock ANYWAY (a live shop must refuse it). */
  forceClock?: boolean;
  /** No pages.json (a centre without a page: no parent links). */
  noPages?: boolean;
  approvalSeconds?: number;
}

/** One record line as the store keeps it, with the decisions' rule ids and verdicts. */
export interface Line { seq: number; action: string; outcome: string; booking: string | null; conversation: string; notes: string; refs: Record<string, string>; decisions: { ruleId: string; verdict: string }[]; entry: string }

export interface Centre {
  root: string;
  client: string;
  dataDir: string;
  internal: string;
  channel: string;
  owner: string;
  port: number;
  mode: "fakes" | "guards";
  guards: FeesGuards | undefined;
  settings: Record<string, any>;
  call(path: string, o?: Omit<CallOptions, "token"> & { token?: string | null }): Promise<Answer>;
  start(impl?: "ts" | "go"): Promise<void>;
  stop(): Promise<void>;
  settle(): Promise<any>;
  log(): string;
  cleanup(): Promise<void>;
  now(): number;
  /** Fakes mode: move the test clock on. */
  advance(ms: number): void;
  /** Fakes mode: put the test clock at this instant (forward only in practice). */
  goto(t: number): void;
  status(): Promise<any>;
  events(list: unknown[]): Promise<Answer>;
  /** A WhatsApp message arrives (as the inbox hands it on); waits until it is handled. */
  inbound(from: string, text: string, o?: { id?: string; reply?: { id: string; kind: "button" | "list" }; extra?: Record<string, unknown> }): Promise<Answer>;
  /** Tap the button or list row `id` of the newest interactive message the centre sent `from` (guards mode). */
  tap(id: string, o?: { from?: string }): Promise<Answer>;
  /** What the centre sent a number on WhatsApp (guards mode, from the WhatsApp stand-in), oldest first. */
  sent(to: string): { kind: string; templateName?: string; text: string; interactive?: any }[];
  channelEvents(list: unknown[], o?: { owner?: boolean; session?: string }): Promise<Answer>;
  ownerView(): Promise<Answer>;
  /** GET /internal/channel/parent?link=<hash>. */
  parent(linkHash: string): Promise<Answer>;
  /** GET /internal/channel/request?handle=<hash> (a confirmation page). */
  request(handleHash: string): Promise<Answer>;
  /** A parent's press on their private page; returns the confirmation page's handle hash. Waits until handled. */
  press(op: "fee_pay" | "fee_paid", linkHash: string, dueId: string, o?: { upiRef?: string }): Promise<{ hash: string; answer: Answer }>;
  /** The owner presses on their page (an owner_action); waits until handled. */
  ownerAction(action: string, caseId: string, digest: string, more?: Record<string, unknown>): Promise<Answer>;
  guest(): { handle: string; hash: string };
  chat(hash: string, text: string, o?: { language?: string; id?: string; parent?: string }): Promise<Answer>;
  writeLicence(licence: unknown): void;
  record(): Line[];
  tasks(): { id: string; kind: string; state: string; attempts: number; last_error: string | null }[];
  /** Poll the record (and anything else) until `pred` holds; fails with the record's actions and the process's output after `ms`. */
  waitFor<T>(pred: () => T | undefined | false | Promise<T | undefined | false>, what: string, ms?: number): Promise<T>;
  /** Wait until the first beat has saved the day the agent first ran (`startedAtMs` in the saved state), so a move of the test clock comes after it. */
  started(): Promise<void>;
  /** The newest private link a parent was sent on WhatsApp (guards mode): the raw link and its hash. */
  linkOf(parent: string): { link: string; hash: string } | undefined;
}

const merge = (a: any, b: any): any => {
  if (b === null) return undefined;
  if (typeof a !== "object" || a === null || Array.isArray(a) || typeof b !== "object" || Array.isArray(b)) return b;
  const out: Record<string, any> = { ...a };
  for (const [k, v] of Object.entries(b)) { const m = merge(a[k], v); if (m === undefined) delete out[k]; else out[k] = m; }
  return out;
};

/** Write a centre's folder as the deployer would, and return a handle that starts it. */
export async function makeCentre(o: CentreOptions = {}): Promise<Centre> {
  const mode = o.mode ?? "fakes";
  const root = mkdtempSync(join(tmpdir(), "fees-contract-"));
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
  const base = example(EXAMPLES[o.example ?? "upi"]);
  const given = merge(base, { ...(mode === "guards" ? { ...GUARDS_MONTH, ...withBackDues(base) } : {}), ...(o.settings ?? {}) });
  writeFileSync(join(client, "settings.json"), JSON.stringify(given));
  const parsed = parseSettings(given);
  const upi = given.payment?.module === "upi";
  const guards = mode === "guards" ? await startFeesGuards(parsed, o.approvalSeconds !== undefined ? { approvalTtlSeconds: o.approvalSeconds } : {}) : undefined;
  const runtime: Record<string, any> = { mode: mode === "guards" ? "live" : "fakes", host: "127.0.0.1", port, dataDir, tickSeconds: o.tickSeconds ?? 1 };
  if (guards) {
    const tokenFile = join(secrets, "agent_razorpay");
    writeFileSync(tokenFile, guards.agentToken);
    runtime.services = {
      ...(upi ? {} : { payments: { baseUrl: guards.payments.url, agentTokenFile: tokenFile } }),
      ...(o.noWhatsApp ? {} : { messaging: { baseUrl: guards.messaging.url, phoneNumberId: guards.phoneNumberId } }),
      timeoutMs: 3000,
    };
  } else if (o.noWhatsApp) runtime.services = {};
  Object.assign(runtime, o.runtime ?? {});
  writeFileSync(join(client, "runtime.json"), JSON.stringify(runtime));
  writeFileSync(join(client, OWNER_LINK_FILE), JSON.stringify(ownerLinkFile(owner, new Date())));
  if (!o.noPages) writeFileSync(join(client, "pages.json"), JSON.stringify({ schema: 1, base: PAGE, ownerBase: OWNER_BASE, slug: SLUG, url: PAGE }));
  const now0 = Date.now();
  writeFileSync(join(client, OWNER_GRANTS_FILE), JSON.stringify({ schema: 1, setup: { sha256: setupHash(setup), createdAt: new Date(now0).toISOString(), expiresAt: new Date(now0 + SETUP_MS).toISOString() } }));
  if (o.licence !== undefined) writeFileSync(join(client, "licence.json"), JSON.stringify(o.licence));
  if (o.terms !== undefined) writeFileSync(join(client, "terms.json"), JSON.stringify(o.terms));
  writeFileSync(join(client, "pathway.lock"), `fees@${VERSION}\n`); // written last, as the deployer does

  const clock = mode === "fakes" || o.forceClock ? makeTestClockFile(join(root, "clock")) : undefined;
  if (clock && mode === "fakes") clock.advance((o.at ?? START) - Date.now());
  const put = (name: string, value: unknown): void => {
    const file = join(client, name);
    if (value === undefined) { rmSync(file, { force: true }); return; }
    writeFileSync(`${file}.tmp`, JSON.stringify(value)); renameSync(`${file}.tmp`, file);
  };

  let running: RuntimeProcess | undefined;
  const printed = { text: "" };
  const url = `http://127.0.0.1:${port}`;
  const command = (impl: "ts" | "go"): { cmd: string; args: string[] } =>
    impl === "go" ? { cmd: GO_BIN, args: ["--client", client] } : { cmd: process.execPath, args: [join(REPO, "templates", "education", "fees", "server", "main.ts"), "--client", client] };
  let ids = 0;
  const uid = (p: string): string => `${p}-${Date.now().toString(36)}-${++ids}`;
  const readDb = <T>(f: (db: DatabaseSync) => T): T => { const db = new DatabaseSync(join(dataDir, "agent.db"), { readOnly: true }); try { return f(db); } finally { db.close(); } };

  const centre: Centre = {
    root, client, dataDir, internal, channel, owner, port, mode, guards, settings: given,
    async call(path, c = {}) {
      return callRuntime(url, path, { ...c, token: c.token === undefined ? (path.startsWith("/internal/channel/") ? channel : internal) : c.token });
    },
    async start(impl = IMPL) {
      await running?.stop(); running = undefined;
      const { cmd, args } = command(impl);
      const env: Record<string, string | undefined> = { ...process.env, INTERNAL_TOKEN_FILE: join(secrets, "internal_token"), CHANNEL_TOKEN_FILE: join(secrets, "channel_token"), RECORD_KEY_FILE: join(secrets, "record_key") };
      delete env[TEST_SWITCH]; delete env[TEST_CLOCK_FILE];
      if (clock) { env[TEST_SWITCH] = "1"; env[TEST_CLOCK_FILE] = clock.file; }
      running = await startRuntimeProcess(cmd, args, env, url, `the ${impl} fees centre in ${root}`, printed);
    },
    async stop() { await running?.stop(); running = undefined; },
    async settle() {
      for (let i = 0; i < 400; i++) {
        const s = await centre.call("/status");
        if (s.status === 200 && s.body.tasks.pending === 0) return s.body;
        await sleep(25);
      }
      throw new Error(`the queue did not drain in 10 s:\n${printed.text}`);
    },
    log: () => printed.text,
    async cleanup() { await running?.stop(); rmSync(root, { recursive: true, force: true }); await guards?.close(); },
    now: () => clock?.now() ?? Date.now(),
    advance(ms) { if (!clock) throw new Error("this centre has no test clock (a fakes centre has one)"); clock.advance(ms); },
    goto(t) { if (!clock) throw new Error("this centre has no test clock (a fakes centre has one)"); clock.advance(t - clock.now()); },
    async status() { return (await centre.call("/status")).body; },
    events: (list) => centre.call("/internal/events", { body: { events: list } }),
    async inbound(from, text, m = {}) {
      // in guards mode the message is made by the WhatsApp stand-in, which also opens the person's 24-hour window there
      const made = guards ? guards.standins.fakes.messaging.receive(from, text, { ...(m.id ? { id: m.id } : {}), ...(m.reply ? { reply: m.reply } : {}) }) : undefined;
      const message: Record<string, unknown> = made ? { ...made } : { id: m.id ?? uid("wamid"), from, text, timestamp: centre.now(), ...(m.reply ? { reply: m.reply } : {}) };
      Object.assign(message, m.extra ?? {});
      const a = await centre.events([{ kind: "message", message }]);
      if (a.status === 200) await centre.settle();
      return a;
    },
    async tap(id, t = {}) {
      const from = t.from ?? ROHAN;
      const shown = centre.sent(from).filter((x) => x.interactive).reverse().map((x) => x.interactive).find((i) => [...(i.buttons ?? []), ...(i.list?.rows ?? [])].some((c: { id: string }) => c.id === id));
      const option = [...(shown?.buttons ?? []), ...(shown?.list?.rows ?? [])].find((c: { id: string }) => c.id === id);
      if (!shown || !option) throw new Error(`No buttons or list ${from} was sent have an option with the id "${id}".`);
      return centre.inbound(from, option.title, { reply: { id, kind: shown.buttons ? "button" : "list" } });
    },
    sent: (to) => (guards ? guards.standins.fakes.messaging.sentTo(to) : []) as never,
    channelEvents: (list, c = {}) => centre.call("/internal/channel/events", { body: { events: list }, ...(c.owner ? { owner } : {}), ...(c.session ? { session: c.session } : {}) }),
    ownerView: () => centre.call("/internal/channel/owner", { owner }),
    parent: (linkHash) => centre.call(`/internal/channel/parent?link=${linkHash}`),
    request: (h) => centre.call(`/internal/channel/request?handle=${h}`),
    async press(op, linkHash, dueId, p = {}) {
      const hash = handleHash(newHandle());
      const answer = await centre.channelEvents([{ kind: "channel_request", id: uid("press"), channel: "web", op, parent: linkHash, dueId, handle: hash, ...(p.upiRef ? { upiRef: p.upiRef } : {}) }]);
      if (answer.status === 200) await centre.settle();
      return { hash, answer };
    },
    async ownerAction(action, caseId, digest, more = {}) {
      const a = await centre.channelEvents([{ kind: "owner_action", id: uid("oa"), action, case: caseId, digest, ...more }], { owner: true });
      if (a.status === 200) await centre.settle();
      return a;
    },
    guest() { const handle = newGuestHandle(); return { handle, hash: guestHash(SLUG, handle) }; },
    async chat(hash, text, c = {}) {
      const a = await centre.channelEvents([{ kind: "chat_message", id: c.id ?? uid("chat"), handle: hash, language: c.language ?? "en", text, ...(c.parent ? { parent: c.parent } : {}) }]);
      if (a.status === 200) await centre.settle();
      return a;
    },
    writeLicence: (licence) => put("licence.json", licence),
    record() {
      if (!existsSync(join(dataDir, "agent.db"))) return [];
      return readDb((db) => (db.prepare("SELECT seq, action, outcome, booking, conversation, entry FROM record ORDER BY seq").all() as { seq: number; action: string; outcome: string; booking: string | null; conversation: string; entry: string }[])
        .map((r) => { const e = JSON.parse(r.entry) as { notes?: string; refs?: Record<string, string>; decisions?: { ruleId: string; verdict: string }[] }; return { seq: r.seq, action: r.action, outcome: r.outcome, booking: r.booking, conversation: r.conversation, notes: String(e.notes ?? ""), refs: e.refs ?? {}, decisions: (e.decisions ?? []).map((d) => ({ ruleId: d.ruleId, verdict: d.verdict })), entry: r.entry }; }));
    },
    tasks() { return readDb((db) => db.prepare("SELECT id, kind, state, attempts, last_error FROM tasks ORDER BY seq").all() as never); },
    async waitFor(pred, what, ms = 20_000) {
      const until = Date.now() + ms;
      for (;;) {
        const got = await pred();
        if (got) return got as never;
        if (Date.now() > until) throw new Error(`waited ${ms} ms for ${what}; the record has: ${centre.record().map((l) => `${l.action}/${l.outcome}${l.refs.templates ? `(${l.refs.templates})` : ""}`).join(", ")}\n${printed.text}`);
        await sleep(100);
      }
    },
    async started() {
      await centre.waitFor(() => existsSync(join(dataDir, "agent.db")) && readDb((db) => {
        const row = db.prepare("SELECT shape FROM state_shape WHERE id = 1").get() as { shape: string } | undefined;
        return row !== undefined && "startedAtMs" in (JSON.parse(row.shape) as Record<string, unknown>);
      }), "the first beat to save the day the agent first ran");
    },
    linkOf(parent) {
      const texts = centre.sent(parent).map((m) => m.text).reverse();
      for (const t of texts) { const m = new RegExp(`${PAGE.replace(/[.*+?^${}()|[\]\\/]/gu, "\\$&")}/f/([A-Za-z0-9_-]{32})`, "u").exec(t); if (m) return { link: m[1], hash: parentLinkHash(m[1]) }; }
      return undefined;
    },
  };
  return centre;
}

/** A licence lease as bundle/lib/licence.ts writes it (modules/licence/rules.ts reads it): `paid_through` five days ago, so a "wind_down" or "stopped" state is in force. */
export const PAID_THROUGH = Math.floor(Date.now() / 1000) - 5 * 86_400;
export const lease = (state: "active" | "wind_down" | "stopped", o: { notice?: "wind_down" | "stop" | null; paidThrough?: number } = {}) => ({
  schema: 1, newest_issued_at: Math.floor(Date.now() / 1000), extension_until: 0, partner: "Divya, local Operator",
  shop: { id: "bright", plan: "business", state, paid_through: o.paidThrough ?? PAID_THROUGH, grace_days: 30, expires: Math.floor(Date.now() / 1000) + 30 * 86_400, stop_at: state === "stopped" ? Math.floor(Date.now() / 1000) - 3600 : state === "wind_down" ? Math.floor(Date.now() / 1000) + 60 * 86_400 : null, export_until: null, notice: o.notice ?? null },
});

/** Make a centre and start it. */
export async function boot(o: CentreOptions = {}): Promise<Centre> {
  const c = await makeCentre(o);
  await c.start();
  return c;
}

/** The record lines of one action (and outcome). */
export const lines = (c: Centre, action: string, outcome?: string): Line[] => c.record().filter((l) => l.action === action && (outcome === undefined || l.outcome === outcome));
/** The WhatsApp messages the record says went to one number, with their template ids. */
export const sends = (c: Centre, to?: string): Line[] => c.record().filter((l) => l.action === "send_message" && (to === undefined || l.conversation === to));
