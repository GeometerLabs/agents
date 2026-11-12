// Webhooks: checking who sent them, and reading them into the events the agent understands. Pure functions; the inbox (inbox/) uses them,
// and the stand-ins use the signing half to send what the providers send. The agent runtime never imports this: it never holds a webhook secret.
// A payment provider's webhook is in its own folder (modules/payments/providers/<name>/webhook.ts) and uses the signing helpers here.
//
// Wire facts (read 3 Nov 2026):
//  - Meta signs the raw body: header X-Hub-Signature-256 is "sha256=" and the hex HMAC-SHA256 of the payload with the App Secret.
//    https://developers.facebook.com/docs/graph-api/webhooks/getting-started
//  - WhatsApp payload examples: https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages.md
//    (text.md, interactive.md, button.md, audio.md, status.md next to it)
//  - Gupshup's "v3" callbacks (read 11 Nov 2026) are Meta's body with `gs_app_id` beside `object`, and a Gupshup id (`gs_id`) on each status. They are not signed
//    (the inbox's path-token mode). https://partner-docs.gupshup.io/docs/events (updated 30 Oct 2026), and the pass-through page's examples
//    https://partner-docs.gupshup.io/docs/whatsapp-passthrough-apis-for-partners. The same parsers read both.
//  - Gupshup SELF-SERVE callbacks (item 11c, read 12 Nov 2026) are their own "version 2" shape, not Meta's: { app, timestamp (ms), version: 2, type: "message" | "message-event",
//    payload }. A message has payload { id, source, type, payload, sender, context? }; an event has payload { id, gsId?, type, destination, payload }. Not signed either.
//    https://docs.gupshup.io/docs/what-is-an-inbound-message.md, .../docs/interactive, .../docs/message-events.md, .../reference/postback-text-support.md.
//    The same two exported parsers read this shape (isGupshupSelfServe) so the inbox needs no second path.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { InboundMessage, MessageStatus, VoiceMediaRef } from "./messaging.ts";
import { asArray, isObject, num, str } from "../core/http.ts";

// ---- signatures --------------------------------------------------------------------------------------------------------------

/** The hex HMAC-SHA256 of a raw body: how Meta and most payment providers sign a webhook. */
export const hmacHex = (rawBody: Buffer, secret: string) => createHmac("sha256", secret).update(rawBody).digest("hex");

/** Compare two hex strings in constant time. A missing, short, long or non-hex value is simply false. */
export function sameHex(expected: string, given: string | undefined): boolean {
  if (typeof given !== "string" || given.length !== expected.length || !/^[0-9a-f]+$/iu.test(given)) return false;
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(given, "hex"));
}

/** The X-Hub-Signature-256 value Meta would send for this body: what the stand-in sends. */
export const signMeta = (rawBody: Buffer, appSecret: string): string => `sha256=${hmacHex(rawBody, appSecret)}`;

/** Is this body what Meta sent? The header must be "sha256=" and the hex digest. */
export function verifyMetaSignature(rawBody: Buffer, header: string | undefined, appSecret: string): boolean {
  if (appSecret.length === 0 || typeof header !== "string" || !header.startsWith("sha256=")) return false;
  return sameHex(hmacHex(rawBody, appSecret), header.slice("sha256=".length));
}

// ---- WhatsApp messages -------------------------------------------------------------------------------------------------------

/** Our numbers are E.164 with a plus. Meta writes `from` as digits only, so the plus is put back; anything that is not a number is not ours to answer. */
export function toE164(from: unknown): string | undefined {
  const digits = typeof from === "string" ? from.replace(/^\+/u, "") : "";
  return /^\d{6,15}$/u.test(digits) ? `+${digits}` : undefined;
}

