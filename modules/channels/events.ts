// The two events the public front (modules/channels/front.ts) may hand a template's runtime, and their check. They come in through the runtime's own channel endpoint
// (modules/runtime/http.ts, /internal/channel/events) with the channel's own token, never through /internal/events: the inbox's token can submit a WhatsApp message
// from the owner's number, the channel token can submit only these.
//
//   channel_request   a customer, or an AI assistant for its user, asks to book, to cancel, or says they paid. It carries no authority: the agent does it through the
//                     same steps, limits and Guards as the same request on WhatsApp (templates/commerce/bookings/src/agent.ts).
//   owner_action      the owner pressed a button on their private approvals page. The runtime's HTTP layer has checked the owner's link before the event is saved; the
//                     agent then checks that the action shown is still the one waiting (its digest), and does exactly what the same reply on WhatsApp does.
//   owner_signin      someone on the shop's page asked for the owner's sign-in link (item 11f). It carries no number and no address: the runtime core sends the link
//                     to the owner's number in the settings, within the shop's limits (owner-signin.ts), and never hands this event to the agent.
import { CHANNELS, HANDLE_HASH } from "./handle.ts";
import type { ChannelName } from "./handle.ts";
import { normaliseName, normalisePhone } from "./contact.ts";
import { LANGUAGES } from "../language/languages.ts";
import type { OwnerSigninEvent } from "./owner-signin.ts";
import type { Language } from "../language/languages.ts";

/** A booking asked for from a channel: the service and the exact start, the customer's name and number as typed, and the language they used. */
export interface ChannelBook { kind: "channel_request"; id: string; channel: ChannelName; op: "book"; handle: string; serviceId: string; startMs: number; name: string; phone: string; language: Language }
/** Cancel, or "I have paid" (the owner is asked to look; nothing is marked paid), for the booking with this handle. */
export interface ChannelOther { kind: "channel_request"; id: string; channel: ChannelName; op: "cancel" | "paid"; handle: string }
export type ChannelRequest = ChannelBook | ChannelOther;

/**
 * What the owner's page may ask: the owner-marked replies, the owner's answers to what the agent asked them, and (item 11e) the answer to one of the assistant's
 * cards: `card_yes` / `card_no`, whose case is the card's id ("c-3") and whose digest is the card's own. A card's answer goes through the same binding as a tap on
 * WhatsApp (modules/assistant/cards.ts judgeCard): one use, and the action read again from the store must still have the card's digest.
 */
export const OWNER_ACTIONS = ["received", "refunded", "kept", "approve", "deny", "retry", "card_yes", "card_no"] as const;
export type OwnerActionName = (typeof OWNER_ACTIONS)[number];
export interface OwnerAction { kind: "owner_action"; id: string; action: OwnerActionName; case: string; digest: string }

export type ChannelEvent = ChannelRequest | OwnerAction | OwnerSigninEvent;

/** The task key: a booking is made once per handle, however often it is sent; a cancel or a claim once per press (the front's own id for it). */
export function channelEventKey(e: ChannelEvent): string {
  if (e.kind === "owner_action") return `owner_action:${e.id}`;
  if (e.kind === "owner_signin") return `owner_signin:${e.id}`; // one per press: the limits, not the key, bound how many
  return e.op === "book" ? `channel_book:${e.handle}` : `channel_${e.op}:${e.handle}:${e.id}`;
}

const REQUEST_ID = /^[A-Za-z0-9-]{1,64}$/u;
const CASE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/u;
const SERVICE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/u;
const DIGEST = /^[0-9a-f]{32}$/u;
/** The assistant's card ids (modules/assistant/state.ts nextId). */
const CARD_ID = /^c-\d{1,9}$/u;
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** One event from the front, checked for shape. All or nothing: a bad field refuses it with a sentence saying which. */
export function checkChannelEvent(raw: unknown): { ok: true; event: ChannelEvent } | { ok: false; error: string } {
  if (!isObj(raw)) return { ok: false, error: "The event must be an object with a kind." };
  if (typeof raw.id !== "string" || !REQUEST_ID.test(raw.id)) return { ok: false, error: "The event needs an id: up to 64 letters, digits and hyphens." };
  if (raw.kind === "owner_action") {
    if (!OWNER_ACTIONS.includes(raw.action as OwnerActionName)) return { ok: false, error: `An owner_action's action is one of ${OWNER_ACTIONS.join(", ")}.` };
    if (typeof raw.case !== "string" || !CASE_ID.test(raw.case)) return { ok: false, error: 'An owner_action names its case ("b-3").' };
    if ((raw.action === "card_yes" || raw.action === "card_no") && !CARD_ID.test(raw.case)) return { ok: false, error: 'A card\'s answer names the card ("c-3").' };
    if (typeof raw.digest !== "string" || !DIGEST.test(raw.digest)) return { ok: false, error: "An owner_action carries the digest of the action as it was shown (32 hex digits)." };
    return { ok: true, event: { kind: "owner_action", id: raw.id, action: raw.action as OwnerActionName, case: raw.case, digest: raw.digest } };
  }
  // item 11f: only the kind and the id are read; anything else sent with it (a number above all) is dropped, never used
  if (raw.kind === "owner_signin") return { ok: true, event: { kind: "owner_signin", id: raw.id } };
  if (raw.kind !== "channel_request") return { ok: false, error: 'The kind must be "channel_request", "owner_action" or "owner_signin".' };
  if (!CHANNELS.includes(raw.channel as ChannelName)) return { ok: false, error: 'A channel_request\'s channel is "web" or "mcp".' };
  if (typeof raw.handle !== "string" || !HANDLE_HASH.test(raw.handle)) return { ok: false, error: "A channel_request carries its handle's hash (64 hex digits), never the handle." };
  const base = { kind: "channel_request" as const, id: raw.id, channel: raw.channel as ChannelName, handle: raw.handle };
  if (raw.op === "cancel" || raw.op === "paid") return { ok: true, event: { ...base, op: raw.op } };
  if (raw.op !== "book") return { ok: false, error: 'A channel_request\'s op is "book", "cancel" or "paid".' };
  if (typeof raw.serviceId !== "string" || !SERVICE_ID.test(raw.serviceId)) return { ok: false, error: "A booking names its service (serviceId)." };
  if (typeof raw.startMs !== "number" || !Number.isInteger(raw.startMs) || raw.startMs <= 0) return { ok: false, error: "A booking gives its start as epoch milliseconds (startMs)." };
  const name = normaliseName(raw.name);
  if (!name) return { ok: false, error: "A booking needs the customer's name: 1 to 60 letters." };
  const phone = normalisePhone(raw.phone);
  if (!phone || phone !== raw.phone) return { ok: false, error: "A booking needs the customer's number in full, as +91 and ten digits." };
  if (!LANGUAGES.includes(raw.language as Language)) return { ok: false, error: `A booking's language is one of ${LANGUAGES.join(", ")}.` };
  return { ok: true, event: { ...base, op: "book", serviceId: raw.serviceId, startMs: raw.startMs, name, phone, language: raw.language as Language } };
}
