// The harness of the directory CONTRACT (see README.md in this folder). It writes the directory's config file as the deployer does (bundle/generate/configs.ts directoryConfig),
// starts the service as a SEPARATE PROCESS on a free port, and gives the tests an HTTP caller, fake shops that serve signed feeds and signed check answers, a fake "door" that
// stands in for the door's own port (so no test touches DNS or a private address), and a fake OpenAI-compatible model. The directory itself is only ever reached over HTTP, plus
// its two files read-only (directory.sqlite for what a person could not see over HTTP, and directory.key).
//
// The directory is the Go program (go/cmd/directory) named by DIRECTORY_GO_BIN (default <repo>/go/bin/directory); with no binary every test skips and says why (`SKIP`). Until
// 19 Nov 2026 DIRECTORY_IMPL=ts ran the TypeScript service the Go one replaced; it was deleted after its answers were recorded (golden/, differential.test.ts).
// Shops are signed with the TypeScript signing module (modules/signing), the one the TypeScript shops use; the search contract checks the directory's own signed card with an
// independent RFC 8785 reader, so a reader does not depend on the module it checks.
import type { ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnChild, stopChild } from "../../test/contract/children.ts";
import { generateSigningKey } from "../../signing/keys.ts";
import { signAnswer, signFeed, signNotice } from "../../signing/sign.ts";
import type { SigningKey } from "../../signing/keys.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const REPO = join(here, "..", "..", "..");
/** What runs: only the Go directory is left (the name stays so a recording says what made it). */
export const IMPL = "go" as const;
// The TypeScript directory is deleted: a run that asks for it must not pass quietly on Go (a log reading "DIRECTORY_IMPL=ts ... pass" would be a TypeScript pass that never ran).
if (process.env.DIRECTORY_IMPL !== undefined && process.env.DIRECTORY_IMPL !== "go") throw new Error(`DIRECTORY_IMPL=${process.env.DIRECTORY_IMPL}: only the Go directory is left (the TypeScript one was deleted on 19 Nov 2026); unset DIRECTORY_IMPL or set it to go`);
export const GO_BIN = process.env.DIRECTORY_GO_BIN ?? join(REPO, "go", "bin", "directory");
/** The pages domain the fake shops and the directory share. */
export const DOMAIN = "pages.example";
export const ORIGIN = `https://${DOMAIN}`;
/** Set (with the reason) when this run cannot happen: pass it as the test option `{ skip: SKIP }`. */
export const SKIP: string | false = !existsSync(GO_BIN) ? `there is no directory binary at ${GO_BIN} (build it: cd go && go build -o bin/directory ./cmd/directory)` : false;

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * The fake shops' clock: the machine's plus an offset. 0 except in the differential test, which replays answers recorded at an earlier instant: it sets the offset so the shops
 * stamp their feeds, check answers and notices at that instant's time, and starts the directory on the same clock (`clock: true`, the directory's test clock). Everything a page
 * says about time (the day the order turns on, "Confirmed today", a check answer "from just now") then comes out as it did when it was recorded.
 */
let offsetMs = 0;
export const now = (): number => Date.now() + offsetMs;
export const setClockOffset = (ms: number): void => { offsetMs = ms; };
/** Poll until `fn` gives a truthy value (or throw with `what` after `ms`). */
export async function until<T>(what: string, fn: () => T | Promise<T>, ms = 15_000): Promise<NonNullable<T>> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v as NonNullable<T>;
    if (Date.now() > end) throw new Error(`gave up waiting for ${what}`);
    await sleep(50);
  }
}

// ---- fake shops ----------------------------------------------------------------------------------------------------------------------------------------------

export interface Item {
  id: string; category: string; title: Record<string, string>; text: Record<string, string>; ownerLanguage: string; machineWritten: string[];
  price: { value: string; currency: "INR"; note?: string } | null; quantity?: number; photos: { url: string; type: string; width?: number; height?: number }[]; availability: string; confirmed: string; page: string;
}

/** What a check answer holds for one id. */
export interface Said { id: string; availability: "in_stock" | "call_to_check" | "gone"; price?: { value: string; currency: "INR"; note?: string } | null; quantity?: number; confirmed?: string }

