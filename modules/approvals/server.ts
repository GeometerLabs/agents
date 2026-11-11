// The relay's HTTP face. One job for the outside: take the owner's messages from the inbox, save them, and only then say 200.
//
//   POST /internal/owner-messages   {"messages": [{id, from, text, timestamp}]}   the inbox, with the relay's own bearer token
//   GET  /status                    counts only (bearer token): no phone number, no code, no message
//   GET  /healthz                   the process is up
//
// The relay's token is not the runtime's. Bind to 127.0.0.1 or a private network.
import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Relay } from "./relay.ts";

const MAX_BODY = 64 * 1024;
const sha256 = (t: string) => createHash("sha256").update(t).digest();

function send(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body), "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(body);
}

function readBody(req: IncomingMessage): Promise<string | undefined> {
  return new Promise((resolve) => {
    if (Number(req.headers["content-length"] ?? 0) > MAX_BODY) { resolve(undefined); return; }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => { size += c.length; if (size > MAX_BODY) { resolve(undefined); req.destroy(); return; } chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(undefined));
  });
}

export interface RunningRelayServer { port: number; url: string; close(): Promise<void> }

/**
 * The relay's routes as a request handler with nothing listening, for a caller that serves several relays itself (the deploy bundle: one per shop, behind /c/<shop>).
 * What takes the owner's messages is anything with `receive` and `status`: the relay, or (B71 part 2) the owner-marked desk of an agent someone else wrote, which also
 * reads a tapped button's id (`reply.id`, the button that carries the one-use code). The relay ignores it.
 */
export function relayHandler(relay: Pick<Relay, "receive" | "status"> | { receive: Relay["receive"]; status(): unknown }, token: string): (req: IncomingMessage, res: ServerResponse) => void {
  const wanted = sha256(token);
  const authorised = (req: IncomingMessage) => {
    const given = /^bearer\s+(\S+)$/iu.exec(req.headers.authorization ?? "")?.[1];
    return given !== undefined && timingSafeEqual(sha256(given), wanted);
  };
  return async (req, res) => {
    try {
      const path = new URL(req.url ?? "/", "http://relay").pathname;
      if (path === "/healthz" && req.method === "GET") return send(res, 200, { ok: true });
      if (path === "/status" && req.method === "GET") return authorised(req) ? send(res, 200, relay.status()) : send(res, 401, { error: "A bearer token is needed." });
      if (path === "/internal/owner-messages" && req.method === "POST") {
        if (!authorised(req)) return send(res, 401, { error: "A bearer token is needed." });
        const text = await readBody(req);
        let body: unknown;
        try { body = text === undefined ? undefined : JSON.parse(text); } catch { body = undefined; }
        const list = typeof body === "object" && body !== null ? (body as { messages?: unknown }).messages : undefined;
        if (!Array.isArray(list) || list.length === 0 || list.length > 50) return send(res, 400, { error: 'Send {"messages": [...]} with 1 to 50 messages.' });
        const messages = [];
        for (const m of list) {
          const r = m as Record<string, unknown>;
          if (typeof r?.id !== "string" || r.id.length === 0 || r.id.length > 256 || typeof r.from !== "string" || r.from.length > 32 || typeof r.text !== "string" || r.text.length > 4096 || typeof r.timestamp !== "number") return send(res, 400, { error: "Each message needs id, from, text and timestamp." });
          const tapped = typeof r.reply === "object" && r.reply !== null && typeof (r.reply as { id?: unknown }).id === "string" && ((r.reply as { id: string }).id.length <= 256) ? { reply: { id: (r.reply as { id: string }).id } } : {};
          messages.push({ id: r.id, from: r.from, text: r.text, timestamp: r.timestamp, ...tapped });
        }
        return send(res, 200, relay.receive(messages)); // saved before this answer
      }
      send(res, 404, { error: "There is nothing here." });
    } catch {
      if (!res.headersSent) send(res, 500, { error: "The relay could not handle that. Send it again." });
    }
  };
}

export function startRelayServer(relay: Relay, options: { token: string; host?: string; port?: number }): Promise<RunningRelayServer> {
  const server = createServer(relayHandler(relay, options.token));
  server.requestTimeout = 10_000;
  server.headersTimeout = 5_000;
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 8795, options.host ?? "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      resolve({ port, url: `http://${options.host ?? "127.0.0.1"}:${port}`, close: () => new Promise<void>((done) => { server.closeAllConnections(); server.close(() => done()); }) });
    });
  });
}
