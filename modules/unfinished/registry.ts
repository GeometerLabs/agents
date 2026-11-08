// The unfinished-work registry (plan B31): the kinds of real obligation that need a person, in one extensible list.
//
// A kind is a small detector over what a shop's record and its cases (bookings, fees) already hold: it says "this case is stuck in this way", with one plain sentence's
// worth of facts and the recovery actions that make sense for it. It is NOT a new store and NOT a CRM: nothing here is saved, every list is worked out again from the
// record each time it is asked for, so it can never disagree with the record.
//
// Adding a kind (for example the UPI module's "UPI payment not yet confirmed by the owner"): write an `ObligationKind` and either add it to BUILT_IN in builtin.ts or call
// `obligations.register(kind)` when your module loads; then add the kind's sentence to the four panel word files (bundle/panel/words*.ts, `inbox.kinds`). A kind without
// words is still listed, under a plain fallback sentence, so a missing translation never hides a real obligation.
//
// A recovery action is only a NAME here. What it does is decided by the shop's own runtime, which runs it like any other event, so every call it makes goes through Guard
// and the normal limits. The registry cannot widen a limit: an action that a limit refuses is refused and the record says so.
import type { RecordEntry } from "../record/record.ts";

/** The names of the actions a runtime knows how to run. A kind lists the ones that fit it; the runtime refuses any name it does not know. */
export const RECOVERY_ACTIONS = ["recheck_payment", "retry_booking", "ask_owner_again", "recheck_refund"] as const;
export type RecoveryAction = (typeof RECOVERY_ACTIONS)[number] | (string & {});
export const ACTION_ID = /^[a-z][a-z0-9_]{1,39}$/u;

/** The least a case (a booking, a fee) must have for a detector to read it. Every other field is read by the detector that knows the template. */
export interface CaseLike {
  id: string;
  state: string;
  pending: { kind: string; [more: string]: unknown }[];
  refundIssues?: { paymentId: string; kind: string; note: string; atMs: number }[];
  [more: string]: unknown;
}

export interface UnfinishedOptions {
  /** How long an answer from the owner may wait before it is listed as waiting too long. The panel sets it (default 12 hours); it is not part of the shop's settings. */
  approvalWaitMs: number;
  /** A thing this young is still being worked on by the agent itself, so it is not listed yet. */
  graceMs: number;
}
export const DEFAULT_OPTIONS: UnfinishedOptions = { approvalWaitMs: 12 * 3_600_000, graceMs: 10 * 60_000 };

export interface DetectInput {
  /** "bookings", "fees", ... */
  template: string;
  entries: readonly RecordEntry[];
  cases: readonly CaseLike[];
  nowMs: number;
  options: UnfinishedOptions;
}

export interface Obligation {
  kind: string;
  /** The booking or fee it is about ("b-3", "f-12"). */
  caseId: string;
  /** When it began, if the record says. */
  sinceMs: number | null;
  /** What the sentence needs. Ids, amounts and whole numbers only: never a name, a phone number or a word a customer wrote. */
  facts: Record<string, string | number>;
  actions: readonly RecoveryAction[];
}

export interface ObligationKind {
  /** lower_snake_case, up to 40 characters. It is also the key of the kind's sentence in the panel's words and the key counts are sent by. */
  id: string;
  /** The templates it applies to, or "all". */
  templates: readonly string[] | "all";
  detect(input: DetectInput): Obligation[];
}

const KIND_ID = /^[a-z][a-z0-9_]{1,39}$/u;

export function createObligationRegistry(initial: readonly ObligationKind[] = []) {
  const kinds = new Map<string, ObligationKind>();
  const api = {
    /** Add a kind. A repeated id, or an id that is not lower_snake_case, is a mistake in the code that adds it, so it throws. */
    register(kind: ObligationKind): void {
      if (!KIND_ID.test(kind.id)) throw new Error(`An obligation kind's id is lower_snake_case, up to 40 characters; "${kind.id}" is not.`);
      if (kinds.has(kind.id)) throw new Error(`An obligation kind called "${kind.id}" is already registered.`);
      kinds.set(kind.id, kind);
    },
    kinds: (): ObligationKind[] => [...kinds.values()],
    ids: (): string[] => [...kinds.keys()],
    has: (id: string): boolean => kinds.has(id),
    /** Every obligation of every kind that applies to the template, oldest first (the ones with no known start last). One kind that throws does not hide the others: it is reported in `failed`. */
    detect(input: DetectInput): { found: Obligation[]; failed: string[] } {
      const found: Obligation[] = [];
      const failed: string[] = [];
      for (const kind of kinds.values()) {
        if (kind.templates !== "all" && !kind.templates.includes(input.template)) continue;
        try { found.push(...kind.detect(input)); } catch { failed.push(kind.id); }
      }
      found.sort((a, b) => (a.sinceMs ?? Infinity) - (b.sinceMs ?? Infinity) || a.kind.localeCompare(b.kind) || a.caseId.localeCompare(b.caseId));
      return { found, failed };
    },
  };
  for (const kind of initial) api.register(kind);
  return api;
}
export type ObligationRegistry = ReturnType<typeof createObligationRegistry>;

/** How many of each kind: all a heartbeat may ever carry (never a name, a number or a case id). */
export function countsByKind(found: readonly Obligation[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const o of found) counts[o.kind] = (counts[o.kind] ?? 0) + 1;
  return counts;
}

// ---- helpers a detector uses ----------------------------------------------------------------------------------------------------------------------------

/** The newest record entry about this case with one of these actions (optionally only with these outcomes). */
export function latestEntry(entries: readonly RecordEntry[], caseId: string, actions: readonly string[], outcomes?: readonly string[]): RecordEntry | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.booking === caseId && actions.includes(e.action) && (!outcomes || outcomes.includes(e.outcome))) return e;
  }
  return undefined;
}
/**
 * The record's name for a recovery step a person asked for from the panel: an entry with this action on the case, `refs.action` the recovery action's name and `refs.recovery`
 * the request's id. The asking is `attempted`; a look that read the service's own store is `confirmed`; the steps it triggers (a deposit recorded, a booking confirmed, a
 * message sent) are written by the same code that writes them every day, so they follow the same limits.
 */
export const RECOVERY_ENTRY = "recovery";

/** The newest `recovery` entry of this case for this action, with one of these outcomes. */
export function latestRecovery(entries: readonly RecordEntry[], caseId: string, action: string, outcomes: readonly string[]): RecordEntry | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.booking === caseId && e.action === RECOVERY_ENTRY && e.refs.action === action && outcomes.includes(e.outcome)) return e;
  }
  return undefined;
}

export const timeOf = (e: RecordEntry | undefined): number | null => (e && Number.isFinite(Date.parse(e.time)) ? Date.parse(e.time) : null);
