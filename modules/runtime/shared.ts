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
// A shop that fails to start (a folder half written, the wrong version, a bad file) is logged and skipped; the others run on. It is tried again when its files change.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { join } from "node:path";

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
export interface HeldShop { server: { port: number }; stop(): Promise<void> }

export interface SharedOptions {
  source: ShopSource;
  /** Start one shop with its own folder and tokens, listening on the loopback address on a port of its own. The template's `startClient`. */
  start(paths: ShopPaths, listen: { host: string; port: number }): Promise<HeldShop>;
  /** The address the front side listens on. 0.0.0.0 in the container (the door forwards to it); 127.0.0.1 by default. */
  host?: string;
  /** The front port (8780, the same as a single shop's runtime). 0: any free one. */
  port?: number;
  /** How often to look for new, changed and removed shops, in seconds (default 5). Folders are looked at, not watched: file watching on a bind mount is unreliable. */
  scanSeconds?: number;
  log?: (line: string) => void;
}

export interface ScanResult { started: string[]; restarted: string[]; letGo: string[]; failed: { shop: string; why: string }[] }

export interface SharedProcess {
  port: number;
  url: string;
  /** Look at the folders now: start what is new, restart what changed, let go of what is gone. Serialised: two calls never overlap. */
  scan(): Promise<ScanResult>;
  /** The shops held now, by name. */
  held(): string[];
  stop(): Promise<void>;
}

const MAX_SHOPS = 500;
const HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade", "host"]);

export async function startShared(o: SharedOptions): Promise<SharedProcess> {
  const log = o.log ?? (() => undefined);
  const heldShops = new Map<string, { fingerprint: string; shop: HeldShop }>();
  /** A shop that failed, with the fingerprint it failed at: not tried again until its files change, and said once. */
  const failedAt = new Map<string, string>();
  let queue: Promise<unknown> = Promise.resolve();

  async function letGo(name: string, why: string): Promise<void> {
    const h = heldShops.get(name);
    if (!h) return;
    heldShops.delete(name); // first: a request that arrives while the shop is stopping gets "nothing here", never a half-closed shop
    try { await h.shop.stop(); } catch (e) { log(`${name}: it did not stop cleanly (${(e as Error).message}).`); }
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
      if (!have && failedAt.get(name) === fingerprint) { result.failed.push({ shop: name, why: "failed before, files unchanged" }); continue; }
      if (!have && heldShops.size >= MAX_SHOPS) { result.failed.push({ shop: name, why: `this process holds at most ${MAX_SHOPS} shops` }); continue; }
      if (have) await letGo(name, "its files changed");
      try {
        const shop = await o.start(o.source.paths(name), { host: "127.0.0.1", port: 0 });
        heldShops.set(name, { fingerprint, shop });
        failedAt.delete(name);
        (have ? result.restarted : result.started).push(name);
        log(`${name}: ${have ? "restarted" : "started"} on its own port.`);
      } catch (e) {
        // one bad folder never stops the others
        const why = (e as Error).message.split("\n")[0];
        failedAt.set(name, fingerprint);
        result.failed.push({ shop: name, why });
        log(`${name}: it did not start (${why}); the other shops go on.`);
      }
    }
    return result;
  }
  const scan = (): Promise<ScanResult> => { const next = queue.then(scanOnce, scanOnce); queue = next.catch(() => undefined); return next; };

  const json = (res: ServerResponse, status: number, body: unknown): void => { res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); res.end(JSON.stringify(body)); };

  /** Pass the request to the shop's own server, byte for byte, with the shop's own credential still on it: the check is the shop's. */
  function forward(req: IncomingMessage, res: ServerResponse, name: string, rest: string, search: string): void {
    const h = heldShops.get(name);
    if (!h) return json(res, 404, { error: "There is nothing here." });
    const headers: Record<string, string | string[]> = {};
    for (const [k, v] of Object.entries(req.headers)) if (v !== undefined && !HOP.has(k)) headers[k] = v;
    headers.host = `127.0.0.1:${h.shop.server.port}`;
    const up = httpRequest({ host: "127.0.0.1", port: h.shop.server.port, method: req.method, path: `${rest}${search}`, headers }, (r) => {
      const out: Record<string, string | string[]> = {};
      for (const [k, v] of Object.entries(r.headers)) if (v !== undefined && !HOP.has(k)) out[k] = v;
      res.writeHead(r.statusCode ?? 502, out);
      r.pipe(res);
    });
    up.setTimeout(30_000, () => up.destroy(new Error("the shop did not answer in time")));
    up.on("error", () => { if (!res.headersSent) json(res, 502, { error: "The shop could not be reached just now." }); else res.destroy(); });
    req.on("aborted", () => up.destroy());
    req.pipe(up);
  }

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://shared");
    if (url.pathname === "/healthz" || url.pathname === "/readyz") return json(res, 200, { ok: true, shops: heldShops.size });
    if (url.pathname === "/shared/shops" && req.method === "GET") return json(res, 200, { shops: [...heldShops.keys()].sort() });
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

  await scan();
  const timer = setInterval(() => { void scan(); }, Math.max(1, o.scanSeconds ?? 5) * 1000);
  timer.unref();

  return {
    port, url: `http://${(o.host ?? "127.0.0.1").includes(":") ? `[${o.host}]` : (o.host ?? "127.0.0.1")}:${port}`,
    scan, held: () => [...heldShops.keys()].sort(),
    async stop() {
      clearInterval(timer);
      await queue.catch(() => undefined);
      await new Promise<void>((done) => { server.closeAllConnections(); server.close(() => done()); });
      await Promise.all([...heldShops.keys()].map((n) => letGo(n, "the process is stopping")));
    },
  };
}
