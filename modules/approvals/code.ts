// The one-use code an owner sends back to approve or deny a refund Guard is holding ("approve K7M2QX"). It is made and checked only by
// the approvals relay; the agent shares this file so that it can tell such a reply from its own commands and ignore it without a word.
//
// The alphabet leaves out the letters and digits that look alike on a phone (0 O, 1 I L), and has no hyphen, so a code can never be
// read as a booking reference ("b-3"). Six characters from 31 is about 887 million codes; a wrong guess is counted by the relay.
import { randomInt } from "node:crypto";

export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 6;
/** What a code looks like, as the owner may type it: 4 to 6 characters of the alphabet (typed in any case). */
export const CODE_PATTERN = "[A-HJKMNP-Za-hjkmnp-z2-9]{4,6}";
/** An owner's reply that has the shape of "approve <code>" / "deny <code>". Booking references (b-3) never match: they have a hyphen. */
export const RELAY_CODE_REPLY = new RegExp(`^\\s*(approve|deny)\\s+(${CODE_PATTERN})\\s*$`, "iu");

// Random one-use code, short enough to type on a phone; only its hash is stored (see store.ts).
export function newCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

/** "approve k7m2qx" gives { decision: "approve", code: "K7M2QX" }; anything else gives undefined. */
export function parseCodeReply(text: string): { decision: "approve" | "deny"; code: string } | undefined {
  const m = RELAY_CODE_REPLY.exec(text);
  return m ? { decision: m[1].toLowerCase() as "approve" | "deny", code: m[2].toUpperCase() } : undefined;
}
