// The owner-marked desk served on a server (B71 part 2): what lets an agent someone else wrote take UPI live, not only in the crash test. One desk per such agent, in
// the approvals relay's container (bundle/services/relay.ts starts it), because the relay already has the three things the desk needs on a server, the way a template's
// runtime has them for its own UPI flows:
//   - the owner's replies: the agent's inbox gives the relay every message from the owner's number (bundle/agent/inbox.ts), and the relay gives them to the desk
//     (`receive`), with a tapped button's id, which carries the one-use code;
//   - a way to tell the owner: the relay's own principal at the agent's WhatsApp Guard (`send` only), in the owner's language, in Bookings' words (an agent someone
//     else wrote has none of its own, as for the relay's refund asks), checked against the facts before it goes, as a template's messages are;
//   - a place to keep state: the relay's volume. The desk's ledger, the owner's messages not yet handled and the ids already handled are one file, written whole
//     (to a new file, flushed, then renamed over the old one) after every change, so a restart keeps every request, mark and refund owed.
//
// The agent never reaches this code directly: its address for UPI is its desk Guard (modules/payments/owner-marked/desk-guard.ts), which checks the agent's credential,
// applies the limits and records every call, and sends the call here with the agent's own desk token. The token says which agent's desk a call is for; a call with
// any other token is refused (`deskServer`). This listens on its own port (generate/guards.ts DESK_PORT), never the relay's.
//
// The record: every call the agent made is in its desk Guard's decisions, and what the owner marked is in the desk's lists, which the record job reads through the
// same Guard with the reading credential (bundle/agent/facts.ts, record.ts). So `record` here only logs a plain line: no number, no code, no customer.
//
// One thing at a time: the agent's calls, the owner's messages and the reminders go through one chain per desk, so two of them never change the ledger at once.
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Clock } from "../../modules/core/clock.ts";
import { ApiError, mayHaveHappened } from "../../modules/core/faults.ts";
import type { Language } from "../../modules/language/languages.ts";
import type { Messaging } from "../../modules/messaging/messaging.ts";
import { createDesk } from "../../modules/payments/owner-marked/desk.ts";
import type { Desk, DeskNotice } from "../../modules/payments/owner-marked/desk.ts";
import { emptyMarkState } from "../../modules/payments/owner-marked/ledger.ts";
import type { MarkState } from "../../modules/payments/owner-marked/ledger.ts";
import { readPaymentSettings } from "../../modules/payments/providers/index.ts";
import { checkMessage } from "../../templates/commerce/bookings/src/language/check.ts";
import { LABELS } from "../../templates/commerce/bookings/src/language/interactive.ts";
import { templateMessage } from "../../templates/commerce/bookings/src/language/meta-templates.ts";
import { TEMPLATE_NAMES, render } from "../../templates/commerce/bookings/src/language/templates.ts";
import type { MessageFacts, TemplateId } from "../../templates/commerce/bookings/src/language/templates.ts";
import { ensureDirs } from "../lib/util.ts";

/** What relay.json says about an agent's desk. Nothing secret: the token is a file in the relay's secrets folder (`desk_token`). */
export interface DeskConfig {
  /** The agent's payment block, as its settings have it: an owner-marked module, the shop's UPI ID and the name its customers see. */
  payment: unknown;
}

/** An owner's message as the inbox hands it over, with a tapped button's id when there was one. */
export interface OwnerMessage { id: string; from: string; text: string; timestamp: number; reply?: { id: string } }

/** The desk's file: the ledger, the owner's messages taken but not yet handled, the last ids handled (so a provider's redelivery is not a second answer), and when the owner last wrote. */
interface DeskFile { schema: 1; marks: MarkState; inbox: OwnerMessage[]; seen: string[]; ownerLastInboundMs?: number }
/** How many handled message ids are kept: far more than a provider redelivers. */
const SEEN_KEPT = 500;

export interface DeskHostOptions {
  name: string;
  config: DeskConfig;
  ownerWhatsapp: string;
  business: { name: string; timeZone: string; ownerLanguage: Language };
  /** The desk's file, in the relay's volume (<stateDir>/desk.json). */
  file: string;
  /** The relay's own principal at the agent's WhatsApp Guard. `window` says whether the owner wrote in the last 24 hours, from this desk's own file. */
  messaging: (window: { lastInboundAt(phone: string): number | undefined }) => Messaging;
  clock: Clock;
  log(line: string): void;
}

