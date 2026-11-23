// The runtime's HTTP face, the same for every template. It has one job for the outside: take events from the inbox, save them, and only then say 200. A
// provider that gets anything else sends the event again later, so nothing is lost and nothing is believed unsaved.
//
//   POST /internal/events   {"events": [...]}   the inbox's already-checked events (bearer token)
//   POST /internal/recover  {"id","case","action"}   the panel's to-do list asks the agent to look again or ask again about one booking or fee (bearer token). It is saved
//                                                like any event and the agent does it through Guard and the same limits; it is not a way to send a message or move money.
//   GET  /internal/limit-changes                "Limits, tightened by a tap" (bearer token): the limits, their value in force and the changes, for the deployer (through ops)
//   POST /internal/limit-changes  {"id","change","result","why"?}   the deployer's word that Guard has a changed limit ("active") or that it failed. Saved like any event; the
//                                                runtime's core settles the change in a step. It cannot make a change, only settle one the runtime made.
//   GET  /status                                counts only, never message content (bearer token)
//   GET  /internal/refund-context?receipt=...   read-only: the booking or fee behind a refund Guard holds, for the approvals relay (bearer token)
//   GET  /internal/feed-notice                  block S phase B2 (bearer token, the inbox's): the signed "my feed changed" notice to carry to the directory, or 204 when nothing changed, one went less than
//                                                a minute ago, the switch is off or the shop has no address on the pages domain. {"notice", "fingerprint"}
//   POST /internal/feed-notice  {"fingerprint"} the inbox's word that the notice reached the directory (so the next one waits a minute and only a real change sends another)
//   GET  /healthz                               the process is up
//   GET  /readyz                                the store can be read and the queue is going
//
// The shop's channels (modules/channels: the booking page, its API, the MCP endpoint, the owner's private page), with the CHANNEL token, which is not the inbox's.
// It can send only a channel_request, an owner_action or (item 11f) an owner_signin, and read what the page shows: never a WhatsApp message, a payment event or an approval. Without a channel
// token these routes do not exist.
//   POST /internal/channel/events   {"events": [...]}   1 to 10 channel events; an owner_action also needs the owner's link (x-owner-link), checked here against the
//                                                     hash in the client folder, read on every request so a revoked link stops at once
//   (W1) a chat_message is also taken here (a guest's send in the chat on the shop's page); it needs no owner, and its per-guest and per-shop rates are checked here, before it is saved
//   GET  /internal/channel/chat?handle=<64 hex>[&after=N][&cid=<id>]   W1: a chat guest's thread (an empty one for a guest never seen), and where the send `cid` stands
//   GET  /internal/channel/offer?service=&from=YYYY-MM-DD&days=N   the services, prices and free times
//   GET  /internal/channel/request?handle=<64 hex>    one request by its handle's hash
//   GET  /internal/channel/parent?link=<64 hex>       item 11h (Fees): what a parent's private link opens, by the link's hash; 404 for a hash no parent has now
//   GET  /internal/channel/material?link=<64 hex>&batch=<id>[&file=<id>]   Classes (Fees add-on): the reading material of one batch for the parent whose link has this hash now (the files'
//                                                     list, or one file as base64); 404 when the link opens nothing or no student of theirs in the batch may open it
//   GET  /internal/channel/owner                     what waits for the owner (x-owner-link needed)
//   GET  /internal/channel/documents?handle=<hash>|link=<hash>&lang=xx   the receipts, bills and refund notes of the page with that handle's (or parent link's) hash, newest first.
//                                                     Never by a case id: a holder of the channel token cannot walk the cases. Empty for a hash no page has.
//   GET  /internal/channel/accounting?period=2026-11|26-27   the accountant's files (journal CSV, documents CSV, README) for a period. ONLY with the owner's SESSION
//                                                     (x-owner-session): not the panel's link, and never the channel token alone.
//   GET  /internal/channel/owner-limits             the owner's limits page's data (the owner's credential): the limits, the changes, and whether THIS session was made with a passkey
//   POST /internal/channel/owner-limits  {"id","limit","to"}   a change from the owner's limits page; only with a session made by a PASSKEY (403 {"state":"passkey_needed"} otherwise)
//   GET  /internal/channel/listings                  block S: the shop's PUBLIC listings (live, not hidden, none sold or drafted) and the owner's switch and place; the channel token alone
//                                                     (the same things the shop's public page shows). Nothing private is in it.
//   POST /internal/channel/shop-feed  {page,name,languages,chat?}   block S phase B2: the shop's SIGNED feed (shop-feed/1), made here with the shop's own key; 404 while the owner's switch is off.
//   POST /internal/channel/shop-check {page,ids}                    the SIGNED answer to "do you still have these?" (shop-check/1), read from the record, at most 10 ids; every id gone while the switch is off
//   POST /internal/channel/shop-card  {page,card}                   the front's Agent Card for this shop, signed with the shop's key; refused unless every address in it is under the shop's page
//                                                     `page` must be an address of THIS shop (its pages file); nothing else the front says is signed. The key never leaves this process.
//   GET  /internal/channel/listing-photo?id=ph-<12 hex>   one photo's bytes with its own type: only a photo of a public listing now, or (with the owner's credential) any the shop holds
//   GET  /internal/channel/owner-listing             the owner's listings page's data (the owner's credential): the listings with their state, the photos waiting, the switch and place
//   POST /internal/channel/owner-listing  {"id","op":{...}}   an op from the owner's listings page (publish_form, edit, confirm, sold, remove, shop); the owner's credential; checked
//                                                     against the shop's rules first (422 {"why"} when it would be refused), then saved as an event the core runs in a step
//   POST /internal/channel/owner-photo               a photo from the owner's app (image/jpeg or image/webp, at most 1.5 MB); the owner's credential. The bytes are read, checked and
//                                                     cleaned HERE (listings/photo.ts: kind by magic number, size, dimensions, EXIF and XMP removed); the answer is {"photo": {...}}
//   POST /internal/channel/owner-voice               items 11d and 11e: a recording from the owner's page (audio/ogg or audio/webm, at most 256 KB), with the owner's credential;
//                                                     held in memory only, and an owner_message carrying its reference is saved (never the audio)
// An owner_message (the owner's talk box) needs the owner's credential too, like an owner_action.
//
// Item 11f, the owner's sign-in on the shop's page (modules/channels/owner-access.ts, owner-signin.ts). The owner's credential above is the panel-made link
// (x-owner-link) OR a session made here (x-owner-session); both are checked HERE, against this runtime's own files, never at the front.
//   GET  /internal/channel/owner-signin   x-owner-signin: <link>     what the link is now (valid, used, expired, replaced, unknown); nothing is used up
//   POST /internal/channel/owner-signin   x-owner-signin: <link>     use the link up (once) and make a session: {"session", "expires_at_ms"}, or 403 {"state"}
//   POST /internal/channel/owner-signout  x-owner-session: <token>   end that session
//   POST /internal/channel/owner-phones   x-owner-session: <token>   {"op": "list" | "dismiss" | "remove" {id, confirm_last?} | "codes" | "add_phone" | "cancel_removal"}: the owner's
//                                         own list of phones and what they control (owner's item 2); a session only, and "codes" and "add_phone" only from a passkey session
//   GET  /internal/owner-session          x-owner-session, with the INBOX's internal token: 204 when the session is good. The approvals relay asks this, so it
//                                         never takes the front's word for who the owner is.
// Item 11h, passkeys (owner-access.ts, webauthn.ts): one route, the step in the body. Every check is HERE; the front carries the browser's answers.
//   POST /internal/channel/owner-passkey  {"op": "grant_state" | "register_options" | "register", "grant": {"kind": "setup", "token"} | {"kind": "recovery", "code"}, "response"?}
//                                         {"op": "status"} | {"op": "signin_options"} | {"op": "signin", "response"}
//                                         answers {state} | {options} | {session, expires_at_ms} | {count, options?}, or 403 {state | why}
// Item 11h, web push (modules/push): one route, the step in the body. The owner's steps need the owner's credential, as an owner_action does; a customer's name
// their page by its handle's hash, and only a page made on the page or through MCP (a WhatsApp customer hears on WhatsApp) can take alerts.
//   POST /internal/channel/push  {"op": "key"} | {"op": "owner_state" | "owner_subscribe" | "owner_unsubscribe" | "owner_choice", ...} (owner's credential)
//                                | {"op": "customer_state" | "customer_subscribe" | "customer_unsubscribe", "handle": <hash>, ...}
//
// The runtime never holds a webhook secret: the inbox checked each provider's signature before it called us. The bearer
// token only says the caller is our own inbox. Bind to 127.0.0.1 or a private network, never the open internet.
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { checkEvents, checkRecovery } from "./events.ts";
import { DEFAULT_PORT } from "./config.ts";
import { CHAT_LIMITS, createRate } from "../channels/chat.ts";
import { checkOwnerLimit, checkSettled } from "../limits/runtime-limits.ts";
import type { LimitsView } from "../limits/runtime-limits.ts";
import type { IncomingEvent } from "./events.ts";
import { checkChannelEvent } from "../channels/events.ts";
import { MAX_VOICE_BYTES } from "../channels/owner-audio.ts";
import { MAX_PHOTO_BYTES, PHOTO_ID, checkPhoto, photoIdOf } from "../listings/photo.ts";
import { checkOwnerListing } from "../listings/kit.ts";
import { checkIds } from "../listings/protocol.ts";
import { underPage } from "./shop-protocol.ts";
import { checkOwnerStock } from "../stock/kit.ts";
import { HANDLE_HASH } from "../channels/handle.ts";
import { OWNER_LINK_HEADER, ownerTokenMatches } from "../channels/owner-link.ts";
import { OWNER_SESSION_HEADER, OWNER_SIGNIN_HEADER } from "../channels/owner-access.ts";
import type { AssertionResponse, RegistrationResponse } from "../channels/owner-access.ts";
import type { Grant } from "../channels/owner-grants.ts";
import { OWNER_FILE_ID } from "../channels/owner-file.ts";
import type { OwnerFileStore } from "./owner-file.ts";
import type { Push } from "../push/push.ts";
import { OWNER_CHOICES } from "../push/store.ts";
import type { BrowserSubscription, OwnerChoice } from "../push/store.ts";
import { chatConversationOf, conversationOf } from "../channels/conversation.ts";
import type { ChatIdentityRoutes } from "../channels/chat-identity-http.ts";
import type { OwnerAccessEvent, OwnerSignin } from "../channels/owner-signin.ts";
import { CODES_ALERT, NEW_PHONE_ALERT, REMOVED_ALERT, phoneLabel } from "../channels/owner-phones.ts";
import type { OwnerLinkFile } from "../channels/owner-link.ts";
import type { RuntimeChannel } from "./core.ts";
import { LANGUAGES } from "../language/languages.ts";
import type { Language } from "../language/languages.ts";

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
  /** "Limits, tightened by a tap": the limits the owner may change and the changes so far, from the last saved state. Left out: no limit routes. */
  limits?: { view(): LimitsView };
}

