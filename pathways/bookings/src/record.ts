// The action record: an append-only list of everything the agent did, tried or was stopped from doing.
//
// "Confirmed" means the agent read the result back from the service's OWN store (the calendar event is
// there, the payment is on the link). The service's reply to a write is never enough; that is the
// difference between "attempted" and "confirmed". Customer message text is kept only as a digest.
import { createHash } from "node:crypto";
import type { Clock } from "./clock.ts";
import type { Language } from "./settings.ts";

export type Outcome = "attempted" | "confirmed" | "unconfirmed" | "failed" | "blocked" | "held_for_owner";

export type Action =
  | "receive_message" | "receive_payment_event" | "send_message" | "ask_owner" | "opt_out" | "owner_decision"
  | "hold_slot" | "release_slot" | "create_deposit_link" | "cancel_deposit_link" | "record_deposit"
  | "confirm_booking" | "reschedule_booking" | "cancel_booking" | "complete_booking" | "refund"
  // the one plain line sent back to a voice note ("please type"); it is a message, so the report counts it as one (report/data.ts MESSAGE_ACTIONS)
  | "voice_note_reply"
  // the agent moved to buttons and lists with no AI (the monthly allowance is used up, it was switched off from outside, or a model failed): the entry the builder or partner reads
  | "ai_mode";

export type Verdict = "allow" | "block" | "hold_for_owner";

export type RuleId =
  | "price-at-or-above-list" | "within-hours" | "no-double-booking" | "confirm-only-when-recorded"
  | "one-deposit-per-booking" | "refund-limit" | "no-message-after-stop" | "message-matches-record" | "opt-out";

export interface RuleDecision { ruleId: RuleId; verdict: Verdict; reason: string }

/** What the caller supplies. The record adds the sequence number, the time and the digest. */
export interface NewEntry {
  conversation: string; // the customer's WhatsApp number, or the owner's
  booking?: string | null;
  action: Action;
  inputs: unknown; // digested, never stored
  outcome: Outcome;
  decisions?: RuleDecision[];
  language: Language;
  notes?: string;
  refs?: Record<string, string>; // ids in the services' own records: eventId, linkId, paymentId, refundId, messageId
}

export interface RecordEntry {
  readonly seq: number;
  readonly time: string; // ISO 8601, UTC
  readonly conversation: string;
  readonly booking: string | null;
  readonly action: Action;
  readonly inputsDigest: string;
  readonly outcome: Outcome;
  readonly decisions: readonly RuleDecision[];
  readonly language: Language;
  readonly notes: string;
  readonly refs: Readonly<Record<string, string>>;
}

/** The read-only side, which is all the limits need. */
export interface RecordView {
  entries(): readonly RecordEntry[];
  forBooking(booking: string): RecordEntry[];
  /** Is there an entry for this action on this booking that the service's own record confirmed? */
  isConfirmed(booking: string, action: Action, ref?: { key: string; value: string }): boolean;
  /** The ids (for one ref key) of every confirmed entry of this action on this booking. */
  confirmedRefs(booking: string, action: Action, key: string): string[];
  /** The most recent entry for this action on this booking, if any. */
  last(booking: string, action: Action): RecordEntry | undefined;
}

export interface ActionRecord extends RecordView {
  append(entry: NewEntry): RecordEntry;
}

/** `saved` are entries an earlier run already wrote (the server reloads its record from disk); new entries continue after them. */
export function createRecord(clock: Clock, saved: readonly RecordEntry[] = []): ActionRecord {
  const list: RecordEntry[] = saved.map(frozen);

  const view: RecordView = {
    entries: () => [...list],
    forBooking: (booking) => list.filter((e) => e.booking === booking),
    isConfirmed: (booking, action, ref) =>
      list.some((e) => e.booking === booking && e.action === action && e.outcome === "confirmed" && (!ref || e.refs[ref.key] === ref.value)),
    confirmedRefs: (booking, action, key) =>
      list.filter((e) => e.booking === booking && e.action === action && e.outcome === "confirmed" && e.refs[key] !== undefined).map((e) => e.refs[key]),
    last: (booking, action) => [...list].reverse().find((e) => e.booking === booking && e.action === action),
  };

  return {
    ...view,
    append(entry) {
      const stored: RecordEntry = Object.freeze({
        seq: list.length + 1,
        time: new Date(clock.now()).toISOString(),
        conversation: entry.conversation,
        booking: entry.booking ?? null,
        action: entry.action,
        inputsDigest: digest(entry.inputs),
        outcome: entry.outcome,
        decisions: Object.freeze((entry.decisions ?? []).map((d) => Object.freeze({ ...d }))),
        language: entry.language,
        notes: entry.notes ?? "",
        refs: Object.freeze({ ...(entry.refs ?? {}) }),
      });
      list.push(stored);
      return stored;
    },
  };
}

function frozen(e: RecordEntry): RecordEntry {
  return Object.freeze({ ...e, decisions: Object.freeze(e.decisions.map((d) => Object.freeze({ ...d }))), refs: Object.freeze({ ...e.refs }) });
}

/** A short fingerprint of the inputs: same content gives the same digest whatever the key order. */
export function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex").slice(0, 16);
}

/** The one byte form of a JSON value: keys sorted, no spaces, so the same content always has the same bytes (and the same digest). */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}
