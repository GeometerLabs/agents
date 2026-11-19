// Small helpers the books' vector generator (gen_books_vectors.ts) builds its worlds with: a record on a fake clock (the real createRecord, so `time`, `booking ?? null` and `notes ?? ""`
// are the TypeScript's own), and the way a template writes a money line through post(). Kept apart so the generator stays readable. Nothing here is shipped: it only makes test data.
import { createRecord } from "../../modules/record/record.ts";
import type { NewEntry, RecordEntry } from "../../modules/record/record.ts";
import { fakeClock } from "../../modules/core/clock.ts";

export const T0 = Date.UTC(2026, 3, 1, 4, 0); // 1 April 2026 04:00 UTC = 09:30 in India, the first day of the 26-27 financial year

/** A record whose entries are made at the times the steps say. */
export function newRecord(startMs = T0) {
  const clock = fakeClock(startMs);
  const record = createRecord(clock);
  return { clock, record, entries: (): readonly RecordEntry[] => record.entries(), append: (at: number, e: Partial<NewEntry> & { action: string; outcome: NewEntry["outcome"] }): RecordEntry => { clock.set(at); return record.append({ conversation: "919800000001", inputs: {}, language: "en", ...e } as NewEntry); } };
}

/** What a step of a world does, as the Go test replays it: all plain JSON. */
export interface Step {
  /** The clock's time for this step, epoch ms. */
  at: number;
  /** "post": through createAccounting.post with a line written by the callback; "raw": a record line appended as it is. */
  op: "post" | "raw";
  /** post: the money event. */
  event?: Record<string, unknown>;
  /** The line written: action, outcome, booking (default: the event's case), conversation, language, notes, extra refs written BEFORE the money refs, and how it is written (mode). */
  line: { action: string; outcome: NewEntry["outcome"]; booking?: string | null; conversation?: string; language?: string; notes?: string; refs?: Record<string, string>; mode?: string };
  /** What came back (post): the result or the thrown text. */
  result?: { posted?: boolean; doc?: string; why?: string; error?: string };
}
