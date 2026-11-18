// ONE light process for MANY shops that only show what they have (listings-only shops, 18 Nov 2026). Each shop is exactly what a single shop's runtime is: its own folder,
// its own store file, its own tokens, its own owner sign-in file, its own HTTP server. This file only does three things around them, and keeps no shop's data itself:
//
//   1. it FINDS the shops (a folder per shop: `ShopSource`), starts each with the template's own `start` (so a shop run alone and a shop run here are the same code), and lets a
//      shop go when its folder goes or changes;
//   2. it ROUTES: one port in front, `/shop/<name>/<rest>` goes to that shop's own server, which listens on the loopback address only (a port the front never sees) and still
//      checks that shop's own tokens, so a request that reaches the wrong shop is refused by the wrong shop's token check, not by this router;
//   3. it answers `/healthz`, `/readyz` (the PROCESS is up; one shop that fails to start never makes the container unhealthy) and `/shared/shops` (the names it holds, for the
//      deployer to see a shop has been let go before it moves that shop's file: README.md in templates/commerce/listings, "Adding, changing and letting go").
//
//   inbox / front ──► door-listings (a forwarder on the admin network) ──► :8780  /shop/<name>/...   ┌─ shop a: own server 127.0.0.1:p1, own store, own tokens
//                                                                                                    ├─ shop b: own server 127.0.0.1:p2, own store, own tokens
//                                                                                                    └─ ...
//
// Why not a container per shop: a listings-only shop takes no money and sends no WhatsApp, so it has no Guard, and a container (with a forwarder and a network) is what a
// Guard needs, not what a page of listings needs. One container holds hundreds of these shops at a few MB each. What it costs is that the shops share a process, so the
// code keeps them apart by construction: nothing here is keyed by anything but the shop's own object (no module-level state in the runtime holds a shop's data: checked on
// 18 Nov, the only module-level caches are fonts and time formatters, the same for everyone), and the tests cross every credential from one shop to another.
//
// CRASH CONTAINMENT (18 Nov 2026; the worker pool 19 Nov 2026). Shops share one operating-system process, so one shop's failure must never become every shop's. Every per-shop path is contained:
//   - a request: each shop's own server catches a handler's error and answers 500 for that request alone (modules/runtime/http.ts);
//   - the clock: `runtime.tick()` never rejects (ticker.ts), and a step that throws is a failed task of that shop (core.ts);
//   - the start (opening the store, reading the folder): caught here, logged once, the shop skipped and tried again after a back-off;
//   - a shop that stays broken (its store cannot be read, its queue is wedged): its /readyz is looked at on every scan, and after FAILURES_TO_RESTART bad looks in a row THAT shop alone is
//     stopped and started again, after a back-off that doubles each time (BACKOFF_MS, up to MAX_BACKOFF_MS) and starts over when the shop has been well again;
//   - anything that still escapes every try (an unhandled rejection or exception): the process keeps running (a handler is installed, so Node does not exit), it is logged once, and the
//     shop it came from, found through the async context the shop was started in, is counted as a bad look and so restarted alone. If the shop cannot be told, it is logged and nothing else happens.
// What a try cannot catch is a shop that BLOCKS THE EVENT LOOP (an endless loop, a pathological regex, a huge synchronous job) or EXHAUSTS MEMORY. In one thread that takes every shop with it.
// With a `pool` the shops run in a small pool of WORKER THREADS instead (shared-pool.ts; the thread's side is shared-worker.ts), and that is contained too:
//   - each shop's own `start` runs INSIDE a worker, and its own HTTP server listens on the loopback address inside that worker, so the router here still forwards by port, exactly as before;
//     this thread keeps finding the shops, routing, /healthz, /readyz, /shared/shops and the supervision. K workers (SHARED_WORKERS, default 4); a new shop goes to the least loaded one;
//   - a worker has a memory limit (resourceLimits, SHARED_WORKER_MB, default 256): one that runs out exits, and only its shops are out while it is started again;
//   - a WATCHDOG pings every worker every 2 s; one silent for 10 s is blocked, and is terminate()d (which stops even a busy loop) and started again with its shops. Until then the other
//     workers, and this thread, answer as usual. Shops of the lost worker get a quick 503 with Retry-After, never a hang (a request to a shop's server also has a 10 s timeout);
//   - WHO WAS IT: a worker writes the shop whose code is running into a shared slot, which this thread can read while the worker is stuck. That shop gets a STRIKE; if the slot is empty,
//     every shop of that worker with a request in flight does. 2 strikes in 30 minutes move the shop to a worker of its own with half the memory (128 MB); 3 failures there in an hour
//     PAUSE it: its pages answer a friendly "back soon" page in the shop's language (the template gives it, `backSoon`), it is named in the log, in /readyz and in /shared/shops (`paused`),
//     and it is tried again after 6 hours, or at once when its files change. Every number is a named constant in shared-pool.ts with its reason.
// Why a pool and not a thread per shop: measured on Node 26, one thread that loads the listings start code and opens an HTTP server costs about 33 MB (and starts in about 0.17 s). Hundreds of
// always-on threads do not fit a 4 GB server; four to eight workers hold the same shops in a few hundred MB, and quarantine spends the extra thread only on a shop that has earned it.
// What is still not contained: a shop that is only SLOW (a long but finite synchronous stretch under 10 s) holds its worker's other shops up for that long and is not struck; and the sync
// parts of a shop's code that run outside any shop context are charged to every shop with a request in flight (Deferred).
//
// A shop that fails to start (a folder half written, the wrong version, a bad file) is logged and skipped; the others run on. It is tried again when its files change, and after a back-off.
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { join } from "node:path";
import { createPool } from "./shared-pool.ts";
import type { Pool, PoolOptions, PoolStatus } from "./shared-pool.ts";

