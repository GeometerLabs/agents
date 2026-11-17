// How the owner sees a chat guest (17 Nov 2026): "Chat guest 3", never the conversation's own name ("chat:" and 16 hex digits). A guest on the shop's page has no number and no
// name, so the owner is shown a short number given in order at the guest's first send. It is kept in the saved chat state (`ChatGuest.n`, `ChannelState.guests`), so it is the same
// in the owner's page, "what needs me", the morning line, the shop's messages to the owner and the message card, and a number is never given to two guests.
//
// Pure: no disk, no node modules, so a template's agent that imports it still runs in the browser demo. The label is a "literal" the outgoing check lets a message repeat
// (the template's check.ts), the same way it lets one repeat a customer's number.
import type { Language } from "../language/languages.ts";
import { isChatConversation } from "./conversation.ts";
import type { ChannelState } from "./state.ts";

/** The words in front of the number, in the owner's language (Hindi, Malayalam and Kannada are machine-written, on the review sheets). */
export const CHAT_GUEST: Record<Language, string> = { en: "Chat guest", hi: "चैट अतिथि", ml: "ചാറ്റ് അതിഥി", kn: "ಚಾಟ್ ಅತಿಥಿ" };

/** The reference the owner may type for a guest ("message g-3 we open at ten"), as the assistant's case references are written (b-3, o-5). */
export const GUEST_REF = /^g-(\d{1,6})$/u;
export const guestRef = (n: number): string => `g-${n}`;

/** The next number for a new guest; it never goes down, so a number is not given twice. Called once, in the step that makes the guest. */
export function nextGuestNumber(state: ChannelState): number {
  state.guests = (state.guests ?? 0) + 1;
  return state.guests;
}

/** The guest's number, if the shop still knows the guest. */
export const guestNumber = (state: ChannelState | undefined, conversation: string): number | undefined => state?.chat?.[conversation]?.n;

/** The conversation of guest number `n`, when the shop still holds that guest. */
export function conversationOfNumber(state: ChannelState | undefined, n: number): string | undefined {
  for (const [conversation, g] of Object.entries(state?.chat ?? {})) if (g.n === n) return conversation;
  return undefined;
}

/**
 * What to call a conversation for the owner: "Chat guest 3" for a chat guest (the words alone when the number is no longer kept, never the conversation's name), and the
 * conversation itself for anyone else (a WhatsApp number or a booking page's conversation, which the owner already sees as they always did).
 */
export function guestLabel(state: ChannelState | undefined, conversation: string, language: Language): string {
  if (!isChatConversation(conversation)) return conversation;
  const n = guestNumber(state, conversation);
  return n === undefined ? CHAT_GUEST[language] : `${CHAT_GUEST[language]} ${n}`;
}
