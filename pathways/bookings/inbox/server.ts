// The inbox: the only thing the providers' webhooks reach. It holds the webhook secrets, so the agent runtime never does.
//
// For every webhook, in this order:
//   1. read the RAW body (bounded), 2. check the signature over those exact bytes, 3. only then parse it,
//   4. hand the events to the runtime and answer the provider 200 only if the runtime answered 2xx.
// The runtime saves each event before it answers, so anything it did not save is answered 503 and the provider sends it again.
// A bad signature is 401 and nothing is forwarded. Nothing secret, and no message text or phone number, is ever logged.
//
// WhatsApp webhooks can be verified in one of two ways, chosen in the config (default: meta-signature):
//   - meta-signature: Meta's X-Hub-Signature-256 over the raw body, at POST /webhooks/whatsapp. A body signature proves the body.
//   - path-token: for a provider that does not sign its webhooks (Gupshup's callbacks carry no signature; only an IP allowlist exists).
//     The callback URL carries an unguessable token, POST /webhooks/whatsapp/<token>. A wrong or missing token is 404, as if the route
//     did not exist. An optional list of source addresses (IPs or CIDRs) refuses everyone else. THIS IS WEAKER than a body signature:
//     whoever learns the URL can post messages that look like they came from any customer or from the owner (see Explanation.md).
//
// Razorpay wants an answer within 5 seconds (https://razorpay.com/docs/webhooks/best-practices.md) and retries for 24 hours;
// Meta retries for up to 7 days (https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview.md).
// So the wait on the runtime is shorter than 5 seconds, and a slow runtime becomes a 503 here rather than a timeout there.
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { BlockList, isIP } from "node:net";
import type { AgentEvent } from "../src/agent.ts";
import { parseRazorpayEvent, parseWhatsAppWebhook, verifyMetaSignature, verifyRazorpaySignature } from "../../../modules/messaging/webhooks.ts";

