// DEV FORWARDER, NOT GUARD. For the Phase 0 prototype only: to try the live adapters against REAL TEST-MODE services (Razorpay test mode,
// a WhatsApp provider's sandbox, a test Google Calendar) before Guard is configured. It reads keys from a local .env (git ignores it), adds
// the credential, and passes each call on to the real host. It has NO limits, NO approvals and NO record: that is what Guard is for.
//
//   node templates/commerce/bookings/standins/dev-forwarder.ts [--port 8791] [--env path/to/.env]
//
// The adapters' base URLs are then  http://127.0.0.1:8791/razorpay ,  .../google  and  .../whatsapp  (it routes by that first path part
// and sends the rest on unchanged). It listens on 127.0.0.1 only, replaces any Authorization header a caller sends, and never prints a key.
// It refuses to start with a Razorpay key that does not start with rzp_test_, or with any rzp_live_ value anywhere in the .env.
// Google: a ready-made access token goes in the .env for now; it lasts about an hour. Refreshing it is a later piece that sits beside Guard.
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { existsSync, readFileSync } from "node:fs";

export const BANNER = "Dev forwarder, not Guard: no limits, no record. Test mode only.";

export interface DevForwarderConfig {
  razorpay?: { keyId: string; keySecret: string; baseUrl?: string };
  google?: { accessToken: string; baseUrl?: string };
  whatsapp?: { accessToken: string; baseUrl?: string; /** Default "Authorization" (sent as "Bearer <token>"); a provider that wants its own header, like 360dialog's D360-API-KEY, names it here and gets the bare token. */ headerName?: string };
  /** One line per call, with no key or body in it. Default: standard error. */
  log?: (line: string) => void;
}

export const DEFAULT_UPSTREAMS = { razorpay: "https://api.razorpay.com", google: "https://www.googleapis.com", whatsapp: "https://graph.facebook.com" } as const;

// ---- reading the .env -----------------------------------------------------------------------------------------------------

/** KEY=value lines; blank lines and # comments are skipped; one pair of quotes around a value, and a leading "export ", are dropped. */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    if (/^(['"]).*\1$/u.test(value)) value = value.slice(1, -1);
    out[m[1]] = value;
  }
  return out;
}

/** The forwarder's settings from the .env's pairs. Throws a plain sentence (never a key) when the setup is not safe or not usable. */
export function configFromEnv(env: Record<string, string>): DevForwarderConfig {
  for (const [name, value] of Object.entries(env)) {
    if (/rzp_live_/u.test(value)) throw new Error(`${name} holds a LIVE Razorpay key (rzp_live_...). The dev forwarder is for test mode only, so it will not start.`);
  }
  const config: DevForwarderConfig = {};
  const id = env.RAZORPAY_KEY_ID;
  const secret = env.RAZORPAY_KEY_SECRET;
  if (id || secret) {
    if (!id?.startsWith("rzp_test_")) throw new Error("RAZORPAY_KEY_ID must be a test key (it must start with rzp_test_). The dev forwarder is for test mode only, so it will not start.");
    if (!secret) throw new Error("RAZORPAY_KEY_SECRET is missing next to RAZORPAY_KEY_ID.");
    config.razorpay = { keyId: id, keySecret: secret, ...(env.RAZORPAY_BASE_URL ? { baseUrl: env.RAZORPAY_BASE_URL } : {}) };
  }
  if (env.GOOGLE_ACCESS_TOKEN) config.google = { accessToken: env.GOOGLE_ACCESS_TOKEN, ...(env.GOOGLE_BASE_URL ? { baseUrl: env.GOOGLE_BASE_URL } : {}) };
  if (env.WHATSAPP_ACCESS_TOKEN) config.whatsapp = { accessToken: env.WHATSAPP_ACCESS_TOKEN, ...(env.WHATSAPP_BASE_URL ? { baseUrl: env.WHATSAPP_BASE_URL } : {}), ...(env.WHATSAPP_AUTH_HEADER ? { headerName: env.WHATSAPP_AUTH_HEADER } : {}) };
  if (!config.razorpay && !config.google && !config.whatsapp) throw new Error("Nothing is set up. Copy .env.example to .env at the repository root and fill in at least one service.");
  for (const [service, c] of Object.entries(config)) {
    if (service === "log") continue;
    const base = (c as { baseUrl?: string }).baseUrl;
    if (base) { try { const u = new URL(base); if (u.username || u.password) throw new Error("x"); } catch { throw new Error(`The base URL for ${service} is not a plain web address.`); } }
  }
  return config;
}

// ---- the proxy ------------------------------------------------------------------------------------------------------------

const MAX_BODY = 1024 * 1024;
const DROP_FROM_CALLER = new Set(["authorization", "proxy-authorization", "host", "connection", "content-length", "accept-encoding", "transfer-encoding", "cookie"]);

export interface RunningDevForwarder { server: Server; port: number; url: string; close(): Promise<void> }

export async function startDevForwarder(config: DevForwarderConfig, listen: { port: number }): Promise<RunningDevForwarder> {
  const log = config.log ?? ((line: string) => console.error(line));
  const routes: Record<string, { base: string; credential: [string, string] } | undefined> = {
    razorpay: config.razorpay && { base: config.razorpay.baseUrl ?? DEFAULT_UPSTREAMS.razorpay, credential: ["authorization", `Basic ${Buffer.from(`${config.razorpay.keyId}:${config.razorpay.keySecret}`).toString("base64")}`] },
    google: config.google && { base: config.google.baseUrl ?? DEFAULT_UPSTREAMS.google, credential: ["authorization", `Bearer ${config.google.accessToken}`] },
    whatsapp: config.whatsapp && {
      base: config.whatsapp.baseUrl ?? DEFAULT_UPSTREAMS.whatsapp,
      credential: (config.whatsapp.headerName ?? "authorization").toLowerCase() === "authorization" ? ["authorization", `Bearer ${config.whatsapp.accessToken}`] : [config.whatsapp.headerName!.toLowerCase(), config.whatsapp.accessToken],
    },
  };

  const reply = (res: ServerResponse, status: number, body: unknown) => {
    const text = JSON.stringify(body);
    res.writeHead(status, { "content-type": "application/json", "x-geometer-dev-forwarder": "not-guard" });
    res.end(text);
  };

  const readBody = (req: IncomingMessage) => new Promise<Buffer | null>((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => { size += c.length; if (size > MAX_BODY) { resolve(null); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", () => resolve(null));
  });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://forwarder");
    const m = /^\/(razorpay|google|whatsapp)(\/.*)?$/u.exec(url.pathname);
    if (!m) { reply(res, 404, { error: "Use /razorpay/..., /google/... or /whatsapp/..." }); return; }
    const route = routes[m[1]];
    if (!route) { reply(res, 503, { error: `The dev forwarder has no credentials for ${m[1]}; add them to the .env and start it again.` }); return; }
    const body = await readBody(req);
    if (body === null) { reply(res, 413, { error: "request too large" }); return; }
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string" && !DROP_FROM_CALLER.has(k)) headers[k] = v;
    headers[route.credential[0]] = route.credential[1];
    const target = route.base.replace(/\/+$/u, "") + (m[2] ?? "/") + url.search;
    try {
      const upstream = await fetch(target, { method: req.method, headers, body: ["GET", "HEAD"].includes(req.method ?? "GET") || body.length === 0 ? undefined : new Uint8Array(body), signal: AbortSignal.timeout(30_000), redirect: "manual" });
      const payload = Buffer.from(await upstream.arrayBuffer());
      res.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") ?? "application/json", "x-geometer-dev-forwarder": "not-guard" });
      res.end(payload);
      log(`${req.method} /${m[1]}${m[2] ?? "/"} -> ${upstream.status}`);
    } catch (e) {
      const timedOut = (e as Error).name === "TimeoutError";
      reply(res, timedOut ? 504 : 502, { error: timedOut ? "the real service did not answer in 30 seconds" : "could not reach the real service" });
      log(`${req.method} /${m[1]}${m[2] ?? "/"} -> ${timedOut ? "timed out" : "unreachable"}`);
    }
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(listen.port, "127.0.0.1", resolve); });
  const port = (server.address() as { port: number }).port;
  return { server, port, url: `http://127.0.0.1:${port}`, close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }) };
}

