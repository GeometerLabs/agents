// The demo's web server: plain node:http, memory only, no network calls out. It answers only devices on the local network,
// one world per browser session, and it is built to be started by tests as well as by demo/server.ts (nothing listens on import).
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { networkInterfaces } from "node:os";
import { settingsFromForm } from "./personalise.ts";
import { MAX_MESSAGE_LENGTH, createDemo } from "./session.ts";
import type { Demo, OwnerCommand } from "./session.ts";
import { renderPage } from "./page.ts";
import { buildState } from "./view.ts";
import type { Settings } from "../src/settings.ts";

export const MAX_BODY_BYTES = 16 * 1024;
const COOKIE = "geo_demo";
const IDLE_MS = 2 * 60 * 60 * 1000;

export interface DemoOptions {
  /** The shop the demo starts with. The shop form replaces it for everyone using this server. */
  settings: Settings;
  /** Addresses to listen on. Default: this computer's private (home or office network) addresses and 127.0.0.1, never 0.0.0.0. */
  hosts?: string[];
  /** 0 picks a free port. Default 8787. */
  port?: number;
  /** Where the fake clock starts for a new world. Default: the real now, so "tomorrow" is the real tomorrow. */
  nowMs?: number | (() => number);
  maxSessions?: number;
  /** Requests per second one device may make (it may burst to 4 times this). */
  ratePerSecond?: number;
}

export interface RunningDemo {
  port: number;
  urls: string[];
  skipped: string[];
  servers: Server[];
  sessionCount(): number;
  close(): Promise<void>;
}

// ---- who may connect ---------------------------------------------------------------------------------------------------

export function isPrivateIPv4(address: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

/** True for a device on this computer or on a private network. Anything routable from the internet is refused, even if a router forwards it. */
export function isLocalNetworkAddress(remote: string | undefined): boolean {
  if (!remote) return false;
  const address = remote.replace(/^::ffff:/i, "").toLowerCase();
  if (address === "::1" || address.startsWith("127.")) return true;
  if (/^f[cd][0-9a-f]{2}:/.test(address) || /^fe[89ab][0-9a-f]:/.test(address)) return true; // unique-local and link-local IPv6
  return isPrivateIPv4(address);
}

/** This computer's addresses on private networks (what a phone on the same Wi-Fi can reach). */
export function lanAddresses(): string[] {
  const found: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === "IPv4" && !a.internal && isPrivateIPv4(a.address)) found.push(a.address);
  }
  return found;
}

// A Host header must be an address or a .local name: a web page on the internet cannot talk to the demo by a name it controls.
const HOST_OK = /^(localhost|\[[0-9a-f:.]+\]|\d{1,3}(\.\d{1,3}){3}|[a-z0-9-]+(\.[a-z0-9-]+)*\.local)(:\d{1,5})?$/i;

// ---- small helpers -----------------------------------------------------------------------------------------------------

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

interface Session { id: string; demo: Demo; shopVersion: number; seen: number }

function send(res: ServerResponse, status: number, body: string, type: string, extra: Record<string, string> = {}): void {
  res.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "cross-origin-resource-policy": "same-origin",
    "x-frame-options": "DENY",
    ...extra,
  });
  res.end(body);
}
const sendJson = (res: ServerResponse, status: number, value: unknown, extra: Record<string, string> = {}) => send(res, status, JSON.stringify(value), "application/json; charset=utf-8", extra);

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"] ?? 0);
    if (declared > MAX_BODY_BYTES) { reject(new HttpError(413, "That request is too big for the demo.")); return; }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) { reject(new HttpError(413, "That request is too big for the demo.")); return; }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const cookieOf = (req: IncomingMessage): string | undefined =>
  req.headers.cookie?.split(";").map((p) => p.trim().split("=")).find(([k]) => k === COOKIE)?.[1];

// ---- the app -----------------------------------------------------------------------------------------------------------