export interface InboxConfig {
  /** Where the runtime listens (events go to POST {runtimeUrl}/internal/events). */
  runtimeUrl: string;
  /** Sent to the runtime as `Authorization: Bearer <token>`. */
  internalToken: string;
  razorpayWebhookSecret: string;
  /** How WhatsApp webhooks are verified. Default "meta-signature". */
  whatsappVerification?: "meta-signature" | "path-token";
  /** meta-signature: the App Secret that signs the body, and the token for Meta's GET handshake. */
  whatsappAppSecret?: string;
  whatsappVerifyToken?: string;
  /** path-token: the unguessable part of the callback URL (at least 16 characters of A-Z a-z 0-9 _ -). Never logged. */
  whatsappPathToken?: string;
  /**
   * Optional: this shop's WhatsApp phone number id. A body that names another number (`metadata.phone_number_id`) is not forwarded, even with a
   * valid signature: several shops can share one Meta app, and so one app secret, and the signature alone does not say whose message it is.
   */
  whatsappPhoneNumberId?: string;
  /** Optional: only these source addresses (IPs or CIDRs, for example 203.0.113.0/24) may post WhatsApp webhooks; anyone else is refused (403). */
  whatsappAllowedSources?: string[];
  /** Behind a reverse proxy the socket's address is the proxy's. Name the header your proxy sets (for example x-forwarded-for) and the LAST address in it is used. */
  sourceIpHeader?: string;
  /**
   * The approvals relay, a second place the OWNER's messages go (the runtime still gets them too, as before). The owner's reply to an approval
   * request ("approve K7M2QX") has to reach the relay straight from here and never through the runtime, because the runtime must not be able to
   * approve anything. Needs `ownerWhatsapp`: a message is the owner's if it comes from that number. `relayToken` is sent as a bearer token and is
   * the relay's own, not the runtime's.
   */
  relayUrl?: string;
  relayToken?: string;
  ownerWhatsapp?: string;
  /** How long to wait for the runtime. Default 4 seconds (Razorpay waits 5). */
  forwardTimeoutMs?: number;
  /** The runtime refuses a request of more than 100 events or 256 KiB. Events are sent in batches below both. Defaults: 100 events, 200 KiB. */
  maxEventsPerRequest?: number;
  maxRequestBytes?: number;
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

/**
 * Split events, keeping their order, into requests of at most `maxEvents` events and `maxBytes` of JSON. A single event over the byte limit
 * goes alone (the runtime will refuse it and the provider will keep retrying; a WhatsApp text is at most 4096 characters, so it does not happen).
 */
export function batches(events: AgentEvent[], maxEvents: number, maxBytes: number): AgentEvent[][] {
  const out: AgentEvent[][] = [];
  let current: AgentEvent[] = [];
  let bytes = Buffer.byteLength('{"events":[]}');
  for (const event of events) {
    const size = Buffer.byteLength(JSON.stringify(event)) + 1; // + the comma
    if (current.length > 0 && (current.length >= maxEvents || bytes + size > maxBytes)) { out.push(current); current = []; bytes = Buffer.byteLength('{"events":[]}'); }
    current.push(event);
    bytes += size;
  }
  if (current.length > 0) out.push(current);
  return out;
}

/** Constant-time comparison that does not even reveal the length: both sides are hashed first. */
const sameText = (a: string, b: string) => timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
const header = (req: IncomingMessage, name: string): string | undefined => {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
};

/**
 * The inbox as a request handler, with nothing listening: the checks in `startInbox`, for a caller that serves it itself. The deploy bundle
 * runs one of these per shop behind a router (/c/<shop>/...), each with that shop's own secrets and its own runtime, so one shop's webhook
 * can only ever reach that shop's runtime.
 */
export function inboxHandler(config: InboxConfig): (req: IncomingMessage, res: ServerResponse) => void {
  const mode = config.whatsappVerification ?? "meta-signature";
  if (mode !== "meta-signature" && mode !== "path-token") throw new Error(`whatsappVerification must be "meta-signature" or "path-token".`);
  const missing = (what: string) => new Error(`The inbox needs a non-empty ${what}.`);
  if (!config.internalToken) throw missing("internalToken");
  if (!config.razorpayWebhookSecret) throw missing("razorpayWebhookSecret");
  const whatsappChoice = "Choose meta-signature (an App Secret and a verify token) or path-token (an unguessable URL token).";
  if (mode === "meta-signature" && (!config.whatsappAppSecret || !config.whatsappVerifyToken)) throw new Error(`WhatsApp is not configured: meta-signature needs whatsappAppSecret and whatsappVerifyToken. ${whatsappChoice}`);
  if (mode === "path-token" && !config.whatsappPathToken) throw new Error(`WhatsApp is not configured: path-token needs whatsappPathToken. ${whatsappChoice}`);
  if (mode === "path-token" && !/^[A-Za-z0-9_-]{16,}$/u.test(config.whatsappPathToken!)) throw new Error("The WhatsApp path token must be at least 16 characters of A-Z, a-z, 0-9, _ and -, so it can sit in a URL and cannot be guessed.");
  const allowed = new BlockList();
  for (const entry of config.whatsappAllowedSources ?? []) {
    const [address, prefix] = entry.trim().split("/");
    const family = isIP(address) === 6 ? "ipv6" : isIP(address) === 4 ? "ipv4" : undefined;
    if (!family || (prefix !== undefined && !(Number.isInteger(Number(prefix)) && Number(prefix) >= 0 && Number(prefix) <= (family === "ipv4" ? 32 : 128)))) throw new Error(`"${entry}" is not an IP address or a CIDR range.`);
    if (prefix === undefined) allowed.addAddress(address, family); else allowed.addSubnet(address, Number(prefix), family);
  }
  const restrictSources = (config.whatsappAllowedSources?.length ?? 0) > 0;
  const relay = config.relayUrl || config.relayToken || config.ownerWhatsapp;
  if (relay && !(config.relayUrl && config.relayToken && config.ownerWhatsapp)) throw new Error("The approvals relay needs relayUrl, relayToken and ownerWhatsapp together: the inbox needs to know which number is the owner's.");
  const ownerDigits = config.ownerWhatsapp?.replace(/\D/gu, "");
  if (relay && !/^\d{6,15}$/u.test(ownerDigits ?? "")) throw new Error("ownerWhatsapp is not a phone number.");
  const log = config.log ?? ((line: string) => console.error(line));
  const forwardTimeoutMs = config.forwardTimeoutMs ?? 4000;
  const maxEvents = config.maxEventsPerRequest ?? 100;
  const maxBytes = config.maxRequestBytes ?? 200 * 1024;
  const limits = { razorpay: config.maxBodyBytes?.razorpay ?? DEFAULT_RAZORPAY_MAX, whatsapp: config.maxBodyBytes?.whatsapp ?? DEFAULT_WHATSAPP_MAX };

  /** Give the runtime the events, in order, in as many requests as its limits need. True only if it answered 2xx to every one (it has saved them all). */
  async function forward(events: AgentEvent[]): Promise<boolean> {
    for (const batch of batches(events, maxEvents, maxBytes)) {
      try {
        const response = await fetch(config.runtimeUrl.replace(/\/+$/u, "") + "/internal/events", {
          method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${config.internalToken}` },
          body: JSON.stringify({ events: batch }), signal: AbortSignal.timeout(forwardTimeoutMs),
        });
        await response.arrayBuffer().catch(() => undefined);
        if (response.status < 200 || response.status >= 300) return false;
      } catch {
        return false;
      }
    }
    return true; // if a later batch failed, the provider sends the whole webhook again and the runtime skips what it already saved (same message ids)
  }

  /** True unless the body names a phone number id and it is not this shop's. */
  const ownNumber = (json: unknown): boolean => {
    if (!config.whatsappPhoneNumberId) return true;
    const ids: unknown[] = [];
    for (const entry of (json as { entry?: unknown[] } | null)?.entry ?? []) for (const change of (entry as { changes?: unknown[] } | null)?.changes ?? []) ids.push(((change as { value?: { metadata?: { phone_number_id?: unknown } } } | null)?.value?.metadata?.phone_number_id));
    return ids.every((id) => id === undefined || id === config.whatsappPhoneNumberId);
  };
  const messagesIn = (json: unknown): AgentEvent[] => ownNumber(json) ? parseWhatsAppWebhook(json).map((message): AgentEvent => ({ kind: "message", message })) : [];

  /** The owner's messages in these events: from the owner's number, which the webhook's signature (or, for a provider that does not sign, the secret URL) vouches for. */
  const fromOwner = (events: AgentEvent[]): AgentEvent[] => (relay ? events.filter((e) => e.kind === "message" && e.message.from.replace(/\D/gu, "") === ownerDigits) : []);

  /** The owner's messages go to the relay as well. True only if the relay answered 2xx: it keeps what it was given, and drops a message id it has seen. */
  async function forwardToRelay(events: AgentEvent[]): Promise<boolean> {
    try {
      const messages = events.flatMap((e) => (e.kind === "message" ? [e.message] : []));
      const response = await fetch(config.relayUrl!.replace(/\/+$/u, "") + "/internal/owner-messages", {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${config.relayToken}` },
        body: JSON.stringify({ messages }), signal: AbortSignal.timeout(forwardTimeoutMs),
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
    // An owner's reply may be an answer to an approval request. The relay is told directly; if it cannot take it, the provider sends the webhook again
    // (the runtime skips what it has saved, and the relay skips a message id it has seen), so an answer is not lost and not counted twice.
    const owners = fromOwner(events);
    if (owners.length > 0 && !(await forwardToRelay(owners))) { reply(res, 503, { error: "the approvals relay did not take the owner's message; send it again" }); return `503 ${owners.length} owner message(s) not taken by the relay`; }
    reply(res, 200, { forwarded: events.length });
    return `200 ${events.length} event(s) forwarded${owners.length > 0 ? `, ${owners.length} to the relay` : ""}`;
  }

  /** Where the request came from: the socket's address, or the last address in the header the proxy sets. */
  function sourceAllowed(req: IncomingMessage): boolean {
    if (!restrictSources) return true;
    const raw = config.sourceIpHeader ? String(req.headers[config.sourceIpHeader.toLowerCase()] ?? "").split(",").at(-1)?.trim() : req.socket.remoteAddress;
    const address = raw?.replace(/^::ffff:/iu, "");
    const family = address && isIP(address) === 6 ? "ipv6" : address && isIP(address) === 4 ? "ipv4" : undefined;
    return address !== undefined && family !== undefined && allowed.check(address, family);
  }

  return (req, res) => {
    const url = new URL(req.url ?? "/", "http://inbox");
    // The log names the route, never the path: in path-token mode the path holds the secret.
    const label = url.pathname === "/healthz" ? "/healthz" : url.pathname === "/webhooks/razorpay" ? "/webhooks/razorpay" : url.pathname.startsWith("/webhooks/whatsapp") ? "/webhooks/whatsapp" : "(other)";
    const done = (what: string) => log(`${req.method} ${label} -> ${what}`);
    const route = async (): Promise<string> => {
      if (url.pathname === "/healthz") { if (req.method !== "GET") { reply(res, 405, { error: "GET only" }, { allow: "GET" }); return "405"; } reply(res, 200, "ok"); return "200"; }

      if (url.pathname === "/webhooks/razorpay") {
        if (req.method !== "POST") { reply(res, 405, { error: "POST only" }, { allow: "POST" }); return "405"; }
        return webhook(req, res, limits.razorpay,
          (raw) => verifyRazorpaySignature(raw, header(req, "x-razorpay-signature"), config.razorpayWebhookSecret),
          (json) => { const event = parseRazorpayEvent(json, header(req, "x-razorpay-event-id")); return event ? [{ kind: "payment_event", event }] : []; });
      }

      const wa = /^\/webhooks\/whatsapp(?:\/([^/]*))?$/u.exec(url.pathname);
      if (wa) {
        const segment = wa[1]; // what follows /webhooks/whatsapp/, still percent-encoded
        if (mode === "path-token") {
          let given: string | undefined;
          try { given = segment === undefined ? undefined : decodeURIComponent(segment); } catch { given = undefined; }
          if (given === undefined || !sameText(given, config.whatsappPathToken!)) { reply(res, 404, { error: "not found" }); return "404"; } // not 401: say nothing about what exists
          if (!sourceAllowed(req)) { reply(res, 403, { error: "not an allowed source" }); return "403 source refused"; }
          if (req.method === "GET") { reply(res, 200, "ok"); return "200"; } // a provider checking that the URL is alive
          if (req.method !== "POST") { reply(res, 405, { error: "GET or POST only" }, { allow: "GET, POST" }); return "405"; }
          return webhook(req, res, limits.whatsapp, () => true, messagesIn);
        }
        if (segment !== undefined) { reply(res, 404, { error: "not found" }); return "404"; } // meta-signature has no token in the path
        if (req.method === "GET") { // Meta's handshake when the webhook is set up
          const token = url.searchParams.get("hub.verify_token");
          if (url.searchParams.get("hub.mode") === "subscribe" && token !== null && sameText(token, config.whatsappVerifyToken!)) {
            reply(res, 200, url.searchParams.get("hub.challenge") ?? "");
            return "200 verified";
          }
          reply(res, 403, { error: "verification failed" });
          return "403";
        }
        if (req.method !== "POST") { reply(res, 405, { error: "GET or POST only" }, { allow: "GET, POST" }); return "405"; }
        if (!sourceAllowed(req)) { reply(res, 403, { error: "not an allowed source" }); return "403 source refused"; }
        return webhook(req, res, limits.whatsapp,
          (raw) => verifyMetaSignature(raw, header(req, "x-hub-signature-256"), config.whatsappAppSecret!),
          messagesIn);
      }

      reply(res, 404, { error: "not found" });
      return "404";
    };
    route().then(done, () => { if (!res.headersSent) reply(res, 500, { error: "inbox error" }); done("500"); });
  };
}

export async function startInbox(config: InboxConfig, listen: { port: number; host?: string }): Promise<RunningInbox> {
  const server = createServer(inboxHandler(config));
  server.requestTimeout = 10_000;
  server.headersTimeout = 5_000;

  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(listen.port, listen.host ?? "127.0.0.1", resolve); });
  const port = (server.address() as { port: number }).port;
  return {
    server, port, url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}
