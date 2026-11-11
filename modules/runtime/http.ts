// The runtime's HTTP face, the same for every template. It has one job for the outside: take events from the inbox, save them, and only then say 200. A
// provider that gets anything else sends the event again later, so nothing is lost and nothing is believed unsaved.
//
//   POST /internal/events   {"events": [...]}   the inbox's already-checked events (bearer token)
//   POST /internal/recover  {"id","case","action"}   the panel's to-do list asks the agent to look again or ask again about one booking or fee (bearer token). It is saved
//                                                like any event and the agent does it through Guard and the same limits; it is not a way to send a message or move money.
//   GET  /status                                counts only, never message content (bearer token)
//   GET  /internal/refund-context?receipt=...   read-only: the booking or fee behind a refund Guard holds, for the approvals relay (bearer token)
//   GET  /healthz                               the process is up
//   GET  /readyz                                the store can be read and the queue is going
//
// The runtime never holds a webhook secret: the inbox checked each provider's signature before it called us. The bearer
// token only says the caller is our own inbox. Bind to 127.0.0.1 or a private network, never the open internet.
import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { checkEvents, checkRecovery } from "./events.ts";
import type { IncomingEvent } from "./events.ts";

/** What the server needs of a runtime: a template's runtime gives this much, whatever its cases are called. */
export interface ServedRuntime {
  submit(events: IncomingEvent[]): { saved: number; duplicates: number };
  kick(): void;
  status(): unknown;
  /** The held refund with this receipt, for the approvals relay to cross-check against what Guard says it holds; null if none is held. */
  refundContext(receipt: string): unknown | null;
  ready(): { ok: true } | { ok: false; reason: string };
}

export const MAX_BODY_BYTES = 256 * 1024;
export const DEFAULT_PORT = 8780;

export interface ServerOptions {
  /** The internal bearer token, already read from its file. */
  token: string;
  /** Default 127.0.0.1. */
  host?: string;
  /** Default 8780; 0 picks a free port. */
  port?: number;
  maxBodyBytes?: number;
  log?: (line: string) => void;
}

export interface RunningServer {
  host: string;
  port: number;
  url: string;
  close(): Promise<void>;
}

class HttpError extends Error {
  status: number;
  headers: Record<string, string>;
  constructor(status: number, message: string, headers: Record<string, string> = {}) { super(message); this.status = status; this.headers = headers; }
}

const sha256 = (text: string) => createHash("sha256").update(text).digest();

function send(res: ServerResponse, status: number, value: unknown, extra: Record<string, string> = {}): void {
  const body = JSON.stringify(value);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body), "cache-control": "no-store", "x-content-type-options": "nosniff", ...extra });
  res.end(body);
}

function readBody(req: IncomingMessage, max: number): Promise<string> {
  return new Promise((resolve, reject) => {
    if (Number(req.headers["content-length"] ?? 0) > max) { reject(new HttpError(413, `That request is bigger than the ${max} bytes this endpoint takes.`)); return; }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > max) { reject(new HttpError(413, `That request is bigger than the ${max} bytes this endpoint takes.`)); return; }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// Saves the event before answering 200, so the inbox only stops retrying once the message is durable.
export function startServer(runtime: ServedRuntime, options: ServerOptions): Promise<RunningServer> {
  const host = options.host ?? "127.0.0.1";
  const max = options.maxBodyBytes ?? MAX_BODY_BYTES;
  const log = options.log ?? (() => undefined);
  const wanted = sha256(options.token);

  /** Hashing both sides first makes the comparison the same length (timingSafeEqual needs that) and takes the same time for every guess. */
  const authorised = (req: IncomingMessage): boolean => {
    const given = /^bearer\s+(\S+)$/i.exec(req.headers.authorization ?? "")?.[1];
    return timingSafeEqual(sha256(given ?? ""), wanted) && given !== undefined;
  };

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = new URL(req.url ?? "/", "http://runtime").pathname;
    const only = (method: string) => { if (req.method !== method) throw new HttpError(405, `Use ${method} here.`, { allow: method }); };
    const closing = { connection: "close" }; // after a refusal the unread body is not worth waiting for

    if (path === "/healthz") { only("GET"); return send(res, 200, { ok: true }); }
    if (path === "/readyz") {
      only("GET");
      const ready = runtime.ready();
      return send(res, ready.ok ? 200 : 503, ready);
    }
    if (path === "/status") {
      only("GET");
      if (!authorised(req)) return send(res, 401, { error: "A bearer token is needed." }, { "www-authenticate": "Bearer", ...closing });
      return send(res, 200, runtime.status());
    }
    if (path === "/internal/refund-context") {
      only("GET");
      if (!authorised(req)) return send(res, 401, { error: "A bearer token is needed." }, { "www-authenticate": "Bearer", ...closing });
      const receipt = new URL(req.url ?? "/", "http://runtime").searchParams.get("receipt");
      if (!receipt || receipt.length > 200) return send(res, 400, { error: "Give the refund's receipt: ?receipt=b-3:pay_..." });
      const context = runtime.refundContext(receipt);
      return context ? send(res, 200, context) : send(res, 404, { error: "No refund is held under that receipt." });
    }
    if (path === "/internal/recover") {
      only("POST");
      if (!authorised(req)) return send(res, 401, { error: "A bearer token is needed." }, { "www-authenticate": "Bearer", ...closing });
      let body: unknown;
      try {
        body = JSON.parse(await readBody(req, 4096));
      } catch (e) {
        if (e instanceof HttpError) { res.once("finish", () => req.destroy()); return send(res, e.status, { error: e.message }, closing); }
        return send(res, 400, { error: "The body must be JSON." });
      }
      const checked = checkRecovery(body);
      if (!checked.ok) return send(res, 400, { error: checked.error });
      const counts = runtime.submit([checked.event]); // on disk when this returns
      send(res, 200, counts);
      runtime.kick();
      return;
    }
    if (path === "/internal/events") {
      only("POST");
      if (!authorised(req)) return send(res, 401, { error: "A bearer token is needed." }, { "www-authenticate": "Bearer", ...closing });
      let body: unknown;
      try {
        body = JSON.parse(await readBody(req, max));
      } catch (e) {
        if (e instanceof HttpError) { res.once("finish", () => req.destroy()); return send(res, e.status, { error: e.message }, closing); }
        return send(res, 400, { error: "The body must be JSON." });
      }
      const checked = checkEvents(body);
      if (!checked.ok) return send(res, 400, { error: checked.error });
      const counts = runtime.submit(checked.events); // on disk when this returns
      send(res, 200, counts);
      runtime.kick(); // only now let the queue run
      return;
    }
    throw new HttpError(404, "There is nothing here.");
  }

  const server = createServer((req, res) => {
    route(req, res).catch((e) => {
      if (e instanceof HttpError) { send(res, e.status, { error: e.message }, e.headers); return; }
      log(`Request failed: ${(e as Error).message}`);
      if (!res.headersSent) send(res, 500, { error: "The runtime could not handle that. Send it again." });
    });
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 40;

  return new Promise((resolve, reject) => {
    server.once("error", (e: NodeJS.ErrnoException) => reject(e.code === "EADDRINUSE" ? new Error(`Port ${options.port ?? DEFAULT_PORT} is already in use. Set a different "port" in runtime.json.`) : e));
    server.listen(options.port ?? DEFAULT_PORT, host, () => {
      const port = (server.address() as { port: number }).port;
      resolve({
        host, port, url: `http://${host.includes(":") ? `[${host}]` : host}:${port}`,
        close: () => new Promise<void>((done) => { server.closeAllConnections(); server.close(() => done()); }),
      });
    });
  });
}
