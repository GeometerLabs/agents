// The inbox: the only thing the providers' webhooks reach. It holds the webhook secrets, so the agent runtime never does.
//
// For every webhook, in this order:
//   1. read the RAW body (bounded), 2. check the signature over those exact bytes, 3. only then parse it,
//   4. hand the events to the runtime and answer the provider 200 only if the runtime answered 2xx.
// The runtime saves each event before it answers, so anything it did not save is answered 503 and the provider sends it again.
// A bad signature is 401 and nothing is forwarded. Nothing secret, and no message text or phone number, is ever logged.
//
// Razorpay wants an answer within 5 seconds (https://razorpay.com/docs/webhooks/best-practices.md) and retries for 24 hours;
// Meta retries for up to 7 days (https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview.md).
// So the wait on the runtime is shorter than 5 seconds, and a slow runtime becomes a 503 here rather than a timeout there.
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import type { AgentEvent } from "../src/agent.ts";
import { parseRazorpayEvent, parseWhatsAppWebhook, verifyMetaSignature, verifyRazorpaySignature } from "../src/adapters/live/webhooks.ts";

export interface InboxConfig {
  /** Where the runtime listens (events go to POST {runtimeUrl}/internal/events). */
  runtimeUrl: string;
  /** Sent to the runtime as `Authorization: Bearer <token>`. */
  internalToken: string;
  razorpayWebhookSecret: string;
  whatsappAppSecret: string;
  whatsappVerifyToken: string;
  /** How long to wait for the runtime. Default 4 seconds (Razorpay waits 5). */
  forwardTimeoutMs?: number;
  /** Largest body accepted per provider. Defaults: Razorpay 256 KB, WhatsApp 3 MB (Meta's documented ceiling). */
  maxBodyBytes?: { razorpay?: number; whatsapp?: number };
  /** One line per request, with no body, secret, number or text in it. Default: standard error. */
  log?: (line: string) => void;
}

export interface RunningInbox { server: Server; port: number; url: string; close(): Promise<void> }

const DEFAULT_RAZORPAY_MAX = 256 * 1024;
const DEFAULT_WHATSAPP_MAX = 3 * 1024 * 1024;

class TooLarge extends Error {}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > limit) { reject(new TooLarge()); return; }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) { reject(new TooLarge()); return; }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function reply(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, { "content-type": typeof body === "string" ? "text/plain; charset=utf-8" : "application/json", "content-length": Buffer.byteLength(text), "cache-control": "no-store", ...extra });
  res.end(text);
}

const sameText = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const header = (req: IncomingMessage, name: string): string | undefined => {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
};

export async function startInbox(config: InboxConfig, listen: { port: number; host?: string }): Promise<RunningInbox> {
  for (const [what, value] of Object.entries({ internalToken: config.internalToken, razorpayWebhookSecret: config.razorpayWebhookSecret, whatsappAppSecret: config.whatsappAppSecret, whatsappVerifyToken: config.whatsappVerifyToken })) {
    if (value.length === 0) throw new Error(`The inbox needs a non-empty ${what}.`);
  }
  const log = config.log ?? ((line: string) => console.error(line));
  const forwardTimeoutMs = config.forwardTimeoutMs ?? 4000;
  const limits = { razorpay: config.maxBodyBytes?.razorpay ?? DEFAULT_RAZORPAY_MAX, whatsapp: config.maxBodyBytes?.whatsapp ?? DEFAULT_WHATSAPP_MAX };

  /** Give the runtime the events. True only if it answered 2xx, which means it has saved them. */
  async function forward(events: AgentEvent[]): Promise<boolean> {
    try {
      const response = await fetch(config.runtimeUrl.replace(/\/+$/u, "") + "/internal/events", {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${config.internalToken}` },
        body: JSON.stringify({ events }), signal: AbortSignal.timeout(forwardTimeoutMs),
      });
      await response.arrayBuffer().catch(() => undefined);
      return response.status >= 200 && response.status < 300;
    } catch {
      return false;
    }
  }

  /** The steps every POST webhook shares. `read` gets the verified, parsed JSON and says which events to forward. */
  async function webhook(req: IncomingMessage, res: ServerResponse, limit: number, verify: (raw: Buffer) => boolean, read: (json: unknown) => AgentEvent[]): Promise<string> {
    let raw: Buffer;
    try { raw = await readBody(req, limit); } catch (e) {
      if (e instanceof TooLarge) { reply(res, 413, { error: "body too large" }, { connection: "close" }); req.destroy(); return "413"; }
      reply(res, 400, { error: "could not read the request" });
      return "400";
    }
    if (!verify(raw)) { reply(res, 401, { error: "bad signature" }); return "401"; }
    let json: unknown;
    try { json = JSON.parse(raw.toString("utf8")); } catch { reply(res, 400, { error: "not JSON" }); return "400"; }
    const events = read(json);
    if (events.length === 0) { reply(res, 200, { forwarded: 0 }); return "200 nothing to forward"; } // a status, or an event the agent does not use: do not make the provider retry it
    if (!(await forward(events))) { reply(res, 503, { error: "the runtime did not take the events; send them again" }); return `503 ${events.length} event(s) not taken`; }
    reply(res, 200, { forwarded: events.length });
    return `200 ${events.length} event(s) forwarded`;
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://inbox");
    const done = (what: string) => log(`${req.method} ${url.pathname} -> ${what}`);
    const route = async (): Promise<string> => {
      if (url.pathname === "/healthz") { if (req.method !== "GET") { reply(res, 405, { error: "GET only" }, { allow: "GET" }); return "405"; } reply(res, 200, "ok"); return "200"; }

      if (url.pathname === "/webhooks/razorpay") {
        if (req.method !== "POST") { reply(res, 405, { error: "POST only" }, { allow: "POST" }); return "405"; }
        return webhook(req, res, limits.razorpay,
          (raw) => verifyRazorpaySignature(raw, header(req, "x-razorpay-signature"), config.razorpayWebhookSecret),
          (json) => { const event = parseRazorpayEvent(json, header(req, "x-razorpay-event-id")); return event ? [{ kind: "payment_event", event }] : []; });
      }

      if (url.pathname === "/webhooks/whatsapp") {
        if (req.method === "GET") { // Meta's handshake when the webhook is set up
          const token = url.searchParams.get("hub.verify_token");
          if (url.searchParams.get("hub.mode") === "subscribe" && token !== null && sameText(token, config.whatsappVerifyToken)) {
            reply(res, 200, url.searchParams.get("hub.challenge") ?? "");
            return "200 verified";
          }
          reply(res, 403, { error: "verification failed" });
          return "403";
        }
        if (req.method !== "POST") { reply(res, 405, { error: "GET or POST only" }, { allow: "GET, POST" }); return "405"; }
        return webhook(req, res, limits.whatsapp,
          (raw) => verifyMetaSignature(raw, header(req, "x-hub-signature-256"), config.whatsappAppSecret),
          (json) => parseWhatsAppWebhook(json).map((message): AgentEvent => ({ kind: "message", message })));
      }

      reply(res, 404, { error: "not found" });
      return "404";
    };
    route().then(done, () => { if (!res.headersSent) reply(res, 500, { error: "inbox error" }); done("500"); });
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 5_000;

  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(listen.port, listen.host ?? "127.0.0.1", resolve); });
  const port = (server.address() as { port: number }).port;
  return {
    server, port, url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}