// ---- as a program ---------------------------------------------------------------------------------------------------------

if (import.meta.main) {
  const args = process.argv.slice(2);
  const option = (name: string): string | undefined => {
    const i = args.indexOf(`--${name}`);
    if (i === -1) return undefined;
    const v = args[i + 1];
    if (v === undefined || v.startsWith("--")) { console.error(`--${name} needs a value.`); process.exit(2); }
    return v;
  };
  for (const a of args.filter((x) => x.startsWith("--"))) if (!["--port", "--env", "--help"].includes(a)) { console.error(`I don't know ${a}. Use --port or --env.`); process.exit(2); }
  if (args.includes("--help")) { console.log("Usage: node templates/commerce/bookings/standins/dev-forwarder.ts [--port 8791] [--env path/to/.env]"); process.exit(0); }

  const envPath = option("env") ?? new URL("../../../../.env", import.meta.url).pathname; // the repository root
  if (!existsSync(envPath)) { console.error(`There is no .env at ${envPath}. Copy .env.example to .env and fill it in.`); process.exit(2); }
  const port = Number(option("port") ?? 8791);
  if (!Number.isInteger(port) || port < 0 || port > 65535) { console.error("--port must be a whole number between 0 and 65535."); process.exit(2); }

  let config: DevForwarderConfig;
  const env = parseEnv(readFileSync(envPath, "utf8"));
  try { config = configFromEnv(env); } catch (e) { console.error((e as Error).message); process.exit(2); }

  const rule = "=".repeat(BANNER.length + 8);
  console.error(`\n${rule}\n==  ${BANNER}  ==\n${rule}\n`);
  const running = await startDevForwarder(config, { port });
  console.error(`Listening on ${running.url} (this computer only). Use these as the adapters' base URLs:`);
  if (config.razorpay) console.error(`  payments:  ${running.url}/razorpay   (Razorpay test mode)`);
  if (config.google) console.error(`  calendar:  ${running.url}/google${env.GOOGLE_CALENDAR_ID ? `   calendarId ${env.GOOGLE_CALENDAR_ID}` : ""}   (the access token lasts about an hour)`);
  if (config.whatsapp) console.error(`  messaging: ${running.url}/whatsapp${env.WHATSAPP_PHONE_NUMBER_ID ? `   phoneNumberId ${env.WHATSAPP_PHONE_NUMBER_ID}` : ""}`);
  console.error("Press Ctrl+C to stop.");
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { void running.close().then(() => process.exit(0)); });
}
