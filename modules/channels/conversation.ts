// The channels' names and the conversation a channel booking lives in. Kept apart from handle.ts on purpose: it imports nothing, so a template's agent can use it and
// still run in the browser demo, whose stand-in for node:crypto has no randomBytes (templates/commerce/bookings/demo/web/shims/crypto.ts).

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
