// What the stand-ins share: a request as the translators see it, a reply, and "the reply is lost".
// Each translator (a gateway's standin.ts in its provider folder, google-calendar.ts, whatsapp.ts, control.ts) turns an HTTP call into a call on one of the
// EXISTING in-memory fakes and the fake's answer back into the provider's wire format. There is no state in these files: the fakes are the only source of state.
// `serveHandlers` is the one HTTP server they all run in: the template's stand-ins and a payment provider's contract test (modules/payments/providers/test).
import { createServer } from "node:http";
import type { IncomingHttpHeaders, IncomingMessage, Server, ServerResponse } from "node:http";

export interface StandinRequest { method: string; path: string; query: URLSearchParams; body: any; headers: IncomingHttpHeaders }
export interface StandinReply { status: number; body?: unknown }
/** A translator answers requests that are its own, and returns undefined for the rest. */
export type Handler = (request: StandinRequest) => Promise<StandinReply | undefined>;

/** The fake stored the change and "lost" the reply: the server cuts the connection, so the client sees no answer. */
export class LostReply extends Error {}

// The common success reply; short because every translator returns it.
export const ok = (body?: unknown): StandinReply => ({ status: 200, body });

const MAX_BODY = 1024 * 1024;

function readJson(req: IncomingMessage): Promise<{ ok: true; body: unknown } | { ok: false }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => { size += c.length; if (size > MAX_BODY) { resolve({ ok: false }); req.destroy(); } else chunks.push(c); });
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (text.length === 0) { resolve({ ok: true, body: undefined }); return; }
      try { resolve({ ok: true, body: JSON.parse(text) }); } catch { resolve({ ok: false }); }
    });
    req.on("error", () => resolve({ ok: false }));
  });
}

function send(res: ServerResponse, reply: StandinReply): void {
  if (reply.body === undefined) { res.writeHead(reply.status); res.end(); return; }
  const text = JSON.stringify(reply.body);
  res.writeHead(reply.status, { "content-type": "application/json; charset=UTF-8", "content-length": Buffer.byteLength(text) });
  res.end(text);
}

/** One handler for every request, answering a status and a JSON body: the owner-marked desk in a crash test. */
export async function serveRaw(handle: (r: StandinRequest) => Promise<StandinReply>, listen: { port: number; host?: string } = { port: 0 }): Promise<ServedHandlers> {
  return serveHandlers([handle], listen);
}

export interface ServedHandlers { server: Server; port: number; url: string; close(): Promise<void> }

/**
 * Serve translators over HTTP on 127.0.0.1: the first that answers a request wins. A fake that planned a lost reply throws LostReply AFTER it stored the change,
 * and the connection is cut, so the client sees no answer at all (the case an agent must look before it retries). `seen` sees every request first.
 */
export async function serveHandlers(handlers: Handler[], listen: { port: number; host?: string } = { port: 0 }, seen?: (req: IncomingMessage) => void): Promise<ServedHandlers> {
  const server = createServer(async (req, res) => {
    seen?.(req);
    const url = new URL(req.url ?? "/", "http://standin");
    const parsed = await readJson(req);
    if (!parsed.ok) { send(res, { status: 400, body: { error: "the body is not JSON, or is too large" } }); return; }
    try {
      for (const handler of handlers) {
        const reply = await handler({ method: req.method ?? "GET", path: url.pathname, query: url.searchParams, body: parsed.body, headers: req.headers });
        if (reply) { send(res, reply); return; }
      }
      send(res, { status: 404, body: { error: `the stand-ins have no ${req.method} ${url.pathname}` } });
    } catch (e) {
      if (e instanceof LostReply) { req.socket.destroy(); return; }
      send(res, { status: 500, body: { error: (e as Error).message } });
    }
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(listen.port, listen.host ?? "127.0.0.1", resolve); });
  const port = (server.address() as { port: number }).port;
  return { server, port, url: `http://127.0.0.1:${port}`, close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }) };
}
