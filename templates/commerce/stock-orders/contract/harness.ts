// The harness of the Stock orders runtime CONTRACT (see README.md in this folder). It makes a Stock orders shop's folder in a temp directory exactly as the deployer does (client
// folder with settings.json, runtime.json, owner-link.json, pages.json, owner-grants.json, pathway.lock written LAST; secrets internal_token, channel_token, record_key), starts the
// shop as a SEPARATE PROCESS on a free port, and gives the tests an HTTP caller and readers of the files the shop writes (agent.db). The shop runtime (server/, src/agent.ts) is
// never imported: only pure helpers that MAKE files and handles, and the WhatsApp stand-in on the other side of the wire (guards.ts).
//
// Which implementation runs is chosen by the environment, as in the Bookings contract:
//   STOCK_ORDERS_IMPL=ts   (default)  node templates/commerce/stock-orders/server/main.ts --client <folder>
//   STOCK_ORDERS_IMPL=go              the binary named by STOCK_ORDERS_GO_BIN (default <repo>/go/bin/stock-orders) with the same arguments
// An unknown value stops the run. On `go` without the binary EVERY test is skipped with the reason below (`contract()` is the one wrapper).
//
// Two kinds of shop:
//   mode "guards" (default)  runtime.json "live", WhatsApp is the fake Guard of guards.ts on the real clock. What went to whom is read from the stand-in's outbox: the approval card's
//                            code, the buttons, the supplier's order. Faults (a refusal, a lost reply, a delay) are plans on the recorder.
//   mode "fakes"             runtime.json "fakes": the runtime's own in-memory WhatsApp, on the TEST clock (GEOMETER_TEST=1, GEOMETER_TEST_CLOCK_FILE), so time can move (a card
//                            running out, the supplier asked again, the monthly report). Nothing that was sent can be read from outside, so these tests read agent.db (the orders,
//                            the send-once intents, the record) and the owner's page, and answer cards from the owner's page (by case and digest), never with a typed code.
// Every process goes through modules/test/contract/children.ts, which stops it at the end and fails the run if one is still alive.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { OWNER_LINK_FILE, newOwnerToken, ownerLinkFile } from "../../../../modules/channels/owner-link.ts";
import { OWNER_GRANTS_FILE, SETUP_MS, newSetupToken, setupHash } from "../../../../modules/channels/owner-grants.ts";
import { TEST_CLOCK_FILE, TEST_SWITCH } from "../../../../modules/runtime/test-clock.ts";
import { zonedToMs } from "../../../../modules/core/time.ts";
import { startRuntimeProcess, callRuntime } from "../../../../modules/test/contract/runtime-process.ts";
import type { RuntimeProcess, Answer, CallOptions } from "../../../../modules/test/contract/runtime-process.ts";
import { freePort, hex, sleep } from "../../../../modules/test/contract/net.ts";
import { makeTestClockFile } from "../../../../modules/test/contract/test-clock-file.ts";
import { startWhatsAppGuard } from "./guards.ts";
import type { WhatsAppGuard } from "./guards.ts";

export { sleep, hex };
export type { Answer };

const here = dirname(fileURLToPath(import.meta.url));
export const REPO = join(here, "..", "..", "..", "..");
const KNOWN = ["ts", "go"] as const;
export const IMPL = (process.env.STOCK_ORDERS_IMPL ?? "ts") as (typeof KNOWN)[number];
if (!KNOWN.includes(IMPL)) throw new Error(`STOCK_ORDERS_IMPL is "${process.env.STOCK_ORDERS_IMPL}": say ts or go.`);
const GO_BIN = process.env.STOCK_ORDERS_GO_BIN ?? join(REPO, "go", "bin", "stock-orders");

/** Why every test is skipped (undefined: they run). */
export const SKIP: string | undefined = IMPL === "go" && !existsSync(GO_BIN) ? "no Go Stock orders runtime yet (wave 2)" : undefined;
/** Both binaries are there: the cross-restart test runs. */
export const BOTH = existsSync(process.env.STOCK_ORDERS_GO_BIN ?? join(REPO, "go", "bin", "stock-orders"));