/** A shop's name, as everywhere (fleet's page slugs, the compose names): lower case letters, digits and dashes. */
export const SHOP_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/u;
const SHOP_ROUTE = /^\/shop\/([a-z0-9][a-z0-9-]{0,39})(\/.*)?$/u;

/** Where one shop's files are. The tokens are FILES, passed to the shop's own start, never read from this process's environment (that would give every shop the same token). */
export interface ShopPaths { name: string; clientFolder: string; tokenFile: string; channelTokenFile: string; recordKeyFile: string }

/** Where the shops are, and when one is complete. The folder layout is one implementation (`folderSource`); a test gives its own. */
export interface ShopSource {
  list(): string[];
  paths(name: string): ShopPaths;
  /** Is the shop's folder complete (every file there)? The deployer writes pathway.lock LAST, so a folder with a lock is a folder whole. */
  ready(name: string): boolean;
  /** A short text that changes when the shop's files change: the shop is restarted on its own, the others untouched. */
  fingerprint(name: string): string;
}

/**
 * The folder layout the deployer writes: `<clients>/<shop>/client/{settings.json,runtime.json,pathway.lock,...}` (read-only here) and `<secrets>/<shop>/{internal_token,channel_token,
 * record_key}`. The shop's data folder is named in its runtime.json (`dataDir`), inside the shared data volume.
 */
export function folderSource(o: { clientsDir: string; secretsDir: string }): ShopSource {
  const paths = (name: string): ShopPaths => ({
    name, clientFolder: join(o.clientsDir, name, "client"), tokenFile: join(o.secretsDir, name, "internal_token"),
    channelTokenFile: join(o.secretsDir, name, "channel_token"), recordKeyFile: join(o.secretsDir, name, "record_key"),
  });
  const read = (file: string): string => { try { return readFileSync(file, "utf8"); } catch { return ""; } };
  return {
    list: () => { try { return readdirSync(o.clientsDir, { withFileTypes: true }).filter((e) => e.isDirectory() && SHOP_NAME.test(e.name)).map((e) => e.name).sort(); } catch { return []; } },
    paths,
    ready: (name) => { const p = paths(name); return [join(p.clientFolder, "settings.json"), join(p.clientFolder, "runtime.json"), join(p.clientFolder, "pathway.lock"), p.tokenFile, p.channelTokenFile, p.recordKeyFile].every((f) => existsSync(f)); },
    // only the three files that decide how the shop runs; pages.json, owner-grants.json and the like are read fresh by the shop on every request and need no restart
    fingerprint: (name) => createHash("sha256").update(["settings.json", "runtime.json", "pathway.lock"].map((f) => read(join(paths(name).clientFolder, f))).join("\u0000")).digest("hex").slice(0, 16),
  };
}

/** What the shared process needs of a started shop: the port of its own server, and a way to let it go (the step in hand finishes, the store is closed). */
export interface HeldShop {
  server: { port: number };
  stop(): Promise<void>;
  // The three below are set only by a shop that lives in a pool thread (shared-pool.ts); a shop started in this thread has none and is routed as before.
  /** Why this shop cannot be served just now: its thread is being started again, or it is paused ("back soon"). The port is not used then. */
  down?(): "restarting" | "paused" | undefined;
  /** A request to this shop begins; the function it returns is called when it ends. The pool counts requests in flight to name the culprit of a thread that dies with none running. */
  track?(): () => void;
  /** How long the router waits for this shop's own server (ms); the default is 30 000. A pooled shop gets less: a blocked thread must not hold a visitor. */
  timeoutMs?: number;
}