export interface FakeShop {
  slug: string; page: string; feedUrl: string; key: SigningKey; name: string; town: string;
  items: Item[];
  /** Counters of what the directory asked. */
  hits: { feed: number; conditional: number; check: number; checkBodies: string[]; hosts: string[] };
  /** The next feed answer (default: the current feed, signed). Return a string for a body or an object for a whole answer. */
  feedAnswer?: (req: IncomingMessage) => string | { status: number; body?: string; headers?: Record<string, string> };
  /** What the check endpoint says: default every asked id in stock. Return `null` for "no answer in time", or a whole answer. */
  checkAnswer?: (ids: string[], at: string) => unknown | null | { status: number; body: string };
  /** The signed feed document (as an object) for the current items. */
  feed(over?: { updated?: string; name?: string; place?: Record<string, unknown>; shop?: Record<string, unknown>; items?: unknown[]; key?: SigningKey }): Record<string, unknown>;
  /** A signed notice for this shop's feed. */
  notice(over?: Record<string, unknown>, key?: SigningKey): Record<string, unknown>;
  /** Replace the shop's key (a shop that lost its folder). */
  rekey(): void;
}

/** One listing as a feed carries it. */
export function item(page: string, id: string, over: Partial<Item> = {}): Item {
  return {
    id, page: `${page}#${id}`, category: "pets",
    title: { en: "Persian kitten", hi: "फ़ारसी बिल्ली का बच्चा", ml: "പേർഷ്യൻ പൂച്ചക്കുട്ടി", kn: "ಪರ್ಷಿಯನ್ ಬೆಕ್ಕಿನ ಮರಿ" },
    text: { en: "Two kittens, vaccinated by the vet, from our own cat.", ml: "രണ്ട് പൂച്ചക്കുട്ടികൾ" },
    ownerLanguage: "ml", machineWritten: ["en", "hi", "kn"], price: { value: "8000.00", currency: "INR", note: "each" }, quantity: 2,
    photos: [{ url: `${page}photo/ph-9.jpg`, type: "image/jpeg", width: 1200, height: 900 }], availability: "in_stock", confirmed: new Date(now() - 3_600_000).toISOString(), ...over,
  };
}

export function fakeShop(slug: string, o: { name?: string; town?: string; lat?: string; lon?: string; items?: Item[] } = {}): FakeShop {
  const page = `${ORIGIN}/${slug}/`;
  const s: FakeShop = {
    slug, page, feedUrl: `${page}listings.json`, key: generateSigningKey(), name: o.name ?? slug, town: o.town ?? "Thrissur",
    items: o.items ?? [item(page, "l-3")], hits: { feed: 0, conditional: 0, check: 0, checkBodies: [], hosts: [] },
    feed(over = {}) {
      const place: Record<string, unknown> = { town: s.town, ...(o.lat ? { lat: o.lat, lon: o.lon ?? "76.214435" } : {}), ...over.place };
      return signFeed({
        format: "shop-feed/1", updated: over.updated ?? new Date(now() - 600_000).toISOString(),
        shop: { name: over.name ?? s.name, page, trade: "pet shop", languages: ["ml", "en"], place, chat: `${page}chat`, check: `${page}api/v1/check`, agentCard: `${page}agent-card.json`, ...over.shop },
        items: over.items ?? s.items,
      }, over.key ?? s.key) as unknown as Record<string, unknown>;
    },
    notice(over = {}, key = s.key) { return signNotice({ format: "shop-feed-changed/1", feed: s.feedUrl, updated: new Date(now()).toISOString(), ...over }, key) as unknown as Record<string, unknown>; },
    rekey() { s.key = generateSigningKey(); },
  };
  return s;
}

/** The fake door: the directory reaches every shop of the pages domain through this one server (Host header = the pages domain), as it reaches the real door's own port. */
export interface FakeDoor { port: number; shops: Map<string, FakeShop>; add(...s: FakeShop[]): void; close(): Promise<void> }

