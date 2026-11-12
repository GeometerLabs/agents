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

/**
 * The handle of a booking started from the page's form, made from the form's own random nonce and what it asks for. A second tap on "Hold this time" (or the form sent
 * again by a slow network) makes the SAME handle, so its task is the same task (events.ts channelEventKey) and the customer lands on the one booking, never on a second
 * request that finds its own first hold in the way. Another time or number from the same form is another booking. As unguessable as the nonce, which only the visitor saw.
 */
export const handleFromNonce = (nonce: string, parts: readonly string[]): string => createHash("sha256").update(`booking-nonce:${nonce}|${parts.join("|")}`).digest("base64url").slice(0, 32);
/** What a form's nonce looks like (newHandle's shape). */
export const NONCE = HANDLE;

/** A handle's hash, as the runtime accepts it. */
export const HANDLE_HASH = /^[0-9a-f]{64}$/u;

/**
 * Item 11h: a parent's private fees link is a bearer string of the same shape as a handle (newHandle), and the Fees runtime keeps only this hash of it, in its saved
 * state (templates/education/fees/src/due.ts `parentLinks`). The prefix keeps it apart from a booking's or an order's handle: a handle can never open a parent's page,
 * and a parent's link can never open a booking.
 */
export const parentLinkHash = (link: string): string => createHash("sha256").update(`parent-link:${link}`).digest("hex");

// The channels' names and conversations are in conversation.ts (no imports, so an agent in the browser demo can use them); they are passed on from here too.
export { CHANNELS, conversationOf, isChannelConversation } from "./conversation.ts";
export type { ChannelName } from "./conversation.ts";
