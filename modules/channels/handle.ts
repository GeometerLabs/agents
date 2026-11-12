// The handle a customer (or an AI assistant) gets for a booking made on the shop's booking page or through its booking API: an unguessable bearer string. Used by the
// public front (modules/channels/front.ts), which makes it, and by a template's runtime, which keeps only its hash.
//
// Why a handle and not the phone number: the number on a web form is typed, never verified (no SMS: Deferred.md). Anyone can type anyone's number, so a booking made
// on the page must never be found, changed or cancelled by its number. The handle is the only thing that reaches a booking: status, payment instructions, "I have paid"
// and cancel all take it, and nothing else. The runtime keeps its SHA-256 and never the handle itself, so a copy of the runtime's data cannot act on a booking.
import { createHash, randomBytes } from "node:crypto";

/** 24 random bytes in base64url: 32 characters. Guessing one is not a practical attack; the front's per-address limits slow anyone who tries. */
export const newHandle = (): string => randomBytes(24).toString("base64url");

/** What a handle looks like. Anything else is refused before a hash is taken, so a path or a query can never carry something odd to the runtime. */
export const HANDLE = /^[A-Za-z0-9_-]{32}$/u;

/** The hash the runtime keeps and looks a booking up by (64 hex digits). The prefix keeps it apart from every other hash in the repo. */
export const handleHash = (handle: string): string => createHash("sha256").update(`booking-handle:${handle}`).digest("hex");

/** A handle's hash, as the runtime accepts it. */
export const HANDLE_HASH = /^[0-9a-f]{64}$/u;

/** The two ways in that use a handle: the booking page and its JSON API ("web"), and the MCP endpoint for AI assistants ("mcp"). WhatsApp is not a channel here. */
export type ChannelName = "web" | "mcp";
export const CHANNELS: readonly ChannelName[] = ["web", "mcp"];

/**
 * The conversation a booking from a channel lives in: "web:" or "mcp:" and 16 hex digits of its handle's hash. Never the typed number: the agent finds a customer's
 * bookings by their conversation (latestBooking, cancel, "I paid"), so a WhatsApp customer's bookings and a stranger's web booking with the same number never meet.
 */
export const conversationOf = (channel: ChannelName, hash: string): string => `${channel}:${hash.slice(0, 16)}`;

/** Is this conversation a channel's (its messages go to the booking's own page, never to WhatsApp)? */
export const isChannelConversation = (conversation: string): boolean => /^(?:web|mcp):[0-9a-f]{16}$/u.test(conversation);
