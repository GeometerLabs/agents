// The two events the public front (modules/channels/front.ts) may hand a template's runtime, and their check. They come in through the runtime's own channel endpoint
// (modules/runtime/http.ts, /internal/channel/events) with the channel's own token, never through /internal/events: the inbox's token can submit a WhatsApp message
// from the owner's number, the channel token can submit only these.
//
//   channel_request   a customer, or an AI assistant for its user, asks to book, to order (item 11h), to cancel, or says they paid; or a parent, on their private
//                     fees page (item 11h), asks for the payment details or says they paid. It carries no authority: the agent does it through the same steps, limits
//                     and Guards as the same request on WhatsApp (templates/commerce/bookings/src/agent.ts, templates/commerce/orders/src/agent.ts,
//                     templates/education/fees/src/agent.ts). A parent's request carries the HASH of their private link, which the Fees agent checks again in the
//                     step: a link revoked since the page was drawn does nothing.
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
/**
 * Item 11h: an exact order from the shop's page, its API or the MCP endpoint: lines of the shop's own items with their quantities, a day (YYYY-MM-DD in the shop's
 * zone), pickup or delivery and the slot, and for a delivery the address as typed. It carries NO price or total: the Orders agent reads every price from the shop's
 * settings, so nothing typed on a page can change what is charged.
 */
export interface ChannelOrder {
  kind: "channel_request"; id: string; channel: ChannelName; op: "order"; handle: string;
  lines: { itemId: string; qty: number }[]; date: string; mode: "pickup" | "delivery"; slotId: string; address?: string;
  name: string; phone: string; language: Language;
}
/**
 * Item 11h: a parent's press on their private fees page: "show me how to pay" (`fee_pay`: the request for what is owed is made if it is not there) or "I have paid"
 * (`fee_paid`: the owner is asked to look; nothing is marked paid). `parent` is the hash of the parent's private link (handle.ts parentLinkHash), never the link and
 * never a number; `handle` is the hash of the confirmation page's handle the front made for this press, so the parent has a stable page that says "confirmed" only
 * when the centre's record does. Only the page sends these (channel "web"): there is no API or MCP for fees.
 */
export interface ChannelFee { kind: "channel_request"; id: string; channel: "web"; op: "fee_pay" | "fee_paid"; parent: string; dueId: string; handle: string }
/** Cancel, or "I have paid" (the owner is asked to look; nothing is marked paid), for the booking or the order with this handle. */
export interface ChannelOther { kind: "channel_request"; id: string; channel: ChannelName; op: "cancel" | "paid"; handle: string }
export type ChannelRequest = ChannelBook | ChannelOrder | ChannelFee | ChannelOther;

/**
 * What the owner's page may ask: the owner-marked replies, the owner's answers to what the agent asked them, and (item 11e) the answer to one of the assistant's
 * cards: `card_yes` / `card_no`, whose case is the card's id ("c-3") and whose digest is the card's own. A card's answer goes through the same binding as a tap on
 * WhatsApp (modules/assistant/cards.ts judgeCard): one use, and the action read again from the store must still have the card's digest.
 */
export const OWNER_ACTIONS = ["received", "refunded", "kept", "approve", "deny", "retry", "card_yes", "card_no", "send_link", "revoke_link"] as const;
export type OwnerActionName = (typeof OWNER_ACTIONS)[number];
export interface OwnerAction { kind: "owner_action"; id: string; action: OwnerActionName; case: string; digest: string }

/**
 * Integration of items 11d and 11e: the owner's words from the talk box on their page, read by the shop's assistant (its answer is shown on the page). From the
 * front only `text` is taken (1 to 900 characters). `voice` is set ONLY by the runtime's own HTTP layer for a recording the owner made on the page: the reference
 * of the audio it holds in memory (owner-audio.ts), never the audio; a `voice` sent by the front is dropped like any other field.
 */
export interface OwnerMessage { kind: "owner_message"; id: string; text: string; voice?: string }
/** The longest message the talk box takes (the box's own maxlength). */
export const OWNER_MESSAGE_MAX = 900;

