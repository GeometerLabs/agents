// The approvals relay's card buttons (item 11e): the relay's ask about a refund Guard holds goes, while the owner's window is open, with two buttons whose ids carry the
// ask's one-use code. A tap is read by the relay exactly as the typed "approve K7M2QX" / "deny K7M2QX" (relay.ts `receive`): the same code, the same one use, the
// same count of wrong guesses. Every agent (and the shop's assistant) drops a tap on these, without a word, as it drops the typed reply (code.ts RELAY_CODE_REPLY).
// The labels are in the owner's language; the code stays in the id and in the text above the buttons, so the typed reply still works.
import { CODE_PATTERN, RELAY_CODE_REPLY } from "./code.ts";
import type { Language } from "../language/languages.ts";

/** The ids. "appr-" so they can never be read as an assistant card's ("card-") or a UPI mark's ("upi-"). */
export const APPROVAL_BUTTON = { approve: "appr-approve", deny: "appr-deny" } as const;
export const approvalButtonId = (decision: keyof typeof APPROVAL_BUTTON, code: string): string => `${APPROVAL_BUTTON[decision]}:${code}`;

const BUTTON_RE = new RegExp(`^appr-(approve|deny):(${CODE_PATTERN})$`, "u");

/** Is this button id one of the relay's? Agents use it to stay silent. */
export const isApprovalButton = (id: string | undefined): boolean => id !== undefined && BUTTON_RE.test(id);

/** A tap's id as the typed reply the relay already reads ("approve K7M2QX"), or undefined when it is not one of the relay's buttons. */
export function approvalButtonText(id: string | undefined): string | undefined {
  const m = id === undefined ? null : BUTTON_RE.exec(id);
  return m ? `${m[1]} ${m[2].toUpperCase()}` : undefined;
}

/** The buttons' words. Short (WhatsApp allows 20 characters), and the same two choices in every language. */
export const APPROVAL_LABELS: Record<Language, { approve: string; deny: string }> = {
  en: { approve: "Approve", deny: "Refuse" },
  hi: { approve: "मंज़ूर करें", deny: "मना करें" },
  ml: { approve: "അനുവദിക്കുക", deny: "നിരസിക്കുക" },
  kn: { approve: "ಅನುಮೋದಿಸಿ", deny: "ನಿರಾಕರಿಸಿ" },
};

/** An owner's (or another approver's) message that is the relay's to read, typed ("approve K7M2QX") or tapped. Agents return on it without a word or a record line. */
export const isRelayReply = (m: { text: string; reply?: { id: string } }): boolean => RELAY_CODE_REPLY.test(m.text) || isApprovalButton(m.reply?.id);
