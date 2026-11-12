// WhatsApp's later reports on the messages a shop sent (delivered, read, failed), written into the shop's record against the message they are about. The runtime
// (modules/runtime/core.ts) calls `recordMessageStatus` for each `message_status` event the inbox forwards; the agent never sees one, so a report changes no
// booking, no fee and no order, and nothing is ever sent again because of one. A failure the shop counted on is listed for a person instead (B31,
// modules/unfinished/builtin.ts `message_not_delivered`).
//
// Why this matters: a send call's answer means only that WhatsApp (or Gupshup) ACCEPTED the message, and the record's send line says "confirmed" for that read-back.
// Gupshup accepts first and asks Meta afterwards, so even a closed 24-hour window (131047) arrives here, later, as "failed". These lines keep the two apart in words.
import type { Language } from "../language/languages.ts";
import { messageFingerprint } from "../record/fingerprint.ts";
import type { ActionRecord, RecordEntry } from "../record/record.ts";
import { MESSAGE_STATUS_ENTRY, reliedOn } from "../unfinished/registry.ts";
import type { MessageStatus } from "./messaging.ts";

export interface StatusContext {
  /** The owner's number and language: a report on a message to the owner is the owner's, and a line with no sent message to copy a language from uses theirs. */
  owner?: { whatsapp: string; language: Language };
  /** The other approvers' numbers (B37). */
  approvers?: readonly string[];
  /** The record's key (B69): the send line keeps its message id as a fingerprint under it, so the report's ids are looked for in the same form. */
  recordKey?: Buffer;
}

const digits = (n: string): string => n.replace(/\D/gu, "");

/**
 * The newest line that sent this message (any action with a messageId that is not a received message or another report), and the id it matched by. The ids are
 * compared in the form the record keeps them: a fingerprint under the shop's key, or the id itself without one.
 */
export function findSentEntry(entries: readonly RecordEntry[], ids: readonly string[], recordKey?: Buffer): { entry: RecordEntry; id: string } | undefined {
  const stored = new Map(ids.map((id) => [recordKey ? messageFingerprint(recordKey, id) : id, id] as const));
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.action === MESSAGE_STATUS_ENTRY || e.action === "receive_message" || e.refs.messageId === undefined) continue;
    const id = stored.get(e.refs.messageId);
    if (id !== undefined) return { entry: e, id };
  }
  return undefined;
}

/** Who the message was for: what the send line says, or else the number in the report (or on the send line) against the owner's and the approvers'. */
function recipientOf(status: MessageStatus, sent: RecordEntry | undefined, ctx: StatusContext): "owner" | "approver" | "customer" | "unknown" {
  if (sent?.refs.to === "owner" || sent?.refs.to === "customer") return sent.refs.to;
  const number = status.to ?? (sent && /^\+?\d{6,15}$/u.test(sent.conversation) ? sent.conversation : undefined);
  if (!number) return "unknown";
  if (ctx.owner && digits(ctx.owner.whatsapp) === digits(number)) return "owner";
  if ((ctx.approvers ?? []).some((a) => digits(a) === digits(number))) return "approver";
  return "customer";
}

/** The line's words: what WhatsApp reported, kept apart from what the send line meant ("accepted"). English, as every record note is. */
function notesFor(status: MessageStatus, listed: boolean, matched: boolean): string {
  const code = status.error?.code !== undefined ? ` (code ${status.error.code}${status.error.title ? `: ${status.error.title}` : ""})` : status.error?.title ? ` (${status.error.title})` : "";
  const said = status.status === "delivered" ? "WhatsApp reported this message delivered to the person's phone. When it was sent, WhatsApp had only accepted it; this is the later delivery report."
    : status.status === "read" ? "WhatsApp reported this message read on the person's phone."
    : `WhatsApp reported this message failed${code}: it never reached the person's phone, although it was accepted when it was sent. Nothing is sent again by itself.${listed ? " It is listed on the shop's to-do list for a person to follow up." : ""}`;
  return matched ? said : `${said} No line in this record sent a message with this id: something else on the shop's server sent it (the approvals relay sends its own messages to the owner), or it was sent before this record began.`;
}

/**
 * Write one record line for a report: action `message_status`, outcome "confirmed" for delivered and read (WhatsApp's own word that it arrived) and "failed" for
 * failed. It copies the case and the conversation from the line that sent the message, so a failure about a booking sits with that booking. The same report twice
 * (a provider retrying, or Gupshup's ids in another order) writes one line. Returns the line, or undefined when it was already there.
 */
export function recordMessageStatus(record: ActionRecord, status: MessageStatus, ctx: StatusContext = {}): RecordEntry | undefined {
  const entries = record.entries();
  const found = findSentEntry(entries, status.ids, ctx.recordKey);
  const sent = found?.entry;
  const messageId = found?.id ?? status.ids[0];
  const kept = ctx.recordKey ? messageFingerprint(ctx.recordKey, messageId) : messageId;
  if (entries.some((e) => e.action === MESSAGE_STATUS_ENTRY && e.refs.messageId === kept && e.refs.status === status.status)) return undefined;
  const to = recipientOf(status, sent, ctx);
  const caseId = sent?.booking ?? null;
  // A spoken copy of a reply (B29, refs.audio) is a courtesy: the same words went as text, so a spoken copy that never arrived (WhatsApp fetched the link late, say) is on the
  // record but is not unfinished work for a person.
  const listed = status.status === "failed" && sent?.refs.audio !== "voice" && reliedOn(to, caseId);
  const code = status.error?.code;
  return record.append({
    conversation: sent?.conversation ?? status.to ?? "unknown",
    booking: caseId,
    action: MESSAGE_STATUS_ENTRY,
    inputs: { status: status.status, ids: status.ids, ...(status.error ? { error: status.error } : {}) },
    outcome: status.status === "failed" ? "failed" : "confirmed",
    language: sent?.language ?? ctx.owner?.language ?? "en",
    notes: notesFor(status, listed, sent !== undefined),
    refs: {
      messageId, status: status.status, to,
      ...(sent ? { sent: String(sent.seq) } : {}),
      ...(status.timestamp > 0 ? { reportedAt: new Date(status.timestamp).toISOString() } : {}),
      ...(code !== undefined ? { errorCode: String(code) } : {}),
    },
  });
}