export type ChannelEvent = ChannelRequest | OwnerAction | OwnerSigninEvent | OwnerMessage;

/**
 * The task key of a request that STARTS something with its own handle: a booking, an order (item 11h), or a parent's press that made a confirmation page. One task per
 * handle, however often it is sent; and the runtime reads this key to say "pending" for a handle whose step has not run yet (modules/runtime/core.ts). The name
 * stays `channel_book:` for every kind, so a task saved before item 11h is still found.
 */
export const channelStartKey = (handleHash: string): string => `channel_book:${handleHash}`;

/** The task key: a booking, an order or a parent's press is made once per handle, however often it is sent; a cancel or a claim once per press (the front's own id for it). */
export function channelEventKey(e: ChannelEvent): string {
  if (e.kind === "owner_action") return `owner_action:${e.id}`;
  if (e.kind === "owner_signin") return `owner_signin:${e.id}`; // one per press: the limits, not the key, bound how many
  if (e.kind === "owner_message") return `owner_message:${e.id}`; // one per send from the page
  return e.op === "cancel" || e.op === "paid" ? `channel_${e.op}:${e.handle}:${e.id}` : channelStartKey(e.handle);
}

const REQUEST_ID = /^[A-Za-z0-9-]{1,64}$/u;
const CASE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/u;
const SERVICE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/u;
const DIGEST = /^[0-9a-f]{32}$/u;
/** A fee's id in the Fees store ("f-12"). */
const DUE_ID = /^f-\d{1,9}$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
/** The most lines and the most of one item an order from a channel may carry: a shop's own limit (maxItemsPerOrder) is checked again by the agent. */
export const ORDER_LINES_MAX = 20;
export const ORDER_QTY_MAX = 99;
/** A delivery address as typed: the agent keeps at most this much (templates/commerce/orders/src/agent.ts onAddress). */
export const ADDRESS_MAX = 120;
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
  // the talk box: the words only; a `voice` reference is the runtime's own to set (owner-audio.ts), so one from here is never read
  if (raw.kind === "owner_message") {
    const text = typeof raw.text === "string" ? raw.text.trim() : "";
    if (text.length === 0 || text.length > OWNER_MESSAGE_MAX) return { ok: false, error: `An owner_message carries the owner's words: 1 to ${OWNER_MESSAGE_MAX} characters.` };
    return { ok: true, event: { kind: "owner_message", id: raw.id, text } };
  }
  if (raw.kind !== "channel_request") return { ok: false, error: 'The kind must be "channel_request", "owner_action", "owner_message" or "owner_signin".' };
  if (!CHANNELS.includes(raw.channel as ChannelName)) return { ok: false, error: 'A channel_request\'s channel is "web" or "mcp".' };
  if (typeof raw.handle !== "string" || !HANDLE_HASH.test(raw.handle)) return { ok: false, error: "A channel_request carries its handle's hash (64 hex digits), never the handle." };
  const base = { kind: "channel_request" as const, id: raw.id, channel: raw.channel as ChannelName, handle: raw.handle };
  if (raw.op === "cancel" || raw.op === "paid") return { ok: true, event: { ...base, op: raw.op } };
  // item 11h: a parent's press on their private page: the page only, and only the link's hash and the fee's id are read
  if (raw.op === "fee_pay" || raw.op === "fee_paid") {
    if (raw.channel !== "web") return { ok: false, error: "A parent's request comes from their page only (channel \"web\")." };
    if (typeof raw.parent !== "string" || !HANDLE_HASH.test(raw.parent)) return { ok: false, error: "A parent's request carries the hash of their private link (64 hex digits), never the link." };
    if (typeof raw.dueId !== "string" || !DUE_ID.test(raw.dueId)) return { ok: false, error: 'A parent\'s request names the fee ("f-3").' };
    return { ok: true, event: { kind: "channel_request", id: raw.id, channel: "web", op: raw.op, parent: raw.parent, dueId: raw.dueId, handle: raw.handle } };
  }
  if (raw.op === "order") return checkOrder(raw, base);
  if (raw.op !== "book") return { ok: false, error: 'A channel_request\'s op is "book", "order", "fee_pay", "fee_paid", "cancel" or "paid".' };
  if (typeof raw.serviceId !== "string" || !SERVICE_ID.test(raw.serviceId)) return { ok: false, error: "A booking names its service (serviceId)." };
  if (typeof raw.startMs !== "number" || !Number.isInteger(raw.startMs) || raw.startMs <= 0) return { ok: false, error: "A booking gives its start as epoch milliseconds (startMs)." };
  const name = normaliseName(raw.name);
  if (!name) return { ok: false, error: "A booking needs the customer's name: 1 to 60 letters." };
  const phone = normalisePhone(raw.phone);
  if (!phone || phone !== raw.phone) return { ok: false, error: "A booking needs the customer's number in full, as +91 and ten digits." };
  if (!LANGUAGES.includes(raw.language as Language)) return { ok: false, error: `A booking's language is one of ${LANGUAGES.join(", ")}.` };
  return { ok: true, event: { ...base, op: "book", serviceId: raw.serviceId, startMs: raw.startMs, name, phone, language: raw.language as Language } };
}

