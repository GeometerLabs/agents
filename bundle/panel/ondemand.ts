// The panel that starts when it is used and sleeps when it is not. An Operator opens the panel for minutes a day, but the full panel (every page, the sign-in and
// setup code, the words in four languages) held about 170 MB all day. This file is the small part that is always there: it opens the panel's port, answers the
// health check itself, and loads the full panel (server.ts, with a dynamic import) when the first real request comes. After PANEL_IDLE_MINUTES (15) with no
// request it finishes the requests in flight, then exits cleanly; the container's restart policy (unless-stopped, bundle/generate/compose.ts) starts it again, asleep.
//
// Nothing is lost by the exit: a sign-in is a signed cookie (the key is a file or derived from the data key), accounts, invitations, drafts and half-done setups are
// files in the panel's data folder, and the owner's passkeys are the shops' runtimes' (not the panel's). The one thing in memory is the sign-in limiter's failure
// counts (ratelimit.ts); it counts over 15 minutes, so the panel never sleeps for less than that and a sleep forgets nothing a person could still be held to.
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { PanelConfig } from "./config.ts";
import { LOGIN_WINDOW_MS } from "./ratelimit.ts";

/** The function that answers one request (server.ts panelHandler). */
export type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

/** The panel's http server with its timeouts: one place for the woken panel (server.ts startPanel) and the launcher below. */
export function panelServer(handler: Handler): Server {
  const server = createServer((req, res) => { void handler(req, res); });
  server.requestTimeout = 15_000; server.headersTimeout = 10_000; server.keepAliveTimeout = 5_000; server.maxHeadersCount = 60;
  return server;
}

export interface OnDemandOptions {
  /** Loads the full panel and returns its request handler. Left out: server.ts's panelHandler (tests pass a counter or a stand-in). */
  load?: (config: PanelConfig) => Promise<Handler>;
  /** Milliseconds of no request before sleeping. Left out: PANEL_IDLE_MINUTES (15), never under the sign-in limiter's window; 0 minutes: never. Tests set it short. */
  idleMs?: number;
  /** What to do when it is time to sleep, after every request is done and the port is closed. Left out: exit the process with 0. */
  exit?: () => void;
  log?: (line: string) => void;
}
export interface OnDemandPanel { host: string; port: number; url: string; awake(): boolean; close(): Promise<void> }

const idleMsOf = (config: PanelConfig): number => {
  const minutes = config.idleMinutes ?? 15;
  return minutes === 0 ? 0 : Math.max(minutes * 60_000, LOGIN_WINDOW_MS);
};

/** Opens the port asleep. `/healthz` is answered here (and never counts as use, or the container's own check every 10 seconds would keep the panel awake). */
export async function startOnDemand(config: PanelConfig, o: OnDemandOptions = {}): Promise<OnDemandPanel> {
  const log = o.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  const load = o.load ?? (async (c: PanelConfig) => (await import("./server.ts")).panelHandler(c));
  const idleMs = o.idleMs ?? idleMsOf(config);
  let handler: Handler | undefined;
  let loading: Promise<Handler> | undefined;
  let active = 0;
  let lastUse = Date.now();
  let timer: NodeJS.Timeout | undefined;
  let sleeping = false;

  // the first real request loads the panel; the ones that arrive while it loads wait for the same load; a failed load is tried again by the next request
  const wake = (): Promise<Handler> => {
    if (handler) return Promise.resolve(handler);
    loading ??= load(config).then((h) => { handler = h; log("panel woke: the full panel is loaded"); return h; }, (e: unknown) => { loading = undefined; throw e; });
    return loading;
  };

  const server = panelServer(async (req, res) => {
    if (req.method === "GET" && /^\/healthz(?:\?|$)/u.test(req.url ?? "")) { res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }).end("ok\n"); return; }
    active += 1;
    res.once("close", () => { active -= 1; lastUse = Date.now(); });
    try { await (await wake())(req, res); } catch (e) {
      // a broken data key or folder: say so in the log (the name and the first words only, as the panel does) and tell the person to try again
      log(`could not load the panel: ${(e as Error).name}: ${String((e as Error).message).slice(0, 120).replace(/\s+/gu, " ")}`);
      if (!res.headersSent) res.writeHead(503, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "retry-after": "5" });
      res.end("The panel could not start. Try again in a moment.\n");
    }
  });

  // one timer, re-armed for the time left: asleep when nothing has been asked for `idleMs` and no request is in flight
  const arm = (ms: number) => { timer = setTimeout(check, ms); timer.unref?.(); };
  const check = () => {
    const quiet = Date.now() - lastUse;
    if (active > 0 || quiet < idleMs) { arm(active > 0 ? idleMs : idleMs - quiet); return; }
    void sleep();
  };
  const sleep = async () => {
    if (sleeping) return;
    sleeping = true;
    log(`panel sleeping after ${Math.round(idleMs / 60_000)} minutes with no request`);
    server.close(() => { (o.exit ?? (() => process.exit(0)))(); }); // stops taking new connections; the callback runs when every request in flight is done
    server.closeIdleConnections();
  };

  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(config.port, config.host, resolve); });
  if (idleMs > 0) { timer = undefined; arm(idleMs); }
  const port = (server.address() as { port: number }).port;
  return {
    host: config.host, port, url: `http://${config.host.includes(":") ? `[${config.host}]` : config.host}:${port}`,
    awake: () => handler !== undefined,
    close: () => new Promise<void>((done) => { if (timer) clearTimeout(timer); server.closeAllConnections(); server.close(() => done()); }),
  };
}