/** The ONE wrapper every contract test goes through. */
export const contract = (name: string, fn: () => Promise<void> | void): void => { void test(name, SKIP ? { skip: SKIP } : {}, fn); };

export const TZ = "Asia/Kolkata";
/** The unit tests' instant (test/runtime.test.ts): Mon 9 Nov 2026, 10:00 in India. A "fakes" shop starts here. */
export const START = zonedToMs({ year: 2026, month: 11, day: 9 }, { hour: 10, minute: 0 }, TZ);
export const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

const SETTINGS = JSON.parse(readFileSync(join(here, "..", "settings", "glow-salon.example.json"), "utf8")) as Record<string, any>;
export const OWNER = SETTINGS.owner.whatsapp as string;   // +919812300001, writes English
export const RAVI = "+919876500001";                      // Ravi Traders, approved, writes Hindi
export const MEENA = "+919876500002";                     // Meena Beauty Supplies, approved, English
export const KUMAR = "+919876500003";                     // Kumar Wholesale, on the list but NOT approved
export const STRANGER = "+919811199999";
export const VERSION = (JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")) as { version: string }).version;
export const ORDER_TEMPLATE = "stock_order_to_supplier";
export const REMINDER_TEMPLATE = "stock_order_reminder";

export interface ShopOptions {
  mode?: "guards" | "fakes";
  /** Changes to the Glow Unisex Salon example's settings.json (a deep merge; `null` removes a key). */
  settings?: Record<string, unknown>;
  /** The beat of the clock in seconds (default 3600: no tick in a test unless it asks). */
  tickSeconds?: number;
  /** More members of runtime.json (report, budget, ...). */
  runtime?: Record<string, unknown>;
  licence?: unknown;
  /** Fakes mode: put the clock here instead of START. */
  at?: number;
  /** Guards mode: a runtime.json that names no WhatsApp (the start must refuse it). */
  noWhatsApp?: boolean;
}

export interface SentMessage { kind: string; templateName?: string; text: string; interactive?: any; sentAt: number }
export interface Line { action: string; outcome: string; booking: string | null; conversation: string; notes: string; refs: Record<string, string>; inputs: unknown; decisions: { ruleId: string; verdict: string }[] }

export interface Shop {
  root: string; client: string; dataDir: string; internal: string; channel: string; owner: string; port: number; mode: "guards" | "fakes";
  guard: WhatsAppGuard | undefined;
  call(path: string, o?: Omit<CallOptions, "token"> & { token?: string | null }): Promise<Answer>;
  start(impl?: "ts" | "go"): Promise<void>;
  stop(): Promise<void>;
  /** SIGKILL: the process dies at once, nothing is finished. */
  kill(): void;
  /** Wait until nothing is pending in the queue and no order message is between its claim and its ending. */
  settle(): Promise<any>;
  log(): string;
  cleanup(): Promise<void>;
  now(): number;
  advance(ms: number): void;
  status(): Promise<any>;
  events(list: unknown[]): Promise<Answer>;
  /** A WhatsApp message from `from` arrives as the inbox hands it on (guards: made by the stand-in, which opens the 24-hour window there); waits until handled. */
  inbound(from: string, text: string, o?: { id?: string; reply?: { id: string; kind: "button" | "list" } }): Promise<Answer>;
  ownerSays(text: string, o?: { id?: string; reply?: { id: string; kind: "button" | "list" } }): Promise<Answer>;
  /** `from` taps the button or list row `id` of the newest interactive message the shop sent them (guards mode; a tap of something never shown throws). */
  tap(from: string, id: string): Promise<Answer>;
  /** What the shop sent a number on WhatsApp (guards mode), oldest first. */
  sent(to: string): SentMessage[];
  /** The order messages (the order template) a supplier was sent. */
  orderMessagesTo(to: string): SentMessage[];
  /** The newest approval card's one-use code, from the owner's messages (guards mode). */
  code(): string;
  /** The last message the owner was sent. */
  lastToOwner(): SentMessage | undefined;
  channelEvents(list: unknown[]): Promise<Answer>;
  ownerView(): Promise<Answer>;
  /** A press on the owner's page: the item's case and digest as the page showed them. */
  press(action: string, item: { case: string; digest: string }): Promise<Answer>;
  /** The owner's page item of this kind for this order ("po_approval" items are found by the order number in `what`). */
  item(kind: string, order: string): Promise<any | undefined>;
  /** The shop's saved state, read from agent.db: orders as an object by id, the rest as written. */
  saved(): any;
  order(id: string): any;
  record(): Line[];
  tasks(): { id: string; kind: string; state: string; attempts: number; last_error: string | null }[];
  writeLicence(licence: unknown): void;
}

const merge = (a: any, b: any): any => {
  if (b === null) return undefined;
  if (typeof a !== "object" || a === null || Array.isArray(a) || typeof b !== "object" || Array.isArray(b)) return b;
  const out: Record<string, any> = { ...a };
  for (const [k, v] of Object.entries(b)) { const m = merge(a[k], v); if (m === undefined) delete out[k]; else out[k] = m; }
  return out;
};

/** The saved state of a shop, put back together from agent.db's state_shape and state_rows (modules/runtime/store.ts keeps the lists in rows). */
export function readSaved(dataDir: string): any {
  const file = join(dataDir, "agent.db");
  if (!existsSync(file)) return undefined;
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const shape = db.prepare("SELECT shape, lists FROM state_shape WHERE id = 1").get() as { shape: string; lists: string } | undefined;
    if (!shape) return undefined;
    const doc = JSON.parse(shape.shape);
    for (const name of JSON.parse(shape.lists) as string[]) {
      const path = JSON.parse(name) as string[];
      const rows = (db.prepare("SELECT value FROM state_rows WHERE list = ? ORDER BY pos").all(name) as { value: string }[]).map((r) => JSON.parse(r.value));
      let at = doc;
      for (const p of path.slice(0, -1)) at = at[p];
      at[path[path.length - 1]] = rows;
    }
    return doc;
  } finally { db.close(); }
}