export interface SharedOptions {
  source: ShopSource;
  /** Start one shop with its own folder and tokens, listening on the loopback address on a port of its own. The template's `startClient`. It runs IN THIS THREAD: give `pool` instead to run shops in worker threads. */
  start?(paths: ShopPaths, listen: { host: string; port: number }): Promise<HeldShop>;
  /** Run the shops in a small pool of worker threads (shared-pool.ts), so a shop that blocks the loop or eats memory takes only its own thread's shops down, briefly. `startModule` is the template's start as a module. */
  pool?: PoolOptions;
  /** The page for a PAUSED shop (a shop that kept stopping its worker), in the shop's own language: the template gives it its words and look. Without it a plain JSON 503 is sent. */
  backSoon?(paths: ShopPaths, req: IncomingMessage): { html: string; json: unknown };
  /** The address the front side listens on. 0.0.0.0 in the container (the door forwards to it); 127.0.0.1 by default. */
  host?: string;
  /** The front port (8780, the same as a single shop's runtime). 0: any free one. */
  port?: number;
  /** How often to look for new, changed and removed shops, in seconds (default 5). Folders are looked at, not watched: file watching on a bind mount is unreliable. */
  scanSeconds?: number;
  log?: (line: string) => void;
  /** Is this shop answering "ready" on its own port? Default: GET /readyz on the loopback address. A seam for tests. */
  probe?(port: number): Promise<boolean>;
  /** The first back-off before a broken shop is started again (default 5000 ms); it doubles each time up to MAX_BACKOFF_MS. */
  backoffMs?: number;
  /** The clock, for the back-off (default Date.now). */
  now?: () => number;
}

export interface ScanResult { started: string[]; restarted: string[]; letGo: string[]; failed: { shop: string; why: string }[] }

export interface SharedProcess {
  port: number;
  url: string;
  /** Look at the folders now: start what is new, restart what changed, let go of what is gone. Serialised: two calls never overlap. */
  scan(): Promise<ScanResult>;
  /** The shops held now, by name. */
  held(): string[];
  /** The pool's threads, the shops in quarantine and the shops paused (empty without a pool). */
  pool(): PoolStatus;
  stop(): Promise<void>;
}

const MAX_SHOPS = 500;
const FAILURES_TO_RESTART = 3;
const MAX_BACKOFF_MS = 5 * 60_000;

/** The shop a piece of async work belongs to: set where a shop is started, and carried by Node through the timers, sockets and promises that shop makes. */
const whose = new AsyncLocalStorage<string>();
const readyProbe = async (port: number): Promise<boolean> => {
  try { return (await fetch(`http://127.0.0.1:${port}/readyz`, { signal: AbortSignal.timeout(2000) })).status === 200; } catch { return false; }
};
const HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade", "host"]);

