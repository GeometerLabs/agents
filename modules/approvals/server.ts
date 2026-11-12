// The relay's HTTP face. One job for the outside: take the owner's messages from the inbox, save them, and only then say 200.
//
//   POST /internal/owner-messages   {"messages": [{id, from, text, timestamp}]}   the inbox, with the relay's own bearer token
//   GET  /status                    counts only (bearer token): no phone number, no code, no message
//   GET  /healthz                   the process is up
//   GET  /owner/asks                item 11d: the owner's own live asks, for the owner's private page (bearer token AND the owner's link in x-owner-link)
//   POST /owner/decide              {"approval", "digest", "decision"}: the owner's answer from that page (the same)
//
// The relay's token is not the runtime's. Bind to 127.0.0.1 or a private network.
import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Relay } from "./relay.ts";
import { OWNER_LINK_HEADER, ownerTokenMatches } from "../channels/owner-link.ts";
import type { OwnerLinkFile } from "../channels/owner-link.ts";

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
export function relayHandler(relay: Pick<Relay, "receive" | "status"> | { receive: Relay["receive"]; status(): unknown }, token: string, options: { /** Item 11d: the owner's link as the relay's own file has it now, read on every call. Left out: no owner page. */ ownerLink?: () => OwnerLinkFile | undefined } = {}): (req: IncomingMessage, res: ServerResponse) => void {
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
      // item 11d: the owner's private page. The relay's token says the caller is the server's front; the owner's link, checked HERE against the relay's own copy of its
      // hash, says the owner sent it. Without both nothing is shown and nothing is decided.
      if (path === "/owner/asks" || path === "/owner/decide") {
        const pageRelay = relay as Partial<Pick<Relay, "ownerAsks" | "decideOnPage">>;
        if (!authorised(req)) return send(res, 401, { error: "A bearer token is needed." });
        const given = req.headers[OWNER_LINK_HEADER];
        if (!options.ownerLink || !pageRelay.ownerAsks || !pageRelay.decideOnPage || !ownerTokenMatches(typeof given === "string" ? given : undefined, options.ownerLink())) return send(res, 403, { error: "The owner's link is not valid (it may have been revoked)." });
        if (path === "/owner/asks" && req.method === "GET") return send(res, 200, { asks: pageRelay.ownerAsks() });
        if (path === "/owner/decide" && req.method === "POST") {
          const text = await readBody(req);
          let body: Record<string, unknown> | undefined;
          try { body = text === undefined ? undefined : JSON.parse(text) as Record<string, unknown>; } catch { body = undefined; }
          if (!body || typeof body.approval !== "string" || body.approval.length > 200 || typeof body.digest !== "string" || !/^[0-9a-f]{32}$/u.test(body.digest) || (body.decision !== "approve" && body.decision !== "deny")) return send(res, 400, { error: 'Send {"approval", "digest", "decision": "approve" or "deny"}.' });
          return send(res, 200, { result: await pageRelay.decideOnPage(body.approval, body.digest, body.decision) });
        }
        return send(res, 405, { error: "Use GET /owner/asks or POST /owner/decide." });
      }
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

// Saves the owner's message before saying 200, so a message the inbox was told arrived is not lost on a crash.
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