export async function startFakeDoor(...initial: FakeShop[]): Promise<FakeDoor> {
  const shops = new Map<string, FakeShop>();
  const door: FakeDoor = { port: 0, shops, add: (...s) => { for (const x of s) shops.set(x.slug, x); }, close: async () => undefined };
  door.add(...initial);
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const m = /^\/([a-z0-9-]+)\/(listings\.json|api\/v1\/check)$/u.exec((req.url ?? "").split("?")[0]);
      const shop = m ? shops.get(m[1]) : undefined;
      const send = (status: number, body: string, headers: Record<string, string> = {}): void => { res.writeHead(status, { "content-type": "application/json", ...headers }); res.end(body); };
      if (!m || !shop) return send(404, "{}");
      shop.hits.hosts.push(String(req.headers.host ?? ""));
      if (m[2] === "listings.json") {
        shop.hits.feed++;
        if (req.headers["if-none-match"]) shop.hits.conditional++;
        const a = shop.feedAnswer ? shop.feedAnswer(req) : JSON.stringify(shop.feed());
        if (typeof a === "string") return send(200, a, { etag: `"${a.length}-${a.slice(-12)}"` });
        return send(a.status, a.body ?? "", a.headers);
      }
      const body = Buffer.concat(chunks).toString("utf8");
      shop.hits.check++; shop.hits.checkBodies.push(body);
      let ids: string[] = [];
      try { ids = (JSON.parse(body) as { ids: string[] }).ids; } catch { /* a bad question */ }
      const at = new Date(now()).toISOString();
      const a = shop.checkAnswer ? shop.checkAnswer(ids, at) : signAnswer({ format: "shop-check/1", page: shop.page, at, items: ids.map((id) => ({ id, availability: "in_stock" })) }, shop.key);
      if (a === null) return; // never answered: the directory's timeout ends it
      if (a && typeof a === "object" && "status" in a && "body" in a) return send((a as { status: number }).status, (a as { body: string }).body);
      send(200, JSON.stringify(a));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  door.port = (server.address() as { port: number }).port;
  door.close = () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); });
  return door;
}

/** Sign a check answer for a shop (the harness's own helper, so a test can write a wrong one). */
export const answerFor = (shop: FakeShop, items: Said[], at = new Date(now()).toISOString(), key = shop.key): Record<string, unknown> =>
  signAnswer({ format: "shop-check/1", page: shop.page, at, items }, key) as unknown as Record<string, unknown>;

// ---- a fake OpenAI-compatible model --------------------------------------------------------------------------------------------------------------------------

export interface FakeModel {
  port: number; calls: number; requests: { url: string; authorization: string | undefined; body: any }[]; replies: unknown[]; mode: "ok" | "http500" | "refuse" | "cut" | "text" | "fence";
  /** When set, the answer to a call is chosen by the user message's text (what the directory sent), else `replies` in turn: so a test's answers do not depend on the order of calls. */
  replyFor?: (user: string) => unknown;
  close(): Promise<void>;
}

/** The typed search a good model gives back (assistant.ts TYPED_SEARCH_SCHEMA). */
export const typed = (o: Partial<{ words: string[]; words_en: string[]; category: string; place: string; town: string; radius_km: number | null; max_price: number | null }> = {}): Record<string, unknown> =>
  ({ words: [], words_en: [], category: "any", place: "none", town: "", radius_km: null, max_price: null, ...o });

/** The fake answers from `replies` in turn (the last repeats). `mode` makes it fail the ways a provider does. */
export async function startFakeModel(replies: unknown[] = [typed()]): Promise<FakeModel> {
  const fake: FakeModel = { port: 0, calls: 0, requests: [], replies, mode: "ok", close: async () => undefined };
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const n = fake.calls++;
      let body: any = {};
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* leave empty */ }
      fake.requests.push({ url: req.url ?? "", authorization: req.headers.authorization, body });
      if (fake.mode === "http500") { res.writeHead(500); return void res.end("{}"); }
      const answer = fake.replyFor ? fake.replyFor(String(body?.messages?.[1]?.content ?? "")) : fake.replies[Math.min(n, fake.replies.length - 1)];
      const text = fake.mode === "text" ? "I think you want a kitten." : fake.mode === "fence" ? `<think>hmm</think>\n\`\`\`json\n${JSON.stringify(answer)}\n\`\`\`` : typeof answer === "string" ? answer : JSON.stringify(answer);
      const message = fake.mode === "refuse" ? { role: "assistant", content: null, refusal: "no" } : { role: "assistant", content: text };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "fake", choices: [{ index: 0, finish_reason: fake.mode === "cut" ? "length" : "stop", message }], usage: { prompt_tokens: 100, completion_tokens: 50 } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  fake.port = (server.address() as { port: number }).port;
  fake.close = () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); });
  return fake;
}

