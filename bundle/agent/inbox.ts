// The inbox for an agent someone else wrote. Its WhatsApp number's webhooks come here first. For each one, in this order: read the RAW body (bounded), check the signature over
// those exact bytes (or the secret URL, for a provider that does not sign), and only then look inside. The owner's replies go to the approvals relay (the only place an "approve" is
// ever acted on); the whole webhook, byte for byte and with the provider's own signature header, then goes on to the agent itself, so it can check the signature again with its
// own app secret and read it as it always did. A webhook the relay or the agent did not take is answered 503 and the provider sends it again (the relay drops a message id it has
// seen). There is no Razorpay route: a payment is not a message, and the agent takes its own Razorpay webhooks.
//
// Nothing secret, no message text and no phone number is ever logged.
import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { parseWhatsAppWebhook, verifyMetaSignature } from "../../modules/messaging/webhooks.ts";

export interface AgentInboxConfig {
  ownerWhatsapp: string;
  /** The shop's own number id: a body that names another number is not passed on, even with a valid signature (several shops can share one Meta app, and so one app secret). */
  phoneNumberId: string;
  verification: "meta-signature" | "path-token";
  appSecret?: string;
  verifyToken?: string;
  pathToken?: string;
  relayUrl: string;
  relayToken: string;
  /** The agent's own WhatsApp webhook. Left out, nothing but the owner's replies is kept. */
  forwardTo?: string;
  log?: (line: string) => void;
}

const LIMIT = 3 * 1024 * 1024;
const TIMEOUT_MS = 4_000;
const sameText = (a: string, b: string) => timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
const reply = (res: ServerResponse, status: number, body: unknown) => { const text = typeof body === "string" ? body : JSON.stringify(body); res.writeHead(status, { "content-type": typeof body === "string" ? "text/plain; charset=utf-8" : "application/json", "content-length": Buffer.byteLength(text), "cache-control": "no-store" }); res.end(text); };
const header = (req: IncomingMessage, name: string): string | undefined => { const v = req.headers[name]; return Array.isArray(v) ? v[0] : v; };