export interface DeskHost {
  /** An agent's call, from its desk Guard: method, path, query and parsed body. */
  handle(method: string, path: string, query: URLSearchParams, body: unknown): Promise<{ status: number; body: unknown }>;
  /** The owner's messages from the inbox: saved before this returns (so the inbox can answer the provider), handled right after, one at a time. */
  receive(messages: OwnerMessage[]): { saved: number; duplicates: number };
  /** The clock's share: reminders of refunds still owed. */
  tick(): Promise<void>;
  /** Resolves when everything started has been handled. */
  idle(): Promise<void>;
  /** Counts only: no number, no code. */
  status(): { requests: number; refundsOwed: number; messagesWaiting: number };
}

const sameNumber = (a: string, b: string) => a.replace(/\D/gu, "") === b.replace(/\D/gu, "");

/** Write the whole file to a new name, flush it to the disk, and rename it over the old one: a crash leaves the old file or the new one, never half of either. */
function writeDurable(path: string, text: string): void {
  ensureDirs(dirname(path));
  const tmp = join(dirname(path), `.desk-${process.pid}-${Date.now()}.tmp`);
  const fd = openSync(tmp, "w", 0o600);
  try { writeSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(tmp, path);
}

function readDeskFile(path: string): DeskFile {
  if (!existsSync(path)) return { schema: 1, marks: emptyMarkState(), inbox: [], seen: [] };
  const raw = JSON.parse(readFileSync(path, "utf8")) as DeskFile;
  if (raw?.schema !== 1 || !raw.marks || !Array.isArray(raw.marks.requests) || !Array.isArray(raw.inbox) || !Array.isArray(raw.seen)) throw new Error(`${path} is not a desk file this version can read.`);
  return raw;
}

export function createDeskHost(o: DeskHostOptions): DeskHost {
  const errors: string[] = [];
  const payment = readPaymentSettings(o.config.payment, errors);
  if (!payment || errors.length > 0) throw new Error(`${o.name}: the desk's payment block is not one it can use (${errors.join(" ") || "missing"}).`);
  const file = readDeskFile(o.file);
  const language = o.business.ownerLanguage;
  /** The owner's message being handled now: it leaves the inbox in the same write as the change it made, so a crash never handles it twice. */
  let handling: string | undefined;
  const save = () => {
    if (handling !== undefined) { const id = handling; file.inbox = file.inbox.filter((m) => m.id !== id); file.seen = [...file.seen, id].slice(-SEEN_KEPT); handling = undefined; }
    writeDurable(o.file, JSON.stringify(file));
  };
  const messaging = o.messaging({ lastInboundAt: (phone) => (sameNumber(phone, o.ownerWhatsapp) ? file.ownerLastInboundMs : undefined) });

  /** One notice to the owner, in Bookings' words, checked against its facts first. Buttons go only inside the window; outside it, the notice's approved template. */
  async function tellOwner(n: DeskNotice): Promise<boolean> {
    const facts = { language, timeZone: o.business.timeZone, businessName: o.business.name, services: [], ...n.facts } as MessageFacts;
    let text: string;
    try { text = render(n.template as TemplateId, facts); } catch (e) { o.log(`[${o.name}] desk: the notice ${n.template} could not be worded (${(e as Error).message}); the owner was not told.`); return false; }
    const verdict = checkMessage(text, facts);
    if (!verdict.ok) { o.log(`[${o.name}] desk: the notice ${n.template} did not match its facts (${verdict.problems.join(" ")}); it was not sent.`); return false; }
    try {
      if (!(await messaging.isWindowOpen(o.ownerWhatsapp))) await messaging.sendTemplate(o.ownerWhatsapp, templateMessage({ ids: [n.template as TemplateId], language, facts, text, generic: TEMPLATE_NAMES.owner }));
      else if (n.choices && n.choices.length > 0 && messaging.sendInteractive) await messaging.sendInteractive(o.ownerWhatsapp, { body: text, buttons: n.choices });
      else await messaging.sendText(o.ownerWhatsapp, text);
      return true;
    } catch (e) {
      if (mayHaveHappened(e)) return true; // it may have gone: sending it again could tell the owner twice
      if (e instanceof ApiError) { o.log(`[${o.name}] desk: the notice ${n.template} was not sent (${e.status}).`); return false; }
      throw e;
    }
  }

  const desk: Desk = createDesk({
    clock: o.clock, payment, owner: o.ownerWhatsapp, state: file.marks, save: () => save(),
    record: (e) => o.log(`[${o.name}] desk: ${e.action} ${e.outcome}`),
    tellOwner,
    labels: { received: LABELS[language].received, refundSent: LABELS[language].refundSent, keptForBooking: LABELS[language].keptForBooking },
  });

  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => { const run = chain.then(fn, fn); chain = run.then(() => undefined, () => undefined); return run; };

  /** Handle the owner's messages waiting in the file, oldest first. One that throws stays in the inbox and is tried again on the next tick. */
  async function drain(): Promise<void> {
    while (file.inbox.length > 0) {
      const m = file.inbox[0]!;
      handling = m.id;
      try { await desk.ownerSays({ from: m.from, text: m.text, ...(m.reply ? { reply: m.reply } : {}) }); }
      catch (e) {
        handling = undefined;
        // a message whose mark was saved has left the inbox already (only telling the owner failed); one that changed nothing stays, and is tried again
        o.log(`[${o.name}] desk: an owner's message ${file.inbox.some((x) => x.id === m.id) ? "could not be handled this time; it is tried again" : "was recorded, but the owner could not be told"} (${(e as Error).message}).`);
        return;
      }
      if (handling !== undefined) save(); // the message changed nothing (not a mark reply): it leaves the inbox now
    }
  }

  return {
    handle: (method, path, query, body) => serial(() => desk.handle(method, path, query, body)),
    receive(messages) {
      let saved = 0; let duplicates = 0;
      for (const m of messages) {
        if (!sameNumber(m.from, o.ownerWhatsapp)) continue; // only the owner's number ever marks anything (the desk checks it again)
        if (file.seen.includes(m.id) || file.inbox.some((x) => x.id === m.id)) { duplicates++; continue; }
        file.inbox.push({ id: m.id, from: m.from, text: m.text, timestamp: m.timestamp, ...(m.reply && typeof m.reply.id === "string" ? { reply: { id: m.reply.id } } : {}) });
        file.ownerLastInboundMs = Math.max(file.ownerLastInboundMs ?? 0, Math.min(Number.isFinite(m.timestamp) && m.timestamp > 0 ? m.timestamp : o.clock.now(), o.clock.now()));
        saved++;
      }
      if (saved > 0) { writeDurable(o.file, JSON.stringify(file)); void serial(drain).catch(() => undefined); }
      return { saved, duplicates };
    },
    tick: () => serial(async () => { await drain(); await desk.tick(); }),
    idle: () => chain.then(() => undefined),
    status: () => ({ requests: file.marks.requests.length, refundsOwed: file.marks.refunds.filter((r) => r.state === "owed").length, messagesWaiting: file.inbox.length }),
  };
}

// ---- the desk's port: one server for every agent's desk, each call told apart by its desk token ------------------------------------------------------------------

const MAX_BODY = 64 * 1024;
const sha256 = (t: string) => createHash("sha256").update(t).digest();

function reply(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body), "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(body);
}