/** Item 11h: an order's fields, checked for shape only (the agent checks each against the shop's menu, slots, days and delivery list). */
function checkOrder(raw: Obj, base: { kind: "channel_request"; id: string; channel: ChannelName; handle: string }): { ok: true; event: ChannelEvent } | { ok: false; error: string } {
  if (!Array.isArray(raw.lines) || raw.lines.length === 0 || raw.lines.length > ORDER_LINES_MAX) return { ok: false, error: `An order carries 1 to ${ORDER_LINES_MAX} lines.` };
  const lines: { itemId: string; qty: number }[] = [];
  for (const l of raw.lines as unknown[]) {
    if (!isObj(l) || typeof l.itemId !== "string" || !SERVICE_ID.test(l.itemId)) return { ok: false, error: "Each line names an item of the shop's menu (itemId)." };
    if (typeof l.qty !== "number" || !Number.isInteger(l.qty) || l.qty < 1 || l.qty > ORDER_QTY_MAX) return { ok: false, error: `Each line's quantity is a whole number from 1 to ${ORDER_QTY_MAX}.` };
    if (lines.some((x) => x.itemId === l.itemId)) return { ok: false, error: "An item is named once in an order." };
    lines.push({ itemId: l.itemId, qty: l.qty });
  }
  if (typeof raw.date !== "string" || !DATE.test(raw.date)) return { ok: false, error: "An order names its day as YYYY-MM-DD (date)." };
  if (raw.mode !== "pickup" && raw.mode !== "delivery") return { ok: false, error: 'An order\'s mode is "pickup" or "delivery".' };
  if (typeof raw.slotId !== "string" || !SERVICE_ID.test(raw.slotId)) return { ok: false, error: "An order names its slot (slotId)." };
  const address = typeof raw.address === "string" ? raw.address.replace(/[\u0000-\u001f\u007f]+/gu, " ").replace(/\s+/gu, " ").trim().slice(0, ADDRESS_MAX) : undefined;
  if (raw.mode === "delivery" && !address) return { ok: false, error: "A delivery names its address." };
  const name = normaliseName(raw.name);
  if (!name) return { ok: false, error: "An order needs the customer's name: 1 to 60 letters." };
  const phone = normalisePhone(raw.phone);
  if (!phone || phone !== raw.phone) return { ok: false, error: "An order needs the customer's number in full, as +91 and ten digits." };
  if (!LANGUAGES.includes(raw.language as Language)) return { ok: false, error: `An order's language is one of ${LANGUAGES.join(", ")}.` };
  return { ok: true, event: { ...base, op: "order", lines, date: raw.date, mode: raw.mode, slotId: raw.slotId, ...(raw.mode === "delivery" ? { address } : {}), name, phone, language: raw.language as Language } };
}
