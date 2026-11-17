// What a template's store keeps for its channels (the booking page, its API and the MCP endpoint): the messages its customers were given, and each request by its handle.
// It is a plain JSON object kept in the store with the rest of a step (Bookings keeps it under `channel`), so a message to a web customer is saved whole or not at all with
// the booking it is about, exactly as a WhatsApp message's record line is.
import { HOUR } from "../core/time.ts";

/** One message the agent "sent" to a channel's customer: what their booking page shows under the booking. */
export interface OutboxMessage {
  id: string; to: string; text: string; atMs: number;
  /** A chat guest's thread only (W1): the buttons or list rows the shop's message came with, so the page can draw them and a tap can be checked against them. */
  choices?: ChatChoice[];
  /** A chat thread only (17 Nov 2026): this line is the shop saying the RECORD holds a booking or an order (`confirmed`) or a payment (`paid`). Set by the agent's own say, after its
   * "recorded only" gate passed, never from the words; the page marks it with a small animation when it arrives and a still afterwards. */
  moment?: ChatMoment;
}

/** The two moments a chat line can mark: what the shop's record confirms. (A third, the greeting, is the page's own and is not in the record.) */
export type ChatMoment = "confirmed" | "paid";

/** A button or a list row, as a chat thread keeps it: the id the template gave it (it is what the agent reads back), the words, and a row's one-line note. */
export interface ChatChoice { id: string; title: string; hint?: string; /** True for a list row (WhatsApp's kind of reply), else a button. */ list?: true }

/** What a guest typed or tapped, in order with the shop's messages (their ids come from the same counter). `cid`: the page's own id for the send, so a retry is one line. */
export interface ChatSaid { id: string; cid: string; text: string; atMs: number }

/**
 * One guest's chat (W1, 17 Nov 2026), by its conversation ("chat:" and 16 hex digits). `said`: the guest's own lines, capped (CHAT_THREAD_MAX); the shop's lines are the
 * outbox's. `day`, `turns`, `messages`: the shop-zone day these counts are for, how many typed sends may have asked the model, and how many sends in all (the saved caps
 * of chat.ts CHAT_LIMITS). Nothing here identifies a person: the handle itself is in the guest's cookie only, and the hash that names the conversation is one way.
 */
export interface ChatGuest {
  startedMs: number; lastMs: number; said: ChatSaid[]; day: string; turns: number; messages: number;
  /** The guest's number for the owner ("Chat guest 3"): given at the first send, in order, and kept as long as the guest is (chat-guest.ts). */
  n?: number;
  /** Owner pings (the shop's WhatsApp told of this guest) on `pingDay`: bounded per guest per day (chat.ts CHAT_LIMITS.pingsPerDay). */
  pings?: number; pingDay?: string;
}

/**
 * A request from a channel, by its handle's hash. `booking`: the booking it made. `refused`: why none was made (a reason name the page words; the record says the rest).
 * `phone`: the digits of the number given, for the per-number limits; taken off with the text of finished conversations (compact).
 */
export interface ChannelRequestRecord { atMs: number; channel: string; booking?: string; refused?: string; phone?: string }

export interface ChannelState {
  seq: number; outbox: OutboxMessage[]; requests: Record<string, ChannelRequestRecord>;
  /** W1: the chat guests, by conversation. Left out until the first guest writes, so a shop with no chat saves exactly what it did. */
  chat?: Record<string, ChatGuest>;
  /** How many chat guests the shop has had: the next one is "Chat guest <n + 1>". Never goes down, so a number is never given to two people (chat-guest.ts). */
  guests?: number;
}

export const emptyChannelState = (): ChannelState => ({ seq: 0, outbox: [], requests: {} });

/** The most a conversation keeps: a booking's page shows its latest messages, and a step can never grow the store without bound. */
export const OUTBOX_PER_CONVERSATION = 20;
/** The most a chat guest's thread keeps of each side (the shop's lines in the outbox, the guest's in `said`): a reload shows the last of a real conversation, and nothing grows without bound. */
export const CHAT_THREAD_MAX = 60;

/**
 * The limits a step enforces on bookings from channels (the front adds per-address limits before anything is saved: limits.ts). The typed number is not verified, so the
 * number limits only slow one person down; the per-shop cap on unpaid holds and the hold's own end are what bound a flood (Explanation.md, "What a fake booking can do").
 */
export const CHANNEL_LIMITS = {
  /** Unpaid holds one number may have at once. */
  holdsPerPhone: 2,
  /** Bookings one number may start in 24 hours. */
  startsPerPhonePerDay: 5,
  /** Unpaid holds from the page and the API, together, at once, for the whole shop. */
  unpaidHoldsPerShop: 6,
  /** How far ahead a booking may start, in days. */
  daysAhead: 30,
} as const;

/**
 * What a channel keeps of conversations that ended before `beforeMs` (the shop's retention, modules/runtime/core.ts) is taken off: their messages, and the requests
 * themselves once they were refused or their booking ended (with the number they carried). A request whose booking is still going stays, so its page still opens and
 * its number still counts for the per-number limits. The record is never touched. Returns how many it changed.
 */
export function compactChannel(state: ChannelState | undefined, beforeMs: number, ended: (bookingId: string) => boolean, keepGuest?: (conversation: string) => boolean): number {
  if (!state) return 0;
  let changed = 0;
  for (const [hash, r] of Object.entries(state.requests)) {
    if (r.atMs >= beforeMs) continue;
    if (r.booking !== undefined && !ended(r.booking)) continue;
    delete state.requests[hash]; // a refused request, or one whose booking is over: a flood of refusals cannot grow the store for ever
    changed++;
  }
  const keep = state.outbox.filter((m) => m.atMs >= beforeMs); // the page of a booking still going shows its state, which is kept; only old words go
  changed += state.outbox.length - keep.length;
  state.outbox = keep;
  // W1: a chat thread is kept for the same time (the shop's retention); a guest with no line left is forgotten whole, so the thread, its counts and its day are gone
  for (const [conversation, guest] of Object.entries(state.chat ?? {})) {
    const said = guest.said.filter((m) => m.atMs >= beforeMs);
    changed += guest.said.length - said.length;
    guest.said = said;
    // `keepGuest`: a guest whose booking or order still lives keeps their entry (and so their number for the owner, "Chat guest 3"), however old their words are
    if (said.length === 0 && !state.outbox.some((m) => m.to === conversation) && !keepGuest?.(conversation)) { delete state.chat![conversation]; changed++; }
  }
  if (state.chat && Object.keys(state.chat).length === 0) delete state.chat;
  return changed;
}

/** Requests older than this are not counted by the per-day number limit. */
export const DAY_MS = 24 * HOUR;
