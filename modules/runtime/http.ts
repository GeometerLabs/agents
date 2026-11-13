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
// The shop's channels (modules/channels: the booking page, its API, the MCP endpoint, the owner's private page), with the CHANNEL token, which is not the inbox's.
// It can send only a channel_request, an owner_action or (item 11f) an owner_signin, and read what the page shows: never a WhatsApp message, a payment event or an approval. Without a channel
// token these routes do not exist.
//   POST /internal/channel/events   {"events": [...]}   1 to 10 channel events; an owner_action also needs the owner's link (x-owner-link), checked here against the
//                                                     hash in the client folder, read on every request so a revoked link stops at once
//   GET  /internal/channel/offer?service=&from=YYYY-MM-DD&days=N   the services, prices and free times
//   GET  /internal/channel/request?handle=<64 hex>    one request by its handle's hash
//   GET  /internal/channel/parent?link=<64 hex>       item 11h (Fees): what a parent's private link opens, by the link's hash; 404 for a hash no parent has now
//   GET  /internal/channel/owner                     what waits for the owner (x-owner-link needed)
//   POST /internal/channel/owner-voice               items 11d and 11e: a recording from the owner's page (audio/ogg, at most 256 KB), with the owner's credential;
//                                                     held in memory only, and an owner_message carrying its reference is saved (never the audio)
// An owner_message (the owner's talk box) needs the owner's credential too, like an owner_action.
//
// Item 11f, the owner's sign-in on the shop's page (modules/channels/owner-access.ts, owner-signin.ts). The owner's credential above is the panel-made link
// (x-owner-link) OR a session made here (x-owner-session); both are checked HERE, against this runtime's own files, never at the front.
//   GET  /internal/channel/owner-signin   x-owner-signin: <link>     what the link is now (valid, used, expired, replaced, unknown); nothing is used up
//   POST /internal/channel/owner-signin   x-owner-signin: <link>     use the link up (once) and make a session: {"session", "expires_at_ms"}, or 403 {"state"}
//   POST /internal/channel/owner-signout  x-owner-session: <token>   end that session
//   GET  /internal/owner-session          x-owner-session, with the INBOX's internal token: 204 when the session is good. The approvals relay asks this, so it
//                                         never takes the front's word for who the owner is.
// Item 11h, passkeys (owner-access.ts, webauthn.ts): one route, the step in the body. Every check is HERE; the front carries the browser's answers.
//   POST /internal/channel/owner-passkey  {"op": "grant_state" | "register_options" | "register", "grant": {"kind": "setup", "token"} | {"kind": "recovery", "code"}, "response"?}
//                                         {"op": "status"} | {"op": "signin_options"} | {"op": "signin", "response"}
//                                         answers {state} | {options} | {session, expires_at_ms} | {count, options?}, or 403 {state | why}
//
// The runtime never holds a webhook secret: the inbox checked each provider's signature before it called us. The bearer
// token only says the caller is our own inbox. Bind to 127.0.0.1 or a private network, never the open internet.
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { checkEvents, checkRecovery } from "./events.ts";
import type { IncomingEvent } from "./events.ts";
import { checkChannelEvent } from "../channels/events.ts";
import { MAX_VOICE_BYTES } from "../channels/owner-audio.ts";
import { HANDLE_HASH } from "../channels/handle.ts";
import { OWNER_LINK_HEADER, ownerTokenMatches } from "../channels/owner-link.ts";
import { OWNER_SESSION_HEADER, OWNER_SIGNIN_HEADER } from "../channels/owner-access.ts";
import type { AssertionResponse, RegistrationResponse } from "../channels/owner-access.ts";
import type { Grant } from "../channels/owner-grants.ts";
import type { OwnerSignin } from "../channels/owner-signin.ts";
import type { OwnerLinkFile } from "../channels/owner-link.ts";
import type { RuntimeChannel } from "./core.ts";