/** What the customer wrote, as text: the words of a text message, or the label of the button or list row they tapped. */
function textOf(message: Record<string, unknown>): string | undefined {
  switch (message.type) {
    case "text": return isObject(message.text) ? str(message.text.body) : undefined;
    case "interactive": {
      const i = message.interactive;
      if (!isObject(i)) return undefined;
      const reply = isObject(i.button_reply) ? i.button_reply : isObject(i.list_reply) ? i.list_reply : undefined;
      return str(reply?.title);
    }
    case "button": return isObject(message.button) ? str(message.button.text) ?? str(message.button.payload) : undefined; // a template's quick-reply button
    default: return undefined; // locations, stickers ...: not understood yet (Deferred.md). A voice note and a picture are not text, but they are answered: see parseWhatsAppWebhook
  }
}

/** The id of the button or list row the customer tapped, and which kind it was. The id is one we made (language/interactive.ts); anything that is not a short plain id is dropped, and the title is read as words. */
function replyOf(message: Record<string, unknown>): InboundMessage["reply"] {
  if (message.type !== "interactive" || !isObject(message.interactive)) return undefined;
  const i = message.interactive;
  const kind = isObject(i.button_reply) ? "button" : isObject(i.list_reply) ? "list" : undefined;
  const id = str(isObject(i.button_reply) ? i.button_reply.id : isObject(i.list_reply) ? i.list_reply.id : undefined);
  return kind && id && /^[A-Za-z0-9:_.-]{1,200}$/u.test(id) ? { id, kind } : undefined;
}

/**
 * Where a voice note's audio can be fetched, from Meta's `audio` object (`id`, `mime_type`) or Gupshup's (the same, plus a `url`). Each part is kept only if it has the
 * shape of what it is (an id of plain characters, an https address, a type); anything else is dropped, and a note with neither an id nor an address has no media.
 * The sha256 and `voice` flags are not kept: nothing here needs them.
 */
export function mediaOf(audio: unknown): VoiceMediaRef | undefined {
  if (!isObject(audio)) return undefined;
  const id = str(audio.id);
  const url = str(audio.url);
  const mime = str(audio.mime_type);
  const ref: VoiceMediaRef = {
    ...(id && /^[A-Za-z0-9_-]{1,128}$/u.test(id) ? { id } : {}),
    ...(url && url.length <= 2048 && /^https:\/\/[^\s]+$/u.test(url) ? { url } : {}),
    ...(mime && /^[a-z0-9.+-]+\/[a-z0-9.+-]+(;\s*[a-z0-9=. -]+)?$/iu.test(mime) && mime.length <= 80 ? { mime } : {}),
  };
  return ref.id || ref.url ? ref : undefined;
}

/**
 * The customer messages in a WhatsApp webhook. Delivery statuses are read by parseWhatsAppStatuses, not here.
 * Messages with no id, no sender number or no words are left out. The timestamp is epoch seconds as a string; ours is milliseconds.
 *
 * A voice note or an audio file (`type: "audio"`; Meta marks a recorded voice note with `audio.voice: true`) has no words, but the person
 * is waiting, so it becomes a message with empty text and `voiceNote: true`. Nothing else of it is read: the media id and the file type in
 * the `audio` object are left behind on purpose, so the audio can never reach the agent, the saved events or the record.
 *
 * A picture (`type: "image"`, a screenshot of a payment, say) is the same: empty text and `image: true`, and nothing of the picture or its caption is kept. The agent
 * decides what to say (a screenshot is never proof of a payment: with UPI the owner confirms). Before UPI (B33) pictures were left out here.
 */
export function parseWhatsAppWebhook(body: unknown, options: { voiceMedia?: boolean } = {}): InboundMessage[] {
  if (!isObject(body)) return [];
  if (isGupshupSelfServe(body)) return parseSelfServeMessages(body, options);
  const out: InboundMessage[] = [];
  for (const entry of asArray(body.entry).filter(isObject)) {
    for (const change of asArray(entry.changes).filter(isObject)) {
      if (change.field !== "messages" || !isObject(change.value)) continue;
      for (const m of asArray(change.value.messages).filter(isObject)) {
        const id = str(m.id);
        const from = toE164(m.from);
        const voiceNote = m.type === "audio";
        // Only for a shop with voice on (B29): where the audio can be fetched. Otherwise nothing of the audio object is read, as before.
        const media = voiceNote && options.voiceMedia === true ? mediaOf(m.audio) : undefined;
        const image = m.type === "image";
        const text = voiceNote || image ? "" : textOf(m);
        if (!id || !from || text === undefined || (text.length === 0 && !voiceNote && !image)) continue;
        const seconds = Number(str(m.timestamp) ?? m.timestamp);
        const reply = replyOf(m);
        out.push({ id, from, text, timestamp: Number.isFinite(seconds) ? seconds * 1000 : 0, ...(voiceNote ? { voiceNote: true as const } : {}), ...(media ? { media } : {}), ...(image ? { image: true as const } : {}), ...(reply ? { reply } : {}) });
      }
    }
  }
  return out;
}