// ---- the directory -------------------------------------------------------------------------------------------------------------------------------------------

export interface DirectoryOptions {
  door: FakeDoor;
  /** Feed addresses in the config (read at start; the service's `feeds`). */
  feeds?: string[];
  /** The buyer's assistant, as the deployer writes it: needs a fake model. `token` writes the credential file (default "agent-secret"); `null` names a file that is not there. */
  assistant?: { model: FakeModel; monthlyMicroInr?: number; dailyCalls?: number; perBuyerPerDay?: number; token?: string | null; modelName?: string; wire?: string };
  area?: string;
  /** How often the service reads the feeds that are due, in ms (the service's DIRECTORY_TICK_MS; default 200 here, 20 000 in service). */
  tickMs?: number;
  /** An existing data folder (to start again on it). */
  dataDir?: string;
  /** Run the directory on the fake shops' clock (`now()`, the machine's plus the offset): GEOMETER_TEST=1 and GEOMETER_TEST_CLOCK_FILE, the Go directory's test clock. */
  clock?: boolean;
}

export interface Directory {
  root: string; dataDir: string; port: number; base: string; configFile: string;
  /** GET or POST with a visitor address of its own (the last X-Forwarded-For entry), so the per-address limits of one test never meet another's. */
  call(path: string, o?: { method?: string; who?: string; headers?: Record<string, string>; body?: unknown; form?: Record<string, string>; raw?: string }): Promise<{ status: number; body: any; text: string; headers: Headers }>;
  /** A fresh visitor address. */
  visitor(): string;
  stop(): Promise<void>;
  start(): Promise<void>;
  log(): string;
  pid(): number | undefined;
  /** The index file, read only (a person's side: what is pinned, what is held, how each feed went). */
  db(): DatabaseSync;
  /** Mark a feed as never read (service stopped): it is then due at the next start. A test's way to a re-read inside the once-a-minute rule. */
  makeDue(url: string): void;
  /** The person's side: the service's own `changes` / `accept <page>` subcommands, run beside it as `docker exec` would. */
  cli(...args: string[]): Promise<{ code: number | null; out: string }>;
  /** Number of items and shops the directory holds (as its log line and /search say it): items with every shop's words. */
  searchJson(q: Record<string, string>, who?: string): Promise<{ status: number; body: any }>;
}

async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const port = (s.address() as { port: number }).port;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

