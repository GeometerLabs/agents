// The recording harness the Guard-client vector generators share (go/scripts/gen_guard_vectors.ts and its siblings). A case runs the REAL TypeScript client against a local HTTP server
// that answers from a script and writes down every request it gets (method, the request target as sent, the headers that matter, the body bytes); the case's outcome (a result, or the
// error and what it carries) is written down too. The Go tests replay the same script from a Go server and must see the same requests and reach the same outcome, so the Go clients are
// proved equal to the TypeScript ones on the bytes. Output is deterministic: no ports, no times, the script's own order.
import { createServer } from "node:http";
import type { IncomingMessage, Server } from "node:http";
import { ApiError, GuardError, GuardAlreadyDoneError, GuardDeniedError, GuardHeldError, GuardRefusedError, GuardSuspendedError, GuardUnavailableError, NotSentError } from "../../../modules/core/faults.ts";

/** One scripted answer. `body` is an object (sent as JSON) or `text` the exact bytes; `hang` never answers (the client's timeout ends it); `cut` closes the connection without answering. */
export interface Scripted { status?: number; headers?: Record<string, string>; body?: unknown; text?: string; hang?: boolean; cut?: boolean }

/** A request as the server saw it. Only the headers a Guard client controls are kept. */
export interface Seen { method: string; uri: string; headers: Record<string, string>; body: string }

const KEEP = ["authorization", "geo-requested-by", "content-type", "accept", "x-test"];

/** What a case writes down: its script, the requests seen and the outcome. `config` carries what the Go test needs to build the same client. */
export interface Case { name: string; config?: Record<string, unknown>; replies: Scripted[]; requests: Seen[]; outcome: unknown }

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** The error as a vector: its name, its words, and what its class carries. Go's guardtest.DescribeError builds the same object. */
export function describeError(e: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = { name: (e as Error)?.name ?? "Error", message: (e as Error)?.message ?? String(e) };
  if (e instanceof ApiError) out.status = e.status;
  if (e instanceof NotSentError && e.code !== undefined) out.code = e.code;
  if (e instanceof GuardError) {
    out.guard = e.guard;
    out.call = e.call;
    if (e instanceof GuardHeldError) { out.approval = e.approval; out.expiresAtMs = e.expiresAtMs; }
    if (e instanceof GuardRefusedError) { out.kind = e.kind; if (e.ruleId !== undefined) out.ruleId = e.ruleId; }
    if (e instanceof GuardDeniedError) { if (e.approval !== undefined) out.approval = e.approval; if (e.deniedAtMs !== undefined) out.deniedAtMs = e.deniedAtMs; if (e.untilMs !== undefined) out.untilMs = e.untilMs; }
    if (e instanceof GuardUnavailableError && e.retryAfterSeconds !== undefined) out.retryAfterSeconds = e.retryAfterSeconds;
    if (e instanceof GuardAlreadyDoneError) { if (e.confirmedBy !== undefined) out.confirmedBy = e.confirmedBy; if (e.intent !== undefined) out.intent = e.intent; }
    if (e instanceof GuardSuspendedError) { if (e.state !== undefined) out.state = e.state; if (e.operation !== undefined) out.operation = e.operation; }
  }
  return out;
}

/** The guard object of a reply is `undefined`-free once JSON has been through it: every vector is normalised so. */
const plain = <T>(v: T): T => (v === undefined ? (null as T) : JSON.parse(JSON.stringify(v)));

/**
 * Run `run(baseUrl)` against a server that answers from `replies` in order (an extra request gets a 500 saying so, which a case never wants). `baseSuffix` is a path prefix on the
 * base URL. `closed` runs against a port nothing listens on (nothing is sent: a NotSentError). The outcome is `{ ok: value }` or `{ error: describeError(e) }`.
 */
export async function recordCase(name: string, replies: Scripted[], run: (baseUrl: string) => Promise<unknown>, options: { baseSuffix?: string; closed?: boolean; config?: Record<string, unknown> } = {}): Promise<Case> {
  const requests: Seen[] = [];
  let next = 0;
  const hanging: Array<() => void> = [];
  const server: Server = createServer(async (req, res) => {
    const body = await readBody(req);
    const headers: Record<string, string> = {};
    for (const k of KEEP) { const v = req.headers[k]; if (typeof v === "string") headers[k] = v; }
    requests.push({ method: req.method ?? "", uri: req.url ?? "", headers, body });
    const r = replies[next++] ?? { status: 500, body: { unscripted: true } };
    if (r.hang) { hanging.push(() => res.destroy()); return; }
    if (r.cut) { req.socket.destroy(); return; }
    const text = r.text !== undefined ? r.text : r.body === undefined ? "" : JSON.stringify(r.body);
    res.writeHead(r.status ?? 200, { ...(r.text === undefined && r.body !== undefined ? { "content-type": "application/json" } : {}), ...(r.headers ?? {}) });
    res.end(text);
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const port = (server.address() as { port: number }).port;
  let baseUrl = `http://127.0.0.1:${port}${options.baseSuffix ?? ""}`;
  if (options.closed) { await new Promise<void>((ok) => server.close(() => ok())); baseUrl = `http://127.0.0.1:${port}${options.baseSuffix ?? ""}`; }
  let outcome: unknown;
  try { outcome = { ok: plain(await run(baseUrl)) }; } catch (e) { outcome = { error: plain(describeError(e)) }; }
  for (const h of hanging) h();
  if (!options.closed) await new Promise<void>((ok) => { server.close(() => ok()); server.closeAllConnections(); });
  return { name, ...(options.config ? { config: options.config } : {}), replies, requests, outcome };
}

/** Write a vector file the way every generator does (two-space-free compact lines would be unreadable: one case per block). */
export const stringify = (v: unknown): string => JSON.stringify(v, null, 1) + "\n";