function readBody(req: IncomingMessage): Promise<string | undefined> {
  return new Promise((resolve) => {
    if (Number(req.headers["content-length"] ?? 0) > MAX_BODY) { resolve(undefined); return; }
    const chunks: Buffer[] = []; let size = 0;
    req.on("data", (c: Buffer) => { size += c.length; if (size > MAX_BODY) { resolve(undefined); req.destroy(); return; } chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(undefined));
  });
}

/**
 * The desk port's handler. `desks` are the agents' desks, each with the token its desk Guard sends ("Authorization: Bearer <token>", read from the token's file on every
 * call, so a replaced token needs no restart). A call with no token, or one no desk has, is refused with 401 and touches nothing.
 */
export function deskServer(desks: { host: DeskHost; token: () => string | undefined }[]): (req: IncomingMessage, res: ServerResponse) => void {
  return async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://desk");
      if (url.pathname === "/healthz" && req.method === "GET") return reply(res, 200, { ok: true });
      const given = /^bearer\s+(\S+)$/iu.exec(req.headers.authorization ?? "")?.[1];
      const desk = given === undefined ? undefined : desks.find((d) => { const t = d.token(); return t !== undefined && t !== "" && timingSafeEqual(sha256(t), sha256(given)); });
      if (!desk) return reply(res, 401, { error: "The desk needs its Guard's token." });
      let body: unknown;
      if (req.method === "POST") {
        const text = await readBody(req);
        if (text === undefined) return reply(res, 413, { error: "The body is too large." });
        try { body = text === "" ? undefined : JSON.parse(text); } catch { return reply(res, 400, { error: "The body is not JSON." }); }
      }
      const answer = await desk.host.handle(req.method ?? "GET", url.pathname, url.searchParams, body);
      reply(res, answer.status, answer.body);
    } catch {
      if (!res.headersSent) reply(res, 500, { error: "The desk could not handle that. Send it again." });
    }
  };
}