export function createHandler(options: DemoOptions) {
  let shop = { settings: options.settings, version: 1 };
  const sessions = new Map<string, Session>();
  const maxSessions = options.maxSessions ?? 20;
  const rate = options.ratePerSecond ?? 10;
  const buckets = new Map<string, { tokens: number; at: number }>();
  const startMs = () => (typeof options.nowMs === "function" ? options.nowMs() : options.nowMs ?? Date.now());

  function allowRequest(who: string): boolean {
    const now = Date.now();
    if (buckets.size > 500) for (const [k, b] of buckets) if (now - b.at > 60_000) buckets.delete(k);
    const b = buckets.get(who) ?? { tokens: rate * 4, at: now };
    b.tokens = Math.min(rate * 4, b.tokens + ((now - b.at) / 1000) * rate);
    b.at = now;
    buckets.set(who, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  function sessionFor(req: IncomingMessage): { session: Session; created: boolean } {
    const now = Date.now();
    for (const [id, s] of sessions) if (now - s.seen > IDLE_MS) sessions.delete(id);
    const existing = sessions.get(cookieOf(req) ?? "");
    if (existing) {
      existing.seen = now;
      if (existing.shopVersion !== shop.version) { existing.demo = createDemo(shop.settings, startMs()); existing.shopVersion = shop.version; }
      return { session: existing, created: false };
    }
    if (sessions.size >= maxSessions) {
      const oldest = [...sessions.values()].sort((a, b) => a.seen - b.seen)[0];
      sessions.delete(oldest.id);
    }
    const session: Session = { id: randomBytes(16).toString("hex"), demo: createDemo(shop.settings, startMs()), shopVersion: shop.version, seen: now };
    sessions.set(session.id, session);
    return { session, created: true };
  }

  const text = (v: unknown, max: number): string =>
    typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "";

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!isLocalNetworkAddress(req.socket.remoteAddress)) throw new HttpError(403, "The demo only answers devices on your own network.");
    const host = req.headers.host ?? "";
    if (!HOST_OK.test(host)) throw new HttpError(403, "Open the demo by the address it printed, not by a name.");
    if (!allowRequest(req.socket.remoteAddress ?? "?")) throw new HttpError(429, "Slow down a little.");
    if ((req.url ?? "").length > 2000) throw new HttpError(414, "That address is too long.");
    const { pathname } = new URL(req.url ?? "/", "http://demo.local");

    if (req.method === "GET" && pathname === "/") {
      const nonce = randomBytes(16).toString("base64");
      send(res, 200, renderPage(nonce), "text/html; charset=utf-8", {
        "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      });
      return;
    }
    if (req.method === "GET" && pathname === "/favicon.ico") { res.writeHead(204).end(); return; }

    const isState = req.method === "GET" && pathname === "/api/state";
    const isAction = req.method === "POST" && pathname.startsWith("/api/");
    if (!isState && !isAction) throw new HttpError(req.method === "GET" || req.method === "POST" ? 404 : 405, "Nothing here.");

    let body: Record<string, unknown> = {};
    if (isAction) {
      const origin = req.headers.origin;
      if (origin !== undefined) {
        let originHost = "";
        try { originHost = new URL(origin).host.toLowerCase(); } catch { /* not a URL */ }
        if (originHost !== host.toLowerCase()) throw new HttpError(403, "This request came from another page.");
      }
      if (!/^application\/json\b/i.test(req.headers["content-type"] ?? "")) throw new HttpError(415, "Send JSON.");
      const raw = await readBody(req);
      try { body = raw === "" ? {} : JSON.parse(raw); } catch { throw new HttpError(400, "That was not valid JSON."); }
      if (typeof body !== "object" || body === null || Array.isArray(body)) throw new HttpError(400, "Send a JSON object.");
    }

    const { session, created } = sessionFor(req);
    const cookie = created ? { "set-cookie": `${COOKIE}=${session.id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${IDLE_MS / 1000}` } : {};
    if (isState) { sendJson(res, 200, buildState(session.demo), cookie); return; }

    // The actions. Each one runs after the ones before it in this session finish.
    let notice: string | undefined;
    switch (pathname) {
      case "/api/say": {
        const message = text(body.text, MAX_MESSAGE_LENGTH + 1);
        if (message === "") throw new HttpError(400, "Write a message first.");
        if (message.length > MAX_MESSAGE_LENGTH) throw new HttpError(400, `Keep it under ${MAX_MESSAGE_LENGTH} characters.`);
        notice = await session.demo.run(() => session.demo.say(message));
        break;
      }
      case "/api/pay": {
        if (body.times !== 1 && body.times !== 2) throw new HttpError(400, "Pay once or twice.");
        const times = body.times;
        notice = await session.demo.run(() => session.demo.pay(times));
        break;
      }
      case "/api/time": {
        if (body.minutes !== 15 && body.minutes !== 60 && body.minutes !== 1440) throw new HttpError(400, "Choose 15 minutes, 1 hour or 1 day.");
        const minutes = body.minutes;
        notice = await session.demo.run(() => session.demo.advance(minutes));
        break;
      }
      case "/api/cancel":
        notice = await session.demo.run(() => session.demo.cancel());
        break;
      case "/api/owner": {
        const command = body.command;
        const ref = text(body.ref, 12);
        if ((command !== "approve" && command !== "deny" && command !== "retry") || !/^b-\d{1,6}$/.test(ref)) throw new HttpError(400, "Choose approve, deny or retry for a booking.");
        notice = await session.demo.run(() => session.demo.owner(command as OwnerCommand, ref));
        break;
      }
      case "/api/reset":
        session.demo = createDemo(shop.settings, startMs());
        session.shopVersion = shop.version;
        break;
      case "/api/shop": {
        const result = settingsFromForm(body.form, shop.settings);
        if (!result.ok) { sendJson(res, 422, { errors: result.errors }, cookie); return; }
        shop = { settings: result.settings, version: shop.version + 1 };
        session.demo = createDemo(shop.settings, startMs());
        session.shopVersion = shop.version;
        notice = session.demo.ui.rebuilt;
        break;
      }
      default:
        throw new HttpError(404, "Nothing here.");
    }
    sendJson(res, 200, buildState(session.demo, notice), cookie);
  }

  return {
    handle: (req: IncomingMessage, res: ServerResponse) => {
      handle(req, res).catch((e: unknown) => {
        if (res.headersSent) { res.destroy(); return; }
        const status = e instanceof HttpError ? e.status : 500;
        if (status === 500) console.error("demo: unexpected error:", e);
        sendJson(res, status, { error: e instanceof HttpError ? e.message : "The demo hit a problem. Press Start again." }, status === 413 ? { connection: "close" } : {});
      });
    },
    sessionCount: () => sessions.size,
  };
}

// ---- listening ---------------------------------------------------------------------------------------------------------

export async function startDemo(options: DemoOptions): Promise<RunningDemo> {
  const app = createHandler(options);
  const wanted = options.hosts ?? [...lanAddresses(), "127.0.0.1"];
  const servers: Server[] = [];
  const skipped: string[] = [];
  let port = options.port ?? 8787;
  const urls: string[] = [];
  for (const host of wanted) {
    const server = createServer((req, res) => app.handle(req, res));
    server.requestTimeout = 15_000;
    server.headersTimeout = 10_000;
    server.keepAliveTimeout = 5_000;
    server.maxHeadersCount = 40;
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => { server.off("error", reject); resolve(); });
      });
    } catch (e) {
      skipped.push(`${host} (${(e as Error).message})`);
      continue;
    }
    port = (server.address() as { port: number }).port;
    servers.push(server);
    urls.push(`http://${host.includes(":") ? `[${host}]` : host}:${port}`);
  }
  if (servers.length === 0) throw new Error(`The demo could not start on any address: ${skipped.join("; ")}`);
  return {
    port, urls, skipped, servers,
    sessionCount: app.sessionCount,
    close: () => Promise.all(servers.map((s) => new Promise<void>((resolve) => { s.closeAllConnections(); s.close(() => resolve()); }))).then(() => undefined),
  };
}
