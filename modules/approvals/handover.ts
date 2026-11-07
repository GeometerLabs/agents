// The owner's agreement to move a shop to another partner or builder (plan B38): "move K7M2QX", sent from the owner's own number to the shop's WhatsApp number.
//
// The panel makes a one-use code (code.ts: the same alphabet and length as an approval's), shows it to the person moving the shop, and keeps only its HASH. The owner sends the
// code in a message; the agent writes a handover_agreed entry in the record, from the owner's number, holding the code's hash. The panel moves the shop only when it finds that
// entry in the record, after it asked and before the code ran out. So the proof is the record's own line: the owner's number said it, and the code ties it to this one move.
// The agent does nothing else with it and says nothing back (an owner-bound message outside WhatsApp's 24 hours needs an approved template; see bundle/Deferred.md).
//
// The hash is not the approval code's hash: a code made for a move can never answer an approval, and the other way round.
import { createHash } from "node:crypto";
import { CODE_PATTERN, newCode } from "./code.ts";

/** "move K7M2QX", typed in any case. An approval's "approve K7M2QX" and the booking commands ("approve b-3") do not match. */
export const HANDOVER_REPLY = new RegExp(`^\\s*move\\s+(${CODE_PATTERN})\\s*$`, "iu");

export function parseHandoverReply(text: string): string | undefined {
  const m = HANDOVER_REPLY.exec(text);
  return m ? m[1].toUpperCase() : undefined;
}

export const newHandoverCode = newCode;
export const handoverHash = (code: string): string => createHash("sha256").update(`handover-code:${code.toUpperCase()}`).digest("hex");

/**
 * The record's wording for the owner's agreement, so the agents and the panel read the same fields: an entry with this action, `confirmed`, from the owner's number,
 * with `refs.handover` the code's hash. It is its own action, not an "owner_decision", so it is never counted as an approval or a refusal in a report.
 */
export const HANDOVER_ACTION = "handover_agreed";