export const MAX_BODY_BYTES = 256 * 1024;
export { DEFAULT_PORT };

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
  /** "Get my shop's file": the file the server copied for the owner, given to the owner's SESSION once (owner-file.ts). Left out with the sign-in: no file is ever served. */
  ownerFile?: OwnerFileStore;
  /** Item 11h: the shop's web push (subscriptions and the owner's choice), and whether the shop has WhatsApp (the choice is offered only then). */
  push?: Push;
  hasWhatsApp?: boolean;
  /** W2: a chat guest's identity (keep this chat, a new phone, delete my chat) and the door's translations (modules/channels/chat-identity-http.ts). Left out: every guest is the cookie alone. */
  chatIdentity?: ChatIdentityRoutes;
  /** Block S phase B2: the shop's page addresses (pages.json), read on every call. A signed document is made only for an address that is this shop's (`url` on the pages domain, or `base`); without it, none is. */
  pages?: () => { base: string; url?: string } | undefined;
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
  const recordAccess = (what: OwnerAccessEvent["what"], session: string, how?: OwnerAccessEvent["how"], ask?: string, label?: string): void => {
    runtime.submit([{ kind: "owner_access", id: randomUUID(), what, session, ...(how ? { how } : {}), ...(ask ? { ask } : {}), ...(label ? { label } : {}) }]);
    runtime.kick();
  };

  /** W1: the chat's rates, in memory (a restart forgetting them costs nothing; what must survive a restart is the saved day's caps, chat.ts). */
  const chatRate = createRate();
  const chatAllowed = (e: { handle: string }): boolean => {
    const known = runtime.channel?.chatState(e.handle).known === true;
    return chatRate.take(`g ${e.handle}`, CHAT_LIMITS.perMinute, 60_000)
      && chatRate.take("shop", CHAT_LIMITS.shopPer10Min, 10 * 60_000)
      && (known || chatRate.take("new", CHAT_LIMITS.newGuestsPerHour, 60 * 60_000));
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
        // W1: a guest's send is counted before anything is saved, so a flood saves no task and costs no step; the same send again (a retry) is not counted twice
        // W2: a parent's link becomes the parent's own thread, any other guest hash the thread a passkey or a link tied it to; both before the counts, which are per thread
        if (checked.event.kind === "chat_message" && !(options.chatIdentity ? options.chatIdentity.openEvent(checked.event) : checked.event.parent === undefined)) return send(res, 403, { error: "That link opens nothing now." });
        if (checked.event.kind === "chat_message" && !chatAllowed(checked.event)) return send(res, 429, { error: "Too many messages. Wait a minute.", rate: true }, { "retry-after": "60" });
        events.push(checked.event);
      }
      const counts = runtime.submit(events); // on disk when this returns
      send(res, 200, counts);
      runtime.kick();
      return;
    }
    if (path === "/internal/channel/chat") {
      only("GET");
      const handle = url.searchParams.get("handle") ?? "";
      if (!HANDLE_HASH.test(handle)) return send(res, 400, { error: "handle is the guest's hash: 64 hex digits." });
      const after = url.searchParams.get("after");
      const cid = url.searchParams.get("cid") ?? undefined;
      if (after !== null && !/^\d{1,9}$/u.test(after)) return send(res, 400, { error: "after is a line number." });
      if (cid !== undefined && !/^[A-Za-z0-9-]{1,64}$/u.test(cid)) return send(res, 400, { error: "cid is a send's id." });
      const parent = url.searchParams.get("parent") ?? undefined;
      if (parent !== undefined && !HANDLE_HASH.test(parent)) return send(res, 400, { error: "parent is a private link's hash: 64 hex digits." });
      const thread = options.chatIdentity ? options.chatIdentity.openRead(handle, parent) : parent === undefined ? handle : undefined; // W2: the thread this guest or parent is tied to
      if (!thread) return send(res, 404, { error: "That link opens nothing now." });
      return send(res, 200, channel.chat(thread, { ...(after !== null ? { after: Number(after) } : {}), ...(cid ? { cid } : {}) }));
    }
    // W2: keep this chat, open it on another phone, a new phone's link, delete my chat (one route; the front sends the browser's answers and the guest's hash, nothing else)
    if (path === "/internal/channel/chat-id") {
      only("POST");
      if (!options.chatIdentity) return send(res, 404, { error: "This shop has no chat identity." });
      let body: unknown;
      try { body = JSON.parse(await readBody(req, 32 * 1024)); } catch (e) {
        if (e instanceof HttpError) { res.once("finish", () => req.destroy()); return send(res, e.status, { error: e.message }, { connection: "close" }); }
        return send(res, 400, { error: "The body must be JSON." });
      }
      const r = await options.chatIdentity.call(typeof body === "object" && body !== null ? body as Record<string, unknown> : {});
      return send(res, r.status, r.body);
    }
    // W1 hold-to-talk: a chat guest's recording, from the shop's front (which checked the page's own origin and rates). Held in this process's memory only, in a drop of its own;
    // the saved event carries its reference, never the audio. The guest is named by the hash of their handle, as for every chat route; nothing else of the request is trusted.
    if (path === "/internal/channel/chat-voice") {
      only("POST");
      if (!channel.chatVoice) return send(res, 404, { error: "Voice is not on for this shop." });
      const handle = url.searchParams.get("handle") ?? "";
      const language = url.searchParams.get("lang") ?? "";
      const id = url.searchParams.get("id") ?? "";
      if (!HANDLE_HASH.test(handle)) return send(res, 400, { error: "handle is the guest's hash: 64 hex digits." });
      if (!(LANGUAGES as readonly string[]).includes(language)) return send(res, 400, { error: `lang is one of ${LANGUAGES.join(", ")}.` });
      if (!/^[A-Za-z0-9-]{1,64}$/u.test(id)) return send(res, 400, { error: "id is a send's id." });
      const kind = /^audio\/(ogg|webm)\b/iu.exec(header(req, "content-type") ?? "")?.[1]?.toLowerCase();
      if (!kind) return send(res, 415, { error: "Send the recording as audio/ogg or audio/webm (Opus)." });
      const event = { kind: "chat_message" as const, id, handle, language: language as Language };
      if (!chatAllowed(event)) return send(res, 429, { error: "Too many messages. Wait a minute.", rate: true }, { "retry-after": "60" });
      let bytes: Buffer;
      try { bytes = await readBytes(req, MAX_VOICE_BYTES); } catch (e) {
        if (e instanceof HttpError) { res.once("finish", () => req.destroy()); return send(res, e.status, { error: e.message }, { connection: "close" }); }
        throw e;
      }
      if (bytes.length === 0) return send(res, 400, { error: "The recording is empty." });
      // the type is written by us, not copied from the request
      const ref = channel.chatVoice({ bytes: new Uint8Array(bytes), mime: `audio/${kind}; codecs=opus` });
      const counts = runtime.submit([{ ...event, voice: ref }]);
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
    // Classes (Fees add-on): a batch's reading material for a parent's private link. The runtime checks the link by its hash AND that a student of theirs may open this batch now.
    if (path === "/internal/channel/material") {
      only("GET");
      const link = url.searchParams.get("link") ?? "";
      const batch = url.searchParams.get("batch") ?? "";
      const file = url.searchParams.get("file") ?? undefined;
      if (!HANDLE_HASH.test(link)) return send(res, 400, { error: "link is the link's hash: 64 hex digits." });
      if (!/^[a-z0-9-]{1,40}$/u.test(batch) || (file !== undefined && !/^[0-9a-f]{12}$/u.test(file))) return send(res, 400, { error: "batch is a batch id and file a file id (12 hex digits)." });
      const answer = channel.material ? await channel.material(link, batch, file) : null;
      return answer ? send(res, 200, answer) : send(res, 404, { error: "Nothing is open here." });
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
        // the front passes the browser's User-Agent; only its coarse label ("Android, Chrome") is kept, never the User-Agent itself
        const label = phoneLabel(body.ua);
        const done = signin.register(grant, body.response as RegistrationResponse, label);
        if (!done.ok) return send(res, 403, { state: done.state, ...("why" in done && done.why ? { why: done.why } : {}) });
        recordAccess("passkey_added", done.passkey, grant.kind, undefined, label);
        // the lock: every owner alert subscription made before it (or from a link) belongs to no phone of the owner's, so the Operator who subscribed their own phone at the
        // setup visit stops hearing the shop here
        if (done.firstOfLock) options.push?.dropUnbound();
        recordAccess("signed_in", done.id, "passkey");
        // a new phone is announced: the owner's other phones with alerts on get a push now (the others see a banner on their next open). The first phone has no "other".
        if (options.push?.on && signin.passkeys().length > 1) options.push.owner(NEW_PHONE_ALERT(signin.now(), label)[signin.ownerLanguage], "phones");
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
    // ---- owner's item 2: "Phones that can open your shop". ONLY a session made here (never the panel's link, which the Operator holds): the owner's own list of phones,
    // the news of a new one, removing one, their own recovery codes, "add a phone", and cancelling the Operator's request to remove every phone. Every rule is checked HERE.
    if (path === "/internal/channel/owner-phones") {
      only("POST");
      let body: Record<string, unknown>;
      try { body = JSON.parse(await readBody(req, 4 * 1024)) as Record<string, unknown>; } catch (e) {
        if (e instanceof HttpError) { res.once("finish", () => req.destroy()); return send(res, e.status, { error: e.message }, { connection: "close" }); }
        return send(res, 400, { error: "The body must be JSON." });
      }
      const signin = options.ownerSignin;
      const session = header(req, OWNER_SESSION_HEADER);
      const good = session !== undefined && signin?.passkeysOn() ? signin.check(session) : undefined;
      if (!signin || !session || !good) return send(res, 403, { state: "signed_out" });
      const op = body.op;
      if (op === "list") {
        const v = signin.phones(session);
        if (!v) return send(res, 403, { state: "signed_out" });
        // the alerts that reach the owner's phones, each with the phone it came from (the phones page lists them with Stop)
        const alerts = (options.push?.on ? options.push.ownerSubs() : []).map((a) => ({ id: a.id, madeAt: a.madeAt, ...(v.phones.find((p) => p.id === a.ref)?.label ? { label: v.phones.find((p) => p.id === a.ref)!.label! } : {}) }));
        return send(res, 200, { ...v, alerts, language: signin.ownerLanguage, now: signin.now() });
      }
      if (op === "stop_alert") {
        // only a passkey session (a phone of the owner's) may stop an alert subscription
        if (signin.passkeyOf(session) === undefined) return send(res, 403, { state: "passkey_needed" });
        const done = typeof body.id === "string" && options.push?.dropOwnerSub(body.id.slice(0, 32)) === true;
        return send(res, done ? 200 : 404, { stopped: done });
      }
      if (op === "dismiss") { signin.dismissPhones(session, typeof body.through === "number" ? body.through : undefined); return send(res, 200, { ok: true }); }
      if (op === "remove") {
        const r = signin.removePhone(session, typeof body.id === "string" ? body.id.slice(0, 32) : "", body.confirm_last === true);
        if (!r.ok) return send(res, r.why === "session" ? 403 : r.why === "last" ? 409 : 404, { state: r.why });
        recordAccess("phone_removed", r.removed.id, undefined, undefined, r.removed.label);
        // the alerts that phone asked for end with it, and every other phone is told (banner on its next open, and a push now)
        options.push?.dropRef(r.removed.id);
        if (options.push?.on) options.push.owner(REMOVED_ALERT(signin.now(), r.removed.label ?? "")[signin.ownerLanguage], "phones");
        return send(res, 200, { ok: true, wasLast: r.wasLast });
      }
      if (op === "codes") {
        const codes = signin.makeCodes(session);
        if (!codes) return send(res, 403, { state: "passkey_needed" });
        recordAccess("codes_made", good.id);
        // a set of codes is a way back in: the owner's other phones are told, like a new phone
        if (options.push?.on) options.push.owner(CODES_ALERT(signin.now(), "")[signin.ownerLanguage], "phones");
        return send(res, 200, { codes });
      }
      if (op === "add_phone") {
        const made = signin.addPhone(session);
        return made ? send(res, 200, { url: made.url, expires_at_ms: made.expiresAt }) : send(res, 403, { state: "passkey_needed" });
      }
      if (op === "cancel_removal") {
        const done = signin.cancelRemoval(session);
        if (done) { recordAccess("removal_cancelled", good.id); }
        return send(res, 200, { cancelled: done });
      }
      return send(res, 400, { error: "op is list, dismiss, remove, codes, add_phone or cancel_removal." });
    }
    if (path === "/internal/channel/owner-signout") {
      only("POST");
      const ended = options.ownerSignin?.end(header(req, OWNER_SESSION_HEADER) ?? "");
      if (ended) recordAccess("signed_out", ended);
      return send(res, 200, { ended: ended !== undefined });
    }
    // ---- item 11h: web push ----
    if (path === "/internal/channel/push") {
      only("POST");
      let body: Record<string, unknown>;
      try { body = JSON.parse(await readBody(req, 8 * 1024)) as Record<string, unknown>; } catch (e) {
        if (e instanceof HttpError) { res.once("finish", () => req.destroy()); return send(res, e.status, { error: e.message }, { connection: "close" }); }
        return send(res, 400, { error: "The body must be JSON." });
      }
      const push = options.push;
      const op = typeof body.op === "string" ? body.op : "";
      if (!push || !push.on) return send(res, op === "key" ? 200 : 404, { on: false });
      if (op === "key") return send(res, 200, { on: true, publicKey: push.publicKey(), ...(push.relayKey() ? { relayKey: push.relayKey() } : {}) });
      const whatsapp = options.hasWhatsApp === true;
      if (op.startsWith("owner_")) {
        if (!ownerAuthorised(req)) return send(res, 403, { error: "The owner's link is not valid (it may have been revoked)." });
        // The panel's owner link is the OPERATOR's: once the owner holds a passkey it may not subscribe a phone to the owner's alerts (which can carry what the shop says to
        // the owner), change the owner's choice or drop a subscription. Only a signed-in session may, and a subscription is tied to the phone (passkey) it was made from.
        const session = header(req, OWNER_SESSION_HEADER);
        const ownerSession = session !== undefined && options.ownerSignin?.check(session) !== undefined ? session : undefined;
        if (!ownerSession && op !== "owner_state" && options.ownerSignin?.passkeysOn() && options.ownerSignin.lockState().locked) return send(res, 403, { error: "Sign in with the owner's phone to change alerts." });
        if (op === "owner_subscribe") {
          const ref = ownerSession ? options.ownerSignin?.passkeyOf(ownerSession) : undefined;
          // once locked, only a PHONE (a passkey session) may subscribe: a subscription with no phone could never be ended by removing one
          if (!ref && options.ownerSignin?.passkeysOn() && options.ownerSignin.lockState().locked) return send(res, 403, { error: "Sign in with your phone's fingerprint to turn on alerts." });
          const r = push.subscribe("owner", body.subscription as BrowserSubscription, "own", ref);
          if (!r.ok) return send(res, 400, { error: r.why });
          // the first phone with alerts: both ways for a shop with WhatsApp (the owner can then pick), push alone for one without
          if (push.ownerPhones() === 1 && push.choice() === "whatsapp") push.setChoice(whatsapp ? "both" : "push");
        } else if (op === "owner_unsubscribe") {
          if (typeof body.endpoint !== "string") return send(res, 400, { error: "Send the endpoint to stop." });
          push.unsubscribe("owner", body.endpoint);
        } else if (op === "owner_choice") {
          if (!OWNER_CHOICES.includes(body.choice as OwnerChoice)) return send(res, 400, { error: `choice is one of ${OWNER_CHOICES.join(", ")}.` });
          if (!whatsapp && body.choice !== "push") return send(res, 400, { error: "This shop has no WhatsApp: alerts come by push." });
          push.setChoice(body.choice as OwnerChoice);
        } else if (op !== "owner_state") return send(res, 400, { error: "op is not one this route knows." });
        return send(res, 200, { on: true, whatsapp, choice: whatsapp ? push.choice() : "push", phones: push.ownerPhones() });
      }
      if (op.startsWith("customer_")) {
        const handle = typeof body.handle === "string" ? body.handle : "";
        if (!HANDLE_HASH.test(handle)) return send(res, 400, { error: "handle is the handle's hash: 64 hex digits." });
        // batch 3 (Fees): a parent's private page has alerts too, keyed by the PARENT (`parent:<ref>`, the stable ref of their number), not by the link, which is made
        // again at the first reminder after a restart. The Fees messaging pushes a message to the parent's number to this same conversation.
        // W1: a chat guest's alerts, keyed by their conversation. Offered only after the shop has answered (the page shows the button then; this is the check that holds
        // when a page is not honest): a guest the runtime has never seen, or one nobody has answered, takes none.
        const thread = options.chatIdentity?.openRead(handle) ?? handle; // W2: a phone tied to a thread has that thread's alerts
        const chatSt = channel.chatState(thread);
        if (chatSt.known) {
          if (op === "customer_subscribe" && !chatSt.answered) return send(res, 403, { error: "Alerts are offered after the first answer." });
          const who = chatConversationOf(thread);
          if (op === "customer_subscribe") {
            const r = push.subscribe(who, body.subscription as BrowserSubscription, body.signer === "streetlist" ? "streetlist" : "own");
            if (!r.ok) return send(res, 400, { error: r.why });
          } else if (op === "customer_unsubscribe") {
            if (typeof body.endpoint !== "string") return send(res, 400, { error: "Send the endpoint to stop." });
            push.unsubscribe(who, body.endpoint);
          } else if (op !== "customer_state") return send(res, 400, { error: "op is not one this route knows." });
          return send(res, 200, { on: true, phones: push.phones(who), answered: chatSt.answered });
        }
        const parentView = channel.parent?.(handle) as { ref?: unknown } | null | undefined;
        const parentWho = typeof parentView?.ref === "string" && /^p-[0-9a-f]{12}$/u.test(parentView.ref) ? `parent:${parentView.ref}` : undefined;
        const view = parentWho ? null : channel.view(handle) as { channel?: unknown } | null;
        // only a page made on the page or through MCP: a WhatsApp customer hears on WhatsApp, and a fee page belongs to a parent who does
        const ch = view?.channel === "web" || view?.channel === "mcp" ? view.channel : undefined;
        if (!ch && !parentWho) return send(res, 404, { error: "No page with alerts has this handle." });
        const who = parentWho ?? conversationOf(ch!, handle);
        if (op === "customer_subscribe") {
          const r = push.subscribe(who, body.subscription as BrowserSubscription, body.signer === "streetlist" ? "streetlist" : "own");
          if (!r.ok) return send(res, 400, { error: r.why });
        } else if (op === "customer_unsubscribe") {
          if (typeof body.endpoint !== "string") return send(res, 400, { error: "Send the endpoint to stop." });
          push.unsubscribe(who, body.endpoint);
        } else if (op !== "customer_state") return send(res, 400, { error: "op is not one this route knows." });
        return send(res, 200, { on: true, phones: push.phones(who) });
      }
      return send(res, 400, { error: "op is key, owner_* or customer_*." });
    }
    // Integration of items 11d and 11e: a recording the owner made on their page. The owner is checked HERE, as for every owner event; the audio is held in this
    // process's memory only (the kit's ownerVoice, modules/channels/owner-audio.ts) and the saved event carries its reference, never the audio.
    if (path === "/internal/channel/owner-voice") {
      only("POST");
      if (!ownerAuthorised(req)) return send(res, 403, { error: "The owner's link is not valid (it may have been revoked)." });
      if (!channel.ownerVoice) return send(res, 404, { error: "Voice is not on for this shop's assistant." });
      const type = header(req, "content-type") ?? "";
      // Ogg Opus, or (item 11i) WebM Opus, the only kind Android's Chrome records; nothing else reaches the drop
      const kind = /^audio\/(ogg|webm)\b/iu.exec(type)?.[1]?.toLowerCase();
      if (!kind) return send(res, 415, { error: "Send the recording as audio/ogg or audio/webm (Opus)." });
      let bytes: Buffer;
      try { bytes = await readBytes(req, MAX_VOICE_BYTES); } catch (e) {
        if (e instanceof HttpError) { res.once("finish", () => req.destroy()); return send(res, e.status, { error: e.message }, { connection: "close" }); }
        throw e;
      }
      if (bytes.length === 0) return send(res, 400, { error: "The recording is empty." });
      // the type is written by us, not copied from the request: the page records Opus in either box
      const ref = channel.ownerVoice({ bytes: new Uint8Array(bytes), mime: `audio/${kind}; codecs=opus` });
      const counts = runtime.submit([{ kind: "owner_message", id: randomUUID(), text: "", voice: ref }]);
      send(res, 200, counts);
      runtime.kick();
      return;
    }
    // "Limits, tightened by a tap": the owner's own limits page. Reading needs the owner's credential (link or session); CHANGING needs a session made with a PASSKEY,
    // checked here against this runtime's own sessions (a link on WhatsApp is not enough: decision 27, loosening is outside the chat). The runtime decides the direction and
    // the bounds again in the step (modules/limits/runtime-limits.ts); the page cannot ask for more than the template allows.
    if (path === "/internal/channel/owner-limits") {
      if (!runtime.limits) throw new HttpError(404, "There is nothing here.");
      if (!ownerAuthorised(req)) return send(res, 403, { error: "The owner's link is not valid (it may have been revoked)." });
      const session = header(req, OWNER_SESSION_HEADER);
      const passkey = session !== undefined && options.ownerSignin?.checkPasskey?.(session) !== undefined;
      if (req.method === "GET") return send(res, 200, { ...runtime.limits.view(), passkey });
      only("POST");
      if (!passkey) return send(res, 403, { state: "passkey_needed", error: "Changing a limit needs you signed in with your passkey." });
      let body: unknown;
      try { body = JSON.parse(await readBody(req, 2048)); } catch (e) {
        if (e instanceof HttpError) { res.once("finish", () => req.destroy()); return send(res, e.status, { error: e.message }, { connection: "close" }); }
        return send(res, 400, { error: "The body must be JSON." });
      }
      const checked = checkOwnerLimit(body);
      if (!checked.ok) return send(res, 400, { error: checked.error });
      const counts = runtime.submit([checked.event]);
      send(res, 200, counts);
      runtime.kick();
      return;
    }
    // ---- block S: the shop's listings ----
    if (path === "/internal/channel/listings") {
      only("GET");
      if (!channel.listings) throw new HttpError(404, "There is nothing here.");
      return send(res, 200, channel.listings.publicRead());
    }
    if (path === "/internal/channel/listing-photo") {
      only("GET");
      if (!channel.listings) throw new HttpError(404, "There is nothing here.");
      const id = url.searchParams.get("id") ?? "";
      if (!PHOTO_ID.test(id)) return send(res, 400, { error: "id is a photo id: ph- and 12 hex digits." });
      // the owner (their link or session) may fetch any photo the shop holds, for the drafts on their page; everyone else only the photos of a public listing
      const row = ownerAuthorised(req) ? channel.listings.ownerPhoto(id) ?? channel.listings.publicPhoto(id) : channel.listings.publicPhoto(id);
      if (!row) throw new HttpError(404, "There is nothing here.");
      res.writeHead(200, { "content-type": row.type, "content-length": row.bytes.length, "x-content-type-options": "nosniff", "cache-control": "private, max-age=3600" });
      res.end(Buffer.from(row.bytes));
      return;
    }
    // block S phase B2: the signed feed, check answer and card. The runtime builds and signs; the front only passes the page's address and the ids. The key is this process's alone.
    if (path === "/internal/channel/shop-feed" || path === "/internal/channel/shop-check" || path === "/internal/channel/shop-card") {
      only("POST");
      const signed = channel.listings?.signed;
      if (!signed) throw new HttpError(404, "There is nothing here.");
      let body: unknown;
      try { body = JSON.parse(await readBody(req, path.endsWith("shop-card") ? 40 * 1024 : 4 * 1024)); } catch (e) {
        if (e instanceof HttpError) { res.once("finish", () => req.destroy()); return send(res, e.status, { error: e.message }, { connection: "close" }); }
        return send(res, 400, { error: "The body must be JSON." });
      }
      const q = typeof body === "object" && body !== null && !Array.isArray(body) ? body as Record<string, unknown> : {};
      const mine = options.pages?.();
      if (typeof q.page !== "string" || !mine || (q.page !== mine.url && q.page !== mine.base)) return send(res, 400, { error: "page is an address of this shop." });
      if (path.endsWith("shop-feed")) {
        const languages = Array.isArray(q.languages) ? q.languages.filter((l): l is string => typeof l === "string") : [];
        if (typeof q.name !== "string" || q.name.length === 0 || q.name.length > 120 || (q.chat !== undefined && !underPage(q.page, q.chat))) return send(res, 400, { error: "name is the shop's name; chat, when given, is under the shop's page." });
        const feed = signed.feed({ page: q.page, name: q.name, languages, ...(typeof q.chat === "string" ? { chat: q.chat } : {}) });
        return feed ? send(res, 200, feed) : send(res, 404, { error: "The shop does not show itself." });
      }
      if (path.endsWith("shop-check")) {
        const asked = checkIds({ ids: q.ids });
        if (!asked.ok) return send(res, 400, { error: asked.error });
        const answer = signed.check({ page: q.page, ids: asked.ids });
        return answer ? send(res, 200, answer) : send(res, 404, { error: "This shop cannot sign." });
      }
      const card = signed.card({ page: q.page, card: q.card });
      if (card === "bad") return send(res, 400, { error: "That is not a card for this shop." });
      return card ? send(res, 200, card) : send(res, 404, { error: "The shop does not show itself." });
    }
    if (path === "/internal/channel/owner-listing") {
      if (!channel.listings) throw new HttpError(404, "There is nothing here.");
      if (!ownerAuthorised(req)) return send(res, 403, { error: "The owner's link is not valid (it may have been revoked)." });
      if (req.method === "GET") return send(res, 200, channel.listings.ownerView());
      only("POST");
      let body: unknown;
      try { body = JSON.parse(await readBody(req, 8 * 1024)); } catch (e) {
        if (e instanceof HttpError) { res.once("finish", () => req.destroy()); return send(res, e.status, { error: e.message }, { connection: "close" }); }
        return send(res, 400, { error: "The body must be JSON." });
      }
      const checked = checkOwnerListing(body);
      if (!checked.ok) return send(res, 400, { error: checked.error });
      // the same rules the step will apply, asked now, so the page can say why before anything is saved (the step checks again: a race changes nothing the rules refuse)
      const why = channel.listings.check(checked.event.op);
      if (why) return send(res, 422, { why, error: `The shop's rules refuse that (${why}).` });
      const counts = runtime.submit([checked.event]);
      send(res, 200, counts);
      runtime.kick();
      return;
    }
    // block S phase A3: the owner's Stock page (the one shared stock count). Their credential, checked here; a customer has no route to it.
    if (path === "/internal/channel/owner-stock") {
      if (!channel.stock) throw new HttpError(404, "There is nothing here.");
      if (!ownerAuthorised(req)) return send(res, 403, { error: "The owner's link is not valid (it may have been revoked)." });
      if (req.method === "GET") { const lang = url.searchParams.get("lang") ?? undefined; return send(res, 200, channel.stock.ownerView(lang && LANGUAGES.includes(lang as Language) ? lang as Language : undefined)); }
      only("POST");
      let body: unknown;
      try { body = JSON.parse(await readBody(req, 4 * 1024)); } catch (e) {
        if (e instanceof HttpError) { res.once("finish", () => req.destroy()); return send(res, e.status, { error: e.message }, { connection: "close" }); }
        return send(res, 400, { error: "The body must be JSON." });
      }
      const checked = checkOwnerStock(body);
      if (!checked.ok) return send(res, 400, { error: checked.error });
      // the same rules the step will apply, asked now, so the page can say why before anything is saved (the step checks again: a race changes nothing the rules refuse)
      const why = channel.stock.check(checked.event);
      if (why) return send(res, 422, { why, error: `The shop's rules refuse that (${why}).` });
      const counts = runtime.submit([checked.event]);
      send(res, 200, counts);
      runtime.kick();
      return;
    }
    if (path === "/internal/channel/owner-photo") {
      only("POST");
      if (!channel.listings) throw new HttpError(404, "There is nothing here.");
      if (!ownerAuthorised(req)) return send(res, 403, { error: "The owner's link is not valid (it may have been revoked)." });
      // the type the phone says is not trusted (checkPhoto reads the bytes); only photo kinds get as far as being read
      if (!/^image\/(jpeg|webp)\b/iu.test(header(req, "content-type") ?? "")) return send(res, 415, { error: "Send the photo as image/jpeg or image/webp." });
      if (channel.listings.uploadsLeft() <= 0) return send(res, 429, { why: "day", error: "That is enough photos for today." });
      let bytes: Buffer;
      try { bytes = await readBytes(req, MAX_PHOTO_BYTES); } catch (e) {
        if (e instanceof HttpError) { res.once("finish", () => req.destroy()); return send(res, e.status, { error: e.message }, { connection: "close" }); }
        throw e;
      }
      const checked = checkPhoto(new Uint8Array(bytes));
      if (!checked.ok) return send(res, 422, { why: checked.why, error: "That is not a photo the shop can keep." });
      const id = photoIdOf(checked.bytes);
      channel.listings.putPhoto({ id, type: checked.type, width: checked.width, height: checked.height, bytes: checked.bytes });
      const photo = { id, type: checked.type, width: checked.width, height: checked.height, bytes: checked.bytes.length };
      const counts = runtime.submit([{ kind: "owner_photo", id, photo }]);
      send(res, 200, { photo, ...counts });
      runtime.kick();
      return;
    }
    if (path === "/internal/channel/owner") {
      only("GET");
      if (!ownerAuthorised(req)) return send(res, 403, { error: "The owner's link is not valid (it may have been revoked)." });
      return send(res, 200, channel.owner());
    }
    // the documents of one page's case or cases (Bookings, Orders: a handle's hash; Fees: a handle's hash or a parent link's hash), drawn in the page's language
    if (path === "/internal/channel/documents") {
      only("GET");
      if (!channel.documents) throw new HttpError(404, "There is nothing here.");
      const handle = url.searchParams.get("handle");
      const link = url.searchParams.get("link");
      const lang = url.searchParams.get("lang") ?? "en";
      if ((handle === null) === (link === null)) return send(res, 400, { error: "Send handle or link, one of them." });
      if (!HANDLE_HASH.test(handle ?? link ?? "")) return send(res, 400, { error: "handle and link are hashes: 64 hex digits." });
      if (!LANGUAGES.includes(lang as Language)) return send(res, 400, { error: "lang is en, hi, ml or kn." });
      return send(res, 200, { documents: channel.documents(handle !== null ? { handle } : { link: link! }, lang as Language) });
    }
    // the accountant's files: the owner's SESSION only, checked here against this runtime's own sessions (a link made in the panel does not open them)
    if (path === "/internal/channel/accounting") {
      only("GET");
      const session = header(req, OWNER_SESSION_HEADER);
      if (session === undefined || options.ownerSignin?.check(session) === undefined) return send(res, 403, { error: "The owner's session is not valid." });
      if (!channel.accountantFiles) throw new HttpError(404, "There is nothing here.");
      const period = url.searchParams.get("period") ?? "";
      if (!/^(\d{4}-(0[1-9]|1[0-2])|\d{2}-\d{2})$/u.test(period)) return send(res, 400, { error: "period is a month (2026-11) or a financial year (26-27)." });
      let files;
      try { files = channel.accountantFiles(period); } catch (e) { return send(res, 400, { error: (e as Error).message }); }
      return send(res, 200, { files });
    }
    // "Get my shop's file": the owner's SESSION only (a link made in the panel is the Operator's to hold and opens nothing here). No id: the state, for the owner's page.
    // With ?take=<id>: the bytes, once. The use is written down before the bytes leave, and the record gets "owner_file_taken" so the server can delete its copy.
    if (path === "/internal/channel/owner-file") {
      only("GET");
      const session = header(req, OWNER_SESSION_HEADER);
      const checked = session === undefined ? undefined : options.ownerSignin?.check(session);
      if (session === undefined || checked === undefined) return send(res, 403, { error: "The owner's session is not valid." });
      if (!options.ownerFile) throw new HttpError(404, "There is nothing here.");
      const take = url.searchParams.get("take");
      if (take === null) return send(res, 200, options.ownerFile.state());
      const got = OWNER_FILE_ID.test(take) ? options.ownerFile.take(take) : undefined;
      if (!got) throw new HttpError(404, "There is nothing here.");
      // the record names the session by its short id, as every other owner_access line does, NEVER by the token the browser sent: the record is read by the
      // deployer and kept in backups, and a live session token there would let anyone who reads it act as the owner (found by the Go port's contract, 19 Nov)
      recordAccess("file_taken", checked.id, undefined, got.meta.ask);
      res.writeHead(200, { "content-type": "application/gzip", "content-disposition": `attachment; filename="${got.meta.name}"`, "content-length": got.bytes.length, "cache-control": "no-store", "x-content-type-options": "nosniff" });
      res.end(got.bytes);
      return;
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
      // batch 3: how the owner can sign in and hear (counts only), for the panel's go-live: a shop with no WhatsApp may not go live until one passkey exists and one phone has alerts
      const signin = options.ownerSignin;
      // owner's item 2: `locked` (the owner holds a passkey, so the Operator's QR and card are closed) and the Operator's pending removal request, for the panel to SHOW; the
      // runtime has already decided both, whatever the panel does
      const lock = signin?.passkeysOn() ? signin.lockState() : undefined;
      const ownerAccess = {
        passkeys: signin?.passkeysOn() ? signin.passkeys().length : 0, alertPhones: options.push?.on ? options.push.ownerPhones() : 0,
        ...(lock ? { locked: lock.locked, ...(lock.removal ? { removal: { askedBy: lock.removal.askedBy, effectiveAt: new Date(lock.removal.effectiveAt).toISOString() } } : {}) } : {}),
      };
      return send(res, 200, { ...runtime.status(), ownerAccess });
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
    // the deployer's part of a limit change (through ops): what the runtime holds, and its word that Guard has the new value, or that the change failed
    if (path === "/internal/limit-changes") {
      if (!authorised(req)) return send(res, 401, { error: "A bearer token is needed." }, { "www-authenticate": "Bearer", ...closing });
      if (!runtime.limits) return send(res, 404, { error: "This shop has no limits the owner may change." });
      if (req.method === "GET") return send(res, 200, runtime.limits.view());
      only("POST");
      let body: unknown;
      try { body = JSON.parse(await readBody(req, 4096)); } catch (e) {
        if (e instanceof HttpError) { res.once("finish", () => req.destroy()); return send(res, e.status, { error: e.message }, closing); }
        return send(res, 400, { error: "The body must be JSON." });
      }
      const checked = checkSettled(body);
      if (!checked.ok) return send(res, 400, { error: checked.error });
      const counts = runtime.submit([checked.event]);
      send(res, 200, counts);
      runtime.kick();
      return;
    }
    // block S phase B2: the "my feed changed" notice, for the inbox to carry to the directory (the runtime has no route out; services/inbox.ts is on the network the directory is on). It only
    // reads and signs; the notice is a hint, and the directory takes nothing from it but "read the feed again".
    if (path === "/internal/feed-notice") {
      if (!authorised(req)) return send(res, 401, { error: "A bearer token is needed." }, { "www-authenticate": "Bearer", ...closing });
      const signed = runtime.channel?.listings?.signed;
      const page = options.pages?.()?.url; // only a shop on the pages domain has a feed address a directory accepts
      if (!signed || !page) { res.writeHead(204, { "cache-control": "no-store" }); return void res.end(); }
      if (req.method === "GET") {
        const next = signed.notice({ page });
        if (!next) { res.writeHead(204, { "cache-control": "no-store" }); return void res.end(); }
        return send(res, 200, next);
      }
      only("POST");
      let body: unknown;
      try { body = JSON.parse(await readBody(req, 1024)); } catch (e) {
        if (e instanceof HttpError) { res.once("finish", () => req.destroy()); return send(res, e.status, { error: e.message }, closing); }
        return send(res, 400, { error: "The body must be JSON." });
      }
      const fingerprint = (body as { fingerprint?: unknown } | null)?.fingerprint;
      if (typeof fingerprint !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(fingerprint)) return send(res, 400, { error: "fingerprint is the one the notice came with." });
      signed.delivered(fingerprint);
      return send(res, 200, { ok: true });
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
