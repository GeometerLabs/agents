// What a template's store keeps for its channels (the booking page, its API and the MCP endpoint): the messages its customers were given, and each request by its handle.
// It is a plain JSON object kept in the store with the rest of a step (Bookings keeps it under `channel`), so a message to a web customer is saved whole or not at all with
// the booking it is about, exactly as a WhatsApp message's record line is.
import { HOUR } from "../core/time.ts";

/** One message the agent "sent" to a channel's customer: what their booking page shows under the booking. */
export interface OutboxMessage { id: string; to: string; text: string; atMs: number }

/**
 * A request from a channel, by its handle's hash. `booking`: the booking it made. `refused`: why none was made (a reason name the page words; the record says the rest).
 * `phone`: the digits of the number given, for the per-number limits; taken off with the text of finished conversations (compact).
 */
export interface ChannelRequestRecord { atMs: number; channel: string; booking?: string; refused?: string; phone?: string }

export interface ChannelState { seq: number; outbox: OutboxMessage[]; requests: Record<string, ChannelRequestRecord> }

export const emptyChannelState = (): ChannelState => ({ seq: 0, outbox: [], requests: {} });

/** The most a conversation keeps: a booking's page shows its latest messages, and a step can never grow the store without bound. */
export const OUTBOX_PER_CONVERSATION = 20;

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
 * Words and numbers of conversations that ended before `beforeMs` are taken off (the shop's retention, modules/runtime/core.ts): the messages, and the number kept on
 * a request. What happened stays: the request's booking or its refusal. Returns how many it changed.
 */
export function compactChannel(state: ChannelState | undefined, beforeMs: number, ended: (bookingId: string) => boolean): number {
  if (!state) return 0;
  let changed = 0;
  for (const r of Object.values(state.requests)) {
    if (r.atMs >= beforeMs || r.phone === undefined) continue;
    if (r.booking !== undefined && !ended(r.booking)) continue; // a booking still going keeps its number for the per-number limits
    delete r.phone;
    changed++;
  }
  const keep = state.outbox.filter((m) => m.atMs >= beforeMs); // the page of a booking still going shows its state, which is kept; only old words go
  changed += state.outbox.length - keep.length;
  state.outbox = keep;
  return changed;
}

/** Requests older than this are not counted by the per-day number limit. */
export const DAY_MS = 24 * HOUR;