/** What the server needs of a runtime: a template's runtime gives this much, whatever its cases are called. */
export interface ServedRuntime {
  submit(events: IncomingEvent[]): { saved: number; duplicates: number };
  kick(): void;
  status(): unknown;
  /** The held refund with this receipt, for the approvals relay to cross-check against what Guard says it holds; null if none is held. */
  refundContext(receipt: string): unknown | null;
  ready(): { ok: true } | { ok: false; reason: string };
  /** The template's channel reads; left out when it has none. */
  channel?: RuntimeChannel;
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
  /** The channel token, already read from its file (CHANNEL_TOKEN_FILE). Left out: the /internal/channel routes do not exist. */
  channelToken?: string;
  /** The owner's link as the client folder has it now (modules/channels/owner-link.ts), read on every call. Left out, or undefined: no owner page. */
  ownerLink?: () => OwnerLinkFile | undefined;
  /** Item 11f: the owner's sign-in (links and sessions), checked here on every call. Left out: no session is ever good, and the sign-in routes refuse. */
  ownerSignin?: OwnerSignin["http"];
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

/** A body as bytes (a recording), refused past `max`. */
function readBytes(req: IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (Number(req.headers["content-length"] ?? 0) > max) { reject(new HttpError(413, `That request is bigger than the ${max} bytes this endpoint takes.`)); return; }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > max) { reject(new HttpError(413, `That request is bigger than the ${max} bytes this endpoint takes.`)); return; }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// Saves the event before answering 200, so the inbox only stops retrying once the message is durable.
export function startServer(runtime: ServedRuntime, options: ServerOptions): Promise<RunningServer> {
  const host = options.host ?? "127.0.0.1";
  const max = options.maxBodyBytes ?? MAX_BODY_BYTES;
  const log = options.log ?? (() => undefined);
  const wanted = sha256(options.token);
  const channelWanted = options.channelToken ? sha256(options.channelToken) : undefined;

  /** Hashing both sides first makes the comparison the same length (timingSafeEqual needs that) and takes the same time for every guess. */
  const authorised = (req: IncomingMessage): boolean => {
    const given = /^bearer\s+(\S+)$/i.exec(req.headers.authorization ?? "")?.[1];
    return timingSafeEqual(sha256(given ?? ""), wanted) && given !== undefined;
  };

  /** The channel token, compared the same way as the inbox's. */
  const channelAuthorised = (req: IncomingMessage): boolean => {
    const given = /^bearer\s+(\S+)$/i.exec(req.headers.authorization ?? "")?.[1];
    return channelWanted !== undefined && given !== undefined && timingSafeEqual(sha256(given), channelWanted);
  };
  /** The header's value when it was sent once, as text. */
  const header = (req: IncomingMessage, name: string): string | undefined => { const v = req.headers[name]; return typeof v === "string" ? v : undefined; };
  /**
   * The owner, from the front: the panel-made link against the hash the client folder holds now, or (item 11f) a session this runtime made and still holds good
   * (the owner's number and address unchanged, made after the panel's last "sign out every device").
   */
  const ownerAuthorised = (req: IncomingMessage): boolean => {
    if (ownerTokenMatches(header(req, OWNER_LINK_HEADER), options.ownerLink?.())) return true;
    const session = header(req, OWNER_SESSION_HEADER);
    return session !== undefined && options.ownerSignin?.check(session) !== undefined;
  };
  /** A session's start or end, for the record: an event of the runtime's own, saved and run as a step like any other. */
  const recordAccess = (what: "signed_in" | "signed_out" | "passkey_added", session: string, how?: "link" | "passkey" | "setup" | "recovery"): void => {
    runtime.submit([{ kind: "owner_access", id: randomUUID(), what, session, ...(how ? { how } : {}) }]);
    runtime.kick();
  };

  /** The channel's routes. Only with a channel token, and only for a runtime whose template has channels. */
  async function channelRoute(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const channel = runtime.channel;
    if (!channelWanted || !channel) throw new HttpError(404, "There is nothing here.");
    const only = (method: string) => { if (req.method !== method) throw new HttpError(405, `Use ${method} here.`, { allow: method }); };
    if (!channelAuthorised(req)) return send(res, 401, { error: "A bearer token is needed." }, { "www-authenticate": "Bearer", connection: "close" });
    const path = url.pathname;
    if (path === "/internal/channel/events") {
      only("POST");
      let body: unknown;
      try { body = JSON.parse(await readBody(req, 16 * 1024)); } catch (e) {
        if (e instanceof HttpError) { res.once("finish", () => req.destroy()); return send(res, e.status, { error: e.message }, { connection: "close" }); }
        return send(res, 400, { error: "The body must be JSON." });
      }
      const list = typeof body === "object" && body !== null ? (body as { events?: unknown }).events : undefined;
      if (!Array.isArray(list) || list.length === 0 || list.length > 10) return send(res, 400, { error: 'Send {"events": [...]} with 1 to 10 channel events.' });
      const events: IncomingEvent[] = [];
      for (const raw of list) {
        const checked = checkChannelEvent(raw);
        if (!checked.ok) return send(res, 400, { error: checked.error });
        // the owner's link is checked HERE, at the runtime, against its own file: the front cannot act for the owner without it
        if ((checked.event.kind === "owner_action" || checked.event.kind === "owner_message") && !ownerAuthorised(req)) return send(res, 403, { error: "The owner's link is not valid (it may have been revoked)." });
        events.push(checked.event);
      }
      const counts = runtime.submit(events); // on disk when this returns
      send(res, 200, counts);
      runtime.kick();
      return;
    }
    if (path === "/internal/channel/offer") {
      only("GET");
      const q = url.searchParams;
      const days = q.get("days") === null ? undefined : Number(q.get("days"));
      if (days !== undefined && (!Number.isInteger(days) || days < 1 || days > 31)) return send(res, 400, { error: "days is 1 to 31." });
      const from = q.get("from") ?? undefined;
      if (from !== undefined && !/^\d{4}-\d{2}-\d{2}$/u.test(from)) return send(res, 400, { error: "from is a date: YYYY-MM-DD." });
      const service = q.get("service") ?? undefined;
      if (service !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/u.test(service)) return send(res, 400, { error: "service is a service id." });
      return send(res, 200, await channel.offer({ ...(service ? { serviceId: service } : {}), ...(from ? { fromDate: from } : {}), ...(days ? { days } : {}) }));
    }
    if (path === "/internal/channel/request") {
      only("GET");
      const handle = url.searchParams.get("handle") ?? "";
      if (!HANDLE_HASH.test(handle)) return send(res, 400, { error: "handle is the handle's hash: 64 hex digits." });
      const view = channel.view(handle);
      return view ? send(res, 200, view) : send(res, 404, { error: "No booking has this handle." });
    }
    // item 11h: a parent's private page (Fees). The front sends only the link's hash; the runtime finds the parent whose saved hash it is NOW, so a replaced or
    // revoked link opens nothing, at once and after a restart alike
    if (path === "/internal/channel/parent") {
      only("GET");
      const link = url.searchParams.get("link") ?? "";
      if (!HANDLE_HASH.test(link)) return send(res, 400, { error: "link is the link's hash: 64 hex digits." });
      const view = channel.parent?.(link) ?? null;
      return view ? send(res, 200, view) : send(res, 404, { error: "No parent has this link." });
    }
    // ---- item 11f: the owner's sign-in ----
    if (path === "/internal/channel/owner-signin") {
      const signin = options.ownerSignin;
      const link = header(req, OWNER_SIGNIN_HEADER) ?? "";
      if (req.method === "GET") return send(res, 200, { state: signin ? signin.linkState(link) : "unknown" });
      only("POST");
      if (!signin) return send(res, 403, { state: "unknown" });
      const done = signin.consume(link);
      if (!done.ok) return send(res, 403, { state: done.state });
      recordAccess("signed_in", done.id, "link");
      return send(res, 200, { session: done.session, expires_at_ms: done.expiresAt });
    }
    // ---- item 11h: passkeys ----
    if (path === "/internal/channel/owner-passkey") {
      only("POST");
      const signin = options.ownerSignin;
      let body: Record<string, unknown>;
      try { body = JSON.parse(await readBody(req, 32 * 1024)) as Record<string, unknown>; } catch (e) {
        if (e instanceof HttpError) { res.once("finish", () => req.destroy()); return send(res, e.status, { error: e.message }, { connection: "close" }); }
        return send(res, 400, { error: "The body must be JSON." });
      }
      if (!signin || !signin.passkeysOn()) return send(res, 403, { state: "unknown", why: "Passkeys are not on for this shop." });
      const g = body.grant as { kind?: unknown; token?: unknown; code?: unknown } | undefined;
      const grant: Grant | undefined = g?.kind === "setup" && typeof g.token === "string" ? { kind: "setup", token: g.token.slice(0, 64) }
        : g?.kind === "recovery" && typeof g.code === "string" ? { kind: "recovery", code: g.code.slice(0, 40) } : undefined;
      const op = body.op;
      if (op === "grant_state" || op === "register_options" || op === "register") {
        if (!grant) return send(res, 400, { error: 'Send "grant": {"kind": "setup", "token"} or {"kind": "recovery", "code"}.' });
        // a recovery code is a guess until it matches: too many wrong ones today and none is looked at
        if (grant.kind === "recovery" && signin.codesLocked()) return send(res, 403, { state: "locked" });
        const state = signin.grantState(grant);
        if (grant.kind === "recovery" && state === "unknown") signin.noteWrongCode();
        if (op === "grant_state") return send(res, 200, { state, shop: signin.shopName });
        if (op === "register_options") {
          const r = signin.registrationOptions(grant);
          return r.ok ? send(res, 200, { options: r.options }) : send(res, 403, { state: r.state });
        }
        const done = signin.register(grant, body.response as RegistrationResponse);
        if (!done.ok) return send(res, 403, { state: done.state, ...("why" in done && done.why ? { why: done.why } : {}) });
        recordAccess("passkey_added", done.passkey, grant.kind);
        recordAccess("signed_in", done.id, "passkey");
        return send(res, 200, { session: done.session, expires_at_ms: done.expiresAt });
      }
      if (op === "status") return send(res, 200, { count: signin.passkeys().length });
      if (op === "signin_options") return send(res, 200, signin.signinOptions());
      if (op === "signin") {
        const done = signin.signin(body.response as AssertionResponse);
        if (!done.ok) return send(res, 403, { why: done.why });
        recordAccess("signed_in", done.id, "passkey");
        return send(res, 200, { session: done.session, expires_at_ms: done.expiresAt });
      }
      return send(res, 400, { error: "op is grant_state, register_options, register, signin_options or signin." });
    }
    if (path === "/internal/channel/owner-signout") {
      only("POST");
      const ended = options.ownerSignin?.end(header(req, OWNER_SESSION_HEADER) ?? "");
      if (ended) recordAccess("signed_out", ended);
      return send(res, 200, { ended: ended !== undefined });
    }
    // Integration of items 11d and 11e: a recording the owner made on their page. The owner is checked HERE, as for every owner event; the audio is held in this
    // process's memory only (the kit's ownerVoice, modules/channels/owner-audio.ts) and the saved event carries its reference, never the audio.
    if (path === "/internal/channel/owner-voice") {
      only("POST");
      if (!ownerAuthorised(req)) return send(res, 403, { error: "The owner's link is not valid (it may have been revoked)." });
      if (!channel.ownerVoice) return send(res, 404, { error: "Voice is not on for this shop's assistant." });
      const type = header(req, "content-type") ?? "";
      if (!/^audio\/ogg\b/iu.test(type)) return send(res, 415, { error: "Send the recording as audio/ogg (Opus)." });
      let bytes: Buffer;
      try { bytes = await readBytes(req, MAX_VOICE_BYTES); } catch (e) {
        if (e instanceof HttpError) { res.once("finish", () => req.destroy()); return send(res, e.status, { error: e.message }, { connection: "close" }); }
        throw e;
      }
      if (bytes.length === 0) return send(res, 400, { error: "The recording is empty." });
      const ref = channel.ownerVoice({ bytes: new Uint8Array(bytes), mime: type.split(";")[0].trim().toLowerCase() === "audio/ogg" ? "audio/ogg; codecs=opus" : type });
      const counts = runtime.submit([{ kind: "owner_message", id: randomUUID(), text: "", voice: ref }]);
      send(res, 200, counts);
      runtime.kick();
      return;
    }
    if (path === "/internal/channel/owner") {
      only("GET");
      if (!ownerAuthorised(req)) return send(res, 403, { error: "The owner's link is not valid (it may have been revoked)." });
      return send(res, 200, channel.owner());
    }
    throw new HttpError(404, "There is nothing here.");
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://runtime");
    const path = url.pathname;
    if (path.startsWith("/internal/channel/")) return channelRoute(req, res, url);
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
    if (path === "/internal/owner-session") {
      only("GET");
      if (!authorised(req)) return send(res, 401, { error: "A bearer token is needed." }, { "www-authenticate": "Bearer", ...closing });
      const session = header(req, OWNER_SESSION_HEADER);
      const good = session !== undefined && options.ownerSignin?.check(session) !== undefined;
      if (!good) return send(res, 403, { error: "That session is not good (it may have ended)." });
      res.writeHead(204, { "cache-control": "no-store" }); res.end(); return;
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
