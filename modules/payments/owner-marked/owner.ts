// The owner's replies about payments the owner marks (UPI today), for every template: "received", "refunded" and "kept", each with a one-use code (ledger.ts). Read from a tapped reply button
// (its id carries the code) or from typed words. Only a message from the owner's own number ever reaches this: the agent checks the sender first, as the
// approvals relay does.
//
// The code uses the approvals' alphabet (modules/approvals/code.ts): no 0/O, 1/I/L, no hyphen, so it can never be read as a booking or fee reference.
// The words are English on purpose: the owner's message, in their language, tells them exactly what to type, and English words are the same on every keyboard.
import { CODE_PATTERN } from "../../approvals/code.ts";

export type MarkReply =
  | { kind: "received"; code: string; /** In paise, when the owner typed another amount. Left out: exactly what is still asked. */ amountPaise?: number }
  | { kind: "refunded"; code: string }
  | { kind: "kept"; code: string };

/** The reply buttons' ids. A button carries one action and one code. */
export const MARK_BUTTON = { received: "upi-received", refunded: "upi-refunded", kept: "upi-kept" } as const;
// Button ids carry the one-use code so a tap can only act on the request it was sent for.
export const markButtonId = (kind: keyof typeof MARK_BUTTON, code: string): string => `${MARK_BUTTON[kind]}:${code}`;

const BUTTON_RE = new RegExp(`^(upi-received|upi-refunded|upi-kept):(${CODE_PATTERN})$`, "u");
const RECEIVED_RE = new RegExp(`^\\s*(?:received|recieved|got|paid)\\s+(${CODE_PATTERN})(?:\\s+(?:rs\\.?|inr|₹)?\\s*(\\d{1,3}(?:,\\d{2,3})*|\\d+)(?:\\.(\\d{1,2}))?)?\\s*$`, "iu");
const REFUNDED_RE = new RegExp(`^\\s*(refunded|returned|kept)\\s+(${CODE_PATTERN})\\s*$`, "iu");

/** An owner's message that marks a payment or a refund, or undefined. The button ids keep their "upi-" names: messages already sent carry them. */
export function parseMarkReply(m: { text: string; reply?: { id: string } }): MarkReply | undefined {
  const button = m.reply ? BUTTON_RE.exec(m.reply.id) : null;
  if (button) {
    const code = button[2].toUpperCase();
    return button[1] === "upi-received" ? { kind: "received", code } : button[1] === "upi-refunded" ? { kind: "refunded", code } : { kind: "kept", code };
  }
  const received = RECEIVED_RE.exec(m.text);
  if (received) {
    const code = received[1].toUpperCase();
    if (received[2] === undefined) return { kind: "received", code };
    const rupees = Number(received[2].replace(/,/gu, ""));
    const paise = received[3] === undefined ? 0 : Number(received[3].padEnd(2, "0"));
    return { kind: "received", code, amountPaise: rupees * 100 + paise };
  }
  const refunded = REFUNDED_RE.exec(m.text);
  if (refunded) return { kind: refunded[1].toLowerCase() === "kept" ? "kept" : "refunded", code: refunded[2].toUpperCase() };
  return undefined;
}
