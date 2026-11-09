// A runtime put back from a nightly snapshot (the deploy bundle's `restore`). Its data can be up to a day behind the world: payment links made, refunds sent and
// calendar events written after the snapshot are in the providers' own records, not in this one. The bundle leaves `restored.json` beside the database, and at the
// next start, before any step runs, the runtime:
//   1. moves every id counter of its store on by RESTORE_ID_GAP (after b-41 the next booking is b-100042), so no new booking, fee or order takes an id that was used
//      after the snapshot. A payment link, a calendar event and a refund's receipt are found again by that id ("look first"), so a reused id would find ANOTHER
//      customer's link, payment or event and take it for its own;
//   2. writes one `restored` entry to the record (an append like any other: the record is never rewritten), naming the snapshot, so the gap is on the record;
//   3. renames the note, so this is done once (and, if the process stops in between, not twice: the entry is looked for first).
// The rest is what the runtime does every day, and it holds after a restore because every money and calendar write looks first at the provider's own record: a refund
// is asked for only when Razorpay's own list for that payment does not show it (and Guard's own store, which a restore does not touch, refuses a second refund of the
// same payment); a payment link only when Razorpay lists none for that reference; a calendar write only after listing that booking's events; a hold whose time ran out
// looks at the refund list before it says nothing was refunded. What cannot be settled that way becomes a refund issue, which the unfinished-work list shows a person.
import { existsSync, readFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Clock } from "../core/clock.ts";
import type { Language } from "../language/languages.ts";
import { createRecord } from "../record/record.ts";
import type { RecordEntry } from "../record/record.ts";

/** How far the id counters move after a restore: more ids than a shop makes in the 30 days a snapshot is kept. */
export const RESTORE_ID_GAP = 100_000;
export const RESTORED_ENTRY = "restored";
export const RESTORE_NOTE = "restored.json";

export interface RestoreNote { snapshot?: string; restoredAt?: string; lastSeq?: number | null }

/** The note beside the database, if the bundle left one. An unreadable note still means the data was put back. */
export function readRestoreNote(databaseFile: string): { file: string; note: RestoreNote } | undefined {
  const file = join(dirname(databaseFile), RESTORE_NOTE);
  if (!existsSync(file)) return undefined;
  try { return { file, note: JSON.parse(readFileSync(file, "utf8")) as RestoreNote }; } catch { return { file, note: {} }; }
}

/**
 * What the first step after a restore saves: the store with its counters moved on, and the record with the `restored` entry. Undefined when the entry for this note is
 * already in the record (the process stopped after saving it and before the note was renamed).
 */
export function afterRestore(o: {
  note: RestoreNote; snapshot: string; entries: readonly RecordEntry[]; clock: Clock;
  /** The template's own: every counter of its store moved on by `gap` (modules/runtime/snapshot.ts). */
  skipCounters?: (json: string, gap: number) => string;
  owner?: { whatsapp?: string; language?: Language };
}): { snapshot: string; fresh: RecordEntry[]; said: string } | undefined {
  const refs = { snapshot: o.note.snapshot ?? "unknown", restoredAt: o.note.restoredAt ?? "unknown", idGap: String(o.skipCounters ? RESTORE_ID_GAP : 0) };
  if (o.entries.some((e) => e.action === RESTORED_ENTRY && e.refs.snapshot === refs.snapshot && e.refs.restoredAt === refs.restoredAt)) return undefined;
  const snapshot = o.skipCounters ? o.skipCounters(o.snapshot, RESTORE_ID_GAP) : o.snapshot;
  const record = createRecord(o.clock, o.entries);
  const lastSeq = o.note.lastSeq ?? o.entries.length;
  record.append({
    conversation: o.owner?.whatsapp ?? "", booking: null, action: RESTORED_ENTRY, outcome: "confirmed", inputs: o.note, language: o.owner?.language ?? "en", refs,
    notes: `This shop's data was put back from the nightly snapshot of ${refs.snapshot}, which ends at entry ${lastSeq}. What the agent did after that snapshot is not in this record; the payment service, the calendar and Guard keep their own. ${o.skipCounters ? `Every new id starts ${RESTORE_ID_GAP} further on, so none can be one used after the snapshot.` : "This template does not move its ids on: an id used after the snapshot can come back."} Each payment link, refund and calendar write is looked up in the provider's own record before anything is sent.`,
  });
  return { snapshot, fresh: record.entries().slice(o.entries.length), said: `Restored from the snapshot of ${refs.snapshot}: ${o.skipCounters ? `ids moved on by ${RESTORE_ID_GAP}` : "ids NOT moved on (the template cannot)"}, a "restored" entry written; every payment link, refund and calendar write is looked up at the provider before it is sent.` };
}

/** The note is done with: kept beside the database under another name, as a trace. */
export function retireRestoreNote(file: string, nowMs: number): void {
  try { renameSync(file, `${file}.done-${new Date(nowMs).toISOString().replace(/[-:]|\.\d{3}/gu, "")}`); } catch { /* the entry in the record is what stops a second pass */ }
}