function readBody(req: IncomingMessage): Promise<Buffer | "too large"> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > LIMIT) { resolve("too large"); return; }
    const chunks: Buffer[] = []; let size = 0;
    req.on("data", (c: Buffer) => { size += c.length; if (size > LIMIT) { resolve("too large"); return; } chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export function agentInboxHandler(c: AgentInboxConfig): (req: IncomingMessage, res: ServerResponse) => void {
  if (c.verification === "meta-signature" && (!c.appSecret || !c.verifyToken)) throw new Error("WhatsApp is not configured for this agent: meta-signature needs the app secret and the verify token.");
  if (c.verification === "path-token" && !(c.pathToken && /^[A-Za-z0-9_-]{16,}$/u.test(c.pathToken))) throw new Error("The WhatsApp path token must be at least 16 characters of A-Z, a-z, 0-9, _ and -.");
  const owner = c.ownerWhatsapp.replace(/\D/gu, "");
  const log = c.log ?? ((line: string) => console.error(line));

  const ownNumber = (json: unknown): boolean => {
    const ids: unknown[] = [];
    for (const entry of (json as { entry?: unknown[] } | null)?.entry ?? []) for (const change of (entry as { changes?: unknown[] } | null)?.changes ?? []) ids.push((change as { value?: { metadata?: { phone_number_id?: unknown } } } | null)?.value?.metadata?.phone_number_id);
    return ids.every((id) => id === undefined || id === c.phoneNumberId);
  };

  async function post(url: string, headers: Record<string, string>, body: string | Buffer): Promise<boolean> {
    try {
      const r = await fetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(TIMEOUT_MS) });
      await r.arrayBuffer().catch(() => undefined);
      return r.status >= 200 && r.status < 300;
    } catch { return false; }
  }

  async function webhook(req: IncomingMessage, res: ServerResponse, verify: (raw: Buffer) => boolean): Promise<string> {
    let raw: Buffer;
    try { const got = await readBody(req); if (got === "too large") { reply(res, 413, { error: "body too large" }); req.destroy(); return "413"; } raw = got; } catch { reply(res, 400, { error: "could not read the request" }); return "400"; }
    if (!verify(raw)) { reply(res, 401, { error: "bad signature" }); return "401"; }
    let json: unknown;
    try { json = JSON.parse(raw.toString("utf8")); } catch { reply(res, 400, { error: "not JSON" }); return "400"; }
    if (!ownNumber(json)) { reply(res, 200, { forwarded: 0 }); return "200 another number's"; }
    // the owner's messages to the relay: if it cannot take them, the provider sends the webhook again and the relay skips a message id it has seen
    const owners = parseWhatsAppWebhook(json).filter((m) => m.from.replace(/\D/gu, "") === owner);
    if (owners.length > 0 && !(await post(`${c.relayUrl.replace(/\/+$/u, "")}/internal/owner-messages`, { "content-type": "application/json", authorization: `Bearer ${c.relayToken}` }, JSON.stringify({ messages: owners })))) {
      reply(res, 503, { error: "the approvals relay did not take the owner's message; send it again" });
      return `503 ${owners.length} owner message(s) not taken by the relay`;
    }
    if (c.forwardTo) {
      const signature = header(req, "x-hub-signature-256");
      if (!(await post(c.forwardTo, { "content-type": "application/json", ...(signature ? { "x-hub-signature-256": signature } : {}) }, raw))) {
        reply(res, 503, { error: "the agent did not take the webhook; send it again" });
        return "503 the agent did not take it";
      }
    }
    reply(res, 200, { forwarded: c.forwardTo ? 1 : 0, ownerMessages: owners.length });
    return `200${owners.length > 0 ? `, ${owners.length} to the relay` : ""}${c.forwardTo ? ", passed on" : ""}`;
  }

  return (req, res) => {
    const url = new URL(req.url ?? "/", "http://inbox");
    const done = (what: string) => log(`${req.method} /webhooks/whatsapp -> ${what}`); // the path holds the secret in path-token mode, so only the route is named
    const route = async (): Promise<string> => {
      if (url.pathname === "/healthz") { reply(res, 200, "ok"); return "200"; }
      const wa = /^\/webhooks\/whatsapp(?:\/([^/]*))?$/u.exec(url.pathname);
      if (!wa) { reply(res, 404, { error: "not found" }); return "404"; }
      if (c.verification === "path-token") {
        let given: string | undefined; try { given = wa[1] === undefined ? undefined : decodeURIComponent(wa[1]); } catch { given = undefined; }
        if (given === undefined || !sameText(given, c.pathToken!)) { reply(res, 404, { error: "not found" }); return "404"; } // not 401: say nothing about what exists
        if (req.method === "GET") { reply(res, 200, "ok"); return "200"; }
        if (req.method !== "POST") { reply(res, 405, { error: "GET or POST only" }); return "405"; }
        return webhook(req, res, () => true);
      }
      if (wa[1] !== undefined) { reply(res, 404, { error: "not found" }); return "404"; }
      if (req.method === "GET") { // Meta's handshake when the webhook is set up
        const token = url.searchParams.get("hub.verify_token");
        if (url.searchParams.get("hub.mode") === "subscribe" && token !== null && sameText(token, c.verifyToken!)) { reply(res, 200, url.searchParams.get("hub.challenge") ?? ""); return "200 verified"; }
        reply(res, 403, { error: "verification failed" }); return "403";
      }
      if (req.method !== "POST") { reply(res, 405, { error: "GET or POST only" }); return "405"; }
      return webhook(req, res, (raw) => verifyMetaSignature(raw, header(req, "x-hub-signature-256"), c.appSecret!));
    };
    route().then(done, () => { if (!res.headersSent) reply(res, 500, { error: "inbox error" }); done("500"); });
  };
}