export async function startShared(o: SharedOptions): Promise<SharedProcess> {
  const log = o.log ?? (() => undefined);
  const heldShops = new Map<string, { fingerprint: string; shop: HeldShop }>();
  /** Shops that are stopping: no longer served, but their store is open until `stop()` finishes, so they are still NAMED by /shared/shops (a deployer must not copy a file that is open). */
  const closing = new Set<string>();
  /** A shop that failed, with the fingerprint it failed at: not tried again until its files change, and said once. */
  const failedAt = new Map<string, string>();
  const now = o.now ?? Date.now;
  const probe = o.probe ?? readyProbe;
  /** Bad looks in a row, per held shop. */
  const bad = new Map<string, number>();
  /** After a failure: how many in a row, and when the shop may be started again. */
  const backoff = new Map<string, { n: number; notBefore: number }>();
  const hurt = (name: string, why: string): void => {
    const b = backoff.get(name) ?? { n: 0, notBefore: 0 };
    const n = b.n + 1;
    backoff.set(name, { n, notBefore: now() + Math.min(MAX_BACKOFF_MS, (o.backoffMs ?? 5000) * 2 ** (n - 1)) });
    log(`${name}: ${why}; it will be tried again after a pause (the other shops go on).`);
  };
  let queue: Promise<unknown> = Promise.resolve();
  if (!o.start && !o.pool) throw new Error("startShared needs `start` (shops in this thread) or `pool` (shops in worker threads).");
  const pool: Pool | undefined = o.pool ? createPool(o.pool, {
    now, log,
    // a throw nothing caught, inside a pool thread: one bad look for that shop, as for a shop in this thread (see `contain` below)
    bad: (name) => { if (heldShops.has(name)) bad.set(name, (bad.get(name) ?? 0) + 1); },
    // a shop that could not be started again after its thread was: let go, and the scan starts it again after the usual back-off
    lost: (name, why) => { queue = queue.then(async () => { await letGo(name, why); hurt(name, why); }).catch(() => undefined); },
  }) : undefined;

  async function letGo(name: string, why: string): Promise<void> {
    const h = heldShops.get(name);
    if (!h) return;
    bad.delete(name);
    heldShops.delete(name); // first: a request that arrives while the shop is stopping gets "nothing here", never a half-closed shop
    closing.add(name);
    try { await h.shop.stop(); } catch (e) { log(`${name}: it did not stop cleanly (${(e as Error).message}).`); } finally { closing.delete(name); }
    log(`${name}: let go (${why}).`);
  }

  async function scanOnce(): Promise<ScanResult> {
    const result: ScanResult = { started: [], restarted: [], letGo: [], failed: [] };
    const wanted = new Set(o.source.list().filter((n) => SHOP_NAME.test(n) && o.source.ready(n)));
    for (const name of [...heldShops.keys()]) if (!wanted.has(name)) { await letGo(name, "its folder is gone or not whole"); result.letGo.push(name); }
    for (const name of [...failedAt.keys()]) if (!wanted.has(name)) failedAt.delete(name);
    for (const name of wanted) {
      const fingerprint = o.source.fingerprint(name);
      const have = heldShops.get(name);
      if (have && have.fingerprint === fingerprint) continue;
      const wait = backoff.get(name);
      if (!have && wait && now() < wait.notBefore) { result.failed.push({ shop: name, why: "waiting to be tried again" }); continue; }
      if (!have && heldShops.size >= MAX_SHOPS) { result.failed.push({ shop: name, why: `this process holds at most ${MAX_SHOPS} shops` }); continue; }
      if (have) await letGo(name, "its files changed");
      try {
        const shop = await whose.run(name, () => pool ? pool.start(o.source.paths(name), fingerprint) : o.start!(o.source.paths(name), { host: "127.0.0.1", port: 0 }));
        heldShops.set(name, { fingerprint, shop });
        failedAt.delete(name);
        (have ? result.restarted : result.started).push(name);
        log(`${name}: ${have ? "restarted" : "started"} on its own port.`);
      } catch (e) {
        // one bad folder never stops the others
        const why = (e as Error).message.split("\n")[0];
        if (failedAt.get(name) !== fingerprint) backoff.delete(name); // changed files: a fresh count
        failedAt.set(name, fingerprint);
        result.failed.push({ shop: name, why });
        hurt(name, `it did not start (${why})`);
      }
    }
    // a shop that is held but not well: looked at on every scan; three bad looks in a row and THAT shop is stopped (the next scan starts it again, after its back-off)
    for (const name of [...heldShops.keys()]) {
      const h = heldShops.get(name)!;
      if (h.shop.down?.()) { bad.delete(name); continue; } // its thread is starting again, or it is paused: the pool is looking after it, and a probe would only find nothing
      if (await probe(h.shop.server.port)) { bad.delete(name); if (backoff.has(name) && !failedAt.has(name)) backoff.delete(name); continue; }
      const n = (bad.get(name) ?? 0) + 1;
      bad.set(name, n);
      if (n < FAILURES_TO_RESTART) continue;
      await letGo(name, "it has not been ready for several looks");
      result.letGo.push(name);
      hurt(name, "it was not ready");
    }
    return result;
  }
  const scan = (): Promise<ScanResult> => { const next = queue.then(scanOnce, scanOnce); queue = next.catch(() => undefined); return next; };

  const json = (res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void => { res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra }); res.end(JSON.stringify(body)); };
  /** A paused shop's pages: the template's "back soon" page (html when the visitor asks for a page, json for the front's own calls), 503, Retry-After an hour so nothing hammers it, and `x-back-soon` so the front (backend.ts BackendError.backSoon) can say it in the visitor's language. */
  function backSoon(req: IncomingMessage, res: ServerResponse, name: string): void {
    const page = o.backSoon?.(o.source.paths(name), req);
    if (!page) return json(res, 503, { error: "This shop is paused for a while. Please come back later." }, { "retry-after": "3600", "x-back-soon": "1" });
    if ((req.headers.accept ?? "").includes("text/html")) { res.writeHead(503, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "retry-after": "3600", "x-back-soon": "1" }); res.end(page.html); return; }
    json(res, 503, page.json, { "retry-after": "3600", "x-back-soon": "1" });
  }

  /** Pass the request to the shop's own server, byte for byte, with the shop's own credential still on it: the check is the shop's. */
  function forward(req: IncomingMessage, res: ServerResponse, name: string, rest: string, search: string): void {
    const h = heldShops.get(name);
    if (!h) return json(res, 404, { error: "There is nothing here." });
    // a shop whose thread is being started again: a quick 503 with Retry-After, never a wait for a port that is not there
    const down = h.shop.down?.();
    if (down === "paused") return backSoon(req, res, name);
    if (down) return json(res, 503, { error: "This shop is starting again. Please try in a moment." }, { "retry-after": "2" });
    const done = h.shop.track?.();
    if (done) { res.on("close", done); }
    const headers: Record<string, string | string[]> = {};
    for (const [k, v] of Object.entries(req.headers)) if (v !== undefined && !HOP.has(k)) headers[k] = v;
    headers.host = `127.0.0.1:${h.shop.server.port}`;
    const up = httpRequest({ host: "127.0.0.1", port: h.shop.server.port, method: req.method, path: `${rest}${search}`, headers }, (r) => {
      const out: Record<string, string | string[]> = {};
      for (const [k, v] of Object.entries(r.headers)) if (v !== undefined && !HOP.has(k)) out[k] = v;
      res.writeHead(r.statusCode ?? 502, out);
      r.pipe(res);
    });
    up.setTimeout(h.shop.timeoutMs ?? 30_000, () => up.destroy(new Error("the shop did not answer in time")));
    // a pooled shop that cannot be reached is almost always its thread being stopped and started again: tell the visitor to come back in a moment
    up.on("error", () => { if (!res.headersSent) { if (h.shop.timeoutMs) json(res, 503, { error: "This shop is busy. Please try in a moment." }, { "retry-after": "2" }); else json(res, 502, { error: "The shop could not be reached just now." }); } else res.destroy(); });
    req.on("aborted", () => up.destroy());
    req.pipe(up);
  }

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://shared");
    // paused/quarantined: the one place the Operator (and the deployer's checks) can see a shop that keeps hurting its worker; the process itself stays healthy
    if (url.pathname === "/healthz" || url.pathname === "/readyz") { const st = pool?.status(); return json(res, 200, { ok: true, shops: heldShops.size, ...(st ? { paused: st.paused, quarantined: st.quarantined } : {}) }); }
    if (url.pathname === "/shared/shops" && req.method === "GET") return json(res, 200, { shops: [...new Set([...heldShops.keys(), ...closing])].sort(), ...(pool ? { paused: pool.status().paused, pausedDetail: pool.status().pausedDetail } : {}) });
    const m = SHOP_ROUTE.exec(url.pathname);
    if (m) return forward(req, res, m[1], m[2] ?? "/", url.search);
    json(res, 404, { error: "There is nothing here." });
  });
  server.requestTimeout = 60_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 40;
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(o.port ?? 8780, o.host ?? "127.0.0.1", () => resolve()); });
  const port = (server.address() as { port: number }).port;

  // what escapes every try: kept off the process's back, said once, and charged to the shop it came from when that can be told
  const said = new Set<string>();
  const contain = (kind: string) => (e: unknown): void => {
    const shop = whose.getStore();
    const line = `${shop ?? "(no shop)"}: ${kind}: ${(e as Error)?.message ?? String(e)}`;
    if (!said.has(line)) { said.add(line); log(line.split("\n")[0]); }
    if (shop && heldShops.has(shop)) bad.set(shop, (bad.get(shop) ?? 0) + 1);
  };
  const onRejection = contain("an unhandled rejection");
  const onException = contain("an uncaught exception");
  process.on("unhandledRejection", onRejection);
  process.on("uncaughtException", onException);

  await scan();
  const timer = setInterval(() => { void scan(); }, Math.max(1, o.scanSeconds ?? 5) * 1000);
  timer.unref();

  return {
    port, url: `http://${(o.host ?? "127.0.0.1").includes(":") ? `[${o.host}]` : (o.host ?? "127.0.0.1")}:${port}`,
    scan, held: () => [...new Set([...heldShops.keys(), ...closing])].sort(),
    pool: () => pool?.status() ?? { workers: [], quarantined: [], paused: [], pausedDetail: [] },
    async stop() {
      clearInterval(timer);
      process.off("unhandledRejection", onRejection);
      process.off("uncaughtException", onException);
      await queue.catch(() => undefined);
      await new Promise<void>((done) => { server.closeAllConnections(); server.close(() => done()); });
      await Promise.all([...heldShops.keys()].map((n) => letGo(n, "the process is stopping")));
      await pool?.close();
    },
  };
}