let visitors = 0;
export async function makeDirectory(o: DirectoryOptions): Promise<Directory> {
  const root = mkdtempSync(join(tmpdir(), "directory-contract-"));
  const dataDir = o.dataDir ?? join(root, "data");
  mkdirSync(dataDir, { recursive: true });
  const configFile = join(root, "directory.json");
  const port = await freePort();
  const config: Record<string, unknown> = {
    origin: ORIGIN, served: [DOMAIN], doorUrl: `http://127.0.0.1:${o.door.port}`, dataDir, feeds: o.feeds ?? [], provider: { organization: "Geometer", url: ORIGIN }, ...(o.area ? { area: o.area } : {}),
  };
  if (o.assistant) {
    const a = o.assistant;
    const tokenFile = join(root, "agent_token");
    if (a.token !== null) writeFileSync(tokenFile, `${a.token ?? "agent-secret"}\n`);
    config.assistant = {
      monthlyMicroInr: a.monthlyMicroInr ?? 2_500_000_000, dailyCalls: a.dailyCalls ?? 1500, perBuyerPerDay: a.perBuyerPerDay ?? 12,
      model: { wire: a.wire ?? "openai", baseUrl: `http://127.0.0.1:${a.model.port}/v1`, model: a.modelName ?? "deepseek-ai/DeepSeek-V4.1-Flash" }, agentTokenFile: tokenFile,
    };
  }
  writeFileSync(configFile, JSON.stringify(config));
  let child: ChildProcess | undefined;
  let output = "";
  const base = `http://127.0.0.1:${port}`;
  const clockFile = join(root, "clock");
  if (o.clock) writeFileSync(clockFile, String(offsetMs));
  const env = (): Record<string, string | undefined> => ({
    ...process.env, CONFIG: configFile, PORT: String(port), HOST: "127.0.0.1", DIRECTORY_TICK_MS: String(o.tickMs ?? 200),
    ...(o.clock ? { GEOMETER_TEST: "1", GEOMETER_TEST_CLOCK_FILE: clockFile } : {}),
  });

  const d: Directory = {
    root, dataDir, port, base, configFile,
    visitor: () => `203.0.113.${(++visitors % 250) + 1}-${visitors}`,
    async call(path, c = {}) {
      const headers: Record<string, string> = { "x-forwarded-for": c.who ?? d.visitor(), ...(c.headers ?? {}) };
      let body: string | undefined;
      if (c.form) { headers["content-type"] = "application/x-www-form-urlencoded"; body = new URLSearchParams(c.form).toString(); } else if (c.body !== undefined) { headers["content-type"] = "application/json"; body = JSON.stringify(c.body); } else if (c.raw !== undefined) { body = c.raw; }
      const r = await fetch(`${base}${path}`, { method: c.method ?? (body !== undefined ? "POST" : "GET"), headers, ...(body !== undefined ? { body } : {}) });
      const text = await r.text();
      let parsed: any = null;
      try { parsed = JSON.parse(text); } catch { /* not JSON */ }
      return { status: r.status, body: parsed, text, headers: r.headers };
    },
    searchJson: async (q, who) => { const r = await d.call(`/search?${new URLSearchParams({ format: "json", ...q })}`, { who }); return { status: r.status, body: r.body }; },
    async start() {
      await stopChild(child);
      output = "";
      const c = spawnChild(GO_BIN, [], { env: env(), stdio: ["ignore", "pipe", "pipe"], cwd: REPO }, `the directory in ${root}`);
      child = c;
      c.stdout!.on("data", (x: Buffer) => { output += x.toString(); });
      c.stderr!.on("data", (x: Buffer) => { output += x.toString(); });
      try {
        for (let i = 0; ; i++) {
          if (c.exitCode !== null || c.signalCode !== null) throw new Error(`the directory exited early (${c.exitCode ?? c.signalCode}):\n${output}`);
          try { if ((await fetch(`${base}/healthz`)).status === 200) break; } catch { /* not listening yet */ }
          if (i > 200) throw new Error(`the directory did not answer /healthz in 10 s:\n${output}`);
          await sleep(50);
        }
      } catch (e) { await stopChild(c); child = undefined; throw e; }
    },
    async stop() { await stopChild(child); child = undefined; },
    log: () => output,
    pid: () => child?.pid,
    db: () => new DatabaseSync(join(dataDir, "directory.sqlite"), { readOnly: true }),
    makeDue(url) { const w = new DatabaseSync(join(dataDir, "directory.sqlite")); w.prepare("UPDATE feeds SET checked_at = NULL WHERE url = ?").run(url); w.close(); },
    async cli(...args) {
      const c = spawnChild(GO_BIN, args, { env: env(), stdio: ["ignore", "pipe", "pipe"], cwd: REPO }, `the directory's ${args[0]} command`);
      let out = "";
      c.stdout!.on("data", (x: Buffer) => { out += x.toString(); });
      c.stderr!.on("data", (x: Buffer) => { out += x.toString(); });
      const code = await new Promise<number | null>((r) => c.once("exit", (code) => r(code)));
      return { code, out };
    },
  };
  return d;
}

/** Start the directory on a fresh folder with these shops; wait until it has read every one of them. */
export async function directoryWith(shops: FakeShop[], o: Partial<DirectoryOptions> = {}): Promise<{ d: Directory; door: FakeDoor }> {
  const door = o.door ?? await startFakeDoor(...shops);
  const d = await makeDirectory({ ...o, door, feeds: o.feeds ?? shops.map((s) => s.feedUrl) });
  await d.start();
  for (const s of shops) await until(`the feed of ${s.slug} to be read`, () => d.db().prepare("SELECT checked_at FROM feeds WHERE url = ?").get(s.feedUrl) as { checked_at: number } | undefined, 15_000);
  return { d, door };
}

export const readKey = (dataDir: string): string => readFileSync(join(dataDir, "directory.key"), "utf8").trim();