/** The one-use code in a card's words: the order card and the assistant's limit card both say it plainly (reply yes K7M2QX); the order card used to quote it, until 23 Nov. */
const CODE = /(?:^|[\s"“])yes ([A-Z0-9]{4,8})(?=["”\s.]|$)/u;

export async function makeShop(o: ShopOptions = {}): Promise<Shop> {
  const mode = o.mode ?? "guards";
  const root = mkdtempSync(join(tmpdir(), "stock-orders-contract-"));
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
  const given = merge(SETTINGS, o.settings ?? {});
  writeFileSync(join(client, "settings.json"), JSON.stringify(given));
  const guard = mode === "guards" ? await startWhatsAppGuard() : undefined;
  const runtime: Record<string, any> = { mode: mode === "guards" ? "live" : "fakes", host: "127.0.0.1", port, dataDir, tickSeconds: o.tickSeconds ?? 3600 };
  if (guard) runtime.services = { ...(o.noWhatsApp ? {} : { messaging: { baseUrl: guard.url, phoneNumberId: guard.phoneNumberId } }), timeoutMs: 3000 };
  Object.assign(runtime, o.runtime ?? {});
  writeFileSync(join(client, "runtime.json"), JSON.stringify(runtime));
  writeFileSync(join(client, OWNER_LINK_FILE), JSON.stringify(ownerLinkFile(owner, new Date())));
  writeFileSync(join(client, "pages.json"), JSON.stringify({ schema: 1, base: "https://pages.example/glow-salon", ownerBase: "https://pages.example/owner", slug: "glow-salon", url: "https://pages.example/glow-salon" }));
  const now0 = Date.now();
  writeFileSync(join(client, OWNER_GRANTS_FILE), JSON.stringify({ schema: 1, setup: { sha256: setupHash(setup), createdAt: new Date(now0).toISOString(), expiresAt: new Date(now0 + SETUP_MS).toISOString() } }));
  if (o.licence !== undefined) writeFileSync(join(client, "licence.json"), JSON.stringify(o.licence));
  writeFileSync(join(client, "pathway.lock"), `stock-orders@${VERSION}\n`); // written last, as the deployer does

  const clock = mode === "fakes" ? makeTestClockFile(join(root, "clock")) : undefined;
  if (clock) clock.advance((o.at ?? START) - Date.now());
  let running: RuntimeProcess | undefined;
  const printed = { text: "" };
  const url = `http://127.0.0.1:${port}`;
  let ids = 0;
  const uid = (p: string): string => `${p}-${Date.now().toString(36)}-${++ids}`;
  const toSent = (m: any): SentMessage => ({ kind: m.kind, ...(m.templateName ? { templateName: m.templateName } : {}), text: m.text, ...(m.interactive ? { interactive: m.interactive } : {}), sentAt: m.sentAt });

  const shop: Shop = {
    root, client, dataDir, internal, channel, owner, port, mode, guard,
    async call(path, c = {}) {
      const channelRoute = path.startsWith("/internal/channel/");
      return callRuntime(url, path, { ...c, token: c.token === undefined ? (channelRoute ? channel : internal) : c.token });
    },
    async start(impl = IMPL) {
      await running?.stop(); running = undefined;
      const cmd = impl === "go" ? GO_BIN : process.execPath;
      const args = impl === "go" ? ["--client", client] : [join(REPO, "templates", "commerce", "stock-orders", "server", "main.ts"), "--client", client];
      const env: Record<string, string | undefined> = { ...process.env, INTERNAL_TOKEN_FILE: join(secrets, "internal_token"), CHANNEL_TOKEN_FILE: join(secrets, "channel_token"), RECORD_KEY_FILE: join(secrets, "record_key") };
      delete env[TEST_SWITCH]; delete env[TEST_CLOCK_FILE];
      if (clock) { env[TEST_SWITCH] = "1"; env[TEST_CLOCK_FILE] = clock.file; }
      running = await startRuntimeProcess(cmd, args, env, url, `the ${impl} stock-orders shop in ${root}`, printed);
    },
    async stop() { await running?.stop(); running = undefined; },
    kill() { if (running?.child.pid) process.kill(running.child.pid, "SIGKILL"); running = undefined; },
    async settle() {
      // quiet: nothing pending, no order message between its claim and its ending, and the record no longer growing (the owner is told of an ending after it is saved)
      let length = -1;
      for (let i = 0; i < 400; i++) {
        const s = await shop.call("/status");
        const intents: any[] = readSaved(dataDir)?.sendOnce?.intents ?? [];
        const quiet = s.status === 200 && s.body.tasks.pending === 0 && !intents.some((x) => x.status === "queued" || x.status === "claimed");
        if (quiet && s.body.recordLength === length) return s.body;
        length = quiet ? s.body.recordLength : -1;
        await sleep(25);
      }
      throw new Error(`the queue did not drain in 10 s:\n${printed.text}`);
    },
    log: () => printed.text,
    async cleanup() { rmSync(root, { recursive: true, force: true }); await guard?.close(); },
    now: () => clock?.now() ?? Date.now(),
    advance(ms) { if (!clock) throw new Error("only a fakes shop has a test clock"); clock.advance(ms); },
    async status() { return (await shop.call("/status")).body; },
    events: (list) => shop.call("/internal/events", { body: { events: list } }),
    async inbound(from, text, m = {}) {
      const made = guard ? guard.fake.receive(from, text, { ...(m.id ? { id: m.id } : {}), ...(m.reply ? { reply: m.reply } : {}) }) : undefined;
      const message = made ?? { id: m.id ?? uid("wamid"), from, text, timestamp: shop.now(), ...(m.reply ? { reply: m.reply } : {}) };
      const a = await shop.events([{ kind: "message", message }]);
      if (a.status === 200) await shop.settle();
      return a;
    },
    ownerSays: (text, m) => shop.inbound(OWNER, text, m),
    async tap(from, id) {
      const shown = shop.sent(from).filter((x) => x.interactive).reverse().map((x) => x.interactive).find((i) => [...(i.buttons ?? []), ...(i.list?.rows ?? [])].some((c: { id: string }) => c.id === id));
      const option = [...(shown?.buttons ?? []), ...(shown?.list?.rows ?? [])].find((c: { id: string }) => c.id === id);
      if (!shown || !option) throw new Error(`No buttons or list ${from} was sent have an option with the id "${id}".`);
      return shop.inbound(from, option.title, { reply: { id, kind: shown.buttons ? "button" : "list" } });
    },
    sent: (to) => (guard ? guard.fake.sentTo(to).map(toSent) : []),
    orderMessagesTo: (to) => shop.sent(to).filter((m) => m.templateName === ORDER_TEMPLATE),
    code() {
      const m = shop.sent(OWNER).map((x) => CODE.exec(x.text)?.[1]).filter(Boolean).at(-1);
      if (!m) throw new Error(`no approval card was sent to the owner:\n${shop.sent(OWNER).map((x) => x.text).join("\n")}`);
      return m;
    },
    lastToOwner: () => shop.sent(OWNER).at(-1),
    channelEvents: (list) => shop.call("/internal/channel/events", { body: { events: list }, owner }),
    ownerView: () => shop.call("/internal/channel/owner", { owner }),
    async press(action, it) {
      const a = await shop.channelEvents([{ kind: "owner_action", id: uid("press"), action, case: it.case, digest: it.digest }]);
      if (a.status === 200) await shop.settle();
      return a;
    },
    async item(kind, order) {
      const items: any[] = (await shop.ownerView()).body.items ?? [];
      return items.find((i) => i.kind === kind && (i.case === order || String(i.what).startsWith(`${order}:`)));
    },
    saved() {
      const doc = readSaved(dataDir);
      if (!doc) return undefined;
      return { ...doc, orders: Object.fromEntries((doc.orders ?? []) as [string, unknown][]) };
    },
    order: (id) => shop.saved()?.orders?.[id],
    record() {
      const db = new DatabaseSync(join(dataDir, "agent.db"), { readOnly: true });
      try {
        return (db.prepare("SELECT action, outcome, booking, conversation, entry FROM record ORDER BY seq").all() as { action: string; outcome: string; booking: string | null; conversation: string; entry: string }[]).map((r) => {
          const e = JSON.parse(r.entry) as { notes?: string; refs?: Record<string, string>; inputs?: unknown; decisions?: { ruleId: string; verdict: string }[] };
          return { action: r.action, outcome: r.outcome, booking: r.booking, conversation: r.conversation, notes: String(e.notes ?? ""), refs: e.refs ?? {}, inputs: e.inputs, decisions: e.decisions ?? [] };
        });
      } finally { db.close(); }
    },
    tasks() {
      const db = new DatabaseSync(join(dataDir, "agent.db"), { readOnly: true });
      try { return db.prepare("SELECT id, kind, state, attempts, last_error FROM tasks ORDER BY seq").all() as never; } finally { db.close(); }
    },
    writeLicence(licence) { const f = join(client, "licence.json"); writeFileSync(`${f}.tmp`, JSON.stringify(licence)); renameSync(`${f}.tmp`, f); },
  };
  return shop;
}

/** The shops a test file made, stopped and removed at its end. */
export function shops(): { boot(o?: ShopOptions): Promise<Shop>; all: Shop[] } {
  const all: Shop[] = [];
  return { all, async boot(o = {}) { const s = await makeShop(o); all.push(s); await s.start(); return s; } };
}

/** The owner asks for an order and approves its card with the typed code (guards mode): the order is then with the supplier. */
export async function orderAndApprove(s: Shop, request = "order 10 boxes of hair colour from Ravi Traders"): Promise<void> {
  await s.ownerSays(request);
  await s.ownerSays(`yes ${s.code()}`);
}