// ---- WhatsApp statuses -------------------------------------------------------------------------------------------------------

/** The statuses worth keeping: they say more than "accepted". "sent" and Gupshup's "enqueued" do not; Gupshup's set-callback check has no status at all. */
const KEPT_STATUSES = new Set<MessageStatus["status"]>(["delivered", "read", "failed"]);
/** An id as a provider writes one (wamid.HBgM..., a UUID): nothing that could be confused in a key or a log line. */
const STATUS_ID = /^[A-Za-z0-9._:=+/-]{1,256}$/u;

/** A status time: Meta writes seconds as a string; Gupshup writes seconds as a string or milliseconds as a number. Anything past the year 2286 in seconds is milliseconds. */
function statusTime(raw: unknown): number {
  const n = Number(str(raw) ?? raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n >= 1e10 ? Math.trunc(n) : n * 1000;
}

/**
 * The delivered, read and failed reports in a WhatsApp webhook (Meta's, or Gupshup's v3 which adds `gs_id`), in order. Each keeps the message's ids, who it was for,
 * when, and for a failure the provider's code and title: never anything the person wrote. A status with no id at all, or one we do not keep, is left out.
 * Gupshup's own failure before Meta ever saw the message ("Failed (internal)": template mismatch, say) has only `gs_id`, no wamid and no metadata: it is kept.
 */
export function parseWhatsAppStatuses(body: unknown): MessageStatus[] {
  if (!isObject(body)) return [];
  if (isGupshupSelfServe(body)) return parseSelfServeStatuses(body);
  const out: MessageStatus[] = [];
  for (const entry of asArray(body.entry).filter(isObject)) {
    for (const change of asArray(entry.changes).filter(isObject)) {
      if (change.field !== "messages" || !isObject(change.value)) continue;
      for (const s of asArray(change.value.statuses).filter(isObject)) {
        const status = s.status as MessageStatus["status"];
        if (!KEPT_STATUSES.has(status)) continue;
        // Gupshup's own id first: it is what its send call answered with. Then whatever `id` holds (a wamid, or in one example another UUID).
        const ids = [...new Set([str(s.gs_id), str(s.id)].filter((x): x is string => x !== undefined && STATUS_ID.test(x)))];
        if (ids.length === 0) continue;
        const first = status === "failed" ? asArray(s.errors).find(isObject) : undefined;
        const code = num(first?.code);
        const title = str(first?.title)?.replace(/\s+/gu, " ").trim().slice(0, 200);
        const to = toE164(s.recipient_id);
        out.push({ ids, status, ...(to ? { to } : {}), timestamp: statusTime(s.timestamp), ...(status === "failed" ? { error: { ...(code !== undefined ? { code } : {}), ...(title ? { title } : {}) } } : {}) });
      }
    }
  }
  return out;
}

// ---- Gupshup self-serve callbacks (item 11c) ----------------------------------------------------------------------------------

/** A self-serve callback: Gupshup's version 2 envelope names the app by NAME (`app`) and has no `entry` (Meta's and Gupshup's v3 bodies do). */
export function isGupshupSelfServe(body: Record<string, unknown>): boolean {
  return body.version !== undefined && typeof body.app === "string" && (body.type === "message" || body.type === "message-event") && isObject(body.payload) && body.entry === undefined;
}

/** The app name a self-serve callback names, for the inbox's check that it is this shop's. */
export const selfServeAppName = (body: unknown): string | undefined => (isObject(body) && isGupshupSelfServe(body) ? (body.app as string) : undefined);

/**
 * The customers' messages in a self-serve callback. Text is its words. A tapped button or list row comes back as `postbackText`, the id we gave it when we sent it
 * (gupshup-selfserve.ts): it becomes `reply` only if it is a short plain id; without one (a button of a template, say) the row's title is read as ordinary words, as
 * the agent already does for any typed answer. Voice notes and pictures are the fact only, as for Meta (a voice note also carries where its audio is when the shop has voice on, B29); other types are left out.
 */
function parseSelfServeMessages(body: Record<string, unknown>, options: { voiceMedia?: boolean } = {}): InboundMessage[] {
  const p = body.payload;
  if (!isObject(p) || body.type !== "message") return [];
  const id = str(p.id), from = toE164(p.source ?? (isObject(p.sender) ? p.sender.phone : undefined));
  if (!id || !from) return [];
  const inner = isObject(p.payload) ? p.payload : {};
  const ms = Number(body.timestamp);
  const timestamp = Number.isFinite(ms) && ms > 0 ? Math.trunc(ms) : 0;
  const plain = (text: string | undefined, extra: Partial<InboundMessage> = {}): InboundMessage[] => (text === undefined || text.length === 0 ? [] : [{ id, from, text, timestamp, ...extra }]);
  switch (p.type) {
    case "text": return plain(str(inner.text));
    case "audio": {
      // B29 (merged with item 11c): for a shop with voice on, a self-serve note carries where its audio is, as Meta's and Gupshup partner's do. Gupshup's self-serve
      // callback names the file `url` and its type `contentType`; mediaOf keeps each only if it has the right shape. With voice off nothing of the audio is read.
      const media = options.voiceMedia === true ? mediaOf({ url: inner.url, mime_type: inner.contentType }) : undefined;
      return [{ id, from, text: "", timestamp, voiceNote: true, ...(media ? { media } : {}) }];
    }
    case "image": return [{ id, from, text: "", timestamp, image: true }];
    case "button_reply": case "quick_reply": case "list_reply": {
      const text = str(inner.title) ?? str(inner.text) ?? str(inner.reply);
      const postback = str(inner.postbackText);
      const reply = postback && /^[A-Za-z0-9:_.-]{1,200}$/u.test(postback) ? { id: postback, kind: p.type === "list_reply" ? "list" as const : "button" as const } : undefined;
      return plain(text, reply ? { reply } : {});
    }
    default: return [];
  }
}

/**
 * The delivered, read and failed reports in a self-serve message-event. `id` is Gupshup's id on enqueued and failed and WhatsApp's on sent, delivered and read, with
 * `gsId` (Gupshup's) beside it on the latter: both are kept so the record is searched for either. `enqueued` and `sent` say no more than the accepted send did and are left out.
 * A failed event carries { code, reason }; only those two are kept, never anything the person wrote.
 */
function parseSelfServeStatuses(body: Record<string, unknown>): MessageStatus[] {
  const p = body.payload;
  if (!isObject(p) || body.type !== "message-event") return [];
  const status = p.type as MessageStatus["status"];
  if (!KEPT_STATUSES.has(status)) return [];
  const ids = [...new Set([str(p.gsId), str(p.id)].filter((x): x is string => x !== undefined && STATUS_ID.test(x)))];
  if (ids.length === 0) return [];
  const inner = isObject(p.payload) ? p.payload : {};
  const to = toE164(p.destination);
  const code = num(inner.code);
  const title = str(inner.reason)?.replace(/\s+/gu, " ").trim().slice(0, 200);
  // delivered and read carry Meta's time in seconds (`ts`); a failure has none, so Gupshup's own millisecond time stands
  const timestamp = statusTime(inner.ts ?? body.timestamp);
  return [{ ids, status, ...(to ? { to } : {}), timestamp, ...(status === "failed" ? { error: { ...(code !== undefined ? { code } : {}), ...(title ? { title } : {}) } } : {}) }];
}
